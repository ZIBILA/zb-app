/**
 * Payment-audit regression scenarios (PAYMENT_AUDIT.md §11 S1–S10 + fixes A–E).
 * Runs the REAL route handlers against the in-memory Prisma with Razorpay /
 * Shopify / Meta / Snap / WhatsApp faked at the HTTP layer (same setup as run.ts).
 *
 *   ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PORT=1 \
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/audit-run.ts [report.md]
 */
import crypto from 'crypto';
import fs from 'fs';

Object.assign(process.env, {
  NODE_ENV: 'test',
  RAZORPAY_WEBHOOK_SECRET: 'whsec_test', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'secret',
  SNAP_CAPI_ACCESS_TOKEN: 'snap-token', NEXT_PUBLIC_SNAP_PIXEL_ID: '7d2481be-4ccf-42b2-b9ea-958c6c7bbdcd',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test', SHOPIFY_STORE_DOMAIN: 'test-shop.myshopify.com',
  NEXT_PUBLIC_SITE_URL: 'https://zicabella.com',
  META_CAPI_ACCESS_TOKEN: 'EAA' + 'B'.repeat(180), META_PIXEL_ID: '2049977412558608',
  WHATSAPP_PHONE_NUMBER_ID: '110000000000001', WHATSAPP_BUSINESS_ACCOUNT_ID: '220000000000002', WHATSAPP_TOKEN: 'EAA' + 'W'.repeat(120),
});
const KEY_SECRET = 'secret';
const V = { DENIM: '51813148262681', TEE: '51813148328217', JACKET: '51813148295449' };
const PRICE: Record<string, number> = { [V.DENIM]: 1499, [V.TEE]: 799, [V.JACKET]: 2201 };

type RzpPayment = { id: string; order_id: string; status: string; captured: boolean; amount: number; amount_refunded: number; currency: string; httpStatus?: number };
const razorpayPayments = new Map<string, RzpPayment>();
const shopifyOrders: any[] = []; const adminMails: string[] = []; const shopifyOrderErrors: string[] = [];
let shopifyOrderSeq = 6000; let shopifyCustomerSeq = 9100;
// Shopify customer directory for the sync scenarios (S15–S17)
const shopifyCustomers = new Map<number, { id: number; email: string | null; phone: string | null }>([
  [9001, { id: 9001, email: 'guest_1760000000@zicabella.in', phone: '+919811122233' }], // local customer's Shopify record (placeholder login email)
  [9002, { id: 9002, email: 'real.person@example.com', phone: '+919811199999' }],       // the email the shopper typed at checkout
  [9003, { id: 9003, email: 'hidden.person@example.com', phone: '+919811188888' }],     // only visible to search after a failed create (index lag)
]);
const searchLag = new Set<string>(['hidden.person@example.com']);
(globalThis as any).fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
  const m = u.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\/([^/?]+)/);
  if (m) { const p = razorpayPayments.get(m[1]); if (!p) return json(404, { error: { description: 'not found' } }); if (p.httpStatus) return json(p.httpStatus, { error: { description: 'simulated' } }); return json(200, { ...p }); }
  const op = u.match(/^https:\/\/api\.razorpay\.com\/v1\/orders\/([^/?]+)\/payments$/);
  if (op) return json(200, { items: [...razorpayPayments.values()].filter(p => p.order_id === op[1] && !p.httpStatus) });
  const o = u.match(/^https:\/\/api\.razorpay\.com\/v1\/orders\/([^/?]+)$/);
  if (o) { const paid = [...razorpayPayments.values()].some(p => p.order_id === o[1] && p.status === 'captured'); return json(200, { id: o[1], amount: 379700, currency: 'INR', status: paid ? 'paid' : 'created', notes: {} }); }
  if (u.startsWith('https://graph.facebook.com/')) return json(200, { events_received: 1, messages: [{ id: 'wamid.1' }] });
  if (u.startsWith('https://tr.snapchat.com/')) return json(200, { status: 'VALID' });
  if (u.startsWith('https://bzr.openai.com/')) return json(200, {});
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
      const body = JSON.parse(opt.body).order;
      // Shopify's contact-identity rules: a top-level email/phone must belong to the
      // order's customer (customer.id, or the customer the phone resolves to).
      const lc = (x: any) => String(x || '').trim().toLowerCase();
      if (body.customer?.id) {
        const c = shopifyCustomers.get(Number(body.customer.id));
        if (c && body.email && lc(c.email) !== lc(body.email)) { shopifyOrderErrors.push('customer.email_address'); return json(422, { errors: { 'customer.email_address': ['has already been taken'] } }); }
        if (c && body.phone && c.phone && c.phone !== body.phone) { shopifyOrderErrors.push('customer.phone'); return json(422, { errors: { 'customer.phone': ['has already been taken'] } }); }
      } else if (body.email && body.phone) {
        const byEmail = [...shopifyCustomers.values()].find(c => lc(c.email) === lc(body.email));
        const byPhone = [...shopifyCustomers.values()].find(c => c.phone === body.phone);
        if (byEmail && byPhone && byEmail.id !== byPhone.id) { shopifyOrderErrors.push('customer.phone'); return json(422, { errors: { 'customer.phone': ['has already been taken'] } }); }
      }
      const id = ++shopifyOrderSeq; shopifyOrders.push(body); return json(201, { order: { id, name: `#${id}`, ...body } });
    }
    if (u.includes('/orders.json')) return json(200, { orders: [] });
    const cm = u.match(/\/customers\/(\d+)\.json/);
    if (cm) { const c = shopifyCustomers.get(Number(cm[1])); return c ? json(200, { customer: c }) : json(404, { errors: 'Not Found' }); }
    if (u.includes('/customers/search.json')) {
      const qp = new URL(u).searchParams.get('query') || '';
      const m = qp.match(/^(email|phone):(.+)$/);
      if (!m) return json(200, { customers: [] });
      const val = m[2].trim().toLowerCase();
      if (searchLag.has(val)) { searchLag.delete(val); return json(200, { customers: [] }); }
      const hits = [...shopifyCustomers.values()].filter(c => m[1] === 'email' ? String(c.email || '').toLowerCase() === val : String(c.phone || '').toLowerCase() === val);
      return json(200, { customers: hits });
    }
    if (u.includes('/customers.json') && (opt.method || 'GET') === 'POST') {
      const c = JSON.parse(opt.body).customer || {};
      const lc = (x: any) => String(x || '').trim().toLowerCase();
      if (c.email && [...shopifyCustomers.values()].some(x => lc(x.email) === lc(c.email))) return json(422, { errors: { email: ['has already been taken'] } });
      if (c.phone && [...shopifyCustomers.values()].some(x => x.phone === c.phone)) return json(422, { errors: { phone: ['has already been taken'] } });
      const id = ++shopifyCustomerSeq; const created = { id, email: c.email || null, phone: c.phone || null }; shopifyCustomers.set(id, created); return json(201, { customer: created });
    }
    if (u.includes('/customers')) return json(200, { customers: [], customer: { id: 777 } });
    return json(200, {});
  }
  return json(200, {});
};

const settle = async (ms = 80) => { for (let i = 0; i < 200; i++) await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 200; i++) await new Promise(r => setImmediate(r)); };
const sig = (orderId: string, payId: string) => crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${payId}`).digest('hex');
let rzpN = 0; const newRzpOrder = () => `order_A${String(++rzpN).padStart(6, '0')}`;
const pay = (id: string, orderId: string, status: 'captured' | 'authorized' | 'failed', rupees: number, httpStatus?: number) =>
  razorpayPayments.set(id, { id, order_id: orderId, status, captured: status === 'captured', amount: Math.round(rupees * 100), amount_refunded: 0, currency: 'INR', httpStatus });

let failed = 0, passed = 0;
const report: string[] = ['# Payment audit — regression scenarios', '', `Generated by scripts/payment-e2e/audit-run.ts on ${new Date().toISOString()}`, ''];
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
  report.push(`- ${ok ? '✅' : '❌'} ${label}${ok || detail === undefined ? '' : ` — \`${JSON.stringify(detail).slice(0, 300)}\``}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });

async function main() {
  const { db, default: prisma } = await import('./memory-prisma');
  const authMock = await import('../meta-regression/mocks');
  const preCreate = await import('../../app/api/checkout/razorpay/route');
  const checkoutComplete = await import('../../app/api/checkout/complete/route');
  const cancelRoute = await import('../../app/api/checkout/cancel/route');
  const byRzp = await import('../../app/api/orders/by-razorpay/route');
  const webhook1 = await import('../../app/api/webhooks/razorpay/route');
  const webhook2 = await import('../../app/api/payments/webhook/route');
  const aliasWebhook = await import('../../app/api/razorpay/webhook/route');
  const { reconcilePendingMainOrders, PENDING_ORDER_TIMEOUT_MS } = await import('../../lib/services/razorpaySyncService');
  const { checkRateLimit } = await import('../../lib/rate-limit');
  const { isInAppBrowserUA } = await import('../../lib/in-app-browser');
  // Ops alerts go through notifyAdminTeam → sendAdminEmail, which without Zoho
  // config logs "Missing configuration — email not sent: <subject>". Capture it.
  for (const level of ['log', 'warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: any[]) => { const line = args.map(String).join(' '); if (/email not sent/.test(line)) adminMails.push(line); orig(...args); };
  }

  await prisma.shop.create({ data: { id: 'shop_1', name: 'Zica Bella', domain: 'test-shop.myshopify.com' } });
  await prisma.webStoreCoupon.create({ data: { code: 'SAVE500', isActive: true, applicability: 'ALL', discountType: 'fixed', discountValue: 500, minOrderValue: 0, usedCount: 0 } });
  await prisma.webStoreCoupon.create({ data: { code: 'CASH10', isActive: true, applicability: 'ALL', discountType: 'percentage', discountValue: 10, minOrderValue: 0, usedCount: 0, cashbackEnabled: true, cashbackType: 'percentage', cashbackValue: 10 } });
  await prisma.webStoreCoupon.create({ data: { code: 'OLD50', isActive: true, applicability: 'ALL', discountType: 'percentage', discountValue: 50, minOrderValue: 0, usedCount: 0, validUntil: new Date(Date.now() - 86_400_000) } });

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '81.2.69.142', 'user-agent': UA };
  const webAddress = { name: 'Riya Kapoor', email: 'riya@example.com', phone: '9811122233', houseNo: '12', street: 'MG Road', city: 'Noida', state: 'Uttar Pradesh', zip: '201301', country: 'India', countryCode: 'IN' };
  const webItems = [
    { productId: '10227656982809', variantId: V.DENIM, title: 'AEROLAYER DENIM', price: '1499', quantity: 2 },
    { productId: '10227656982810', variantId: V.TEE, title: 'TEE', price: '799', quantity: 1 },
  ];
  const post = (mod: any, url: string, body: any, extraHeaders: Record<string, string> = {}) => mod.POST(new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { ...headers, ...extraHeaders } }));
  const precreate = async (body: any) => { const r = await post(preCreate, 'https://zicabella.com/api/checkout/razorpay', body); return { status: r.status, ...(await r.json()) }; };
  const complete = (body: any) => post(checkoutComplete, 'https://zicabella.com/api/checkout/complete', body);
  const hook = async (mod: any, path: string, event: string, payId: string, rzp: string, status: string, extra: any = {}, eventIdHeader?: string) => {
    const body = JSON.stringify({ event, payload: { payment: { entity: { id: payId, order_id: rzp, status, captured: status === 'captured', amount: razorpayPayments.get(payId)?.amount ?? 0, currency: 'INR', method: 'upi', notes: {}, ...extra } } } });
    const res = await mod.POST(new Request(`https://zicabella.com${path}`, { method: 'POST', body, headers: { 'x-razorpay-signature': crypto.createHmac('sha256', 'whsec_test').update(body).digest('hex'), ...(eventIdHeader ? { 'x-razorpay-event-id': eventIdHeader } : {}) } }));
    const j = await res.json().catch(() => ({})); await settle(); return { status: res.status, ...j };
  };
  const hook1 = (e: string, p: string, r: string, s: string, x?: any, id?: string) => hook(webhook1, '/api/webhooks/razorpay', e, p, r, s, x, id);
  const hook2 = (e: string, p: string, r: string, s: string, x?: any, id?: string) => hook(webhook2, '/api/payments/webhook', e, p, r, s, x, id);
  const orderById = (id: string) => (db.order || []).find((o: any) => o.id === id);
  const ordersByRzp = (rzp: string) => (db.order || []).filter((o: any) => o.razorpayOrderId === rzp);
  const itemsOf = (orderId: string) => (db.orderItem || []).filter((i: any) => i.orderId === orderId);
  const couponUses = (code: string) => Number((db.webStoreCoupon || []).find((c: any) => c.code === code)?.usedCount || 0);
  const cashbackRows = (orderId: string) => (db.storeCredit || []).filter((c: any) => c.orderId === orderId && c.type === 'COUPON_REBATE');
  const emailsFor = (orderId: string) => (db.emailLog || []).filter((e: any) => e.referenceId === orderId);
  const shopifyFor = (num: string) => shopifyOrders.filter(o => JSON.stringify(o).includes(num));
  const basePre = { amount: 3797, currency: 'INR', displayCountry: 'IN', address: webAddress, items: webItems, subtotal: 3797, total: 3797, paymentMethod: 'razorpay' };

  // ── S1 coupon amounts are server-side (P1) ──
  console.log('\n— S1 client coupon / cashback amounts are ignored (P1)');
  report.push('## S1 — coupon discount and cashback come from the coupon row');
  { const rzp = newRzpOrder(); pay('pay_S1a', rzp, 'captured', 1);
    const r = await complete({ address: webAddress, items: webItems, subtotal: 3797, total: 1, couponCode: 'SAVE500', couponDiscount: 3796, paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_S1a', razorpay_signature: sig(rzp, 'pay_S1a') } });
    await settle(150); const o = ordersByRzp(rzp)[0];
    eq('S1a: ₹1 captured against a ₹3,297 server total → partially_paid, held for review (not paid)', [r.status, o?.paymentStatus, o?.shopifySyncStatus, (o?.tags || '').includes('underpaid')], [200, 'partially_paid', 'needs_review', true]);
    eq('S1a: discount stored is the coupon\'s ₹500, not the client\'s ₹3,796', o?.discountAmount, 500);
    eq('S1a: no Shopify order for an under-captured payment', shopifyFor(o?.internalOrderNumber).length, 0);
    check('S1a: ops alerted', adminMails.some(s => /Under-captured/.test(s)));
  }
  { const before = (db.order || []).length;
    const r = await complete({ address: webAddress, items: webItems, subtotal: 3797, total: 0, couponCode: 'SAVE500', couponDiscount: 3797, paymentMethod: 'coupon' });
    eq('S1b: "₹0 coupon order" with a ₹500 coupon → rejected (payment details required), no order', [r.status, (db.order || []).length - before], [400, 0]);
  }
  { const rzp = newRzpOrder(); pay('pay_S1c', rzp, 'captured', 3297);
    const r = await complete({ address: webAddress, items: webItems, subtotal: 3797, total: 3297, couponCode: 'SAVE500', couponDiscount: 500, cashbackAmount: 5000, paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_S1c', razorpay_signature: sig(rzp, 'pay_S1c') } });
    const j: any = await r.json(); await settle(150);
    eq('S1c: client cashbackAmount=5000 on a coupon without cashback → no store credit minted', [r.status, orderById(j.orderId)?.paymentStatus, cashbackRows(j.orderId).length], [200, 'paid', 0]);
  }
  { const rzp = newRzpOrder(); pay('pay_S1d', rzp, 'captured', 3797);
    const r = await complete({ address: webAddress, items: webItems, subtotal: 3797, total: 1899, couponCode: 'OLD50', couponDiscount: 1898, paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_S1d', razorpay_signature: sig(rzp, 'pay_S1d') } });
    const j: any = await r.json(); await settle(150); const o = orderById(j.orderId);
    eq('S1d: expired coupon → no discount; full ₹3,797 captured → paid', [r.status, o?.paymentStatus, o?.discountCode ?? null, o?.discountAmount, o?.totalPrice], [200, 'paid', null, 0, 3797]);
  }

  // ── S2 replayed completion (P4) ──
  console.log('\n— S2 replayed /api/checkout/complete (P4)');
  report.push('', '## S2 — replay of a completed request is a no-op');
  { const rzp = newRzpOrder(); pay('pay_S2', rzp, 'captured', 3417);
    const body = { address: webAddress, items: webItems, subtotal: 3797, total: 3417, couponCode: 'CASH10', couponDiscount: 380, cashbackAmount: 100, paymentMethod: 'razorpay', razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_S2', razorpay_signature: sig(rzp, 'pay_S2') } };
    const u0 = couponUses('CASH10');
    const r1 = await complete(body); const j1: any = await r1.json(); await settle(150);
    const r2 = await complete(body); const j2: any = await r2.json(); await settle(150);
    const r3 = await complete(body); await settle(150);
    eq('S2: first post completes, replays answer 200 alreadyCompleted', [r1.status, r2.status, r3.status, j2.alreadyCompleted, j2.orderId === j1.orderId], [200, 200, 200, true, true]);
    eq('S2: one local order, one Shopify order', [ordersByRzp(rzp).length, shopifyFor(orderById(j1.orderId).internalOrderNumber).length], [1, 1]);
    eq('S2: coupon usedCount +1 after three posts', couponUses('CASH10') - u0, 1);
    eq('S2: one cashback credit, server-computed (10% of ₹3,417 = ₹342), not the client\'s ₹100', cashbackRows(j1.orderId).map((c: any) => c.amount), [342]);
    eq('S2: one confirmation email', emailsFor(j1.orderId).length, 1);
    const swapped = { ...body, items: [{ productId: 'p3', variantId: V.JACKET, title: 'JACKET', price: '2201', quantity: 1 }], subtotal: 2201, total: 2201 };
    const r4 = await complete(swapped); await settle(150);
    eq('S2: re-post with different items after payment → ignored, local items unchanged', [r4.status, itemsOf(j1.orderId).map((i: any) => [i.variantId, i.quantity])], [200, [[V.DENIM, 2], [V.TEE, 1]]]);
  }

  // ── S3 failed attempt then captured retry via webhooks (P5) ──
  console.log('\n— S3 payment.failed then payment.captured, browser never completes (P5)');
  report.push('', '## S3 — successful retry after a failed attempt becomes a live order');
  { const pre = await precreate({ ...basePre, checkoutSessionId: 'cs_S3' });
    const rzp = pre.razorpay_order_id; pay('pay_S3a', rzp, 'failed', 3797); pay('pay_S3b', rzp, 'captured', 3797);
    await hook1('payment.failed', 'pay_S3a', rzp, 'failed', { error_code: 'BAD_REQUEST_ERROR', error_reason: 'payment_failed', error_source: 'bank' });
    const f = orderById(pre.localOrderId);
    eq('S3: after payment.failed → failed / FAILED', [f?.paymentStatus, f?.status], ['failed', 'FAILED']);
    const h = await hook1('payment.captured', 'pay_S3b', rzp, 'captured');
    const c = orderById(pre.localOrderId);
    eq('S3: payment.captured → paid / approved (status reset, visible to the customer)', [h.status, c?.paymentStatus, c?.status], [200, 'paid', 'approved']);
    eq('S3: mirror row paid, one Shopify order', [(db.webStoreOrder || []).find((w: any) => w.razorpayOrderId === rzp)?.paymentStatus, shopifyFor(c?.internalOrderNumber).length], ['paid', 1]);
  }

  // ── S4 short capture via both webhooks (P3) ──
  console.log('\n— S4 captured amount below the order total (P3)');
  report.push('', '## S4 — under-captured payments are held for review');
  for (const [label, hk, pid, cs] of [['S4 webhook #1', hook1, 'pay_S4', 'cs_S4'], ['S4b webhook #2', hook2, 'pay_S4b', 'cs_S4b']] as const) {
    const pre = await precreate({ ...basePre, checkoutSessionId: cs });
    const rzp = pre.razorpay_order_id; pay(pid, rzp, 'captured', 100);
    const h = await (hk as any)('payment.captured', pid, rzp, 'captured');
    const o = orderById(pre.localOrderId);
    eq(`${label}: ₹100 on ₹3,797 → partially_paid + underpaid + needs_review, no Shopify order`, [h.status, o?.paymentStatus, (o?.tags || '').includes('underpaid'), o?.shopifySyncStatus, shopifyFor(o?.internalOrderNumber).length], [200, 'partially_paid', true, 'needs_review', 0]);
  }

  // ── S5 duplicate deliveries (P14) ──
  console.log('\n— S5 concurrent duplicate deliveries + cross-endpoint + event-id header (P14)');
  report.push('', '## S5 — duplicate webhook deliveries are processed once');
  { const pre = await precreate({ ...basePre, checkoutSessionId: 'cs_S5' });
    const rzp = pre.razorpay_order_id; pay('pay_S5', rzp, 'captured', 3797);
    const [a, b] = await Promise.all([hook1('payment.captured', 'pay_S5', rzp, 'captured'), hook1('payment.captured', 'pay_S5', rzp, 'captured')]);
    await settle(150);
    const o = orderById(pre.localOrderId);
    eq('S5: both acknowledged, exactly one flagged duplicate', [a.status, b.status, [a.duplicate, b.duplicate].filter(Boolean).length], [200, 200, 1]);
    eq('S5: one Payment row, one WebhookEvent row, one Shopify order', [(db.payment || []).filter((p: any) => p.orderId === o?.id).length, (db.webhookEvent || []).filter((w: any) => String(w.payload).includes('pay_S5')).length, shopifyFor(o?.internalOrderNumber).length], [1, 1, 1]);
    const c = await hook2('payment.captured', 'pay_S5', rzp, 'captured');
    eq('S5: same event to webhook #2 → already processed', [c.status, c.message], [200, 'Already processed']);
    const d = await hook1('order.paid', 'pay_S5', rzp, 'captured', {}, 'evt_S5_order_paid');
    const d2 = await hook1('order.paid', 'pay_S5', rzp, 'captured', {}, 'evt_S5_order_paid');
    eq('S5: x-razorpay-event-id de-duplicates a redelivery', [d.status, d.duplicate ?? false, d2.duplicate], [200, false, true]);
    const alias = await hook(aliasWebhook, '/api/razorpay/webhook', 'payment.captured', 'pay_S5', rzp, 'captured');
    eq('S5: documented /api/razorpay/webhook alias reaches the same handler', [alias.status, alias.duplicate], [200, true]);
  }

  // ── S6 cancel route is bound to the signed-in customer (P13) ──
  console.log('\n— S6 /api/checkout/cancel authentication (P13)');
  report.push('', '## S6 — cancel is bound to the shopper');
  { const pre = await precreate({ ...basePre, checkoutSessionId: 'cs_S6' });
    const rzp = pre.razorpay_order_id; const owner = orderById(pre.localOrderId)?.customerId;
    const anon = await cancelRoute.POST(new Request('https://zicabella.com/api/checkout/cancel', { method: 'POST', body: JSON.stringify({ razorpayOrderId: rzp }), headers: { 'content-type': 'application/json' } }));
    eq('S6: anonymous cancel → 401, order untouched', [anon.status, orderById(pre.localOrderId)?.paymentStatus], [401, 'pending']);
    authMock.state.session = { user: { id: 'someone_else' } };
    const other = await cancelRoute.POST(new Request('https://zicabella.com/api/checkout/cancel', { method: 'POST', body: JSON.stringify({ razorpayOrderId: rzp }), headers: { 'content-type': 'application/json' } }));
    const oj: any = await other.json();
    eq('S6: another customer cannot cancel it', [other.status, oj.updated, orderById(pre.localOrderId)?.paymentStatus], [200, 0, 'pending']);
    authMock.state.session = { user: { id: owner } };
    const own = await cancelRoute.POST(new Request('https://zicabella.com/api/checkout/cancel', { method: 'POST', body: JSON.stringify({ razorpayOrderId: rzp }), headers: { 'content-type': 'application/json' } }));
    const o1 = orderById(pre.localOrderId);
    eq('S6: the owner can', [own.status, o1?.paymentStatus, o1?.status], [200, 'cancelled', 'cancelled']);
    authMock.state.session = null;
    pay('pay_S6', rzp, 'captured', 3797);
    const r = await complete({ ...basePre, localOrderId: pre.localOrderId, razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_S6', razorpay_signature: sig(rzp, 'pay_S6') } });
    await settle(150); const o2 = orderById(pre.localOrderId);
    eq('S6: a later successful payment on the same Razorpay order still revives it', [r.status, o2?.paymentStatus, o2?.status], [200, 'paid', 'approved']);
  }

  // ── S7 by-razorpay exposes paymentStatus (consumed by the pages) ──
  console.log('\n— S7 /api/orders/by-razorpay reports the payment state');
  report.push('', '## S7 — lookup reports paymentStatus');
  { const pre = await precreate({ ...basePre, checkoutSessionId: 'cs_S7' });
    const r = await byRzp.GET(new Request(`https://zicabella.com/api/orders/by-razorpay?orderId=${pre.razorpay_order_id}`));
    const j: any = await r.json().catch(() => ({}));
    eq('S7: never-paid order → 200 with paymentStatus "pending" (pages show "not confirmed yet")', [r.status, j.paymentStatus], [200, 'pending']);
  }

  // ── S8 paid Razorpay order differs from the pre-created pointer (P7) ──
  console.log('\n— S8 /complete re-points the local order to the Razorpay order that was paid (P7)');
  report.push('', '## S8 — local order follows the paid Razorpay order');
  { const pre = await precreate({ ...basePre, checkoutSessionId: 'cs_S8' });
    const rzpA = pre.razorpay_order_id; const rzpB = newRzpOrder(); pay('pay_S8', rzpB, 'captured', 3797);
    const r = await complete({ ...basePre, localOrderId: pre.localOrderId, razorpay: { razorpay_order_id: rzpB, razorpay_payment_id: 'pay_S8', razorpay_signature: sig(rzpB, 'pay_S8') } });
    const j: any = await r.json(); await settle(150); const o = orderById(pre.localOrderId);
    eq('S8: pre-created order paid and re-pointed to the paid Razorpay order', [r.status, j.orderId === pre.localOrderId, o?.paymentStatus, o?.razorpayOrderId === rzpB, o?.razorpayOrderId === rzpA], [200, true, 'paid', true, false]);
    const h = await hook1('payment.captured', 'pay_S8', rzpB, 'captured');
    eq('S8: later webhook for the paid order finds it (no placeholder, no 500)', [h.status, (db.order || []).filter((x: any) => x.razorpayPaymentId === 'pay_S8').length, (db.order || []).some((x: any) => (x.tags || '').includes('RazorpayRecovery'))], [200, 1, false]);
  }

  // ── S9 pre-create re-prices from the catalog (P2) ──
  console.log('\n— S9 pre-create charges catalog prices (P2)');
  report.push('', '## S9 — the Razorpay order is created for the server price');
  { const cheap = [{ productId: '10227656982809', variantId: V.DENIM, title: 'AEROLAYER DENIM', price: '1', quantity: 2 }];
    const pre = await precreate({ amount: 2, currency: 'INR', displayCountry: 'IN', address: webAddress, items: cheap, subtotal: 2, total: 2, paymentMethod: 'razorpay', checkoutSessionId: 'cs_S9' });
    const o = orderById(pre.localOrderId);
    eq('S9: ₹1,499 ×2 sent as ₹1 ×2 → Razorpay order for ₹2,998, local order ₹2,998', [pre.status, pre.amount, o?.totalPrice, itemsOf(o?.id).map((i: any) => i.price)], [200, 299800, 2998, [1499]]);
    check('S9: order not tagged prices_unverified', !(o?.tags || '').includes('prices_unverified'), o?.tags);
    eq('S9: coupon discount recomputed at pre-create (SAVE500 on ₹2,998)', (await precreate({ amount: 2498, currency: 'INR', displayCountry: 'IN', address: webAddress, items: cheap, subtotal: 2, total: 2, couponCode: 'SAVE500', couponDiscount: 2997, paymentMethod: 'razorpay', checkoutSessionId: 'cs_S9b' })).amount, 249800);
  }

  // ── S10 Razorpay API down during /complete ──
  console.log('\n— S10 Razorpay payments API 5xx while verifying capture');
  report.push('', '## S10 — unverifiable capture stays pending');
  { const rzp = newRzpOrder(); pay('pay_S10', rzp, 'captured', 3797, 503);
    const r = await complete({ ...basePre, razorpay: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_S10', razorpay_signature: sig(rzp, 'pay_S10') } });
    const j: any = await r.json(); await settle(100);
    eq('S10: 202 pending_capture, order kept payment_pending', [r.status, j.paymentState, ordersByRzp(rzp)[0]?.paymentStatus], [202, 'pending_capture', 'payment_pending']);
  }

  // ── S11 rate limits are scoped per shopper / per order (P8) ──
  console.log('\n— S11 rate-limit scoping (P8)');
  report.push('', '## S11 — shoppers behind one IP do not share a bucket');
  { const mk = () => new Request('https://zicabella.com/x', { headers: { 'x-forwarded-for': '10.0.0.1, 172.16.0.1', 'cf-connecting-ip': '203.0.113.9' } });
    let aBlocked = false; for (let i = 0; i < 61; i++) { const r = await checkRateLimit(mk(), 's11', { maxRequests: 60, windowMs: 60_000, scope: 'cust_A' }); if (!r.allowed) aBlocked = true; }
    const b = await checkRateLimit(mk(), 's11', { maxRequests: 60, windowMs: 60_000, scope: 'cust_B' });
    eq('S11: customer A exhausted its bucket, customer B on the same IP is still allowed', [aBlocked, b.allowed], [true, true]);
    const k1 = await checkRateLimit(mk(), 's11-order', { maxRequests: 2, windowMs: 60_000, key: 'checkout-complete:order:order_X' });
    const k2 = await checkRateLimit(new Request('https://zicabella.com/x', { headers: { 'cf-connecting-ip': '198.51.100.7' } }), 's11-order', { maxRequests: 2, windowMs: 60_000, key: 'checkout-complete:order:order_X' });
    const k3 = await checkRateLimit(mk(), 's11-order', { maxRequests: 2, windowMs: 60_000, key: 'checkout-complete:order:order_X' });
    eq('S11: per-order key is independent of the IP', [k1.allowed, k2.allowed, k3.allowed], [true, true, false]);
  }

  // ── S12 pre-create never re-points a row that recorded a payment attempt (P7) ──
  console.log('\n— S12 pre-create reuse guard (P7)');
  report.push('', '## S12 — a pending order with a payment attempt is not re-pointed');
  { const pre1 = await precreate({ ...basePre, checkoutSessionId: 'cs_S12' });
    await prisma.order.update({ where: { id: pre1.localOrderId }, data: { razorpayPaymentId: 'pay_S12_attempt' } });
    const pre2 = await precreate({ ...basePre, total: 3297, amount: 3297, couponCode: 'SAVE500', checkoutSessionId: 'cs_S12' });
    eq('S12: second prefetch gets a NEW pending order; the first keeps its Razorpay order', [pre2.localOrderId !== pre1.localOrderId, orderById(pre1.localOrderId)?.razorpayOrderId === pre1.razorpay_order_id], [true, true]);
  }
  { const pre1 = await precreate({ ...basePre, checkoutSessionId: 'cs_S12b' });
    const pre2 = await precreate({ ...basePre, total: 3297, amount: 3297, couponCode: 'SAVE500', checkoutSessionId: 'cs_S12b' });
    eq('S12b: without an attempt the same session reuses its pending order', [pre2.localOrderId === pre1.localOrderId, orderById(pre1.localOrderId)?.razorpayOrderId === pre2.razorpay_order_id], [true, true]);
  }

  // ── S13 cron reconciliation on the Order table (P5 / P22) ──
  console.log('\n— S13 cron: captures without a mirror row, paid+FAILED repair, abandoned timeouts');
  report.push('', '## S13 — main-order reconciliation');
  { const captured = await precreate({ ...basePre, checkoutSessionId: 'cs_S13a' });
    await prisma.webStoreOrder.deleteMany({ where: { razorpayOrderId: captured.razorpay_order_id } });
    pay('pay_S13a', captured.razorpay_order_id, 'captured', 3797);
    const stuck = await precreate({ ...basePre, checkoutSessionId: 'cs_S13b' });
    pay('pay_S13b', stuck.razorpay_order_id, 'captured', 3797);
    await prisma.order.update({ where: { id: stuck.localOrderId }, data: { paymentStatus: 'paid', status: 'FAILED', razorpayPaymentId: 'pay_S13b' } });
    const old = await precreate({ ...basePre, checkoutSessionId: 'cs_S13c' });
    await prisma.order.update({ where: { id: old.localOrderId }, data: { createdAt: new Date(Date.now() - PENDING_ORDER_TIMEOUT_MS - 60_000) } });
    const fresh = await precreate({ ...basePre, checkoutSessionId: 'cs_S13d' });
    const authorized = await precreate({ ...basePre, checkoutSessionId: 'cs_S13e' });
    pay('pay_S13e', authorized.razorpay_order_id, 'authorized', 3797);
    await prisma.order.update({ where: { id: authorized.localOrderId }, data: { createdAt: new Date(Date.now() - PENDING_ORDER_TIMEOUT_MS - 60_000) } });
    const res = await reconcilePendingMainOrders(); await settle(150);
    const a = orderById(captured.localOrderId);
    eq('S13: capture with no mirror row → paid / approved + Shopify order', [a?.paymentStatus, a?.status, a?.razorpayPaymentId, shopifyFor(a?.internalOrderNumber).length], ['paid', 'approved', 'pay_S13a', 1]);
    eq('S13: paid order stuck in FAILED → approved', orderById(stuck.localOrderId)?.status, 'approved');
    eq('S13: abandoned checkout older than the timeout → failed / payment_timed_out', [orderById(old.localOrderId)?.paymentStatus, orderById(old.localOrderId)?.paymentFailureReason], ['failed', 'payment_timed_out']);
    eq('S13: fresh pending order untouched; authorized-only order kept pending', [orderById(fresh.localOrderId)?.paymentStatus, orderById(authorized.localOrderId)?.paymentStatus], ['pending', 'pending']);
    eq('S13: result counts', [res.markedPaid.length, res.timedOut.length, res.statusRepaired], [1, 1, 1]);
  }

  // ── S14 in-app browser detection (S1 of the audit) ──
  console.log('\n— S14 in-app browser detection');
  report.push('', '## S14 — in-app browsers use the redirect flow');
  { const ig = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.4.32.98';
    const fb = 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/462.0.0.47.90;]';
    const snap = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.80.0.42';
    const safari = UA;
    const chromeIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1';
    const chromeAndroid = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36';
    eq('S14: Instagram / Facebook / Snapchat → redirect flow', [isInAppBrowserUA(ig), isInAppBrowserUA(fb), isInAppBrowserUA(snap)], [true, true, true]);
    eq('S14: Safari / Chrome iOS / Chrome Android → modal flow', [isInAppBrowserUA(safari), isInAppBrowserUA(chromeIos), isInAppBrowserUA(chromeAndroid)], [false, false, false]);
  }

  // ── S15–S17 Shopify sync: customer identity conflicts (order #ZB81380) ──
  console.log('\n— S15 sync: checkout email belongs to another Shopify customer (#ZB81380)');
  report.push('', '## S15–S17 — Shopify sync resolves customer identity instead of failing with 422');
  const { syncOrderToShopify } = await import('../../lib/services/shopifyOrderSyncService');
  const { repairSyncedOrderStatuses } = await import('../../lib/services/orderLifecycleService');
  const { classifyShopifySyncError } = await import('../../lib/services/shopifyCustomerIdentity');
  const { fetchVariantPrices, clearVariantPriceCache } = await import('../../lib/variant-prices');
  const mkOrder = async (n: number, cust: { shopifyId: string; email: string; phone: string }, addr: { email: string; phone: string }) => {
    const customer = await prisma.customer.create({ data: { id: `cust_s${n}`, shopId: 'shop_1', shopifyId: cust.shopifyId, name: 'Riya Kapoor', email: cust.email, phone: cust.phone } });
    const order = await prisma.order.create({ data: { shopId: 'shop_1', customerId: customer.id, status: 'open', paymentStatus: 'cod_upfront_paid', paymentMethod: 'cod', totalPrice: 1749.75, subtotalPrice: 1749.75, codUpfrontPaid: 99, codUpfrontPaymentId: `pay_S${n}`, razorpayPaymentId: `pay_S${n}`, razorpayOrderId: `order_S${n}`, orderType: 'WEB_STORE', internalOrderNumber: `ZB9${n}`, shopifySyncStatus: 'pending', tags: 'WebStoreOrder, Web, razorpay, cod_upfront_paid', shippingAddress: JSON.stringify({ name: 'Riya Kapoor', email: addr.email, phone: addr.phone, street: '12 MG Road', city: 'Noida', state: 'Uttar Pradesh', zip: '201301', country: 'India' }), items: { create: [{ shopifyLineItemId: `li_s${n}`, title: 'CHAINSTER ZIP SHIRT', quantity: 1, price: 1749.75, sku: V.TEE, variantId: V.TEE }] } } });
    return order;
  };
  { const o = await mkOrder(15, { shopifyId: '9001', email: 'guest_1760000000@zicabella.in', phone: '+919811122233' }, { email: 'real.person@example.com', phone: '9811122233' });
    const before = shopifyOrders.length; shopifyOrderErrors.length = 0;
    const r = await syncOrderToShopify(o.id);
    const payload = shopifyOrders[shopifyOrders.length - 1];
    const row = orderById(o.id);
    eq('S15: order synced on the first attempt (no 422)', [r.success, shopifyOrders.length - before, shopifyOrderErrors.length, row?.shopifySyncStatus, /^\d+$/.test(String(row?.shopifyOrderId))], [true, 1, 0, 'synced', true]);
    eq('S15: payload keeps the known Shopify customer and omits the conflicting top-level email', [payload?.customer?.id, payload?.email ?? null, payload?.phone], [9001, null, '+919811122233']);
    eq('S15: the typed email is preserved as a note attribute', (payload?.note_attributes || []).some((a: any) => a.name === 'checkout_email' && a.value === 'real.person@example.com'), true);
  }
  { const o = await mkOrder(16, { shopifyId: 'temp_abc', email: 'real.person@example.com', phone: '+919811199999' }, { email: 'real.person@example.com', phone: '9811199999' });
    const r = await syncOrderToShopify(o.id);
    const payload = shopifyOrders[shopifyOrders.length - 1];
    eq('S16: without a Shopify id the customer is found by email and linked', [r.success, payload?.customer?.id, payload?.email, (db.customer || []).find((c: any) => c.id === 'cust_s16')?.shopifyId], [true, 9002, 'real.person@example.com', '9002']);
  }
  { const o = await mkOrder(17, { shopifyId: 'temp_def', email: 'hidden.person@example.com', phone: '+919811188888' }, { email: 'hidden.person@example.com', phone: '9811188888' });
    const r = await syncOrderToShopify(o.id);
    const payload = shopifyOrders[shopifyOrders.length - 1];
    eq('S17: customer creation conflict ("email has already been taken") → re-search → existing customer used', [r.success, payload?.customer?.id, orderById(o.id)?.shopifySyncStatus], [true, 9003, 'synced']);
  }
  { const o = await mkOrder(18, { shopifyId: 'temp_ghi', email: 'brand.new@example.com', phone: '+919811177777' }, { email: 'brand.new@example.com', phone: '9811177777' });
    const r = await syncOrderToShopify(o.id);
    const payload = shopifyOrders[shopifyOrders.length - 1];
    eq('S18: unknown customer is created and attached', [r.success, typeof payload?.customer?.id, payload?.email], [true, 'number', 'brand.new@example.com']);
  }

  // ── S19 sync status repair (55 synced orders showed PENDING SYNC) ──
  console.log('\n— S19 synced orders wrongly marked pending are repaired');
  report.push('', '## S19 — status repair for orders already in Shopify');
  { const a = await prisma.order.create({ data: { shopId: 'shop_1', status: 'approved', paymentStatus: 'paid', paymentMethod: 'razorpay', totalPrice: 100, orderType: 'WEB_STORE', internalOrderNumber: 'ZB9191', shopifyOrderId: '18976615006489', shopifySyncStatus: 'pending', shippingAddress: '{}' } });
    const b = await prisma.order.create({ data: { shopId: 'shop_1', status: 'approved', paymentStatus: 'paid', paymentMethod: 'razorpay', totalPrice: 100, orderType: 'WEB_STORE', internalOrderNumber: 'ZB9192', shopifyOrderId: '18976615006490', shopifySyncStatus: 'failed', shopifySyncError: 'old', shippingAddress: '{}' } });
    const c = await prisma.order.create({ data: { shopId: 'shop_1', status: 'approved', paymentStatus: 'paid', paymentMethod: 'razorpay', totalPrice: 100, orderType: 'WEB_STORE', internalOrderNumber: 'ZB9193', shopifyOrderId: 'local_x', shopifySyncStatus: 'pending', shippingAddress: '{}' } });
    const repaired = await repairSyncedOrderStatuses();
    eq('S19: rows with a real Shopify id are marked synced; local placeholders untouched', [repaired >= 2, orderById(a.id)?.shopifySyncStatus, orderById(b.id)?.shopifySyncStatus, orderById(b.id)?.shopifySyncError ?? null, orderById(c.id)?.shopifySyncStatus], [true, 'synced', 'synced', null, 'pending']);
    const d = await prisma.order.create({ data: { shopId: 'shop_1', status: 'approved', paymentStatus: 'paid', paymentMethod: 'razorpay', totalPrice: 100, orderType: 'WEB_STORE', internalOrderNumber: 'ZB9194', shopifyOrderId: '18976615006491', shopifySyncStatus: 'pending', shippingAddress: '{}' } });
    const before = shopifyOrders.length;
    const r = await syncOrderToShopify(d.id);
    eq('S19: sync fast path repairs the status and never re-creates', [r.success, r.shopifyOrderId, orderById(d.id)?.shopifySyncStatus, shopifyOrders.length - before], [true, '18976615006491', 'synced', 0]);
    // /complete after a webhook-first sync keeps 'synced'
    const pre = await precreate({ ...basePre, checkoutSessionId: 'cs_S19' });
    await prisma.order.update({ where: { id: pre.localOrderId }, data: { shopifyOrderId: '18976615006492', shopifySyncStatus: 'synced' } });
    pay('pay_S19', pre.razorpay_order_id, 'captured', 3797);
    const cr = await complete({ ...basePre, localOrderId: pre.localOrderId, razorpay: { razorpay_order_id: pre.razorpay_order_id, razorpay_payment_id: 'pay_S19', razorpay_signature: sig(pre.razorpay_order_id, 'pay_S19') } });
    await settle(150);
    eq('S19: /complete keeps shopifySyncStatus=synced for an order the webhook already synced', [cr.status, orderById(pre.localOrderId)?.shopifySyncStatus, orderById(pre.localOrderId)?.shopifyOrderId], [200, 'synced', '18976615006492']);
  }

  // ── S20 variant prices via GraphQL + error classification ──
  console.log('\n— S20 variant prices (GraphQL nodes) and sync error classification');
  report.push('', '## S20 — variant prices and error classification');
  { clearVariantPriceCache();
    const m = await fetchVariantPrices([V.DENIM, `gid://shopify/ProductVariant/${V.TEE}`, '1']);
    eq('S20: prices come from the GraphQL nodes query; unknown ids are missing', [m.get(V.DENIM), m.get(V.TEE), m.has('1')], [1499, 799, false]);
    const c1 = classifyShopifySyncError(new Error('Shopify API 422: {"errors":{"customer.email_address":["has already been taken"]}}'));
    const c2 = classifyShopifySyncError(new Error('The operation was aborted due to timeout'));
    const c3 = classifyShopifySyncError(new Error('Shopify API 429: {"errors":"Exceeded 2 calls per second"}'));
    eq('S20: 422 → validation (needs attention); timeout and 429 → retryable', [c1.kind, c1.retryable, c2.kind, c2.retryable, c3.kind, c3.retryable], ['validation', false, 'timeout', true, 'rate_limit', true]);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  report.push('', `**${passed} passed, ${failed} failed**`);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], report.join('\n'));
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
