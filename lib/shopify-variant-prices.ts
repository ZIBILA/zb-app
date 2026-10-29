/**
 * Batch-fetch Shopify Admin variant prices (INR) by numeric variant id.
 * Used by checkout / mobile order create so captured payments can't underpay.
 */
export async function fetchVariantPriceMap(
  variantIds: string[]
): Promise<Map<string, number>> {
  // Delegates to the GraphQL-based lookup (lib/variant-prices.ts). The REST
  // `variants.json?ids=` call used here before is not a Shopify endpoint, so the
  // mobile routes never actually re-priced anything.
  const { fetchVariantPrices } = await import("@/lib/variant-prices");
  return fetchVariantPrices(variantIds);
}

/**
 * Sum line totals using Shopify prices when available.
 * Per-line: Shopify unit price wins (client can't undercut); if Shopify has no
 * price for a variant, fall back to the client unit price.
 */
export function sumLineItemsWithAuthoritativePrices(
  lineItems: Array<{ variantId?: string; variant_id?: string; price?: number | string; quantity?: number }>,
  priceMap: Map<string, number>
): { subtotal: number; allMapped: boolean } {
  let subtotal = 0;
  let allMapped = lineItems.length > 0;
  for (const li of lineItems) {
    const rawId = String(li.variantId || li.variant_id || "")
      .split("/")
      .pop() || "";
    const qty = Math.max(1, Number(li.quantity) || 1);
    const clientUnit = Math.max(0, Number(li.price) || 0);
    const shopifyUnit = priceMap.get(rawId);
    if (shopifyUnit === undefined) {
      allMapped = false;
      subtotal += clientUnit * qty;
    } else {
      subtotal += shopifyUnit * qty;
    }
  }
  return { subtotal: Math.round(subtotal * 100) / 100, allMapped };
}
