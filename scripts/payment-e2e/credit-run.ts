/**
 * Store credit used at checkout must stay off the order total everywhere:
 *   wallet debit = order.storeCreditAmount = items - coupon - order total = the Shopify discount.
 * Real Shopify sync + Shopify order webhook against the in-memory Prisma; Shopify faked at the HTTP layer and
 * computing its order total from the payload it receives (items - discount codes), like the real one.
 *
 *   ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PORT=1 \
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/credit-run.ts
 */
import crypto from 'crypto';

Object.assign(process.env, {
  NODE_ENV: 'test', SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test', SHOPIFY_STORE_DOMAIN: 'test-shop.myshopify.com',
  SHOPIFY_API_SECRET: 'shopify_secret', NEXT_PUBLIC_SITE_URL: 'https://zicabella.com',
});
const V = { DENIM: '51813148262681', TEE: '51813148328217' };
const shopifyOrders: any[] = [];
let shopifySeq = 9000;
const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
/** What Shopify reports for an order created from `body`: items - discount codes. */
const PRICE: Record<string, number> = { [V.DENIM]: 1499, [V.TEE]: 799 };
const shopifyTotals = (body: any) => {
  // Shopify prices the lines itself from the variant
  const lines = (body.line_items || []).reduce((n: number, l: any) => n + (PRICE[String(l.variant_id)] ?? Number(l.price)) * Number(l.quantity || 1), 0);
  const discounts = (body.discount_codes || []).reduce((n: number, d: any) => n + Number(d.amount), 0);
  return { lines, discounts, total: Math.max(0, lines - discounts) };
};
(globalThis as any).fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  const rp = u.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\/([^/?]+)/);
  if (rp) {
    // The payment was captured for exactly what the order total says (the amount after store credit).
    const o = ((globalThis as any).__db?.order || []).find((x: any) => x.razorpayPaymentId === rp[1]);
    return o ? json(200, { id: rp[1], order_id: o.razorpayOrderId, status: 'captured', captured: true, amount: Math.round(Number(o.totalPrice) * 100), amount_refunded: 0, currency: 'INR' }) : json(404, { error: { description: 'not found' } });
  }
  if (u.includes('/admin/api/')) {
    if (u.endsWith('/graphql.json')) return json(200, { data: {} });
    if (u.includes('/orders.json') && (opt.method || 'GET') === 'POST') {
      const body = JSON.parse(opt.body).order;
      const id = ++shopifySeq; shopifyOrders.push(body);
      const t = shopifyTotals(body);
      return json(201, { order: { id, name: `#${id}`, ...body, total_price: t.total.toFixed(2), total_line_items_price: t.lines.toFixed(2), subtotal_price: t.total.toFixed(2) } });
    }
    if (u.includes('/orders.json')) return json(200, { orders: [] });
    if (u.includes('/customers/search.json')) return json(200, { customers: [] });
    if (u.includes('/customers.json') && (opt.method || 'GET') === 'POST') return json(201, { customer: { id: 9100, ...(JSON.parse(opt.body).customer || {}) } });
    return json(200, { customers: [], customer: { id: 777 } });
  }
  return json(200, {});
};

let failed = 0, passed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });

async function main() {
  const { db, default: prisma } = await import('./memory-prisma');
  (globalThis as any).__db = db;
  const { syncOrderToShopify } = await import('../../lib/services/shopifyOrderSyncService');
  const shopifyWebhook = await import('../../app/api/shopify/webhooks/route');
  await prisma.shop.create({ data: { id: 'shop_1', name: 'Zica Bella', domain: 'test-shop.myshopify.com' } });
  const cust = await prisma.customer.create({ data: { id: 'cust_1', shopId: 'shop_1', shopifyId: 'GUEST_1', name: 'Aarav Mehta', email: 'aarav@example.com', phone: '+919811122244', storeCredits: 0 } });
  const address = JSON.stringify({ name: 'Aarav Mehta', address1: '1 Sector 90', city: 'Noida', province: 'Uttar Pradesh', zip: '201304', country: 'India', phone: '+919811122244' });

  // items: 2 x DENIM 1499 + 1 x TEE 799 = 3797
  let seq = 0;
  async function makeOrder(o: { coupon?: number; couponCode?: string; credit: number; total: number }) {
    const n = ++seq;
    const order = await prisma.order.create({ data: {
      id: `ord_c${n}`, shopId: 'shop_1', customerId: cust.id, internalOrderNumber: `ZB9000${n}`, orderType: 'MOBILE_APP',
      status: 'approved', paymentStatus: 'paid', paymentMethod: 'Razorpay', razorpayPaymentId: `pay_c${n}`, razorpayOrderId: `order_c${n}`,
      totalPrice: o.total, subtotalPrice: 3797, discountAmount: o.coupon || 0, discountCode: o.couponCode || null, storeCreditAmount: o.credit,
      currency: 'INR', shippingAddress: address, deliveryStatus: 'pending', fulfillmentStatus: 'unfulfilled',
      items: { create: [
        { shopifyLineItemId: `li_c${n}a`, productId: 'p1', title: 'AEROLAYER DENIM', quantity: 2, price: 1499, variantId: V.DENIM },
        { shopifyLineItemId: `li_c${n}b`, productId: 'p2', title: 'TEE', quantity: 1, price: 799, variantId: V.TEE },
      ] },
    } });
    return order;
  }
  const local = (id: string) => (db.order || []).find((x: any) => x.id === id);
  const hook = async (payload: any) => {
    const body = JSON.stringify(payload);
    const r = await shopifyWebhook.POST(new Request('https://zicabella.com/api/shopify/webhooks', { method: 'POST', body, headers: {
      'x-shopify-topic': 'orders/create', 'x-shopify-shop-domain': 'test-shop.myshopify.com',
      'x-shopify-hmac-sha256': crypto.createHmac('sha256', 'shopify_secret').update(body, 'utf8').digest('base64') } }));
    return r.status;
  };
  const asShopifyOrder = (shopifyId: string, sent: any, num: string, totalOverride?: number) => {
    const t = shopifyTotals(sent);
    return { id: Number(shopifyId), name: `#${shopifyId}`, tags: `mobile-app, zb-order-${num}`, financial_status: 'paid', fulfillment_status: null,
      total_price: String(totalOverride ?? t.total), total_line_items_price: String(t.lines), subtotal_price: String(totalOverride ?? t.total),
      customer: { id: 'GUEST_1', email: 'aarav@example.com', first_name: 'Aarav' }, line_items: (sent.line_items || []).map((l: any, i: number) => ({ id: Number(`${shopifyId}${i + 1}`), title: i ? 'TEE' : 'AEROLAYER DENIM', quantity: l.quantity, price: String(PRICE[String(l.variant_id)]), variant_id: l.variant_id, sku: `sku${i}` })), created_at: new Date().toISOString() };
  };

  console.log('\n— 1. ₹1,000 store credit, no coupon: items 3797 → pay 2797');
  const o1 = await makeOrder({ credit: 1000, total: 2797 });
  await syncOrderToShopify(o1.id);
  const s1 = shopifyOrders[shopifyOrders.length - 1];
  check('1a: Shopify receives the store credit as a discount', (s1?.discount_codes || []).some((d: any) => d.code === 'STORE_CREDIT' && d.amount === '1000.00'), s1?.discount_codes);
  eq('1b: Shopify total = what the customer paid', shopifyTotals(s1).total, 2797);
  eq('1c: the payment recorded on Shopify is the amount charged', s1?.transactions?.[0]?.amount, '2797.00');
  eq('1d: the order total after the sync', local(o1.id)?.totalPrice, 2797);
  const sid1 = String(local(o1.id)?.shopifyOrderId);
  check('1e: the order is linked to the Shopify order', !!sid1 && sid1 !== 'undefined' && sid1 !== 'null', sid1);
  check('1f: Shopify\'s order webhook is accepted', (await hook(asShopifyOrder(sid1, s1, o1.internalOrderNumber))) < 300);
  eq('1g: …and does NOT put the credit back on the total', local(o1.id)?.totalPrice, 2797);
  eq('1h: store credit amount, discount and total stay consistent', [local(o1.id)?.storeCreditAmount, 3797 - 1000 - 0 - Number(local(o1.id)?.totalPrice)], [1000, 0]);

  console.log('\n— 2. an order created BEFORE the fix: Shopify never saw the credit (its total is the full price)');
  const o2 = await makeOrder({ credit: 1000, total: 2797 });
  await prisma.order.update({ where: { id: o2.id }, data: { shopifyOrderId: '88002', shopifyOrderName: '#88002' } });
  const legacySent = { line_items: s1.line_items, discount_codes: [] };
  check('2a: Shopify\'s webhook reports the full price', (await hook(asShopifyOrder('88002', legacySent, o2.internalOrderNumber))) < 300);
  eq('2b: our order keeps the amount actually charged (₹2,797)', local(o2.id)?.totalPrice, 2797);

  console.log('\n— 3. coupon ₹500 + store credit ₹1,000: pay 2297');
  const o3 = await makeOrder({ coupon: 500, couponCode: 'SAVE500', credit: 1000, total: 2297 });
  await syncOrderToShopify(o3.id);
  const s3 = shopifyOrders[shopifyOrders.length - 1];
  eq('3a: Shopify gets the coupon and the credit as two discounts', (s3?.discount_codes || []).map((d: any) => [d.code, d.amount]), [['SAVE500', '500.00'], ['STORE_CREDIT', '1000.00']]);
  eq('3b: Shopify total = 2297', shopifyTotals(s3).total, 2297);
  const sid3 = String(local(o3.id)?.shopifyOrderId);
  await hook(asShopifyOrder(sid3, s3, o3.internalOrderNumber));
  eq('3c: total stays ₹2,297 after the webhook', local(o3.id)?.totalPrice, 2297);

  console.log('\n— 4. 100% store credit (₹0 to pay)');
  const o4 = await makeOrder({ credit: 3797, total: 0 });
  await prisma.order.update({ where: { id: o4.id }, data: { paymentMethod: 'store_credit', razorpayPaymentId: null, razorpayOrderId: null } });
  await syncOrderToShopify(o4.id);
  const s4 = shopifyOrders[shopifyOrders.length - 1];
  eq('4a: one STORE_CREDIT discount covering everything, no extra ZERO_TOTAL', (s4?.discount_codes || []).map((d: any) => [d.code, d.amount]), [['STORE_CREDIT', '3797.00']]);
  eq('4b: Shopify total 0', shopifyTotals(s4).total, 0);
  const sid4 = String(local(o4.id)?.shopifyOrderId);
  await hook(asShopifyOrder(sid4, s4, o4.internalOrderNumber));
  eq('4c: total stays ₹0 after the webhook', local(o4.id)?.totalPrice, 0);

  console.log('\n— 5. orders without store credit are unchanged');
  const o5 = await makeOrder({ coupon: 300, couponCode: 'SAVE300', credit: 0, total: 3497 });
  await syncOrderToShopify(o5.id);
  const s5 = shopifyOrders[shopifyOrders.length - 1];
  eq('5a: coupon only → one coupon discount', (s5?.discount_codes || []).map((d: any) => [d.code, d.amount]), [['SAVE300', '300.00']]);
  const sid5 = String(local(o5.id)?.shopifyOrderId);
  await hook(asShopifyOrder(sid5, s5, o5.internalOrderNumber));
  eq('5b: total stays ₹3,497', local(o5.id)?.totalPrice, 3497);
  const o6 = await makeOrder({ credit: 0, total: 3797 });
  await syncOrderToShopify(o6.id);
  eq('5c: no discount at all → no discount codes sent', shopifyOrders[shopifyOrders.length - 1]?.discount_codes, undefined);

  console.log('\n— 6. login / manual Shopify syncs copy the total with the same rule');
  const { localOrderTotal } = await import('../../lib/order-totals');
  const full = { id: Number(sid1), total_price: '3797.00', total_line_items_price: '3797.00', subtotal_price: '3797.00' };
  eq('6a: an order with store credit keeps its charged total when Shopify reports the full price', await localOrderTotal(prisma as any, full), 2797);
  const withCredit = { id: Number(sid1), total_price: '2797.00', total_line_items_price: '3797.00', subtotal_price: '2797.00' };
  eq('6b: …and is not reduced twice when Shopify already applied the credit', await localOrderTotal(prisma as any, withCredit), 2797);
  eq('6c: an order we do not know (or without credit) takes Shopify\'s total', await localOrderTotal(prisma as any, { id: 1234567, total_price: '999.00' }), 999);
  eq('6d: an order without store credit takes Shopify\'s total', await localOrderTotal(prisma as any, { id: Number(sid5), total_price: '3497.00', total_line_items_price: '3797.00' }), 3497);

  console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
