import { fetchProductByHandle, flattenProduct } from '@/lib/shopify-admin';
import { isStorefrontEligible } from '@/lib/storefrontCatalog';
import {
  getCachedAppProduct,
  getInflightAppProduct,
  getStaleAppProduct,
  setCachedAppProduct,
  setInflightAppProduct,
  deleteInflightAppProduct,
} from '@/lib/appProductCache';

/** Loads one product for the app from Shopify (once, however many shoppers ask at the same time) and caches it. */
function loadFromShopify(handle: string): Promise<any> {
  const running = getInflightAppProduct(handle);
  if (running) return running;
  const promise = (async () => {
    const rawProduct = await fetchProductByHandle(handle);
    // Drafted / unpublished products are not sold in the app either.
    if (!rawProduct || !isStorefrontEligible(rawProduct)) return null;
    const flattened = await flattenProduct(rawProduct);
    setCachedAppProduct(handle, flattened);
    return flattened;
  })().finally(() => deleteInflightAppProduct(handle));
  setInflightAppProduct(handle, promise);
  return promise;
}

/**
 * The product for the app's product page. A fresh cached copy is returned at once; an expired one (up to 1 hour old)
 * is returned at once too and refreshed in the background; only a product nobody has opened recently waits on Shopify.
 */
export async function getAppProduct(handle: string): Promise<any | null> {
  const fresh = getCachedAppProduct(handle);
  if (fresh) return fresh;
  const stale = getStaleAppProduct(handle);
  if (stale) {
    loadFromShopify(handle).catch((err) => console.warn(`[App Product] background refresh of ${handle} failed:`, err?.message || err));
    return stale;
  }
  return loadFromShopify(handle);
}

/** Loads the given product pages into the cache a few at a time (used after a deploy / restart). */
export async function warmAppProducts(handles: string[], concurrency = 2): Promise<void> {
  const queue = handles.filter(Boolean);
  const worker = async () => {
    for (let h = queue.shift(); h; h = queue.shift()) {
      await getAppProduct(h).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}
