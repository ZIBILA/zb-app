/**
 * Verifies the ledger-based Meta Purchase (lib/meta/purchase.ts), the shared
 * normalization in lib/metaCapi.ts, the placeholder-email guard and the
 * /api/meta/event guards — against the in-memory fake DB, with the Graph API
 * request captured instead of sent.
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-purchase.ts
 */
import crypto from 'crypto';

process.env.META_CAPI_ACCESS_TOKEN = 'EAA' + 'B'.repeat(180);
process.env.META_PIXEL_ID = '2049977412558608';
process.env.NEXT_PUBLIC_SITE_URL = 'https://zicabella.com';

// ── capture Graph API calls ──
const graphBodies: any[] = [];
let failNextGraph = 0;
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes('graph.facebook.com')) {
    const body = JSON.parse(init.body);
    if (failNextGraph > 0) {
      failNextGraph--;
      return new Response(JSON.stringify({ error: { message: 'temporary', code: 2 } }), { status: 500 });
    }
    graphBodies.push(body);
    return new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'T' }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); }
}

async function main() {
  const { store } = await import('./snap-test-support/fake-db');
  const { emitMetaPurchase, recordMetaPurchaseContext, retryFailedMetaPurchases } = await import('../lib/meta/purchase-server');
  const { isPlaceholderEmail, isPlaceholderEmailHash } = await import('../lib/tracking/placeholder-identity');

  const browserCtx = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
    ipAddress: '81.2.69.142',
    fbp: 'fb.1.1700000000000.123456789',
    fbc: 'fb.1.1700000000000.IwAR0abc',
    externalId: 'zb.11111111-2222-4333-8444-555555555555',
  };
  const mkOrder = (id: string, over: Record<string, any> = {}) => {
    const o = {
      id,
      orderType: 'WEB_STORE',
      paymentStatus: 'paid',
      totalPrice: 3797,
      currency: 'INR',
      customerId: 'cust_1',
      createdAt: new Date(),
      paymentCapturedAt: new Date(),
      customer: { email: 'guest_1700000000000@zicabella.com', phone: '', name: 'Placeholder' },
      shippingAddress: JSON.stringify({
        name: 'Oliver Smith', email: 'Oliver.Smith@Example.co.uk', phone: '07700 900123',
        city: 'London', state: 'Greater London', zip: 'SW1A 1AA', country: 'United Kingdom', countryCode: 'GB',
      }),
      items: [
        { quantity: 2, price: 1499, variantId: '51813148262681', sku: '51813148262681' },
        { quantity: 1, price: 799, variantId: null, sku: 'variant:51813148328217' },
        { quantity: 1, price: 0, variantId: null, sku: 'WEBHOOK-RECOVERED-PLACEHOLDER' },
      ],
      ...over,
    };
    store.orders.set(id, o);
    return o;
  };

  // 1. Three concurrent paths → exactly ONE Graph send, built from the stored order.
  mkOrder('ord_A');
  await recordMetaPurchaseContext('ord_A', browserCtx); // Razorpay pre-create
  const results = await Promise.all([
    emitMetaPurchase('ord_A', browserCtx, { paymentConfirmed: true }),   // checkout/complete
    emitMetaPurchase('ord_A', undefined, { paymentConfirmed: true }),    // webhook payment.captured
    emitMetaPurchase('ord_A', undefined, { paymentConfirmed: true }),    // webhook order.paid
    emitMetaPurchase('ord_A', browserCtx, { paymentConfirmed: true }),   // /api/meta/event
  ]);
  check('concurrent paths send exactly once', graphBodies.length === 1, results);
  const ev = graphBodies[0]?.data?.[0] || {};
  const ud = ev.user_data || {};
  const cd = ev.custom_data || {};
  check('event_id = order id', ev.event_id === 'ord_A', ev.event_id);
  check('value/currency from stored order', cd.value === 3797 && cd.currency === 'INR', cd);
  check('content_ids = proven variant ids only (placeholder sku dropped)',
    JSON.stringify(cd.content_ids) === JSON.stringify(['51813148262681', '51813148328217']), cd.content_ids);
  check('num_items = units', cd.num_items === 4, cd.num_items);
  check('real browser UA (no webhook UA)', ud.client_user_agent === browserCtx.userAgent, ud.client_user_agent);
  check('fbp/fbc/IP carried', ud.fbp === browserCtx.fbp && ud.fbc === browserCtx.fbc && ud.client_ip_address === '81.2.69.142', ud);
  check('em = checkout address email, not placeholder', JSON.stringify(ud.em) === JSON.stringify([sha('oliver.smith@example.co.uk')]), ud.em);
  check('UK phone normalized 447700900123 (no forced 91)', JSON.stringify(ud.ph) === JSON.stringify([sha('447700900123')]), ud.ph);
  check('country = gb', JSON.stringify(ud.country) === JSON.stringify([sha('gb')]), ud.country);
  check('UK zip = sector (sw1a1)', JSON.stringify(ud.zp) === JSON.stringify([sha('sw1a1')]), ud.zp);

  // 2. Webhook first, no request context → stored pre-create context is used.
  graphBodies.length = 0;
  mkOrder('ord_B');
  await recordMetaPurchaseContext('ord_B', browserCtx);
  await emitMetaPurchase('ord_B', undefined, { paymentConfirmed: true });
  const evB = graphBodies[0]?.data?.[0];
  check('webhook-first send uses recorded browser UA', evB?.user_data?.client_user_agent === browserCtx.userAgent, evB?.user_data);

  // 3. Unconfirmed / pending / partial payments never send.
  graphBodies.length = 0;
  mkOrder('ord_C', { paymentStatus: 'payment_pending' });
  const rC1 = await emitMetaPurchase('ord_C', browserCtx, { paymentConfirmed: false });
  const rC2 = await emitMetaPurchase('ord_C', undefined, { paymentConfirmed: true });
  mkOrder('ord_D', { paymentStatus: 'partially_paid' });
  const rD = await emitMetaPurchase('ord_D', undefined, { paymentConfirmed: true });
  check('pending / unconfirmed / partially_paid → no send', graphBodies.length === 0, { rC1, rC2, rD });
  store.orders.get('ord_C').paymentStatus = 'paid';
  await emitMetaPurchase('ord_C', undefined, { paymentConfirmed: true });
  check('same order sends once it is captured', graphBodies.length === 1 && graphBodies[0].data[0].user_data.client_user_agent === browserCtx.userAgent);

  // 4. COD with upfront captured counts.
  graphBodies.length = 0;
  mkOrder('ord_E', { paymentStatus: 'cod_upfront_paid' });
  await emitMetaPurchase('ord_E', browserCtx, { paymentConfirmed: true });
  check('cod_upfront_paid sends', graphBodies.length === 1);

  // 5. Only placeholder email available → no em at all.
  graphBodies.length = 0;
  mkOrder('ord_F', {
    customer: { email: 'guest@zicabella.com', phone: '+971501234567', name: 'Ali Khan' },
    shippingAddress: JSON.stringify({ name: 'Ali Khan', city: 'Dubai', country: 'United Arab Emirates', countryCode: 'AE' }),
  });
  await emitMetaPurchase('ord_F', browserCtx, { paymentConfirmed: true });
  const udF = graphBodies[0]?.data?.[0]?.user_data || {};
  check('placeholder-only email → em omitted', udF.em === undefined, udF.em);
  check('UAE phone 971501234567, country ae', JSON.stringify(udF.ph) === JSON.stringify([sha('971501234567')]) && JSON.stringify(udF.country) === JSON.stringify([sha('ae')]), udF);

  // 6. Failed Graph call → ledger "failed" → retry cron resends with the same event_id, once.
  graphBodies.length = 0;
  mkOrder('ord_G');
  failNextGraph = 1;
  const first = await emitMetaPurchase('ord_G', browserCtx, { paymentConfirmed: true });
  check('first attempt failed and recorded', first.status === 'failed', first);
  const tally = await retryFailedMetaPurchases(25);
  check('retry sends once with same event_id', graphBodies.length === 1 && graphBodies[0].data[0].event_id === 'ord_G', tally);
  const again = await retryFailedMetaPurchases(25);
  check('no further resend after success', graphBodies.length === 1, again);

  // 7. Placeholder detection: explicit patterns only.
  check('placeholder patterns detected',
    ['guest@zicabella.com', 'customer@zicabella.com', 'guest_1712345678901@zicabella.com', 'recovered_1712345678901@zicabella.com',
     'guest_1712345678901@zicabella.in', 'unresolved@zicabella.com', ' GUEST@ZICABELLA.COM '].every(isPlaceholderEmail));
  check('real addresses not blocked',
    !['rahul@zicabella.com', 'guest@gmail.com', 'guest_x@zicabella.com', 'support.guest@zicabella.com'].some(isPlaceholderEmail));
  check('placeholder hash detected', isPlaceholderEmailHash(sha('guest@zicabella.com')) && !isPlaceholderEmailHash(sha('rahul@zicabella.com')));

  // 8. /api/meta/event guards + Purchase delegated to the ledger.
  graphBodies.length = 0;
  const { POST } = await import('../app/api/meta/event/route');
  const { NextRequest } = await import('next/server');
  const post = (body: any, ip = '81.2.69.142') => POST(new NextRequest('https://zicabella.com/api/meta/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': browserCtx.userAgent, 'x-forwarded-for': ip, cookie: `_fbp=${browserCtx.fbp}` },
    body: JSON.stringify(body),
  }) as any);
  const base = { eventId: 'evt-1', eventSourceUrl: 'https://zicabella.com/products/x', userAgent: browserCtx.userAgent, eventTime: Math.floor(Date.now() / 1000) };

  const bad1 = await post({ ...base, eventName: 'FakeEvent' });
  const bad2 = await post({ ...base, eventName: 'ViewContent', eventSourceUrl: 'https://evil.example/x' });
  check('unknown event / foreign source URL rejected', bad1.status === 400 && bad2.status === 400, [bad1.status, bad2.status]);

  mkOrder('ord_H');
  const fakeValue = await post({ ...base, eventName: 'Purchase', eventId: 'ord_H', customData: { value: 1, currency: 'INR' } });
  const evH = graphBodies[0]?.data?.[0];
  check('browser Purchase relay → server value from stored order (not browser value)',
    fakeValue.status === 200 && graphBodies.length === 1 && evH?.custom_data?.value === 3797, evH?.custom_data);
  await post({ ...base, eventName: 'Purchase', eventId: 'ord_H' });
  check('repeated Purchase relay does not resend', graphBodies.length === 1);
  await post({ ...base, eventName: 'Purchase', eventId: 'ord_does_not_exist', customData: { value: 99999 } });
  check('Purchase for unknown order sends nothing', graphBodies.length === 1);

  let limited = 0;
  for (let i = 0; i < 130; i++) {
    const r = await post({ ...base, eventName: 'PageView', eventId: `pv.${i}` }, '203.0.113.9');
    if (r.status === 429) limited++;
  }
  check('per-IP rate limit kicks in', limited > 0, limited);

  // 9. Only WEBSITE orders are website Purchases; recovery placeholders are not sales.
  graphBodies.length = 0;
  mkOrder('ord_APP', { orderType: 'MOBILE_APP' });
  mkOrder('ord_IOS', { orderType: 'APP' });
  mkOrder('ord_EXC', { orderType: 'EXCHANGE' });
  mkOrder('ord_REG', { orderType: 'REGULAR' });
  mkOrder('ord_REC', { tags: 'WebStoreOrder, webhook-recovered, RazorpayRecovery', items: [{ quantity: 1, price: 99, variantId: null, sku: 'WEBHOOK-RECOVERED-PLACEHOLDER' }] });
  const skips = await Promise.all(['ord_APP', 'ord_IOS', 'ord_EXC', 'ord_REG', 'ord_REC'].map(id => emitMetaPurchase(id, browserCtx, { paymentConfirmed: true })));
  check('native app / exchange / Shopify-synced / unresolved recovery orders → no website Purchase',
    graphBodies.length === 0 && skips.every(r => r.status === 'skipped'), skips);

  // 10. Ledger table not migrated yet → still sends (once per call), never silently drops.
  graphBodies.length = 0;
  const { createMetaPurchaseDelivery } = await import('../lib/meta/purchase');
  const { sendCapiEvent } = await import('../lib/metaCapi');
  const missing = () => { const e: any = new Error('The table `public.ad_conversion_deliveries` does not exist in the current database.'); e.code = 'P2021'; throw e; };
  const noLedgerDb = new Proxy({} as any, {
    get: (_t, model: string) => model === 'adConversionDelivery'
      ? { findUnique: async () => missing(), create: async () => missing(), update: async () => missing(), updateMany: async () => missing(), findMany: async () => missing() }
      : (store as any).__fallback ?? (model === 'order' ? { findUnique: async ({ where }: any) => ({ ...store.orders.get(where.id) }) } : {}),
  });
  mkOrder('ord_NOLEDGER');
  const noLedger = createMetaPurchaseDelivery({ db: noLedgerDb, send: sendCapiEvent });
  const nl = await noLedger.emitMetaPurchase('ord_NOLEDGER', browserCtx, { paymentConfirmed: true });
  check('missing ledger table → Purchase still sent directly', nl.status === 'sent' && graphBodies.length === 1 && graphBodies[0].data[0].event_id === 'ord_NOLEDGER', nl);

  // 11. Worldwide normalization matrix: every supported country (lib/countries).
  const { COUNTRIES } = await import('../lib/countries');
  const { normalizeCountry, normalizePhone } = await import('../lib/tracking/identity-normalize');
  const examples = (await import('libphonenumber-js/mobile/examples')).default as Record<string, string>;
  const { getExampleNumber } = await import('libphonenumber-js/min');
  const badCountry = COUNTRIES.filter(c => normalizeCountry(c.name) !== c.code.toLowerCase() || normalizeCountry(c.code) !== c.code.toLowerCase());
  check(`country name/code → ISO alpha-2 for all ${COUNTRIES.length} supported countries`, badCountry.length === 0, badCountry.map(c => c.name));
  const phoneRows: string[] = [];
  const badPhone: any[] = [];
  let phoneTested = 0;
  for (const c of COUNTRIES) {
    const ex = getExampleNumber(c.code as any, examples as any);
    if (!ex) continue;
    phoneTested++;
    const e164 = ex.number.replace(/^\+/, '');
    const national = ex.formatNational();
    const fromNational = normalizePhone(national, c.code);
    const fromPlus = normalizePhone(ex.formatInternational(), '');
    if (fromNational !== e164 || fromPlus !== e164) badPhone.push({ country: c.code, national, expected: e164, fromNational, fromPlus });
    if (['IN', 'AE', 'SG', 'GB', 'US', 'CA', 'AU', 'DE', 'SA', 'QA'].includes(c.code)) phoneRows.push(`${c.code}: "${national}" → ${fromNational}`);
  }
  check(`phone: national format + customer country → E.164 for ${phoneTested} countries`, badPhone.length === 0, badPhone.slice(0, 10));
  console.log('      sample:', phoneRows.join(' | '));

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
