/**
 * COD upfront (commitment) fee helpers.
 *
 * Rules:
 * - At charge time: use Shop.codUpfrontAmount (dashboard-configurable).
 * - After payment: lock the paid amount on the order (codUpfrontPaid).
 * - At logistics/Shopify: balanceDue = max(0, total - paid). Never re-read current settings for old orders.
 */

export const DEFAULT_COD_UPFRONT_AMOUNT = 99;

/** Normalize a candidate fee to a safe positive INR amount. */
export function normalizeCodUpfrontAmount(value: unknown, fallback = DEFAULT_COD_UPFRONT_AMOUNT): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 100) / 100;
}

/** Remaining COD collectable at delivery. */
export function getCodBalanceDue(orderTotal: unknown, upfrontPaid: unknown): number {
  const total = Number(orderTotal) || 0;
  const paid = Number(upfrontPaid) || 0;
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

/**
 * Shiprocket COD fields.
 * Prefer itemsSubtotal as sub_total so it matches order_items; total_discount absorbs
 * coupons + COD upfront so collectable = sub_total − total_discount = orderTotal − upfront.
 */
export function buildShiprocketPaymentFields(opts: {
  orderTotal: unknown;
  /** Sum of line item price × qty (should match order_items selling_price × units). */
  itemsSubtotal?: unknown;
  upfrontPaid?: unknown;
  isCod: boolean;
}): {
  payment_method: 'COD' | 'Prepaid';
  sub_total: number;
  total_discount?: number;
  shiprocketCollectable: number;
  codBalanceDue: number;
  upfrontPaid: number;
} {
  const orderTotal = Math.max(0, Number(opts.orderTotal) || 0);
  const itemsSum = Math.round(
    Math.max(0, Number(opts.itemsSubtotal) || orderTotal)
  );
  const upfrontPaid = opts.isCod ? Math.max(0, Number(opts.upfrontPaid) || 0) : 0;
  const codBalanceDue = opts.isCod ? getCodBalanceDue(orderTotal, upfrontPaid) : 0;

  if (opts.isCod && codBalanceDue > 0) {
    const collectable = Math.round(codBalanceDue);
    // Prefer line-item sum as sub_total; discount bridges to collectable
    const sub_total = Math.max(itemsSum, collectable);
    const discount = Math.max(0, sub_total - collectable);
    return {
      payment_method: 'COD',
      sub_total,
      ...(discount > 0 ? { total_discount: discount } : {}),
      shiprocketCollectable: collectable,
      codBalanceDue,
      upfrontPaid,
    };
  }

  const prepaidSub = itemsSum > 0 ? itemsSum : Math.round(orderTotal);
  const prepaidDiscount = Math.max(0, prepaidSub - Math.round(orderTotal));
  return {
    payment_method: 'Prepaid',
    sub_total: prepaidSub,
    ...(prepaidDiscount > 0 ? { total_discount: prepaidDiscount } : {}),
    shiprocketCollectable: 0,
    codBalanceDue: 0,
    upfrontPaid,
  };
}

/**
 * Resolve the fee that should be charged for a *new* COD checkout.
 * Prefers DB Shop setting; falls back to DEFAULT.
 */
export async function getConfiguredCodUpfrontAmount(): Promise<number> {
  try {
    const { getShopSettings } = await import('@/lib/db');
    const settings = await getShopSettings();
    return normalizeCodUpfrontAmount(
      (settings as any)?.codUpfrontAmount,
      DEFAULT_COD_UPFRONT_AMOUNT
    );
  } catch {
    return DEFAULT_COD_UPFRONT_AMOUNT;
  }
}

/**
 * Resolve the upfront already paid on an existing order.
 * Prefers stored order fields; only falls back to configured amount when status
 * clearly indicates COD upfront was collected AND a Razorpay payment id exists.
 * Status alone must never invent a paid amount (that caused false "₹99 paid" badges).
 */
export function resolveStoredCodUpfrontPaid(opts: {
  storedPaid?: unknown;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  tags?: string | null;
  note?: string | null;
  /** Razorpay payment id — required for status-based fallback */
  paymentId?: string | null;
  configuredFallback?: number;
}): number {
  const stored = Number(opts.storedPaid);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored * 100) / 100;

  const rawMethod = (opts.paymentMethod || '').toLowerCase();
  const tagsLower = (opts.tags || '').toLowerCase();
  const noteLower = (opts.note || '').toLowerCase();
  const pStat = (opts.paymentStatus || '').toLowerCase();
  const isCod =
    rawMethod === 'cod' ||
    tagsLower.includes('cod') ||
    noteLower.includes('cod order') ||
    noteLower.includes('upfront fee paid');

  const hasPaymentProof =
    typeof opts.paymentId === 'string' && /^pay_[A-Za-z0-9]+$/.test(opts.paymentId);

  if (
    isCod &&
    hasPaymentProof &&
    (pStat === 'cod_upfront_paid' || pStat === 'partially_paid' || pStat === 'paid')
  ) {
    return normalizeCodUpfrontAmount(opts.configuredFallback, DEFAULT_COD_UPFRONT_AMOUNT);
  }

  return 0;
}
