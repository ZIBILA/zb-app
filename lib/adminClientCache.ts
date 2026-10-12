/**
 * Lightweight client-side memory cache & request deduplicator for Admin Dashboard.
 * Prevents redundant HTTP fetches on page transitions, back/forward navigation,
 * and concurrent component mounts.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();

export interface FetchOptions extends RequestInit {
  ttlMs?: number;
  skipCache?: boolean;
}

/**
 * Cached client fetch for admin GET requests.
 * Deduplicates concurrent requests and serves fresh memory copies within TTL.
 */
export async function cachedAdminFetch<T = any>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const { ttlMs = 30_000, skipCache = false, ...fetchOptions } = options;

  // 1. Check existing in-memory cache if not explicitly bypassed
  if (!skipCache) {
    const cached = memoryCache.get(url);
    if (cached && Date.now() - cached.timestamp < ttlMs) {
      return cached.data as T;
    }
  }

  // 2. Request deduplication: if identical URL request is already in-flight, reuse its promise
  if (inFlightRequests.has(url)) {
    return inFlightRequests.get(url) as Promise<T>;
  }

  // 3. Initiate network request
  const promise = (async () => {
    try {
      const res = await fetch(url, fetchOptions);
      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }
      const data = (await res.json()) as T;
      memoryCache.set(url, { data, timestamp: Date.now() });
      return data;
    } finally {
      inFlightRequests.delete(url);
    }
  })();

  inFlightRequests.set(url, promise);
  return promise;
}

/**
 * Manually invalidate cache entries matching a URL or prefix.
 * Call after mutations (POST / PATCH / DELETE) to ensure subsequent GETs fetch fresh data.
 */
export function invalidateAdminCache(urlPrefix?: string): void {
  if (!urlPrefix) {
    memoryCache.clear();
    return;
  }
  for (const key of memoryCache.keys()) {
    if (key.startsWith(urlPrefix) || key.includes(urlPrefix)) {
      memoryCache.delete(key);
    }
  }
}
