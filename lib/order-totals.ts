/**
 * Order totals when store credit is involved.
 *
 * Store credit is paid for out of the customer's wallet, so the amount charged (and the order total we keep) is
 * items - coupon - store credit. Shopify only knows about discounts it is sent: an order created without the
 * credit as a discount comes back from Shopify with a total that still includes it, and the webhook / sync that
 * copies Shopify's total onto our order used to put the full price back ("credit deducted, order total unchanged").
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The total to keep on our order, given the total Shopify reports.
 *
 * `shopifyTotal` already includes the store credit (credit was sent to Shopify as a discount): returned as is.
 * `shopifyTotal` equals items - coupon, i.e. Shopify never saw the credit (orders created before the credit was
 * sent as a discount): the credit is subtracted here.
 */
export function totalAfterStoreCredit(opts: {
  shopifyTotal: number;
  subtotal: number;
  discountAmount: number;
  storeCredit: number;
}): number {
  const { shopifyTotal, subtotal } = opts;
  const discountAmount = Number(opts.discountAmount) || 0;
  const storeCredit = Number(opts.storeCredit) || 0;
  if (!(storeCredit > 0)) return shopifyTotal;
  const beforeCredit = Math.max(0, subtotal - discountAmount);
  if (Math.abs(shopifyTotal - beforeCredit) < 0.01) return round2(Math.max(0, shopifyTotal - storeCredit));
  return shopifyTotal;
}

/**
 * Discount lines to send to Shopify for an order: the coupon and the store credit, as separate fixed-amount
 * discounts. For a ₹0 order, anything the two do not cover is added as `ZERO_TOTAL` so Shopify's total is 0.
 */
export function shopifyDiscountCodes(opts: {
  discountCode?: string | null;
  discountAmount?: number | null;
  storeCreditAmount?: number | null;
  lineTotal: number;
  zeroTotal: boolean;
}): Array<{ code: string; amount: string; type: 'fixed_amount' }> {
  const out: Array<{ code: string; amount: string; type: 'fixed_amount' }> = [];
  const coupon = Number(opts.discountAmount) || 0;
  const credit = Number(opts.storeCreditAmount) || 0;
  if (opts.discountCode && coupon > 0 && opts.discountCode !== 'STORE_CREDIT') {
    out.push({ code: opts.discountCode, amount: coupon.toFixed(2), type: 'fixed_amount' });
  }
  if (credit > 0) out.push({ code: 'STORE_CREDIT', amount: credit.toFixed(2), type: 'fixed_amount' });
  if (opts.zeroTotal && opts.lineTotal > 0) {
    const covered = out.reduce((sum, d) => sum + Number(d.amount), 0);
    const rest = round2(opts.lineTotal - covered);
    if (rest > 0.009) out.push({ code: opts.discountCode && opts.discountCode !== 'STORE_CREDIT' ? opts.discountCode : 'ZERO_TOTAL', amount: rest.toFixed(2), type: 'fixed_amount' });
  }
  return out;
}

/**
 * The total to store for a Shopify order being copied onto our order table (login / manual syncs): Shopify's total,
 * unless our own order for it recorded store credit that Shopify did not apply.
 */
export async function localOrderTotal(
  prisma: { order: { findUnique: (args: any) => Promise<any> } },
  shopifyOrder: any,
): Promise<number> {
  const shopifyTotal = parseFloat(shopifyOrder?.total_price || '0');
  try {
    const local = await prisma.order.findUnique({
      where: { shopifyOrderId: String(shopifyOrder?.id) },
      select: { storeCreditAmount: true, discountAmount: true },
    });
    if (!local || !(Number(local.storeCreditAmount) > 0)) return shopifyTotal;
    const subtotal = shopifyOrder?.total_line_items_price
      ? parseFloat(shopifyOrder.total_line_items_price)
      : parseFloat(shopifyOrder?.subtotal_price || shopifyOrder?.total_price || '0');
    return totalAfterStoreCredit({
      shopifyTotal,
      subtotal,
      discountAmount: Number(local.discountAmount) || 0,
      storeCredit: Number(local.storeCreditAmount) || 0,
    });
  } catch {
    return shopifyTotal;
  }
}
