/**
 * Paid-like payment states for the Purchase event (lib/meta/order-value.ts):
 * `partially_paid` on a COD order is Shopify's re-labelling of the same sale and
 * must still produce one Meta + Snap Purchase (server and browser); `partially_paid`
 * on an under-captured prepaid order must not.
 *
 * Run:
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-purchase-paid-like.ts
 */
import {
  isCodUpfrontOrder, isPurchasePaidStatus, PURCHASE_PAID_STATUSES, PURCHASE_SCAN_STATUSES,
} from '../lib/meta/order-value';
import { decideMetaBrowserPurchase, decideSnapBrowserPurchase, pickOrderServerFacts, orderForTracking } from '../lib/meta/browser-purchase';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
};

console.log('— isCodUpfrontOrder');
check('paymentMethod COD', isCodUpfrontOrder({ paymentMethod: 'COD' }));
check('paymentMethod cod (lower case)', isCodUpfrontOrder({ paymentMethod: 'cod' }));
check('paymentMethod "Cash on Delivery"', isCodUpfrontOrder({ paymentMethod: 'Cash on Delivery' }));
check('paymentMethod "COD (₹99 upfront)"', isCodUpfrontOrder({ paymentMethod: 'COD (₹99 upfront)' }));
check('codUpfrontPaid > 0 alone', isCodUpfrontOrder({ paymentMethod: 'razorpay', codUpfrontPaid: 99 }));
check('codUpfrontPaymentId alone', isCodUpfrontOrder({ codUpfrontPaymentId: 'pay_123' }));
check('tag cod_upfront_paid alone (sync path writes it)', isCodUpfrontOrder({ tags: 'Approved, cod_upfront_paid, zb-inv-decremented' }));
check('razorpay prepaid is not COD', !isCodUpfrontOrder({ paymentMethod: 'razorpay', codUpfrontPaid: 0, tags: 'Approved' }));
check('a word containing "cod" is not COD', !isCodUpfrontOrder({ paymentMethod: 'encoded-wallet' }));
check('null / empty', !isCodUpfrontOrder(null) && !isCodUpfrontOrder({}));

console.log('— isPurchasePaidStatus');
check('paid', isPurchasePaidStatus({ paymentStatus: 'paid' }));
check('PAID (any case)', isPurchasePaidStatus({ paymentStatus: 'PAID' }));
check('cod_upfront_paid', isPurchasePaidStatus({ paymentStatus: 'cod_upfront_paid' }));
check('partially_paid + COD (Shopify re-label) counts', isPurchasePaidStatus({ paymentStatus: 'partially_paid', paymentMethod: 'COD', codUpfrontPaid: 99 }));
check('partially_paid + only the cod_upfront_paid tag counts', isPurchasePaidStatus({ paymentStatus: 'partially_paid', tags: 'cod_upfront_paid' }));
check('partially_paid prepaid (under-captured, needs_review) does not', !isPurchasePaidStatus({ paymentStatus: 'partially_paid', paymentMethod: 'razorpay', tags: 'underpaid, needs_review' }));
for (const st of ['payment_pending', 'pending', 'authorized', 'failed', 'refunded', 'partially_refunded', 'cancelled', '', undefined]) {
  check(`${JSON.stringify(st)} never counts, COD or not`, !isPurchasePaidStatus({ paymentStatus: st, paymentMethod: 'COD', codUpfrontPaid: 99 }) && !isPurchasePaidStatus({ paymentStatus: st }));
}
check('PURCHASE_PAID_STATUSES is still paid + cod_upfront_paid', [...PURCHASE_PAID_STATUSES].sort().join(',') === 'cod_upfront_paid,paid');
check('PURCHASE_SCAN_STATUSES adds partially_paid for the database scans', [...PURCHASE_SCAN_STATUSES].sort().join(',') === 'cod_upfront_paid,paid,partially_paid');

console.log('— browser decision on the server facts (confirmation page)');
const base = { id: 'ord_1', orderType: 'WEB_STORE', totalPrice: 2499, currency: 'INR', createdAt: new Date().toISOString(), items: [{ variantId: '1', quantity: 1, price: 2499 }] };
const opts = { alreadySent: false };
const codRelabelled = { ...base, paymentStatus: 'partially_paid', paymentMethod: 'COD', codUpfrontPaid: 99 };
check('Meta: COD re-labelled partially_paid → fire', decideMetaBrowserPurchase(codRelabelled as any, opts).action === 'fire', decideMetaBrowserPurchase(codRelabelled as any, opts));
check('Snap: COD re-labelled partially_paid → fire', decideSnapBrowserPurchase(codRelabelled as any, opts).action === 'fire', decideSnapBrowserPurchase(codRelabelled as any, opts));
const underpaid = { ...base, paymentStatus: 'partially_paid', paymentMethod: 'razorpay' };
check('Meta: under-captured prepaid partially_paid → done, never fires', decideMetaBrowserPurchase(underpaid as any, opts).action === 'done', decideMetaBrowserPurchase(underpaid as any, opts));
check('Snap: under-captured prepaid partially_paid → done, never fires', decideSnapBrowserPurchase(underpaid as any, opts).action === 'done');
check('paid still fires', decideMetaBrowserPurchase({ ...base, paymentStatus: 'paid' } as any, opts).action === 'fire');
check('cod_upfront_paid still fires', decideMetaBrowserPurchase({ ...base, paymentStatus: 'cod_upfront_paid' } as any, opts).action === 'fire');
check('payment_pending still waits', decideMetaBrowserPurchase({ ...base, paymentStatus: 'payment_pending' } as any, opts).action === 'wait');

console.log('— server facts carry the COD markers from ?view=tracking');
const facts = pickOrderServerFacts({ id: 'ord_1', paymentStatus: 'partially_paid', paymentMethod: 'COD', codUpfrontPaid: 99, orderType: 'WEB_STORE', totalPrice: 2499, currency: 'INR', items: [] }, 'ord_1');
check('paymentMethod + codUpfrontPaid are kept', facts?.paymentMethod === 'COD' && facts?.codUpfrontPaid === 99, facts);
const tracked = orderForTracking({ ...base, paymentStatus: '', serverFacts: facts });
check('the tracking view of the displayed copy fires on those facts', decideMetaBrowserPurchase(tracked as any, opts).action === 'fire', decideMetaBrowserPurchase(tracked as any, opts));
const factsNoMethod = pickOrderServerFacts({ id: 'ord_2', paymentStatus: 'partially_paid', orderType: 'WEB_STORE', totalPrice: 10, currency: 'INR' }, 'ord_2');
check('without the markers a partially_paid order stays "done" (older server payloads)', decideMetaBrowserPurchase(orderForTracking({ ...base, id: 'ord_2', serverFacts: factsNoMethod }) as any, opts).action === 'done');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
