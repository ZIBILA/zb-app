/**
 * Meta match-quality guarantees (2026-10-09):
 *  - The browser Advanced Matching values and the server CAPI user_data for the
 *    same shopper hash to IDENTICAL values (IN / UK / US / AE): one identity per
 *    deduplicated event pair.
 *  - No fabricated location ever reaches Meta (dev geo fallback / IP city+zip).
 *  - Placeholder postcodes, ASCII-stripped names and foreign-cookie identity are
 *    never sent; a logged-in customer keeps one stable external_id.
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-match-quality.ts
 */
import crypto from 'crypto';
process.env.META_CAPI_ACCESS_TOKEN = 'EAA' + 'B'.repeat(180);
process.env.META_PIXEL_ID = '2049977412558608';
(process.env as any).NODE_ENV = 'production';

const graph: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes('graph.facebook.com')) { graph.push(JSON.parse(init.body)); return new Response(JSON.stringify({ events_received: 1 }), { status: 200 }); }
  return new Response('{}', { status: 500 }); // every geo provider fails
};
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); }
};

(async () => {
  // Browser-side modules need a window; the server-side ones must not see it.
  const { sendCapiEvent } = await import('../lib/metaCapi');
  const { lookupIpGeo } = await import('../lib/ip-geo');
  const { normalizeZip, normalizeName, normalizeCity } = await import('../lib/tracking/identity-normalize');
  (globalThis as any).window = globalThis; (globalThis as any).document = { cookie: '' }; (globalThis as any).navigator = { userAgent: 'UA' };
  (globalThis as any).fbq = () => {};
  const { normalizeAdvancedMatching } = await import('../lib/metaPixel');

  // 1. Browser AM == server CAPI identity, per market (raw checkout address → both sides)
  const cases = [
    { label: 'IN', raw: { em: 'Riya.Kapoor@Example.com', ph: '98111 22233', fn: 'Riya', ln: 'Kapoor', ct: 'Noida', st: 'Uttar Pradesh', zp: '201304', country: 'IN' },
      want: { em: 'riya.kapoor@example.com', ph: '919811122233', fn: 'riya', ln: 'kapoor', ct: 'noida', st: 'uttarpradesh', zp: '201304', country: 'in' } },
    { label: 'UK', raw: { em: 'jane.doe@example.co.uk', ph: '07700 900123', fn: 'Jane', ln: 'Doe', ct: 'London', st: 'Greater London', zp: 'SW1A 1AA', country: 'United Kingdom' },
      want: { em: 'jane.doe@example.co.uk', ph: '447700900123', fn: 'jane', ln: 'doe', ct: 'london', st: 'greaterlondon', zp: 'sw1a1', country: 'gb' } },
    { label: 'US', raw: { em: 'john@example.com', ph: '(415) 555-2671', fn: 'John', ln: 'Smith', ct: 'San Francisco', st: 'California', zp: '94105-1234', country: 'United States' },
      want: { em: 'john@example.com', ph: '14155552671', fn: 'john', ln: 'smith', ct: 'sanfrancisco', st: 'ca', zp: '94105', country: 'us' } },
    { label: 'AE', raw: { em: 'aisha@example.ae', ph: '050 123 4567', fn: 'Aisha', ln: 'Khan', ct: 'Dubai', st: 'Dubai', zp: '00000', country: 'AE' },
      want: { em: 'aisha@example.ae', ph: '971501234567', fn: 'aisha', ln: 'khan', ct: 'dubai', st: 'dubai', zp: undefined, country: 'ae' } },
  ];
  for (const c of cases) {
    const am = normalizeAdvancedMatching(c.raw);
    graph.length = 0;
    await sendCapiEvent({ eventName: 'InitiateCheckout', eventId: `ic-${c.label}`, eventTime: Math.floor(Date.now() / 1000), eventSourceUrl: 'https://zicabella.com/checkout', userAgent: 'UA', actionSource: 'website', userData: { ...c.raw } } as any);
    const ud = graph[0].data[0].user_data;
    const keys = ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country'] as const;
    const amOk = keys.every(k => am[k] === c.want[k]);
    const srvOk = keys.every(k => (c.want[k] === undefined ? ud[k] === undefined : ud[k]?.[0] === sha(c.want[k]!)));
    const same = keys.every(k => (am[k] === undefined ? ud[k] === undefined : ud[k]?.[0] === sha(am[k])));
    check(`${c.label}: browser AM normalized to Meta spec`, amOk, am);
    check(`${c.label}: server CAPI hashes the same values`, srvOk, ud);
    check(`${c.label}: browser and server identity identical`, same);
  }

  // 2. Unicode names: kept (not stripped to '' / 'jos') and identical both sides
  check('unicode names kept and identical (José → josé, 村上 kept)', normalizeName('José') === 'josé' && normalizeName('村上') === '村上' && normalizeAdvancedMatching({ fn: 'José', ln: '村上' }).fn === 'josé');
  check('name / city that normalizes to nothing is omitted (never sha256(""))', !('fn' in normalizeAdvancedMatching({ fn: '  ' })) && normalizeCity('--') === '');

  // 3. Placeholder postcodes never hashed
  check('placeholder zips dropped (00000 / 0 / NA / none)', ['00000', '0', 'NA', 'none'].every(z => normalizeZip(z, 'AE') === '') && normalizeZip('110001', 'IN') === '110001');

  // 4. No fabricated location in production
  const g1 = await lookupIpGeo('10.0.0.5');
  const g2 = await lookupIpGeo('203.0.113.9'); // all providers fail (fetch → 500)
  check('production: private IP → unknown location (no Mumbai fallback)', g1 === null, g1);
  check('production: all geo providers down → unknown location (no Mumbai fallback)', g2 === null, g2);

  // 5. Relay route: bound vs foreign cookies, stable external_id
  const { POST } = await import('../app/api/meta/event/route');
  const { NextRequest } = await import('next/server');
  const post = (cookie: string, body: any) => POST(new NextRequest('https://zicabella.com/api/meta/event', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'UA', 'x-forwarded-for': '81.2.69.142', cookie }, body: JSON.stringify(body) }) as any);
  const base = { eventName: 'ViewContent', eventId: 'vc-1', eventSourceUrl: 'https://zicabella.com/products/x', userAgent: 'UA', eventTime: Math.floor(Date.now() / 1000) };
  const pii = `zb_guest_email=${sha('riya.kapoor@example.com')}; zb_guest_phone=${sha('919811122233')}; zb_guest_fn=${sha('riya')}; zb_guest_ct=${sha('noida')}; zb_guest_country=${sha('in')}`;
  graph.length = 0;
  await post(`zb_external_id=zb.A; zb_pii_owner=zb.A; ${pii}`, base);
  let ud = graph[0]?.data?.[0]?.user_data || {};
  check('guest ViewContent with OWN bound cookies → em/ph/fn sent on the server copy too', ud.em?.[0] === sha('riya.kapoor@example.com') && ud.ph?.[0] === sha('919811122233') && ud.fn?.[0] === sha('riya'), ud);
  graph.length = 0;
  await post(`zb_external_id=zb.B; zb_pii_owner=zb.A; ${pii}`, { ...base, eventId: 'vc-2' });
  ud = graph[0]?.data?.[0]?.user_data || {};
  check('another visitor on the device (foreign cookies) → no em/ph/fn/ct/country from those cookies', !ud.em && !ud.ph && !ud.fn && !ud.ct && !ud.country, ud);
  graph.length = 0;
  await post(`zb_external_id=zb.C; zb_pii_owner=zb.C; zb_guest_zp=${sha('00000')}`, { ...base, eventId: 'vc-3' });
  ud = graph[0]?.data?.[0]?.user_data || {};
  check('no fabricated ct/st/zp when nothing is known (geo providers down)', !ud.ct && !ud.st && !ud.zp, ud);
  graph.length = 0;
  await post(`zb_external_id=zb.D`, { ...base, eventId: 'vc-4', userData: { fn: 'Valued', ln: 'Customer', ph: '9999999999' } });
  ud = graph[0]?.data?.[0]?.user_data || {};
  check('placeholder name / dummy phone in the request body never sent', !ud.fn && !ud.ln && !ud.ph, ud);

  // 6. Sign-up phone: dial code parsed from the number itself (no India default)
  const reg = normalizeAdvancedMatching({ ph: '+14155552671' });
  const regUk = normalizeAdvancedMatching({ ph: '+447700900123' });
  check('CompleteRegistration AM phone keeps its own country (US / UK), not 91-prefixed', reg.ph === '14155552671' && regUk.ph === '447700900123', { reg, regUk });
  // 7. Cookies without an owner binding are not sent by the server either
  graph.length = 0;
  await post(`zb_external_id=zb.E; ${pii}`, { ...base, eventId: 'vc-5' });
  ud = graph[0]?.data?.[0]?.user_data || {};
  check('cookies with no zb_pii_owner binding → no identity from them (matches browser)', !ud.em && !ud.ph && !ud.fn, ud);
  check('real US ZIP 12345 is kept', normalizeZip('12345', 'US') === '12345');

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
