/**
 * Server-side (HTTP) identity cookies for Meta matching: _fbp, _fbc and
 * zb_external_id, minted and refreshed by middleware.ts on every storefront
 * page request — plus Snap's ScCid click id and _scid cookie, kept alive the
 * same way (Snap attributes clicks for 28 days; Safari would cap them at 24 h / 7 d).
 *
 * Why the server sets them: Safari's Intelligent Tracking Prevention caps cookies
 * written through document.cookie at 7 days, and at 24 hours when the page was
 * reached with link decoration such as `?fbclid=` — i.e. exactly the ad-click
 * sessions. Cookies set in an HTTP response are not capped, so the click id, the
 * browser id and the external id survive the full 90 / 365 days on iPhone too.
 * The client-side code keeps working unchanged and only fills gaps (it never
 * rewrites a value that is already present).
 *
 * Formats follow Meta's fbp/fbc spec: `fb.<subdomainIndex>.<creationTimeMs>.<value>`
 * with subdomainIndex 1 = the registrable domain the cookie is set on.
 *
 * Isomorphic and dependency-free (runs in the Edge runtime). Exported pure
 * functions are unit-tested in scripts/verify-meta-identity-cookies.ts.
 */

export const FBP_COOKIE = '_fbp';
export const FBC_COOKIE = '_fbc';
export const EXTERNAL_ID_COOKIE = 'zb_external_id';
/** Snapchat click id (`?ScCid=` on ad clicks) and Snap's own first-party cookie, kept alive the same way. */
export const SC_CLICK_ID_COOKIE = 'ScCid';
export const SCID_COOKIE = '_scid';

/** Meta recommends 90 days for _fbp / _fbc; the external id follows the client's 365 days. */
export const FBP_FBC_MAX_AGE_S = 90 * 24 * 60 * 60;
export const EXTERNAL_ID_MAX_AGE_S = 365 * 24 * 60 * 60;
/** Snap attributes clicks for up to 28 days; 90 days matches the client-side cookie. _scid lives 13 months. */
export const SC_CLICK_ID_MAX_AGE_S = 90 * 24 * 60 * 60;
export const SCID_MAX_AGE_S = 395 * 24 * 60 * 60;
/**
 * Unchanged values are re-set (full max-age, HTTP) at most this often, tracked by
 * a small HttpOnly marker cookie: well inside Safari's 24 h / 7 d caps, and no
 * Set-Cookie on most page responses (a CDN may refuse to cache a response that
 * carries one).
 */
export const IDENTITY_REFRESH_MARKER = 'zb_idc';
export const IDENTITY_REFRESH_INTERVAL_S = 12 * 60 * 60;

const FBP_RE = /^fb\.\d\.\d{10,13}\.\d+$/;
const FBC_RE = /^fb\.\d\.\d{10,13}\..+$/;
/** A click id as Meta issues it: URL-safe characters only, never modified. */
const FBCLID_RE = /^[A-Za-z0-9_-]{1,512}$/;
const EXTERNAL_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
/** A Snap click id / _scid value as Snap issues them (URL-safe, used verbatim). */
const SC_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export interface IdentityCookieInput {
  /** Current request cookies (raw values). */
  fbp?: string | null;
  fbc?: string | null;
  externalId?: string | null;
  /** `?fbclid=` from the request URL, if any. */
  fbclid?: string | null;
  /** Snap: current ScCid cookie, `?ScCid=` from the URL, and Snap's own _scid cookie. */
  scCid?: string | null;
  scClickParam?: string | null;
  scid?: string | null;
  nowMs: number;
  /** Random UUID source (crypto.randomUUID in the edge runtime). */
  uuid: () => string;
  /** Random digits for a new _fbp (Math.random in the edge runtime). */
  random?: () => number;
}

export interface IdentityCookie {
  name: string;
  value: string;
  maxAge: number;
  /** true when the value is new or changed; false = the same value refreshed. */
  changed: boolean;
}

export function isValidFbp(v: string | null | undefined): boolean {
  return !!v && FBP_RE.test(v);
}

export function isValidFbc(v: string | null | undefined): boolean {
  return !!v && FBC_RE.test(v) && v.length <= 600;
}

export function isValidFbclid(v: string | null | undefined): boolean {
  return !!v && FBCLID_RE.test(v);
}

/** `fb.1.<now>.<fbclid>` — the click id is used exactly as received (Meta: case-sensitive). */
export function fbcFromClickId(fbclid: string, nowMs: number): string {
  return `fb.1.${nowMs}.${fbclid}`;
}

/** `fb.1.<now>.<random>` — same shape the Pixel SDK writes; the Pixel adopts an existing _fbp. */
export function mintFbp(nowMs: number, random: () => number = Math.random): string {
  const digits = Math.floor(random() * 1e10).toString().padStart(10, '0');
  return `fb.1.${nowMs}.${digits}`;
}

/** Guest device id, same prefix the client code uses (`zb.` + UUID). */
export function mintExternalId(uuid: () => string): string {
  return `zb.${uuid()}`;
}

/**
 * Decide which identity cookies the response should carry. Every valid cookie is
 * refreshed (same value, full max-age) so that a value later rewritten by script
 * on Safari gets its HTTP lifetime back on the next page; missing ones are
 * minted; a new click id replaces an older one.
 */
export function planMetaIdentityCookies(input: IdentityCookieInput): IdentityCookie[] {
  const out: IdentityCookie[] = [];
  const { nowMs } = input;

  // _fbc: a fresh fbclid in the URL always wins; otherwise keep (and refresh) the stored one.
  const fbclid = input.fbclid && isValidFbclid(input.fbclid) ? input.fbclid : null;
  const existingFbc = isValidFbc(input.fbc) ? String(input.fbc) : null;
  if (fbclid && !(existingFbc && existingFbc.endsWith(`.${fbclid}`))) {
    out.push({ name: FBC_COOKIE, value: fbcFromClickId(fbclid, nowMs), maxAge: FBP_FBC_MAX_AGE_S, changed: true });
  } else if (existingFbc) {
    out.push({ name: FBC_COOKIE, value: existingFbc, maxAge: FBP_FBC_MAX_AGE_S, changed: false });
  }

  // _fbp: refresh when valid, mint when absent or malformed.
  if (isValidFbp(input.fbp)) {
    out.push({ name: FBP_COOKIE, value: String(input.fbp), maxAge: FBP_FBC_MAX_AGE_S, changed: false });
  } else {
    out.push({ name: FBP_COOKIE, value: mintFbp(nowMs, input.random), maxAge: FBP_FBC_MAX_AGE_S, changed: true });
  }

  // zb_external_id: refresh (a logged-in customer id too), mint for a new visitor.
  const ext = input.externalId && EXTERNAL_ID_RE.test(input.externalId) ? input.externalId : null;
  if (ext) {
    out.push({ name: EXTERNAL_ID_COOKIE, value: ext, maxAge: EXTERNAL_ID_MAX_AGE_S, changed: false });
  } else {
    out.push({ name: EXTERNAL_ID_COOKIE, value: mintExternalId(input.uuid), maxAge: EXTERNAL_ID_MAX_AGE_S, changed: true });
  }

  // ScCid: a fresh click id in the URL wins; otherwise refresh the stored one. Same
  // Safari reasoning as _fbc — the client-side cookie (lib/snapPixel.ts) is capped at
  // 24 h on exactly the ad-click landings that carry it.
  const scParam = input.scClickParam && SC_ID_RE.test(input.scClickParam) ? input.scClickParam : null;
  const existingSc = input.scCid && SC_ID_RE.test(input.scCid) ? input.scCid : null;
  if (scParam && scParam !== existingSc) {
    out.push({ name: SC_CLICK_ID_COOKIE, value: scParam, maxAge: SC_CLICK_ID_MAX_AGE_S, changed: true });
  } else if (existingSc) {
    out.push({ name: SC_CLICK_ID_COOKIE, value: existingSc, maxAge: SC_CLICK_ID_MAX_AGE_S, changed: false });
  }
  // _scid is written by Snap's own script (document.cookie, so Safari-capped); re-set
  // with its current value so sc_cookie1 keeps matching across the 7-day cliff.
  if (input.scid && SC_ID_RE.test(input.scid)) {
    out.push({ name: SCID_COOKIE, value: input.scid, maxAge: SCID_MAX_AGE_S, changed: false });
  }

  return out;
}

/**
 * Cookie `domain` attribute for a request host, matching lib/metaPixel.ts
 * setClientCookie exactly (so server and script write the SAME cookie):
 * the last two labels of the host (`zicabella.com`), none for localhost or an IP.
 */
export function identityCookieDomain(host: string | null | undefined): string | undefined {
  const h = String(host || '').split(':')[0].trim().toLowerCase();
  if (!h || h === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes('[')) return undefined;
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 2) return undefined;
  return parts.slice(-2).join('.');
}

/**
 * true for a top-level page navigation on the storefront — the only requests
 * that carry Set-Cookie for identity (API calls, prefetches and assets do not).
 */
export function isIdentityCookieRequest(opts: {
  method: string;
  pathname: string;
  secFetchDest?: string | null;
  accept?: string | null;
}): boolean {
  if (opts.method !== 'GET' && opts.method !== 'HEAD') return false;
  const p = opts.pathname.toLowerCase();
  if (p.startsWith('/api/') || p.startsWith('/_next/') || p.startsWith('/dashboard') || p.startsWith('/web-store') || p.startsWith('/admin')) return false;
  if (/\.(?:js|css|map|json|xml|txt|ico|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|mp4|webm)$/.test(p)) return false;
  if (opts.secFetchDest) return opts.secFetchDest === 'document';
  return !!opts.accept && opts.accept.includes('text/html');
}
