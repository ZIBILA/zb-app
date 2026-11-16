/**
 * One order status everywhere: a checkout the shopper closed must never make a paid order look cancelled
 * (website / app / dashboard / customer messages), and old damage is repaired.
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/order-status-consistency-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test' });
import prisma, { db } from './memory-prisma';
import { IS_CANCELLED_WHERE, WAS_PLACED_WHERE, isOrderCancelled, cancellationSource, isStandaloneMirrorAnOrder } from '../../lib/order-filters';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`); };
const o = (id: string, extra: Record<string, any>) => (db.order ||= []).push({
  id, status: 'approved', paymentStatus: 'paid', paymentMethod: 'razorpay', orderType: 'WEB_STORE', fulfillmentStatus: 'unfulfilled',
  deliveryStatus: 'pending', cancelledAt: null, cancelledBy: null, refundStatus: 'not_applicable', codUpfrontPaid: 0, tags: '',
  shopifyOrderId: null, refundId: null, paymentCapturedAt: null,
  createdAt: new Date(), updatedAt: new Date(), ...extra,
});
const get = (id: string) => db.order.find((x) => x.id === id)!;

async function main() {
  // These scenarios act on pre-built data, so the go-live marker is set far in the past (go-live-run.ts proves history is skipped).
  (db.customerEventDelivery ||= []).push({ id: 'gl_seed', eventKey: '__fixes_go_live__', channel: 'system', eventType: 'SCANNER_INIT', status: 'sent', createdAt: new Date(0), updatedAt: new Date(0) });
  // The incident: shopper closes the Razorpay window (attempt 1 cancelled), pays on retry (attempt 2 shipped).
  o('attempt1', { internalOrderNumber: 'ZBPP90010', razorpayOrderId: 'order_A', status: 'cancelled', paymentStatus: 'cancelled', cancelledBy: 'customer', cancelledAt: new Date() });
  o('attempt2', { internalOrderNumber: 'ZB81700', razorpayOrderId: 'order_B', deliveryStatus: 'shipped' });
  const mirror1 = { orderNumber: 'ZBPP90010', razorpayOrderId: 'order_A', paymentStatus: 'cancelled' };
  const known = { orderNumbers: new Set(['ZBPP90010', 'ZB81700']), razorpayOrderIds: new Set(['order_A', 'order_B']) };
  check('C1 the closed attempt\'s mirror is not shown as a separate CANCELLED order', !isStandaloneMirrorAnOrder(mirror1, known));
  check('C2 …even when its order row was not loaded (attempt number, never paid)', !isStandaloneMirrorAnOrder(mirror1, { orderNumbers: new Set(), razorpayOrderIds: new Set() }));
  check('C3 a paid legacy web order with no order row is still shown', isStandaloneMirrorAnOrder({ orderNumber: 'ZB70001', paymentStatus: 'paid' }, { orderNumbers: new Set(), razorpayOrderIds: new Set() }));
  check('C4 the shipped order is not cancelled', !isOrderCancelled(get('attempt2')));

  // UPI race on ONE order: window closed while paying, capture arrived after → paid + leftover cancel marks.
  o('race', { internalOrderNumber: 'ZB81701', razorpayOrderId: 'order_C', status: 'cancelled', paymentStatus: 'paid', cancelledBy: 'customer', cancelledAt: new Date(), fulfillmentStatus: 'cancelled', deliveryStatus: 'cancelled' });
  (db.webStoreOrder ||= []).push({ id: 'w_race', orderNumber: 'ZB81701', razorpayOrderId: 'order_C', paymentStatus: 'cancelled' });
  check('C5 a paid order is never "cancelled" because the checkout window was closed', !isOrderCancelled(get('race')) && cancellationSource(get('race')) === null);
  const listed = await (prisma as any).order.findMany({ where: { AND: [IS_CANCELLED_WHERE] } });
  check('C6 …and the dashboard Cancelled filter agrees', !listed.some((r: any) => r.id === 'race'));

  // Real cancellations stay cancelled.
  o('admin_cancel', { internalOrderNumber: 'ZBCC90020', status: 'cancelled', paymentStatus: 'refunded', cancelledBy: 'admin', cancelledAt: new Date() });
  o('cust_cancel', { internalOrderNumber: 'ZB81702', status: 'cancelled', paymentStatus: 'paid', cancelledBy: 'user', cancelledAt: new Date() });
  check('C7 admin and customer cancellations of placed orders are cancelled, with their source',
    isOrderCancelled(get('admin_cancel')) && cancellationSource(get('admin_cancel')) === 'admin' && isOrderCancelled(get('cust_cancel')) && cancellationSource(get('cust_cancel')) === 'customer');

  // A voided AWB on a live order.
  o('voided', { internalOrderNumber: 'ZB81703', deliveryStatus: 'cancelled' });
  check('C8 a voided AWB alone never makes an order "cancelled" (no cancellation email / badge)', !isOrderCancelled(get('voided')));

  // An abandoned checkout is not a placed order, so no "order cancelled" WhatsApp.
  const toMessage = await (prisma as any).order.findMany({ where: { AND: [IS_CANCELLED_WHERE, WAS_PLACED_WHERE] } });
  check('C9 cancellation messages go only to placed-then-cancelled orders', !toMessage.some((r: any) => r.id === 'attempt1') && toMessage.some((r: any) => r.id === 'admin_cancel'));

  // Repair of past damage.
  const { repairPaidOrderStatuses } = await import('../../lib/services/razorpaySyncService');
  await repairPaidOrderStatuses();
  const r = get('race');
  check('C10 repair: the paid order wrongly marked cancelled is live again', r.status === 'approved' && r.cancelledBy === null && r.cancelledAt === null && r.fulfillmentStatus === 'unfulfilled' && r.deliveryStatus === 'pending', JSON.stringify(r));
  check('C11 repair: its WebStoreOrder mirror now says paid', db.webStoreOrder.find((w) => w.id === 'w_race')!.paymentStatus === 'paid');
  check('C12 repair never touches a real cancellation', get('admin_cancel').status === 'cancelled' && get('cust_cancel').status === 'cancelled');
  check('C13 repair leaves the unpaid closed checkout as it is', get('attempt1').status === 'cancelled');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
