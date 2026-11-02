/**
 * Regression scenarios for the three client issues of 2026-11-02:
 *   1. A successful payment must always become a confirmed order (browser / webhook missed it).
 *   2. A paid order must always reach Shopify (even when Shopify says the variant is out of stock).
 *   3. Cancelled orders must not appear as returns.
 *
 * Runs the REAL services / route handlers against the in-memory Prisma, with Razorpay and
 * Shopify faked at the HTTP layer (same setup as audit-run.ts).
 *
 *   ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PORT=1 \
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/confirm-run.ts
 */
import crypto from 'crypto';

Object.assign(process.env, {
  NODE_ENV: 'test',
  RAZORPAY_WEBHOOK_SECRET: 'whsec_test', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'secret',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test', SHOPIFY_STORE_DOMAIN: 'test-shop.myshopify.com',
  SHOPIFY_API_SECRET: 'shopify_secret',
  NEXT_PUBLIC_SITE_URL: 'https://zicabella.com',
});
const V = { DENIM: '51813148262681', TEE: '51813148328217' };
const PRICE: Record<string, number> = { [V.DENIM]: 1499, [V.TEE]: 799 };

type RzpPayment = { id: string; order_id: string; status: string; captured: boolean; amount: number; amount_refunded: number; currency: string };
const razorpayPayments = new Map<string, RzpPayment>();
const shopifyOrders: any[] = [];
const adminMails: string[] = [];
let shopifyOrderSeq = 7000;
let outOfStock = false;
const calls = { rzpOrderFetch: 0, rzpPaymentsList: 0, shopifyCreateAttempts: 0 };

(globalThis as any).fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
  const m = u.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\/([^/?]+)/);
  if (m) { const p = razorpayPayments.get(m[1]); return p ? json(200, { ...p }) : json(404, { error: { description: 'not found' } }); }
  const op = u.match(/^https:\/\/api\.razorpay\.com\/v1\/orders\/([^/?]+)\/payments$/);
  if (op) { calls.rzpPaymentsList++; return json(200, { items: [...razorpayPayments.values()].filter(p => p.order_id === op[1]) }); }
  const o = u.match(/^https:\/\/api\.razorpay\.com\/v1\/orders\/([^/?]+)$/);
  if (o) {
    calls.rzpOrderFetch++;
    const mine = [...razorpayPayments.values()].filter(p => p.order_id === o[1]);
    const paid = mine.some(p => p.status === 'captured');
    return json(200, { id: o[1], amount: 379700, currency: 'INR', status: paid ? 'paid' : mine.length ? 'attempted' : 'created', attempts: mine.length, notes: {} });
  }
  if (u.startsWith('https://graph.facebook.com/')) return json(200, { events_received: 1, messages: [{ id: 'wamid.1' }] });
  if (u.startsWith('https://tr.snapchat.com/')) return json(200, { status: 'VALID' });
  if (u.includes('/admin/api/')) {
    if (u.endsWith('/graphql.json') && (opt.method || 'GET') === 'POST') {
      const q = JSON.parse(opt.body || '{}');
      if (String(q.query || '').includes('ZbVariantPrices')) {
        const ids = (q.variables?.ids || []).map((g: string) => String(g).split('/').pop() || '');
        return json(200, { data: { nodes: ids.map((i: string) => (PRICE[i] !== undefined ? { id: `gid://shopify/ProductVariant/${i}`, price: PRICE[i].toFixed(2) } : null)) } });
      }
      return json(200, { data: {} });
    }
    if (u.includes('/orders.json') && (opt.method || 'GET') === 'POST') {
      calls.shopifyCreateAttempts++;
      const body = JSON.parse(opt.body).order;
      if (outOfStock && body.inventory_behaviour === 'decrement_obeying_policy') {
        return json(422, { errors: { line_items: ['Unable to reserve inventory'] } });
      }
      const id = ++shopifyOrderSeq; shopifyOrders.push(body); return json(201, { order: { id, name: `#${id}`, ...body } });
    }
    if (u.includes('/orders.json')) return json(200, { orders: [] });
    if (u.includes('/customers/search.json')) return json(200, { customers: [] });
    if (u.includes('/customers.json') && (opt.method || 'GET') === 'POST') return json(201, { customer: { id: 9100, ...(JSON.parse(opt.body).customer || {}) } });
    return json(200, { customers: [], customer: { id: 777 } });
  }
  return json(200, {});
};

const settle = async (ms = 60) => { for (let i = 0; i < 200; i++) await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 200; i++) await new Promise(r => setImmediate(r)); };
const pay = (id: string, orderId: string, status: 'captured' | 'authorized' | 'failed', rupees: number) =>
  razorpayPayments.set(id, { id, order_id: orderId, status, captured: status === 'captured', amount: Math.round(rupees * 100), amount_refunded: 0, currency: 'INR' });

let failed = 0, passed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });

async function main() {
  const { db, default: prisma } = await import('./memory-prisma');
  await import('../meta-regression/mocks');
  const preCreate = await import('../../app/api/checkout/razorpay/route');
  const byRzp = await import('../../app/api/orders/by-razorpay/route');
  const shopifyWebhook = await import('../../app/api/shopify/webhooks/route');
  const { reconcilePendingMainOrders } = await import('../../lib/services/razorpaySyncService');
  const { retryFailedPaidShopifySyncs } = await import('../../lib/services/orderLifecycleService');
  const { confirmPaymentForRazorpayOrder } = await import('../../lib/services/paymentConfirmation');
  const { withoutShopifyRefundMirrors } = await import('../../lib/returns-filter');
  const { startBackgroundJobs } = await import('../../lib/background-jobs');
  for (const level of ['log', 'warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: any[]) => { const line = args.map(String).join(' '); if (/email not sent/.test(line)) adminMails.push(line); orig(...args); };
  }

  await prisma.shop.create({ data: { id: 'shop_1', name: 'Zica Bella', domain: 'test-shop.myshopify.com' } });
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '81.2.69.142', 'user-agent': 'Mozilla/5.0 (iPhone)' };
  const address = { name: 'Riya Kapoor', email: 'riya@example.com', phone: '9811122233', houseNo: '12', street: 'MG Road', city: 'Noida', state: 'Uttar Pradesh', zip: '201301', country: 'India', countryCode: 'IN' };
  const items = [
    { productId: '10227656982809', variantId: V.DENIM, title: 'AEROLAYER DENIM', price: '1499', quantity: 2 },
    { productId: '10227656982810', variantId: V.TEE, title: 'TEE', price: '799', quantity: 1 },
  ];
  const base = { amount: 3797, currency: 'INR', displayCountry: 'IN', address, items, subtotal: 3797, total: 3797, paymentMethod: 'razorpay' };
  // The checkout page pre-creates a pending ZBPP order before the shopper pays.
  const precreate = async (body: any = base) => {
    const r = await preCreate.POST(new Request('https://zicabella.com/api/checkout/razorpay', { method: 'POST', body: JSON.stringify(body), headers }));
    return { status: r.status, ...(await r.json()) } as any;
  };
  const order = (id: string) => (db.order || []).find((o: any) => o.id === id);
  const age = (id: string, ms: number) => { order(id).createdAt = new Date(Date.now() - ms); };
  const shopifyFor = (num: string) => shopifyOrders.filter(o => JSON.stringify(o).includes(num));

  // ── 1. paid, shopper never came back ─────────────────────────────────────────
  console.log('\n— 1. paid order, shopper left the UPI screen (no browser call, no webhook)');
  const a = await precreate();
  check('1a: checkout pre-created a pending ZBPP order', a.status === 200 && order(a.localOrderId)?.paymentStatus === 'pending' && /^ZBPP/.test(order(a.localOrderId)?.internalOrderNumber || ''), order(a.localOrderId));
  pay('pay_A', a.razorpay_order_id, 'captured', 3797);
  age(a.localOrderId, 15 * 60_000);
  const r1 = await reconcilePendingMainOrders({ razorpayOrderId: a.razorpay_order_id });
  const oa = order(a.localOrderId);
  eq('1b: reconcile confirms it (paid / approved)', [oa.paymentStatus, oa.status], ['paid', 'approved']);
  check('1c: paymentCapturedAt is set (it was NULL on ZB81455)', oa.paymentCapturedAt instanceof Date, oa.paymentCapturedAt);
  check('1d: promoted from ZBPP to a real ZB number', /^ZB\d+$/.test(oa.internalOrderNumber) && !/^ZBPP/.test(oa.internalOrderNumber), oa.internalOrderNumber);
  eq('1e: exactly one Shopify order was created and the order is synced', [shopifyFor(oa.internalOrderNumber).length, oa.shopifySyncStatus], [1, 'synced']);
  eq('1f: reported as confirmed, and as late (waited > 10 min)', [r1.markedPaid.length, r1.lateConfirmed.length], [1, 1]);
  const r1b = await reconcilePendingMainOrders({ razorpayOrderId: a.razorpay_order_id });
  eq('1g: running it again changes nothing and creates no second Shopify order', [r1b.markedPaid.length, shopifyFor(oa.internalOrderNumber).length], [0, 1]);

  // ── 2. background-run options ────────────────────────────────────────────────
  console.log('\n— 2. background job options');
  const b = await precreate();
  pay('pay_B', b.razorpay_order_id, 'captured', 3797);
  let r2 = await reconcilePendingMainOrders({ minAgeMs: 90_000, limit: 150, throttleOlderOrders: true, budgetMs: 90_000 });
  eq('2a: a checkout younger than 90 s is left for the browser / webhook', [r2.markedPaid.length, order(b.localOrderId).paymentStatus], [0, 'pending']);
  age(b.localOrderId, 3 * 60_000);
  r2 = await reconcilePendingMainOrders({ minAgeMs: 90_000, limit: 150, throttleOlderOrders: true, budgetMs: 90_000 });
  eq('2b: once past 90 s the job confirms it', [r2.markedPaid.length, order(b.localOrderId).paymentStatus], [1, 'paid']);
  eq('2c: a 3-minute wait is not flagged as late (webhook assumed healthy)', r2.lateConfirmed.length, 0);

  const c = await precreate(); // nobody ever tried to pay this Razorpay order
  age(c.localOrderId, 5 * 60_000);
  calls.rzpPaymentsList = 0;
  await reconcilePendingMainOrders({ minAgeMs: 90_000, throttleOlderOrders: true });
  eq('2d: an order nobody tried to pay costs no payments lookup, and stays pending', [calls.rzpPaymentsList, order(c.localOrderId).paymentStatus], [0, 'pending']);

  // ── 3. COD upfront fee ───────────────────────────────────────────────────────
  console.log('\n— 3. COD order, upfront fee captured');
  const d = await precreate({ ...base, paymentMethod: 'COD', amount: 99 });
  pay('pay_D', d.razorpay_order_id, 'captured', 99);
  age(d.localOrderId, 4 * 60_000);
  await reconcilePendingMainOrders({ razorpayOrderId: d.razorpay_order_id });
  eq('3a: COD upfront captured → cod_upfront_paid / open', [order(d.localOrderId).paymentStatus, order(d.localOrderId).status], ['cod_upfront_paid', 'open']);

  // ── 4. mobile app order ──────────────────────────────────────────────────────
  console.log('\n— 4. mobile app order');
  const e = await precreate();
  Object.assign(order(e.localOrderId), { orderType: 'MOBILE_APP', tags: `${order(e.localOrderId).tags}, AppOrder` });
  await prisma.mobileOrder.create({ data: { orderNumber: order(e.localOrderId).internalOrderNumber, status: 'payment_pending', paymentStatus: 'payment_pending', customerId: order(e.localOrderId).customerId } });
  pay('pay_E', e.razorpay_order_id, 'captured', 3797);
  age(e.localOrderId, 4 * 60_000);
  await reconcilePendingMainOrders({ razorpayOrderId: e.razorpay_order_id });
  const oe = order(e.localOrderId);
  eq('4a: a stranded app order is confirmed too (approved)', [oe.paymentStatus, oe.status], ['paid', 'approved']);
  const mo = (db.mobileOrder || []).find((m: any) => m.orderNumber === oe.internalOrderNumber);
  eq('4b: its MobileOrder mirror records the payment', [mo?.paymentStatus, mo?.paymentId], ['paid', 'pay_E']);

  // ── 5. shopper comes back to the site ────────────────────────────────────────
  console.log('\n— 5. shopper returns: success-page lookup confirms on the spot');
  const f = await precreate();
  pay('pay_F', f.razorpay_order_id, 'captured', 3797);
  const lookup = async (rzp: string) => (await byRzp.GET(new Request(`https://zicabella.com/api/orders/by-razorpay?orderId=${rzp}`))).json();
  const lf = await lookup(f.razorpay_order_id);
  eq('5a: by-razorpay answers "paid" instead of "pending"', lf.paymentStatus, 'paid');
  eq('5b: and the order really is confirmed', order(f.localOrderId).paymentStatus, 'paid');

  const g = await precreate(); // genuinely unpaid
  calls.rzpOrderFetch = 0;
  const lg1 = await lookup(g.razorpay_order_id);
  await lookup(g.razorpay_order_id);
  await lookup(g.razorpay_order_id);
  eq('5c: an unpaid order stays pending', lg1.paymentStatus, 'pending');
  eq('5d: polling 3× in a row asks Razorpay only once (throttled)', calls.rzpOrderFetch, 1);
  await confirmPaymentForRazorpayOrder(g.razorpay_order_id); // still throttled, must not throw
  check('5e: on-demand check never throws', true);

  // ── 6. Shopify: paid order must reach Shopify even when stock is 0 ───────────
  console.log('\n— 6. Shopify sync when Shopify refuses to reserve stock');
  outOfStock = true;
  calls.shopifyCreateAttempts = 0; adminMails.length = 0;
  const h = await precreate();
  pay('pay_H', h.razorpay_order_id, 'captured', 3797);
  age(h.localOrderId, 5 * 60_000);
  await reconcilePendingMainOrders({ razorpayOrderId: h.razorpay_order_id });
  await settle();
  const oh = order(h.localOrderId);
  eq('6a: refused once (stock), then created ignoring the stock policy → synced', [calls.shopifyCreateAttempts, oh.shopifySyncStatus], [2, 'synced']);
  const sh = shopifyFor(oh.internalOrderNumber)[0];
  eq('6b: the Shopify order was created with decrement_ignoring_policy', sh?.inventory_behaviour, 'decrement_ignoring_policy');
  check('6c: it carries an inventory_override note attribute', (sh?.note_attributes || []).some((n: any) => n.name === 'inventory_override'), sh?.note_attributes);
  check('6d: the local order is tagged oversold', String(oh.tags).includes('oversold'), oh.tags);
  check('6e: the team is alerted', adminMails.some(s => /Oversold/.test(s)), adminMails);

  outOfStock = false;
  const i = await precreate();
  pay('pay_I', i.razorpay_order_id, 'captured', 3797);
  age(i.localOrderId, 5 * 60_000);
  calls.shopifyCreateAttempts = 0;
  await reconcilePendingMainOrders({ razorpayOrderId: i.razorpay_order_id });
  const oi = order(i.localOrderId);
  eq('6f: with stock available the normal path is unchanged (one call, obeys policy, no oversold tag)', [calls.shopifyCreateAttempts, shopifyFor(oi.internalOrderNumber)[0]?.inventory_behaviour, String(oi.tags).includes('oversold')], [1, 'decrement_obeying_policy', false]);

  // ── 7. retry queue: a stuck order must not block the others ──────────────────
  console.log('\n— 7. Shopify retry queue rotates');
  const mk = async (payId: string, num: string, updatedAgoMs: number) => {
    const p = await precreate();
    pay(payId, p.razorpay_order_id, 'captured', 3797);
    Object.assign(order(p.localOrderId), { paymentStatus: 'paid', status: 'approved', razorpayPaymentId: payId, paymentCapturedAt: new Date(), internalOrderNumber: num, shopifySyncStatus: 'failed', shopifyOrderId: null });
    order(p.localOrderId).updatedAt = new Date(Date.now() - updatedAgoMs);
    return p.localOrderId as string;
  };
  const stale = await mk('pay_R1', 'ZB99001', 10 * 60_000);   // just attempted
  const waiting = await mk('pay_R2', 'ZB99002', 6 * 3600_000); // waiting longest
  order(stale).createdAt = new Date(Date.now() - 30 * 24 * 3600_000); // oldest by creation: used to go first
  const batch = await retryFailedPaidShopifySyncs(1);
  eq('7a: the least recently attempted order is retried first (not the oldest-created)', batch.results[0]?.id, waiting);
  eq('7b: and it syncs', order(waiting).shopifySyncStatus, 'synced');

  // ── 8. returns ───────────────────────────────────────────────────────────────
  console.log('\n— 8. cancelled orders are not returns');
  const body = JSON.stringify({ id: 1, order_id: 555, note: 'Order canceled', refund_line_items: [{ line_item_id: 'li_1', quantity: 1 }] });
  await prisma.order.create({ data: { id: 'ord_cancel', shopId: 'shop_1', customerId: 'cust_x', status: 'cancelled', paymentStatus: 'refunded', shopifyOrderId: '555', totalPrice: 1000, items: { create: [{ shopifyLineItemId: 'li_1', productId: 'prod_1', title: 'T', quantity: 1, price: 1000 }] } } });
  const wh = await shopifyWebhook.POST(new Request('https://zicabella.com/api/shopify/webhooks', {
    method: 'POST', body,
    headers: { 'x-shopify-topic': 'refunds/create', 'x-shopify-shop-domain': 'test-shop.myshopify.com', 'x-shopify-hmac-sha256': crypto.createHmac('sha256', 'shopify_secret').update(body, 'utf8').digest('base64') },
  }));
  await settle();
  check('8a: the Shopify refund webhook is accepted', wh.status < 300, wh.status);
  eq('8b: and creates no Return row for the cancelled order', (db.return || []).length, 0);

  await prisma.return.create({ data: { id: 'ord1-prod1-shopify-refund', orderId: 'ord_cancel', productId: 'prod_1', customerId: 'cust_x', reason: 'Order canceled', status: 'refunded' } });
  await prisma.return.create({ data: { id: 'ret_genuine_1', orderId: 'ord_real', productId: 'prod_2', customerId: 'cust_x', reason: 'Too small', status: 'REQUESTED' } });
  const visible = await prisma.return.findMany({ where: withoutShopifyRefundMirrors({ returnRequestId: null }) });
  eq('8c: existing refund echoes are hidden, a real return stays', visible.map((r: any) => r.id), ['ret_genuine_1']);
  const visibleCount = await prisma.return.count({ where: withoutShopifyRefundMirrors({ returnRequestId: null, status: { in: ['pending', 'REQUESTED'] } }) });
  eq('8d: counters use the same filter', visibleCount, 1);

  // ── 9. background jobs are production-only ───────────────────────────────────
  console.log('\n— 9. background jobs');
  startBackgroundJobs();
  eq('9a: not started outside production', (globalThis as any).__zbJobsStarted, undefined);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(err => { console.error(err); process.exit(1); });
