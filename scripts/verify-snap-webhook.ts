/**
 * Runs the REAL Razorpay webhook handler (app/api/webhooks/razorpay/route.ts)
 * against an in-memory database and a fake Snap endpoint, to prove:
 *   - payment.authorized never marks an order paid and never sends a Purchase
 *   - payment.captured / order.paid mark paid and send exactly one Snap Purchase
 *   - native-app orders never produce a WEB Snap Purchase
 *
 *   npx tsx --tsconfig scripts/snap-test-support/tsconfig.json scripts/verify-snap-webhook.ts
 */
import crypto from 'crypto';

process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
process.env.SNAP_CAPI_ACCESS_TOKEN = 'test-token';
process.env.NEXT_PUBLIC_SITE_URL = 'https://zicabella.com';
process.env.SNAP_APP_ID_IOS = 'snap-app-ios-uuid';
process.env.SNAP_IOS_APP_STORE_ID = '6740012345';
process.env.SNAP_APP_ID_ANDROID = 'snap-app-android-uuid';

const snapCalls: any[] = [];   // website pixel endpoint
const appCalls: any[] = [];    // Snap APP endpoints
const metaCalls: any[] = [];
(globalThis as any).fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  if (u.startsWith('https://tr.snapchat.com/v3/snap-app-')) {
    appCalls.push({ url: u, body: JSON.parse(opt.body) });
    return { ok: true, status: 200, json: async () => ({ status: 'VALID' }) };
  }
  if (u.startsWith('https://tr.snapchat.com/')) {
    snapCalls.push(JSON.parse(opt.body));
    return { ok: true, status: 200, json: async () => ({ status: 'VALID' }) };
  }
  if (u.includes('graph.facebook.com')) {
    metaCalls.push(u);
    return { ok: true, status: 200, json: async () => ({}) };
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
};

let failed = 0, passed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};

async function main() {
  const { store } = await import('./snap-test-support/fake-db');
  const { POST } = await import('../app/api/webhooks/razorpay/route');

  const send = async (event: string, rzpOrderId: string, payId: string) => {
    const body = JSON.stringify({
      event,
      payload: { payment: { entity: { id: payId, order_id: rzpOrderId, amount: 379700, status: event === 'payment.authorized' ? 'authorized' : 'captured', notes: {} } } },
    });
    const sig = crypto.createHmac('sha256', 'whsec_test').update(body).digest('hex');
    const res = await POST(new Request('https://zicabella.com/api/webhooks/razorpay', {
      method: 'POST', body, headers: { 'x-razorpay-signature': sig, 'content-type': 'application/json' },
    }));
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  const mkOrder = (id: string, rzp: string, over: any = {}) => ({
    id, razorpayOrderId: rzp, paymentStatus: 'pending', status: 'payment_pending', orderType: 'REGULAR',
    paymentMethod: 'razorpay', tags: '', note: '', totalPrice: 3797, currency: 'INR', customerId: 'cust_1',
    internalOrderNumber: 'ZB81001', shopifyOrderId: '987654321', shopifySyncStatus: 'synced',
    createdAt: new Date(Date.now() - 120e3), paymentCapturedAt: null,
    customer: { email: 'jane@example.com', phone: '+447700900123', name: 'Jane Doe' },
    shippingAddress: JSON.stringify({ city: 'London', zip: 'SW1A 1AA', country: 'United Kingdom', countryCode: 'GB' }),
    items: [{ variantId: '51813148262681', sku: '51813148262681', quantity: 2, price: 1499 },
            { variantId: '51813148328217', sku: '51813148328217', quantity: 1, price: 799 }],
    ...over,
  });

  // ── Web prepaid order: authorized first, then captured, then order.paid ──
  store.orders.set('ord_web', mkOrder('ord_web', 'order_rzp_web'));
  let r = await send('payment.authorized', 'order_rzp_web', 'pay_web_1');
  check('authorized → 200 and explicitly ignored', r.status === 200 && /not a completed payment/.test(r.json.ignored || ''), r);
  check('authorized → order still pending (not paid)', store.orders.get('ord_web').paymentStatus === 'pending', store.orders.get('ord_web').paymentStatus);
  check('authorized → no order update at all', !store.calls.some(c => c.includes('ord_web')), store.calls);
  check('authorized → no Snap Purchase', snapCalls.length === 0, snapCalls.length);
  check('authorized → no Meta Purchase', metaCalls.length === 0, metaCalls.length);

  r = await send('payment.captured', 'order_rzp_web', 'pay_web_1');
  check('captured → 200', r.status === 200, r);
  check('captured → order marked paid', store.orders.get('ord_web').paymentStatus === 'paid', store.orders.get('ord_web').paymentStatus);
  check('captured → exactly one Snap Purchase', snapCalls.length === 1, snapCalls.length);
  const ev = snapCalls[0]?.data?.[0];
  check('Snap event is WEB PURCHASE with event_id = order_id = order', ev?.event_name === 'PURCHASE' && ev?.action_source === 'WEB'
    && ev?.event_id === 'ord_web' && ev?.custom_data?.order_id === 'ord_web', ev);
  check('content_ids = variant ids, num_items = 3', JSON.stringify(ev?.custom_data?.content_ids) === JSON.stringify(['51813148262681', '51813148328217'])
    && ev?.custom_data?.num_items === '3', ev?.custom_data);

  r = await send('order.paid', 'order_rzp_web', 'pay_web_1');
  check('order.paid after captured → still exactly one Snap Purchase', snapCalls.length === 1, snapCalls.length);

  // ── COD upfront web order ──
  store.orders.set('ord_cod', mkOrder('ord_cod', 'order_rzp_cod', { paymentMethod: 'cod', tags: 'COD' }));
  await send('payment.authorized', 'order_rzp_cod', 'pay_cod_1');
  check('COD authorized → not cod_upfront_paid', store.orders.get('ord_cod').paymentStatus === 'pending');
  await send('payment.captured', 'order_rzp_cod', 'pay_cod_1');
  check('COD captured → cod_upfront_paid + one Purchase', store.orders.get('ord_cod').paymentStatus === 'cod_upfront_paid' && snapCalls.length === 2,
    { status: store.orders.get('ord_cod').paymentStatus, snap: snapCalls.length });

  // ── Native app order: device context stored at create-order; authorized → nothing; captured → ONE MOBILE_APP ──
  store.orders.set('ord_app', mkOrder('ord_app', 'order_rzp_app', { orderType: 'MOBILE_APP' }));
  store.ledger.set('snap_app|PURCHASE|ord_app', {
    id: 'led_app', platform: 'snap_app', eventName: 'PURCHASE', orderId: 'ord_app', eventId: 'ord_app',
    status: 'pending', attempts: 0, leaseUntil: null, eventTime: null, sentAt: null,
    context: { platform: 'ios', osVersion: '17.5', attStatus: 'denied', idfv: '3F2504E0-4F89-11D3-9A0C-0305E82C3301', appVersion: '1.0.2' },
  });
  await send('payment.authorized', 'order_rzp_app', 'pay_app_1');
  check('app authorized → not paid, no app event', store.orders.get('ord_app').paymentStatus === 'pending' && appCalls.length === 0);
  await send('payment.captured', 'order_rzp_app', 'pay_app_1');
  check('app order captured → paid', store.orders.get('ord_app').paymentStatus === 'paid');
  check('app order → NO website-pixel Purchase', !snapCalls.some(c => c.data[0].event_id === 'ord_app'), snapCalls.length);
  check('app order → exactly one MOBILE_APP Purchase to the iOS app endpoint',
    appCalls.length === 1 && appCalls[0].url.includes('/v3/snap-app-ios-uuid/events') && appCalls[0].body.data[0].action_source === 'MOBILE_APP', appCalls);
  await send('order.paid', 'order_rzp_app', 'pay_app_1');
  check('order.paid afterwards → still one app Purchase', appCalls.length === 1, appCalls.length);

  // ── Retry cron auth (CRON_SECRET required, Bearer only) ──
  const cron = await import('../app/api/cron/snap-conversions/route');
  const { NextRequest } = await import('next/server');
  const call = (headers: Record<string, string> = {}, qs = '') =>
    cron.GET(new NextRequest(`https://app.zicabella.com/api/cron/snap-conversions${qs}`, { headers }));
  delete process.env.CRON_SECRET;
  check('cron: CRON_SECRET unset → 401 (fails closed)', (await call({ authorization: 'Bearer anything' })).status === 401);
  process.env.CRON_SECRET = 'cron_test_secret';
  check('cron: no auth → 401', (await call()).status === 401);
  check('cron: wrong secret → 401', (await call({ authorization: 'Bearer nope' })).status === 401);
  check('cron: ?secret= query param not accepted → 401', (await call({}, '?secret=cron_test_secret')).status === 401);
  const ok = await call({ authorization: 'Bearer cron_test_secret' });
  check('cron: correct Bearer → 200 with tally', ok.status === 200 && (await ok.json()).ok === true, ok.status);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
