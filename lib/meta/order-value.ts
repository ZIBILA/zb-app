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
