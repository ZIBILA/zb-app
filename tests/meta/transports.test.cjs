const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const immediateTimers = { setTimeout: fn => { queueMicrotask(fn); return 1; }, clearTimeout() {} };
function memoryStorage() { const data = new Map(); return { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; }
const next = { NextResponse: { json: (body, init) => { const r = Response.json(body, init); r.cookies = { set() {} }; return r; } } };

test('current checkout ignores stale cached amount and shares one browser/server ID', async () => {
  const storage = memoryStorage(); storage.setItem('zb_meta_rv_v2', JSON.stringify({ v: 9000, c: 'USD', contents: [{ id: 'WRONG' }] }));
  const calls = [], requests = [];
  const h = loader({ '@/lib/metaPixel': { trackEvent: (...a) => calls.push(a), initPixel() {}, getMetaIdentityCookies: () => ({}), getClientCookie: () => null },
    '@/lib/gtag': { event() {} }, '@/lib/meta-purchase-client': { trackVerifiedPurchase() {} } },
  { window: { location: { href: 'https://example.test/checkout' } }, navigator: { userAgent: 'browser' }, sessionStorage: storage,
    fetch: async (url, opts) => { requests.push(JSON.parse(opts.body)); return new Response('', { status: 502 }); } });
  const hooks = h.load('hooks/useMetaEvents.ts').useMetaEvents();
  hooks.trackInitiateCheckout(4000, 2, 'INR', '', ['123'], {}, [{ id: '123', quantity: 2, item_price: 2000 }]);
  await new Promise(setImmediate);
  assert.equal(calls[0][1].value, 4000); assert.equal(calls[0][1].currency, 'INR');
  assert.equal(calls[0][1].contents[0].id, '123'); assert.equal(calls[0][2], requests[0].eventId);
});
test('browser retries after a failed SDK queue without setting a sent flag early', async () => {
  const storage = memoryStorage(); const calls = []; let count = 0;
  const h = loader({ 'lib/metaPixel.ts': { trackEvent: async (...args) => { calls.push(args); assert.equal(storage.getItem('meta_purchase_queued_v3_o1'), null); return ++count > 1; } } },
    { ...immediateTimers, sessionStorage: storage, fetch: async () => Response.json({ eventId: 'o1', customData: { value: 4000, currency: 'INR', contents: [{ id: '123' }] } }) });
  assert.equal(await h.load('lib/meta-purchase-client.ts').trackVerifiedPurchase('o1'), true);
  assert.equal(calls.length, 2); assert.equal(calls[0][2], calls[1][2]); assert.equal(storage.getItem('meta_purchase_queued_v3_o1'), 'true');
});
test('unverified order never fires browser Purchase, including with old cached data', async () => {
  const storage = memoryStorage(); storage.setItem('zb_meta_rv_v2', '{"v":9000}');
  const h = loader({ 'lib/metaPixel.ts': { trackEvent: () => assert.fail('unverified Purchase') } },
    { ...immediateTimers, sessionStorage: storage, fetch: async () => Response.json({ ready: false }, { status: 404 }) });
  assert.equal(await h.load('lib/meta-purchase-client.ts').trackVerifiedPurchase('unpaid'), false);
  assert.equal(storage.getItem('meta_purchase_queued_v3_unpaid'), null);
});
test('concurrent browser calls queue one Purchase from the canonical server payload', async () => {
  let calls = 0;
  const h = loader({ 'lib/metaPixel.ts': { trackEvent: async (name, payload, id) => { calls++; assert.equal(payload.value, 123.45); assert.equal(payload.currency, 'USD'); assert.equal(id, 'o1'); return true; } } },
    { sessionStorage: memoryStorage(), fetch: async () => Response.json({ eventId: 'o1', customData: { value: 123.45, currency: 'USD' } }) });
  const track = h.load('lib/meta-purchase-client.ts').trackVerifiedPurchase;
  await Promise.all([track('o1'), track('o1')]); assert.equal(calls, 1);
});
test('missing pixel SDK is an unsuccessful queue attempt and can be retried', async () => {
  const h = loader({}, { ...immediateTimers, window: {}, document: { cookie: '' } });
  const pixel = h.load('lib/metaPixel.ts');
  assert.equal(await pixel.trackEvent('Purchase', { value: 100 }, 'order1'), false);
  h.context.window.fbq = (...args) => { assert.equal(args[3].eventID, 'order1'); };
  assert.equal(await pixel.trackEvent('Purchase', { value: 100 }, 'order1'), true);
});
test('advanced matching helper never reinitializes the layout-owned pixel', () => {
  const calls = [];
  const h = loader({}, { window: { fbq: (...a) => calls.push(a) }, document: { cookie: '' } });
  const pixel = h.load('lib/metaPixel.ts');
  pixel.initPixel({ em: 'person1@example.test' }); pixel.initPixel({ em: 'person2@example.test' });
  assert.equal(calls.length, 0);
});
test('private, loopback, malformed and unknown visitor IPs are omitted', () => {
  const { publicClientIp, requestClientIp } = loader().load('lib/client-ip.ts');
  for (const ip of ['127.0.0.2', '10.0.0.1', '192.168.1.1', '172.16.1.1', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '999.1.1.1', 'x', '']) assert.equal(publicClientIp(ip), undefined, ip);
  assert.equal(requestClientIp(new Request('https://x.test', { headers: { cookie: 'zb_client_ip=8.8.8.8' } })), undefined);
  assert.equal(requestClientIp(new Request('https://x.test', { headers: { 'do-connecting-ip': '8.8.4.4', 'x-forwarded-for': '1.1.1.1', cookie: 'zb_client_ip=127.0.0.1' } })), '8.8.4.4');
  assert.equal(publicClientIp('2606:4700:4700::1111'), '2606:4700:4700::1111');
});
test('CAPI requires positive events_received, not just HTTP 200', async () => {
  for (const response of [{}, { events_received: 0 }, { error: { code: 190 } }, { events_received: 1 }]) {
    let payload;
    const h = loader({}, { fetch: async (url, opts) => { payload = JSON.parse(opts.body); return Response.json(response); } });
    const result = await h.load('lib/metaCapi.ts').sendCapiEvent({ eventName: 'Purchase', eventId: 'o1', eventSourceUrl: 'https://example.test/confirmation', userAgent: 'browser', customData: { value: 4000, currency: 'INR' }, userData: { em: 'a'.repeat(64), external_id: 'b'.repeat(64) } });
    assert.equal(result.success, response.events_received === 1);
    assert.equal(payload.data[0].event_id, 'o1'); assert.equal(payload.data[0].user_data.em[0], 'a'.repeat(64));
  }
});
function routeFixture(send) {
  const h = loader({ 'next/server': next, '@/lib/metaCapi': { sendCapiEvent: send, getReportedValue: (n, v) => v },
    'next-auth/next': { getServerSession: async () => null }, '@/app/api/auth/[...nextauth]/options': { authOptions: {} }, 'lib/db.ts': {},
    '@/lib/metaPixel': { DEMO_PHONES_RAW: [], DEMO_EMAILS_RAW: [] } });
  const route = h.load('app/api/meta/event/route.ts');
  function request(eventName) {
    const req = new Request('https://example.test/api/meta/event', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'real-UA', 'do-connecting-ip': '8.8.4.4' },
      body: JSON.stringify({ eventName, eventId: 'test-id', eventSourceUrl: 'https://example.test/', userAgent: 'claimed-UA', customData: { value: 4000, currency: 'INR' } }) });
    req.cookies = { get: key => key === 'zb_client_ip' ? { value: '127.0.0.1' } : undefined };
    return req;
  }
  return { route, request };
}
test('public Meta endpoint rejects browser-supplied Purchase', async () => {
  const f = routeFixture(() => assert.fail('must not forward Purchase'));
  assert.equal((await f.route.POST(f.request('Purchase'))).status, 403);
});
test('Meta route omits unknown geography without running the shared geo fallback', async () => {
  let sent;
  const f = routeFixture(async payload => { sent = payload; return { success: true }; });
  assert.equal((await f.route.POST(f.request('InitiateCheckout'))).status, 200);
  assert.equal(sent.userData.ct, undefined); assert.equal(sent.userData.st, undefined);
});
test('checkout API waits for Meta acceptance and returns failure honestly', async () => {
  let finish, payload;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = routeFixture(p => { payload = p; return pending; });
  let resolved = false;
  const response = f.route.POST(f.request('InitiateCheckout')).then(r => { resolved = true; return r; });
  await new Promise(setImmediate); assert.equal(resolved, false);
  assert.equal(payload.userData.client_ip_address, '8.8.4.4'); assert.equal(payload.userData.client_user_agent, 'real-UA');
  finish({ success: false }); assert.equal((await response).status, 502);
});
test('web storefront bridge remains local even with WhatsApp Meta forwarding enabled', async () => {
  const db = { whatsAppEvent: { create: async () => ({ id: 'evt' }), update: async () => ({}) },
    whatsAppSetting: { findMany: async () => [{ key: 'enable_meta_events', value: 'true' }] } };
  const h = loader({ 'lib/db.ts': db, axios: { post: () => assert.fail('website event forwarded as WhatsApp') } });
  await h.load('lib/services/eventTracker.ts').eventTracker.track({ eventName: 'Purchase Completed', eventSource: 'web', orderId: 'o1' });
});

function checkoutFixture(failAt) {
  const orders = [], captures = []; let ids = 0, gatewayIds = 0, metaRow = null;
  const db = { shop: { findFirst: async () => ({ id: 'shop1' }) }, product: { findUnique: async () => null }, webStoreOrder: { create: async () => ({}), findFirst: async () => null },
    order: { create: async ({ data }) => { if (failAt === 'order') throw new Error('offline'); const order = { ...data, items: data.items.create, id: `local${++ids}` }; orders.push(order); return order; },
      findUnique: async ({ where }) => orders.find(o => o.id === where.id),
      findFirst: async () => orders[0] || null,
      update: async ({ where, data }) => { const order = orders.find(o => o.id === where.id); Object.assign(order, data); return order; } },
    lineItem: { deleteMany: async ({ where }) => { orders.find(o => o.id === where.orderId).items = []; },
      createMany: async ({ data }) => { if (data.length) orders.find(o => o.id === data[0].orderId).items = data; } },
    metaPurchase: {
      findUnique: async () => metaRow && structuredClone(metaRow),
      create: async ({ data }) => { if (failAt === 'outbox' || metaRow) throw new Error('offline or duplicate'); metaRow = { status: 'awaiting_payment', capturedAt: null, attempts: 0, ...data }; captures.push(metaRow); return metaRow; },
      updateMany: async ({ where, data }) => {
        if (!metaRow || metaRow.orderId !== where.orderId || metaRow.status !== where.status || (where.capturedAt === null && metaRow.capturedAt !== null)) return { count: 0 };
        Object.assign(metaRow, data); return { count: 1 };
      },
    } };
  class Razorpay { constructor() { this.orders = { create: async opts => ({ id: `order_${++gatewayIds}`, amount: opts.amount, currency: opts.currency }) }; } }
  const h = loader({ 'next/server': next, razorpay: Razorpay, 'lib/db.ts': db,
    '@/lib/rate-limit': { checkRateLimit: async () => ({ allowed: true }) },
    '@/lib/services/customerService': { resolveAndSyncCustomerAddress: async () => ({ customer: { id: 'customer1' } }) },
    '@/lib/global-pricing': { toMinorUnits: x => Math.round(x * 100) },
    '@/lib/orderNumber': { assignFailedOrderNumber: async () => `ZBPP${orders.length + 1}` },
    '@/lib/razorpay-credentials': { resolveRazorpayCredentials: () => assert.fail('existing checkout credential resolver must be preserved') } });
  Object.assign(h.context.process.env, { RAZORPAY_KEY_ID: 'rzp_live_test', RAZORPAY_KEY_SECRET: 'secret' });
  const route = h.load('app/api/checkout/razorpay/route.ts');
  const request = () => new Request('https://example.test/api/checkout/razorpay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    address: { name: 'Test Buyer', phone: '9876543210', country: 'India', street: 'Test' }, items: [{ variantId: '123', title: 'Product', quantity: 2, price: 2000 }], amount: 99, subtotal: 4000, total: 4000, paymentMethod: 'COD', codFee: 99, checkoutSessionId: 'same-session' }) });
  return { route, request, captures, orders };
}
test('existing payment response is preserved when order or advertising storage fails', async () => {
  for (const failAt of ['order', 'outbox']) {
    const f = checkoutFixture(failAt); const response = await f.route.POST(f.request());
    assert.equal(response.status, 200, failAt); assert.equal((await response.json()).razorpay_order_id, 'order_1');
  }
});
test('pending checkout reuse remains unchanged while the advertising attempt refreshes', async () => {
  const f = checkoutFixture();
  for (let i = 0; i < 2; i++) assert.equal((await f.route.POST(f.request())).status, 200);
  assert.equal(f.orders.length, 1); assert.equal(f.captures.length, 1);
  assert.equal(f.orders[0].razorpayOrderId, 'order_2'); assert.equal(f.captures[0].razorpayOrderId, 'order_2');
  assert.equal(f.captures[0].snapshot.value, 4000); assert.equal(f.captures[0].expectedAmountMinor, 9900);
});

test('wallet observer and cookie errors cannot replace a successful checkout response', async () => {
  const response = Response.json({ orderId: 'local1' });
  const h = loader({ 'lib/meta-purchases.ts': {
    checkoutBrowserToken: () => 'a'.repeat(64), prepareStoreCreditPurchase: async () => { throw new Error('DB unavailable'); },
    setPurchaseCookie: () => { throw new Error('cookie unavailable'); },
  } });
  const observer = h.load('lib/meta-checkout-observer.ts');
  assert.equal(await observer.observeMetaWalletCheckout(new Request('https://example.test/'), 'local1', 'customer1'), undefined);
  assert.equal(observer.attachMetaWalletCookie(response, 'token'), response);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { orderId: 'local1' });
});

test('an unresponsive advertising database has a bounded checkout delay', async () => {
  const response = Response.json({ razorpay_order_id: 'order_1' });
  let deadline;
  const h = loader({ 'lib/meta-purchases.ts': {
    checkoutBrowserToken: () => 'a'.repeat(64), prepareMetaPurchase: () => new Promise(() => {}),
    setPurchaseCookie: () => assert.fail('snapshot has not been persisted'),
  } }, { setTimeout: (callback, ms) => { deadline = ms; queueMicrotask(callback); return 1; }, clearTimeout() {} });
  const result = await h.load('lib/meta-checkout-observer.ts').attachMetaCheckoutContext(new Request('https://example.test/'), response,
    { orderId: 'local1', gateway: { id: 'order_1', amount: 9900, currency: 'INR', live: true } });
  assert.equal(result, response); assert.equal(deadline, 1000); assert.equal(result.status, 200);
});
