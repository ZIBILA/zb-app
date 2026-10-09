/**
 * End-to-end Meta Purchase scenarios through the REAL route handlers
 * (same harness as scripts/payment-e2e/run.ts):
 *   web:  /api/checkout/razorpay (pre-create) → /api/checkout/complete → Razorpay webhook
 *         → /api/meta/event (browser relay)
 *   app:  /api/app/payment/create-order → /api/app/payment/verify → /api/app/orders/create
 *         → Razorpay webhook
 * Database = in-memory Prisma. Razorpay, Shopify, Meta, Snap, OpenAI faked at the HTTP layer.
 *
 *   ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PORT=1 \
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/meta-run.ts [report.md]
 */
import crypto from 'crypto';
import fs from 'fs';

Object.assign(process.env, {
  NODE_ENV: 'test',
  SNAP_CAPI_ACCESS_TOKEN: 'snap-token',
  SNAP_APP_ID_IOS: 'snap-app-ios', SNAP_APP_ID_ANDROID: 'snap-app-android', SNAP_IOS_APP_STORE_ID: '6740012345',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test', SHOPIFY_STORE_DOMAIN: 'test-shop.myshopify.com',
  RAZORPAY_WEBHOOK_SECRET: 'whsec_test', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'secret',
  NEXT_PUBLIC_SITE_URL: 'https://zicabella.com',
  META_CAPI_ACCESS_TOKEN: 'EAA' + 'B'.repeat(180), META_PIXEL_ID: '2049977412558608',
  OPENAI_ADS_CAPI_KEY: 'oai-test-key', NEXT_PUBLIC_OPENAI_ADS_PIXEL_ID: 'oai-pixel',
});
const KEY_SECRET = 'secret';
const V = { DENIM: '51813148262681', TEE: '51813148328217', JACKET: '51813148295449' };
const PRICE: Record<string, number> = { [V.DENIM]: 1499, [V.TEE]: 799, [V.JACKET]: 2201 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// ── HTTP fakes ──
const razorpayPayments = new Map<string, any>();
const metaEvents: any[] = [], snapWeb: any[] = [], snapApp: any[] = [], shopifyOrders: any[] = [];
let metaFailNext = 0;
(globalThis as any).fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
  const m = u.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\/([^/?]+)/);
  if (m) { const p = razorpayPayments.get(m[1]); return p ? json(200, { ...p }) : json(404, { error: { description: 'not found' } }); }
  const mo = u.match(/^https:\/\/api\.razorpay\.com\/v1\/orders\/([^/?]+)(\/payments)?/);
  if (mo) {
    const ps = [...razorpayPayments.values()].filter(p => p.order_id === mo[1]);
    if (mo[2]) return json(200, { items: ps });
    return json(200, { id: mo[1], amount: ps[0]?.amount ?? 0, amount_paid: ps[0]?.amount ?? 0, currency: ps[0]?.currency || 'INR', status: 'paid', notes: {} });
  }
  if (u.startsWith('https://graph.facebook.com/') && u.includes('/events')) {
    if (metaFailNext > 0) { metaFailNext--; return json(500, { error: { message: 'temporary', code: 2 } }); }
    const b = typeof opt.body === 'string' ? JSON.parse(opt.body) : opt.body;
    for (const e of b?.data || []) metaEvents.push(e);
    return json(200, { events_received: 1, fbtrace_id: 'x' });
  }
  if (u.startsWith('https://graph.facebook.com/')) return json(200, { messages: [{ id: 'wamid.1' }] });
  if (u.startsWith('https://tr.snapchat.com/v3/snap-app-')) { snapApp.push({ url: u, event: JSON.parse(opt.body).data[0] }); return json(200, { status: 'VALID' }); }
  if (u.startsWith('https://tr.snapchat.com/')) { snapWeb.push({ url: u, event: JSON.parse(opt.body).data[0] }); return json(200, { status: 'VALID' }); }
  if (u.includes('/admin/api/')) {
    if (u.includes('/variants.json')) {
      const ids = new URL(u).searchParams.get('ids')?.split(',') || [];
      return json(200, { variants: ids.filter(i => PRICE[i] !== undefined).map(i => ({ id: Number(i), price: PRICE[i].toFixed(2) })) });
    }
    if (u.includes('/orders.json') && (opt.method || 'GET') === 'POST') { const body = JSON.parse(opt.body).order; shopifyOrders.push(body); return json(201, { order: { id: 9000 + shopifyOrders.length, ...body } }); }
    if (u.includes('/orders.json')) return json(200, { orders: [] });
    if (u.includes('/customers')) return json(200, { customers: [], customer: { id: 777 } });
    return json(200, {});
  }
  return json(200, {});
};

const settle = async (ms = 60) => { for (let i = 0; i < 200; i++) await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 200; i++) await new Promise(r => setImmediate(r)); };
const sig = (orderId: string, payId: string) => crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${payId}`).digest('hex');
let rzpN = 0;
const newRzpOrder = () => `order_M${String(++rzpN).padStart(6, '0')}`;
const pay = (id: string, orderId: string, status: 'captured' | 'authorized' | 'failed', amount: number, currency = 'INR') =>
  razorpayPayments.set(id, { id, order_id: orderId, status, captured: status === 'captured', amount: Math.round(amount * 100), currency, amount_refunded: 0 });

let failed = 0, passed = 0;
const report: string[] = ['# Meta Purchase — end-to-end scenarios', '', `Generated by scripts/payment-e2e/meta-run.ts on ${new Date().toISOString()}`, ''];
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
  report.push(`- ${ok ? '✅' : '❌'} ${label}${ok || detail === undefined ? '' : ` — \`${JSON.stringify(detail).slice(0, 300)}\``}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });

async function main() {
  const { db, default: prisma } = await import('./memory-prisma');
  const checkoutComplete = await import('../../app/api/checkout/complete/route');
  const preCreate = await import('../../app/api/checkout/razorpay/route');
  const webhook = await import('../../app/api/webhooks/razorpay/route');
  const metaRoute = await import('../../app/api/meta/event/route');
  const createOrder = await import('../../app/api/app/payment/create-order/route');
  const verify = await import('../../app/api/app/payment/verify/route');
  const ordersCreate = await import('../../app/api/app/orders/create/route');
  const { NextRequest } = await import('next/server');

  await prisma.shop.create({ data: { id: 'shop_1', name: 'Zica Bella', domain: 'test-shop.myshopify.com' } });
  await prisma.webStoreCoupon.create({ data: { code: 'SAVE500', isActive: true, applicability: 'ALL' } });
  await prisma.customer.create({ data: { id: 'cust_app_1', shopId: 'shop_1', shopifyId: 'GUEST_1', name: 'Aarav Mehta', email: 'aarav@example.com', phone: '+919876543210', storeCredits: 20000 } });
  await prisma.storeCredit.create({ data: { customerId: 'cust_app_1', amount: 20000, type: 'CREDIT', description: 'seed', remainingAmount: 20000 } });
  // Global store: the storefront's own formula, INR × multiplier × exchangeRate.
  await prisma.globalStoreSettings.create({ data: { id: 'singleton', globalStoreEnabled: true } });
  const COUNTRIES = [
    { code: 'IN', name: 'India', currencyCode: 'INR', currencySymbol: '₹', locale: 'en-IN', isBase: true, multiplier: 1, exchangeRate: 1 },
    { code: 'US', name: 'United States', currencyCode: 'USD', currencySymbol: '$', locale: 'en-US', isBase: false, multiplier: 2.5, exchangeRate: 0.012 },
    { code: 'AE', name: 'United Arab Emirates', currencyCode: 'AED', currencySymbol: 'AED', locale: 'en-AE', isBase: false, multiplier: 2.5, exchangeRate: 0.044 },
    { code: 'SG', name: 'Singapore', currencyCode: 'SGD', currencySymbol: 'S$', locale: 'en-SG', isBase: false, multiplier: 2.5, exchangeRate: 0.0155 },
    { code: 'GB', name: 'United Kingdom', currencyCode: 'GBP', currencySymbol: '£', locale: 'en-GB', isBase: false, multiplier: 2.5, exchangeRate: 0.0094 },
  ];
  for (const [i, c] of COUNTRIES.entries()) await prisma.globalStoreCountry.create({ data: { ...c, isActive: true, sortOrder: i } });
  const fx = (code: string) => { const c = COUNTRIES.find(x => x.code === code)!; return (inr: number) => Math.round(inr * c.multiplier * c.exchangeRate * 100) / 100; };

  const ordersByRzp = (rzp: string) => (db.order || []).filter(o => o.razorpayOrderId === rzp);
  const orderById = (id: string) => (db.order || []).find(o => o.id === id);
  const metaFor = (orderId: string) => metaEvents.filter(e => e.event_name === 'Purchase' && e.event_id === orderId);
  const snapWebFor = (orderId: string) => snapWeb.filter(s => s.event.event_id === orderId);
  const snapAppFor = (orderId: string) => snapApp.filter(s => s.event.event_id === orderId);

  const cookie = '_fbp=fb.1.1700000000000.111222333; _fbc=fb.1.1700000000000.IwAR1click; zb_external_id=zb.web-visitor-1; ScCid=click-1; _scid=scid-1';
  const browserHeaders = { 'content-type': 'application/json', 'x-forwarded-for': '81.2.69.142', 'user-agent': UA, cookie };
  const complete = (body: any) => checkoutComplete.POST(new Request('https://zicabella.com/api/checkout/complete', { method: 'POST', body: JSON.stringify(body), headers: browserHeaders }));
  const precreate = async (body: any) => { const r = await preCreate.POST(new Request('https://zicabella.com/api/checkout/razorpay', { method: 'POST', body: JSON.stringify(body), headers: browserHeaders })); return r.json() as Promise<any>; };
  const hook = async (event: string, payId: string, rzp: string, status: string) => {
    const body = JSON.stringify({ event, payload: { payment: { entity: { id: payId, order_id: rzp, status, amount: razorpayPayments.get(payId)?.amount ?? 0, currency: razorpayPayments.get(payId)?.currency || 'INR', notes: {} } } } });
    const res = await webhook.POST(new Request('https://zicabella.com/api/webhooks/razorpay', { method: 'POST', body, headers: { 'x-razorpay-signature': crypto.createHmac('sha256', 'whsec_test').update(body).digest('hex') } }));
    await settle();
    return res.status;
  };
  const relay = (orderId: string, value = 1) => metaRoute.POST(new NextRequest('https://zicabella.com/api/meta/event', {
    method: 'POST', headers: browserHeaders,
    body: JSON.stringify({ eventName: 'Purchase', eventId: orderId, eventSourceUrl: `https://zicabella.com/orders/${orderId}/confirmation`, userAgent: UA, eventTime: Math.floor(Date.now() / 1000), customData: { value, currency: 'INR' } }),
  }) as any);

  function verifyMeta(label: string, orderId: string, want: { value: number; currency: string; ids: string[]; units: number; country?: string; ph?: string; em?: string; ua?: boolean }) {
    const sent = metaFor(orderId);
    eq(`${label}: exactly one Meta Purchase`, sent.length, 1);
    const ev = sent[0];
    if (!ev) return;
    eq(`${label}: action_source website, event_id = order id`, [ev.action_source, ev.event_id], ['website', orderId]);
    eq(`${label}: value + currency`, [ev.custom_data.value, ev.custom_data.currency], [want.value, want.currency]);
    eq(`${label}: content_ids (feed g:id)`, ev.custom_data.content_ids, want.ids);
    eq(`${label}: num_items (units)`, ev.custom_data.num_items, want.units);
    if (want.country) eq(`${label}: country hash`, ev.user_data.country, [sha(want.country)]);
    if (want.ph) eq(`${label}: phone hash (${want.ph})`, ev.user_data.ph, [sha(want.ph)]);
    if (want.em) eq(`${label}: email hash`, ev.user_data.em, [sha(want.em)]);
    if (want.ua !== false) eq(`${label}: real browser UA + fbp/fbc`, [ev.user_data.client_user_agent, ev.user_data.fbp, ev.user_data.fbc], [UA, 'fb.1.1700000000000.111222333', 'fb.1.1700000000000.IwAR1click']);
    check(`${label}: never the Razorpay webhook UA`, ev.user_data.client_user_agent !== 'Razorpay-Webhook/1.0');
    report.push('', '```json', JSON.stringify({ event_id: ev.event_id, action_source: ev.action_source, value: ev.custom_data.value, currency: ev.custom_data.currency, content_ids: ev.custom_data.content_ids, num_items: ev.custom_data.num_items, user_data_keys: Object.keys(ev.user_data) }, null, 1), '```', '');
  }

  // ════════════ WEB (India) ════════════
  const inAddr = { name: 'Riya Kapoor', email: 'riya@example.com', phone: '+919811122233', houseNo: '12', street: 'MG Road', city: 'Noida', state: 'Uttar Pradesh', zip: '201301', country: 'India', countryCode: 'IN' };
  const inItems = [
    { productId: '10227656982809', variantId: V.DENIM, title: 'AEROLAYER DENIM', price: '1499', quantity: 2 },
    { productId: '10227656982810', variantId: V.TEE, title: 'TEE', price: '799', quantity: 1 },
  ];

  report.push('## Web India — prepaid');
  console.log('\n— MW1 web prepaid (IN) + browser relay + duplicate webhooks');
  { const pre = await precreate({ amount: 3797, currency: 'INR', displayCountry: 'IN', address: inAddr, items: inItems, subtotal: 3797, total: 3797, paymentMethod: 'razorpay' });
    const rzp = pre.id; pay('pay_MW1', rzp, 'captured', 3797);
    await complete({ address: inAddr, items: inItems, subtotal: 3797, total: 3797, currency: 'INR', displayCountry: 'IN', paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_MW1', razorpay_signature: sig(rzp, 'pay_MW1') } });
    await settle(150);
    const o = ordersByRzp(rzp)[0];
    eq('MW1: paymentStatus', o?.paymentStatus, 'paid');
    await relay(o.id, 1); await settle();                       // browser → /api/meta/event (tampered value 1)
    await hook('payment.captured', 'pay_MW1', rzp, 'captured'); // duplicate webhooks
    await hook('order.paid', 'pay_MW1', rzp, 'captured');
    await hook('payment.captured', 'pay_MW1', rzp, 'captured');
    verifyMeta('MW1 (4 sending paths, 1 send)', o.id, { value: 3797, currency: 'INR', ids: [V.DENIM, V.TEE], units: 3, country: 'in', ph: '919811122233', em: 'riya@example.com' });
    eq('MW1: Snap WEB Purchase unchanged (one)', snapWebFor(o.id).length, 1);
  }

  report.push('', '## Web India — COD');
  console.log('\n— MW2 web COD');
  { const rzp = newRzpOrder(); pay('pay_MW2', rzp, 'captured', 99);
    await complete({ address: inAddr, items: inItems, subtotal: 3797, total: 3797, currency: 'INR', paymentMethod: 'COD', codFee: 99, razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_MW2', razorpay_signature: sig(rzp, 'pay_MW2') } });
    await settle(150);
    const o = ordersByRzp(rzp)[0];
    eq('MW2: paymentStatus', o?.paymentStatus, 'cod_upfront_paid');
    verifyMeta('MW2 (value = net sale, not ₹99 upfront)', o.id, { value: 3797, currency: 'INR', ids: [V.DENIM, V.TEE], units: 3 });
  }

  report.push('', '## Web India — coupon');
  console.log('\n— MW3 web coupon');
  { const rzp = newRzpOrder(); pay('pay_MW3', rzp, 'captured', 3297);
    await complete({ address: inAddr, items: inItems, subtotal: 3797, total: 3297, currency: 'INR', couponCode: 'SAVE500', couponDiscount: 500, paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_MW3', razorpay_signature: sig(rzp, 'pay_MW3') } });
    await settle(150);
    const o = ordersByRzp(rzp)[0];
    verifyMeta('MW3 (products − coupon)', o.id, { value: 3297, currency: 'INR', ids: [V.DENIM, V.TEE], units: 3 });
  }

  report.push('', '## Web — authorized only → webhook capture (page closed)');
  console.log('\n— MW4 authorized → captured via webhook, context from pre-create');
  { const pre = await precreate({ amount: 3797, currency: 'INR', displayCountry: 'IN', address: inAddr, items: inItems, subtotal: 3797, total: 3797, paymentMethod: 'razorpay' });
    const rzp = pre.id; pay('pay_MW4', rzp, 'authorized', 3797);
    const r = await complete({ address: inAddr, items: inItems, subtotal: 3797, total: 3797, currency: 'INR', paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_MW4', razorpay_signature: sig(rzp, 'pay_MW4') } });
    await settle(150);
    const o = ordersByRzp(rzp)[0];
    eq('MW4: 202 pending_capture, no Meta yet', [r.status, metaFor(o.id).length], [202, 0]);
    await hook('payment.authorized', 'pay_MW4', rzp, 'authorized');
    eq('MW4: payment.authorized → still no Meta', metaFor(o.id).length, 0);
    pay('pay_MW4', rzp, 'captured', 3797);
    await hook('payment.captured', 'pay_MW4', rzp, 'captured');
    eq('MW4: captured → paid', orderById(o.id)?.paymentStatus, 'paid');
    verifyMeta('MW4 (webhook-sent, browser context recorded at pre-create)', o.id, { value: 3797, currency: 'INR', ids: [V.DENIM, V.TEE], units: 3 });
  }

  report.push('', '## Web — failed payment only');
  console.log('\n— MW5 failed payment');
  { const pre = await precreate({ amount: 3797, currency: 'INR', displayCountry: 'IN', address: inAddr, items: inItems, subtotal: 3797, total: 3797, paymentMethod: 'razorpay' });
    const rzp = pre.id; pay('pay_MW5', rzp, 'failed', 3797);
    await hook('payment.failed', 'pay_MW5', rzp, 'failed');
    const o = ordersByRzp(rzp)[0];
    eq('MW5: failed → no Meta Purchase', [o?.paymentStatus, metaFor(o.id).length], ['failed', 0]);
    await relay(o.id, 3797); await settle();
    eq('MW5: browser relay for a failed order sends nothing', metaFor(o.id).length, 0);
  }

  report.push('', '## Web — failed attempt then successful retry, late payment.failed');
  console.log('\n— MW6 failure then retry');
  { const rzp = newRzpOrder(); pay('pay_MW6a', rzp, 'failed', 3797); pay('pay_MW6b', rzp, 'captured', 3797);
    await complete({ address: inAddr, items: inItems, subtotal: 3797, total: 3797, currency: 'INR', paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_MW6b', razorpay_signature: sig(rzp, 'pay_MW6b') } });
    await settle(150);
    await hook('payment.failed', 'pay_MW6a', rzp, 'failed');
    const o = ordersByRzp(rzp)[0];
    eq('MW6: still paid, one Meta Purchase', [o?.paymentStatus, metaFor(o.id).length], ['paid', 1]);
  }

  report.push('', '## Web — same order completed from two devices / duplicate requests');
  console.log('\n— MW7 duplicate checkout/complete (two devices)');
  { const rzp = newRzpOrder(); pay('pay_MW7', rzp, 'captured', 3797);
    const body = { address: inAddr, items: inItems, subtotal: 3797, total: 3797, currency: 'INR', paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_MW7', razorpay_signature: sig(rzp, 'pay_MW7') } };
    await Promise.all([complete(body), complete(body)]); await settle(200);
    const os = ordersByRzp(rzp);
    eq('MW7: one order, one Meta Purchase', [os.length, metaFor(os[0].id).length], [1, 1]);
    await relay(os[0].id); await relay(os[0].id); await settle();
    eq('MW7: relays from two browsers add nothing', metaFor(os[0].id).length, 1);
  }

  report.push('', '## Web — Meta outage then retry cron');
  console.log('\n— MW8 Meta API failure → retry');
  { const rzp = newRzpOrder(); pay('pay_MW8', rzp, 'captured', 3797);
    metaFailNext = 1;
    await complete({ address: inAddr, items: inItems, subtotal: 3797, total: 3797, currency: 'INR', paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_MW8', razorpay_signature: sig(rzp, 'pay_MW8') } });
    await settle(200);
    const o = ordersByRzp(rzp)[0];
    const row = (db.adConversionDelivery || []).find(r => r.platform === 'meta' && r.orderId === o.id);
    eq('MW8: first send failed and is recorded', [metaFor(o.id).length, row?.status], [0, 'failed']);
    const { retryFailedMetaPurchases } = await import('../../lib/meta/purchase-server');
    const t1 = await retryFailedMetaPurchases(25);
    const t2 = await retryFailedMetaPurchases(25);
    eq('MW8: retry sends once, then nothing', [metaFor(o.id).length, row?.status, t2.retry_sent ?? 0], [1, 'sent', 0]);
    report.push(`  retry tally: ${JSON.stringify(t1)}`);
  }

  report.push('', '## Web — orphaned payment recovery');
  console.log('\n— MW9 webhook recovery order');
  { const rzp = newRzpOrder(); pay('pay_MW9', rzp, 'captured', 3797);
    await hook('payment.captured', 'pay_MW9', rzp, 'captured');
    const o = ordersByRzp(rzp)[0];
    check('MW9: recovery created an order', !!o, (db.order || []).length);
    await hook('order.paid', 'pay_MW9', rzp, 'captured');
    eq('MW9: unknown-items recovery order → no Meta Purchase', o ? metaFor(o.id).length : -1, 0);
  }

  // ════════════ WEB (international) ════════════
  const intl = [
    { code: 'US', cur: 'USD', addr: { name: 'Emma Johnson', email: 'emma@example.com', phone: '+1 415 555 2671', city: 'San Francisco', state: 'California', zip: '94105-1804', country: 'United States', countryCode: 'US' }, ph: '14155552671', st: 'ca', zp: '94105' },
    { code: 'AE', cur: 'AED', addr: { name: 'Ali Khan', email: 'ali@example.ae', phone: '050 123 4567', city: 'Dubai', state: 'Dubai', zip: '', country: 'United Arab Emirates', countryCode: 'AE' }, ph: '971501234567', st: 'dubai' },
    { code: 'SG', cur: 'SGD', addr: { name: 'Wei Ling Tan', email: 'weiling@example.sg', phone: '8123 4567', city: 'Singapore', state: 'Singapore', zip: '018956', country: 'Singapore', countryCode: 'SG' }, ph: '6581234567', st: 'singapore', zp: '018956' },
    { code: 'GB', cur: 'GBP', addr: { name: 'Oliver Smith', email: 'oliver@example.co.uk', phone: '07700 900123', city: 'London', state: 'Greater London', zip: 'SW1A 1AA', country: 'United Kingdom', countryCode: 'GB' }, ph: '447700900123', st: 'greaterlondon', zp: 'sw1a1' },
  ];
  for (const c of intl) {
    report.push('', `## Web ${c.code} — prepaid in ${c.cur}`);
    console.log(`\n— MI ${c.code} prepaid ${c.cur}`);
    const conv = fx(c.code);
    const items = inItems.map(i => ({ ...i, price: String(conv(Number(i.price))) }));
    const subtotal = conv(3797);
    const total = subtotal;
    const pre = await precreate({ amount: total, currency: c.cur, displayCountry: c.code, address: c.addr, items, subtotal, total, paymentMethod: 'razorpay' });
    const rzp = pre.id; const payId = `pay_MI${c.code}`;
    pay(payId, rzp, 'captured', total, c.cur);
    const r = await complete({ address: c.addr, items, subtotal, total, currency: c.cur, displayCountry: c.code, paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: payId, razorpay_signature: sig(rzp, payId) } });
    await settle(150);
    const o = ordersByRzp(rzp)[0];
    const expectedTotal = Math.round((conv(1499) * 2 + conv(799)) * 100) / 100;
    eq(`MI ${c.code}: checkout ok and order PAID (not partially_paid)`, [r.status, o?.paymentStatus], [200, 'paid']);
    eq(`MI ${c.code}: stored total is in ${c.cur} (what Razorpay charged)`, [o?.totalPrice, o?.currency], [expectedTotal, c.cur]);
    verifyMeta(`MI ${c.code}`, o.id, { value: expectedTotal, currency: c.cur, ids: [V.DENIM, V.TEE], units: 3, country: c.code.toLowerCase(), ph: c.ph });
    const ev = metaFor(o.id)[0];
    if (ev && c.st) eq(`MI ${c.code}: state normalized`, ev.user_data.st, [sha(c.st)]);
    if (ev && c.zp) eq(`MI ${c.code}: postcode normalized`, ev.user_data.zp, [sha(c.zp)]);
  }

  // ════════════ APP (native) ════════════
  const iosDevice = { platform: 'ios', appVersion: '1.0.2', buildNumber: '9', osVersion: '17.5', deviceModel: 'iPhone15,2', locale: 'en_IN', timezoneAbbr: 'GMT+5:30', timezone: 'Asia/Kolkata', attStatus: 'denied', idfv: '3F2504E0-4F89-11D3-9A0C-0305E82C3301' };
  const androidDevice = { platform: 'android', appVersion: '1.0.4', buildNumber: '5', osVersion: '14', deviceModel: 'SM-S918B', locale: 'en_IN', timezoneAbbr: 'GMT+5:30', timezone: 'Asia/Kolkata', madid: '38400000-8cf0-11bd-b23e-10b96e40000d' };
  const appLines = [
    { variantId: `gid://shopify/ProductVariant/${V.DENIM}`, productId: '10227656982809', quantity: 2, price: 1499, name: 'AEROLAYER DENIM', sku: 'ZB-AERO-32' },
    { variantId: V.TEE, productId: '10227656982810', quantity: 1, price: 799, name: 'TEE', sku: 'ZB-TEE-M' },
  ];
  const appAddress = { name: 'Aarav Mehta', line1: '1 Sector 90', city: 'Noida', state: 'Uttar Pradesh', pincode: '201304', country: 'India', phone: '+919876543210', email: 'aarav@example.com' };
  const post = (route: any, url: string, body: any) => route.POST(new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: 'Bearer t', 'x-forwarded-for': '49.36.10.20', 'user-agent': 'ZicaBella/9' } }));
  async function appFlow(o: { amount: number; total: number; subtotal: number; cod?: boolean; credits?: number; device?: any; payStatus?: 'captured' | 'authorized' }) {
    const orderData = { customerId: 'cust_app_1', customerEmail: 'aarav@example.com', customerPhone: '+919876543210', lineItems: appLines, appliedStoreCredits: o.credits || 0, discountAmount: 0, shippingAddress: appAddress, paymentMethod: o.cod ? 'COD' : 'PREPAID', paymentStatus: 'pending', total: o.total, total_price: o.total, subtotal: o.subtotal, codFee: o.cod ? 99 : 0, codUpfrontPaid: o.cod ? 99 : 0 };
    const cr: any = await (await post(createOrder, 'https://zicabella.com/api/app/payment/create-order', { amount: o.amount, currency: 'INR', orderData, snapDevice: o.device || iosDevice })).json();
    const rzp = cr.id || cr.order_id || cr.razorpay_order_id || cr.orderId;
    const payId = `pay_${String(rzp).replace(/[^A-Za-z0-9]/g, '')}`;
    pay(payId, rzp, o.payStatus || 'captured', o.amount);
    await (await post(verify, 'https://zicabella.com/api/app/payment/verify', { razorpay_order_id: rzp, razorpay_payment_id: payId, razorpay_signature: sig(rzp, payId), snapDevice: o.device || iosDevice })).json();
    await settle(80);
    await (await post(ordersCreate, 'https://zicabella.com/api/app/orders/create', { ...orderData, paymentStatus: 'paid', paymentId: payId, razorpayOrderId: rzp })).json();
    await settle(120);
    return { rzp, payId, order: ordersByRzp(rzp)[0] };
  }
  const appCases: Array<[string, any]> = [
    ['iOS prepaid', { amount: 3797, total: 3797, subtotal: 3797 }],
    ['Android COD', { amount: 99, total: 3797, subtotal: 3797, cod: true, device: androidDevice }],
    ['iOS partial store credit', { amount: 2797, total: 2797, subtotal: 3797, credits: 1000 }],
  ];
  for (const [label, opts] of appCases) {
    report.push('', `## App — ${label}`);
    console.log(`\n— MA ${label}`);
    const r = await appFlow(opts);
    await hook('payment.captured', r.payId, r.rzp, 'captured');   // webhook also arrives for app orders
    await hook('order.paid', r.payId, r.rzp, 'captured');
    eq(`MA ${label}: order is MOBILE_APP and paid`, [r.order?.orderType, ['paid', 'cod_upfront_paid'].includes(r.order?.paymentStatus)], ['MOBILE_APP', true]);
    eq(`MA ${label}: NO website Meta Purchase for a native app order`, metaFor(r.order.id).length, 0);
    eq(`MA ${label}: Snap MOBILE_APP Purchase unchanged (one)`, snapAppFor(r.order.id).length, 1);
  }
  { report.push('', '## App — 100% store credit');
    console.log('\n— MA 100% store credit');
    const body = { customerId: 'cust_app_1', customerEmail: 'aarav@example.com', customerPhone: '+919876543210', lineItems: appLines, appliedStoreCredits: 3797, shippingAddress: appAddress, paymentMethod: 'Store Credit', paymentStatus: 'paid', total: 0, total_price: 0, subtotal: 3797, checkoutId: 'sc_meta_full_01', snapDevice: iosDevice };
    const j: any = await (await post(ordersCreate, 'https://zicabella.com/api/app/orders/create', body)).json(); await settle(120);
    const o = orderById(j.orderId);
    eq('MA 100% store credit: value stored as 0 (credit = discount)', [o?.paymentStatus, o?.totalPrice], ['paid', 0]);
    eq('MA 100% store credit: NO website Meta Purchase', metaFor(o.id).length, 0);
    eq('MA 100% store credit: Snap MOBILE_APP value 0 unchanged', snapAppFor(o.id)[0]?.event?.custom_data?.value, 0);
  }

  // Shared value definition (browser Pixel and server use the same function).
  { const { metaPurchaseValue, metaPurchaseCurrency } = await import('../../lib/meta/order-value');
    const sample = { totalPrice: 2797, currency: 'inr' };
    eq('Shared value helper: net after store credit, currency normalized', [metaPurchaseValue(sample), metaPurchaseCurrency(sample)], [2797, 'INR']);
    eq('Shared value helper: 100% store credit → 0', metaPurchaseValue({ totalPrice: 0 }), 0);
  }

  // Optional: save every Purchase the server produced, in the shape
  // scripts/meta-regression/send-test-events.ts replays to Meta Test Events.
  if (process.env.META_CAPTURE_OUT) {
    const out: Record<string, any> = {};
    metaEvents.filter(e => e.event_name === 'Purchase').forEach((e, i) => {
      out[`purchase_${String(i + 1).padStart(2, '0')}_${e.custom_data?.currency}`] = { pageView: { graph: [] }, atc: { graph: [] }, purchase: { graph: [e] } };
    });
    fs.writeFileSync(process.env.META_CAPTURE_OUT, JSON.stringify(out, null, 1));
    console.log(`wrote ${Object.keys(out).length} Purchase payloads to ${process.env.META_CAPTURE_OUT}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  report.push('', `**${passed} passed, ${failed} failed**`);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], report.join('\n'));
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
