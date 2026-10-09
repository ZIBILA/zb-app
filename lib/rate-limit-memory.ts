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
