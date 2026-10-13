/**
 * Snap server-side Purchase delivery — resilience checks.
 *
 * Runs the REAL sender (lib/snap-capi.ts), ledger, purchase delivery, retry /
 * recovery job, health alerts, cron route, connection-test route and the second
 * Razorpay webhook endpoint against an in-memory database and a fake Snap /
 * Razorpay HTTP layer. Nothing leaves the machine.
 *
 *   ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PORT=1 \
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/snap-e2e/tsconfig.json scripts/verify-snap-delivery.ts
 *
 * Proves:
 *   1. the pixel id / access token are read from one place, cleaned, never leaked
 *   2. a missing token, a token Snap refuses, or validation-only mode never uses
 *      up a Purchase's retry attempts and never marks it delivered
 *   3. Purchases that ran out of attempts while the token was missing are sent
 *      once the token exists (if Snap still accepts their original time)
 *   4. real failures are retried with backoff and reported once when exhausted
 *   5. paid orders are recovered even behind any number of abandoned checkouts,
 *      including orders that have no ledger row at all
 *   6. the retry endpoint reports a broken setup (ok:false + alerts)
 */
import crypto from 'crypto';

const PIXEL = '7d2481be-4ccf-42b2-b9ea-958c6c7bbdcd';
const TOKEN = 'unit-test-token-AAA.BBB.CCC';
Object.assign(process.env, {
  NODE_ENV: 'test',
  NEXT_PUBLIC_SNAP_PIXEL_ID: PIXEL,
  SNAP_CAPI_ACCESS_TOKEN: TOKEN,
  NEXT_PUBLIC_SITE_URL: 'https://zicabella.com',
  RAZORPAY_WEBHOOK_SECRET: 'whsec_test',
  CRON_SECRET: 'cron_test_secret',
});

let passed = 0, failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });

// ── HTTP fakes ──
type SnapAnswer = { status: number; body: any } | 'throw';
let snapAnswer: (url: string) => SnapAnswer = () => ({ status: 200, body: { status: 'VALID' } });
const snapCalls: Array<{ url: string; event: any }> = [];
const capturedPayments = new Set<string>();
(globalThis as any).fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
  if (u.startsWith('https://tr.snapchat.com/')) {
    snapCalls.push({ url: u, event: JSON.parse(opt.body).data[0] });
    const a = snapAnswer(u);
    if (a === 'throw') throw new Error(`connect ETIMEDOUT while calling ${u}`);
    return json(a.status, a.body);
  }
  const pay = u.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\/([^/?]+)/);
  if (pay) {
    return capturedPayments.has(pay[1])
      ? json(200, { id: pay[1], status: 'captured', captured: true, amount: 379700, amount_refunded: 0 })
      : json(200, { id: pay[1], status: 'authorized', captured: false, amount: 379700, amount_refunded: 0 });
  }
  return json(200, {});
};
const OK = () => ({ status: 200, body: { status: 'VALID' } });
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const flush = async () => { for (let i = 0; i < 300; i++) await new Promise(r => setImmediate(r)); };
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { error, warn } = console; console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = error; console.warn = warn; }
};

async function main() {
  const { db, default: prisma } = await import('./payment-e2e/memory-prisma');
  const config = await import('../lib/snap/config');
  const capi = await import('../lib/snap-capi');
  const { createSnapPurchaseDelivery, isSnapRetryDue } = await import('../lib/snap/purchase');
  const { MAX_ATTEMPTS } = await import('../lib/snap/ledger');
  const health = await import('../lib/snap/health');

  await prisma.customer.create({ data: { id: 'cust_1', name: 'Jane Doe', email: 'jane.doe@example.com', phone: '+447700900123' } });
  const rowOf = (orderId: string, platform = 'snap') => (db.adConversionDelivery || []).find(r => r.orderId === orderId && r.platform === platform);
  const resetLedger = () => { db.adConversionDelivery = []; db.order = []; db.orderItem = []; snapCalls.length = 0; };
  let seq = 0;
  const mkOrder = async (over: Record<string, any> = {}) => {
    const id = over.id || `ord_${++seq}`;
    await prisma.order.create({ data: {
      id, orderType: 'WEB_STORE', paymentStatus: 'paid', totalPrice: 3797, currency: 'INR', customerId: 'cust_1',
      paymentMethod: 'razorpay', razorpayPaymentId: `pay_${id.replace(/[^A-Za-z0-9]/g, '')}`, tags: 'WebStoreOrder, Web',
      createdAt: new Date(Date.now() - 2 * MIN), paymentCapturedAt: new Date(Date.now() - MIN),
      shippingAddress: JSON.stringify({ city: 'London', state: 'Greater London', zip: 'SW1A 1AA', country: 'United Kingdom', countryCode: 'GB' }),
      items: { create: [{ variantId: '51813148262681', sku: '51813148262681', quantity: 2, price: 1499 }, { variantId: '51813148328217', quantity: 1, price: 799 }] },
      ...over,
    } });
    return id;
  };
  const capture = (orderId: string) => capturedPayments.add(`pay_${orderId.replace(/[^A-Za-z0-9]/g, '')}`);
  const verifyCapture = async (o: any) => !!o.razorpayPaymentId && capturedPayments.has(o.razorpayPaymentId);
  const delivery = createSnapPurchaseDelivery({ db: prisma, send: capi.sendSnapEvent, verifyCapture, configError: capi.snapCapiConfigError });
  const PAID = { paymentConfirmed: true };
  const ctx = { scClickId: 'click-1', scCookie1: 'scid-1', externalId: 'zb.ext-1', ipAddress: '81.2.69.142', userAgent: 'UA' };

  // ══ 1. Configuration: one source, cleaned, never leaked ══
  console.log('\n— 1. Configuration');
  eq('pixel id: explicit value wins', config.resolveSnapPixelId('AAAAAAAA-1111-2222-3333-444444444444', 'production'), 'aaaaaaaa-1111-2222-3333-444444444444');
  eq('pixel id: wrapping quotes / spaces removed', config.resolveSnapPixelId(` "${PIXEL}" `, 'production'), PIXEL);
  eq('pixel id: unset in a production build → the store pixel', config.resolveSnapPixelId('', 'production'), config.SNAP_PRODUCTION_PIXEL_ID);
  eq('pixel id: unset in development / test → Snap off (local work never feeds the live pixel)',
    [config.resolveSnapPixelId('', 'development'), config.resolveSnapPixelId('', 'test'), config.resolveSnapPixelId('   ', undefined)], ['', '', '']);
  eq('pixel id: "off" switches Snap off even in production', config.resolveSnapPixelId('off', 'production'), '');
  eq('pixel id: all-zero placeholder is not a pixel id', [config.resolveSnapPixelId('00000000-0000-0000-0000-000000000000', 'production'), config.resolveSnapPixelId('00000000-0000-0000-0000-000000000000', 'development')], [config.SNAP_PRODUCTION_PIXEL_ID, '']);
  check('pixel id: a typo is reported, not silently accepted', /not a valid pixel id/.test(config.snapPixelIdProblem('7d2481be-4ccf', 'production') || ''));
  eq('the built-in pixel id is the store pixel', config.SNAP_PRODUCTION_PIXEL_ID, PIXEL);

  eq('token: configured → no config error', capi.snapCapiConfigError(), null);
  process.env.SNAP_CAPI_ACCESS_TOKEN = `  "${TOKEN}"\n`;
  eq('token: wrapping quotes / trailing newline removed', capi.snapCapiToken(), TOKEN);
  process.env.SNAP_CAPI_ACCESS_TOKEN = 'abc def';
  check('token: a space inside is reported', /space or line break/.test(capi.snapCapiConfigError() || ''));
  delete process.env.SNAP_CAPI_ACCESS_TOKEN;
  check('token: missing → named in the error', /SNAP_CAPI_ACCESS_TOKEN is not set/.test(capi.snapCapiConfigError() || ''));
  process.env.SNAP_CAPI_ACCESS_TOKEN = TOKEN;

  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ aud: 'x', iss: 'y', nbf: 1760000000, sub: 'secret-subject' })}.c2lnbmF0dXJl`;
  const described = capi.describeSnapToken(jwt);
  eq('token description: shape + issue date only', described, { set: true, looksValid: true, issuedAt: new Date(1760000000 * 1000).toISOString(), exposed: false });
  check('token description never contains the token or its claims', !JSON.stringify(described).includes('secret-subject') && !JSON.stringify(described).includes(jwt.slice(0, 20)));
  eq('token description: not set', capi.describeSnapToken(''), { set: false, looksValid: false, issuedAt: null, exposed: false });
  check('a fresh token is not flagged as the exposed one', capi.isExposedSnapToken(TOKEN) === false && capi.isExposedSnapToken('') === false);

  for (const site of ['https://zicabella.com', 'https://www.zicabella.com/', 'https://app.zicabella.com', '', 'not a url']) {
    process.env.SNAP_CAPI_VALIDATE = '1'; process.env.NEXT_PUBLIC_SITE_URL = site;
    check(`validation-only mode is ignored on the live store (site "${site || 'unset'}")`, (await quiet(async () => capi.isSnapValidateMode())) === false);
  }
  process.env.NEXT_PUBLIC_SITE_URL = 'https://staging.example.com';
  check('validation-only mode works on a staging site', capi.isSnapValidateMode() === true);
  delete process.env.SNAP_CAPI_VALIDATE; process.env.NEXT_PUBLIC_SITE_URL = 'https://zicabella.com';

  // ══ 2. Sender ══
  console.log('\n— 2. Sender');
  const ev = (over: any = {}) => ({ eventName: 'PAGE_VIEW', eventId: `pv_${++seq}_abcdef`, eventTime: Date.now(), eventSourceUrl: 'https://zicabella.com/products/aerolayer', userAgent: 'UA', ...over });
  snapCalls.length = 0;
  let r: any = await capi.sendSnapEvent(ev());
  check('200 VALID → success, sent to /v3/<pixel>/events with the token url-encoded',
    r.success === true && snapCalls[0]?.url === `https://tr.snapchat.com/v3/${PIXEL}/events?access_token=${encodeURIComponent(TOKEN)}`, snapCalls[0]?.url?.replace(TOKEN, '<token>'));
  process.env.SNAP_CAPI_ACCESS_TOKEN = ` ${TOKEN}\n`;
  snapCalls.length = 0; await capi.sendSnapEvent(ev());
  check('a token pasted with spaces / newline is still sent clean', snapCalls[0]?.url.endsWith(`access_token=${encodeURIComponent(TOKEN)}`));
  process.env.SNAP_CAPI_ACCESS_TOKEN = TOKEN;

  delete process.env.SNAP_CAPI_ACCESS_TOKEN; snapCalls.length = 0;
  r = await quiet(() => capi.sendSnapEvent(ev()));
  check('token missing → blocked:"config", nothing sent', r.success === false && r.blocked === 'config' && /^snap_config_missing/.test(r.error) && snapCalls.length === 0, r);
  process.env.SNAP_CAPI_ACCESS_TOKEN = TOKEN;

  for (const status of [401, 403]) {
    snapAnswer = () => ({ status, body: { status: 'FAILED', reason: 'Unauthorized' } });
    r = await quiet(() => capi.sendSnapEvent(ev()));
    check(`HTTP ${status} → blocked:"auth" (setup problem, not the event's)`, r.success === false && r.blocked === 'auth' && /^snap_auth_rejected/.test(r.error), r);
    check(`HTTP ${status}: the token is not in the result`, !JSON.stringify(r).includes(TOKEN));
  }
  snapAnswer = () => ({ status: 400, body: { status: 'INVALID', reason: 'Invalid access token provided' } });
  r = await quiet(() => capi.sendSnapEvent(ev()));
  check('HTTP 400 whose message says the token is invalid → blocked:"auth"', r.blocked === 'auth', r);
  snapAnswer = () => ({ status: 400, body: { status: 'INVALID', reason: 'custom_data.currency is not supported' } });
  r = await quiet(() => capi.sendSnapEvent(ev()));
  check('HTTP 400 INVALID payload → ordinary failure (counts as an attempt)', r.success === false && !r.blocked && /^snap_rejected: HTTP 400 INVALID/.test(r.error), r);
  snapAnswer = () => ({ status: 200, body: { status: 'INVALID', reason: 'bad' } });
  r = await quiet(() => capi.sendSnapEvent(ev()));
  check('HTTP 200 with status INVALID is NOT a success', r.success === false && !r.blocked, r);
  snapAnswer = () => ({ status: 503, body: {} });
  r = await quiet(() => capi.sendSnapEvent(ev()));
  check('HTTP 503 → ordinary failure', r.success === false && !r.blocked, r);
  snapAnswer = () => 'throw';
  r = await quiet(() => capi.sendSnapEvent(ev()));
  check('network error → failure, and the token in the error text is redacted', r.success === false && !r.blocked && !String(r.error).includes(TOKEN) && /access_token=\[redacted\]/.test(String(r.error)), r);
  snapAnswer = OK;

  snapCalls.length = 0;
  r = await capi.sendSnapEvent(ev({ eventSourceUrl: 'https://zicabella.com/dashboard/orders' }));
  check('admin pages are never sent', r.skipped === true && snapCalls.length === 0);
  r = await capi.sendSnapEvent(ev({ eventSourceUrl: 'https://zicabella.com/products/admin-green-cargo' }));
  check('a product whose URL merely contains "/admin" IS sent (path prefix, not substring)', r.success === true && snapCalls.length === 1, r);

  process.env.SNAP_CAPI_VALIDATE = '1'; process.env.NEXT_PUBLIC_SITE_URL = 'https://staging.example.com';
  snapCalls.length = 0;
  const logSpy = console.log; console.log = () => {};
  r = await capi.sendSnapEvent(ev({ eventSourceUrl: 'https://staging.example.com/p' }));
  console.log = logSpy;
  check('staging validation-only: sent to /events/validate and flagged validateOnly', r.success === true && r.validateOnly === true && snapCalls[0]?.url.includes('/events/validate?'), r);
  delete process.env.SNAP_CAPI_VALIDATE; process.env.NEXT_PUBLIC_SITE_URL = 'https://zicabella.com';

  // ══ 3. A broken setup never burns a Purchase's attempts ══
  console.log('\n— 3. Token missing / refused / validation-only');
  resetLedger();
  const a1 = await mkOrder();
  await delivery.recordSnapPurchaseContext(a1, ctx);
  delete process.env.SNAP_CAPI_ACCESS_TOKEN;
  let out: any;
  for (let i = 0; i < 8; i++) out = await quiet(() => delivery.emitSnapPurchase(a1, undefined, PAID));
  check('token missing: emit reports failed + blocked:"config"', out.status === 'failed' && out.blocked === 'config', out);
  eq('token missing: 8 attempts later the row is still retryable with 0 attempts used', [rowOf(a1).status, rowOf(a1).attempts, snapCalls.length], ['failed', 0, 0]);
  check('token missing: the reason is stored (no secret)', /^snap_config_missing: SNAP_CAPI_ACCESS_TOKEN is not set/.test(rowOf(a1).lastError));
  const pinned = rowOf(a1).eventTime?.getTime();
  let tally: any = await quiet(() => delivery.retryPendingSnapPurchases(25));
  eq('token missing: the retry job does nothing and says why', [tally.blocked_config, snapCalls.length, rowOf(a1).attempts], [1, 0, 0]);
  process.env.SNAP_CAPI_ACCESS_TOKEN = TOKEN;
  tally = await delivery.retryPendingSnapPurchases(25);
  check('token added: the same Purchase is delivered on the next run', tally.retry_sent === 1 && rowOf(a1).status === 'sent' && snapCalls.length === 1, tally);
  eq('…with its ORIGINAL conversion time (never re-dated) and its click id', [snapCalls[0].event.event_time, snapCalls[0].event.user_data.sc_click_id], [pinned, 'click-1']);
  eq('…as the order: id, value, currency', [snapCalls[0].event.event_id, snapCalls[0].event.custom_data.value, snapCalls[0].event.custom_data.currency], [a1, 3797, 'INR']);

  resetLedger();
  const authOrders = [await mkOrder(), await mkOrder(), await mkOrder()];
  snapAnswer = () => ({ status: 401, body: { status: 'FAILED', reason: 'Unauthorized' } });
  for (const id of authOrders) await quiet(() => delivery.emitSnapPurchase(id, ctx, PAID));
  eq('token refused by Snap: rows stay retryable, no attempt used', authOrders.map(id => [rowOf(id).status, rowOf(id).attempts]), authOrders.map(() => ['failed', 0]));
  snapCalls.length = 0;
  tally = await quiet(() => delivery.retryPendingSnapPurchases(25));
  eq('token refused: the retry job stops after ONE request instead of hammering Snap', [snapCalls.length, tally.blocked_auth], [1, 1]);
  check('token refused: the health check raises snap_auth_rejected', health.snapDeliveryAlerts({ web: tally, app: {} }, { configError: null, exposedToken: false }).some(a => a.startsWith('snap_auth_rejected')));
  snapAnswer = OK; snapCalls.length = 0;
  tally = await delivery.retryPendingSnapPurchases(25);
  eq('token fixed: all three are delivered', [tally.retry_sent, authOrders.map(id => rowOf(id).status)], [3, ['sent', 'sent', 'sent']]);

  resetLedger();
  const v1 = await mkOrder();
  process.env.SNAP_CAPI_VALIDATE = '1'; process.env.NEXT_PUBLIC_SITE_URL = 'https://staging.example.com';
  console.log = () => {};
  out = await delivery.emitSnapPurchase(v1, ctx, PAID);
  console.log = logSpy;
  check('validation-only deploy: a Purchase is NEVER marked delivered', out.status === 'failed' && out.blocked === 'validate' && rowOf(v1).status === 'failed' && rowOf(v1).attempts === 0 && rowOf(v1).sentAt === null, { out, row: rowOf(v1) });
  delete process.env.SNAP_CAPI_VALIDATE; process.env.NEXT_PUBLIC_SITE_URL = 'https://zicabella.com';
  snapCalls.length = 0;
  await delivery.retryPendingSnapPurchases(25);
  check('…and the live deploy still sends it for real', rowOf(v1).status === 'sent' && snapCalls.length === 1 && !snapCalls[0].url.includes('/validate'));

  // ══ 4. Purchases stranded while the token was missing ══
  console.log('\n— 4. Purchases that ran out of attempts while the token was missing');
  resetLedger();
  const LEGACY = 'Snap Pixel ID or CAPI Access Token not configured'; // what the previous sender stored
  const l1 = await mkOrder({ createdAt: new Date(Date.now() - 2 * DAY), paymentCapturedAt: new Date(Date.now() - 2 * DAY) });
  const l1Time = new Date(Date.now() - 2 * DAY);
  await prisma.adConversionDelivery.create({ data: { platform: 'snap', eventName: 'PURCHASE', orderId: l1, eventId: l1, status: 'failed', attempts: MAX_ATTEMPTS, lastError: LEGACY, eventTime: l1Time, context: { scClickId: 'click-legacy' } } });
  const l2 = await mkOrder({ createdAt: new Date(Date.now() - 9 * DAY), paymentCapturedAt: new Date(Date.now() - 9 * DAY) });
  await prisma.adConversionDelivery.create({ data: { platform: 'snap', eventName: 'PURCHASE', orderId: l2, eventId: l2, status: 'failed', attempts: MAX_ATTEMPTS, lastError: LEGACY, eventTime: new Date(Date.now() - 9 * DAY) } });
  delete process.env.SNAP_CAPI_ACCESS_TOKEN;
  tally = await quiet(() => delivery.retryPendingSnapPurchases(25));
  eq('while the token is still missing nothing is closed or lost', [tally.blocked_config, rowOf(l1).status, rowOf(l1).attempts, rowOf(l2).status], [1, 'failed', MAX_ATTEMPTS, 'failed']);
  process.env.SNAP_CAPI_ACCESS_TOKEN = TOKEN;
  snapCalls.length = 0;
  tally = await quiet(() => delivery.retryPendingSnapPurchases(25));
  check('token added: the 2-day-old Purchase is re-queued and delivered', tally.requeued === 1 && tally.retry_sent === 1 && rowOf(l1).status === 'sent', tally);
  eq('…with its original event time and click id', [snapCalls[0]?.event.event_time, snapCalls[0]?.event.user_data.sc_click_id], [l1Time.getTime(), 'click-legacy']);
  check('the 9-day-old one is past Snap\'s 7-day limit: closed and REPORTED, never re-dated',
    rowOf(l2).status === 'skipped' && /^exhausted after 5 attempts/.test(rowOf(l2).lastError) && tally.exhausted === 1 && snapCalls.length === 1, { row: rowOf(l2), tally });
  const exhaustedAlerts = health.snapDeliveryAlerts({ web: tally, app: {} }, { configError: null, exposedToken: false });
  check('…as an attempts_exhausted alert', exhaustedAlerts.length === 1 && /^attempts_exhausted: 1 Purchase/.test(exhaustedAlerts[0]), exhaustedAlerts);
  tally = await delivery.retryPendingSnapPurchases(25);
  check('…once only (next run is healthy)', !tally.exhausted && health.snapDeliveryAlerts({ web: tally, app: {} }, { configError: null, exposedToken: false }).length === 0, tally);

  // Many Purchases waiting after an outage: the one closest to Snap's 7-day limit goes first.
  resetLedger();
  const waiting: Record<string, string> = {};
  for (const [name, days] of [['d2', 2], ['d6', 6.5], ['d4', 4]] as const) {
    const at = new Date(Date.now() - days * DAY);
    const id = await mkOrder({ createdAt: at, paymentCapturedAt: at });
    await prisma.adConversionDelivery.create({ data: { platform: 'snap', eventName: 'PURCHASE', orderId: id, eventId: id, status: 'failed', attempts: MAX_ATTEMPTS, lastError: LEGACY, eventTime: at } });
    waiting[name] = id;
  }
  tally = await delivery.retryPendingSnapPurchases(25, { budgetMs: 0 });
  eq('a run that is out of time starts no send (the next run continues)', [tally.time_budget_reached, snapCalls.length, tally.requeued], [1, 0, 3]);
  tally = await delivery.retryPendingSnapPurchases(1);
  eq('with room for one send, the oldest conversion (6.5 days) goes first', [snapCalls.length, snapCalls[0]?.event.event_id, rowOf(waiting.d6).status, rowOf(waiting.d4).status, rowOf(waiting.d2).status], [1, waiting.d6, 'sent', 'failed', 'failed']);
  await delivery.retryPendingSnapPurchases(1);
  eq('…then the 4-day-old one', [snapCalls[1]?.event.event_id, rowOf(waiting.d4).status], [waiting.d4, 'sent']);
  await delivery.retryPendingSnapPurchases(25);
  eq('…and the rest', rowOf(waiting.d2).status, 'sent');

  // ══ 5. Real failures: backoff, then closed + reported once ══
  console.log('\n— 5. Retry backoff');
  eq('retry schedule: at once, at once, 30 min, 2 h, 6 h',
    [0, 1, 2, 3, 4].map(n => [isSnapRetryDue({ attempts: n, updatedAt: new Date(Date.now() - 29 * MIN) }), isSnapRetryDue({ attempts: n, updatedAt: new Date(Date.now() - 119 * MIN) }), isSnapRetryDue({ attempts: n, updatedAt: new Date(Date.now() - 361 * MIN) })]),
    [[true, true, true], [true, true, true], [false, true, true], [false, false, true], [false, false, true]]);
  resetLedger();
  const f1 = await mkOrder();
  snapAnswer = () => ({ status: 500, body: { status: 'FAILED', reason: 'internal' } });
  await quiet(() => delivery.emitSnapPurchase(f1, ctx, PAID)); // attempt 1 (checkout)
  const firstTime = rowOf(f1).eventTime.getTime();
  await quiet(() => delivery.retryPendingSnapPurchases(25));  // attempt 2 (next cron run)
  eq('a failing Purchase: attempt 1 live, attempt 2 on the next run', rowOf(f1).attempts, 2);
  await quiet(() => delivery.retryPendingSnapPurchases(25));
  eq('…then it waits: no third attempt within 30 minutes', rowOf(f1).attempts, 2);
  rowOf(f1).updatedAt = new Date(Date.now() - 31 * MIN);
  await quiet(() => delivery.retryPendingSnapPurchases(25));
  eq('…third attempt after 30 minutes', rowOf(f1).attempts, 3);
  rowOf(f1).updatedAt = new Date(Date.now() - 121 * MIN);
  await quiet(() => delivery.retryPendingSnapPurchases(25));
  rowOf(f1).updatedAt = new Date(Date.now() - 361 * MIN);
  tally = await quiet(() => delivery.retryPendingSnapPurchases(25));
  check('after 5 real failures the row is closed and reported once', rowOf(f1).attempts === 5 && rowOf(f1).status === 'skipped' && tally.exhausted === 1 && /snap_rejected: HTTP 500/.test(rowOf(f1).lastError), { row: rowOf(f1), tally });
  check('every attempt carried the same event_id and event_time', snapCalls.filter(c => c.event.event_id === f1).length === 5 && snapCalls.every(c => c.event.event_id !== f1 || c.event.event_time === firstTime));
  snapAnswer = OK;
  tally = await delivery.retryPendingSnapPurchases(25);
  check('a closed row is not retried or reported again', !tally.exhausted && !tally.retry_sent && rowOf(f1).status === 'skipped', tally);

  // ══ 6. Recovery is not starved by abandoned checkouts ══
  console.log('\n— 6. Paid order behind abandoned checkouts');
  resetLedger();
  for (let i = 0; i < 60; i++) {
    const id = await mkOrder({ paymentStatus: 'pending', status: 'payment_pending', createdAt: new Date(Date.now() - 3 * DAY) });
    await delivery.recordSnapPurchaseContext(id, ctx);
    rowOf(id).createdAt = new Date(Date.now() - 3 * DAY + i * 1000);
  }
  const s1 = await mkOrder({ createdAt: new Date(Date.now() - 40 * MIN), paymentCapturedAt: new Date(Date.now() - 38 * MIN) });
  await delivery.emitSnapPurchase(s1, { ...ctx, scClickId: 'click-stranded' }, { paymentConfirmed: false }); // capture not confirmed at checkout
  rowOf(s1).createdAt = new Date(Date.now() - 40 * MIN);
  const olderPending = (db.adConversionDelivery || []).filter(x => x.status === 'pending' && x.createdAt < rowOf(s1).createdAt).length;
  check('setup: 60 abandoned checkouts are older than the paid order\'s pending row (the old job read only the oldest 25)', olderPending === 60, olderPending);
  tally = await delivery.retryPendingSnapPurchases(25);
  check('paid in the database but capture not verified → nothing sent, row stays pending', snapCalls.length === 0 && rowOf(s1).status === 'pending' && tally.pending_capture_unverified === 1, tally);
  capture(s1);
  tally = await delivery.retryPendingSnapPurchases(25);
  check('capture verified → recovered on the next run, however many abandoned checkouts exist', tally.recovered_sent === 1 && rowOf(s1).status === 'sent' && snapCalls.length === 1, tally);
  eq('…with the click id stored at checkout and the capture time as event time', [snapCalls[0].event.user_data.sc_click_id, snapCalls[0].event.event_time], ['click-stranded', (db.order || []).find(o => o.id === s1)!.paymentCapturedAt.getTime()]);
  eq('abandoned checkouts are untouched', (db.adConversionDelivery || []).filter(x => x.status === 'pending').length, 60);
  tally = await delivery.retryPendingSnapPurchases(25);
  check('next run → no resend', snapCalls.length === 1 && !tally.recovered_sent);

  // ══ 7. Paid order with NO ledger row + cutover + orders that can never be sent ══
  console.log('\n— 7. Paid orders with no ledger row');
  resetLedger();
  const before = await mkOrder({ createdAt: new Date(Date.now() - 3 * DAY), paymentCapturedAt: new Date(Date.now() - 3 * DAY) }); capture(before);
  const firstRowOrder = await mkOrder({ createdAt: new Date(Date.now() - 2 * DAY), paymentCapturedAt: new Date(Date.now() - 2 * DAY) });
  await delivery.emitSnapPurchase(firstRowOrder, ctx, PAID);
  rowOf(firstRowOrder).createdAt = new Date(Date.now() - 2 * DAY); // the ledger's first Snap row = cutover
  const m1 = await mkOrder({ createdAt: new Date(Date.now() - 50 * MIN), paymentCapturedAt: new Date(Date.now() - 49 * MIN) }); capture(m1);
  const fresh = await mkOrder({ createdAt: new Date(Date.now() - 5 * MIN) }); capture(fresh);
  const exchange = await mkOrder({ orderType: 'EXCHANGE', createdAt: new Date(Date.now() - 50 * MIN) }); capture(exchange);
  const appOrder = await mkOrder({ orderType: 'MOBILE_APP', createdAt: new Date(Date.now() - 50 * MIN) }); capture(appOrder);
  const refunded = await mkOrder({ paymentStatus: 'refunded', createdAt: new Date(Date.now() - 50 * MIN) }); capture(refunded);
  const placeholder = await mkOrder({ tags: 'WebStoreOrder, webhook-recovered', totalPrice: 99, createdAt: new Date(Date.now() - 50 * MIN),
    items: { create: [{ sku: 'WEBHOOK-RECOVERED-PLACEHOLDER', quantity: 1, price: 99 }] } }); capture(placeholder);
  snapCalls.length = 0;
  tally = await delivery.retryPendingSnapPurchases(25);
  check('website order paid 50 min ago with no row at all → delivered', rowOf(m1)?.status === 'sent' && snapCalls.filter(c => c.event.event_id === m1).length === 1 && tally.recovered_sent === 1, tally);
  check('an order from before the ledger existed is never re-sent (would double count)', !rowOf(before) && !snapCalls.some(c => c.event.event_id === before));
  check('a 5-minute-old order is left to the live paths', !rowOf(fresh));
  check('exchange / native-app / refunded orders are never recovered as website Purchases',
    !snapCalls.some(c => [exchange, appOrder, refunded].includes(c.event.event_id)) && !rowOf(exchange) && !rowOf(appOrder) && !rowOf(refunded));
  check('a webhook-recovered placeholder (unknown items) is not sent, but stays open', !snapCalls.some(c => c.event.event_id === placeholder) && rowOf(placeholder)?.status === 'pending' && tally.pending_unresolved_items === 1, rowOf(placeholder));
  // staff / checkout later fill in the real items
  const ph = (db.order || []).find(o => o.id === placeholder)!; ph.tags = 'WebStoreOrder, Web'; ph.totalPrice = 1499;
  (db.orderItem || []).filter(i => i.orderId === placeholder).forEach(i => { i.variantId = '51813148262681'; i.sku = '51813148262681'; i.price = 1499; });
  out = await delivery.emitSnapPurchase(placeholder, ctx, PAID);
  check('…so once its items are known it is still delivered (not locked out)', out.status === 'sent' && rowOf(placeholder).status === 'sent', out);

  resetLedger();
  const anchor = await mkOrder({ createdAt: new Date(Date.now() - 2 * DAY) });
  await delivery.emitSnapPurchase(anchor, ctx, PAID); rowOf(anchor).createdAt = new Date(Date.now() - 2 * DAY);
  const stuck: string[] = [];
  for (let i = 0; i < 10; i++) stuck.push(await mkOrder({ createdAt: new Date(Date.now() - DAY + i * 1000), razorpayPaymentId: null }));
  const good = await mkOrder({ createdAt: new Date(Date.now() - 30 * MIN) }); capture(good);
  snapCalls.length = 0;
  tally = await delivery.retryPendingSnapPurchases(2); // small budget: 8 orders examined per run
  check('run 1 (budget 8): only unverifiable older orders were looked at', snapCalls.length === 0 && tally.pending_capture_unverified === 8, tally);
  tally = await delivery.retryPendingSnapPurchases(2);
  check('run 2: checked orders went to the back of the queue, so the sendable one is reached', rowOf(good)?.status === 'sent' && snapCalls.length === 1, tally);
  check('unverifiable orders are never sent', stuck.every(id => rowOf(id)?.status === 'pending' || !rowOf(id)) && !snapCalls.some(c => stuck.includes(c.event.event_id)));

  // ══ 8. Health alerts ══
  console.log('\n— 8. Health alerts');
  const st = { configError: null, exposedToken: false };
  eq('healthy run → no alerts', health.snapDeliveryAlerts({ web: { retry_sent: 2, recovered_sent: 1, expired: 4 }, app: {} }, st), []);
  check('token missing → snap_config_missing', health.snapDeliveryAlerts({ web: { blocked_config: 1 }, app: {} }, { configError: 'SNAP_CAPI_ACCESS_TOKEN is not set on the server', exposedToken: false })[0].startsWith('snap_config_missing: SNAP_CAPI_ACCESS_TOKEN is not set'));
  check('the token from the Git history → snap_token_exposed', health.snapDeliveryAlerts({ web: {}, app: {} }, { configError: null, exposedToken: true })[0].startsWith('snap_token_exposed'));
  check('ledger problems are reported', health.snapDeliveryAlerts({ web: { ledger_table_missing: 1 }, app: { ledger_error: 1 } }, st).length === 2);
  check('app token refused is reported separately', health.snapDeliveryAlerts({ web: {}, app: { blocked_auth: 1 } }, st)[0].startsWith('snap_app_auth_rejected'));
  check('no alert text ever contains the token', !JSON.stringify(health.snapDeliveryAlerts({ web: { blocked_auth: 1, exhausted: 3 }, app: {} }, { configError: capi.snapCapiConfigError(), exposedToken: true })).includes(TOKEN));

  // ══ 9. Retry endpoint (real route, real bindings) ══
  console.log('\n— 9. /api/cron/snap-conversions');
  resetLedger();
  const cron = await import('../app/api/cron/snap-conversions/route');
  const purchaseServer = await import('../lib/snap/purchase-server');
  const { NextRequest } = await import('next/server');
  const callCron = async (qs = '') => (await cron.GET(new NextRequest(`https://app.zicabella.com/api/cron/snap-conversions${qs}`, { headers: { authorization: 'Bearer cron_test_secret' } }))).json();
  const c1 = await mkOrder({ createdAt: new Date(Date.now() - 40 * MIN), paymentCapturedAt: new Date(Date.now() - 39 * MIN) });
  await purchaseServer.emitSnapPurchase(c1, ctx, { paymentConfirmed: false });
  rowOf(c1).createdAt = new Date(Date.now() - 40 * MIN); capture(c1);
  snapCalls.length = 0;
  let body: any = await callCron();
  check('healthy run: ok:true, no alerts, the stranded Purchase recovered (real Razorpay capture check)', body.ok === true && body.result.alerts.length === 0 && body.result.web.recovered_sent === 1 && rowOf(c1).status === 'sent', body);
  check('no probe unless asked', body.result.probe === undefined && snapCalls.every(c => !c.url.includes('/validate')));
  snapCalls.length = 0;
  body = await callCron('?probe=1');
  check('?probe=1 checks pixel id + token against /events/validate (records nothing)', body.ok === true && body.result.probe?.state === 'ok' && snapCalls.length === 1 && snapCalls[0].url.includes(`/v3/${PIXEL}/events/validate?`) && snapCalls[0].event.event_name === 'PAGE_VIEW', body);
  snapAnswer = () => ({ status: 401, body: { status: 'FAILED', reason: 'Unauthorized' } });
  body = await quiet(() => callCron('?probe=1'));
  check('probe with a refused token → ok:false + snap_auth_rejected', body.ok === false && body.result.probe.state === 'auth_rejected' && body.result.alerts.some((a: string) => a.startsWith('snap_auth_rejected')), body);
  snapAnswer = OK;
  delete process.env.SNAP_CAPI_ACCESS_TOKEN;
  body = await quiet(() => callCron());
  check('token missing → HTTP 200 body with ok:false + snap_config_missing', body.ok === false && body.result.alerts.some((a: string) => a.startsWith('snap_config_missing')), body);
  process.env.SNAP_CAPI_ACCESS_TOKEN = TOKEN;
  check('the endpoint never returns the token', !JSON.stringify(body).includes(TOKEN));

  // ══ 10. Second Razorpay webhook endpoint also reports the Purchase ══
  console.log('\n— 10. /api/payments/webhook');
  resetLedger();
  await prisma.shop.create({ data: { id: 'shop_1', name: 'Zica Bella', domain: 'test-shop.myshopify.com' } });
  const payments = await import('../app/api/payments/webhook/route');
  const webhooks = await import('../app/api/webhooks/razorpay/route');
  const captured = (rzpOrderId: string, payId: string, over: any = {}) => JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: payId, order_id: rzpOrderId, amount: 379700, status: 'captured', captured: true, amount_refunded: 0, method: 'upi', notes: {}, ...over } } },
  });
  const post = async (handler: any, url: string, raw: string) => {
    const res = await quiet(() => handler.POST(new NextRequest(url, { method: 'POST', body: raw, headers: { 'x-razorpay-signature': crypto.createHmac('sha256', 'whsec_test').update(raw).digest('hex'), 'content-type': 'application/json' } })));
    await flush(); await new Promise(res2 => setTimeout(res2, 30)); await flush();
    return (res as any).status;
  };
  const pendingOrder = (over: any = {}) => mkOrder({ paymentStatus: 'pending', status: 'payment_pending', paymentCapturedAt: null, razorpayPaymentId: null,
    shopifyOrderId: '987654321', shopifySyncStatus: 'synced', ...over });
  const w1 = await pendingOrder({ razorpayOrderId: 'order_rzp_w1' });
  await delivery.recordSnapPurchaseContext(w1, { ...ctx, scClickId: 'click-webhook' }); // stored at Razorpay pre-create
  snapCalls.length = 0;
  const status1 = await post(payments, 'https://zicabella.com/api/payments/webhook', captured('order_rzp_w1', 'pay_w1'));
  const forW1 = () => snapCalls.filter(c => c.event.event_id === w1);
  check('captured on /api/payments/webhook → order paid and ONE Snap Purchase (shopper never returned to the site)',
    status1 === 200 && (db.order || []).find(o => o.id === w1)!.paymentStatus === 'paid' && forW1().length === 1, { status1, n: forW1().length });
  eq('…with the click id stored before payment, as a WEB event', [forW1()[0]?.event.user_data.sc_click_id, forW1()[0]?.event.action_source], ['click-webhook', 'WEB']);
  await post(webhooks, 'https://zicabella.com/api/webhooks/razorpay', captured('order_rzp_w1', 'pay_w1'));
  await post(payments, 'https://zicabella.com/api/payments/webhook', captured('order_rzp_w1', 'pay_w1'));
  eq('the same capture on both webhook endpoints (and repeated) → still one Purchase', forW1().length, 1);
  const w2 = await pendingOrder({ razorpayOrderId: 'order_rzp_w2' });
  await post(payments, 'https://zicabella.com/api/payments/webhook', captured('order_rzp_w2', 'pay_w2', { status: 'authorized', captured: false }));
  check('not a verified capture → not paid, no Purchase', (db.order || []).find(o => o.id === w2)!.paymentStatus === 'pending' && !snapCalls.some(c => c.event.event_id === w2));
  const w3 = await pendingOrder({ razorpayOrderId: 'order_rzp_w3', orderType: 'MOBILE_APP' });
  await post(payments, 'https://zicabella.com/api/payments/webhook', captured('order_rzp_w3', 'pay_w3'));
  check('a native-app order is never reported as a website Purchase', !snapCalls.some(c => c.event.event_id === w3 && c.event.action_source === 'WEB'));

  // ══ 11. /api/snap/connection-test ══
  console.log('\n— 11. /api/snap/connection-test');
  const connTest = await import('../app/api/snap/connection-test/route');
  const mocks = await import('./snap-e2e/mocks');
  const callTest = async (headers: Record<string, string> = {}) => connTest.GET(new NextRequest('https://app.zicabella.com/api/snap/connection-test', { headers }));
  mocks.state.session = null;
  check('no admin session and no cron secret → 401', (await quiet(() => callTest())).status === 401);
  mocks.state.session = { user: { id: 'u1', role: 'CUSTOMER' } };
  check('a logged-in customer → 403', (await quiet(() => callTest())).status === 403);
  process.env.SNAP_CAPI_ACCESS_TOKEN = jwt;
  mocks.state.session = { user: { id: 'admin1', role: 'SUPER_ADMIN' } };
  snapCalls.length = 0;
  let res = await callTest();
  let report: any = await res.json();
  const byName = (n: string) => report.checks.find((c: any) => c.name === n);
  check('admin → 200 with a pass / warn / fail check list', res.status === 200 && Array.isArray(report.checks) && report.checks.length >= 6, report);
  check('pixel id check names the id in use', byName('Pixel ID').status === 'pass' && byName('Pixel ID').message.includes(PIXEL), byName('Pixel ID'));
  check('token check: set + issue date, never the token', byName('Access token').status === 'pass' && byName('Access token').message.includes(new Date(1760000000 * 1000).toISOString().slice(0, 10)) && !JSON.stringify(report).includes(jwt) && !JSON.stringify(report).includes('secret-subject'), byName('Access token'));
  check('live connection check passed against /events/validate', byName('Snapchat connection').status === 'pass' && snapCalls.length === 1 && snapCalls[0].url.includes('/events/validate?'), byName('Snapchat connection'));
  check('7-day Purchase summary comes from the ledger', /Website: \d+ delivered/.test(byName('Server Purchases, last 7 days').message), byName('Server Purchases, last 7 days'));
  check('order currencies are listed and checked against Snap\'s list', byName('Order currencies, last 30 days').status === 'pass' && /INR \d+/.test(byName('Order currencies, last 30 days').message), byName('Order currencies, last 30 days'));
  await mkOrder({ currency: 'XYZ' });
  report = await (await callTest()).json();
  check('an order in a currency Snap does not list → warning', byName('Order currencies, last 30 days').status === 'warn' && /XYZ/.test(byName('Order currencies, last 30 days').message), byName('Order currencies, last 30 days'));
  delete process.env.SNAP_CAPI_ACCESS_TOKEN;
  snapCalls.length = 0;
  res = await quiet(() => callTest());
  report = await res.json();
  check('missing token → overall fail, named variable, connection not tested (no request to Snap)', res.status === 200 && report.overall === 'fail' && byName('Access token').status === 'fail'
    && /SNAP_CAPI_ACCESS_TOKEN is not set/.test(byName('Access token').message) && /Not tested/.test(byName('Snapchat connection').message) && snapCalls.length === 0, report);
  process.env.SNAP_CAPI_ACCESS_TOKEN = TOKEN;
  snapAnswer = () => ({ status: 401, body: { status: 'FAILED', reason: 'Unauthorized' } });
  report = await (await quiet(() => callTest())).json();
  check('a token Snapchat refuses → connection check fails with the fix to apply', report.overall === 'fail' && byName('Snapchat connection').status === 'fail' && /REFUSED/.test(byName('Snapchat connection').message), byName('Snapchat connection'));
  snapAnswer = OK;
  mocks.state.session = null;
  check('the cron secret does NOT open the diagnostics (admin session only)', (await quiet(() => callTest({ authorization: 'Bearer cron_test_secret' }))).status === 401);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(err => { console.error(err); process.exit(1); });
