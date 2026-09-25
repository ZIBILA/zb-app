const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loader } = require('./loader.cjs');
const routes = ['app/api/webhooks/razorpay/route.ts', 'app/api/payments/webhook/route.ts'];

function fixture(file, { failSave = false } = {}) {
  const calls = [];
  const db = { webhookEvent: { findFirst: async () => ({ processed: true }) } };
  const h = loader({ 'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } }, 'lib/db.ts': db,
    'lib/meta-purchases.ts': { recordCapturedPurchase: async payment => { calls.push(['proof', payment]); if (failSave) throw new Error('offline'); return 'local1'; }, dispatchMetaPurchase: () => assert.fail('webhook must not wait for Meta delivery') },
    '@/lib/payment-logger': { paymentLog() {} }, '@/lib/services/razorpayRecoveryService': {}, '@/lib/services/zohoMailService': {}, '@/lib/orderNumber': {},
    '@/lib/services/logistics': {}, '@/lib/shopify-admin': {}, '@/lib/services/shopifyOrderSyncService': {},
    razorpay: { validateWebhookSignature: (body, signature, key) => crypto.createHmac('sha256', key).update(body).digest('hex') === signature },
  });
  h.context.process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
  const body = event => JSON.stringify({ event, created_at: Math.floor(Date.now() / 1000), payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', status: event === 'payment.authorized' ? 'authorized' : 'captured', captured: event !== 'payment.authorized', amount: 9900, currency: 'INR' } } } });
  const request = (event = 'payment.captured', valid = true) => {
    const payload = body(event);
    const signature = valid ? crypto.createHmac('sha256', 'test-webhook-secret').update(payload).digest('hex') : 'bad';
    return new Request('https://example.test/webhook', { method: 'POST', headers: { 'x-razorpay-signature': signature }, body: payload });
  };
  return { route: h.load(file), calls, request };
}
for (const file of routes) {
  test(`${file}: invalid webhook signature cannot create a Purchase`, async () => {
    const f = fixture(file); const response = await f.route.POST(f.request('payment.captured', false));
    assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
  });
  test(`${file}: duplicate legacy callback still persists/retries the outbox`, async () => {
    const f = fixture(file); const response = await f.route.POST(f.request());
    assert.equal(response.status, 200); assert.equal(f.calls[0][0], 'proof'); assert.equal(f.calls.length, 1);
  });
  test(`${file}: failed advertising write preserves existing webhook response`, async () => {
    const f = fixture(file, { failSave: true }); const response = await f.route.POST(f.request());
    assert.equal(response.status, 200); assert.equal(f.calls.filter(x => x[0] === 'dispatch').length, 0);
  });
  test(`${file}: authorized-only payment cannot create a Purchase`, async () => {
    const f = fixture(file); await f.route.POST(f.request('payment.authorized'));
    assert.equal(f.calls.length, 0);
  });
}

test('retry endpoint requires a configured bearer secret before touching the database', async () => {
  const h = loader({ 'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    'lib/db.ts': { metaPurchase: { findMany: () => assert.fail('unauthorized DB read') } }, '@/lib/meta-purchases': {} });
  const route = h.load('app/api/cron/meta-purchases/route.ts');
  assert.equal((await route.POST(new Request('https://example.test/cron', { method: 'POST' }))).status, 401);
  h.context.process.env.CRON_SECRET = 'configured';
  assert.equal((await route.POST(new Request('https://example.test/cron', { method: 'POST', headers: { authorization: 'Bearer wrong' } }))).status, 401);
});
