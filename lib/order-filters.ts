/**
 * Which orders the dashboard lists, and what "cancelled" means there.
 *
 * - "Placed" = the order really happened: payment captured / COD upfront paid / store credit or coupon paid, a refund
 *   was issued, it reached Shopify, or staff / the customer cancelled a live order. Failed payments and checkouts the
 *   shopper abandoned are never placed, even when they carry status "cancelled" (the Razorpay "cancel" button writes
 *   that), so they never show up as cancelled orders.
 * - "Cancelled" = status cancelled (any spelling) or a cancellation time. The current payment status can't be used:
 *   a customer-cancelled COD order has its payment status overwritten with "cancelled".
 */

const PAID_LIKE = ['paid', 'PAID', 'success', 'SUCCESS'];
export const PLACED_PAYMENT_STATUSES = [
  ...PAID_LIKE,
  'captured',
  'cod_upfront_paid',
  'partially_paid',
  'partially-paid',
  'refunded',
  'REFUNDED',
  'partially_refunded',
  'PARTIALLY_REFUNDED',
  'partial_refund',
];
export const CANCELLED_ORDER_STATUSES = ['cancelled', 'CANCELLED', 'canceled', 'CANCELED', 'Cancelled'];
/** cancelledBy values written when a LIVE order is cancelled (checkout abandon writes "customer"). */
const LIVE_ORDER_CANCELLERS = ['admin', 'user', 'user_processed', 'shopify'];

/**
 * fulfillmentStatus "cancelled" is written only by order cancellations (admin, customer, Shopify cancel). Older
 * Shopify-pull cancellations set only that and deliveryStatus, leaving status active (e.g. #ZB81437), so it counts.
 * deliveryStatus "cancelled" alone does NOT: a voided AWB writes it while the order is still live.
 */
export const IS_CANCELLED_WHERE = {
  OR: [
    { status: { in: CANCELLED_ORDER_STATUSES } },
    { cancelledAt: { not: null } },
    { fulfillmentStatus: { in: CANCELLED_ORDER_STATUSES } },
  ],
};

export const WAS_PLACED_WHERE = {
  OR: [
    { paymentStatus: { in: PLACED_PAYMENT_STATUSES } },
    { paymentCapturedAt: { not: null } },
    { codUpfrontPaid: { gt: 0 } },
    { refundId: { not: null } },
    { refundStatus: 'completed' },
    { cancelledBy: { in: LIVE_ORDER_CANCELLERS } },
    {
      AND: [
        { shopifyOrderId: { not: null } },
        { NOT: { shopifyOrderId: { startsWith: 'app_pending' } } },
        { NOT: { shopifyOrderId: { startsWith: '#' } } },
      ],
    },
  ],
};

/** Records that are never real orders, whatever else they say. */
export const NEVER_PLACED_WHERE = {
  OR: [
    { internalOrderNumber: { startsWith: 'ZBPF' } },
    {
      AND: [
        { internalOrderNumber: { startsWith: 'ZBPP' } },
        { paymentStatus: { in: ['pending', 'payment_pending', 'failed', 'payment_failed'] } },
      ],
    },
    { AND: [{ orderType: 'MOBILE_APP' }, { status: 'awaiting_approval' }] },
    { status: { in: ['payment_failed', 'FAILED', 'failed'] } },
  ],
};

/** "Cancelled · Customer" / "Cancelled · Admin" for the dashboard; null when not cancelled or unknown. */
export function cancellationSource(order: {
  status?: string | null;
  cancelledAt?: Date | string | null;
  cancelledBy?: string | null;
  note?: string | null;
  internalOrderNumber?: string | null;
  fulfillmentStatus?: string | null;
}): 'customer' | 'admin' | null {
  const cancelled =
    CANCELLED_ORDER_STATUSES.includes(String(order.status || '')) ||
    Boolean(order.cancelledAt) ||
    CANCELLED_ORDER_STATUSES.includes(String(order.fulfillmentStatus || ''));
  if (!cancelled) return null;
  const by = String(order.cancelledBy || '').toLowerCase();
  if (by === 'admin' || by === 'shopify') return 'admin';
  if (by === 'user' || by === 'user_processed' || by === 'customer') return 'customer';
  if (/cancelled by user/i.test(String(order.note || ''))) return 'customer';
  if (String(order.internalOrderNumber || '').startsWith('ZBCC')) return 'admin';
  // Cancelled in Shopify (staff) and pulled in before the source was recorded.
  if (CANCELLED_ORDER_STATUSES.includes(String(order.fulfillmentStatus || '')) && !order.cancelledAt) return 'admin';
  return null;
}
