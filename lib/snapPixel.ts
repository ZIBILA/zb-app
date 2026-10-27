import { isPlaceholderEmailHash, isPlaceholderPhoneHash } from '@/lib/tracking/placeholder-identity';
import { DEMO_PHONE_HASHES } from '@/lib/buildMetaUserData';
import { normalizeIdentity, isSha256Hash, type RawIdentity } from '@/lib/tracking/identity-normalize';
import { resolveSnapPixelId } from '@/lib/snap/config';
import { isExcludedBrowser } from '@/lib/tracking/automation';

/** The pixel id in use ('' = Snap tracking is off on this deployment). See lib/snap/config.ts. */
const BUILD_SNAP_PIXEL_ID = resolveSnapPixelId();

/** The pixel id this page runs with: the request-time value app/layout.tsx wrote to window.__zbSnapPixelId, else the build-time one (same reasoning as lib/metaPixel.ts metaPixelId). */
export function snapPixelId(): string {
  if (typeof window !== 'undefined') {
    const v = (window as any).__zbSnapPixelId;
    if (typeof v === 'string') return v;
  }
  return BUILD_SNAP_PIXEL_ID;
}

/**
 * Defensive helper: ensures window.snaptr exists before calling the callback.
 * If snaptr isn't available yet (e.g. base pixel script still loading), retries
 * every 100ms for up to 3 seconds.
 */
export function withSnaptr(callback: (snaptr: any) => void, eventLabel = 'unknown'): void {
  if (typeof window === 'undefined') return;
  if (isExcludedBrowser()) return; // staff / QA / demo browser or WebDriver automation on the live site

  if ((window as any).snaptr) {
    callback((window as any).snaptr);
    return;
  }

  const MAX_RETRIES = 50; // 50 × 100ms = 5 seconds
  let attempt = 0;

  const retry = () => {
    attempt++;
    if ((window as any).snaptr) {
      callback((window as any).snaptr);
      return;
    }
    if (attempt >= MAX_RETRIES) {
      console.warn(`[Snap Pixel] snaptr never became available — event dropped: ${eventLabel}`);
      return;
    }
    setTimeout(retry, 100);
  };

  setTimeout(retry, 100);
}

export function setClientCookie(name: string, value: string, days: number) {
  if (typeof document === 'undefined') return;
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = "; expires=" + date.toUTCString();
  }

  let domainAttr = "";
  const hostname = window.location.hostname;
  if (!/^localhost$|^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      const root = parts.slice(-2).join('.');
      domainAttr = `; domain=.${root}`;
    }
  }

  document.cookie = name + "=" + (value || "") + expires + "; path=/" + domainAttr + "; SameSite=Lax; Secure";
}

export function getClientCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

/**
 * Capture Snapchat Click ID (ScCid/sccid) from URL search parameters and store in cookie.
 */
export function captureSnapClickId(): string | null {
  if (typeof window === 'undefined') return null;

  const urlParams = new URLSearchParams(window.location.search);
  const scCid = urlParams.get('ScCid') || urlParams.get('sccid') || urlParams.get('sc_click_id');
  if (scCid) {
    // middleware.ts already set this value as an HTTP cookie (full 90 days on Safari);
    // rewriting the same value from script would replace it with a 24 h-capped one.
    if (getClientCookie('ScCid') !== scCid) setClientCookie('ScCid', scCid, 90);
    return scCid;
  }
  return getClientCookie('ScCid');
}

/**
 * Read Snapchat identity cookies (_scid / ScCid) + first-party PII cookies.
 * NOTE: zb_guest_* cookies hold SHA-256 hashes (written by lib/metaPixel.ts).
 *
 * The hashed PII cookies are returned only when they belong to THIS visitor:
 * lib/metaPixel.ts binds them to the external_id that was current when they were
 * written (zb_pii_owner). A different external_id (next shopper on a shared
 * device, expired id cookie) or no binding at all means the details are someone
 * else's, so they are left out — the same rule getMetaIdentityCookies() and the
 * server relays apply. Snap's own ids (ScCid, _scid) are never PII and always pass.
 */
export function getSnapIdentityCookies(): Record<string, string | undefined> {
  const externalId = getClientCookie('zb_external_id') || undefined;
  const piiOwner = getClientCookie('zb_pii_owner') || undefined;
  const bound = !!(piiOwner && externalId && piiOwner === externalId);
  const own = (name: string) => (bound ? getClientCookie(name) || undefined : undefined);
  return {
    sc_click_id: getClientCookie('ScCid') || undefined,
    sc_cookie1: getClientCookie('_scid') || undefined,
    external_id: externalId,
    em: own('zb_guest_email'),
    ph: own('zb_guest_phone'),
    fn: own('zb_guest_fn'),
    ln: own('zb_guest_ln'),
    country: own('zb_guest_country'),
    st: own('zb_guest_st'),
    ct: own('zb_guest_ct'),
    zp: own('zb_guest_zp'),
  };
}

/**
 * Build Snap Pixel advanced-matching fields.
 *
 * The pixel documents hashed variants ONLY for email and phone
 * (user_hashed_email / user_hashed_phone_number). firstname / lastname / geo_*
 * are raw fields that the pixel hashes itself — feeding it our cookie HASHES
 * there would get hashed a second time and never match, so hashed cookie values
 * for those fields are left to CAPI (which accepts hashes for every field).
 *
 * Raw values (from checkout / order data passed as `raw`) are normalized with
 * the same worldwide rules as CAPI, so pixel and CAPI hash to identical values.
 */
export function buildPixelIdentity(raw?: RawIdentity): Record<string, string> {
  const out: Record<string, string> = {};
  const cookies = getSnapIdentityCookies();
  const n = normalizeIdentity(raw || {});

  // Email
  if (n.em && !isSha256Hash(n.em)) out.user_email = n.em;
  else if (n.em) out.user_hashed_email = n.em;
  else if (cookies.em && isSha256Hash(cookies.em) && !isPlaceholderEmailHash(cookies.em)) out.user_hashed_email = cookies.em.toLowerCase();

  // Phone (digits incl. country code, no "+")
  if (n.ph && !isSha256Hash(n.ph)) out.user_phone_number = n.ph;
  else if (n.ph) out.user_hashed_phone_number = n.ph;
  else if (cookies.ph && isSha256Hash(cookies.ph) && !DEMO_PHONE_HASHES.includes(cookies.ph.toLowerCase()) && !isPlaceholderPhoneHash(cookies.ph)) out.user_hashed_phone_number = cookies.ph.toLowerCase();

  // Raw-only fields
  const rawOnly: Array<[keyof RawIdentity, string]> = [
    ['fn', 'firstname'], ['ln', 'lastname'], ['ct', 'geo_city'],
    ['st', 'geo_region'], ['zp', 'geo_postal_code'], ['country', 'geo_country'],
  ];
  for (const [k, key] of rawOnly) {
    const v = n[k];
    if (v && !isSha256Hash(v)) out[key] = v;
  }
  return out;
}

/** Back-compat alias used by older call sites. */
export function buildBrowserIdentity(): Record<string, string> {
  return buildPixelIdentity();
}

let lastInitKey: string | null = null;

function initWithIdentity(snaptr: any, identity: Record<string, string>) {
  // Re-init only when the identity actually changed (avoids redundant init calls).
  const key = JSON.stringify(identity, Object.keys(identity).sort());
  if (key === lastInitKey) return;
  lastInitKey = key;
  snaptr('init', snapPixelId(), identity);
  if (typeof window !== 'undefined') (window as any).__snapPixelInitialized = true;
}

/**
 * Initialize Snap Pixel with advanced matching from cookies (+ optional raw PII).
 */
export const initSnapPixel = (raw?: RawIdentity) => {
  if (!snapPixelId()) return;
  withSnaptr((snaptr) => initWithIdentity(snaptr, buildPixelIdentity(raw)), 'init');
};

/**
 * Browser pixel event.
 *  - `params` use PIXEL names: price, currency, item_ids, item_category,
 *    number_items, transaction_id, search_string, description.
 *  - `dedupId` is sent as client_dedup_id and MUST equal the CAPI event_id.
 *  - `rawIdentity` = raw checkout/order PII to improve matching on this event.
 */
export const trackSnapClientEvent = (
  eventName: string,
  params: Record<string, any> = {},
  dedupId?: string,
  rawIdentity?: RawIdentity
) => {
  if (!snapPixelId()) return;
  withSnaptr((snaptr) => {
    initWithIdentity(snaptr, buildPixelIdentity(rawIdentity));
    const payload: Record<string, any> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      payload[k] = v;
    }
    if (dedupId) payload.client_dedup_id = dedupId;
    snaptr('track', eventName, payload);
  }, eventName);
};
