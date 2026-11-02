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

type RzpPayment = { id: string; order_id: string; status: string; captured: boolean; amount: number; amount_refunded: number; currency: string; created_at?: number };
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
  if (u.startsWith('https://api.razorpay.com/v1/payments?')) {
    const nowSec = Math.floor(Date.now() / 1000);
    return json(200, { entity: 'collection', items: [...razorpayPayments.values()].map(p => ({ ...p, created_at: p.created_at ?? nowSec })) });
  }
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
  const { startBackgroundJobs, withTimeout } = await import('../../lib/background-jobs');
  const { reconcileRazorpayPayments } = await import('../../lib/services/razorpayReconcileService');
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

  // ── 9. scan + payment-driven reconcile together: one email, no false findings ──
  console.log('\n— 9. our scan and the payment-driven reconcile on the same order');
  const emails = (id: string) => (db.emailLog || []).filter((e: any) => e.referenceId === id);
  const j = await precreate();
  pay('pay_J', j.razorpay_order_id, 'captured', 3797);
  age(j.localOrderId, 5 * 60_000);
  await reconcilePendingMainOrders({ minAgeMs: 90_000, throttleOlderOrders: true, budgetMs: 90_000 });
  await settle();
  eq('9a: confirmed by the scan: the customer is emailed once (tagged)', [order(j.localOrderId).paymentStatus, emails(j.localOrderId).length, String(order(j.localOrderId).tags).includes('confirmation_emailed')], ['paid', 1, true]);
  const scan1 = await reconcileRazorpayPayments();
  await settle();
  eq('9b: the payment-driven scan then finds nothing to fix or report', [scan1.recovered, scan1.orphanRecovered, scan1.mismatched, scan1.unresolved], [0, 0, 0, 0]);
  eq('9c: and sends no second email', emails(j.localOrderId).length, 1);

  const k = await precreate();
  pay('pay_K', k.razorpay_order_id, 'captured', 3797);
  age(k.localOrderId, 5 * 60_000);
  const scan2 = await reconcileRazorpayPayments();
  await settle();
  eq('9d: an order only the payment-driven scan sees is recovered (paid), emailed exactly once', [scan2.recovered, order(k.localOrderId).paymentStatus, emails(k.localOrderId).length], [1, 'paid', 1]);
  const scan3 = await reconcileRazorpayPayments();
  eq('9e: running it again is a no-op', [scan3.recovered, emails(k.localOrderId).length], [0, 1]);

  // A capture whose local order was never written at all: placeholder, held for review, customer not emailed.
  pay('pay_ORPHAN', 'order_NOLOCAL01', 'captured', 1999);
  const scan4 = await reconcileRazorpayPayments();
  const orphan = (db.order || []).find((o: any) => o.razorpayOrderId === 'order_NOLOCAL01');
  eq('9f: a capture with no local order becomes a held placeholder (never lost)', [scan4.orphanRecovered, orphan?.shopifySyncStatus], [1, 'needs_review']);
  eq('9g: and the customer is not told "confirmed" for a placeholder', emails(orphan?.id).length, 0);

  // ── 10. review fixes ─────────────────────────────────────────────────────────
  console.log('\n— 10. code-review fixes');
  // 10a. On-demand My Orders check keeps the NEWEST pending orders when it caps (it used to drop the one just paid).
  const custId = order(j.localOrderId).customerId;
  for (let n = 0; n < 6; n++) { const old = await precreate(); age(old.localOrderId, (1 + n * 0.3) * 3600_000); }
  const newest = await precreate();
  pay('pay_NEW', newest.razorpay_order_id, 'captured', 3797);
  await reconcilePendingMainOrders({ customerIds: [custId], limit: 5 });
  eq('10a: with 6+ abandoned pending orders, the order just paid is still the one confirmed', order(newest.localOrderId).paymentStatus, 'paid');
  // 10b. ...and the on-demand check only looks at recent checkouts (older ones are the background scan's job).
  const stale6h = await precreate();
  pay('pay_STALE', stale6h.razorpay_order_id, 'captured', 3797);
  age(stale6h.localOrderId, 10 * 3600_000);
  await reconcilePendingMainOrders({ customerIds: [custId], limit: 5 });
  eq('10b: a 10-hour-old pending order is left for the background scan…', order(stale6h.localOrderId).paymentStatus, 'pending');
  await reconcilePendingMainOrders({ minAgeMs: 90_000, throttleOlderOrders: true });
  eq('10c: …which does confirm it', order(stale6h.localOrderId).paymentStatus, 'paid');
  // 10d. Older checkouts are re-checked progressively less often.
  const slow = await precreate();
  age(slow.localOrderId, 20 * 60_000);
  const t1 = await reconcilePendingMainOrders({ razorpayOrderId: slow.razorpay_order_id, throttleOlderOrders: true });
  const t2 = await reconcilePendingMainOrders({ razorpayOrderId: slow.razorpay_order_id, throttleOlderOrders: true });
  eq('10d: a 20-min-old pending order is checked, then skipped on the next tick (5-min cadence)', [t1.checked, t2.checked], [1, 0]);

  // 10e. Dead-webhook verdict: a quiet spell after a DELIVERED capture is not "dead"; an undelivered one is.
  const nowMs = Date.now(), HOUR = 3600_000;
  const evt = async (agoMs: number, key: string) => { const e = await prisma.webhookEvent.create({ data: { source: 'razorpay', eventType: 'payment.captured', eventKey: key, payload: '{}', processed: true } }); (db.webhookEvent.find((x: any) => x.id === e.id) as any).createdAt = new Date(nowMs - agoMs); };
  const sec = (agoMs: number) => Math.floor((nowMs - agoMs) / 1000);
  await evt(2.5 * HOUR, 'evt:quiet');
  const quietPay = razorpayPayments.get('pay_J')!; quietPay.created_at = sec(2.5 * HOUR); // captured and delivered at the same moment
  const quiet = await reconcileRazorpayPayments({ now: nowMs });
  eq('10e: webhook delivered the only capture 2.5 h ago, nothing since → NOT reported as dead', quiet.webhookDead, false);
  razorpayPayments.set('pay_UNDELIVERED', { id: 'pay_UNDELIVERED', order_id: 'order_LATE', status: 'captured', captured: true, amount: 100, amount_refunded: 0, currency: 'INR', created_at: sec(1 * HOUR) });
  const dead = await reconcileRazorpayPayments({ now: nowMs });
  eq('10f: a capture newer than the last delivery, with no delivery for 2 h+ → reported as dead', dead.webhookDead, true);
  razorpayPayments.delete('pay_UNDELIVERED');

  // 10g. A persistent finding (second capture on an already-paid order) is emailed once, not on every run.
  const dup = await precreate();
  pay('pay_DUP1', dup.razorpay_order_id, 'captured', 3797);
  age(dup.localOrderId, 5 * 60_000);
  await reconcilePendingMainOrders({ razorpayOrderId: dup.razorpay_order_id });
  pay('pay_DUP2', dup.razorpay_order_id, 'captured', 3797); // the shopper paid twice
  adminMails.length = 0;
  const d1 = await reconcileRazorpayPayments({ now: nowMs });
  const mailsAfterFirst = adminMails.filter(m => /Razorpay reconciliation/.test(m)).length;
  const d2 = await reconcileRazorpayPayments({ now: nowMs + 5 * 60_000 });
  const d3 = await reconcileRazorpayPayments({ now: nowMs + 10 * 60_000 });
  const mailsAfterThird = adminMails.filter(m => /Razorpay reconciliation/.test(m)).length;
  check('10g: the duplicate capture is listed on every run…', [d1, d2, d3].every(r => r.lines.some(l => l.paymentId === 'pay_DUP2' && l.kind === 'mismatch')), d2.lines);
  eq('10h: …but the team is emailed about it once, not every 5 minutes', [mailsAfterFirst >= 1, mailsAfterThird], [true, mailsAfterFirst]);

  // 10i. A hung job cannot freeze its timer.
  let hung = '';
  await withTimeout(new Promise(() => {}), 40).catch((e: Error) => { hung = e.message; });
  check('10i: a never-settling job run times out instead of blocking forever', /timed out/.test(hung), hung);

  // ── 11. background jobs are production-only ───────────────────────────────────
  console.log('\n— 11. background jobs');
  startBackgroundJobs();
  eq('11a: not started outside production', (globalThis as any).__zbJobsStarted, undefined);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(err => { console.error(err); process.exit(1); });
