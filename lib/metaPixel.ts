import { normalizePhone, normalizeState, normalizeZip, normalizeCountry, normalizeIdentity, normalizeName, normalizeCity, isSha256Hash } from '@/lib/tracking/identity-normalize';
import { isPlaceholderEmail, isPlaceholderPhone, isPlaceholderName } from '@/lib/tracking/placeholder-identity';
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID || '2049977412558608';

/**
 * Demo/test account values that must NEVER be sent to Meta Pixel or CAPI.
 * These are checked pre-hash (raw values) to prevent the same deterministic
 * hash from appearing across many distinct external_id/fbp pairs, which
 * triggers Meta's "duplicate client email/phone" warning.
 */
export const DEMO_PHONES_RAW = [
  // Current demo login (format-valid Indian mobile — Shiprocket-safe)
  '919876543210', '9876543210', '+919876543210',
  // Legacy demo number (keep blocked from Meta)
  '919999999999', '9999999999', '+919999999999',
];
export const DEMO_EMAILS_RAW = ['demo@zicabella.com', 'demo@example.com'];
export const DEMO_NAMES_RAW = ['demo user'];

/** Check if a raw (pre-hash) value matches a known demo/test account. */
export function isDemoValue(field: 'phone' | 'email' | 'name', rawValue: string | undefined | null): boolean {
  if (!rawValue) return false;
  const cleaned = rawValue.trim().toLowerCase().replace(/[\s+\-()]/g, '');
  if (!cleaned) return false;
  switch (field) {
    case 'phone': {
      const digits = cleaned.replace(/\D/g, '');
      return isPlaceholderPhone(rawValue)
        || DEMO_PHONES_RAW.some(d => digits === d.replace(/\D/g, '') || digits.endsWith(d.replace(/\D/g, '')));
    }
    case 'email':
      // Demo accounts + synthetic placeholders (guest@…, guest_<ts>@…, recovered_<ts>@…).
      return DEMO_EMAILS_RAW.includes(cleaned) || isPlaceholderEmail(rawValue);
    case 'name':
      // Demo accounts + placeholder names ('Customer', 'Valued Customer', 'Guest' …).
      return DEMO_NAMES_RAW.includes(cleaned) || isPlaceholderName(rawValue);
  }
}

/**
 * Defensive helper: ensures window.fbq exists before calling the callback.
 * If fbq isn't available yet (e.g. base pixel script still loading), retries
 * every 100ms for up to 3 seconds. After 3s, logs a visible warning instead
 * of silently dropping the event.
 */
export function withFbq(callback: (fbq: any) => void, eventLabel = 'unknown'): void {
  if (typeof window === 'undefined') return;

  if ((window as any).fbq) {
    callback((window as any).fbq);
    return;
  }

  const MAX_RETRIES = 30; // 30 × 100ms = 3 seconds
  let attempt = 0;

  const retry = () => {
    attempt++;
    if ((window as any).fbq) {
      callback((window as any).fbq);
      return;
    }
    if (attempt >= MAX_RETRIES) {
      console.warn(`[Meta Pixel] fbq never became available — event dropped: ${eventLabel}`);
      return;
    }
    setTimeout(retry, 100);
  };

  setTimeout(retry, 100);
}

export const pageview = () => {
  withFbq((fbq) => {
    fbq('track', 'PageView');
  }, 'PageView');
};

export function setClientCookie(name: string, value: string, days: number) {
  if (typeof document === 'undefined') return;
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = "; expires=" + date.toUTCString();
  }

  // Set cookie on root domain if possible so subdomains (e.g. www, checkout) can share it
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

/** Delete a cookie by setting max-age=0 on the same domain/path. */
export function deleteClientCookie(name: string) {
  if (typeof document === 'undefined') return;
  // Must set on root domain to match how setClientCookie works
  let domainAttr = "";
  const hostname = window.location.hostname;
  if (!/^localhost$|^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      const root = parts.slice(-2).join('.');
      domainAttr = `; domain=.${root}`;
    }
  }
  document.cookie = `${name}=; max-age=0; path=/${domainAttr}; SameSite=Lax; Secure`;
}

/**
 * Clear all guest PII cookies. Called on logout to prevent stale identity
 * data from one user leaking into another user's Meta events on shared devices.
 */
export function clearGuestPiiCookies() {
  const piiCookieNames = [
    'zb_guest_email', 'zb_guest_phone', 'zb_guest_fn', 'zb_guest_ln',
    'zb_guest_country', 'zb_guest_st', 'zb_guest_ct', 'zb_guest_zp',
    'zb_guest_dob', 'zb_fb_login_id', 'zb_pii_owner',
  ];
  for (const name of piiCookieNames) {
    deleteClientCookie(name);
  }
}

/**
 * Reset guest identity after a guest checkout completes.
 * Clears all PII cookies, deletes the PII owner binding, and rotates
 * the external_id to a fresh UUID so the next guest on this device
 * gets a completely distinct identity.
 */
/**
 * Rotate the guest identity after a purchase so the NEXT shopper on a shared
 * device gets a fresh external_id and no stale PII. Skipped when the identity is
 * a logged-in customer id (stable per person), so repeat buyers are not turned
 * into "new people" on every order.
 */
export function resetGuestIdentity() {
  const current = getClientCookie('zb_external_id') || '';
  if (current && !current.startsWith('zb.')) return; // customer id, not a device id
  clearGuestPiiCookies();
  // Rotate external_id so the next guest gets a fresh identity
  const newExtId = 'zb.' + (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }));
  setClientCookie('zb_external_id', newExtId, 365);
}

export async function sha256(message: string): Promise<string> {
  const cleaned = message.trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(cleaned)) {
    return cleaned;
  }
  const msgBuffer = new TextEncoder().encode(cleaned);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
 * Reads all Meta identity cookies from the browser for CAPI event enrichment.
 * Includes fbc (Click ID), fbp (Browser ID), external_id, and all hashed PII cookies.
 * Used by useMetaEvents and MetaPixelRouteTracker to ensure every CAPI call
 * carries maximum user identity data for optimal Event Match Quality.
 */
export function getMetaIdentityCookies(): Record<string, string | undefined> {
  const extId = getClientCookie('zb_external_id') || undefined;
  const piiOwner = getClientCookie('zb_pii_owner') || undefined;

  // If the PII cookies were written by a different identity (external_id),
  // omit all PII fields to prevent stale data from one guest leaking into
  // another guest's Meta events on the same device.
  const piiMatch = !!(piiOwner && extId && piiOwner === extId);

  return {
    fbc: getClientCookie('_fbc') || undefined,
    fbp: getClientCookie('_fbp') || undefined,
    external_id: extId,
    em: piiMatch ? (getClientCookie('zb_guest_email') || undefined) : undefined,
    ph: piiMatch ? (getClientCookie('zb_guest_phone') || undefined) : undefined,
    fn: piiMatch ? (getClientCookie('zb_guest_fn') || undefined) : undefined,
    ln: piiMatch ? (getClientCookie('zb_guest_ln') || undefined) : undefined,
    country: piiMatch ? (getClientCookie('zb_guest_country') || undefined) : undefined,
    st: piiMatch ? (getClientCookie('zb_guest_st') || undefined) : undefined,
    ct: piiMatch ? (getClientCookie('zb_guest_ct') || undefined) : undefined,
    zp: piiMatch ? (getClientCookie('zb_guest_zp') || undefined) : undefined,
    fb_login_id: getClientCookie('zb_fb_login_id') || undefined,
    db: piiMatch ? (getClientCookie('zb_guest_dob') || undefined) : undefined,
    client_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };
}

import { buildClientUserData } from '@/lib/buildMetaUserData';


/** Keys that fbq('init') accepts as Advanced Matching (plus external_id / fb_login_id passthrough). */
const AM_KEYS = ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'ge', 'db'] as const;

/**
 * Normalize raw Advanced Matching values to Meta's spec (same rules as the server),
 * drop demo / placeholder values and anything that normalizes to empty. Already-hashed
 * values pass through unchanged.
 */
export function normalizeAdvancedMatching(raw: Record<string, any> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const n = normalizeIdentity({
    em: isDemoValue('email', str(raw.em)) ? '' : str(raw.em),
    ph: isDemoValue('phone', str(raw.ph)) ? '' : str(raw.ph),
    fn: isDemoValue('name', str(raw.fn)) ? '' : str(raw.fn),
    ln: isDemoValue('name', str(raw.ln)) ? '' : str(raw.ln),
    ct: str(raw.ct), st: str(raw.st), zp: str(raw.zp), country: str(raw.country),
  });
  for (const k of AM_KEYS) {
    if (k === 'ge' || k === 'db') {
      const v = str(raw[k]);
      if (v) out[k] = isSha256Hash(v) ? v.toLowerCase() : v.toLowerCase().replace(/[^a-z0-9]/g, '');
      continue;
    }
    if (n[k]) out[k] = n[k];
  }
  if (str(raw.external_id)) out.external_id = str(raw.external_id);
  if (str(raw.fb_login_id)) out.fb_login_id = str(raw.fb_login_id);
  return out;
}

// Module-level guard to prevent redundant fbq('init') calls with identical data.
// The layout.tsx inline script does the first init WITH the identity already in
// cookies (window.__zbMetaAM). Re-init is valid Meta usage (Meta's own GTM template
// re-inits with Advanced Matching); this only re-inits when the data changes.
let lastInitHash: string | null = null;

export const initPixel = (additionalData: Record<string, any> = {}) => {
  withFbq((fbq) => {
    if (lastInitHash === null && typeof window !== 'undefined') {
      const baseAM = (window as any).__zbMetaAM;
      if (baseAM && typeof baseAM === 'object') {
        lastInitHash = JSON.stringify(baseAM, Object.keys(baseAM).sort());
      }
    }
    // Build advanced matching user data for fbq('init') using the unified builder.
    // NOTE: fbc, fbp, and client_user_agent are NOT passed here — the pixel SDK reads them
    // directly from the cookies/browser. Passing them in init is unsupported or redundant.
    const rawIdentity = getMetaIdentityCookies();
    const builtIdentity = buildClientUserData(rawIdentity);
    const { fbc, fbp, client_user_agent, ...userData } = builtIdentity;

    // Raw values handed in by a call site (checkout address, confirmation order) are
    // normalized to Meta's Advanced Matching spec before they reach fbq('init'):
    // phone = digits with country code, 2-letter lowercase country, state / zip /
    // city / name rules per country — the SAME rules the server CAPI event uses,
    // so the browser and server copies of a deduplicated event carry one identity.
    // Values that normalize to nothing (unknown, placeholder, demo) are omitted.
    const merged: Record<string, any> = { ...userData, ...normalizeAdvancedMatching(additionalData) };

    // Dedup guard: skip fbq('init') if the merged userData is identical to last call.
    // This prevents the "Duplicate Pixel ID" warning from fbevents.js.
    const currentHash = JSON.stringify(merged, Object.keys(merged).sort());
    if (currentHash === lastInitHash) {
      return; // Data unchanged — skip redundant init
    }
    lastInitHash = currentHash;

    fbq('init', META_PIXEL_ID, merged);
  }, 'init');
};

/**
 * Name / city for hashing — Meta's rule (lowercase, letters and digits only, unicode
 * kept). The old ASCII-only version turned "José" into "jos" and any non-Latin name
 * into "" (a hash of the empty string shared by thousands of users).
 */
function cleanStringNoSpaces(val: string | undefined): string {
  return normalizeName(val);
}

/**
 * Country name/code → ISO alpha-2 lowercase. Worldwide-safe:
 * "United Kingdom" → "gb" (old code produced "un"), "Germany" → "de" (was "ge").
 * Returns "" when the country can't be resolved, so no wrong value is hashed.
 */
export function cleanCountry(country: string | undefined): string {
  return normalizeCountry(country);
}

export async function saveUserDataToCookies(data: {
  email?: string;
  phone?: string;
  name?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  fbLoginId?: string;
  dob?: string;
}) {
  if (typeof window === 'undefined') return;

  // Only write PII cookies if we have a valid external_id to bind them to.
  // This prevents orphaned PII that can't be identity-matched later.
  const currentExtId = getClientCookie('zb_external_id');
  if (!currentExtId) return;

  if (data.email && !isDemoValue('email', data.email)) {
    const hashedEmail = await sha256(data.email.trim().toLowerCase());
    setClientCookie('zb_guest_email', hashedEmail, 365);
  }
  if (data.phone && !isDemoValue('phone', data.phone)) {
    // Worldwide: digits incl. the CUSTOMER's country calling code (not always 91).
    const formattedPhone = normalizePhone(data.phone, data.country);
    if (formattedPhone) {
      const hashedPhone = await sha256(formattedPhone);
      setClientCookie('zb_guest_phone', hashedPhone, 365);
    }
  }
  if (data.name && !isDemoValue('name', data.name)) {
    const parts = data.name.trim().split(/\s+/);
    const fnNorm = cleanStringNoSpaces(parts[0]);
    if (fnNorm) setClientCookie('zb_guest_fn', await sha256(fnNorm), 365);
    const lnNorm = parts.length > 1 ? cleanStringNoSpaces(parts.slice(1).join('')) : '';
    if (lnNorm) setClientCookie('zb_guest_ln', await sha256(lnNorm), 365);
  }
  if (data.city) {
    const ctNorm = normalizeCity(data.city);
    if (ctNorm) setClientCookie('zb_guest_ct', await sha256(ctNorm), 365);
  }
  if (data.state) {
    const st = normalizeState(data.state, data.country);
    if (st) setClientCookie('zb_guest_st', await sha256(st), 365);
  }
  if (data.zip) {
    const zp = normalizeZip(data.zip, data.country);
    if (zp) setClientCookie('zb_guest_zp', await sha256(zp), 365);
  }
  if (data.country) {
    const c = cleanCountry(data.country);
    if (c) setClientCookie('zb_guest_country', await sha256(c), 365);
  }
  if (data.fbLoginId) {
    setClientCookie('zb_fb_login_id', data.fbLoginId.trim(), 365); // Do NOT hash fb_login_id
  }
  if (data.dob) {
    const cleanDob = data.dob.replace(/\D/g, "").slice(0, 8);
    if (cleanDob.length === 8) {
      const hashedDob = await sha256(cleanDob);
      setClientCookie('zb_guest_dob', hashedDob, 365);
    }
  }

  // Bind PII cookies to the current identity so getMetaIdentityCookies()
  // can verify ownership before reusing them for a different visitor.
  setClientCookie('zb_pii_owner', currentExtId, 365);
}

export async function saveUserDataToCookiesAndReinit(data: {
  email?: string;
  phone?: string;
  name?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  fbLoginId?: string;
  dob?: string;
}) {
  await saveUserDataToCookies(data);
  initPixel();
}


type FbqEventName =
  | 'AddPaymentInfo'
  | 'AddToCart'
  | 'AddToWishlist'
  | 'CompleteRegistration'
  | 'Contact'
  | 'FindLocation'
  | 'InitiateCheckout'
  | 'Lead'
  | 'Purchase'
  | 'Schedule'
  | 'Search'
  | 'StartTrial'
  | 'Subscribe'
  | 'ViewContent';

export const trackEvent = (
  eventName: FbqEventName,
  params: Record<string, any> = {},
  eventId?: string
) => {
  withFbq((fbq) => {
    const options: Record<string, any> = {};
    if (eventId) options.eventID = eventId;
    
    const testCode = process.env.NEXT_PUBLIC_META_TEST_EVENT_CODE;
    if (testCode) {
      options.test_event_code = testCode;
    }
    
    fbq('track', eventName, params, options);
  }, eventName);
};
