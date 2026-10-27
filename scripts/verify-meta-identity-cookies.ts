/**
 * Server-side Meta identity cookies (lib/meta/identity-cookies.ts) — the pure
 * planning logic middleware.ts applies on storefront page loads.
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-identity-cookies.ts
 */
import {
  planMetaIdentityCookies, identityCookieDomain, isIdentityCookieRequest,
  FBP_FBC_MAX_AGE_S, EXTERNAL_ID_MAX_AGE_S,
} from '../lib/meta/identity-cookies';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); }
}

const now = 1_760_000_000_000;
const uuid = () => '11111111-2222-4333-8444-555555555555';
const random = () => 0.123456789;
const byName = (plan: ReturnType<typeof planMetaIdentityCookies>) => Object.fromEntries(plan.map(c => [c.name, c]));

// 1. New visitor, no fbclid: _fbp and zb_external_id minted, no _fbc.
{
  const p = byName(planMetaIdentityCookies({ nowMs: now, uuid, random }));
  check('new visitor: _fbp minted in Meta format', /^fb\.1\.\d{13}\.\d{10}$/.test(p._fbp?.value || ''), p._fbp);
  check('new visitor: _fbp uses subdomain index 1', p._fbp?.value.startsWith('fb.1.'));
  check('new visitor: zb_external_id minted as zb.<uuid>', p.zb_external_id?.value === 'zb.' + uuid());
  check('new visitor: no _fbc without a click id', p._fbc === undefined);
  check('new visitor: max-ages 90 d / 365 d', p._fbp?.maxAge === FBP_FBC_MAX_AGE_S && p.zb_external_id?.maxAge === EXTERNAL_ID_MAX_AGE_S);
}

// 2. Ad-click landing: _fbc built from fbclid, verbatim, index 1, creation time = now.
{
  const fbclid = 'IwAR2abc_DEF-ghi9';
  const p = byName(planMetaIdentityCookies({ nowMs: now, uuid, random, fbclid }));
  check('fbclid landing: _fbc = fb.1.<now>.<fbclid> (click id unmodified)', p._fbc?.value === `fb.1.${now}.${fbclid}`, p._fbc);
  check('fbclid landing: _fbc is marked changed', p._fbc?.changed === true);
}

// 3. Returning visitor: every valid cookie is refreshed with the SAME value.
{
  const fbp = 'fb.1.1700000000000.123456789', fbc = 'fb.1.1700000000000.IwARold', ext = 'zb.aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const p = byName(planMetaIdentityCookies({ nowMs: now, uuid, random, fbp, fbc, externalId: ext }));
  check('returning: _fbp kept', p._fbp?.value === fbp && p._fbp.changed === false);
  check('returning: _fbc kept (no new click)', p._fbc?.value === fbc && p._fbc.changed === false);
  check('returning: zb_external_id kept', p.zb_external_id?.value === ext && p.zb_external_id.changed === false);
}

// 4. Returning visitor with a NEW click id: _fbc replaced; same click id: not rewritten.
{
  const fbc = 'fb.1.1700000000000.IwARold';
  const fresh = byName(planMetaIdentityCookies({ nowMs: now, uuid, random, fbc, fbclid: 'IwARnew' }));
  check('new click id replaces the stored _fbc', fresh._fbc?.value === `fb.1.${now}.IwARnew` && fresh._fbc.changed === true);
  const same = byName(planMetaIdentityCookies({ nowMs: now, uuid, random, fbc, fbclid: 'IwARold' }));
  check('same click id → stored _fbc refreshed, not rewritten (keeps original creation time)', same._fbc?.value === fbc && same._fbc.changed === false);
}

// 5. Logged-in customer id (not zb.-prefixed) is refreshed, never replaced.
{
  const p = byName(planMetaIdentityCookies({ nowMs: now, uuid, random, externalId: 'cmg1customer0001' }));
  check('customer external id kept across requests', p.zb_external_id?.value === 'cmg1customer0001' && p.zb_external_id.changed === false);
}

// 6. Garbage is replaced, never forwarded; a malformed fbclid is ignored.
{
  const p = byName(planMetaIdentityCookies({ nowMs: now, uuid, random, fbp: 'not-a-fbp', fbc: 'x', externalId: '<script>', fbclid: 'bad id with spaces' }));
  check('malformed _fbp re-minted', /^fb\.1\.\d{13}\.\d{10}$/.test(p._fbp?.value || ''));
  check('malformed _fbc dropped and bad fbclid ignored', p._fbc === undefined);
  check('malformed external id re-minted', p.zb_external_id?.value === 'zb.' + uuid());
}

// 6b. Snap: a ?ScCid= landing mints the click-id cookie; an existing one is refreshed; _scid is re-set.
{
  const p = byName(planMetaIdentityCookies({ nowMs: now, uuid, random, scClickParam: 'ScCidABC123_xyz' }));
  check('ScCid minted from the URL (90 d)', p.ScCid?.value === 'ScCidABC123_xyz' && p.ScCid.changed === true && p.ScCid.maxAge === 90 * 86400);
  const r = byName(planMetaIdentityCookies({ nowMs: now, uuid, random, scCid: 'ScCidABC123_xyz', scid: '9cc9f404-a7d6-42ef-b3a9-c11983131522' }));
  check('existing ScCid refreshed unchanged', r.ScCid?.value === 'ScCidABC123_xyz' && r.ScCid.changed === false);
  check('_scid re-set with its own value (395 d)', r._scid?.value === '9cc9f404-a7d6-42ef-b3a9-c11983131522' && r._scid.maxAge === 395 * 86400);
  const n = byName(planMetaIdentityCookies({ nowMs: now, uuid, random, scClickParam: 'new-click-id-0001', scCid: 'ScCidABC123_xyz' }));
  check('a new ScCid in the URL replaces the stored one', n.ScCid?.value === 'new-click-id-0001' && n.ScCid.changed === true);
  const bad = byName(planMetaIdentityCookies({ nowMs: now, uuid, random, scClickParam: 'bad id', scCid: '<x>', scid: 'y' }));
  check('malformed Snap ids ignored', bad.ScCid === undefined && bad._scid === undefined);
}

// 7. Cookie domain matches lib/metaPixel.ts setClientCookie (last two labels; none for localhost / IPs).
check('domain: zicabella.com → zicabella.com', identityCookieDomain('zicabella.com') === 'zicabella.com');
check('domain: www.zicabella.com → zicabella.com', identityCookieDomain('www.zicabella.com:443') === 'zicabella.com');
check('domain: localhost → none', identityCookieDomain('localhost:3001') === undefined);
check('domain: IP → none', identityCookieDomain('127.0.0.1') === undefined);

// 8. Only storefront page navigations carry the cookies.
check('page GET with sec-fetch-dest=document → yes', isIdentityCookieRequest({ method: 'GET', pathname: '/products/x', secFetchDest: 'document' }));
check('page GET with Accept text/html (no sec-fetch headers) → yes', isIdentityCookieRequest({ method: 'GET', pathname: '/', accept: 'text/html,application/xhtml+xml' }));
check('API call → no', !isIdentityCookieRequest({ method: 'POST', pathname: '/api/meta/event', secFetchDest: 'empty' }));
check('fetch of a page (RSC / prefetch, not a document) → no', !isIdentityCookieRequest({ method: 'GET', pathname: '/products/x', secFetchDest: 'empty', accept: '*/*' }));
check('asset → no', !isIdentityCookieRequest({ method: 'GET', pathname: '/zb-logo-220px.png', secFetchDest: 'image' }));
check('admin page → no', !isIdentityCookieRequest({ method: 'GET', pathname: '/dashboard/orders', secFetchDest: 'document' }));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
