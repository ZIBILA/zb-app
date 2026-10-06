/**
 * Shared in-flight / TTL caches for storefront shell fetches.
 * Prevents Layout + Header + MenuDrawer from stampeding the same APIs.
 */

type CacheEntry<T> = { promise: Promise<T>; expiresAt: number };

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string, loader: () => Promise<T>, ttlMs = TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;

  const promise = loader()
    .then((data) => data)
    .catch((err) => {
      cache.delete(key);
      throw err;
    });

  cache.set(key, { promise, expiresAt: now + ttlMs });
  return promise;
}

export function fetchHeaderCollections(): Promise<any[]> {
  return getCached('collections:header', async () => {
    const res = await fetch('/api/shopify/collections?location=header');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  });
}

export function fetchMenuCollections(): Promise<any[]> {
  return getCached('collections:menu', async () => {
    const res = await fetch('/api/shopify/collections?location=menu');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  });
}

export function fetchGlobalStoreConfig(): Promise<{
  globalStoreEnabled?: boolean;
  countries?: any[];
  detectedCountryCode?: string;
} | null> {
  return getCached('global-store:config', async () => {
    const res = await fetch('/api/global-store/config');
    if (!res.ok) return null;
    return res.json();
  });
}

export function fetchStorefrontProducts(query: string): Promise<any[]> {
  return getCached(`products:${query}`, async () => {
    const res = await fetch(`/api/shopify/products?${query}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : data.products || [];
  }, 2 * 60 * 1000);
}
