/**
 * Product type (Shopify product_type: "Jackets", "BAGGY JEANS", "Oversized T-Shirt" …)
 * of an order's lines, as the ad platforms' content_category.
 *
 * The browser pixels already send the cart items' category (= product.product_type,
 * joined with ", "). OrderItem now stores the same value (OrderItem.productType), so the
 * server Meta / Snap Purchase and the confirmation page can report it too.
 *
 * Isomorphic, no database import.
 */

/** Snap rejects a longer content_category (see /api/snap/event); Meta has no tighter limit. */
export const CONTENT_CATEGORY_MAX_LENGTH = 256;

/** Longest product type stored on a line (Shopify's own limit is 255). */
export const PRODUCT_TYPE_MAX_LENGTH = 255;

/** A trimmed, length-capped product type, or null for anything that is not a real value. */
export function normalizeProductType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v ? v.slice(0, PRODUCT_TYPE_MAX_LENGTH) : null;
}

/**
 * content_category for an order: the distinct non-empty productType values of its items,
 * in order, joined with ", " and capped at 256 characters. Undefined when no item has
 * one — never a placeholder.
 */
export function orderContentCategory(items: ReadonlyArray<any> | null | undefined): string | undefined {
  if (!Array.isArray(items)) return undefined;
  const types: string[] = [];
  for (const it of items) {
    const t = normalizeProductType(it?.productType);
    if (t && !types.includes(t)) types.push(t);
  }
  return types.join(', ').slice(0, CONTENT_CATEGORY_MAX_LENGTH) || undefined;
}
