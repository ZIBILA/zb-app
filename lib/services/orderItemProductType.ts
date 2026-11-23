/**
 * OrderItem.productType: the Shopify product_type of each order line ("Jackets",
 * "BAGGY JEANS" …), sent as content_category on the server Meta / Snap Purchase
 * (lib/tracking/product-type.ts joins the distinct values).
 *
 * Where the value comes from, in order:
 *  1. the cart item's `category` — the browser already sends product.product_type
 *     with every checkout request (CartItem.category), the same value the pixels use;
 *  2. Shopify (Admin GraphQL `nodes`, cached in-process, short timeout) for cart items
 *     that carry no category (wishlist / bookmark adds, carts saved by an older build).
 *     The local Product table has no product-type column, so there is nothing to read
 *     there;
 *  3. for rows rewritten from a Shopify payload (orders/create webhook, order sync,
 *     login sync), the value the order's previous rows already had: those paths replace
 *     the web_* / pre_* rows with Shopify's own line items, which carry no product type.
 *
 * Nothing here throws: a missing type simply leaves the column NULL (the Purchase then
 * omits content_category, never sends a placeholder).
 */
import { normalizeProductType } from '@/lib/tracking/product-type';

const TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;
/** productType === null: Shopify answered and the product has no type (cached too). */
const cache = new Map<string, { productType: string | null; ts: number }>();

const PRODUCT_TYPES_QUERY = `
  query ZbProductTypes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        productType
      }
    }
  }
`;

/** `gid://shopify/Product/123` → `123`; `123` → `123`; a cuid or anything else → ''. */
export function productNumericId(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const tail = s.split('/').pop() || '';
  return /^\d+$/.test(tail) ? tail : '';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`product type lookup timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Product types by numeric Shopify product id. Only products that HAVE a type are in
 * the result. Never throws (a failed batch is just missing from the result).
 */
export async function fetchProductTypes(
  productIds: unknown[],
  opts: { timeoutMs?: number } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const now = Date.now();
  const missing: string[] = [];
  for (const raw of productIds) {
    const id = productNumericId(raw);
    if (!id) continue;
    const hit = cache.get(id);
    if (hit && now - hit.ts < TTL_MS) {
      if (hit.productType) out.set(id, hit.productType);
    } else if (!missing.includes(id)) {
      missing.push(id);
    }
  }
  if (missing.length === 0) return out;

  const timeoutMs = opts.timeoutMs ?? 2500;
  const batchSize = 50;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    try {
      // Loaded on demand: the carry-over helper below is used by routes that never call Shopify.
      const { shopifyGraphqlFetch } = await import('@/lib/shopify-admin');
      const data = await withTimeout(
        shopifyGraphqlFetch<{ nodes: Array<{ id?: string; productType?: string } | null> }>(
          PRODUCT_TYPES_QUERY,
          { ids: batch.map((id) => `gid://shopify/Product/${id}`) },
        ),
        timeoutMs,
      );
      if (cache.size > MAX_CACHE_ENTRIES) cache.clear();
      for (const node of data?.nodes || []) {
        const id = productNumericId(node?.id);
        if (!id) continue;
        const productType = normalizeProductType(node?.productType);
        cache.set(id, { productType, ts: Date.now() });
        if (productType) out.set(id, productType);
      }
    } catch (err: any) {
      console.warn('[ProductType] Shopify lookup failed:', err?.message || err);
    }
  }
  return out;
}

/**
 * The product type of each checkout cart item, aligned with `items`: its own
 * `category` when present, else Shopify's product_type for its product id, else null.
 */
export async function resolveCartProductTypes(
  items: ReadonlyArray<any>,
  opts: { timeoutMs?: number } = {},
): Promise<Array<string | null>> {
  const list = Array.isArray(items) ? items : [];
  const types: Array<string | null> = list.map((it) => normalizeProductType(it?.category));
  const needLookup = list
    .map((it, i) => (types[i] ? '' : productNumericId(it?.productId)))
    .filter(Boolean);
  if (needLookup.length === 0) return types;
  const found = await fetchProductTypes(needLookup, opts);
  return types.map((t, i) => t ?? found.get(productNumericId(list[i]?.productId)) ?? null);
}

/** Looks up the type a line of an order already had, by variant id then local product id. */
export type ProductTypeCarry = (item: { variantId?: unknown; productId?: unknown }) => string | null;

const NO_CARRY: ProductTypeCarry = () => null;

/**
 * Read the product types currently stored on an order's rows. Call BEFORE a Shopify
 * payload replaces the rows, then pass `carry(item)` as productType when creating the
 * replacement row. Never throws.
 */
export async function loadProductTypeCarry(db: any, orderId: string): Promise<ProductTypeCarry> {
  try {
    const rows: Array<{ variantId: string | null; productId: string | null; productType: string | null }> =
      await db.orderItem.findMany({
        where: { orderId, productType: { not: null } },
        select: { variantId: true, productId: true, productType: true },
      });
    if (!Array.isArray(rows) || rows.length === 0) return NO_CARRY;
    const byVariant = new Map<string, string>();
    const byProduct = new Map<string, string>();
    for (const r of rows) {
      const t = normalizeProductType(r.productType);
      if (!t) continue;
      if (r.variantId && !byVariant.has(String(r.variantId))) byVariant.set(String(r.variantId), t);
      if (r.productId && !byProduct.has(String(r.productId))) byProduct.set(String(r.productId), t);
    }
    return (item) => {
      const v = item?.variantId ? String(item.variantId) : '';
      const p = item?.productId ? String(item.productId) : '';
      return (v && byVariant.get(v)) || (p && byProduct.get(p)) || null;
    };
  } catch (err: any) {
    console.warn('[ProductType] could not read the existing product types:', err?.message || err);
    return NO_CARRY;
  }
}
