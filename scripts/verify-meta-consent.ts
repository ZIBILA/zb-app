/**
 * Consent regions + Limited Data Use (lib/meta/consent.ts, consent-client.ts,
 * the inline-snippet rule in app/layout.tsx, the /api/meta/event backstop and the
 * Purchase click context). Everything must be a no-op with no regions configured.
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-consent.ts
 */
process.env.META_CAPI_ACCESS_TOKEN = 'EAA' + 'B'.repeat(180);
process.env.META_PIXEL_ID = '2049977412558608';
process.env.NEXT_PUBLIC_META_PIXEL_ID = '2049977412558608';
process.env.NEXT_PUBLIC_SITE_URL = 'https://zicabella.com';
process.env.NEXT_PUBLIC_META_CONSENT_REGIONS = 'EEA, UK';
process.env.NEXT_PUBLIC_META_LDU = '1';
(process.env as any).NODE_ENV = 'production';

let cookieJar = '';
const graphBodies: any[] = [];
const fbqCalls: any[] = [];
(globalThis as any).window = globalThis;
(globalThis as any).fbq = (...a: any[]) => fbqCalls.push(a);
(globalThis as any).navigator = { userAgent: 'UA-test' };
(globalThis as any).location = { href: 'https://zicabella.com/', hostname: 'zicabella.com', search: '', protocol: 'https:' };
(globalThis as any).document = { get cookie() { return cookieJar; }, set cookie(v: string) { const [kv] = v.split(';'); const [k, val] = kv.split('='); const rest = cookieJar.split('; ').filter(c => c && !c.startsWith(k + '=')); if (val) rest.push(`${k}=${val}`); cookieJar = rest.join('; '); }, title: 't' };
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const u = String(url);
  if (u.includes('graph.facebook.com')) { graphBodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ events_received: 1 }), { status: 200 }); }
  if (u === '/api/geo') return new Response(JSON.stringify({ ok: true, countryCode: (globalThis as any).__geoCC }), { status: 200 });
  if (u === '/api/meta/event') { (globalThis as any).__relayed.push(JSON.parse(init.body)); return new Response('{"success":true}'); }
  return new Response('{}');
};
(globalThis as any).__relayed = [];
(globalThis as any).localStorage = (globalThis as any).sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); }
}
const tick = () => new Promise(r => setTimeout(r, 10));

async function main() {
  const { parseConsentRegions, consentState, ldUFields, inConsentRegion } = await import('../lib/meta/consent');

  // ── rules ──
  const r = parseConsentRegions('EEA, UK, ch');
  check('regions: EEA expands to the 30 EEA countries, UK → GB, lowercase accepted', r.has('FR') && r.has('NO') && r.has('GB') && r.has('CH') && r.size === 32, r.size);
  check('regions: unset → empty (gating off)', parseConsentRegions(undefined).size === 0 && parseConsentRegions('').size === 0);
  const none = new Set<string>();
  check('state: no regions → not gated, even for a GB visitor', consentState({ regions: none, countryCode: 'GB' }).gated === false);
  check('state: choice granted wins', JSON.stringify(consentState({ regions: r, choice: 'granted', countryCode: 'GB' })) === '{"gated":true,"status":"granted"}');
  check('state: choice denied wins', JSON.stringify(consentState({ regions: r, choice: 'denied', countryCode: 'IN' })) === '{"gated":true,"status":"denied"}');
  check('state: IN visitor, no choice → not gated', consentState({ regions: r, countryCode: 'IN' }).gated === false);
  check('state: FR visitor, no choice → pending', JSON.stringify(consentState({ regions: r, countryCode: 'FR' })) === '{"gated":true,"status":"pending"}');
  check('state: unknown country → pending (hold, never assume)', JSON.stringify(consentState({ regions: r, countryCode: null })) === '{"gated":true,"status":"pending"}');
  check('prompt only inside a region', inConsentRegion(r, 'DE') && !inConsentRegion(r, 'US') && !inConsentRegion(r, null));
  check('LDU fields when enabled', JSON.stringify(ldUFields('1')) === '{"data_processing_options":["LDU"],"data_processing_options_country":0,"data_processing_options_state":0}');
  check('LDU fields off', JSON.stringify(ldUFields('')) === '{}' && JSON.stringify(ldUFields('0')) === '{}');

  // ── browser runtime: relay queued → flushed on grant / dropped on deny; auto-release outside regions ──
  const client = await import('../lib/meta/consent-client');
  const relayed: any[] = (globalThis as any).__relayed;
  const sends: string[] = [];
  cookieJar = '';
  (globalThis as any).__geoCC = 'DE';
  client.whenMetaConsentAllows(() => sends.push('a'));
  check('runtime: pending (unknown country) → relay queued, not sent', sends.length === 0);
  await client.resolveMetaConsentCountry();
  check('runtime: DE resolved → still held, prompt needed, zb_geo_cc cached', sends.length === 0 && client.metaConsentPromptNeeded() && /zb_geo_cc=DE/.test(cookieJar), cookieJar);
  client.grantMetaConsent();
  check('runtime: grant → queued relay flushed, fbq consent grant, cookie granted', sends.join() === 'a' && fbqCalls.some(c => c[0] === 'consent' && c[1] === 'grant') && /zb_consent=granted/.test(cookieJar));
  client.whenMetaConsentAllows(() => sends.push('b'));
  check('runtime: after grant, relays run immediately', sends.join() === 'a,b');
  client.denyMetaConsent();
  client.whenMetaConsentAllows(() => sends.push('c'));
  check('runtime: deny → relays dropped, fbq consent revoke', sends.join() === 'a,b' && fbqCalls.some(c => c[0] === 'consent' && c[1] === 'revoke'));

  // ── the hook's relay honours the hold ──
  cookieJar = 'zb_geo_cc=FR';
  const { useMetaEvents } = await import('../hooks/useMetaEvents');
  useMetaEvents().trackAddToCart('51813148262681', 'DENIM', 1499, 'INR', 'Denim', { ga: false });
  await tick();
  check('hook: FR visitor without a choice → AddToCart relay held', relayed.length === 0);
  client.grantMetaConsent();
  await tick();
  check('hook: grant → the held AddToCart relay is sent', relayed.length === 1 && relayed[0].eventName === 'AddToCart', relayed);

  // ── server backstop through the real route handler ──
  const MetaRoute = await import('../app/api/meta/event/route');
  const { NextRequest } = await import('next/server');
  const post = async (cookie: string) => {
    const req = new NextRequest('https://zicabella.com/api/meta/event', {
      method: 'POST', body: JSON.stringify({ eventName: 'ViewContent', eventId: 'vc-1', eventSourceUrl: 'https://zicabella.com/products/x', userAgent: 'UA', customData: { value: 10, currency: 'INR' } }),
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '81.2.69.142', origin: 'https://zicabella.com', 'user-agent': 'UA' },
    });
    const res = await MetaRoute.POST(req);
    return res.json();
  };
  graphBodies.length = 0;
  check('route: denied → skipped, nothing sent', (await post('zb_consent=denied')).reason === 'consent_denied' && graphBodies.length === 0);
  check('route: GB visitor, no choice → consent_pending', (await post('zb_geo_cc=GB')).reason === 'consent_pending' && graphBodies.length === 0);
  const ok = await post('zb_geo_cc=IN');
  check('route: IN visitor → sent', ok.success === true && !ok.skipped && graphBodies.length === 1, ok);
  const granted = await post('zb_geo_cc=GB; zb_consent=granted');
  check('route: GB visitor who accepted → sent', granted.success === true && !granted.skipped && graphBodies.length === 2, granted);
  check('route: LDU fields on the CAPI event', JSON.stringify(graphBodies[0].data[0].data_processing_options) === '["LDU"]' && graphBodies[0].data[0].data_processing_options_country === 0, graphBodies[0].data[0]);

  // ── Purchase: a shopper who declined at checkout is never reported ──
  const { metaContextFromRequest } = await import('../lib/meta/purchase');
  const ctx = metaContextFromRequest(new Request('https://zicabella.com/api/checkout/complete', { headers: { cookie: 'zb_consent=denied; _fbp=fb.1.1700000000000.1', 'user-agent': 'UA' } }));
  check('purchase context carries consent=denied from the cookie', ctx.consent === 'denied' && ctx.fbp === 'fb.1.1700000000000.1', ctx);
  const { store } = await import('./snap-test-support/fake-db');
  const { emitMetaPurchase } = await import('../lib/meta/purchase-server');
  store.orders.set('ord_c', { id: 'ord_c', orderType: 'WEB_STORE', paymentStatus: 'paid', totalPrice: 100, currency: 'GBP', customerId: 'c1', createdAt: new Date(), paymentCapturedAt: new Date(), customer: { email: 'a@b.co', phone: '+447700900123', name: 'A B' }, shippingAddress: JSON.stringify({ email: 'a@b.co', phone: '07700 900123', country: 'GB' }), items: [{ quantity: 1, price: 100, variantId: '51813148262681' }] });
  graphBodies.length = 0;
  const denied = await emitMetaPurchase('ord_c', ctx, { paymentConfirmed: true });
  check('purchase: consent denied → skipped, no Graph call, row closed', denied.status === 'skipped' && /consent denied/.test(denied.reason) && graphBodies.length === 0, denied);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
