const productCache = new Map<string, { data: any; timestamp: number }>();
const inflightFetches = new Map<string, Promise<any>>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes in-memory cache

export function getCachedAppProduct(handle: string): any | null {
  const handleKey = String(handle || '').toLowerCase().trim();
  const cached = productCache.get(handleKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  return null;
}

export function getInflightAppProduct(handle: string): Promise<any> | undefined {
  const handleKey = String(handle || '').toLowerCase().trim();
  return inflightFetches.get(handleKey);
}

export function setCachedAppProduct(handle: string, data: any) {
  const handleKey = String(handle || '').toLowerCase().trim();
  productCache.set(handleKey, { data, timestamp: Date.now() });
}

export function setInflightAppProduct(handle: string, promise: Promise<any>) {
  const handleKey = String(handle || '').toLowerCase().trim();
  inflightFetches.set(handleKey, promise);
}

export function deleteInflightAppProduct(handle: string) {
  const handleKey = String(handle || '').toLowerCase().trim();
  inflightFetches.delete(handleKey);
}

export function clearAppProductCache(handle?: string) {
  if (handle) {
    const handleKey = String(handle || '').toLowerCase().trim();
    productCache.delete(handleKey);
    inflightFetches.delete(handleKey);
  } else {
    productCache.clear();
    inflightFetches.clear();
  }
}
