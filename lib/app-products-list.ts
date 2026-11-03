import { fetchCollectionByHandle, fetchProductById, flattenProducts, ShopifyProduct } from '@/lib/shopify-admin';
import { isStorefrontEligible } from '@/lib/storefrontCatalog';
import { getShopSettings } from '@/lib/db';

/**
 * Fields the app only needs on the product PAGE (it fetches those by handle). A list that was asked for specific
 * `fields` and did not name them leaves them out: they were ~70% of the list's bytes (descriptions, care text, size
 * chart, every media item of every product) and nothing on a product card or in quick-add reads them.
 */
export const HEAVY_LIST_FIELDS = ['description', 'descriptionHtml', 'details', 'care', 'sizeChart', 'allMedia', 'productVideo', 'modelInfo', 'video'] as const;

export function parseFields(raw: string | null): Set<string> | null {
  const list = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? new Set(list) : null;
}

/** `media` is the name the app's full-product request uses for what the API calls `allMedia`. */
export function trimProduct<T extends Record<string, any>>(product: T, fields: Set<string> | null): T {
  if (!fields) return product;
  const out: Record<string, any> = { ...product };
  for (const key of HEAVY_LIST_FIELDS) {
    const named = fields.has(key) || (key === 'allMedia' && fields.has('media'));
    if (!named) delete out[key];
  }
  return out as T;
}

export interface ListParams {
  limit: number;
  collectionHandle: string | null;
  fetchAll: boolean;
  countOnly: boolean;
  fields: Set<string> | null;
}

export function parseListParams(url: URL): ListParams {
  const limit = parseInt(url.searchParams.get('limit') || '24', 10);
  return {
    limit,
    collectionHandle: url.searchParams.get('collection'),
    fetchAll: url.searchParams.get('all') === 'true' || limit >= 50,
    countOnly: url.searchParams.get('count') === 'true',
    fields: parseFields(url.searchParams.get('fields')),
  };
}

/** Same result for the same request: limits only matter where they are applied (collections / the homepage fallback). */
export function listCacheKey(p: ListParams): string {
  const fields = p.fields ? Array.from(p.fields).sort().join(',') : '*';
  const scope = p.collectionHandle
    ? `c:${p.collectionHandle}:${p.limit}`
    : p.fetchAll
      ? 'all'
      : `home:${p.limit}`;
  return `${scope}|${fields}|${p.countOnly ? 'count' : 'list'}`;
}

/** Builds the JSON body of the list endpoint (the work the cache saves). */
export async function buildAppProductList(p: ListParams): Promise<{ products?: any[]; total?: number }> {
  let products: ShopifyProduct[] = [];
  if (p.collectionHandle) {
    products = (await fetchCollectionByHandle(p.collectionHandle, p.limit)).products;
  } else if (p.fetchAll) {
    // Everything eligible, in the Shop All order configured in the CMS.
    products = (await fetchCollectionByHandle('all')).products;
  } else {
    const shop = await getShopSettings();
    const homepageProducts = shop?.homepageProducts;
    const homepageCollection = shop?.homepageCollection;
    if (homepageProducts && homepageProducts.trim()) {
      const ids = homepageProducts.split(',').map((id: string) => id.trim()).filter(Boolean);
      const fetched = await Promise.all(ids.map((id: string) => fetchProductById(id).catch(() => null)));
      products = fetched.filter((x): x is ShopifyProduct => x !== null && isStorefrontEligible(x));
    } else if (homepageCollection && homepageCollection.trim()) {
      products = (await fetchCollectionByHandle(homepageCollection, p.limit)).products;
    } else {
      products = (await fetchCollectionByHandle('all', p.limit)).products;
    }
  }
  if (p.countOnly) return { total: products.length };
  // Batch metafield hydration — avoids one REST call per product (Shopify 429s).
  const flat = await flattenProducts(products);
  return { products: flat.map((x: any) => trimProduct(x, p.fields)) };
}

/** Primes the cache the home screen reads first, so the first shopper after a deploy is not the one who waits. */
export async function warmAppCatalog(): Promise<void> {
  try {
    const { cachedAppList } = await import('@/lib/app-list-cache');
    const params: ListParams = {
      limit: 100,
      collectionHandle: null,
      fetchAll: true,
      countOnly: false,
      fields: parseFields('id,title,handle,priceRange,featuredImage'),
    };
    const { json } = await cachedAppList(listCacheKey(params), () => buildAppProductList(params));
    console.log('[App Catalog] warmed');
    // The product pages shoppers open first: the hand-picked homepage products (first 12).
    const shop = await getShopSettings();
    const picks = String(shop?.homepageProducts || '').split(',').map((x: string) => x.trim().split('/').pop() || '').filter(Boolean);
    const products: Array<{ id: string; handle: string }> = JSON.parse(json).products || [];
    const byId = new Map(products.map((x) => [String(x.id).split('/').pop() || '', x.handle]));
    const handles = picks.map((id: string) => byId.get(id)).filter(Boolean).slice(0, 12) as string[];
    const { warmAppProducts } = await import('@/lib/app-product-detail');
    await warmAppProducts(handles);
    console.log(`[App Catalog] warmed ${handles.length} product pages`);
  } catch (err: any) {
    console.warn('[App Catalog] warm-up skipped:', err?.message || err);
  }
}
