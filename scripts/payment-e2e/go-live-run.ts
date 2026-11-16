/**
 * Deploying must change the FUTURE only: nothing that happened before go-live is refunded, credited, repaired, synced
 * to Shopify, reminded or messaged by the new automations.
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/go-live-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test', SHOPIFY_STORE_DOMAIN: 'test-shop.myshopify.com', SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test' });
import prisma, { db } from './memory-prisma';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`); };
const H = 3600 * 1000;
const ago = (h: number) => new Date(Date.now() - h * H);

// Fetch calls to Shopify / Razorpay are recorded: none may happen for history.
const shopifyCalls: string[] = [];
(globalThis as any).fetch = async (url: string) => { shopifyCalls.push(String(url)); return new Response('{}', { status: 200 }); };

const rzpCalls: string[] = [];
const rzp: any = { payments: { fetch: async (id: string) => ({ id, amount: 100000, amount_refunded: 0, status: 'captured', currency: 'INR' }), refund: async (id: string) => { rzpCalls.push(id); return { id: 'rfnd_x' }; } } };

async function main() {
  // Go-live happens NOW (first read creates the marker).
  const { getGoLive } = await import('../../lib/go-live');
  const goLive = await getGoLive();
  check('G0 go-live is fixed at the first moment a job asks, and stays', (await getGoLive()).getTime() === goLive.getTime());

  const base = { status: 'cancelled', paymentStatus: 'paid', paymentMethod: 'razorpay', refundStatus: 'failed', refundAttempts: 1, totalPrice: 1000, storeCreditAmount: 0, currency: 'INR', note: null, tags: '', customerId: 'c1', orderType: 'WEB_STORE', fulfillmentStatus: 'unfulfilled', deliveryStatus: 'pending' };
  (db.customer ||= []).push({ id: 'c1', storeCredits: 0 });
  const old = { ...base, id: 'old_cancel', internalOrderNumber: 'ZB1', razorpayPaymentId: 'pay_old', cancelledAt: ago(48), createdAt: ago(72), updatedAt: ago(1) };
  const fresh = { ...base, id: 'new_cancel', internalOrderNumber: 'ZB2', razorpayPaymentId: 'pay_new', cancelledAt: new Date(Date.now() + 1000), createdAt: new Date(), updatedAt: ago(1) };
  (db.order ||= []).push(old, fresh);

  const { retryFailedRefunds, processOrderRefund } = await import('../../lib/services/refundService');
  await retryFailedRefunds({ limit: 50, razorpay: rzp });
  check('G1 the retry job never refunds an order cancelled before go-live', !rzpCalls.includes('pay_old') && db.order.find((o) => o.id === 'old_cancel')!.refundStatus === 'failed');
  const auto = await processOrderRefund('old_cancel', 'cron', { razorpay: rzp });
  check('G2 no webhook / bulk sync / background path refunds it either, and it is left untouched', auto.success && !rzpCalls.includes('pay_old') && db.order.find((o) => o.id === 'old_cancel')!.refundStatus === 'failed');
  const manual = await processOrderRefund('old_cancel', 'admin@zicabella.com', { razorpay: rzp });
  check('G3 an admin pressing "Retry refund" on it still can (explicit action)', manual.success && rzpCalls.includes('pay_old'));
  const newer = await processOrderRefund('new_cancel', 'system', { razorpay: rzp });
  check('G4 a cancellation after go-live is refunded automatically', newer.success && rzpCalls.includes('pay_new'));

  // cashback sweep
  (db.webStoreCoupon ||= []).push({ id: 'cp', code: 'PREPAID10', isActive: true, discountType: 'percentage', discountValue: 10, applicability: 'PREPAID_ONLY', cashbackEnabled: true, cashbackType: 'percentage', cashbackValue: 10, usageLimit: 0, usedCount: 0, minOrderValue: 0 });
  const paid = { id: '', status: 'approved', paymentStatus: 'paid', paymentMethod: 'razorpay', orderType: 'WEB_STORE', discountCode: 'PREPAID10', subtotalPrice: 1000, customerId: 'c1' };
  db.order.push({ ...paid, id: 'old_paid', createdAt: ago(24), updatedAt: new Date() }, { ...paid, id: 'new_paid', createdAt: new Date(Date.now() + 1000), updatedAt: new Date() });
  const { issueMissingCouponCashback } = await import('../../lib/storeCreditsHelper');
  await issueMissingCouponCashback();
  const credited = (id: string) => (db.storeCredit || []).some((c) => c.orderId === id);
  check('G5 cashback is never issued for an order placed before go-live', !credited('old_paid'));
  check('G6 …but is for one placed after', credited('new_paid'));

  // status repair
  const race = { status: 'cancelled', paymentStatus: 'paid', paymentMethod: 'razorpay', orderType: 'WEB_STORE', cancelledBy: 'customer', fulfillmentStatus: 'cancelled', deliveryStatus: 'cancelled', refundStatus: 'not_applicable', tags: '' };
  db.order.push({ ...race, id: 'old_race', razorpayOrderId: 'order_o', paymentCapturedAt: ago(10), createdAt: ago(12), updatedAt: new Date(), cancelledAt: ago(10) }, { ...race, id: 'new_race', razorpayOrderId: 'order_n', paymentCapturedAt: new Date(Date.now() + 1000), createdAt: new Date(), updatedAt: new Date(), cancelledAt: new Date() });
  const { repairPaidOrderStatuses } = await import('../../lib/services/razorpaySyncService');
  await repairPaidOrderStatuses();
  check('G7 an order paid before go-live is never repaired automatically', db.order.find((o) => o.id === 'old_race')!.status === 'cancelled');
  check('G8 an order paid after go-live is', db.order.find((o) => o.id === 'new_race')!.status === 'approved');

  // Shopify sync job
  db.order.push({ id: 'old_ship', shopifyOrderId: '555', status: 'approved', paymentStatus: 'paid', paymentMethod: 'razorpay', orderType: 'WEB_STORE', createdAt: ago(48), updatedAt: new Date(), deliveryStatus: 'delivered' });
  (db.shipment ||= []).push({ id: 's1', orderId: 'old_ship', awb: 'AWB9', status: 'delivered', type: 'outbound', createdAt: ago(40), updatedAt: new Date() });
  shopifyCalls.length = 0;
  const { syncRecentOrderLifecyclesToShopify } = await import('../../lib/services/shopifyLifecycleSync');
  const r = await syncRecentOrderLifecyclesToShopify();
  check('G9 the automatic Shopify sync does not touch an order placed before go-live (no Shopify call at all)', r.scanned === 0 && shopifyCalls.length === 0, JSON.stringify(r));

  // Customer messages: an order cancelled before go-live gets no message; one cancelled after does.
  const sent: string[] = [];
  const mkOrder = (id: string, ref: string, when: Date) => db.order.push({
    id, internalOrderNumber: ref, status: 'cancelled', paymentStatus: 'paid', paymentMethod: 'razorpay', orderType: 'WEB_STORE', customerId: 'c2',
    createdAt: ago(72), updatedAt: when, cancelledAt: when, shippingAddress: null, deliveryStatus: 'cancelled', fulfillmentStatus: 'cancelled', refundStatus: 'not_applicable', tags: '',
  });
  (db.customer ||= []).push({ id: 'c2', name: 'Asha', phone: '9876543210', storeCredits: 0 });
  mkOrder('msg_old', 'ZB900', ago(5));
  mkOrder('msg_new', 'ZB901', new Date(Date.now() + 2000));
  const { scanWhatsAppEvents } = await import('../../lib/notifications/whatsapp-events');
  await scanWhatsAppEvents(new Date(Date.now() + 5000), {
    isEnabled: async (k) => k === 'order_cancelled_enabled',
    send: { orderCancelled: async (a: any) => { sent.push(a.orderId); return { success: true }; } } as any,
  });
  check('G10 no "order cancelled" message for an order cancelled before go-live', !sent.includes('ZB900'), JSON.stringify(sent));
  check('G11 …but one for an order cancelled after', sent.includes('ZB901'), JSON.stringify(sent));

  // Cart reminders: a cart left before go-live is never reminded.
  (db.cart ||= []).push({ id: 'cart_old', status: 'active', phone: '9876500099', phoneLast10: '9876500099', customerId: null, email: null, convertedOrderId: null, subtotal: 999, createdAt: ago(3), lastActivityAt: ago(2) });
  (db.cartItem ||= []).push({ id: 'ci_old', cartId: 'cart_old', title: 'Shirt', image: '', handle: 'shirt', productId: null });
  const { runWhatsAppScheduler } = await import('../../lib/whatsapp/scheduler');
  await runWhatsAppScheduler();
  check('G12 a cart left before go-live gets no reminder', !(db.whatsAppMessage || []).some((m: any) => m.cartId === 'cart_old'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
