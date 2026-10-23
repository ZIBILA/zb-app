/**
 * Batch-fetch Shopify Admin variant prices (INR) by numeric variant id.
 * Used by checkout / mobile order create so captured payments can't underpay.
 */
export async function fetchVariantPriceMap(
  variantIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const ids = Array.from(
    new Set(
      variantIds
        .map((id) => String(id || "").split("/").pop() || "")
        .filter((id) => id && /^\d+$/.test(id))
    )
  );
  if (ids.length === 0) return map;

  const { shopifyFetch } = await import("@/lib/shopify-admin");
  const batchSize = 50;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    try {
      const data = await shopifyFetch<{
        variants: Array<{ id: number; price: string }>;
      }>("variants.json", { ids: batch.join(","), fields: "id,price" });
      if (data?.variants) {
        for (const v of data.variants) {
          map.set(String(v.id), parseFloat(v.price));
        }
      }
    } catch (err) {
      console.warn("[shopify-variant-prices] batch failed:", err);
    }
  }
  return map;
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
