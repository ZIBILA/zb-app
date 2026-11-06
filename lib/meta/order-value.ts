/**
 * The ONE definition of a Meta Purchase's value + currency, shared by the browser
 * Pixel (app/orders/[id]/confirmation) and the server CAPI (lib/meta/purchase.ts),
 * so both always report the same confirmed net order total.
 *
 *   value    = Order.totalPrice = products − coupon − redeemed store credit
 *              (store credit is a discount; COD upfront is NOT deducted — it only
 *              splits how the same sale is paid). 100% store credit → 0.
 *   currency = Order.currency, the currency that total is stored and charged in.
 *
 * Isomorphic (browser + server), no imports.
 */
export function metaPurchaseValue(order: { totalPrice?: unknown } | null | undefined): number | null {
  const v = Number(order?.totalPrice);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
}

export function metaPurchaseCurrency(order: { currency?: unknown } | null | undefined): string {
  const c = String(order?.currency || 'INR').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : 'INR';
}

/** Website orders only. Native app, exchange and Shopify-synced orders are not website Purchases. */
export const WEBSITE_ORDER_TYPES = new Set(['WEB_STORE']);

export function isWebsiteOrder(order: { orderType?: unknown } | null | undefined): boolean {
  const t = String(order?.orderType || '').trim().toUpperCase();
  return t === '' || WEBSITE_ORDER_TYPES.has(t);
}

// ── Paid-like payment states ────────────────────────────────────────────────

/**
 * Payment states in which the money for a sale has been collected, so a Purchase
 * may be reported (the tracking view of lib/payment-status.ts PAID_LIKE_STATUSES):
 *
 *   paid              prepaid capture confirmed
 *   cod_upfront_paid  COD with the upfront fee captured
 *   partially_paid    two different things share this word:
 *                     (a) the SAME COD order a little later: its Shopify mirror is
 *                         created with financial_status "partially_paid"
 *                         (lib/services/shopifyOrderSyncService.ts) and Shopify's
 *                         orders/create|updated webhook writes that status back onto
 *                         the local order (app/api/shopify/webhooks). Still the one
 *                         COD sale — a conversion.
 *                     (b) a prepaid order captured for LESS than its total, parked
 *                         with needs_review. Not a conversion until it becomes paid.
 *
 * Before this helper the Purchase emitters accepted only paid / cod_upfront_paid, so
 * a COD order confirmed by the reconciliation cron AFTER Shopify had written
 * partially_paid back (and a confirmation page opened after that moment) never
 * produced a Meta or Snap Purchase, and the recovery scans never looked at it.
 *
 * Isomorphic, no imports: shared by the browser decision (lib/meta/browser-purchase.ts),
 * the Meta and Snap server emitters and their recovery scans.
 */
export const PURCHASE_PAID_STATUSES: ReadonlySet<string> = new Set(['paid', 'cod_upfront_paid']);

/** Statuses a database scan for reportable orders must read; filter the rows with isPurchasePaidStatus. */
export const PURCHASE_SCAN_STATUSES: readonly string[] = ['paid', 'cod_upfront_paid', 'partially_paid'];

export interface PurchasePaymentFacts {
  paymentStatus?: unknown;
  paymentMethod?: unknown;
  codUpfrontPaid?: unknown;
  codUpfrontPaymentId?: unknown;
  tags?: unknown;
}

/** true for a cash-on-delivery order whose upfront fee was collected (any of the stored markers). */
export function isCodUpfrontOrder(order: PurchasePaymentFacts | null | undefined): boolean {
  if (!order) return false;
  const method = String(order.paymentMethod || '').trim();
  if (/(^|[^a-z])cod([^a-z]|$)|cash[ _-]?on[ _-]?delivery/i.test(method)) return true;
  if (Number(order.codUpfrontPaid) > 0) return true;
  if (String(order.codUpfrontPaymentId || '').trim()) return true;
  const tags = String(order.tags || '').toLowerCase().split(',').map(t => t.trim());
  return tags.includes('cod_upfront_paid');
}

/** true when the order's payment state represents a completed sale (see PURCHASE_PAID_STATUSES). */
export function isPurchasePaidStatus(order: PurchasePaymentFacts | null | undefined): boolean {
  const status = String(order?.paymentStatus || '').trim().toLowerCase();
  if (PURCHASE_PAID_STATUSES.has(status)) return true;
  return status === 'partially_paid' && isCodUpfrontOrder(order);
}
