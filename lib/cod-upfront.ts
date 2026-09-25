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
 * clearly indicates COD upfront was collected but the amount was never saved.
 */
export function resolveStoredCodUpfrontPaid(opts: {
  storedPaid?: unknown;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  tags?: string | null;
  note?: string | null;
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

  if (
    isCod &&
    (pStat === 'cod_upfront_paid' || pStat === 'partially_paid' || pStat === 'paid')
  ) {
    return normalizeCodUpfrontAmount(opts.configuredFallback, DEFAULT_COD_UPFRONT_AMOUNT);
  }

  return 0;
}
