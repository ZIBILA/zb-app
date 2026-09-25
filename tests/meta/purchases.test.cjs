const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const token = 'a'.repeat(64);
function fixture() {
  let row = null;
  const order = { id: 'local1', razorpayOrderId: 'order_1', customerId: 'customer1', currency: 'INR', totalPrice: 4000,
    storeCreditAmount: 0, status: 'payment_pending', paymentStatus: 'pending', paymentMethod: 'cod',
    shippingAddress: JSON.stringify({ name: 'Asha Shah', email: 'asha@example.test', phone: '9876543210', country: 'India', city: 'Pune' }),
    items: [{ sku: 'variant:123', quantity: 2, price: 2000 }] };
  function matches(data, where) {
    return Object.entries(where).every(([key, value]) => {
      if (key === 'OR') return value.some(w => matches(data, w));
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('lte' in value) return data[key] <= value.lte;
        if ('lt' in value) return data[key] < value.lt;
      }
      return data[key] === value;
    });
  }
  const db = { order: { findUnique: async () => order },
    storeCredit: { aggregate: async () => ({ _sum: { amount: -Number(order.storeCreditAmount || 0) }, _max: { createdAt: new Date() } }) },
    metaPurchase: {
      create: async ({ data }) => { if (row) throw new Error('unique'); row = { status: 'awaiting_payment', attempts: 0, availableAt: new Date(), createdAt: new Date(), capturedAt: null, verifiedPaymentId: null, ...data }; return row; },
      upsert: async ({ create }) => row || db.metaPurchase.create({ data: create }),
      findUnique: async ({ where }) => row && matches(row, where) ? structuredClone(row) : null,
      updateMany: async ({ where, data }) => {
        if (!row || !matches(row, where)) return { count: 0 };
        for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
        return { count: 1 };
      },
    } };
  const loaded = loader({ 'lib/db.ts': db,
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } } });
  const api = loaded.load('lib/meta-purchases.ts');
  const policy = loaded.load('lib/meta-purchase-policy.ts');
  const req = new Request('https://zicabella.com/api/checkout/razorpay', { headers: { 'user-agent': 'browser-A', 'do-connecting-ip': '8.8.4.4', cookie: `zb_meta_checkout=${token}; _fbp=fb.1.1770000000000.123; _fbc=fb.1.1770000000000.click_A; zb_external_id=visitorA; zb_client_ip=127.0.0.1` } });
  const payment = { id: 'pay_1', order_id: 'order_1', amount: 9900, currency: 'INR', status: 'captured', captured: true, amount_refunded: 0 };
  const prepare = () => api.prepareMetaPurchase(req, order.id, { id: 'order_1', amount: 9900, currency: 'INR', live: true }, token, db);
  const capture = () => api.recordCapturedPurchase(payment, new Date(), db);
  return { api, policy, loaded, db, order, req, payment, prepare, capture, get row() { return row; } };
}

test('unpaid confirmation has no browser Purchase or server delivery', async () => {
  const f = fixture(); await f.prepare();
  assert.equal(await f.api.browserPurchase(f.req, 'local1', f.db), null);
  assert.equal(await f.api.dispatchMetaPurchase('local1', f.db, () => assert.fail('must not send')), 'not_claimed');
});
test('COD deposit binds to INR 4,000 order and exact products, not INR 99 receipt', async () => {
  const f = fixture(); await f.prepare(); await f.capture();
  const result = await f.api.browserPurchase(f.req, 'local1', f.db);
  assert.equal(result.customData.value, 4000); assert.equal(result.customData.contents[0].id, '123');
  assert.equal(f.row.expectedAmountMinor, 9900); assert.equal(f.row.currency, 'INR');
});
test('payment binding rejects authorization, wrong currency, amount, order, or refund', async () => {
  for (const changes of [{ status: 'authorized', captured: false }, { currency: 'USD' }, { amount: 100 }, { order_id: 'order_2' }, { amount_refunded: 99 }]) {
    const f = fixture(); await f.prepare();
    assert.equal(f.policy.validateCapturedPayment(f.row, { ...f.payment, ...changes }), false);
  }
});
test('captured receipt is durable without a confirmation-page visit', async () => {
  const f = fixture(); await f.prepare(); await f.capture();
  let sent;
  assert.equal(await f.api.dispatchMetaPurchase('local1', f.db, async p => { sent = p; return { success: true }; }), 'sent');
  assert.equal(sent.eventName, 'Purchase'); assert.equal(sent.eventId, f.order.id); assert.equal(sent.customData.value, 4000);
  assert.equal(f.row.status, 'sent');
});
test('duplicate callbacks preserve ID, event time and successful delivery state', async () => {
  const f = fixture(); await f.prepare(); await f.capture(); const eventTime = +f.row.capturedAt;
  let calls = 0;
  await f.api.dispatchMetaPurchase('local1', f.db, async () => { calls++; return { success: true }; });
  await f.api.recordCapturedPurchase(f.payment, new Date(Date.now() + 5000), f.db);
  await f.api.dispatchMetaPurchase('local1', f.db, () => assert.fail('duplicate delivery'));
  assert.equal(calls, 1); assert.equal(+f.row.capturedAt, eventTime); assert.equal(f.row.status, 'sent');
});
test('concurrent workers obtain one atomic lease', async () => {
  const f = fixture(); await f.prepare(); await f.capture(); let calls = 0;
  const results = await Promise.all([1, 2, 3].map(() => f.api.dispatchMetaPurchase('local1', f.db, async () => { calls++; return { success: true }; })));
  assert.equal(calls, 1); assert.equal(results.filter(x => x === 'sent').length, 1);
});
test('Meta rejection is retried with identical event ID, time and value', async () => {
  const f = fixture(); await f.prepare(); await f.capture(); const payloads = [];
  const send = async p => { payloads.push(p); return { success: payloads.length > 1 }; };
  assert.equal(await f.api.dispatchMetaPurchase('local1', f.db, send), 'pending');
  assert.equal(f.row.sentAt, undefined); assert.equal(f.row.lastError, 'delivery_failed');
  f.row.availableAt = new Date(0);
  assert.equal(await f.api.dispatchMetaPurchase('local1', f.db, send), 'sent');
  assert.deepEqual(JSON.parse(JSON.stringify(payloads[0])), JSON.parse(JSON.stringify(payloads[1])));
});
test('expired worker lease is recoverable with stable deduplication key', async () => {
  const f = fixture(); await f.prepare(); await f.capture();
  Object.assign(f.row, { status: 'sending', leaseToken: 'crashed-worker', leaseExpiresAt: new Date(0) });
  assert.equal(await f.api.dispatchMetaPurchase('local1', f.db, async p => ({ success: p.eventId === 'local1' })), 'sent');
});
test('cancelled, failed, refunded and placeholder orders never send', async () => {
  for (const mutate of [o => o.cancelledAt = new Date(), o => o.paymentStatus = 'failed', o => o.refundId = 'refund1', o => o.items[0].sku = 'WEBHOOK-RECOVERED-PLACEHOLDER']) {
    const f = fixture(); await f.prepare(); await f.capture(); mutate(f.order);
    assert.equal(await f.api.browserPurchase(f.req, 'local1', f.db), null);
    await f.api.dispatchMetaPurchase('local1', f.db, () => assert.fail('ineligible order sent'));
  }
});
test('checkout snapshot cannot be replaced by a same-price different cart', async () => {
  const f = fixture(); await f.prepare(); await f.capture(); f.order.items[0].sku = '999';
  assert.equal(await f.api.browserPurchase(f.req, 'local1', f.db), null);
});
test('legacy/recovered orders without a new checkout snapshot are not replayed', async () => {
  const f = fixture(); assert.equal(await f.capture(), null); assert.equal(f.row, null);
});
test('purchase access requires the checkout secret, not an arbitrary order ID', async () => {
  const f = fixture(); await f.prepare(); await f.capture();
  assert.equal(await f.api.browserPurchase(new Request(f.req.url), 'local1', f.db), null);
  assert.equal(await f.api.browserPurchase(new Request(f.req.url, { headers: { cookie: `zb_meta_checkout=${'b'.repeat(64)}` } }), 'local1', f.db), null);
  assert.ok(await f.api.browserPurchase(f.req, 'local1', f.db));
});
test('captured browser attribution survives cookie/guest identity reset', async () => {
  const f = fixture(); await f.prepare();
  assert.equal(f.row.userData.client_ip_address, '8.8.4.4'); assert.equal(f.row.userData.fbc, 'fb.1.1770000000000.click_A');
  assert.match(f.row.userData.em, /^[a-f0-9]{64}$/); assert.equal(f.row.userData.client_user_agent, 'browser-A');
  assert.ok(!JSON.stringify(f.row.userData).includes('asha@'));
});
test('test-mode and expired deduplication-window events never enter the live dataset', async () => {
  for (const mutate of [r => r.live = false, r => r.capturedAt = new Date(Date.now() - 49 * 3600000)]) {
    const f = fixture(); await f.prepare(); await f.capture(); mutate(f.row);
    assert.equal(await f.api.dispatchMetaPurchase('local1', f.db, () => assert.fail('must not send')), 'blocked');
  }
});
test('browser duplicates older than the deduplication window are suppressed', async () => {
  const f = fixture(); await f.prepare(); await f.capture(); f.row.capturedAt = new Date(Date.now() - 49 * 3600000);
  assert.equal(await f.api.browserPurchase(f.req, 'local1', f.db), null);
});
test('mixed store credit requires the exact committed debit and preserves full order value', async () => {
  const f = fixture(); f.order.totalPrice = 3500; f.order.storeCreditAmount = 500; await f.prepare(); await f.capture();
  f.db.storeCredit.aggregate = async () => ({ _sum: { amount: 0 } });
  assert.equal(await f.api.browserPurchase(f.req, 'local1', f.db), null);
  f.db.storeCredit.aggregate = async () => ({ _sum: { amount: -500 } });
  assert.equal((await f.api.browserPurchase(f.req, 'local1', f.db)).customData.value, 4000);
});
test('full wallet checkout is reconciled from a committed debit after a lost browser', async () => {
  const f = fixture(); Object.assign(f.order, { paymentMethod: 'store_credit', totalPrice: 0, storeCreditAmount: 4000 });
  await f.api.prepareStoreCreditPurchase(f.req, 'local1', 'customer1', token, f.db);
  assert.equal(f.row.status, 'awaiting_payment');
  f.db.storeCredit.aggregate = async () => ({ _sum: { amount: 0 }, _max: { createdAt: null } });
  assert.equal(await f.api.confirmStoreCreditPurchase('local1', f.db), false);
  f.db.storeCredit.aggregate = async () => ({ _sum: { amount: -4000 }, _max: { createdAt: new Date() } });
  assert.equal(await f.api.confirmStoreCreditPurchase('local1', f.db), true);
  assert.equal(f.row.snapshot.value, 4000); assert.equal(f.row.verifiedPaymentId, 'credit:local1');
});
test('snapshot failure is observable to the advertising observer', async () => {
  const f = fixture(); f.db.metaPurchase.create = async () => { throw new Error('DB unavailable'); };
  await assert.rejects(f.prepare, /DB unavailable/);
});
test('reusing a pending order cannot advertise its old gateway attempt', async () => {
  const f = fixture(); await f.prepare(); await f.capture(); f.order.razorpayOrderId = 'order_reused';
  assert.equal(await f.api.browserPurchase(f.req, 'local1', f.db), null);
  await f.api.dispatchMetaPurchase('local1', f.db, () => assert.fail('stale gateway attempt sent'));
});
test('reusing an unpaid checkout refreshes the advertising attempt for the new gateway order', async () => {
  const f = fixture(); await f.prepare();
  f.order.razorpayOrderId = 'order_2';
  await f.api.prepareMetaPurchase(f.req, 'local1', { id: 'order_2', amount: 9900, currency: 'INR', live: true }, token, f.db);
  assert.equal(f.row.razorpayOrderId, 'order_2');
  assert.ok(f.row.createdAt instanceof Date);
  assert.equal(f.row.status, 'awaiting_payment');
  assert.equal(f.row.attempts, 0);
  assert.equal(f.row.sentAt, null);
  assert.equal(f.row.lastError, null);
  f.payment.order_id = 'order_2';
  await f.capture();
  assert.equal((await f.api.browserPurchase(f.req, 'local1', f.db)).eventId, 'local1');
  assert.equal(f.row.verifiedPaymentId, 'pay_1');
});
test('worker repairs a missed webhook observation using GET-verified payment proof', async () => {
  const f = fixture(); await f.prepare(); f.order.razorpayPaymentId = 'pay_1'; f.order.paymentCapturedAt = new Date();
  const reconcile = f.loaded.load('lib/meta-purchase-reconciliation.ts').reconcileGatewayPurchase;
  let fetched = 0;
  assert.equal(await reconcile('local1', f.db, async () => ({ key_id: 'rzp_live_test', key_secret: 'secret', source: 'environment' }), async id => {
    assert.equal(id, 'pay_1'); fetched++; return f.payment;
  }), true);
  assert.equal(fetched, 1); assert.equal(f.row.status, 'pending');
  const originalTime = +f.row.capturedAt;
  assert.equal(await reconcile('local1', f.db, () => assert.fail('already verified')), false);
  assert.equal(+f.row.capturedAt, originalTime);
});
test('worker skips mismatched, expired and unbound attempts without contacting the gateway', async () => {
  for (const mutate of [f => f.order.razorpayOrderId = 'other', f => f.row.createdAt = new Date(Date.now() - 48 * 3600000), f => f.order.items[0].sku = 'other']) {
    const f = fixture(); await f.prepare(); f.order.razorpayPaymentId = 'pay_1'; mutate(f);
    const reconcile = f.loaded.load('lib/meta-purchase-reconciliation.ts').reconcileGatewayPurchase;
    assert.equal(await reconcile('local1', f.db, () => assert.fail('must not contact gateway')), false);
  }
});
test('server fetch verifies actual capture without creating or capturing payments', async () => {
  const { fetchCapturedPayment } = loader().load('lib/meta-payment-verification.ts');
  let requested;
  const result = await fetchCapturedPayment('pay_1', { key_id: 'test', key_secret: 'secret' }, async (url, opts) => {
    requested = { url, opts }; return Response.json({ id: 'pay_1', status: 'captured', captured: true });
  });
  assert.equal(result.id, 'pay_1'); assert.equal(requested.url, 'https://api.razorpay.com/v1/payments/pay_1'); assert.equal(requested.opts.method, undefined);
  await assert.rejects(() => fetchCapturedPayment('pay_1', { key_id: 'test', key_secret: 'secret' }, async () => Response.json({ id: 'pay_1', status: 'authorized', captured: false })), /not been captured/);
});

test('actual browser Pixel and CAPI transports share one Purchase identity, value and destination', async () => {
  const f = fixture(); await f.prepare(); await f.capture();
  const pixelCalls = [], serverCalls = [], storage = new Map();
  f.loaded.context.window = { fbq: (...args) => pixelCalls.push(args) };
  f.loaded.context.document = { cookie: '' };
  f.loaded.context.sessionStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const route = f.loaded.load('app/api/meta/purchase/[id]/route.ts');
  f.loaded.context.fetch = async (url, options) => {
    if (url === '/api/meta/purchase/local1') {
      return route.GET(new Request(`https://zicabella.com${url}`, { headers: f.req.headers }), { params: { id: 'local1' } });
    }
    assert.equal(new URL(url).hostname, 'graph.facebook.com');
    serverCalls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ events_received: 1 });
  };
  const client = f.loaded.load('lib/meta-purchase-client.ts');
  assert.deepEqual(await Promise.all([client.trackVerifiedPurchase('local1'), client.trackVerifiedPurchase('local1')]), [true, true]);
  assert.equal(await f.api.dispatchMetaPurchase('local1', f.db), 'sent');
  await client.trackVerifiedPurchase('local1');
  assert.equal(await f.api.dispatchMetaPurchase('local1', f.db), 'not_claimed');
  assert.equal(pixelCalls.length, 1); assert.equal(serverCalls.length, 1);
  const pixel = pixelCalls[0], server = serverCalls[0].body.data[0];
  assert.equal(pixel[0], 'track'); assert.equal(pixel[1], 'Purchase');
  assert.equal(server.event_name, pixel[1]); assert.equal(server.event_id, pixel[3].eventID);
  assert.equal(server.event_id, 'local1'); assert.equal(server.custom_data.value, pixel[2].value);
  assert.equal(server.custom_data.currency, pixel[2].currency);
  const pixelId = f.loaded.load('lib/metaPixel.ts').META_PIXEL_ID;
  assert.ok(new URL(serverCalls[0].url).pathname.endsWith(`/${pixelId}/events`));
});

for (const rebind of [true, false]) {
  test(`capture cannot verify a concurrently refreshed ${rebind ? 'gateway order' : 'payment amount'}`, async () => {
    const f = fixture(); await f.prepare();
    const update = f.db.metaPurchase.updateMany;
    let interleaved = false;
    f.db.metaPurchase.updateMany = async args => {
      if (!interleaved && args.data.status === 'pending') {
        interleaved = true;
        f.order.razorpayOrderId = rebind ? 'order_2' : 'order_1';
        await f.api.prepareMetaPurchase(f.req, 'local1', {
          id: f.order.razorpayOrderId, amount: rebind ? 9900 : 19900, currency: 'INR', live: true,
        }, token, f.db);
      }
      return update(args);
    };
    assert.equal(await f.capture(), null);
    assert.equal(f.row.status, 'awaiting_payment');
    assert.equal(f.row.verifiedPaymentId, null);
    assert.equal(f.row.capturedAt, null);
    assert.equal(await f.api.browserPurchase(f.req, 'local1', f.db), null);
    assert.equal(await f.api.dispatchMetaPurchase('local1', f.db, () => assert.fail('stale proof sent')), 'not_claimed');
    f.payment.order_id = f.order.razorpayOrderId;
    f.payment.amount = f.row.expectedAmountMinor;
    assert.equal(await f.capture(), 'local1');
    assert.equal(f.row.status, 'pending');
  });
}
