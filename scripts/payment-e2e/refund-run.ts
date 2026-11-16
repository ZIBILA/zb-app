/**
 * Automatic refunds of cancelled orders (lib/services/refundService.ts) against a fake Razorpay.
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/refund-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test' });

import { db } from './memory-prisma';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`);
}

// ── fake Razorpay ──
const payments: Record<string, { amount: number; amount_refunded: number; status: string; currency: string }> = {};
const refundCalls: Array<{ paymentId: string; amount: number }> = [];
let failNextRefund = 0;
const rzp = {
  payments: {
    fetch: async (id: string) => ({ id, ...payments[id] }),
    refund: async (id: string, params: any) => {
      if (failNextRefund > 0) { failNextRefund -= 1; throw { error: { description: 'The refund could not be processed (simulated)' } }; }
      refundCalls.push({ paymentId: id, amount: params.amount });
      payments[id].amount_refunded += params.amount;
      return { id: `rfnd_${refundCalls.length}`, amount: params.amount };
    },
  },
};

const customer = (id: string, credits = 0) => (db.customer ||= []).push({ id, storeCredits: credits });
function order(id: string, extra: Record<string, any>) {
  (db.order ||= []).push({
    id, customerId: 'c1', status: 'cancelled', paymentStatus: 'paid', paymentMethod: 'razorpay', refundStatus: 'not_applicable',
    refundAttempts: 0, totalPrice: 2589, storeCreditAmount: 0, currency: 'INR', note: null, tags: '', createdAt: new Date(),
    updatedAt: new Date(), cancelledAt: new Date(), internalOrderNumber: id.toUpperCase(), ...extra,
  });
}
const get = (id: string) => db.order.find((o) => o.id === id)!;
const bal = (id = 'c1') => db.customer.find((c) => c.id === id)!.storeCredits;

async function main() {
  // These scenarios act on pre-built data, so the go-live marker is set far in the past (go-live-run.ts proves history is skipped).
  (db.customerEventDelivery ||= []).push({ id: 'gl_seed', eventKey: '__fixes_go_live__', channel: 'system', eventType: 'SCANNER_INIT', status: 'sent', createdAt: new Date(0), updatedAt: new Date(0) });
  const { processOrderRefund, retryFailedRefunds } = await import('../../lib/services/refundService');
  const run = (id: string) => processOrderRefund(id, 'test', { razorpay: rzp });
  customer('c1');

  // R1 — prepaid order cancelled with the column default "not_applicable" (previously never claimed).
  payments.pay_1 = { amount: 258900, amount_refunded: 0, status: 'captured', currency: 'INR' };
  order('o1', { razorpayPaymentId: 'pay_1' });
  const r1 = await run('o1');
  check('R1 prepaid cancellation is refunded in full through Razorpay', r1.success && refundCalls.length === 1 && refundCalls[0].amount === 258900, JSON.stringify(r1));
  check('R2 order shows refund completed + refunded, with a ZBRF id', get('o1').refundStatus === 'completed' && get('o1').paymentStatus === 'refunded' && !!get('o1').refundId);
  check('R3 a refund payment row is recorded', (db.payment || []).some((p) => p.orderId === 'o1' && p.type === 'refund' && p.amount === 2589));
  await run('o1');
  check('R4 running again never refunds twice', refundCalls.length === 1);

  // R5 — Razorpay already refunded it (earlier run not saved / refunded in dashboard): recognise, do not repeat.
  payments.pay_5 = { amount: 100000, amount_refunded: 100000, status: 'refunded', currency: 'INR' };
  order('o5', { razorpayPaymentId: 'pay_5', totalPrice: 1000, refundStatus: 'failed', refundAttempts: 1 });
  await run('o5');
  check('R5 already refunded at Razorpay → marked completed, no new refund', get('o5').refundStatus === 'completed' && refundCalls.length === 1);

  // R6 — Razorpay error → failed; retried later → succeeds once.
  payments.pay_6 = { amount: 50000, amount_refunded: 0, status: 'captured', currency: 'INR' };
  order('o6', { razorpayPaymentId: 'pay_6', totalPrice: 500 });
  failNextRefund = 1;
  const r6 = await run('o6');
  check('R6 a Razorpay failure is recorded as failed with the reason', !r6.success && get('o6').refundStatus === 'failed' && /simulated/.test(get('o6').refundError || ''));
  check('R7 the attempt counter goes up (it stayed 0 before)', get('o6').refundAttempts === 1);
  get('o6').updatedAt = new Date(Date.now() - 20 * 60 * 1000);
  const retry = await retryFailedRefunds({ limit: 10, razorpay: rzp });
  check('R8 the retry job refunds it after the backoff', get('o6').refundStatus === 'completed' && refundCalls.filter((c) => c.paymentId === 'pay_6').length === 1, JSON.stringify(retry));

  // R9 — 100% store-credit order (no Razorpay payment), credit debited under "#<number>" before a ZBCC renumber.
  customer('c2', 0);
  order('o9', { customerId: 'c2', paymentMethod: 'store_credit', totalPrice: 0, storeCreditAmount: 4999, razorpayPaymentId: null, internalOrderNumber: 'ZBCC90001', previousOrderNumbers: 'ZB81594' });
  (db.storeCredit ||= []).push({ id: 'd9', customerId: 'c2', type: 'DEBIT', amount: -4999, orderId: '#ZB81594', remainingAmount: 0 });
  const r9 = await run('o9');
  check('R9 store credit used on the order goes back to the wallet', r9.success && bal('c2') === 4999 && get('o9').refundStatus === 'completed', `${bal('c2')} ${get('o9').refundStatus}`);
  get('o9').refundStatus = 'failed';
  await run('o9');
  check('R10 running again never credits twice', bal('c2') === 4999);

  // R11 — prepaid with PREPAID10 cashback: refund + cashback taken back.
  customer('c3', 250);
  payments.pay_11 = { amount: 225000, amount_refunded: 0, status: 'captured', currency: 'INR' };
  order('o11', { customerId: 'c3', razorpayPaymentId: 'pay_11', totalPrice: 2250 });
  db.storeCredit.push({ id: 'cb11', customerId: 'c3', type: 'COUPON_REBATE', amount: 250, remainingAmount: 250, orderId: 'o11', createdAt: new Date() });
  await run('o11');
  check('R11 coupon cashback earned on a cancelled order is taken back', bal('c3') === 0, String(bal('c3')));

  // R12 — COD: only the upfront amount paid online is refunded.
  payments.pay_12 = { amount: 9900, amount_refunded: 0, status: 'captured', currency: 'INR' };
  order('o12', { paymentMethod: 'cod', paymentStatus: 'cod_upfront_paid', totalPrice: 5999, codUpfrontPaid: 99, codUpfrontPaymentId: 'pay_12' });
  await run('o12');
  check('R12 COD cancellation refunds only the ₹99 upfront', refundCalls.some((c) => c.paymentId === 'pay_12' && c.amount === 9900) && get('o12').refundStatus === 'completed');

  // R13 — never captured (authorised only): nothing refunded, not an error.
  payments.pay_13 = { amount: 100000, amount_refunded: 0, status: 'authorized', currency: 'INR' };
  order('o13', { razorpayPaymentId: 'pay_13', totalPrice: 1000, paymentStatus: 'payment_pending' });
  const r13 = await run('o13');
  check('R13 an uncaptured payment needs no refund', r13.success && get('o13').refundStatus === 'not_applicable' && !refundCalls.some((c) => c.paymentId === 'pay_13'));

  // R14 — a claim stuck in "processing" (crash mid-refund) is taken over after 10 minutes, without a double refund.
  payments.pay_14 = { amount: 70000, amount_refunded: 70000, status: 'refunded', currency: 'INR' };
  order('o14', { razorpayPaymentId: 'pay_14', totalPrice: 700, refundStatus: 'processing', refundAttempts: 1, updatedAt: new Date(Date.now() - 11 * 60 * 1000) });
  await run('o14');
  check('R14 an interrupted refund is recovered from Razorpay\'s state', get('o14').refundStatus === 'completed' && !refundCalls.some((c) => c.paymentId === 'pay_14'));

  // R15 — not cancelled → refused.
  order('o15', { status: 'open', razorpayPaymentId: 'pay_1' });
  const r15 = await run('o15');
  check('R15 an order that is not cancelled is never refunded', !r15.success && get('o15').refundStatus === 'not_applicable');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
