/**
 * The Shopify `refunds/create` webhook used to insert one standalone `Return` row per
 * refunded line item, with the deterministic id `<orderId>-<productId>-shopify-refund`.
 * That includes refunds issued when an order is cancelled, so cancelled orders showed up
 * as "returns" (reason "Order canceled" / "Refund created in Shopify", ₹0, status RECEIVED)
 * in the admin Returns queue, the customer's My Returns list and the return counters.
 *
 * Those rows are refund echoes, not customer return requests. The webhook no longer
 * creates them; this filter hides the ones already in the database.
 */
export const SHOPIFY_REFUND_MIRROR_ID_SUFFIX = '-shopify-refund';

export function isShopifyRefundMirrorId(id: string | null | undefined): boolean {
  return String(id || '').endsWith(SHOPIFY_REFUND_MIRROR_ID_SUFFIX);
}

/** Wrap any `prisma.return` where-clause so Shopify refund echoes are excluded. */
export function withoutShopifyRefundMirrors<T extends Record<string, unknown>>(where: T = {} as T) {
  return {
    AND: [where, { NOT: { id: { endsWith: SHOPIFY_REFUND_MIRROR_ID_SUFFIX } } }],
  };
}
