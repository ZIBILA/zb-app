/**
 * Which orders the dashboard lists, and what "cancelled" means there.
 *
 * - "Placed" = the order really happened: payment captured / COD upfront paid / store credit or coupon paid, a refund
 *   was issued, or it reached Shopify. Failed payments, checkouts the shopper abandoned and never-paid orders that
 *   were then cancelled are never placed, even when they carry status "cancelled", so they never show up as
 *   cancelled orders.
 * - "Cancelled": see IS_CANCELLED_WHERE. The current payment status can't be used: a customer-cancelled COD order has
 *   its payment status overwritten with "cancelled".
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

/** Payment states meaning the money is in right now (not refunded). */
export const PAID_NOW_STATUSES = ['paid', 'PAID', 'success', 'SUCCESS', 'captured', 'cod_upfront_paid', 'partially_paid', 'partially-paid'];

/**
 * THE rule for "this order is cancelled", used by the dashboard, the website, the app and the customer messages
 * (each used to have its own, which is how a shipped order showed "Cancelled" to its customer).
 *
 *  - status cancelled (any spelling), a cancellation time, or fulfillmentStatus "cancelled" (written only by order
 *    cancellations; older Shopify-pull cancellations set only that, e.g. #ZB81437).
 *  - NOT deliveryStatus "cancelled" alone: a voided AWB writes it while the order is still live.
 *  - NOT a checkout the shopper "cancelled" (cancelledBy "customer", written by /api/checkout/cancel when the
 *    Razorpay window closes) whose payment then went through: closing the window after paying in the UPI app
 *    must never cancel a paid order.
 */
export const IS_CANCELLED_WHERE = {
  AND: [
    {
      OR: [
        { status: { in: CANCELLED_ORDER_STATUSES } },
        { cancelledAt: { not: null } },
        { fulfillmentStatus: { in: CANCELLED_ORDER_STATUSES } },
      ],
    },
    { OR: [{ cancelledBy: null }, { cancelledBy: { not: 'customer' } }, { paymentStatus: { notIn: PAID_NOW_STATUSES } }] },
  ],
};

export type OrderCancelFields = {
  status?: string | null;
  cancelledAt?: Date | string | null;
  cancelledBy?: string | null;
  fulfillmentStatus?: string | null;
  paymentStatus?: string | null;
  note?: string | null;
  internalOrderNumber?: string | null;
};

/** Same rule as IS_CANCELLED_WHERE, for one loaded order. */
export function isOrderCancelled(order: OrderCancelFields): boolean {
  const flagged =
    CANCELLED_ORDER_STATUSES.includes(String(order.status || '')) ||
    ['cancelled', 'canceled'].includes(String(order.status || '').toLowerCase()) ||
    Boolean(order.cancelledAt) ||
    ['cancelled', 'canceled'].includes(String(order.fulfillmentStatus || '').toLowerCase());
  if (!flagged) return false;
  const abandonedThenPaid =
    String(order.cancelledBy || '').toLowerCase() === 'customer' && PAID_NOW_STATUSES.includes(String(order.paymentStatus || ''));
  return !abandonedThenPaid;
}

export const WAS_PLACED_WHERE = {
  OR: [
    { paymentStatus: { in: PLACED_PAYMENT_STATUSES } },
    { paymentCapturedAt: { not: null } },
    { codUpfrontPaid: { gt: 0 } },
    { refundId: { not: null } },
    { refundStatus: 'completed' },
    // Who cancelled it is NOT evidence: a customer can cancel an order they never paid for (e.g. ZBPP01256231).
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
export function cancellationSource(order: OrderCancelFields): 'customer' | 'admin' | null {
  if (!isOrderCancelled(order)) return null;
  const by = String(order.cancelledBy || '').toLowerCase();
  if (by === 'admin' || by === 'shopify') return 'admin';
  if (by === 'user' || by === 'user_processed' || by === 'customer') return 'customer';
  if (/cancelled by user/i.test(String(order.note || ''))) return 'customer';
  if (String(order.internalOrderNumber || '').startsWith('ZBCC')) return 'admin';
  // Cancelled in Shopify (staff) and pulled in before the source was recorded.
  if (CANCELLED_ORDER_STATUSES.includes(String(order.fulfillmentStatus || '')) && !order.cancelledAt) return 'admin';
  return null;
}

/**
 * Customer order lists also read WebStoreOrder rows, the checkout-time mirror of an Order. Show one as its own order
 * only when no order of the customer (hidden abandoned attempts included) already stands for it, and it really was
 * an order: paid / refunded, or a cancelled order with a real order number. A checkout the shopper closed (attempt
 * number ZBPP / ZBPF / ZBCX / ZBXX, payment "cancelled" or still pending) is not an order; it used to appear as a
 * separate CANCELLED order next to the order the shopper then paid for.
 */
export function isStandaloneMirrorAnOrder(
  wso: { orderNumber?: string | null; razorpayOrderId?: string | null; paymentStatus?: string | null },
  known: { orderNumbers: Set<string>; razorpayOrderIds: Set<string> }
): boolean {
  const num = String(wso.orderNumber || '').trim().toUpperCase();
  if (num && known.orderNumbers.has(num)) return false;
  if (wso.razorpayOrderId && known.razorpayOrderIds.has(wso.razorpayOrderId)) return false;
  const payment = String(wso.paymentStatus || '').toLowerCase();
  if (['paid', 'cod_upfront_paid', 'partially_paid', 'success', 'captured', 'refunded', 'partially_refunded', 'partial_refund'].includes(payment)) return true;
  return ['cancelled', 'canceled'].includes(payment) && Boolean(num) && !/^ZB(PP|PF|CX|XX)/.test(num);
}
