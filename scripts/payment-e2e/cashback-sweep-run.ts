/**
 * Coupon cashback for paid prepaid orders confirmed without /api/checkout/complete (webhook / reconciler).
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/cashback-sweep-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test' });

import { db } from './memory-prisma';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`);
}

const order = (id: string, extra: Record<string, any>) =>
  (db.order ||= []).push({
    id, customerId: 'cust1', status: 'open', paymentStatus: 'paid', paymentMethod: 'razorpay', orderType: 'REGULAR',
    discountCode: 'PREPAID10', subtotalPrice: 27595, totalPrice: 24835, createdAt: new Date(), ...extra,
  });
const credits = (orderId: string) => (db.storeCredit || []).filter((c) => c.orderId === orderId);

async function main() {
  // These scenarios act on pre-built data, so the go-live marker is set far in the past (go-live-run.ts proves history is skipped).
  (db.customerEventDelivery ||= []).push({ id: 'gl_seed', eventKey: '__fixes_go_live__', channel: 'system', eventType: 'SCANNER_INIT', status: 'sent', createdAt: new Date(0), updatedAt: new Date(0) });
  (db.customer ||= []).push({ id: 'cust1', storeCredits: 0 });
  (db.webStoreCoupon ||= []).push({
    id: 'cp1', code: 'PREPAID10', isActive: true, discountType: 'percentage', discountValue: 10, applicability: 'PREPAID_ONLY',
    cashbackEnabled: true, cashbackType: 'percentage', cashbackValue: 10, usageLimit: 1, usedCount: 1, minOrderValue: 0,
  });
  order('webhookPaid', {});
  order('codOrder', { paymentMethod: 'cod', paymentStatus: 'cod_upfront_paid' });
  order('pendingOrder', { paymentStatus: 'payment_pending' });
  order('cancelledOrder', { status: 'cancelled' });
  order('alreadyCredited', {});
  (db.storeCredit ||= []).push({ id: 'sc0', customerId: 'cust1', orderId: 'alreadyCredited', type: 'COUPON_REBATE', amount: 2484, remainingAmount: 2484, idempotencyKey: 'cashback:alreadyCredited' });

  const { issueMissingCouponCashback } = await import('../../lib/storeCreditsHelper');
  const n1 = await issueMissingCouponCashback();
  const c = credits('webhookPaid');
  check('S1 a paid prepaid order with no cashback gets it', c.length === 1 && c[0].type === 'COUPON_REBATE');
  check('S2 same amount checkout computes: 10% of the paid amount after the 10% discount (₹2,484)', c[0]?.amount === 2484, String(c[0]?.amount));
  check('S3 it carries the checkout idempotency key and a 90-day expiry', c[0]?.idempotencyKey === 'cashback:webhookPaid' && c[0]?.expiresAt instanceof Date);
  check('S4 the customer balance goes up by that amount', db.customer[0].storeCredits === 2484, String(db.customer[0].storeCredits));
  check('S5 COD, unpaid and cancelled orders get nothing', credits('codOrder').length + credits('pendingOrder').length + credits('cancelledOrder').length === 0);
  check('S6 an order /complete already credited is untouched', credits('alreadyCredited').length === 1 && n1 === 1);
  check('S7 a coupon that has since hit its usage limit still pays the order placed while it was valid', c.length === 1);

  const n2 = await issueMissingCouponCashback();
  check('S8 running again never credits twice', n2 === 0 && credits('webhookPaid').length === 1 && db.customer[0].storeCredits === 2484);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
