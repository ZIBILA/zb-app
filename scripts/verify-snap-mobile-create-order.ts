/**
 * Runs the REAL /api/app/payment/create-order handler on an in-memory DB to prove
 * the very first (pending) OrderItem / MobileOrderItem already carry the Shopify
 * variant id (= feed.xml <g:id>), before any later /api/app/orders/create refresh.
 *
 *   npx tsx --tsconfig scripts/snap-test-support/tsconfig.json scripts/verify-snap-mobile-create-order.ts
 */
let failed = 0, passed = 0;
const check = (l: string, ok: boolean, d?: unknown) => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${ok || d === undefined ? '' : `\n      ${JSON.stringify(d)}`}`); };

async function main() {
  const { created } = await import('./snap-test-support/fake-db');
  const { POST } = await import('../app/api/app/payment/create-order/route');
  const body = {
    amount: 3797, currency: 'INR',
    orderData: {
      customerId: 'cust_app_1', paymentMethod: 'Razorpay', subtotal: 3797,
      shippingAddress: { name: 'Aarav Mehta', city: 'Noida', state: 'Uttar Pradesh', zip: '201304', country: 'India' },
      lineItems: [
        { variantId: 'gid://shopify/ProductVariant/51813148262681', productId: '10227656982809', quantity: 2, price: 1499, name: 'AEROLAYER HALF DENIM', sku: 'ZB-AERO-XS' },
        { variantId: 51813148328217, productId: '10227656982809', quantity: 1, price: 799, name: 'TEE', sku: 'variant:51813148328217' },
        { productId: '10227656982809', quantity: 1, price: 999, name: 'NO VARIANT', sku: 'ZB-EXOSHELL-32' },
      ],
    },
  };
  const res = await POST(new Request('https://zicabella.com/api/app/payment/create-order', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
  }));
  check('create-order responds 200', res.status === 200, res.status);
  const order = created.orders[0];
  check('pending Order created as MOBILE_APP / pending', order?.orderType === 'MOBILE_APP' && order?.paymentStatus === 'pending', order && { t: order.orderType, p: order.paymentStatus });
  const v = (order?.items || []).map((i: any) => i.variantId);
  check('pending OrderItem.variantId from GID → numeric', v[0] === '51813148262681', v);
  check('pending OrderItem.variantId from number → string', v[1] === '51813148328217', v);
  check('missing variant → null (never the SKU / product id)', v[2] === null, v);
  check('merchandise SKU kept unchanged in sku', order?.items?.[0]?.sku === 'ZB-AERO-XS');
  const mv = (created.mobileOrders[0]?.items || []).map((i: any) => i.variantId);
  check('pending MobileOrderItem.variantId persisted too', JSON.stringify(mv) === JSON.stringify(['51813148262681', '51813148328217', null]), mv);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
