/**
 * Snap tracking — international readiness checks (US / UK / other markets).
 *
 *   ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PORT=1 \
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/snap-e2e/tsconfig.json scripts/verify-snap-international.ts
 *
 * Runs the REAL code (identity normalizer, CAPI payload builder, browser hooks,
 * the public event relay, /api/checkout/razorpay, /api/checkout/complete, the
 * Razorpay webhook) against an in-memory database and a fake Snap / Razorpay /
 * Shopify HTTP layer. Proves:
 *   1. email / phone / name / city / region / postcode / country are normalized to
 *      Snapchat's Conversions API rules for customers worldwide, then SHA-256 hashed
 *   2. a Purchase is reported in the currency the order was CHARGED in — browser
 *      pixel and server event alike — with the stored order value
 *   3. the order's stored currency always follows the Razorpay charge, also when a
 *      pending order is reused after the shopper's country / currency changed
 *   4. event_source_url is the page on the storefront host the shopper really used
 *   5. hashed identity cookies are sent only for the visitor they belong to
 * No market, currency or price is hard-coded by the tracking code.
 */
import crypto from 'crypto';

const PIXEL = '7d2481be-4ccf-42b2-b9ea-958c6c7bbdcd';
Object.assign(process.env, {
  NODE_ENV: 'test',
  NEXT_PUBLIC_SNAP_PIXEL_ID: PIXEL,
  SNAP_CAPI_ACCESS_TOKEN: 'snap-token',
  NEXT_PUBLIC_SITE_URL: 'https://zicabella.com',
  RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'secret', RAZORPAY_WEBHOOK_SECRET: 'whsec_test',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test', SHOPIFY_STORE_DOMAIN: 'test-shop.myshopify.com',
});
const KEY_SECRET = 'secret';

let passed = 0, failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });
const h = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

// ── catalog (feed.xml g:id) and INR base prices ──
const V = { DENIM: '51813148262681', TEE: '51813148328217' };
const PRICE: Record<string, number> = { [V.DENIM]: 1499, [V.TEE]: 799 };

// ── HTTP fakes ──
type RzpPayment = { id: string; order_id: string; status: string; captured: boolean; amount: number; currency: string; amount_refunded: number };
const razorpayPayments = new Map<string, RzpPayment>();
const snapWeb: Array<{ url: string; event: any }> = [];
(globalThis as any).fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
  const m = u.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\/([^/?]+)/);
  if (m) { const p = razorpayPayments.get(m[1]); return p ? json(200, { ...p }) : json(404, { error: { description: 'not found' } }); }
  if (u.startsWith('https://tr.snapchat.com/')) { snapWeb.push({ url: u, event: JSON.parse(opt.body).data[0] }); return json(200, { status: 'VALID' }); }
  if (u.includes('/admin/api/')) {
    if (u.includes('/variants.json')) {
      const ids = new URL(u).searchParams.get('ids')?.split(',') || [];
      return json(200, { variants: ids.filter(i => PRICE[i] !== undefined).map(i => ({ id: Number(i), price: PRICE[i].toFixed(2) })) });
    }
    if (u.includes('/orders.json') && (opt.method || 'GET') === 'POST') return json(201, { order: { id: 7001, name: '#7001' } });
    if (u.includes('/orders.json')) return json(200, { orders: [] });
    return json(200, { customers: [], customer: { id: 777 } });
  }
  return json(200, {});
};
const settle = async (ms = 80) => { for (let i = 0; i < 200; i++) await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 200; i++) await new Promise(r => setImmediate(r)); };
const sig = (orderId: string, payId: string) => crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${payId}`).digest('hex');
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { error, warn, log } = console; console.error = () => {}; console.warn = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.error = error; console.warn = warn; console.log = log; }
};

async function main() {
  const norm = await import('../lib/tracking/identity-normalize');
  const capi = await import('../lib/snap-capi');
  const currency = await import('../lib/snap/currency');
  const config = await import('../lib/snap/config');
  const purchase = await import('../lib/snap/purchase');
  const appPurchase = await import('../lib/snap/app-purchase');

  // ══ 1. Identity normalization against Snap's Conversions API rules ══
  // em: trim + lower-case · ph: digits with country code, no "+", no leading 0/00 ·
  // fn/ln: lower-case, no punctuation · ct: lower-case, no punctuation / spaces ·
  // st: US → 2-letter code, elsewhere lower-case compact · zp: lower-case, no spaces /
  // dashes; US → first 5 digits; UK → area + district + sector · country: ISO alpha-2 lower-case.
  console.log('\n— 1. Normalization (worldwide)');
  const CASES: Array<[string, any, any]> = [
    ['US, full names + ZIP+4', { em: ' John.Smith@Example.COM ', ph: '(415) 555-2671', fn: 'John', ln: "O'Neil-Smith", ct: 'San Francisco', st: 'California', zp: '94105-1234', country: 'United States' },
      { em: 'john.smith@example.com', ph: '14155552671', fn: 'john', ln: 'oneilsmith', ct: 'sanfrancisco', st: 'ca', zp: '94105', country: 'us' }],
    ['US, codes + punctuation', { ph: '212-555-0100', fn: 'Mary Ann', ln: 'St. James', ct: 'St. Louis', st: 'N.Y.', zp: '10001-0001', country: 'USA' },
      { em: '', ph: '12125550100', fn: 'maryann', ln: 'stjames', ct: 'stlouis', st: 'ny', zp: '10001', country: 'us' }],
    ['US, Washington D.C.', { ct: 'Washington, D.C.', st: 'District of Columbia', zp: '20500', country: 'United States of America' },
      { em: '', ph: '', fn: '', ln: '', ct: 'washingtondc', st: 'dc', zp: '20500', country: 'us' }],
    ['UK, national mobile + full postcode', { em: 'Jane.Doe@example.co.uk', ph: '07700 900123', ct: 'London', st: 'Greater London', zp: 'SW1A 1AA', country: 'United Kingdom' },
      { em: 'jane.doe@example.co.uk', ph: '447700900123', fn: '', ln: '', ct: 'london', st: 'greaterlondon', zp: 'sw1a1', country: 'gb' }],
    ['UK, "+44" landline + lower-case postcode', { ph: '+44 20 7946 0958', ct: 'Manchester', zp: 'm1 1ae', country: 'UK' },
      { em: '', ph: '442079460958', fn: '', ln: '', ct: 'manchester', st: '', zp: 'm11', country: 'gb' }],
    ['UK, "0044" prefix + compact postcode', { ph: '0044 7700 900123', zp: 'EC1A1BB', country: 'GB' },
      { em: '', ph: '447700900123', fn: '', ln: '', ct: '', st: '', zp: 'ec1a1', country: 'gb' }],
    ['Canada', { ph: '(416) 555-0199', ct: 'Montréal', st: 'Ontario', zp: 'K1A 0B1', country: 'Canada' },
      { em: '', ph: '14165550199', fn: '', ln: '', ct: 'montréal', st: 'ontario', zp: 'k1a0b1', country: 'ca' }],
    ['Australia', { ph: '0412 345 678', ct: 'Sydney', st: 'New South Wales', zp: '2000', country: 'Australia' },
      { em: '', ph: '61412345678', fn: '', ln: '', ct: 'sydney', st: 'newsouthwales', zp: '2000', country: 'au' }],
    ['UAE (no real postcode: "00000" is dropped)', { ph: '050 123 4567', ct: 'Dubai', st: 'Dubai', zp: '00000', country: 'United Arab Emirates' },
      { em: '', ph: '971501234567', fn: '', ln: '', ct: 'dubai', st: 'dubai', zp: '', country: 'ae' }],
    ['Germany (umlauts kept)', { ph: '0151 23456789', fn: 'Jürgen', ln: 'Müller-Lüdenscheidt', ct: 'München', st: 'Bayern', zp: '80331', country: 'Germany' },
      { em: '', ph: '4915123456789', fn: 'jürgen', ln: 'müllerlüdenscheidt', ct: 'münchen', st: 'bayern', zp: '80331', country: 'de' }],
    ['Singapore', { ph: '8123 4567', ct: 'Singapore', zp: '238801', country: 'Singapore' },
      { em: '', ph: '6581234567', fn: '', ln: '', ct: 'singapore', st: '', zp: '238801', country: 'sg' }],
    ['Saudi Arabia', { ph: '050 123 4567', ct: 'Riyadh', st: 'Riyadh', zp: '11564', country: 'Saudi Arabia' },
      { em: '', ph: '966501234567', fn: '', ln: '', ct: 'riyadh', st: 'riyadh', zp: '11564', country: 'sa' }],
    ['France', { ph: '06 12 34 56 78', fn: 'Raphaël', ct: 'Paris', st: 'Île-de-France', zp: '75008', country: 'France' },
      { em: '', ph: '33612345678', fn: 'raphaël', ln: '', ct: 'paris', st: 'îledefrance', zp: '75008', country: 'fr' }],
    ['Netherlands', { ph: '06 12345678', ct: 'Amsterdam', zp: '1012 AB', country: 'Netherlands' },
      { em: '', ph: '31612345678', fn: '', ln: '', ct: 'amsterdam', st: '', zp: '1012ab', country: 'nl' }],
    ['Ireland', { ph: '085 123 4567', ct: 'Dublin', zp: 'D02 X285', country: 'Ireland' },
      { em: '', ph: '353851234567', fn: '', ln: '', ct: 'dublin', st: '', zp: 'd02x285', country: 'ie' }],
    ['Japan', { ph: '090-1234-5678', ct: 'Chiyoda', st: 'Tokyo', zp: '100-0001', country: 'Japan' },
      { em: '', ph: '819012345678', fn: '', ln: '', ct: 'chiyoda', st: 'tokyo', zp: '1000001', country: 'jp' }],
    ['New Zealand', { ph: '021 123 4567', ct: 'Auckland', zp: '1010', country: 'New Zealand' },
      { em: '', ph: '64211234567', fn: '', ln: '', ct: 'auckland', st: '', zp: '1010', country: 'nz' }],
    ['India (home market unchanged)', { em: 'Riya@Example.com', ph: '98111 22233', fn: 'राहुल', ln: 'Sharma', ct: 'Noida', st: 'Uttar Pradesh', zp: '201 301', country: 'India' },
      { em: 'riya@example.com', ph: '919811122233', fn: 'राहुल', ln: 'sharma', ct: 'noida', st: 'uttarpradesh', zp: '201301', country: 'in' }],
    // Countries the address form's dropdown does not list are still real countries:
    ['Brazil (not in the store dropdown)', { ph: '(11) 91234-5678', ct: 'São Paulo', st: 'São Paulo', zp: '01310-100', country: 'Brazil' },
      { em: '', ph: '5511912345678', fn: '', ln: '', ct: 'sãopaulo', st: 'sãopaulo', zp: '01310100', country: 'br' }],
    ['Brazil by ISO code (e.g. from the visitor\'s IP)', { ph: '(11) 91234-5678', country: 'BR' },
      { em: '', ph: '5511912345678', fn: '', ln: '', ct: '', st: '', zp: '', country: 'br' }],
    ['Puerto Rico (US territory, not in the dropdown)', { ph: '(787) 555-0123', zp: '00901', country: 'PR' },
      { em: '', ph: '17875550123', fn: '', ln: '', ct: '', st: '', zp: '00901', country: 'pr' }],
    ['Jersey (UK crown dependency, not in the dropdown)', { ph: '07797 712345', country: 'Jersey' },
      { em: '', ph: '447797712345', fn: '', ln: '', ct: '', st: '', zp: '', country: 'je' }],
  ];
  for (const [label, raw, want] of CASES) eq(`normalize: ${label}`, norm.normalizeIdentity(raw), want);
  eq('a "+"-prefixed number is read by its own country code whatever the address says', norm.normalizePhone('+14155552671', 'IN'), '14155552671');

  // ── Phone numbers exactly as the checkout STORES them ──
  // lib/countries.ts validatePhoneNumber is what app/checkout/page.tsx and the profile
  // page write to the customer / address record. For every non-Indian country the old
  // version put a "+" in front of the typed digits ("+4155552671"): such numbers exist
  // in the database and must still be matched to the right person.
  const countryLib = await import('../lib/countries');
  const stored = (typed: string, name: string, code: string) => countryLib.validatePhoneNumber(typed, name, code);
  eq('checkout now stores a real E.164 number for the selected country', [
    stored('415 555 2671', 'United States', 'US'), stored('(415) 555-2671', 'United States', 'US'), stored('07700 900123', 'United Kingdom', 'GB'),
    stored('0044 7700 900123', 'United Kingdom', 'GB'), stored('+1 415 555 2671', 'United Kingdom', 'GB'), stored('050 123 4567', 'United Arab Emirates', 'AE'),
    stored('0151 23456789', 'Germany', 'DE'), stored('604-555-0199', 'Canada', 'CA'), stored('312 345', 'Andorra', 'AD'), stored('98111 22233', 'India', 'IN'),
  ].map(r => [r.valid, r.formattedPhone]), [
    [true, '+14155552671'], [true, '+14155552671'], [true, '+447700900123'], [true, '+447700900123'], [true, '+14155552671'], [true, '+971501234567'],
    [true, '+4915123456789'], [true, '+16045550199'], [true, '+376312345'], [true, '+919811122233'],
  ]);
  eq('a number that cannot be a number of the selected country (or of any country) is refused with a usable message',
    [stored('12', 'United States', 'US'), stored('555', 'United Kingdom', 'GB'), stored('', 'Canada', 'CA')].map(r => [r.valid, /valid phone number for (United States|United Kingdom|Canada)/.test(r.error)]),
    [[false, true], [false, true], [false, true]]);
  eq('a number typed with another country\'s code is kept as typed (the customer knows their number)',
    [stored('+91 98111 22233', 'United States', 'US').formattedPhone, stored('+971 50 123 4567', 'United Kingdom', 'GB').formattedPhone], ['+919811122233', '+971501234567']);
  // Legacy stored shapes ("+" + national digits) read with the country of the order's address:
  eq('legacy "+<national digits>" numbers are read as numbers of the customer\'s own country', [
    norm.normalizePhone('+4155552671', 'US'),      // not a Swiss number (too short) → US
    norm.normalizePhone('+07700900123', 'GB'),     // "+0…" is nobody's code → GB
    norm.normalizePhone('+00447700900123', 'GB'),  // "+00…" → international prefix
    norm.normalizePhone('+6045550199', 'CA'),      // a possible Malaysian number too: the address country wins the tie
    norm.normalizePhone('+2079460000', 'GB'),      // a possible Egyptian number too, but not a valid one; valid in GB
    norm.normalizePhone('+5551234567', 'US'),
    norm.normalizePhone('+501234567', 'AE'),
  ], ['14155552671', '447700900123', '447700900123', '16045550199', '442079460000', '15551234567', '971501234567']);
  eq('…while a real foreign number on the order keeps its own code', [
    norm.normalizePhone('+919811122233', 'US'), norm.normalizePhone('+919811122233', 'AE'), norm.normalizePhone('+447911123456', 'AE'),
    norm.normalizePhone('+14155552671', 'GB'), norm.normalizePhone('+60123456789', 'CA'), norm.normalizePhone('+14155552671', 'IN'),
  ], ['919811122233', '919811122233', '447911123456', '14155552671', '60123456789', '14155552671']);
  eq('bare digits that already carry the country\'s own code are not given it twice', [
    norm.normalizePhone('4915123456789', 'DE'), norm.normalizePhone('919811122233', 'IN'), norm.normalizePhone('14155552671', 'US'), norm.normalizePhone('6281234567890', 'ID'),
  ], ['4915123456789', '919811122233', '14155552671', '6281234567890']);
  eq('no country at all: only a number that carries its code, or a bare Indian mobile number (home market), is accepted', [
    norm.normalizePhone('+14155552671', ''), norm.normalizePhone('0044 7700 900123', undefined), norm.normalizePhone('919811122233', null),
    norm.normalizePhone('98111 22233', ''), norm.normalizePhone('098111 22233', ''), norm.normalizePhone('4155552671', ''), norm.normalizePhone('2125551234', ''),
  ], ['14155552671', '447700900123', '919811122233', '919811122233', '919811122233', '', '']);

  // ── Repairing numbers stored before the fix (scripts/fix-international-phones.ts) ──
  const phoneLib = await import('../lib/tracking/phone');
  eq('repairStoredPhone: what a stored number should become', [
    phoneLib.repairStoredPhone('+4155552671', 'US'), phoneLib.repairStoredPhone('+07700900123', 'GB'), phoneLib.repairStoredPhone('+6045550199', 'CA'),
    phoneLib.repairStoredPhone('+14155552671', 'US'), phoneLib.repairStoredPhone('+919811122233', 'GB'), phoneLib.repairStoredPhone('', 'US'), phoneLib.repairStoredPhone('+4155552671', ''),
  ], [{ next: '+14155552671', ambiguous: false }, { next: '+447700900123', ambiguous: false }, { next: '+16045550199', ambiguous: true }, null, null, null, null]);
  {
    // The script runs against the in-memory database (numbers chosen not to collide with the checkout fixtures below).
    const { default: mem } = await import('./payment-e2e/memory-prisma');
    const addr = (id: string, phone: string, country: string) => mem.address.create({ data: { id, customerId: `cust_${id}`, name: 'A B', email: `${id}@example.com`, phone, phoneLast10: phone.replace(/\D/g, '').slice(-10), address1: '1 Street', city: 'City', state: 'State', zip: '00000', country, isDefault: true } });
    await mem.customer.create({ data: { id: 'cust_fix_us', name: 'A B', email: 'fix_us@example.com', phone: '+2125550147' } });
    await mem.customer.create({ data: { id: 'cust_fix_in', name: 'C D', email: 'fix_in@example.com', phone: '+919898989898' } });
    await addr('fix_us', '+2125550147', 'United States');
    await addr('fix_gb', '+07400123456', 'United Kingdom');
    await addr('fix_ca', '+6045550199', 'Canada');
    await addr('fix_ok', '+13105550123', 'United States');
    await addr('fix_in', '+919898989898', 'India');
    const argv = process.argv; process.argv = [argv[0], argv[1], '--apply'];
    const exit = process.exit; const logs: string[] = []; const log = console.log; console.log = (...a: any[]) => { logs.push(a.join(' ')); };
    const finished = new Promise<number>(resolve => { (process as any).exit = (code?: number) => resolve(code ?? 0); });
    let code = -1;
    try {
      await import('./fix-international-phones');
      code = await finished;
    } finally {
      process.argv = argv; (process as any).exit = exit; console.log = log;
    }
    const rows = await mem.address.findMany({ where: { id: { in: ['fix_us', 'fix_gb', 'fix_ca', 'fix_ok', 'fix_in'] } }, orderBy: { id: 'asc' }, select: { id: true, phone: true, phoneLast10: true } });
    const customers = await mem.customer.findMany({ where: { id: { in: ['cust_fix_us', 'cust_fix_in'] } }, orderBy: { id: 'asc' }, select: { id: true, phone: true } });
    eq('repair script (--apply): unambiguous numbers are rewritten for their country, ambiguous / correct / Indian ones are left alone',
      [code, rows.map((r: any) => [r.id, r.phone, r.phoneLast10]), customers.map((c: any) => [c.id, c.phone])],
      [0, [['fix_ca', '+6045550199', '6045550199'], ['fix_gb', '+447400123456', '7400123456'], ['fix_in', '+919898989898', '9898989898'], ['fix_ok', '+13105550123', '3105550123'], ['fix_us', '+12125550147', '2125550147']],
        [['cust_fix_in', '+919898989898'], ['cust_fix_us', '+12125550147']]]);
    check('repair script lists the ambiguous number for review and reports what it wrote',
      logs.some(l => /REVIEW\s+address fix_ca \(CA\): \+6045550199 → \+16045550199/.test(l)) && logs.some(l => /done: 2 address\(es\) and 1 customer record\(s\) repaired/.test(l)), logs);
  }

  // ── Postal codes ──
  eq('postcodes: punctuation and dashes of every kind are formatting; US territories use ZIP; Crown dependencies use UK postcodes', [
    norm.normalizeZip('94105–1234', 'US'), norm.normalizeZip('94105-1234', 'US'), norm.normalizeZip('SW1A 1AA.', 'GB'), norm.normalizeZip('GIR 0AA', 'GB'),
    norm.normalizeZip('00901', 'PR'), norm.normalizeZip('96910-1234', 'GU'), norm.normalizeZip('JE2 3AB', 'JE'), norm.normalizeZip('GY1 1AA', 'GG'), norm.normalizeZip('IM1 1AA', 'IM'),
    norm.normalizeZip('1012 AB', 'NL'), norm.normalizeZip('100-0001', 'JP'), norm.normalizeZip('N/A', 'AE'), norm.normalizeZip('00000', 'AE'),
  ], ['94105', '94105', 'sw1a1', 'gir0', '00901', '96910', 'je23', 'gy11', 'im11', '1012ab', '1000001', '', '']);
  eq('unusable values are dropped, never guessed', norm.normalizeIdentity({ em: 'not-an-email', ph: '12', ct: '!!!', st: '--', zp: 'N/A', country: 'Narnia' }),
    { em: '', ph: '', fn: '', ln: '', ct: '', st: '', zp: '', country: '' });
  const iso = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
  const unresolved = iso.filter(c => norm.normalizeCountry(c) !== c.toLowerCase() || norm.normalizeCountry(c.toLowerCase()) !== c.toLowerCase());
  check(`all ${iso.length} ISO 3166-1 country codes are accepted (upper or lower case)`, iso.length === 249 && unresolved.length === 0, unresolved);
  eq('non-codes are refused', ['XX', 'ZZ', 'EU', 'A1', 'USAA'].map(c => norm.normalizeCountry(c)), ['', '', '', '', '']);
  eq('country names and common variants', ['United Kingdom', 'U.K.', 'England', 'U.S.A.', 'United States of America', 'UAE', 'Türkiye', 'Côte d\'Ivoire', 'Viet Nam', 'Czechia', 'The Netherlands', 'South Korea', 'Hong Kong SAR', 'Puerto Rico', 'Brasil', 'Guinea-Bissau'].map(n => norm.normalizeCountry(n)),
    ['gb', 'gb', 'gb', 'us', 'us', 'ae', 'tr', 'ci', 'vn', 'cz', 'nl', 'kr', 'hk', 'pr', 'br', 'gw']);

  // Hashing: SHA-256 hex of exactly the normalized value, per field, sent as Snap's list form.
  const hashedEvent = capi.buildSnapCapiEvent({
    eventName: 'PURCHASE', eventId: 'ord_hash', eventTime: Date.now(), eventSourceUrl: 'https://zicabella.com/orders/ord_hash/confirmation', userAgent: 'UA',
    ipAddress: '81.2.69.142', scClickId: 'click-1', scCookie1: 'scid-1', externalId: 'cust_42', userData: CASES[0][1],
  });
  eq('every identity field = [sha256(normalized value)]', Object.fromEntries(Object.entries(CASES[0][2]).map(([k]) => [k, hashedEvent.user_data[k]])),
    Object.fromEntries(Object.entries(CASES[0][2] as Record<string, string>).map(([k, v]) => [k, [h(v)]])));
  check('hashes are 64 lower-case hex characters', Object.values(hashedEvent.user_data).flat().filter((v: any) => typeof v === 'string' && v.length === 64).every((v: any) => /^[a-f0-9]{64}$/.test(v)));
  eq('external_id is hashed; IP, user agent, click id and _scid are sent as they are',
    [hashedEvent.user_data.external_id, hashedEvent.user_data.client_ip_address, hashedEvent.user_data.client_user_agent, hashedEvent.user_data.sc_click_id, hashedEvent.user_data.sc_cookie1],
    [[h('cust_42')], '81.2.69.142', 'UA', 'click-1', 'scid-1']);
  const preHashed = capi.buildSnapCapiEvent({ eventName: 'PAGE_VIEW', eventId: 'pv_prehashed', eventSourceUrl: 'https://zicabella.com/', userAgent: 'UA', userData: { em: h('jane.doe@example.co.uk').toUpperCase(), ph: h('447700900123') } });
  eq('values that are already SHA-256 are passed through once (never hashed twice)', [preHashed.user_data.em, preHashed.user_data.ph], [[h('jane.doe@example.co.uk')], [h('447700900123')]]);
  check('missing fields are omitted, never sent empty or invented', !('fn' in preHashed.user_data) && !('country' in preHashed.user_data) && !('zp' in preHashed.user_data));

  // ══ 2. Purchase currency ══
  console.log('\n— 2. Purchase value + currency');
  eq('currency = the order\'s own, upper-cased', ['USD', 'gbp', ' aed ', 'Eur', 'CAD', 'AUD', 'INR'].map(c => currency.snapPurchaseCurrency({ currency: c })), ['USD', 'GBP', 'AED', 'EUR', 'CAD', 'AUD', 'INR']);
  eq('a missing / malformed stored currency falls back to the column default (INR), never to a guess', [undefined, null, '', 'US$', 'RUPEES'].map(c => currency.snapPurchaseCurrency({ currency: c as any })), ['INR', 'INR', 'INR', 'INR', 'INR']);
  check('every currency the store can charge in (Razorpay) is accepted by Snap', ['INR', 'USD', 'GBP', 'CAD', 'AUD', 'AED', 'EUR'].every(c => currency.isSnapSupportedCurrency(c)));
  check('an unlisted currency is recognised as such (warned about, still sent as charged)', !currency.isSnapSupportedCurrency('XYZ') && !currency.isSnapSupportedCurrency(''));
  const intlOrder = (cur: string, total: number, unit: number, addr: any, customer: any) => ({
    id: `ord_${cur}`, orderType: 'WEB_STORE', paymentStatus: 'paid', totalPrice: total, currency: cur, customerId: 'cust_9',
    createdAt: new Date(), paymentCapturedAt: new Date(), customer, shippingAddress: JSON.stringify(addr),
    items: [{ variantId: V.DENIM, sku: V.DENIM, quantity: 2, price: unit }],
  });
  for (const [cur, total, unit, addr, customer, wantPhone, wantCountry] of [
    ['USD', 89.94, 44.97, { city: 'San Francisco', state: 'California', zip: '94105-1234', country: 'United States', countryCode: 'US' }, { email: 'john@example.com', phone: '(415) 555-2671', name: 'John Smith' }, '14155552671', 'us'],
    ['GBP', 71.2, 35.6, { city: 'London', state: 'Greater London', zip: 'SW1A 1AA', country: 'United Kingdom', countryCode: 'GB' }, { email: 'jane@example.co.uk', phone: '07700 900123', name: 'Jane Doe' }, '447700900123', 'gb'],
    ['AED', 330.52, 165.26, { city: 'Dubai', state: 'Dubai', zip: '00000', country: 'United Arab Emirates', countryCode: 'AE' }, { email: 'aisha@example.ae', phone: '050 123 4567', name: 'Aisha Khan' }, '971501234567', 'ae'],
    ['EUR', 82.44, 41.22, { city: 'München', state: 'Bayern', zip: '80331', country: 'Germany', countryCode: 'DE' }, { email: 'j@example.de', phone: '0151 23456789', name: 'Jürgen Müller' }, '4915123456789', 'de'],
    ['INR', 2998, 1499, { city: 'Noida', state: 'Uttar Pradesh', zip: '201301', country: 'India', countryCode: 'IN' }, { email: 'riya@example.com', phone: '98111 22233', name: 'Riya Kapoor' }, '919811122233', 'in'],
  ] as const) {
    const event = capi.buildSnapCapiEvent(purchase.buildPurchaseFromOrder(intlOrder(cur, total, unit, addr, customer), { userAgent: 'UA' }, Date.now()) as any);
    eq(`${cur} order → value ${total} ${cur}, unit price in ${cur}`, [event.custom_data.value, event.custom_data.currency, event.custom_data.contents[0].item_price, event.custom_data.num_items], [total, cur, unit, '2']);
    eq(`${cur} order → customer phone + country hashed for ${wantCountry.toUpperCase()}`, [event.user_data.ph, event.user_data.country], [[h(wantPhone)], [h(wantCountry)]]);
  }
  // Which phone: one with its country code is safe anywhere; one without is only read with the address it was typed for.
  const identity = await import('../lib/snap/identity');
  eq('buyer phone choice', [
    identity.snapPurchasePhone('+14155552671', '07700 900123'),      // verified login number wins
    identity.snapPurchasePhone('0044 7700 900123', '98111 22233'),
    identity.snapPurchasePhone('(415) 555-2671', '07700 900123'),    // no country code → the number typed with this address
    identity.snapPurchasePhone('(415) 555-2671', ''),                // nothing else → best effort
    identity.snapPurchasePhone('9999999999', '07700 900123'),        // dummy number skipped
    identity.snapPurchasePhone(null, undefined),
  ], ['+14155552671', '0044 7700 900123', '07700 900123', '(415) 555-2671', '07700 900123', undefined]);
  const movedCustomer = capi.buildSnapCapiEvent(purchase.buildPurchaseFromOrder({
    ...intlOrder('GBP', 71.2, 35.6, { city: 'London', zip: 'SW1A 1AA', countryCode: 'GB', phone: '07700 900123' }, { email: 'john@example.com', phone: '(415) 555-2671', name: 'John Smith' }),
  }, { userAgent: 'UA' }, Date.now()) as any);
  eq('a customer whose saved number is from another country: the UK number typed at this checkout is hashed (+44), not the old one read as British',
    movedCustomer.user_data.ph, [h('447700900123')]);
  // Orders whose customer + address carry the LEGACY stored shape ("+" + national digits):
  for (const [label, addr, customerPhone, wantPhone] of [
    ['US customer stored as "+4155552671"', { city: 'San Francisco', countryCode: 'US', phone: '+4155552671' }, '+4155552671', '14155552671'],
    ['Canadian customer stored as "+6045550199" (also a possible Malaysian number)', { city: 'Vancouver', countryCode: 'CA', phone: '+6045550199' }, '+6045550199', '16045550199'],
    ['UK customer stored as "+07700900123"', { city: 'London', countryCode: 'GB', phone: '+07700900123' }, '+07700900123', '447700900123'],
    ['UK address, customer\'s verified Indian login number', { city: 'London', countryCode: 'GB', phone: '+07700900123' }, '+919811122233', '919811122233'],
    ['UAE address, customer stored as "+501234567"', { city: 'Dubai', countryCode: 'AE', phone: '+501234567' }, '+501234567', '971501234567'],
  ] as const) {
    const ev = capi.buildSnapCapiEvent(purchase.buildPurchaseFromOrder(
      intlOrder('USD', 10, 10, addr, { email: 'x@example.com', phone: customerPhone, name: 'X Y' }), { userAgent: 'UA' }, Date.now()) as any);
    eq(`legacy stored phone: ${label} → ph hashed as ${wantPhone}`, ev.user_data.ph, [h(wantPhone)]);
  }
  eq('snapPurchasePhone trusts a "+" only when the number really carries a country code', [
    identity.snapPurchasePhone('+4155552671', '+4155552671'),   // "+" + national digits is not a code → the address number (same here)
    identity.snapPurchasePhone('919811122233', '07700 900123'), // bare digits with the code → the login number
    identity.snapPurchasePhone('+919811122233', '07700 900123'),
  ], ['+4155552671', '919811122233', '+919811122233']);

  const appEvent = appPurchase.buildAppPurchaseInput(intlOrder('GBP', 71.2, 35.6, { city: 'London', countryCode: 'GB' }, { email: 'jane@example.co.uk', phone: '07700 900123', name: 'Jane Doe' }), { platform: 'ios' } as any, {}, 'app', Date.now());
  eq('native-app Purchase uses the order currency too', [appEvent.customData?.value, appEvent.customData?.currency], [71.2, 'GBP']);
  for (const f of ['lib/snap/purchase.ts', 'lib/snap/app-purchase.ts']) {
    const src = (await import('fs')).readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    check(`${f}: no hard-coded currency in the Purchase builder`, /currency: snapPurchaseCurrency\(order\)/.test(src) && !/currency:\s*['"]INR['"]/.test(src));
  }

  // Browser pixel side
  const pixelCalls: any[][] = [];
  (globalThis as any).window = { location: { href: 'https://zicabella.com/orders/ord_USD/confirmation', hostname: 'zicabella.com', search: '', pathname: '/orders/ord_USD/confirmation' }, snaptr: (...a: any[]) => pixelCalls.push(a) };
  (globalThis as any).document = { cookie: '' };
  try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'UA' }, configurable: true }); } catch { /* ignore */ }
  const hooks = await import('../hooks/useSnapEvents');
  hooks.snapTrackPurchase('ord_USD', 89.94, 'usd', [V.DENIM], { em: 'john@example.com', ph: '(415) 555-2671', country: 'US', st: 'California', zp: '94105-1234' }, 'Denim', [{ id: V.DENIM, quantity: 2, item_price: 44.97 }]);
  const track = pixelCalls.find(c => c[0] === 'track');
  const init = [...pixelCalls].reverse().find(c => c[0] === 'init');
  eq('browser pixel PURCHASE: price + currency of the charge, deduplication ids = order id',
    [track?.[1], track?.[2]?.price, track?.[2]?.currency, track?.[2]?.transaction_id, track?.[2]?.client_dedup_id, track?.[2]?.number_items], ['PURCHASE', 89.94, 'USD', 'ord_USD', 'ord_USD', 2]);
  eq('browser pixel identity is normalized with the same worldwide rules as the server', [init?.[1], init?.[2]?.user_email, init?.[2]?.user_phone_number, init?.[2]?.geo_region, init?.[2]?.geo_postal_code, init?.[2]?.geo_country],
    [PIXEL, 'john@example.com', '14155552671', 'ca', '94105', 'us']);

  // ══ 3. End to end: international checkout through the real routes ══
  console.log('\n— 3. International checkout (real routes)');
  const { db, default: prisma } = await import('./payment-e2e/memory-prisma');
  const razorpayRoute = await import('../app/api/checkout/razorpay/route');
  const completeRoute = await import('../app/api/checkout/complete/route');
  const webhookRoute = await import('../app/api/webhooks/razorpay/route');
  const gp = await import('../lib/global-pricing-client');
  await prisma.shop.create({ data: { id: 'shop_1', name: 'Zica Bella', domain: 'test-shop.myshopify.com' } });
  await prisma.globalStoreSettings.create({ data: { id: 'singleton', globalStoreEnabled: true } });
  const countries: any[] = [
    { code: 'IN', name: 'India', currencyCode: 'INR', currencySymbol: '₹', locale: 'en-IN', isBase: true, multiplier: 1, exchangeRate: 1, isActive: true, sortOrder: 0 },
    { code: 'US', name: 'United States', currencyCode: 'USD', currencySymbol: '$', locale: 'en-US', isBase: false, multiplier: 2.5, exchangeRate: 0.012, isActive: true, sortOrder: 1 },
    { code: 'GB', name: 'United Kingdom', currencyCode: 'GBP', currencySymbol: '£', locale: 'en-GB', isBase: false, multiplier: 2.5, exchangeRate: 0.0095, isActive: true, sortOrder: 2 },
  ];
  for (const c of countries) await prisma.globalStoreCountry.create({ data: c });
  const cfg = (code: string) => countries.find(c => c.code === code);
  const conv = (inr: number, code: string) => gp.formatPriceWithConfig(inr, cfg(code), true).amount; // exactly what the storefront shows / charges

  const cart = [{ productId: '10227656982809', variantId: V.DENIM, title: 'AEROLAYER DENIM', quantity: 2 }, { productId: '10227656982810', variantId: V.TEE, title: 'TEE', quantity: 1 }];
  const priced = (code: string) => {
    const items = cart.map(i => ({ ...i, price: String(conv(PRICE[i.variantId], code)) }));
    const subtotal = conv(cart.reduce((s, i) => s + PRICE[i.variantId] * i.quantity, 0), code);
    return { items, subtotal };
  };
  const ordersBySession = (session: string) => (db.order || []).filter(o => String(o.tags || '').includes(session));
  const snapFor = (orderId: string) => snapWeb.filter(s => s.event.event_id === orderId);
  const rowFor = (orderId: string) => (db.adConversionDelivery || []).find(r => r.platform === 'snap' && r.orderId === orderId);
  const browserHeaders = (origin: string, extra: Record<string, string> = {}) => ({
    'content-type': 'application/json', origin, referer: `${origin}/checkout`, 'x-forwarded-for': '8.8.8.8', 'user-agent': 'Mozilla/5.0 (iPhone)', cookie: 'ScCid=click-us-1; _scid=scid-us-1; zb_external_id=zb.ext-us-1', ...extra,
  });
  const startPayment = async (origin: string, session: string, code: string, address: any, extraHeaders: Record<string, string> = {}) => {
    const { items, subtotal } = priced(code);
    const res = await quiet(() => razorpayRoute.POST(new Request(`${origin}/api/checkout/razorpay`, {
      method: 'POST', headers: browserHeaders(origin, extraHeaders),
      body: JSON.stringify({ amount: subtotal, currency: cfg(code).currencyCode, displayCountry: code, address, items, subtotal, total: subtotal, shipping: 0, paymentMethod: 'razorpay', checkoutSessionId: session }),
    })));
    const data: any = await res.json();
    await settle();
    return { status: res.status, data, items, subtotal };
  };
  const usAddress = { name: 'John Smith', email: 'john.smith@example.com', phone: '(415) 555-2671', houseNo: '1', street: 'Market Street', city: 'San Francisco', state: 'California', zip: '94105-1234', country: 'United States', countryCode: 'US' };

  // 3a. The shopper's country resolved only after the first payment request:
  //     same checkout session, first INR, then USD → the pending order is reused.
  const first = await startPayment('https://zicabella.com', 'cs_intl_1', 'IN', usAddress);
  const o1 = ordersBySession('cs_intl_1')[0];
  eq('first request (country not resolved yet): pending order stored in INR', [first.status, o1?.currency, o1?.totalPrice, first.data.currency], [200, 'INR', 3797, 'INR']);
  const second = await startPayment('https://zicabella.com', 'cs_intl_1', 'US', usAddress);
  const o2 = ordersBySession('cs_intl_1')[0];
  eq('second request in USD reuses the SAME pending order', [second.status, ordersBySession('cs_intl_1').length, second.data.localOrderId], [200, 1, first.data.localOrderId]);
  eq('…and its stored currency now follows the charge (was left as INR before the fix)', [o2.currency, o2.displayCountry, o2.totalPrice, second.data.currency, second.data.amount], ['USD', 'US', 113.91, 'USD', 11391]);
  check('the Razorpay order the shopper pays is the USD one', o2.razorpayOrderId === second.data.id && o2.razorpayOrderId !== first.data.id);

  // 3b. Payment captured in USD → checkout/complete → ONE Snap Purchase in USD
  const payId = 'pay_INTL1';
  razorpayPayments.set(payId, { id: payId, order_id: second.data.id, status: 'captured', captured: true, amount: 11391, currency: 'USD', amount_refunded: 0 });
  snapWeb.length = 0;
  const completeRes = await quiet(() => completeRoute.POST(new Request('https://zicabella.com/api/checkout/complete', {
    method: 'POST', headers: browserHeaders('https://zicabella.com'),
    body: JSON.stringify({ address: usAddress, paymentMethod: 'razorpay', items: second.items, total: second.subtotal, subtotal: second.subtotal, currency: 'USD', displayCountry: 'US',
      razorpay: { razorpay_order_id: second.data.id, razorpay_payment_id: payId, razorpay_signature: sig(second.data.id, payId) }, localOrderId: second.data.localOrderId }),
  })));
  await settle(150);
  const paid = (db.order || []).find(o => o.id === second.data.localOrderId)!;
  eq('checkout/complete: order paid, total and currency as charged', [completeRes.status, paid.paymentStatus, paid.totalPrice, paid.currency], [200, 'paid', 113.91, 'USD']);
  const sent = snapFor(paid.id);
  check('exactly ONE Snap Purchase for the order', sent.length === 1, sent.length);
  const pe = sent[0]?.event;
  eq('Purchase value + currency = the USD charge (not an INR figure)', [pe?.custom_data.value, pe?.custom_data.currency], [113.91, 'USD']);
  eq('line items: variant ids, quantities and USD unit prices', pe?.custom_data.contents, [{ id: V.DENIM, quantity: 2, item_price: 44.97 }, { id: V.TEE, quantity: 1, item_price: 23.97 }]);
  eq('ids for deduplication with the browser pixel', [pe?.event_id, pe?.custom_data.order_id, pe?.action_source], [paid.id, paid.id, 'WEB']);
  eq('event_source_url = the confirmation page on the host the shopper used', pe?.event_source_url, `https://zicabella.com/orders/${paid.id}/confirmation`);
  eq('US customer matching data: phone (+1), state code, 5-digit ZIP, country — hashed',
    [pe?.user_data.em, pe?.user_data.ph, pe?.user_data.st, pe?.user_data.zp, pe?.user_data.country, pe?.user_data.ct, pe?.user_data.fn, pe?.user_data.ln],
    [[h('john.smith@example.com')], [h('14155552671')], [h('ca')], [h('94105')], [h('us')], [h('sanfrancisco')], [h('john')], [h('smith')]]);
  eq('click id, _scid, visitor id, IP and user agent come from the shopper\'s own request',
    [pe?.user_data.sc_click_id, pe?.user_data.sc_cookie1, pe?.user_data.external_id, pe?.user_data.client_ip_address, pe?.user_data.client_user_agent],
    ['click-us-1', 'scid-us-1', [h('zb.ext-us-1')], '8.8.8.8', 'Mozilla/5.0 (iPhone)']);

  // 3c. UK shopper on app.zicabella.com who never returns: the webhook sends the Purchase
  const ukAddress = { name: 'Jane Doe', email: 'jane.doe@example.co.uk', phone: '07700 900123', houseNo: '10', street: 'Downing Street', city: 'London', state: 'Greater London', zip: 'SW1A 1AA', country: 'United Kingdom', countryCode: 'GB' };
  const uk = await startPayment('https://app.zicabella.com', 'cs_intl_2', 'GB', ukAddress, { cookie: 'ScCid=click-uk-1; _scid=scid-uk-1; zb_external_id=zb.ext-uk-1' });
  const ukOrder = ordersBySession('cs_intl_2')[0];
  const ukTotal = conv(3797, 'GB');
  eq('UK pre-create: GBP order, shopper\'s storefront origin stored with the click ids', [uk.status, ukOrder.currency, ukOrder.totalPrice, (rowFor(ukOrder.id)?.context as any)?.pageOrigin, (rowFor(ukOrder.id)?.context as any)?.scClickId],
    [200, 'GBP', ukTotal, 'https://app.zicabella.com', 'click-uk-1']);
  razorpayPayments.set('pay_INTL2', { id: 'pay_INTL2', order_id: uk.data.id, status: 'captured', captured: true, amount: Math.round(ukTotal * 100), currency: 'GBP', amount_refunded: 0 });
  snapWeb.length = 0;
  const hookBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_INTL2', order_id: uk.data.id, status: 'captured', captured: true, amount: Math.round(ukTotal * 100), currency: 'GBP', amount_refunded: 0, notes: {} } } } });
  const hookRes = await quiet(() => webhookRoute.POST(new Request('https://app.zicabella.com/api/webhooks/razorpay', { method: 'POST', body: hookBody, headers: { 'x-razorpay-signature': crypto.createHmac('sha256', 'whsec_test').update(hookBody).digest('hex') } })));
  await settle(150);
  const ukEvent = snapFor(ukOrder.id)[0]?.event;
  eq('webhook-only completion: ONE Purchase, in GBP', [hookRes.status, snapFor(ukOrder.id).length, ukEvent?.custom_data.value, ukEvent?.custom_data.currency], [200, 1, ukTotal, 'GBP']);
  eq('…on the storefront host the shopper used, with the click id stored before payment', [ukEvent?.event_source_url, ukEvent?.user_data.sc_click_id], [`https://app.zicabella.com/orders/${ukOrder.id}/confirmation`, 'click-uk-1']);
  eq('UK customer matching data: phone (+44), postcode sector, country — hashed', [ukEvent?.user_data.ph, ukEvent?.user_data.zp, ukEvent?.user_data.country, ukEvent?.user_data.st], [[h('447700900123')], [h('sw1a1')], [h('gb')], [h('greaterlondon')]]);

  // 3d. event_source_url can only ever be one of the store's own hosts
  eq('storefront origin check', ['https://zicabella.com/checkout', 'https://www.zicabella.com', 'https://app.zicabella.com/x?y=1', 'http://zicabella.com', 'https://evil.example.com', 'https://zicabella.com.evil.io', 'javascript:alert(1)', '', null].map(v => config.snapStorefrontOrigin(v as any)),
    ['https://zicabella.com', 'https://www.zicabella.com', 'https://app.zicabella.com', null, null, null, null, null, null]);
  const foreign = purchase.snapContextFromRequest(new Request('https://zicabella.com/api/checkout/razorpay', { method: 'POST', headers: { origin: 'https://evil.example.com', referer: 'https://evil.example.com/x' } }));
  eq('a foreign Origin header is ignored → the site URL is used', [foreign.pageOrigin, purchase.snapPurchaseSourceUrl('ord_x', foreign), purchase.snapPurchaseSourceUrl('ord_x', { pageOrigin: 'https://evil.example.com' })],
    [undefined, 'https://zicabella.com/orders/ord_x/confirmation', 'https://zicabella.com/orders/ord_x/confirmation']);
  process.env.NEXT_PUBLIC_SITE_URL = 'https://zicabella.com/';
  eq('a trailing slash in NEXT_PUBLIC_SITE_URL cannot produce "//orders"', purchase.snapPurchaseSourceUrl('ord_x', {}), 'https://zicabella.com/orders/ord_x/confirmation');
  process.env.NEXT_PUBLIC_SITE_URL = 'https://zicabella.com';

  // ══ 4. Hashed identity cookies belong to ONE visitor ══
  console.log('\n— 4. Identity cookies are bound to their visitor');
  const snapPixel = await import('../lib/snapPixel');
  const piiCookies = { zb_guest_email: h('jane.doe@example.co.uk'), zb_guest_phone: h('447700900123'), zb_guest_fn: h('jane'), zb_guest_ln: h('doe'), zb_guest_country: h('gb'), zb_guest_zp: h('sw1a1') };
  const setCookies = (c: Record<string, string>) => { (globalThis as any).document = { cookie: Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ') }; };
  setCookies({ ...piiCookies, zb_external_id: 'zb.visitor-A', zb_pii_owner: 'zb.visitor-A', ScCid: 'click-9', _scid: 'scid-9' });
  let ids = snapPixel.getSnapIdentityCookies();
  eq('same visitor: hashed details + Snap ids are available', [ids.em, ids.ph, ids.country, ids.sc_click_id, ids.sc_cookie1, ids.external_id], [piiCookies.zb_guest_email, piiCookies.zb_guest_phone, piiCookies.zb_guest_country, 'click-9', 'scid-9', 'zb.visitor-A']);
  setCookies({ ...piiCookies, zb_external_id: 'zb.visitor-B', zb_pii_owner: 'zb.visitor-A', ScCid: 'click-9', _scid: 'scid-9' });
  ids = snapPixel.getSnapIdentityCookies();
  eq('another visitor on the same device: the previous shopper\'s details are NOT used', [ids.em, ids.ph, ids.fn, ids.ln, ids.country, ids.zp], [undefined, undefined, undefined, undefined, undefined, undefined]);
  eq('…while this visitor\'s own Snap ids still are', [ids.sc_click_id, ids.sc_cookie1, ids.external_id], ['click-9', 'scid-9', 'zb.visitor-B']);
  setCookies({ ...piiCookies, zb_external_id: 'zb.visitor-A' });
  eq('details with no owner binding are not used either', snapPixel.getSnapIdentityCookies().em, undefined);
  eq('…so the pixel is not initialised with them', snapPixel.buildPixelIdentity(), {});

  const relay = await import('../app/api/snap/event/route');
  const { NextRequest } = await import('next/server');
  let ipN = 0;
  const relayEvent = async (eventName: string, cookies: Record<string, string>, userData: any = {}) => {
    snapWeb.length = 0;
    const res = await quiet(() => relay.POST(new NextRequest('https://zicabella.com/api/snap/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `81.2.69.${++ipN}`, 'user-agent': 'UA', cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: JSON.stringify({ eventName, eventId: `${eventName.toLowerCase()}_snap_${ipN}abcdef`, eventTime: Date.now(), eventSourceUrl: 'https://zicabella.com/checkout', userAgent: 'UA', userData }),
    })));
    return { status: res.status, event: snapWeb[0]?.event };
  };
  const bound = { ...piiCookies, zb_external_id: 'zb.visitor-A', zb_pii_owner: 'zb.visitor-A', ScCid: 'click-9', _scid: 'scid-9' };
  const stale = { ...bound, zb_external_id: 'zb.visitor-B' };
  let rel = await relayEvent('START_CHECKOUT', bound);
  eq('server relay, same visitor at checkout: hashed cookie details are attached', [rel.status, rel.event?.user_data.em, rel.event?.user_data.ph, rel.event?.user_data.country], [200, [piiCookies.zb_guest_email], [piiCookies.zb_guest_phone], [piiCookies.zb_guest_country]]);
  rel = await relayEvent('START_CHECKOUT', stale);
  check('server relay, different visitor: nobody else\'s email / phone / name / address is attached', rel.status === 200 && !rel.event?.user_data.em && !rel.event?.user_data.ph && !rel.event?.user_data.fn && !rel.event?.user_data.zp, rel.event?.user_data);
  eq('…but the event still carries this visitor\'s Snap ids', [rel.event?.user_data.sc_click_id, rel.event?.user_data.sc_cookie1, rel.event?.user_data.external_id], ['click-9', 'scid-9', [h('zb.visitor-B')]]);
  rel = await relayEvent('START_CHECKOUT', stale, { em: 'New.Shopper@Example.com', ph: '(415) 555-2671', country: 'US' });
  eq('…and details the visitor typed themselves are used (normalized for their country)', [rel.event?.user_data.em, rel.event?.user_data.ph, rel.event?.user_data.country], [[h('new.shopper@example.com')], [h('14155552671')], [h('us')]]);
  rel = await relayEvent('VIEW_CONTENT', bound);
  check('browsing events of a logged-out visitor never carry email / phone / name (unchanged rule)', !rel.event?.user_data.em && !rel.event?.user_data.ph && !rel.event?.user_data.fn && !!rel.event?.user_data.country, rel.event?.user_data);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(err => { console.error(err); process.exit(1); });
