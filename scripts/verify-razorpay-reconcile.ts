/**
 * Payment-driven Razorpay reconciliation (2 Nov 2026 incident: pay_TvHpd9l4Vbz104 /
 * order_TvHp4uV2qbm2P8 paid ₹17,878 while ZBPP82722 sat pending for 4.5 h):
 *  (a) captured payment + pending local order → marked paid once through the existing
 *      marking path, confirmation email sent once, SyncLog written, admin email lists it;
 *  (b) captured payment with no local order → placeholder recovery, customer not emailed;
 *  (c) paid order whose captured amount differs → reported, not modified;
 *  (d) COD upfront ₹99 against a ₹2,599 order → not reported (and a pending COD order is
 *      confirmed as cod_upfront_paid with the COD email);
 *  (e) a second run changes nothing (idempotent);
 *  (f) dead-webhook line when the newest processed WebhookEvent is older than 2 h,
 *      reminder-limited when it is the only finding;
 *  (g) an unprocessed checkout.complete.retry row older than 1 min is finished;
 *  plus the /complete browser retry policy and the retry-row recorder.
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-razorpay-reconcile.ts
 *
 * Runs the REAL services (razorpayReconcileService → razorpaySyncService /
 * razorpayRecoveryService / orderConfirmationNotice) against the in-memory fake DB,
 * a fake Razorpay client served by a mocked api.razorpay.com, a mocked Shopify and a
 * patched SMTP transport. Nothing is sent anywhere.
 */
Object.assign(process.env, {
  NODE_ENV: 'test',
  RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'secret',
  NEXT_PUBLIC_SITE_URL: 'https://zicabella.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test', SHOPIFY_STORE_DOMAIN: 'test-shop.myshopify.com',
  CRON_SECRET: 'cron_test_secret',
});
delete process.env.META_CAPI_ACCESS_TOKEN; delete process.env.SNAP_CAPI_ACCESS_TOKEN;

const NOW = Date.now();
const MIN = 60_000; const HOUR = 60 * MIN;
type RzpPayment = { id: string; order_id: string | null; status: string; captured: boolean; amount: number; amount_refunded: number; currency: string; created_at: number; method: string; email?: string; contact?: string; notes: Record<string, string> };
const razorpayPayments = new Map<string, RzpPayment>();
const razorpayOrders = new Map<string, { amount: number; notes?: Record<string, string> }>();
const shopifyOrders: any[] = [];
let shopifyOrderSeq = 7000;

(globalThis as any).fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
  const list = u.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\?(.*)$/);
  if (list) {
    const q = new URLSearchParams(list[1]);
    const from = Number(q.get('from') || 0), to = Number(q.get('to') || Number.MAX_SAFE_INTEGER);
    const count = Number(q.get('count') || 10), skip = Number(q.get('skip') || 0);
    const items = [...razorpayPayments.values()].filter(p => p.created_at >= from && p.created_at <= to).sort((a, b) => b.created_at - a.created_at).slice(skip, skip + count);
    return json(200, { entity: 'collection', count: items.length, items });
  }
  const one = u.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\/([^/?]+)$/);
  if (one) { const p = razorpayPayments.get(one[1]); return p ? json(200, { ...p }) : json(404, { error: { description: 'not found' } }); }
  const op = u.match(/^https:\/\/api\.razorpay\.com\/v1\/orders\/([^/?]+)\/payments$/);
  if (op) return json(200, { items: [...razorpayPayments.values()].filter(p => p.order_id === op[1]) });
  const o = u.match(/^https:\/\/api\.razorpay\.com\/v1\/orders\/([^/?]+)$/);
  if (o) {
    const paid = [...razorpayPayments.values()].some(p => p.order_id === o[1] && p.status === 'captured');
    const meta = razorpayOrders.get(o[1]);
    return json(200, { id: o[1], amount: meta?.amount ?? 1787800, currency: 'INR', status: paid ? 'paid' : 'created', notes: meta?.notes || {} });
  }
  if (u.includes('/admin/api/')) {
    if (u.endsWith('/graphql.json')) return json(200, { data: {} });
    if (u.includes('/orders.json') && (opt.method || 'GET') === 'POST') { const id = ++shopifyOrderSeq; shopifyOrders.push(JSON.parse(opt.body).order); return json(201, { order: { id, name: `#${id}` } }); }
    if (u.includes('/orders.json')) return json(200, { orders: [] });
    if (u.includes('/customers/search.json')) return json(200, { customers: [] });
    if (u.includes('/customers.json') && (opt.method || 'GET') === 'POST') return json(201, { customer: { id: 9100 + shopifyOrders.length, ...JSON.parse(opt.body).customer } });
    if (u.includes('/customers')) return json(200, { customers: [], customer: { id: 777 } });
    return json(200, {});
  }
  return json(200, {});
};

let failed = 0, passed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });
const settle = async (ms = 60) => { for (let i = 0; i < 100; i++) await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 100; i++) await new Promise(r => setImmediate(r)); };

async function main() {
  const { store } = await import('./snap-test-support/fake-db');
  const { default: FakeRazorpay } = await import('./snap-test-support/fake-razorpay');
  const mailer = await import('../lib/mailer');
  const svc = await import('../lib/services/razorpayReconcileService');
  const notice = await import('../lib/services/orderConfirmationNotice');
  const events = await import('../lib/razorpay-webhook-events');
  const client = await import('../lib/checkout-complete-client');
  const cron = await import('../app/api/cron/reconcile-razorpay/route');
  const { NextRequest } = await import('next/server');

  // Customer emails: capture at the SMTP transport. Admin emails: notifyAdminTeam →
  // sendZohoEmail logs "Missing configuration — email not sent: <subject>" without config.
  const sentMails: any[] = [];
  (mailer.transporter as any).sendMail = async (m: any) => { sentMails.push(m); return { messageId: `m${sentMails.length}` }; };
  const adminMails: string[] = [];
  const origWarn = console.warn.bind(console);
  console.warn = (...args: any[]) => { const line = args.map(String).join(' '); if (/email not sent/.test(line)) adminMails.push(line); };
  // Keep the run output readable: the real services log a lot.
  const origLog = console.log.bind(console); const origErr = console.error.bind(console);
  console.log = (...a: any[]) => { if (/^\n?(PASS|FAIL|—|\d+ passed)/.test(String(a[0]))) origLog(...a); };
  console.error = () => {};
  console.info = () => {};
  process.on('exit', () => { console.log = origLog; console.error = origErr; console.warn = origWarn; });

  const razorpay = new FakeRazorpay({});
  const run = (over: any = {}) => svc.reconcileRazorpayPayments({ razorpay, now: NOW, ...over });
  const reset = () => {
    store.orders.clear(); store.webStoreOrders.clear(); store.ledger.clear();
    store.webhookEvents.length = 0; store.syncLogs.length = 0; store.payments.length = 0; store.emailLogs.length = 0; store.customerEventDeliveries.length = 0; store.calls.length = 0;
    razorpayPayments.clear(); razorpayOrders.clear(); sentMails.length = 0; adminMails.length = 0;
  };
  const pay = (id: string, orderId: string | null, rupees: number, over: Partial<RzpPayment> = {}) =>
    razorpayPayments.set(id, { id, order_id: orderId, status: 'captured', captured: true, amount: Math.round(rupees * 100), amount_refunded: 0, currency: 'INR', created_at: Math.floor((NOW - 10 * MIN) / 1000), method: 'upi', notes: {}, ...over });
  const freshWebhook = () => store.webhookEvents.push({ id: 'wh_fresh', source: 'razorpay', eventType: 'payment.captured', eventKey: 'evt:fresh', processed: true, createdAt: new Date(NOW - 20 * MIN), payload: '{}' });
  const address = { name: 'Priya Sharma', email: 'priya.sharma@outlook.com', phone: '9811122233', street: '12 MG Road', city: 'Noida', state: 'Uttar Pradesh', zip: '201301', country: 'India' };
  const items = [
    { title: 'AEROLAYER DENIM', quantity: 2, price: 7439, image: 'https://cdn.example/denim.jpg', productId: null, variantId: '51813148262681', sku: '51813148262681' },
    { title: 'TEE', quantity: 1, price: 3000, image: 'https://cdn.example/tee.jpg', productId: null, variantId: '51813148328217', sku: '51813148328217' },
  ];
  // The incident's shape: what app/api/checkout/razorpay pre-creates.
  const mkOrder = (id: string, rzp: string, number: string, over: any = {}) => {
    const o = {
      id, razorpayOrderId: rzp, razorpayPaymentId: null, paymentStatus: 'pending', status: 'payment_pending', orderType: 'WEB_STORE',
      paymentMethod: 'razorpay', tags: `WebStoreOrder, Web, razorpay, zb-order-${number}, payment_pending, Order creation in process`,
      note: 'Order creation in process - Payment pending', totalPrice: 17878, subtotalPrice: 17878, discountAmount: 0, storeCreditAmount: 0, currency: 'INR',
      customerId: 'cust_1', internalOrderNumber: number, previousOrderNumbers: null, shopifyOrderId: null, shopifySyncStatus: 'pending', shopifySyncError: null,
      codUpfrontPaid: 0, codUpfrontPaymentId: null, paymentCapturedAt: null, createdAt: new Date(NOW - 20 * MIN),
      customer: { id: 'cust_1', email: address.email, phone: address.phone, name: address.name, shopifyId: '9001' },
      shippingAddress: JSON.stringify(address), billingAddress: JSON.stringify(address),
      items: items.map(i => ({ ...i })),
      ...over,
    };
    store.orders.set(id, o); return o;
  };
  const mkWs = (id: string, rzp: string, number: string, over: any = {}) => {
    const w = {
      id, orderNumber: number, razorpayOrderId: rzp, razorpayPaymentId: null, paymentStatus: 'payment_pending', paymentMethod: 'razorpay',
      customerName: address.name, customerEmail: address.email, customerPhone: address.phone, shippingAddress: address,
      items: items.map(i => ({ product_id: '', variant_id: i.variantId, title: i.title, image_url: i.image, quantity: i.quantity, price: i.price, size: '' })),
      subtotal: 17878, shippingCharge: 0, discountAmount: 0, totalAmount: 17878, codUpfrontPaid: 0, codUpfrontPaymentId: null, notes: null, paymentFailureReason: null,
      createdAt: new Date(NOW - 20 * MIN), ...over,
    };
    store.webStoreOrders.set(id, w); return w;
  };
  const order = (id: string) => store.orders.get(id);
  const ws = (id: string) => store.webStoreOrders.get(id);

  // ── (a) the incident ──────────────────────────────────────────────────────
  console.log('— (a) captured payment + pending pre-created order → marked paid once, email once, SyncLog, admin email');
  reset(); freshWebhook();
  mkOrder('ord_1', 'order_TvHp4uV2qbm2P8', 'ZBPP82722'); mkWs('ws_1', 'order_TvHp4uV2qbm2P8', 'ZBPP82722');
  pay('pay_TvHpd9l4Vbz104', 'order_TvHp4uV2qbm2P8', 17878);
  let r = await run(); await settle();
  eq('a: one captured payment seen, one order recovered, nothing else', [r.capturedSeen, r.recovered, r.orphanRecovered, r.mismatched, r.unresolved, r.ok], [1, 1, 0, 0, 0, true]);
  eq('a: Order is paid / approved with the payment id and a capture time', [order('ord_1').paymentStatus, order('ord_1').status, order('ord_1').razorpayPaymentId, Boolean(order('ord_1').paymentCapturedAt)], ['paid', 'approved', 'pay_TvHpd9l4Vbz104', true]);
  const promoted = order('ord_1').internalOrderNumber;
  check('a: ZBPP number promoted to a real ZB number, old number kept', /^ZB\d+$/.test(promoted) && order('ord_1').previousOrderNumbers === 'ZBPP82722', { promoted, prev: order('ord_1').previousOrderNumbers });
  eq('a: WebStoreOrder mirror is paid under the promoted number', [ws('ws_1').paymentStatus, ws('ws_1').orderNumber, ws('ws_1').razorpayPaymentId], ['paid', promoted, 'pay_TvHpd9l4Vbz104']);
  eq('a: one Payment row for the captured amount', store.payments.map(p => [p.orderId, p.amount, p.type]), [['ord_1', 17878, 'CAPTURE']]);
  eq('a: exactly one confirmation email, to the shopper, for the promoted number', [sentMails.length, sentMails[0]?.to, (sentMails[0]?.subject || '').includes(promoted)], [1, address.email, true]);
  check('a: the email is the checkout one (items, total, address)', /AEROLAYER DENIM/.test(sentMails[0]?.html || '') && /17878/.test(sentMails[0]?.html || '') && /Noida/.test(sentMails[0]?.html || ''));
  eq('a: order tagged confirmation_emailed; EmailLog + delivery ledger written once', [notice.hasOrderTag(order('ord_1').tags, notice.CONFIRMATION_EMAILED_TAG), store.emailLogs.length, store.customerEventDeliveries.map(d => d.status)], [true, 1, ['sent']]);
  eq('a: SyncLog CRON_PING_RAZORPAY_RECONCILE with the counts', [store.syncLogs.length, store.syncLogs[0]?.action, store.syncLogs[0]?.status, JSON.parse(store.syncLogs[0]?.payload || '{}').recovered], [1, 'CRON_PING_RAZORPAY_RECONCILE', 'SUCCESS', 1]);
  const html = r.adminEmailHtml || '';
  check('a: ONE admin email listing payment id, Razorpay order id, amount, local order and what was done', adminMails.length === 1 && r.adminEmailed && html.includes('pay_TvHpd9l4Vbz104') && html.includes('order_TvHp4uV2qbm2P8') && html.includes('17,878') && html.includes(promoted) && /pending → paid; confirmation emailed to priya.sharma@outlook.com/.test(html), { adminMails: adminMails.length, html: html.slice(0, 400) });
  check('a: webhook fresh → no dead-webhook line', !r.webhookDead && !/webhook has not delivered/.test(html));

  // ── (e) idempotent ────────────────────────────────────────────────────────
  console.log('\n— (e) repeated run → nothing changes');
  const before = JSON.stringify([order('ord_1'), ws('ws_1')]);
  r = await run(); await settle();
  eq('e: second run sees the payment, recovers nothing, emails nobody', [r.capturedSeen, r.recovered, r.lines.length, r.adminEmailed, adminMails.length, sentMails.length], [1, 0, 0, false, 1, 1]);
  check('e: order and mirror unchanged', JSON.stringify([order('ord_1'), ws('ws_1')]) === before);
  eq('e: SyncLog written per run; Payment row not duplicated', [store.syncLogs.length, store.payments.length], [2, 1]);

  // ── (b) orphan ────────────────────────────────────────────────────────────
  console.log('\n— (b) captured payment with no local order → placeholder recovery');
  reset(); freshWebhook();
  razorpayOrders.set('order_orphan1', { amount: 259900, notes: { email: 'guest@example.com', contact: '9999999999', name: 'Guest Buyer' } });
  pay('pay_orphan1', 'order_orphan1', 2599, { email: 'guest@example.com', contact: '9999999999' });
  r = await run(); await settle();
  const rec = [...store.orders.values()].find(o => o.razorpayOrderId === 'order_orphan1');
  eq('b: recovery called → placeholder order created, paid, held for review', [r.orphanRecovered, Boolean(rec), rec?.paymentStatus, rec?.shopifySyncStatus, (rec?.tags || '').includes('RazorpayRecovery'), rec?.razorpayPaymentId], [1, true, 'paid', 'needs_review', true, 'pay_orphan1']);
  check('b: recovery note names the reconciliation job', /reconciliation/.test(rec?.note || ''), rec?.note);
  eq('b: WebStoreOrder created for the dashboard; customer NOT emailed', [[...store.webStoreOrders.values()].some(w => w.razorpayOrderId === 'order_orphan1'), sentMails.length], [true, 0]);
  check('b: run email lists the orphan with the placeholder number', (r.adminEmailHtml || '').includes('pay_orphan1') && (r.adminEmailHtml || '').includes(rec?.internalOrderNumber || '???') && /placeholder order created/.test(r.adminEmailHtml || ''));
  check('b: admin notified (recovery notice + run report)', adminMails.length === 2, adminMails);

  // ── (c) amount mismatch ───────────────────────────────────────────────────
  console.log('\n— (c) paid order, captured amount differs → reported, not modified');
  reset(); freshWebhook();
  mkOrder('ord_3', 'order_3', 'ZB82723', { paymentStatus: 'paid', status: 'approved', razorpayPaymentId: 'pay_3', tags: 'WebStoreOrder, Web, razorpay, zb-order-ZB82723, paid', paymentCapturedAt: new Date(NOW - 9 * MIN) });
  pay('pay_3', 'order_3', 15000);
  const snap3 = JSON.stringify(order('ord_3'));
  r = await run(); await settle();
  eq('c: one mismatch reported, nothing recovered', [r.mismatched, r.recovered, r.lines[0]?.kind, r.lines[0]?.orderNumber], [1, 0, 'mismatch', 'ZB82723']);
  check('c: action says captured ₹15000 vs order total ₹17878', /captured ₹15000 vs order total ₹17878/.test(r.lines[0]?.action || ''), r.lines[0]?.action);
  check('c: order untouched, no update calls, no customer email', JSON.stringify(order('ord_3')) === snap3 && !store.calls.some(c => c.includes('ord_3')) && sentMails.length === 0, store.calls);
  check('c: admin email carries the mismatch row', adminMails.length === 1 && /Amount mismatch/.test(r.adminEmailHtml || '') && (r.adminEmailHtml || '').includes('15,000'));
  // second capture on an already-paid order
  reset(); freshWebhook();
  mkOrder('ord_3b', 'order_3b', 'ZB82724', { paymentStatus: 'paid', status: 'approved', razorpayPaymentId: 'pay_3b_first', tags: 'paid' });
  pay('pay_3b_first', 'order_3b', 17878); pay('pay_3b_second', 'order_3b', 17878);
  r = await run(); await settle();
  eq('c: a second capture on a paid order is reported as a refund candidate, order untouched', [r.mismatched, /second capture/.test(r.lines[0]?.action || ''), order('ord_3b').razorpayPaymentId, sentMails.length], [1, true, 'pay_3b_first', 0]);

  // ── (d) COD upfront ───────────────────────────────────────────────────────
  console.log('\n— (d) COD upfront ₹99 vs order total → not reported');
  reset(); freshWebhook();
  mkOrder('ord_4', 'order_4', 'ZB82725', { paymentMethod: 'cod', paymentStatus: 'cod_upfront_paid', status: 'open', razorpayPaymentId: 'pay_4', codUpfrontPaid: 99, codUpfrontPaymentId: 'pay_4', totalPrice: 2599, subtotalPrice: 2599, tags: 'WebStoreOrder, Web, cod, zb-order-ZB82725, cod_upfront_paid' });
  pay('pay_4', 'order_4', 99);
  r = await run(); await settle();
  eq('d: ₹99 upfront on a ₹2,599 COD order → no finding, no email', [r.capturedSeen, r.mismatched, r.lines.length, r.adminEmailed, adminMails.length], [1, 0, 0, false, 0]);
  // and a pending COD order whose ₹99 was captured → cod_upfront_paid + COD email
  reset(); freshWebhook();
  mkOrder('ord_4b', 'order_4b', 'ZBPP82726', { paymentMethod: 'cod', tags: 'WebStoreOrder, Web, cod, zb-order-ZBPP82726, payment_pending, Order creation in process', totalPrice: 2599, subtotalPrice: 2599 });
  mkWs('ws_4b', 'order_4b', 'ZBPP82726', { paymentMethod: 'cod', totalAmount: 2599, subtotal: 2599 });
  pay('pay_4b', 'order_4b', 99);
  r = await run(); await settle();
  eq('d: pending COD + ₹99 capture → cod_upfront_paid / open, mirror in step, COD email once', [r.recovered, order('ord_4b').paymentStatus, order('ord_4b').status, Number(order('ord_4b').codUpfrontPaid), ws('ws_4b').paymentStatus, sentMails.length, /COD Order Confirmed/.test(sentMails[0]?.subject || '')], [1, 'cod_upfront_paid', 'open', 99, 'cod_upfront_paid', 1, true]);

  // ── (f) dead webhook ──────────────────────────────────────────────────────
  console.log('\n— (f) dead-webhook line when the newest processed WebhookEvent is stale');
  reset();
  store.webhookEvents.push({ id: 'wh_stale', source: 'razorpay', eventType: 'payment.captured', eventKey: 'evt:stale', processed: true, createdAt: new Date(NOW - 5 * HOUR), payload: '{}' });
  store.webhookEvents.push({ id: 'wh_unproc', source: 'razorpay', eventType: 'payment.captured', eventKey: 'evt:unproc', processed: false, createdAt: new Date(NOW - 10 * MIN), payload: '{}' });
  mkOrder('ord_6', 'order_6', 'ZBPP82727'); mkWs('ws_6', 'order_6', 'ZBPP82727');
  pay('pay_6', 'order_6', 17878);
  r = await run(); await settle();
  check('f: webhookDead with the stale time; email carries the exact line', r.webhookDead && r.webhookLastDeliveryAt === new Date(NOW - 5 * HOUR).toISOString()
    && /Razorpay webhook has not delivered since .* IST — check Settings → Webhooks \(it was found Disabled on 2 Nov\)/.test(r.adminEmailHtml || ''), { dead: r.webhookDead, at: r.webhookLastDeliveryAt, html: (r.adminEmailHtml || '').match(/Razorpay webhook[^<]*/)?.[0] });
  eq('f: the order was still recovered in the same run', [r.recovered, order('ord_6').paymentStatus], [1, 'paid']);
  // the line alone (nothing else to report) is emailed once, then reminder-limited
  reset();
  store.webhookEvents.push({ id: 'wh_stale2', source: 'razorpay', eventType: 'order.paid', eventKey: 'evt:stale2', processed: true, createdAt: new Date(NOW - 3 * HOUR), payload: '{}' });
  mkOrder('ord_6b', 'order_6b', 'ZB82728', { paymentStatus: 'paid', status: 'approved', razorpayPaymentId: 'pay_6b', tags: 'paid' });
  pay('pay_6b', 'order_6b', 17878);
  r = await run(); await settle();
  const r2 = await run(); await settle();
  eq('f: dead webhook as the only finding → one email, not repeated 15 min later', [r.lines.length, r.webhookDead, r.adminEmailed, r2.webhookDead, r2.adminEmailed, adminMails.length], [0, true, true, true, false, 1]);
  reset(); freshWebhook();
  r = await run(); await settle();
  eq('f: no captures seen → never a dead-webhook verdict, no email', [r.capturedSeen, r.webhookDead, r.adminEmailed, adminMails.length], [0, false, false, 0]);

  // ── (g) checkout.complete.retry rows ──────────────────────────────────────
  console.log('\n— (g) checkout-complete retry row gets finished');
  reset(); freshWebhook();
  mkOrder('ord_7', 'order_7', 'ZBPP82729'); mkWs('ws_7', 'order_7', 'ZBPP82729');
  // The capture is 5 h old — outside the 3 h window — so only the retry row brings it in.
  pay('pay_7', 'order_7', 17878, { created_at: Math.floor((NOW - 5 * HOUR) / 1000) });
  const completeBody = { address, items: items.map(i => ({ productId: '10227656982809', variantId: i.variantId, title: i.title, price: String(i.price), quantity: i.quantity })), subtotal: 17878, total: 17878, paymentMethod: 'razorpay', localOrderId: 'ord_7', razorpay: { razorpay_order_id: 'order_7', razorpay_payment_id: 'pay_7', razorpay_signature: 'sig' } };
  store.webhookEvents.push({ id: 'wh_retry', source: events.CHECKOUT_COMPLETE_RETRY_SOURCE, eventType: events.CHECKOUT_COMPLETE_RETRY_EVENT, eventKey: events.checkoutCompleteRetryKey('pay_7'), processed: false, createdAt: new Date(NOW - 3 * MIN), payload: JSON.stringify(completeBody) });
  // Too young (browser is still retrying) and not captured (authorized only): both left alone.
  mkOrder('ord_7y', 'order_7y', 'ZBPP82730'); pay('pay_7y', 'order_7y', 17878, { created_at: Math.floor((NOW - 5 * HOUR) / 1000) });
  store.webhookEvents.push({ id: 'wh_retry_young', source: events.CHECKOUT_COMPLETE_RETRY_SOURCE, eventType: events.CHECKOUT_COMPLETE_RETRY_EVENT, eventKey: events.checkoutCompleteRetryKey('pay_7y'), processed: false, createdAt: new Date(NOW - 20_000), payload: JSON.stringify({ razorpay: { razorpay_order_id: 'order_7y', razorpay_payment_id: 'pay_7y' } }) });
  mkOrder('ord_7a', 'order_7a', 'ZBPP82731'); pay('pay_7a', 'order_7a', 17878, { status: 'authorized', captured: false, created_at: Math.floor((NOW - 5 * HOUR) / 1000) });
  store.webhookEvents.push({ id: 'wh_retry_auth', source: events.CHECKOUT_COMPLETE_RETRY_SOURCE, eventType: events.CHECKOUT_COMPLETE_RETRY_EVENT, eventKey: events.checkoutCompleteRetryKey('pay_7a'), processed: false, createdAt: new Date(NOW - 3 * MIN), payload: JSON.stringify({ razorpay: { razorpay_order_id: 'order_7a', razorpay_payment_id: 'pay_7a' } }) });
  r = await run(); await settle();
  const retryRow = store.webhookEvents.find(e => e.id === 'wh_retry');
  eq('g: the retry row is picked up (capture outside the window), order marked paid, email sent, row processed with the order id', [r.capturedSeen, r.retryRowsSeen, r.recovered, order('ord_7').paymentStatus, sentMails.length, retryRow?.processed, retryRow?.orderId], [0, 2, 1, 'paid', 1, true, 'ord_7']);
  eq('g: a row younger than 1 min is not touched; an uncaptured payment leaves row and order alone', [store.webhookEvents.find(e => e.id === 'wh_retry_young')?.processed, store.webhookEvents.find(e => e.id === 'wh_retry_auth')?.processed, order('ord_7y').paymentStatus, order('ord_7a').paymentStatus], [false, false, 'pending', 'pending']);
  r = await run(); await settle();
  eq('g: second run → the finished row is not reprocessed, nothing resent', [r.retryRowsSeen, r.recovered, sentMails.length], [1, 0, 1]);
  // Recording: the same payment id twice yields one row.
  reset();
  const rec1 = await events.recordCheckoutCompleteRetry({ razorpayPaymentId: 'pay_rec', payload: '{"razorpay":{"razorpay_payment_id":"pay_rec"}}' });
  const rec2 = await events.recordCheckoutCompleteRetry({ razorpayPaymentId: 'pay_rec', payload: '{}' });
  eq('g: recordCheckoutCompleteRetry is idempotent per payment id (eventKey unique)', [rec1.recorded, Boolean(rec1.id), rec2.recorded, rec2.reason, store.webhookEvents.length, store.webhookEvents[0]?.source, store.webhookEvents[0]?.eventType], [true, true, true, 'in_flight', 1, 'checkout', 'checkout.complete.retry']);

  // ── /complete browser retry policy ────────────────────────────────────────
  console.log('\n— browser: postCheckoutComplete retries 5xx / 429 / network with 2 s, 5 s, 10 s; never 4xx');
  const mkRes = (status: number, body: any) => ({ status, ok: status < 400, json: async () => body }) as any;
  const script = async (answers: Array<number | 'throw'>) => {
    const calls: number[] = []; const slept: number[] = [];
    let i = 0;
    const fetchImpl: any = async () => { const a = answers[Math.min(i, answers.length - 1)]; calls.push(++i); if (a === 'throw') throw new TypeError('Failed to fetch'); return mkRes(a, a === 503 ? { retry: true } : a === 200 ? { orderId: 'ord_x' } : { error: 'bad' }); };
    try {
      const out = await client.postCheckoutComplete({ x: 1 }, { fetchImpl, sleep: async (ms) => { slept.push(ms); }, pollMs: 1, maxWaitMs: 10 });
      return { calls: calls.length, slept, status: out.res?.status, data: out.data };
    } catch (err: any) { return { calls: calls.length, slept, threw: err?.message }; }
  };
  eq('503 {retry:true} twice then 200 → three attempts, 2 s + 5 s backoff, success', await script([503, 503, 200]), { calls: 3, slept: [2000, 5000], status: 200, data: { orderId: 'ord_x' } });
  eq('400 → one attempt, no retry', await script([400]), { calls: 1, slept: [], status: 400, data: { error: 'bad' } });
  eq('429 then 200 → retried once', await script([429, 200]), { calls: 2, slept: [2000], status: 200, data: { orderId: 'ord_x' } });
  eq('network error four times → gives up after 3 retries (2/5/10 s) and throws', await script(['throw']), { calls: 4, slept: [2000, 5000, 10000], threw: 'Failed to fetch' });
  eq('500 four times → the last response is returned for the page\'s fallback lookup', await script([500]), { calls: 4, slept: [2000, 5000, 10000], status: 500, data: { error: 'bad' } });

  // ── cron route auth ───────────────────────────────────────────────────────
  console.log('\n— cron route: CRON_SECRET required; no credentials → skipped, 200');
  const call = (headers: Record<string, string> = {}) => cron.GET(new NextRequest('https://app.zicabella.com/api/cron/reconcile-razorpay', { headers }));
  eq('wrong / missing secret → 401', [(await call()).status, (await call({ authorization: 'Bearer nope' })).status], [401, 401]);
  const savedKey = process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_ID;
  reset();
  const okRes = await call({ authorization: 'Bearer cron_test_secret' }); const okJson = await okRes.json();
  eq('correct Bearer, Razorpay keys not configured → 200 with skipped:no_credentials and a SyncLog row', [okRes.status, okJson.success, okJson.skipped, store.syncLogs[0]?.status, 'adminEmailHtml' in okJson], [200, true, 'no_credentials', 'SKIPPED', false]);
  process.env.RAZORPAY_KEY_ID = savedKey;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { process.stderr.write(String(e?.stack || e) + '\n'); process.exit(1); });
