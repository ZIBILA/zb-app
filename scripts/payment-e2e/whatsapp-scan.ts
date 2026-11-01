/**
 * WhatsApp lifecycle scanner scenarios (no Meta / no credentials): in-memory Prisma + fake senders.
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/whatsapp-scan.ts
 */
Object.assign(process.env, { NODE_ENV: 'test' });

import { db } from './memory-prisma';

type Call = { event: string; args: any };
const calls: Call[] = [];
const failures: Record<string, number> = {};
const sender = (event: string) => async (args: any) => {
  if (failures[event] > 0) { failures[event] -= 1; return { success: false, error: 'simulated Meta error' }; }
  calls.push({ event, args });
  return { success: true };
};
const senders = {
  shipped: sender('shipped'), outForDelivery: sender('outForDelivery'), delivered: sender('delivered'),
  orderCancelled: sender('orderCancelled'), refundInitiated: sender('refundInitiated'),
  returnAccepted: sender('returnAccepted'), returnReceived: sender('returnReceived'),
  exchangeDelivered: sender('exchangeDelivered'), storeCreditEarned: sender('storeCreditEarned'),
  storeCoinsEarned: sender('storeCoinsEarned'),
};

let pass = 0, fail = 0;
const results: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`;
  results.push(line);
  console.log(line);
}
const sent = (event: string, pred: (a: any) => boolean = () => true) => calls.filter(c => c.event === event && pred(c.args)).length;

const ago = (ms: number) => new Date(Date.now() - ms);
const DAY = 24 * 3600 * 1000;
let seq = 0;
const PHONE = '9876543210';

function customer(extra: any = {}) {
  const id = `cust${++seq}`;
  db.customer ||= [];
  db.customer.push({ id, name: `Cust ${seq}`, phone: PHONE, email: `c${seq}@t.test`, createdAt: new Date(), updatedAt: new Date(), ...extra });
  return id;
}
function order(extra: any = {}) {
  const id = `ord${++seq}`;
  const row = {
    id, internalOrderNumber: `ZB9${seq}`, customerId: extra.customerId ?? customer(), status: 'confirmed',
    paymentStatus: 'paid', paymentMethod: 'razorpay', orderType: 'REGULAR', totalPrice: 1000,
    deliveryStatus: 'pending', refundStatus: 'not_applicable', shippingAddress: null,
    createdAt: new Date(), updatedAt: new Date(), ...extra,
  };
  db.order ||= [];
  db.order.push(row);
  return row;
}
const add = (model: string, row: any) => { (db[model] ||= []).push({ id: `${model}${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...row }); return db[model][db[model].length - 1]; };

async function main() {
  const { scanWhatsAppEvents } = await import('@/lib/notifications/whatsapp-events');
  const all = async (key: string) => true;
  const scan = (isEnabled: (k: string) => Promise<boolean> = all) => scanWhatsAppEvents(new Date(), { send: senders as any, isEnabled });

  // ── Old activity that exists BEFORE the first run must never be messaged ──
  const old = order({ deliveryStatus: 'delivered', updatedAt: ago(60_000), deliveredAt: ago(60_000) });
  const oldCancelled = order({ status: 'cancelled', cancelledAt: ago(60_000), updatedAt: ago(60_000) });
  await new Promise(r => setTimeout(r, 20));
  await scan(); // first run: sets the start marker
  check('A1 first run sends nothing for orders that were already delivered / cancelled', calls.length === 0, JSON.stringify(calls.map(c => c.event)));
  await new Promise(r => setTimeout(r, 20));

  // ── Order flow ──
  const delivered = order({ deliveryStatus: 'delivered', deliveredAt: new Date() });
  const ofd = order({ deliveryStatus: 'out_for_delivery' });
  const shipped = order({ deliveryStatus: 'picked_up' });
  add('shipment', { orderId: shipped.id, type: 'outbound', awb: 'AWB123456', trackingUrl: 'https://track.test/AWB123456' });
  const shippedNoAwb = order({ deliveryStatus: 'picked_up' });
  const noPhone = order({ deliveryStatus: 'delivered', customerId: customer({ phone: '' }) });
  await scan();
  check('B1 delivered → one message with the order number', sent('delivered', a => a.orderId === delivered.internalOrderNumber) === 1);
  check('B2 out for delivery → one message', sent('outForDelivery', a => a.orderId === ofd.internalOrderNumber) === 1);
  const sh = calls.find(c => c.event === 'shipped' && c.args.orderId === shipped.internalOrderNumber);
  check('B3 picked up → message carries the AWB and tracking link', !!sh && sh.args.trackingNumber === 'AWB123456' && sh.args.trackingUrl.includes('AWB123456'), JSON.stringify(sh?.args));
  check('B4 picked up with NO tracking number → nothing sent', sent('shipped', a => a.orderId === shippedNoAwb.internalOrderNumber) === 0);
  check('B5 delivered with NO phone → nothing sent', sent('delivered', a => a.orderId === noPhone.internalOrderNumber) === 0);
  check('B6 the order delivered before the first run was not messaged', sent('delivered', a => a.orderId === old.internalOrderNumber) === 0);
  const before = calls.length;
  await scan(); await scan();
  check('B7 running the scanner again sends nothing new (duplicate protection)', calls.length === before, `${calls.length - before} extra`);

  // ── Cancellation vs refund ──
  const cancelled = order({ status: 'cancelled', cancelledAt: new Date() });
  const refunded = order({ refundStatus: 'completed', refundId: 'rfnd_1' });
  add('payment', { orderId: refunded.id, type: 'refund', status: 'completed', amount: 750 });
  const refundZero = order({ refundStatus: 'completed', refundId: 'rfnd_0' });
  add('payment', { orderId: refundZero.id, type: 'refund', status: 'completed', amount: 0 });
  await scan();
  check('C1 cancelled order → cancellation message', sent('orderCancelled', a => a.orderId === cancelled.internalOrderNumber) === 1);
  check('C2 cancelled order with no refund → NO refund message', sent('refundInitiated', a => a.orderId === cancelled.internalOrderNumber) === 0);
  const rf = calls.find(c => c.event === 'refundInitiated' && c.args.orderId === refunded.internalOrderNumber);
  check('C3 completed refund → one refund message with the real amount', !!rf && rf.args.refundAmount === 750, JSON.stringify(rf?.args));
  check('C4 refund recorded as ₹0 → no message', sent('refundInitiated', a => a.orderId === refundZero.internalOrderNumber) === 0);
  check('C5 the order cancelled before the first run was not messaged', sent('orderCancelled', a => a.orderId === oldCancelled.internalOrderNumber) === 0);

  // ── Returns ──
  const rOrder = order();
  const retApproved = add('returnRequest', { orderId: rOrder.id, status: 'approved', estimatedRefund: 800, receivedAt: null, refundReleasedAt: null });
  const rOrder2 = order();
  add('returnRequest', { orderId: rOrder2.id, status: 'approved', estimatedRefund: null, actualRefund: null, receivedAt: null, refundReleasedAt: null });
  const rOrder3 = order();
  add('returnRequest', { orderId: rOrder3.id, status: 'received', receivedAt: new Date(), estimatedRefund: 300, refundReleasedAt: null });
  const rOrder4 = order();
  const mirror = add('returnRequest', { orderId: rOrder4.id, status: 'approved', estimatedRefund: 500, reason: 'EXCHANGE_RETURN', receivedAt: null, refundReleasedAt: null });
  add('exchangeRequest', { orderId: rOrder4.id, returnRequestId: mirror.id, status: 'approved' });
  await scan();
  const ra = calls.find(c => c.event === 'returnAccepted' && c.args.orderId === rOrder.internalOrderNumber);
  check('D1 approved return → acceptance message with the refund amount', !!ra && /800/.test(String(ra.args.refundAmount)), JSON.stringify(ra?.args));
  check('D2 approved return with unknown refund amount → nothing sent', sent('returnAccepted', a => a.orderId === rOrder2.internalOrderNumber) === 0);
  check('D3 received return → warehouse message', sent('returnReceived', a => a.orderId === rOrder3.internalOrderNumber) === 1);
  check('D4 the internal return created by an exchange sends no return message', sent('returnAccepted', a => a.orderId === rOrder4.internalOrderNumber) === 0 && sent('returnReceived', a => a.orderId === rOrder4.internalOrderNumber) === 0);
  retApproved.status = 'received'; retApproved.receivedAt = new Date(); retApproved.updatedAt = new Date();
  await scan();
  check('D5 same return later received → received message once, acceptance not repeated', sent('returnReceived', a => a.orderId === rOrder.internalOrderNumber) === 1 && sent('returnAccepted', a => a.orderId === rOrder.internalOrderNumber) === 1);

  // ── Exchange delivered ──
  const exOrig = order();
  const replacement = order({ orderType: 'EXCHANGE', deliveryStatus: 'delivered', internalOrderNumber: 'G_E_TEST_1' });
  add('exchangeRequest', { orderId: exOrig.id, replacementOrderId: replacement.id, replacementDisplayId: 'G_E_TEST_1', status: 'new_order_created' });
  await scan(); await scan();
  check('E1 replacement delivered → exactly one exchange-delivered message', sent('exchangeDelivered', a => a.orderId === 'G_E_TEST_1') === 1);

  // ── Store credit (prepaid) and coins (COD) ──
  const prepaid = order({ paymentMethod: 'razorpay', paymentStatus: 'paid' });
  add('storeCredit', { orderId: prepaid.id, type: 'COUPON_REBATE', amount: 150 });
  const codCredit = order({ paymentMethod: 'COD', paymentStatus: 'partially_paid' });
  add('storeCredit', { orderId: codCredit.id, type: 'PENDING_COUPON_REBATE', amount: 99 });
  const codDeliveredNoRebate = order({ paymentMethod: 'COD', deliveryStatus: 'delivered', deliveredAt: new Date() });
  const codDelivered = order({ paymentMethod: 'COD', deliveryStatus: 'delivered', deliveredAt: new Date() });
  add('storeCredit', { orderId: codDelivered.id, type: 'COUPON_REBATE', amount: 120 });
  const prepaidDelivered = order({ paymentMethod: 'razorpay', deliveryStatus: 'delivered', deliveredAt: new Date() });
  add('storeCredit', { orderId: prepaidDelivered.id, type: 'COUPON_REBATE', amount: 80 });
  await scan();
  const sc = calls.find(c => c.event === 'storeCreditEarned' && c.args.orderId === prepaid.internalOrderNumber);
  check('F1 prepaid paid order → Store Credit message with the credited amount', !!sc && sc.args.creditAmount === 150, JSON.stringify(sc?.args));
  check('F2 COD order never gets the Store Credit message', sent('storeCreditEarned', a => a.orderId === codCredit.internalOrderNumber) === 0);
  const sk = calls.find(c => c.event === 'storeCoinsEarned' && c.args.orderId === codDelivered.internalOrderNumber);
  check('F3 COD delivered with coins released → Store Coins message with the amount', !!sk && sk.args.coinsAmount === 120, JSON.stringify(sk?.args));
  check('F4 COD delivered but no coins released → no coins message', sent('storeCoinsEarned', a => a.orderId === codDeliveredNoRebate.internalOrderNumber) === 0);
  check('F5 COD not yet delivered (pending cashback) → no coins message', sent('storeCoinsEarned', a => a.orderId === codCredit.internalOrderNumber) === 0);
  check('F6 prepaid order delivered → no coins message', sent('storeCoinsEarned', a => a.orderId === prepaidDelivered.internalOrderNumber) === 0);

  // ── Toggles ──
  const offOrder = order({ status: 'cancelled', cancelledAt: new Date() });
  await scan(async (k) => k !== 'order_cancelled_enabled');
  check('G1 automation switched OFF → nothing sent', sent('orderCancelled', a => a.orderId === offOrder.internalOrderNumber) === 0);
  await scan();
  check('G2 switched ON later → the pending event is sent once', sent('orderCancelled', a => a.orderId === offOrder.internalOrderNumber) === 1);

  // ── Failed sends are retried, then given up ──
  const flaky = order({ status: 'cancelled', cancelledAt: new Date() });
  failures.orderCancelled = 2;
  const s1 = await scan();
  check('H1 Meta error → counted as failed, nothing recorded as sent', s1.failed >= 1 && sent('orderCancelled', a => a.orderId === flaky.internalOrderNumber) === 0, JSON.stringify(s1));
  await scan();
  await scan();
  check('H2 retried on later scans until it succeeds, then exactly once', sent('orderCancelled', a => a.orderId === flaky.internalOrderNumber) === 1);
  const dead = order({ status: 'cancelled', cancelledAt: new Date() });
  failures.orderCancelled = 99;
  for (let i = 0; i < 6; i++) await scan();
  const attemptsLeft = failures.orderCancelled;
  failures.orderCancelled = 0;
  check('H3 permanent failure stops after a few attempts (no endless retries)', 99 - attemptsLeft <= 3 && sent('orderCancelled', a => a.orderId === dead.internalOrderNumber) === 0, `attempts=${99 - attemptsLeft}`);

  // ── Two scanners running at the same moment ──
  const race = order({ deliveryStatus: 'out_for_delivery' });
  await Promise.all([scan(), scan(), scan()]);
  check('I1 three overlapping scans → still exactly one message', sent('outForDelivery', a => a.orderId === race.internalOrderNumber) === 1, `${sent('outForDelivery', a => a.orderId === race.internalOrderNumber)}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
