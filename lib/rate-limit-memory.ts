/**
 * Per-instance, in-memory fixed-window rate limiter with NO database access.
 *
 * For high-volume browser-facing endpoints (/api/meta/event fires on every page
 * view; /api/whatsapp-events/track on most storefront actions) where the
 * DB-backed limiter in lib/rate-limit.ts would add several queries per request
 * to an already connection-limited Supabase pool. It is an abuse throttle, not
 * an exact global quota: each app instance counts on its own.
 */
const store = new Map<string, { count: number; resetAt: number }>();
const MAX_KEYS = 50_000;

export function rateLimitInMemory(
  key: string,
  options: { maxRequests?: number; windowMs?: number } = {},
): { allowed: boolean; remaining: number; resetAfter: number } {
  const maxRequests = options.maxRequests ?? 10;
  const windowMs = options.windowMs ?? 60_000;
  const now = Date.now();

  let entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    if (store.size >= MAX_KEYS) {
      // Bounded memory: drop expired windows first, then the oldest keys if still full.
      store.forEach((v, k) => { if (now > v.resetAt) store.delete(k); });
      if (store.size >= MAX_KEYS) {
        const excess = store.size - MAX_KEYS + 1;
        let i = 0;
        for (const k of store.keys()) { if (i++ >= excess) break; store.delete(k); }
      }
    }
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }
  entry.count += 1;
  return {
    allowed: entry.count <= maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
    resetAfter: Math.ceil(Math.max(0, entry.resetAt - now) / 1000),
  };
}

/**
 * Per-instance, in-memory SLIDING-window limiter: the same semantics as the
 * Postgres-backed `rateLimit()` in lib/rate-limit.ts (count the hits in the last
 * `windowMs`, reject without recording once `maxRequests` is reached, Retry-After =
 * until the oldest hit leaves the window) with no database round trips. The DB
 * version cost a DELETE + COUNT + INSERT on "RateLimitLog" per request, which on
 * the cart endpoints meant three writes per storefront page load.
 *
 * Hits are pruned on access; the key space is bounded so a scan of random IPs
 * cannot grow memory without limit. Like the fixed-window limiter above, each
 * app instance counts on its own.
 */
type SlidingEntry = { hits: number[]; windowMs: number };
const slidingStore = new Map<string, SlidingEntry>();
const SLIDING_MAX_KEYS = 50_000;

function sweepSliding(now: number) {
  slidingStore.forEach((entry, key) => {
    const newest = entry.hits[entry.hits.length - 1];
    if (newest === undefined || newest < now - entry.windowMs) slidingStore.delete(key);
  });
  if (slidingStore.size >= SLIDING_MAX_KEYS) {
    const excess = slidingStore.size - SLIDING_MAX_KEYS + 1;
    let i = 0;
    for (const k of slidingStore.keys()) { if (i++ >= excess) break; slidingStore.delete(k); }
  }
}

export function rateLimitSlidingWindow(
  key: string,
  options: { maxRequests?: number; windowMs?: number; now?: number } = {},
): { allowed: boolean; remaining: number; resetAfter: number } {
  const maxRequests = options.maxRequests ?? 10;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now();
  const windowStart = now - windowMs;

  let entry = slidingStore.get(key);
  if (entry) {
    // Hits are appended in time order, so everything outside the window sits at the front.
    let stale = 0;
    while (stale < entry.hits.length && entry.hits[stale] < windowStart) stale++;
    if (stale > 0) entry.hits.splice(0, stale);
    if (entry.hits.length === 0) {
      slidingStore.delete(key);
      entry = undefined;
    }
  }
  if (!entry) {
    if (slidingStore.size >= SLIDING_MAX_KEYS) sweepSliding(now);
    entry = { hits: [], windowMs };
    slidingStore.set(key, entry);
  }

  if (entry.hits.length >= maxRequests) {
    const oldest = entry.hits[0];
    return {
      allowed: false,
      remaining: 0,
      resetAfter: Math.ceil(Math.max(0, oldest + windowMs - now) / 1000),
    };
  }

  entry.hits.push(now);
  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - entry.hits.length),
    resetAfter: Math.ceil(windowMs / 1000),
  };
}

/** Test hook: number of keys currently tracked by the sliding-window limiter. */
export function slidingWindowKeyCount(): number {
  return slidingStore.size;
}
