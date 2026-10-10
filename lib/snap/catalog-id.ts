/**
 * Snap catalog id = Shopify backend VARIANT id, exactly as published in
 * https://zicabella.com/feed.xml (<g:id>) by app/feed.xml/route.ts
 * (`String(variant.id)`, numeric). <g:item_group_id> is the PRODUCT id and is
 * never used as a content id.
 *
 * Isomorphic: used by browser pixel code and server CAPI code.
 */

/** Numeric variant id from "123", "gid://shopify/ProductVariant/123" or "variant:123". */
export function normalizeVariantId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith('variant:')) s = s.slice(8);
  if (/^\d+$/.test(s)) return s;
  const gid = s.match(/^gid:\/\/shopify\/ProductVariant\/(\d+)$/);
  return gid ? gid[1] : null;
}

/**
 * Catalog id for a stored OrderItem.
 *  1. OrderItem.variantId (persisted at order creation from the cart/app variant id)
 *  2. OrderItem.sku ONLY when it is our own "variant:<id>" marker — a real
 *     merchandise SKU (e.g. "ZB-EXOSHELL-32") is never a catalog id, and a bare
 *     numeric sku on legacy web orders may be a product id, so it is not trusted.
 * Returns null when the variant id cannot be proven.
 */
export function snapCatalogIdFromOrderItem(item: { variantId?: unknown; sku?: unknown } | null | undefined): string | null {
  if (!item) return null;
  const fromVariant = normalizeVariantId(item.variantId);
  if (fromVariant) return fromVariant;
  const sku = typeof item.sku === 'string' ? item.sku.trim() : '';
  if (sku.startsWith('variant:')) return normalizeVariantId(sku);
  return null;
}
