/**
 * End-to-end payment + Snap Purchase scenarios through the REAL route handlers:
 *   web:  /api/checkout/complete → Razorpay webhook
 *   app:  /api/app/payment/create-order → /api/app/payment/verify → /api/app/orders/create
 *         → Razorpay webhook
 * Database = in-memory Prisma (scripts/payment-e2e/memory-prisma.ts).
 * Razorpay API, Shopify Admin API and Snap are faked at the HTTP layer.
 *
 *   ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PORT=1 \
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/run.ts [report.md]
 * (redirect-db.cjs also catches relative `./db` imports; the SMTP vars make emails fail fast.)
 */
import crypto from 'crypto';
import fs from 'fs';

Object.assign(process.env, {
  NODE_ENV: 'test',
  SNAP_CAPI_ACCESS_TOKEN: 'snap-token',
  SNAP_APP_ID_IOS: 'snap-app-ios', SNAP_APP_ID_ANDROID: 'snap-app-android', SNAP_IOS_APP_STORE_ID: '6740012345',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test', SHOPIFY_STORE_DOMAIN: 'test-shop.myshopify.com',
  RAZORPAY_WEBHOOK_SECRET: 'whsec_test',
  NEXT_PUBLIC_SITE_URL: 'https://zicabella.com',
  // Real-looking config so Meta / OpenAI / WhatsApp senders actually call out and the
  // fetch fake below can count every "order confirmed" side effect.
  META_CAPI_ACCESS_TOKEN: 'EAA' + 'B'.repeat(180), META_PIXEL_ID: '2049977412558608',
  OPENAI_ADS_CAPI_KEY: 'oai-test-key', NEXT_PUBLIC_OPENAI_ADS_PIXEL_ID: 'oai-pixel',
  WHATSAPP_PHONE_NUMBER_ID: '110000000000001', WHATSAPP_BUSINESS_ACCOUNT_ID: '220000000000002', WHATSAPP_TOKEN: 'EAA' + 'W'.repeat(120),
});
const KEY_SECRET = 'secret'; // scripts/snap-test-support/fake-razorpay-credentials.ts

// ── catalog (feed.xml g:id) ──
const V = { DENIM: '51813148262681', TEE: '51813148328217', JACKET: '51813148295449' };
const PRICE: Record<string, number> = { [V.DENIM]: 1499, [V.TEE]: 799, [V.JACKET]: 2201 };

// ── HTTP fakes ──
type RzpPayment = { id: string; order_id: string; status: string; captured: boolean; amount: number; amount_refunded: number };
const razorpayPayments = new Map<string, RzpPayment>();
const snapWeb: any[] = [], snapApp: any[] = [], shopifyOrders: any[] = [];
const metaEvents: any[] = [], openAiEvents: any[] = [], whatsappSends: any[] = [];
let shopifyOrderSeq = 6000;
(globalThis as any).fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
  const m = u.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\/([^/?]+)/);
  if (m) { const p = razorpayPayments.get(m[1]); return p ? json(200, { ...p }) : json(404, { error: { description: 'not found' } }); }
  if (u.startsWith('https://graph.facebook.com/') && u.includes('/events')) {
    try { const b = typeof opt.body === 'string' ? JSON.parse(opt.body) : opt.body; for (const e of b?.data || []) metaEvents.push(e); } catch { metaEvents.push({ raw: opt.body }); }
    return json(200, { events_received: 1, fbtrace_id: 'x' });
  }
  if (u.startsWith('https://graph.facebook.com/') && u.includes('/messages')) { whatsappSends.push(JSON.parse(opt.body || '{}')); return json(200, { messages: [{ id: 'wamid.1' }] }); }
  if (u.startsWith('https://bzr.openai.com/')) { try { const b = JSON.parse(opt.body); for (const e of b?.events || [b]) openAiEvents.push(e); } catch { openAiEvents.push({ raw: opt.body }); } return json(200, {}); }
  if (u.startsWith('https://tr.snapchat.com/v3/snap-app-')) { snapApp.push({ url: u, event: JSON.parse(opt.body).data[0] }); return json(200, { status: 'VALID' }); }
  if (u.startsWith('https://tr.snapchat.com/')) { snapWeb.push({ url: u, event: JSON.parse(opt.body).data[0] }); return json(200, { status: 'VALID' }); }
  if (u.includes('/admin/api/')) {
    if (u.includes('/variants.json')) {
      const ids = new URL(u).searchParams.get('ids')?.split(',') || [];
      return json(200, { variants: ids.filter(i => PRICE[i] !== undefined).map(i => ({ id: Number(i), price: PRICE[i].toFixed(2) })) });
    }
    if (u.includes('/orders.json') && (opt.method || 'GET') === 'POST') {
      const body = JSON.parse(opt.body).order;
      const id = ++shopifyOrderSeq;
      shopifyOrders.push(body);
      return json(201, { order: { id, name: `#${id}`, ...body } });
    }
    if (u.includes('/orders.json')) return json(200, { orders: [] });
    if (u.includes('/customers/search.json') || u.includes('/customers.json')) return json(200, { customers: [], customer: { id: 777 } });
    return json(200, {});
  }
  return json(200, {});
};

// ── helpers ──
const settle = async (ms = 60) => { for (let i = 0; i < 200; i++) await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 200; i++) await new Promise(r => setImmediate(r)); };
const sig = (orderId: string, payId: string) => crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${payId}`).digest('hex');
let rzpN = 0;
const newRzpOrder = () => `order_T${String(++rzpN).padStart(6, '0')}`;
const pay = (id: string, orderId: string, status: 'captured' | 'authorized' | 'failed', rupees: number) =>
  razorpayPayments.set(id, { id, order_id: orderId, status, captured: status === 'captured', amount: Math.round(rupees * 100), amount_refunded: 0 });

let failed = 0, passed = 0;
const report: string[] = ['# Payment safety + Snap Purchase — end-to-end scenarios', '', `Generated by scripts/payment-e2e/run.ts on ${new Date().toISOString()}`, ''];
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
  report.push(`- ${ok ? '✅' : '❌'} ${label}${ok || detail === undefined ? '' : ` — \`${JSON.stringify(detail).slice(0, 300)}\``}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });

async function main() {
  const { db, default: prisma } = await import('./memory-prisma');
  const checkoutComplete = await import('../../app/api/checkout/complete/route');
  const webhook = await import('../../app/api/webhooks/razorpay/route');
  const createOrder = await import('../../app/api/app/payment/create-order/route');
  const verify = await import('../../app/api/app/payment/verify/route');
  const ordersCreate = await import('../../app/api/app/orders/create/route');

  // seed
  await prisma.shop.create({ data: { id: 'shop_1', name: 'Zica Bella', domain: 'test-shop.myshopify.com' } });
  await prisma.webStoreCoupon.create({ data: { code: 'SAVE500', isActive: true, applicability: 'ALL' } });
  await prisma.customer.create({ data: { id: 'cust_app_1', shopId: 'shop_1', shopifyId: 'GUEST_1', name: 'Aarav Mehta', email: 'aarav@example.com', phone: '+919876543210', storeCredits: 10000 } });
  await prisma.storeCredit.create({ data: { customerId: 'cust_app_1', amount: 10000, type: 'CREDIT', description: 'seed', remainingAmount: 10000 } });

  const ordersByRzp = (rzp: string) => (db.order || []).filter(o => o.razorpayOrderId === rzp);
  const orderById = (id: string) => (db.order || []).find(o => o.id === id);
  const itemsOf = (orderId: string) => (db.orderItem || []).filter(i => i.orderId === orderId);
  const snapFor = (list: any[], orderId: string) => list.filter(s => s.event.event_id === orderId);
  const shopifyFor = (orderNumberTag: string) => shopifyOrders.filter(o => JSON.stringify(o).includes(orderNumberTag));
  const balance = () => (db.customer || []).find(c => c.id === 'cust_app_1')!.storeCredits;
  const debitsFor = (key: string) => (db.storeCredit || []).filter(s => s.type === 'DEBIT' && s.idempotencyKey === key);

  function verifyPurchase(label: string, list: any[], orderId: string, want: { value: number; ids: string[]; contents: Array<[string, number]>; numItems: number; source: string }) {
    const sent = snapFor(list, orderId);
    check(`${label}: exactly one Snap ${want.source} Purchase`, sent.length === 1, sent.length);
    const ev = sent[0]?.event;
    if (!ev) return;
    eq(`${label}: Snap value`, ev.custom_data.value, want.value);
    eq(`${label}: content_ids`, ev.custom_data.content_ids, want.ids);
    eq(`${label}: contents (id × qty)`, ev.custom_data.contents.map((c: any) => [c.id, c.quantity]), want.contents);
    eq(`${label}: num_items (units)`, ev.custom_data.num_items, String(want.numItems));
    eq(`${label}: action_source`, ev.action_source, want.source);
    report.push('', '```json', JSON.stringify({ event_id: ev.event_id, action_source: ev.action_source, value: ev.custom_data.value, currency: ev.custom_data.currency, content_ids: ev.custom_data.content_ids, contents: ev.custom_data.contents, num_items: ev.custom_data.num_items, order_id: ev.custom_data.order_id }, null, 1), '```', '');
  }
  function verifyShopify(label: string, order: any, want: { financial: string; variants: Array<[number, number]> }) {
    const so = shopifyFor(order.internalOrderNumber);
    check(`${label}: exactly one Shopify order`, so.length === 1, so.length);
    if (!so[0]) return;
    eq(`${label}: Shopify financial_status`, so[0].financial_status, want.financial);
    eq(`${label}: Shopify line_items (variant_id × qty)`, so[0].line_items.map((l: any) => [l.variant_id, l.quantity]), want.variants);
  }

  // ════════════ WEB ════════════
  const webAddress = { name: 'Riya Kapoor', email: 'riya@example.com', phone: '9811122233', houseNo: '12', street: 'MG Road', city: 'Noida', state: 'Uttar Pradesh', zip: '201301', country: 'India', countryCode: 'IN' };
  const webItems = [
    { productId: '10227656982809', variantId: V.DENIM, title: 'AEROLAYER DENIM', price: '1499', quantity: 2 },
    { productId: '10227656982810', variantId: V.TEE, title: 'TEE', price: '799', quantity: 1 },
  ];
  const complete = (body: any) => checkoutComplete.POST(new Request('https://zicabella.com/api/checkout/complete', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '81.2.69.142', cookie: 'ScCid=click-1; _scid=scid-1' },
  }));
  const hook = async (event: string, payId: string, rzp: string, status: string) => {
    const body = JSON.stringify({ event, payload: { payment: { entity: { id: payId, order_id: rzp, status, amount: razorpayPayments.get(payId)?.amount ?? 0, notes: {} } } } });
    const res = await webhook.POST(new Request('https://zicabella.com/api/webhooks/razorpay', { method: 'POST', body, headers: { 'x-razorpay-signature': crypto.createHmac('sha256', 'whsec_test').update(body).digest('hex') } }));
    await settle();
    return res.status;
  };

  // W1 prepaid, multi-product / multi-qty
  report.push('## Web — prepaid, denim ×2 + tee ×1');
  console.log('\n— W1 web prepaid multi-qty');
  { const rzp = newRzpOrder(); pay('pay_W1', rzp, 'captured', 3797);
    const r = await complete({ address: webAddress, items: webItems, subtotal: 3797, total: 3797, paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_W1', razorpay_signature: sig(rzp, 'pay_W1') } });
    await settle(120);
    const o = ordersByRzp(rzp)[0];
    check('W1: checkout/complete 200', r.status === 200, r.status);
    eq('W1: local paymentStatus', o?.paymentStatus, 'paid');
    eq('W1: OrderItem.variantId persisted', itemsOf(o.id).map(i => i.variantId), [V.DENIM, V.TEE]);
    verifyPurchase('W1', snapWeb, o.id, { value: 3797, ids: [V.DENIM, V.TEE], contents: [[V.DENIM, 2], [V.TEE, 1]], numItems: 3, source: 'WEB' });
    verifyShopify('W1', o, { financial: 'paid', variants: [[+V.DENIM, 2], [+V.TEE, 1]] });
  }

  // W2 COD with ₹99 upfront
  report.push('', '## Web — COD (₹99 upfront)');
  console.log('\n— W2 web COD');
  { const rzp = newRzpOrder(); pay('pay_W2', rzp, 'captured', 99);
    await complete({ address: webAddress, items: webItems, subtotal: 3797, total: 3797, paymentMethod: 'COD', codFee: 99, razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_W2', razorpay_signature: sig(rzp, 'pay_W2') } });
    await settle(120);
    const o = ordersByRzp(rzp)[0];
    eq('W2: local paymentStatus', o?.paymentStatus, 'cod_upfront_paid');
    eq('W2: COD upfront stays a separate field', o?.codUpfrontPaid, 99);
    verifyPurchase('W2 (value is the net sale, not ₹99)', snapWeb, o.id, { value: 3797, ids: [V.DENIM, V.TEE], contents: [[V.DENIM, 2], [V.TEE, 1]], numItems: 3, source: 'WEB' });
    verifyShopify('W2', o, { financial: 'partially_paid', variants: [[+V.DENIM, 2], [+V.TEE, 1]] });
  }

  // W3 coupon
  report.push('', '## Web — coupon ₹500');
  console.log('\n— W3 web coupon');
  { const rzp = newRzpOrder(); pay('pay_W3', rzp, 'captured', 3297);
    await complete({ address: webAddress, items: webItems, subtotal: 3797, total: 3297, couponCode: 'SAVE500', couponDiscount: 500, paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_W3', razorpay_signature: sig(rzp, 'pay_W3') } });
    await settle(120);
    const o = ordersByRzp(rzp)[0];
    eq('W3: local paymentStatus', o?.paymentStatus, 'paid');
    verifyPurchase('W3 (products − coupon)', snapWeb, o.id, { value: 3297, ids: [V.DENIM, V.TEE], contents: [[V.DENIM, 2], [V.TEE, 1]], numItems: 3, source: 'WEB' });
  }

  // W4 authorized but not captured → pending → webhook completes
  report.push('', '## Web — authorized but not captured, then captured');
  console.log('\n— W4 web authorized → captured');
  { const rzp = newRzpOrder(); pay('pay_W4', rzp, 'authorized', 3797);
    await complete({ address: webAddress, items: webItems, subtotal: 3797, total: 3797, paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_W4', razorpay_signature: sig(rzp, 'pay_W4') } });
    await settle(120);
    let o = ordersByRzp(rzp)[0];
    check('W4: order kept (not lost)', !!o);
    eq('W4: authorized → payment_pending (valid signature is not enough)', o?.paymentStatus, 'payment_pending');
    check('W4: no Snap Purchase while only authorized', snapFor(snapWeb, o.id).length === 0);
    check('W4: no Shopify order while only authorized', shopifyFor(o.internalOrderNumber).length === 0);
    await hook('payment.authorized', 'pay_W4', rzp, 'authorized');
    eq('W4: payment.authorized webhook → still payment_pending', orderById(o.id)?.paymentStatus, 'payment_pending');
    pay('pay_W4', rzp, 'captured', 3797);
    await hook('payment.captured', 'pay_W4', rzp, 'captured');
    o = orderById(o.id);
    eq('W4: payment.captured webhook → paid', o?.paymentStatus, 'paid');
    check('W4: still one local order', ordersByRzp(rzp).length === 1);
    verifyPurchase('W4', snapWeb, o.id, { value: 3797, ids: [V.DENIM, V.TEE], contents: [[V.DENIM, 2], [V.TEE, 1]], numItems: 3, source: 'WEB' });
    verifyShopify('W4', o, { financial: 'paid', variants: [[+V.DENIM, 2], [+V.TEE, 1]] });
  }

  // W5 failed attempt then successful retry (late payment.failed must not downgrade)
  report.push('', '## Web — failed attempt, successful retry, late payment.failed');
  console.log('\n— W5 web failure then retry');
  { const rzp = newRzpOrder(); pay('pay_W5a', rzp, 'failed', 3797); pay('pay_W5b', rzp, 'captured', 3797);
    await complete({ address: webAddress, items: webItems, subtotal: 3797, total: 3797, paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_W5b', razorpay_signature: sig(rzp, 'pay_W5b') } });
    await settle(120);
    const before = ordersByRzp(rzp)[0];
    eq('W5: retry captured → paid', before?.paymentStatus, 'paid');
    const num = before.internalOrderNumber;
    await hook('payment.failed', 'pay_W5a', rzp, 'failed');
    const after = orderById(before.id);
    eq('W5: late payment.failed does NOT downgrade', after?.paymentStatus, 'paid');
    eq('W5: order number not replaced with ZBPF', after?.internalOrderNumber, num);
    check('W5: one Snap Purchase', snapFor(snapWeb, before.id).length === 1);
  }

  // W6 duplicate API request
  report.push('', '## Web — duplicate checkout/complete request');
  console.log('\n— W6 web duplicate request');
  { const rzp = newRzpOrder(); pay('pay_W6', rzp, 'captured', 3797);
    const body = { address: webAddress, items: webItems, subtotal: 3797, total: 3797, paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_W6', razorpay_signature: sig(rzp, 'pay_W6') } };
    await complete(body); await settle(80); await complete(body); await settle(150);
    const os = ordersByRzp(rzp);
    eq('W6: one local order', os.length, 1);
    eq('W6: one Snap Purchase', snapFor(snapWeb, os[0].id).length, 1);
    eq('W6: one Shopify order', shopifyFor(os[0].internalOrderNumber).length, 1);
  }

  // ── Confirmation side effects observed per order ──
  const { isFailedPrefixNumber } = await import('../../lib/orderNumber');
  const couponUses = () => Number((db.webStoreCoupon || []).find(c => c.code === 'SAVE500')?.usedCount || 0);
  const effects = (orderId: string) => ({
    metaPurchase: metaEvents.filter(e => e.event_id === orderId && e.event_name === 'Purchase').length,
    openAiOrderCreated: openAiEvents.filter(e => e.id === orderId && e.type === 'order_created').length,
    snapPurchase: snapFor(snapWeb, orderId).length,
    shopifyOrders: shopifyOrders.length,
    analyticsPurchase: (db.analyticsEvent || []).filter(a => a.orderId === orderId && a.eventName === 'purchase').length,
    confirmationEmail: (db.emailLog || []).filter(e => e.referenceId === orderId).length,
    whatsapp: whatsappSends.length,
    couponUses: couponUses(),
    cashback: (db.storeCredit || []).filter(c => c.orderId === orderId && c.type === 'COUPON_REBATE').length,
    cartConverted: (db.cart || []).filter(c => c.convertedOrderId === orderId).length,
  });
  const delta = (a: Record<string, number>, b: Record<string, number>, keys: string[]) =>
    Object.fromEntries(keys.map(k => [k, ['metaPurchase', 'openAiOrderCreated', 'snapPurchase', 'analyticsPurchase', 'confirmationEmail', 'cashback', 'cartConverted'].includes(k) ? b[k] : b[k] - a[k]]));
  const EFFECT_KEYS = ['metaPurchase', 'openAiOrderCreated', 'snapPurchase', 'shopifyOrders', 'analyticsPurchase', 'confirmationEmail', 'whatsapp', 'couponUses', 'cashback', 'cartConverted'];
  const NONE = Object.fromEntries(EFFECT_KEYS.map(k => [k, 0]));

  // W7 authorized only (pre-created order, prepaid + coupon + cashback) → nothing confirmed;
  // page keeps re-sending; once captured the normal path runs exactly once.
  report.push('', '## Web — authorized but not captured: NO confirmation side effects');
  console.log('\n— W7 web authorized/unverified capture → no side effects');
  { const rzp = newRzpOrder(); pay('pay_W7', rzp, 'authorized', 3297);
    const pre = await prisma.order.create({ data: { shopId: 'shop_1', status: 'payment_pending', paymentStatus: 'payment_pending', razorpayOrderId: rzp, internalOrderNumber: 'ZBPP77001', orderType: 'WEB_STORE', totalPrice: 3297, subtotalPrice: 3797, paymentMethod: 'razorpay', shippingAddress: '{}', tags: 'WebStoreOrder, Web, razorpay, zb-order-ZBPP77001, payment_pending, Order creation in process' } });
    await prisma.webStoreOrder.create({ data: { orderNumber: 'ZBPP77001', paymentStatus: 'payment_pending', razorpayOrderId: rzp, customerName: 'Riya Kapoor', customerEmail: 'riya@example.com', customerPhone: '9811122233', shippingAddress: {}, items: [], subtotal: 3797, totalAmount: 3297, paymentMethod: 'razorpay', source: 'web' } });
    await prisma.cart.create({ data: { status: 'active', email: 'riya@example.com', phone: '9811122233', convertedOrderId: null, lastActivityAt: new Date() } });
    const body = { address: webAddress, items: webItems, subtotal: 3797, total: 3297, couponCode: 'SAVE500', couponDiscount: 500, cashbackAmount: 100, paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_W7', razorpay_signature: sig(rzp, 'pay_W7') } };
    const base = effects(pre.id);

    const r1 = await complete(body); const j1: any = await r1.json(); await settle(200);
    let o = orderById(pre.id);
    eq('W7: response 202 pending_capture', [r1.status, j1.paymentState, j1.orderId], [202, 'pending_capture', pre.id]);
    eq('W7: order status stays pending', [o.status, o.paymentStatus], ['payment_pending', 'payment_pending']);
    check('W7: paymentCapturedAt not set', !o.paymentCapturedAt, o.paymentCapturedAt);
    check('W7: pending number kept (not promoted)', isFailedPrefixNumber(o.internalOrderNumber), o.internalOrderNumber);
    eq('W7: local pending order preserved with items', itemsOf(o.id).map(i => [i.variantId, i.quantity]), [[V.DENIM, 2], [V.TEE, 1]]);
    eq('W7: WebStoreOrder stays payment_pending', (db.webStoreOrder || []).find(w => w.razorpayOrderId === rzp)?.paymentStatus, 'payment_pending');
    eq('W7: NO confirmation side effects (Meta, OpenAI, Snap, Shopify, analytics, email, WhatsApp, coupon, cashback, cart)', delta(base, effects(pre.id), EFFECT_KEYS), NONE);

    const r2 = await complete(body); const j2: any = await r2.json(); await settle(200);
    eq('W7: page re-sends while authorized → still 202 pending_capture', [r2.status, j2.paymentState], [202, 'pending_capture']);
    eq('W7: still NO side effects after the re-send', delta(base, effects(pre.id), EFFECT_KEYS), NONE);
    eq('W7: still one local order', ordersByRzp(rzp).length, 1);

    pay('pay_W7', rzp, 'captured', 3297);
    const r3 = await complete(body); const j3: any = await r3.json(); await settle(250);
    o = orderById(pre.id);
    eq('W7: after capture → 200 with the same order', [r3.status, j3.orderId, j3.paymentState], [200, pre.id, undefined]);
    eq('W7: confirmed → paid / approved', [o.paymentStatus, o.status], ['paid', 'approved']);
    check('W7: paymentCapturedAt set on capture', !!o.paymentCapturedAt);
    check('W7: real ZB number assigned on capture', !isFailedPrefixNumber(o.internalOrderNumber), o.internalOrderNumber);
    const once = { metaPurchase: 1, openAiOrderCreated: 1, snapPurchase: 1, shopifyOrders: 1, analyticsPurchase: 1, confirmationEmail: 1, whatsapp: 1, couponUses: 1, cashback: 1, cartConverted: 1 };
    eq('W7: normal completion ran exactly once after capture', delta(base, effects(pre.id), EFFECT_KEYS), once);
    verifyPurchase('W7', snapWeb, o.id, { value: 3297, ids: [V.DENIM, V.TEE], contents: [[V.DENIM, 2], [V.TEE, 1]], numItems: 3, source: 'WEB' });

    await hook('payment.captured', 'pay_W7', rzp, 'captured');
    const after = delta(base, effects(pre.id), EFFECT_KEYS);
    eq('W7: late payment.captured webhook adds no duplicate email/WhatsApp/coupon/cashback/Snap/Shopify',
      { ...after, metaPurchase: undefined }, { ...once, metaPurchase: undefined });
    check('W7: every Meta Purchase for the order shares event_id = order id (deduplicated by Meta)',
      metaEvents.filter(e => e.event_name === 'Purchase' && e.custom_data?.order_id === o.id).every(e => e.event_id === o.id));
  }

  // W8 COD upfront authorized only, shopper closes the page → webhook confirms on capture
  report.push('', '## Web — COD upfront authorized only, page closed, webhook confirms');
  console.log('\n— W8 web COD authorized → webhook capture');
  { const rzp = newRzpOrder(); pay('pay_W8', rzp, 'authorized', 99);
    const r = await complete({ address: webAddress, items: webItems, subtotal: 3797, total: 3797, paymentMethod: 'COD', codFee: 99, razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_W8', razorpay_signature: sig(rzp, 'pay_W8') } });
    const j: any = await r.json(); await settle(200);
    let o = orderById(j.orderId);
    eq('W8: response 202 pending_capture', [r.status, j.paymentState], [202, 'pending_capture']);
    eq('W8: order + payment status pending', [o.status, o.paymentStatus], ['payment_pending', 'payment_pending']);
    eq('W8: COD upfront NOT recorded as paid', [o.codUpfrontPaid, o.codUpfrontPaymentId ?? null, o.paymentCapturedAt ?? null], [0, null, null]);
    check('W8: pending number', isFailedPrefixNumber(o.internalOrderNumber), o.internalOrderNumber);
    eq('W8: no Meta / OpenAI / Snap / analytics / email for the order', [effects(o.id).metaPurchase, effects(o.id).openAiOrderCreated, effects(o.id).snapPurchase, effects(o.id).analyticsPurchase, effects(o.id).confirmationEmail], [0, 0, 0, 0, 0]);
    pay('pay_W8', rzp, 'captured', 99);
    const shopifyBefore = shopifyOrders.length;
    await hook('payment.captured', 'pay_W8', rzp, 'captured');
    o = orderById(o.id);
    eq('W8: webhook capture → cod_upfront_paid with ₹99 upfront recorded', [o.paymentStatus, o.codUpfrontPaid], ['cod_upfront_paid', 99]);
    check('W8: real ZB number on capture', !isFailedPrefixNumber(o.internalOrderNumber), o.internalOrderNumber);
    verifyPurchase('W8 (net sale, not ₹99)', snapWeb, o.id, { value: 3797, ids: [V.DENIM, V.TEE], contents: [[V.DENIM, 2], [V.TEE, 1]], numItems: 3, source: 'WEB' });
    eq('W8: one Shopify order after capture', shopifyOrders.length - shopifyBefore, 1);
  }

  // ════════════ APP ════════════
  const iosDevice = { platform: 'ios', appVersion: '1.0.2', buildNumber: '9', osVersion: '17.5', deviceModel: 'iPhone15,2', locale: 'en_IN', timezoneAbbr: 'GMT+5:30', timezone: 'Asia/Kolkata', attStatus: 'denied', idfv: '3F2504E0-4F89-11D3-9A0C-0305E82C3301' };
  const androidDevice = { platform: 'android', appVersion: '1.0.4', buildNumber: '5', osVersion: '14', deviceModel: 'SM-S918B', locale: 'en_IN', timezoneAbbr: 'GMT+5:30', timezone: 'Asia/Kolkata', madid: '38400000-8cf0-11bd-b23e-10b96e40000d' };
  const appLines = [
    { variantId: `gid://shopify/ProductVariant/${V.DENIM}`, productId: '10227656982809', quantity: 2, price: 1499, name: 'AEROLAYER DENIM', sku: 'ZB-AERO-32' },
    { variantId: V.TEE, productId: '10227656982810', quantity: 1, price: 799, name: 'TEE', sku: 'ZB-TEE-M' },
  ];
  const appAddress = { name: 'Aarav Mehta', line1: '1 Sector 90', city: 'Noida', state: 'Uttar Pradesh', pincode: '201304', country: 'India', phone: '+919876543210', email: 'aarav@example.com' };
  const post = (route: any, url: string, body: any) => route.POST(new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: 'Bearer t', 'x-forwarded-for': '49.36.10.20', 'user-agent': 'ZicaBella/9' } }));
  async function appFlow(o: { amount: number; total: number; subtotal: number; cod?: boolean; credits?: number; coupon?: number; lines?: any[]; device?: any; payStatus?: 'captured' | 'authorized'; headless?: boolean; clientStatus?: string }) {
    const orderData = {
      customerId: 'cust_app_1', customerEmail: 'aarav@example.com', customerPhone: '+919876543210',
      lineItems: o.lines || appLines, appliedStoreCredits: o.credits || 0, discountAmount: o.coupon || 0,
      shippingAddress: appAddress, paymentMethod: o.cod ? 'COD' : 'PREPAID', paymentStatus: 'pending',
      total: o.total, total_price: o.total, subtotal: o.subtotal, codFee: o.cod ? 99 : 0, codUpfrontPaid: o.cod ? 99 : 0,
    };
    const cr = await post(createOrder, 'https://zicabella.com/api/app/payment/create-order', { amount: o.amount, currency: 'INR', orderData, snapDevice: o.device || iosDevice });
    const crJson: any = await cr.json();
    const rzp = crJson.id || crJson.order_id || crJson.razorpay_order_id || crJson.orderId;
    const payId = `pay_${String(rzp).replace(/[^A-Za-z0-9]/g, "")}`;
    pay(payId, rzp, o.payStatus || 'captured', o.amount);
    const v = await post(verify, 'https://zicabella.com/api/app/payment/verify', { razorpay_order_id: rzp, razorpay_payment_id: payId, razorpay_signature: o.headless ? 'HEADLESS' : sig(rzp, payId), snapDevice: o.device || iosDevice });
    const vJson: any = await v.json();
    await settle(80);
    const oc = await post(ordersCreate, 'https://zicabella.com/api/app/orders/create', { ...orderData, paymentStatus: o.clientStatus ?? 'paid', paymentId: payId, razorpayOrderId: rzp });
    const ocJson: any = await oc.json();
    await settle(120);
    return { rzp, payId, vJson, ocJson, order: ordersByRzp(rzp)[0] };
  }

  // A1 iOS prepaid multi-qty
  report.push('', '## iOS — prepaid, denim ×2 + tee ×1');
  console.log('\n— A1 app prepaid (iOS)');
  { const r = await appFlow({ amount: 3797, total: 3797, subtotal: 3797 });
    eq('A1: verify reports captured', r.vJson.paymentState, 'captured');
    eq('A1: local paymentStatus', r.order?.paymentStatus, 'paid');
    eq('A1: OrderItem.variantId (from GID)', itemsOf(r.order.id).map(i => i.variantId), [V.DENIM, V.TEE]);
    check('A1: no website-pixel Purchase for the app order', snapFor(snapWeb, r.order.id).length === 0);
    verifyPurchase('A1', snapApp, r.order.id, { value: 3797, ids: [V.DENIM, V.TEE], contents: [[V.DENIM, 2], [V.TEE, 1]], numItems: 3, source: 'MOBILE_APP' });
    check('A1: iOS app endpoint', snapFor(snapApp, r.order.id)[0]?.url.includes('/v3/snap-app-ios/'));
    verifyShopify('A1 (variant ids from stored variantId, not SKU)', r.order, { financial: 'paid', variants: [[+V.DENIM, 2], [+V.TEE, 1]] });
  }

  // A2 Android COD
  report.push('', '## Android — COD (₹99 upfront)');
  console.log('\n— A2 app COD (Android)');
  { const r = await appFlow({ amount: 99, total: 3797, subtotal: 3797, cod: true, device: androidDevice });
    eq('A2: local paymentStatus', r.order?.paymentStatus, 'cod_upfront_paid');
    verifyPurchase('A2 (net sale, not ₹99)', snapApp, r.order.id, { value: 3797, ids: [V.DENIM, V.TEE], contents: [[V.DENIM, 2], [V.TEE, 1]], numItems: 3, source: 'MOBILE_APP' });
    check('A2: Android app endpoint', snapFor(snapApp, r.order.id)[0]?.url.includes('/v3/snap-app-android/'));
    verifyShopify('A2', r.order, { financial: 'partially_paid', variants: [[+V.DENIM, 2], [+V.TEE, 1]] });
  }

  // A3 partial store credit: ₹4,500 order, ₹1,000 credit, Razorpay ₹3,500
  report.push('', '## iOS — partial store credit (₹4,500 − ₹1,000)');
  console.log('\n— A3 app partial store credit');
  { const lines = [{ variantId: V.DENIM, productId: 'p1', quantity: 2, price: 1499, name: 'DENIM', sku: 'ZB-AERO-32' }, { variantId: V.JACKET, productId: 'p3', quantity: 1, price: 1502, name: 'JACKET', sku: 'ZB-JKT' }];
    const b0 = balance();
    const r = await appFlow({ amount: 3500, total: 3500, subtotal: 4500, credits: 1000, lines });
    eq('A3: local paymentStatus', r.order?.paymentStatus, 'paid');
    eq('A3: wallet debited exactly ₹1,000 once', b0 - balance(), 1000);
    verifyPurchase('A3 (products − store credit)', snapApp, r.order.id, { value: 3500, ids: [V.DENIM, V.JACKET], contents: [[V.DENIM, 2], [V.JACKET, 1]], numItems: 3, source: 'MOBILE_APP' });
  }

  // A4 100% store credit (no Razorpay)
  report.push('', '## iOS — 100% store credit');
  console.log('\n— A4 app 100% store credit');
  { const b0 = balance();
    const body = { customerId: 'cust_app_1', customerEmail: 'aarav@example.com', customerPhone: '+919876543210', lineItems: appLines, appliedStoreCredits: 3797, shippingAddress: appAddress,
      paymentMethod: 'Store Credit', paymentStatus: 'paid', total: 0, total_price: 0, subtotal: 3797, snapDevice: iosDevice };
    const res = await post(ordersCreate, 'https://zicabella.com/api/app/orders/create', body);
    const j: any = await res.json(); await settle(120);
    const o = orderById(j.orderId);
    eq('A4: local paymentStatus', o?.paymentStatus, 'paid');
    eq('A4: wallet debited ₹3,797', b0 - balance(), 3797);
    eq('A4: internal payment method is store_credit (not Razorpay)', [o?.paymentMethod, (db.mobileOrder || []).find(m => m.orderNumber === o?.internalOrderNumber)?.paymentMethod], ['store_credit', 'STORE_CREDIT']);
    verifyPurchase('A4 (store credit = discount → value 0)', snapApp, o.id, { value: 0, ids: [V.DENIM, V.TEE], contents: [[V.DENIM, 2], [V.TEE, 1]], numItems: 3, source: 'MOBILE_APP' });
    verifyShopify('A4', o, { financial: 'paid', variants: [[+V.DENIM, 2], [+V.TEE, 1]] });
  }

  // A5 coupon + store credit: ₹5,000 − ₹500 − ₹1,000 = ₹3,500
  report.push('', '## Android — coupon ₹500 + store credit ₹1,000 on ₹5,000');
  console.log('\n— A5 app coupon + store credit');
  { const lines = [{ variantId: V.DENIM, productId: 'p1', quantity: 2, price: 1499, name: 'DENIM', sku: 'a' }, { variantId: V.JACKET, productId: 'p3', quantity: 1, price: 2002, name: 'JACKET', sku: 'b' }];
    const b0 = balance();
    const r = await appFlow({ amount: 3500, total: 3500, subtotal: 5000, credits: 1000, coupon: 500, lines, device: androidDevice });
    eq('A5: local paymentStatus', r.order?.paymentStatus, 'paid');
    eq('A5: wallet debited ₹1,000', b0 - balance(), 1000);
    verifyPurchase('A5 (products − coupon − store credit)', snapApp, r.order.id, { value: 3500, ids: [V.DENIM, V.JACKET], contents: [[V.DENIM, 2], [V.JACKET, 1]], numItems: 3, source: 'MOBILE_APP' });
  }

  // A6 UPI success (HEADLESS verify) + stale client "pending" must not downgrade
  report.push('', '## iOS — UPI intent (HEADLESS) success, stale client status');
  console.log('\n— A6 app UPI success, stale client pending');
  { const r = await appFlow({ amount: 3797, total: 3797, subtotal: 3797, headless: true, clientStatus: 'pending' });
    eq('A6: verify (HEADLESS) confirms capture', r.vJson.paymentState, 'captured');
    eq('A6: stale client "pending" does NOT downgrade', r.order?.paymentStatus, 'paid');
    check('A6: one Snap app Purchase', snapFor(snapApp, r.order.id).length === 1);
  }

  // A7 authorized but not captured (app)
  report.push('', '## Android — authorized but not captured, client claims paid, then captured');
  console.log('\n— A7 app authorized → captured');
  { const r = await appFlow({ amount: 3797, total: 3797, subtotal: 3797, payStatus: 'authorized', device: androidDevice });
    eq('A7: verify reports pending_capture', r.vJson.paymentState, 'pending_capture');
    eq('A7: client claimed "paid" but capture unconfirmed → pending', r.order?.paymentStatus, 'pending');
    check('A7: no Snap Purchase yet', snapFor(snapApp, r.order.id).length === 0);
    check('A7: no Shopify order yet', shopifyFor(r.order.internalOrderNumber).length === 0);
    pay(r.payId, r.rzp, 'captured', 3797);
    await hook('payment.captured', r.payId, r.rzp, 'captured');
    const o = orderById(r.order.id);
    eq('A7: webhook payment.captured → paid', o?.paymentStatus, 'paid');
    check('A7: still one order', ordersByRzp(r.rzp).length === 1);
    verifyPurchase('A7', snapApp, o.id, { value: 3797, ids: [V.DENIM, V.TEE], contents: [[V.DENIM, 2], [V.TEE, 1]], numItems: 3, source: 'MOBILE_APP' });
    verifyShopify('A7', o, { financial: 'paid', variants: [[+V.DENIM, 2], [+V.TEE, 1]] });
  }

  // A8 failure then retry (app) + late payment.failed
  report.push('', '## iOS — late payment.failed after a successful retry');
  console.log('\n— A8 app failure then retry');
  { const r = await appFlow({ amount: 3797, total: 3797, subtotal: 3797 });
    pay('pay_A8_failed', r.rzp, 'failed', 3797);
    await hook('payment.failed', 'pay_A8_failed', r.rzp, 'failed');
    eq('A8: confirmed order not downgraded', orderById(r.order.id)?.paymentStatus, 'paid');
  }

  // A9 duplicate orders/create with store credit
  report.push('', '## iOS — duplicate orders/create with store credit');
  console.log('\n— A9 app duplicate request');
  { const b0 = balance();
    const r = await appFlow({ amount: 3500, total: 3500, subtotal: 4500, credits: 1000, lines: [{ variantId: V.DENIM, productId: 'p1', quantity: 2, price: 1499, name: 'D', sku: 'x' }, { variantId: V.JACKET, productId: 'p3', quantity: 1, price: 1502, name: 'J', sku: 'y' }] });
    const again = await post(ordersCreate, 'https://zicabella.com/api/app/orders/create', { customerId: 'cust_app_1', customerEmail: 'aarav@example.com', lineItems: appLines, appliedStoreCredits: 1000, shippingAddress: appAddress, paymentMethod: 'PREPAID', paymentStatus: 'paid', total: 3500, subtotal: 4500, paymentId: r.payId, razorpayOrderId: r.rzp });
    await again.json(); await settle(120);
    eq('A9: wallet debited ₹1,000 only once', b0 - balance(), 1000);
    eq('A9: one DEBIT ledger row for the Razorpay order', debitsFor(`rzp:${r.rzp}`).length, 1);
    eq('A9: one local order', ordersByRzp(r.rzp).length, 1);
    eq('A9: one Snap Purchase', snapFor(snapApp, r.order.id).length, 1);
    eq('A9: one Shopify order', shopifyFor(r.order.internalOrderNumber).length, 1);
  }

  // A11 three concurrent identical 100% store-credit requests (same checkoutId)
  report.push('', '## Android — 3 concurrent duplicate 100% store-credit requests');
  console.log('\n— A11 concurrent duplicate 100% store credit');
  { // top up the test wallet so this scenario is independent of earlier ones
    await prisma.storeCredit.create({ data: { customerId: 'cust_app_1', amount: 10000, type: 'CREDIT', description: 'seed A11', remainingAmount: 10000 } });
    await prisma.customer.update({ where: { id: 'cust_app_1' }, data: { storeCredits: { increment: 10000 } } });
    const b0 = balance();
    const ordersBefore = (db.order || []).length, shopifyBefore = shopifyOrders.length;
    const checkoutId = 'sc_lz4k2p_9f3a1c7e2b';
    const body = { customerId: 'cust_app_1', customerEmail: 'aarav@example.com', customerPhone: '+919876543210', lineItems: appLines, appliedStoreCredits: 3797, shippingAddress: appAddress,
      paymentMethod: 'Store Credit', paymentStatus: 'paid', total: 0, total_price: 0, subtotal: 3797, checkoutId, snapDevice: androidDevice };
    const results = await Promise.all([1, 2, 3].map(() => post(ordersCreate, 'https://zicabella.com/api/app/orders/create', body).then((r: Response) => r.json())));
    await settle(200);
    const ids = new Set(results.map((r: any) => r.orderId));
    eq('A11: all 3 responses succeed', results.map((r: any) => r.success), [true, true, true]);
    if (!results.every((r: any) => r.success)) console.log('      errors:', results.map((r: any) => r.error));
    eq('A11: all 3 responses point at ONE order', ids.size, 1);
    eq('A11: exactly ONE local order created', (db.order || []).length - ordersBefore, 1);
    const o = orderById([...ids][0] as string);
    eq('A11: exactly ONE store-credit debit', (db.storeCredit || []).filter(c => c.type === 'DEBIT' && c.idempotencyKey === `checkout:cust_app_1:${checkoutId}`).length, 1);
    eq('A11: wallet debited ₹3,797 once', b0 - balance(), 3797);
    eq('A11: order paid with internal method store_credit', [o?.paymentStatus, o?.paymentMethod], ['paid', 'store_credit']);
    eq('A11: one MobileOrder', (db.mobileOrder || []).filter(m => m.orderNumber === o?.internalOrderNumber).length, 1);
    eq('A11: one Shopify order', shopifyOrders.length - shopifyBefore, 1);
    verifyPurchase('A11 (value 0, one Purchase)', snapApp, o.id, { value: 0, ids: [V.DENIM, V.TEE], contents: [[V.DENIM, 2], [V.TEE, 1]], numItems: 3, source: 'MOBILE_APP' });
    // A later retry of the same checkout (e.g. app resent after a timeout) → same order, no new debit
    const again: any = await (await post(ordersCreate, 'https://zicabella.com/api/app/orders/create', body)).json(); await settle(100);
    eq('A11: later retry returns the same order', [again.orderId, again.orderNumber], [o.id, o.internalOrderNumber]);
    eq('A11: later retry does not debit again', b0 - balance(), 3797);
    eq('A11: still one order after retry', (db.order || []).length - ordersBefore, 1);
  }

  // A11b debit committed but the order was never written (crash between the two):
  // a retry with the same checkoutId must create the order under the reserved number
  // WITHOUT debiting again.
  console.log('\n— A11b store-credit retry after debit-only crash');
  { const checkoutId = 'sc_crash_retry_01';
    await prisma.storeCredit.create({ data: { customerId: 'cust_app_1', amount: -799, type: 'DEBIT', description: 'Applied to order #ZB99901', orderId: '#ZB99901', remainingAmount: 0, idempotencyKey: `checkout:cust_app_1:${checkoutId}` } });
    const b0 = balance();
    const r: any = await (await post(ordersCreate, 'https://zicabella.com/api/app/orders/create', { customerId: 'cust_app_1', customerEmail: 'aarav@example.com', customerPhone: '+919876543210', lineItems: [appLines[1]], appliedStoreCredits: 799, shippingAddress: appAddress,
      paymentMethod: 'Store Credit', paymentStatus: 'paid', total: 0, total_price: 0, subtotal: 799, checkoutId, snapDevice: iosDevice })).json();
    await settle(120);
    eq('A11b: order created under the reserved number', [r.success, r.orderNumber, orderById(r.orderId)?.internalOrderNumber], [true, 'ZB99901', 'ZB99901']);
    eq('A11b: no second debit', b0 - balance(), 0);
    eq('A11b: still one DEBIT row for the checkout', (db.storeCredit || []).filter(c => c.idempotencyKey === `checkout:cust_app_1:${checkoutId}`).length, 1);
  }

  // Concurrent duplicate debit (unique constraint path)
  console.log('\n— store credit concurrency');
  { const { debitStoreCredits } = await import('../../lib/storeCreditsHelper');
    const b0 = balance();
    const results = await Promise.allSettled([1, 2, 3].map(() => debitStoreCredits('cust_app_1', 250, '#ZBTEST', { idempotencyKey: 'rzp:order_CONCURRENT' })));
    eq('3 concurrent identical debits → balance reduced once', b0 - balance(), 250);
    check('…no request failed', results.every(x => x.status === 'fulfilled'), results.map(x => x.status));
    const noKey0 = balance();
    await debitStoreCredits('cust_app_1', 10, 'mobile_purchase'); await debitStoreCredits('cust_app_1', 10, 'mobile_purchase');
    eq('callers without a key behave exactly as before (two debits)', noKey0 - balance(), 20);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  report.push('', `**${passed} passed, ${failed} failed**`);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], report.join('\n'));
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
