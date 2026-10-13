/**
 * Order-confirmation page — browser Purchase (Snap Pixel, and the Meta Pixel that
 * shares the same gate), end to end in a browser-like environment.
 *
 *   ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PORT=1 \
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/snap-e2e/tsconfig.json scripts/verify-snap-confirmation.tsx
 *
 * Renders the REAL page component (app/orders/[id]/confirmation/page.tsx) in
 * jsdom, with the REAL /api/orders/[id]/confirmation route handler behind
 * `fetch` (in-memory database) and recording stand-ins for snaptr / fbq.
 *
 * What was broken: after checkout the page shows an optimistic copy of the order
 * that has no payment status, and the confirmation API did not return one
 * either — so the "fire only when paid" gate always answered "not paid" and the
 * browser Purchase never fired, in any flow.
 */
import crypto from 'crypto';
import { JSDOM } from 'jsdom';

const PIXEL = '7d2481be-4ccf-42b2-b9ea-958c6c7bbdcd';
Object.assign(process.env, {
  NODE_ENV: 'test',
  NEXT_PUBLIC_SNAP_PIXEL_ID: PIXEL,
  NEXT_PUBLIC_META_PIXEL_ID: '2049977412558608',
  NEXT_PUBLIC_SITE_URL: 'https://zicabella.com',
});

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://zicabella.com/', pretendToBeVisual: true });
const g: any = globalThis;
g.window = dom.window; g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
g.sessionStorage = dom.window.sessionStorage; g.localStorage = dom.window.localStorage;
// DOM constructors the UI libraries look up as globals (HTMLElement, SVGElement, Event …).
for (const name of Object.getOwnPropertyNames(dom.window)) {
  if (/^[A-Z]/.test(name) && !(name in g)) { try { g[name] = (dom.window as any)[name]; } catch { /* not copyable */ } }
}
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id: any) => clearTimeout(id);
dom.window.matchMedia = dom.window.matchMedia || ((q: string) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } })) as any;
g.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
dom.window.scrollTo = () => {};
g.IS_REACT_ACT_ENVIRONMENT = true;

// The page re-checks a pending payment every 10 s; run those ticks fast.
const realSetInterval = globalThis.setInterval;
g.setInterval = ((fn: any, ms?: number, ...a: any[]) => realSetInterval(fn, ms && ms >= 1000 ? 25 : ms, ...a)) as any;

let passed = 0, failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });
const h = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

// ── recorders ──
let snapCalls: any[][] = [], fbqCalls: any[][] = [];
let requests: Array<{ method: string; url: string; body?: any }> = [];
g.window.snaptr = (...a: any[]) => { snapCalls.push(a); };
g.window.fbq = (...a: any[]) => { fbqCalls.push(a); };
g.snaptr = g.window.snaptr; g.fbq = g.window.fbq;

// ── scripted server ──
type CompleteScript = Array<{ status: number; body: any }>;
let completeScript: CompleteScript = [];
let factsDown = false;
let confirmationRoute: any;
g.fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  const method = String(opt.method || 'GET').toUpperCase();
  let body: any;
  try { body = typeof opt.body === 'string' ? JSON.parse(opt.body) : opt.body; } catch { body = opt.body; }
  requests.push({ method, url: u, body });
  const json = (status: number, payload: any) => ({ ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload), headers: new Map() });
  if (u === '/api/checkout/complete') {
    const next = completeScript.length > 1 ? completeScript.shift()! : completeScript[0];
    return next ? json(next.status, next.body) : json(500, { error: 'no script' });
  }
  const m = u.match(/^\/api\/orders\/([^/?]+)\/confirmation(\?.*)?$/);
  if (m) {
    if (factsDown) return json(500, { error: 'temporarily unavailable' });
    // The REAL route handler of this tree, against the in-memory database.
    const res = await confirmationRoute.GET(new Request(`https://zicabella.com${u}`), { params: { id: decodeURIComponent(m[1]) } });
    const payload = await res.json();
    return json(res.status, payload);
  }
  if (u.startsWith('/api/orders/by-razorpay')) return json(404, {});
  return json(200, {});
};

const settle = async (ms = 60) => {
  for (let i = 0; i < 300; i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) await new Promise(r => setImmediate(r));
};

const V = { DENIM: '51813148262681', TEE: '51813148328217' };

async function main() {
  const React = (await import('react')).default;
  g.React = React; // the page's JSX is compiled to React.createElement by tsx (Next uses the automatic runtime)
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const mocks = await import('./snap-e2e/mocks');
  const { db, default: prisma } = await import('./payment-e2e/memory-prisma');
  confirmationRoute = await import('../app/api/orders/[id]/confirmation/route');
  const { default: Page } = await import('../app/orders/[id]/confirmation/page') as any;
  const bp = await import('../lib/meta/browser-purchase');

  await prisma.customer.create({ data: { id: 'cust_us', name: 'John Smith', email: 'john.smith@example.com', phone: '(415) 555-2671' } });
  const usAddress = { name: 'John Smith', email: 'john.smith@example.com', phone: '(415) 555-2671', street: '1 Market Street', city: 'San Francisco', state: 'California', zip: '94105-1234', country: 'United States', countryCode: 'US' };
  let n = 0;
  const mkOrder = async (over: Record<string, any> = {}) => {
    const id = over.id || `ordconf${++n}`;
    await prisma.order.create({ data: {
      id, internalOrderNumber: `ZB9${String(n).padStart(4, '0')}`, orderType: 'WEB_STORE', paymentStatus: 'paid', paymentMethod: 'razorpay', status: 'approved',
      totalPrice: 113.91, subtotalPrice: 113.91, currency: 'USD', customerId: 'cust_us', createdAt: new Date(), paymentCapturedAt: new Date(),
      shippingAddress: JSON.stringify(usAddress), tags: 'WebStoreOrder, Web', note: '',
      items: { create: [
        { title: 'AEROLAYER DENIM', variantId: V.DENIM, sku: V.DENIM, quantity: 2, price: 44.97 },
        { title: 'TEE', variantId: V.TEE, sku: V.TEE, quantity: 1, price: 23.97 },
      ] },
      ...over,
    } });
    return id;
  };
  const dbOrder = (id: string) => (db.order || []).find(o => o.id === id)!;

  /** What the checkout page stores before navigating (app/checkout/page.tsx handlePaymentSuccess). */
  const seedCheckoutHandoff = (id: string, optimistic: Record<string, any> = {}) => {
    const order = {
      id, orderNumber: null, paymentMethod: 'RAZORPAY', isCod: false, codUpfrontPaid: 0, codBalanceDue: 0,
      totalPrice: 113.91, subtotalPrice: 113.91, discountCode: null, discountAmount: 0, storeCreditAmount: 0, currency: 'USD',
      createdAt: new Date().toISOString(), shippingAddress: JSON.stringify(usAddress),
      items: [
        { id: 'i1', title: 'AEROLAYER DENIM', quantity: 2, price: 44.97, sku: V.DENIM, variantId: V.DENIM, productId: '10227656982809' },
        { id: 'i2', title: 'TEE', quantity: 1, price: 23.97, sku: V.TEE, variantId: V.TEE, productId: '10227656982810' },
      ],
      customer: { id: null, name: usAddress.name, email: usAddress.email, phone: usAddress.phone }, customerId: null, customerPhone: usAddress.phone,
      registrationStatus: 'confirming', razorpayPaymentId: 'pay_X', ...optimistic,
    };
    sessionStorage.setItem(`zb_confirmation_${id}`, JSON.stringify(order));
    sessionStorage.setItem(`zb_complete_pending_${id}`, JSON.stringify({ body: { localOrderId: id, razorpay: { razorpay_order_id: 'order_X', razorpay_payment_id: 'pay_X' } }, paymentId: 'pay_X' }));
  };

  let root: any = null;
  const clearBrowser = () => {
    sessionStorage.clear(); localStorage.clear();
    for (const c of document.cookie.split(';')) { const name = c.split('=')[0].trim(); if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`; }
  };
  // React commits the updates made inside one act() scope when that scope ends, so
  // a chain like fetch → setState → effect → fetch → setState needs several scopes.
  const rounds = async (n = 6, ms = 30) => { for (let i = 0; i < n; i++) await act(async () => { await settle(ms); }); };
  const visit = async (id: string) => {
    if (root) { await act(async () => { root.unmount(); }); root = null; }
    snapCalls = []; fbqCalls = []; requests = [];
    mocks.state.params = { id };
    dom.reconfigure({ url: `https://zicabella.com/orders/${id}/confirmation` });
    document.getElementById('root')!.innerHTML = '';
    root = createRoot(document.getElementById('root')!);
    await act(async () => { root.render(React.createElement(Page)); });
    await rounds();
  };
  const snapPurchases = () => snapCalls.filter(c => c[0] === 'track' && c[1] === 'PURCHASE');
  const fbqPurchases = () => fbqCalls.filter(c => c[0] === 'track' && c[1] === 'Purchase');
  const lastSnapInit = () => [...snapCalls].reverse().find(c => c[0] === 'init');
  const called = (re: RegExp, method = 'GET') => requests.filter(r => r.method === method && re.test(r.url));
  const pageText = () => (document.body.textContent || '').replace(/\s+/g, ' ');

  // ══ 0. The confirmation API now carries the payment facts ══
  console.log('\n— 0. /api/orders/[id]/confirmation');
  const apiOrder = await mkOrder();
  const full: any = await (await g.fetch(`/api/orders/${apiOrder}/confirmation?bypass_auth=true`)).json();
  eq('full payload includes paymentStatus + orderType (it had neither)', [full.order.paymentStatus, full.order.orderType, full.order.totalPrice, full.order.currency], ['paid', 'WEB_STORE', 113.91, 'USD']);
  const trackingView: any = await (await g.fetch(`/api/orders/${apiOrder}/confirmation?bypass_auth=true&view=tracking`)).json();
  eq('tracking view = only the server facts the pixels need', [Object.keys(trackingView.order).sort(), trackingView.order.paymentStatus, trackingView.order.currency, trackingView.order.items.map((i: any) => [i.variantId, i.quantity, i.price])],
    [['currency', 'id', 'items', 'orderType', 'paymentStatus', 'totalPrice'], 'paid', 'USD', [[V.DENIM, 2, 44.97], [V.TEE, 1, 23.97]]]);
  check('tracking view exposes no customer details', !/john|415|Market Street|94105/i.test(JSON.stringify(trackingView)));
  const old = await mkOrder({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
  eq('same access rule as the full payload: an order older than 24 h needs a session', (await g.fetch(`/api/orders/${old}/confirmation?bypass_auth=true&view=tracking`)).status, 401);
  eq('unknown order → 404', (await g.fetch('/api/orders/does-not-exist/confirmation?bypass_auth=true&view=tracking')).status, 404);

  // ══ 1. Standard checkout: Razorpay success → confirmation page ══
  console.log('\n— 1. Standard checkout (USD order)');
  clearBrowser();
  const o1 = await mkOrder();
  // The optimistic copy deliberately disagrees with the stored order (as it does
  // when the shopper's currency resolved late): tracking must follow the server.
  seedCheckoutHandoff(o1, { totalPrice: 3797, subtotalPrice: 3797, currency: 'INR', items: [
    { id: 'i1', title: 'AEROLAYER DENIM', quantity: 2, price: 1499, sku: V.DENIM, variantId: V.DENIM, productId: '10227656982809' },
    { id: 'i2', title: 'TEE', quantity: 1, price: 799, sku: V.TEE, variantId: V.TEE, productId: '10227656982810' },
  ] });
  check('the optimistic checkout copy alone can never fire (no payment status) — the root cause',
    bp.decideSnapBrowserPurchase(JSON.parse(sessionStorage.getItem(`zb_confirmation_${o1}`)!), { alreadySent: false }).action === 'done');
  completeScript = [{ status: 200, body: { orderId: o1 } }];
  await visit(o1);
  eq('order registered once, then the server facts are read once', [called(/^\/api\/checkout\/complete$/, 'POST').length, called(/view=tracking/).length], [1, 1]);
  check('Snap pixel PURCHASE fires exactly once', snapPurchases().length === 1, snapCalls.filter(c => c[0] === 'track'));
  const p1 = snapPurchases()[0]?.[2] || {};
  eq('…with the STORED order value and currency (USD), not the optimistic copy', [p1.price, p1.currency], [113.91, 'USD']);
  eq('…deduplication ids = order id (same as the server event_id / order_id)', [p1.client_dedup_id, p1.transaction_id], [o1, o1]);
  eq('…catalog variant ids and unit count', [p1.item_ids, p1.number_items], [[V.DENIM, V.TEE], 3]);
  const init1 = lastSnapInit()?.[2] || {};
  eq('pixel identity for the US customer: e-mail, phone with +1, state code, 5-digit ZIP, country', [lastSnapInit()?.[1], init1.user_email, init1.user_phone_number, init1.geo_region, init1.geo_postal_code, init1.geo_country],
    [PIXEL, 'john.smith@example.com', '14155552671', 'ca', '94105', 'us']);
  check('the browser never sends a Purchase to the server relay (the server builds its own from the database)', !requests.some(r => r.url === '/api/snap/event' && r.body?.eventName === 'PURCHASE'));
  check('what the shopper sees is unchanged: still the copy painted by the checkout', /Order Confirmed!/.test(pageText()) && pageText().includes('₹3,797') && !pageText().includes('113.91'), pageText().slice(0, 300));
  const cached1 = JSON.parse(sessionStorage.getItem(`zb_confirmation_${o1}`) || '{}');
  eq('cached copy keeps the facts for a refresh; the pending hand-off is cleared', [cached1.registrationStatus, cached1.serverFacts?.paymentStatus, cached1.serverFacts?.currency, sessionStorage.getItem(`zb_complete_pending_${o1}`)], ['confirmed', 'paid', 'USD', null]);
  check('"sent" marker written after the pixel call', bp.hasSnapBrowserPurchaseBeenSent(o1));
  // Meta shares the same gate, so its browser Purchase works again too.
  const metaP = fbqPurchases();
  eq('Meta pixel Purchase fires once as well, same order id for deduplication, same stored value', [metaP.length, metaP[0]?.[2]?.value, metaP[0]?.[2]?.currency, metaP[0]?.[3]?.eventID], [1, 113.91, 'USD', o1]);

  await visit(o1);
  eq('refresh → no second Purchase (Snap or Meta)', [snapPurchases().length, fbqPurchases().length], [0, 0]);
  eq('…and no extra server request for an order already reported', called(/view=tracking/).length, 0);

  // ══ 2. The facts request fails: nothing breaks, and a refresh still reports ══
  console.log('\n— 2. Facts request fails once');
  clearBrowser();
  const o2 = await mkOrder();
  seedCheckoutHandoff(o2);
  completeScript = [{ status: 200, body: { orderId: o2 } }];
  factsDown = true;
  await visit(o2);
  check('page still confirms the order for the shopper', /Order Confirmed!/.test(pageText()) && JSON.parse(sessionStorage.getItem(`zb_confirmation_${o2}`)!).registrationStatus === 'confirmed');
  eq('no Purchase is guessed without the server\'s word', [snapPurchases().length, fbqPurchases().length], [0, 0]);
  factsDown = false;
  await visit(o2);
  eq('refresh: facts are fetched in the background and the Purchase fires once', [called(/view=tracking/).length, snapPurchases().length, snapPurchases()[0]?.[2]?.price, snapPurchases()[0]?.[2]?.currency], [1, 1, 113.91, 'USD']);

  // ══ 3. Refresh / shared link without any cached copy ══
  console.log('\n— 3. No cached copy');
  clearBrowser();
  const o3 = await mkOrder({ totalPrice: 71.2, subtotalPrice: 71.2, currency: 'GBP',
    shippingAddress: JSON.stringify({ name: 'Jane Doe', email: 'jane.doe@example.co.uk', phone: '07700 900123', city: 'London', state: 'Greater London', zip: 'SW1A 1AA', country: 'United Kingdom', countryCode: 'GB' }),
    items: { create: [{ title: 'AEROLAYER DENIM', variantId: V.DENIM, sku: V.DENIM, quantity: 2, price: 35.6 }] } });
  await visit(o3);
  const p3 = snapPurchases()[0]?.[2] || {};
  eq('GBP order → one PURCHASE with value 71.2 GBP', [snapPurchases().length, p3.price, p3.currency, p3.transaction_id, p3.item_ids, p3.number_items], [1, 71.2, 'GBP', o3, [V.DENIM], 2]);
  // The customer record still holds a US number written without a country code; the
  // number typed with this UK address is the one that can be read correctly.
  eq('UK identity: the phone typed with the UK address (+44), postcode sector, country gb — never the old US number read as British',
    [lastSnapInit()?.[2]?.user_phone_number, lastSnapInit()?.[2]?.geo_postal_code, lastSnapInit()?.[2]?.geo_country], ['447700900123', 'sw1a1', 'gb']);
  check('the page shows the stored GBP total', pageText().includes('£71.20'), pageText().slice(0, 300));

  // ══ 4. Payment not captured yet → waits, fires once it is ══
  console.log('\n— 4. Payment pending, then captured');
  clearBrowser();
  const o4 = await mkOrder({ paymentStatus: 'payment_pending', status: 'payment_pending', paymentCapturedAt: null });
  await visit(o4);
  await rounds(3, 60);
  eq('pending payment → no Purchase', [snapPurchases().length, fbqPurchases().length], [0, 0]);
  check('the page keeps checking, with the light tracking view only (never the heavy order endpoint)',
    called(/view=tracking/).length >= 2 && called(/^\/api\/orders\/[^/?]+\?/).length === 0, requests.map(r => r.url));
  dbOrder(o4).paymentStatus = 'paid'; dbOrder(o4).paymentCapturedAt = new Date();
  await rounds(4, 60);
  eq('captured → exactly one PURCHASE, stored value + currency', [snapPurchases().length, snapPurchases()[0]?.[2]?.price, snapPurchases()[0]?.[2]?.currency, snapPurchases()[0]?.[2]?.client_dedup_id], [1, 113.91, 'USD', o4]);
  eq('…and one Meta Purchase', fbqPurchases().length, 1);
  const pollsAfter = called(/view=tracking/).length;
  await rounds(3, 60);
  eq('…and the checking stops', [called(/view=tracking/).length, snapPurchases().length], [pollsAfter, 1]);

  // ══ 5. Things that must never fire ══
  console.log('\n— 5. Must not fire');
  for (const [label, over] of [
    ['failed payment', { paymentStatus: 'failed' }],
    ['refunded order', { paymentStatus: 'refunded' }],
    ['partially paid order', { paymentStatus: 'partially_paid' }],
  ] as const) {
    clearBrowser();
    const id = await mkOrder(over as any);
    await visit(id);
    eq(`${label} → no Purchase`, [snapPurchases().length, fbqPurchases().length], [0, 0]);
  }
  clearBrowser();
  const oApp = await mkOrder({ orderType: 'MOBILE_APP' });
  await visit(oApp);
  eq('native-app order opened on the website → never a website-pixel Purchase', [snapPurchases().length, fbqPurchases().length], [0, 0]);
  clearBrowser();
  const oOld = await mkOrder();
  seedCheckoutHandoff(oOld, { registrationStatus: 'confirmed', createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), serverFacts: { paymentStatus: 'paid', orderType: 'WEB_STORE', totalPrice: 113.91, currency: 'USD' } });
  sessionStorage.removeItem(`zb_complete_pending_${oOld}`);
  await visit(oOld);
  eq('a receipt revisited days later → no Purchase', [snapPurchases().length, fbqPurchases().length], [0, 0]);

  // ══ 6. Capture confirmed only on the second try ══
  console.log('\n— 6. Authorised first, captured a moment later');
  clearBrowser();
  const o6 = await mkOrder();
  seedCheckoutHandoff(o6);
  completeScript = [{ status: 202, body: { orderId: o6, paymentState: 'pending_capture' } }, { status: 200, body: { orderId: o6 } }];
  await visit(o6);
  eq('while the bank has only authorised: nothing fires', [snapPurchases().length, fbqPurchases().length], [0, 0]);
  await act(async () => { await settle(4300); }); // the page re-sends the completion after 4 s
  await rounds();
  eq('once the capture is confirmed: one PURCHASE', [called(/^\/api\/checkout\/complete$/, 'POST').length, snapPurchases().length, snapPurchases()[0]?.[2]?.currency], [2, 1, 'USD']);

  if (root) await act(async () => { root.unmount(); });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(err => { console.error(err); process.exit(1); });
