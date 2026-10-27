import crypto from 'crypto';
import { graphUrl, validateTokenFormat, validatePixelIdFormat } from './metaErrors';
import { fetchMetaApi } from './metaApiLogger';
import {
  toCountryIso,
  normalizeEmail as sharedNormalizeEmail,
  normalizePhone as sharedNormalizePhone,
  normalizeName as sharedNormalizeName,
  normalizeCity as sharedNormalizeCity,
  normalizeState as sharedNormalizeState,
  normalizeZip as sharedNormalizeZip,
  normalizeCountry as sharedNormalizeCountry,
} from './tracking/identity-normalize';
import {
  isPlaceholderEmail, isPlaceholderEmailHash, isPlaceholderPhone, isPlaceholderPhoneHash, isPlaceholderNamePart, isPlaceholderNameHash, isPlaceholderZipHash,
} from './tracking/placeholder-identity';

import { resolveMetaServerPixelId, metaPixelIdProblem, isMetaProductionSite } from './meta/config';
import { ldUFields } from './meta/consent';

// '' when Meta tracking is off on this deployment (see lib/meta/config.ts): every
// send is then skipped with a logged alert instead of feeding the live dataset.
const PIXEL_ID = resolveMetaServerPixelId();
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN!;

// Once per process in production: a browser/server pixel-id mismatch silently
// breaks Pixel↔CAPI deduplication, so say so where the operators look.
if (process.env.NODE_ENV === 'production') {
  const problem = metaPixelIdProblem();
  if (problem) console.error('[Meta CAPI][ALERT] pixel configuration:', problem);
}
// META_TEST_EVENT_CODE turns every CAPI event into an Events Manager "test event":
// Meta shows it in the Test Events tab and never counts it for ads reporting or
// optimisation. Left set on the live site it would silently void every real
// conversion — and the ledger would still mark each Purchase as sent, so those
// sales could never be re-sent once the code was removed. It is therefore
// honoured only off the live site (dev / staging / preview builds).
const TEST_EVENT_CODE_RAW = (process.env.META_TEST_EVENT_CODE || '').trim();
const TEST_CODE_ON_LIVE_SITE = !!TEST_EVENT_CODE_RAW && process.env.NODE_ENV === 'production' && isMetaProductionSite();
const TEST_EVENT_CODE = TEST_EVENT_CODE_RAW && !TEST_CODE_ON_LIVE_SITE ? TEST_EVENT_CODE_RAW : '';
if (TEST_CODE_ON_LIVE_SITE) {
  console.error('[Meta CAPI][ALERT] META_TEST_EVENT_CODE is set on the live site and is IGNORED: a test code would turn every real conversion into a test event. Unset it, or test from a staging deployment.');
}

/**
 * Compute the reported value for Meta events. Returns full real value for all events.
 */
export function getReportedValue(eventName: string, realValue: number | undefined): number | undefined {
  if (realValue === undefined || realValue === null) return undefined;
  return realValue;
}

/**
 * Dev-only validation: warn if value/currency is missing or suspicious
 * before sending Purchase, InitiateCheckout, or Subscribe events.
 * Logs are server-side only — never sent to Meta or the client.
 */
function validateEventPayload(eventName: string, customData: Record<string, any> | undefined): void {
  if (process.env.NODE_ENV === 'production' && !process.env.META_TEST_EVENT_CODE) return;

  const eventsRequiringValue = ['Purchase', 'InitiateCheckout'];
  if (!eventsRequiringValue.includes(eventName)) return;

  const value = customData?.value;
  const currency = customData?.currency;

  if (value === undefined || value === null || value === 0) {
    console.warn(`[Meta CAPI VALIDATION] ⚠️ ${eventName} event has null/zero value — this will degrade Meta reporting. value=${value}`);
  }
  if (!currency || typeof currency !== 'string' || currency.length !== 3) {
    console.warn(`[Meta CAPI VALIDATION] ⚠️ ${eventName} event has missing/invalid currency — expected ISO 4217 3-letter code. currency=${currency}`);
  }
}

export interface CapiEventPayload {
  eventName: string;
  eventTime?: number;
  eventSourceUrl: string;
  eventId: string;
  userAgent: string;
  userData?: {
    country?: string;        // lowercase 2-letter ISO, hashed before sending
    st?: string;             // state/county lowercase, hashed before sending
    ge?: string;             // gender: m or f, hashed before sending
    ct?: string;             // city lowercase, hashed before sending
    zp?: string;             // zip code, hashed before sending
    fn?: string;             // first name, hashed before sending
    ln?: string;             // last name, hashed before sending
    client_user_agent?: string;
    client_ip_address?: string;
    fbp?: string;
    fbc?: string;
    /** Several distinct values may be sent (Meta matches on each): cookie hash + account + typed address. */
    em?: string | string[];
    ph?: string | string[];
    external_id?: string | string[];
    fb_login_id?: string;
    db?: string;             // DOB (YYYYMMDD), hashed before sending
  };
  customData?: Record<string, any>;
  actionSource?: 'website' | 'app' | 'email' | 'phone_call' | 'physical_store' | 'system_generated' | 'other';
}

function isHash(val: string | undefined): boolean {
  if (!val) return false;
  return /^[a-f0-9]{64}$/.test(val.trim().toLowerCase());
}

function cleanAndHash(val: string | undefined, normalizer: (v: string) => string): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();
  if (isHash(trimmed)) {
    return trimmed.toLowerCase();
  }
  const normalized = normalizer(trimmed);
  if (!normalized) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Worldwide normalization — one implementation shared with the browser cookie path
// (lib/tracking/identity-normalize). Country-dependent fields use the event's own
// country, never an assumed India prefix (except a bare number with no country).
const normalizeGeneric = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeDob = (d: string) => d.trim().replace(/\D/g, "");

let metaConfigWarned = false;

/**
 * Why server-side Meta events cannot be sent right now (missing / malformed
 * META_CAPI_ACCESS_TOKEN or pixel id), or null when the configuration is usable.
 * A configuration problem is an operational failure, not a reason to drop a
 * conversion: the Purchase ledger checks this BEFORE claiming a delivery so the
 * conversion stays retryable (lib/meta/purchase.ts).
 */
export function metaCapiConfigError(): string | null {
  return validateTokenFormat(ACCESS_TOKEN) || validatePixelIdFormat(PIXEL_ID) || null;
}

export async function sendCapiEvent(payload: CapiEventPayload): Promise<{ success: boolean; data?: any; error?: any; fbtrace_id?: string; skipped?: boolean }> {
  // Pre-request validation — missing local Meta env is common in dev; skip quietly
  const tokenErr = validateTokenFormat(ACCESS_TOKEN);
  if (tokenErr) {
    if (!metaConfigWarned && (process.env.META_DEBUG === '1' || process.env.NODE_ENV === 'production')) {
      metaConfigWarned = true;
      console.error('[Meta CAPI][ALERT] events not sent: META_CAPI_ACCESS_TOKEN missing or malformed');
    }
    return { success: false, skipped: true, error: tokenErr };
  }

  const pixelErr = validatePixelIdFormat(PIXEL_ID);
  if (pixelErr) {
    if (!metaConfigWarned && (process.env.META_DEBUG === '1' || process.env.NODE_ENV === 'production')) {
      metaConfigWarned = true;
      console.error('[Meta CAPI][ALERT] events not sent: META_PIXEL_ID missing or malformed');
    }
    return { success: false, skipped: true, error: pixelErr };
  }

  // Validate event time
  const eventTime = payload.eventTime ?? Math.floor(Date.now() / 1000);
  const now = Math.floor(Date.now() / 1000);
  if (eventTime < now - 7 * 24 * 60 * 60 || eventTime > now + 24 * 60 * 60) {
    console.warn('[Meta CAPI] Event time is out of valid range (older than 7 days or in future):', eventTime);
  }

  // Clean custom data — strip undefined or null values
  const cleanedCustomData: Record<string, any> = {};
  if (payload.customData) {
    for (const [key, val] of Object.entries(payload.customData)) {
      if (val !== undefined && val !== null && val !== '') {
        cleanedCustomData[key] = val;
      }
    }
  }

  // Build user_data with correct hashing and normalization
  const userData: Record<string, any> = {
    client_user_agent: payload.userAgent || undefined,
  };

  if (payload.userData) {
    if (payload.userData.client_user_agent) userData.client_user_agent = payload.userData.client_user_agent;
    if (payload.userData.client_ip_address) userData.client_ip_address = payload.userData.client_ip_address;
    if (payload.userData.fbp) userData.fbp = payload.userData.fbp;
    if (payload.userData.fbc) userData.fbc = payload.userData.fbc;
    
    // Hash PII fields. Country is resolved first: phone, state and zip depend on it.
    const rawCountry = payload.userData.country;
    const countryIso = rawCountry && !isHash(rawCountry) ? toCountryIso(rawCountry) : '';
    const toList = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is string => typeof x === 'string' && !!x.trim());
    const hashAll = (vals: (string | undefined)[], normalizer: (v: string) => string): string[] =>
      Array.from(new Set(vals.map(v => cleanAndHash(v, normalizer)).filter((h): h is string => !!h)));
    // Synthetic placeholders (guest@zicabella.com, guest_<ts>@…) are never a customer identity.
    const emSafeList = toList(payload.userData.em).map(emRaw => (isHash(emRaw) ? !isPlaceholderEmailHash(emRaw) : !isPlaceholderEmail(emRaw)) ? emRaw : undefined);
    const emList = hashAll(emSafeList, sharedNormalizeEmail);
    const em = emList[0];
    // Dummy phones and placeholder names ('Customer', 'Valued Customer', 'Guest' …) are never sent.
    const phSafeList = toList(payload.userData.ph).map(phRaw => (isHash(phRaw) ? isPlaceholderPhoneHash(phRaw) : isPlaceholderPhone(phRaw)) ? undefined : phRaw);
    const phList = hashAll(phSafeList, (p) => sharedNormalizePhone(p, countryIso));
    const ph = phList[0];
    const nameSafe = (v: string | undefined) => (v && (isHash(v) ? isPlaceholderNameHash(v) : isPlaceholderNamePart(v)) ? undefined : v);
    const fn = cleanAndHash(nameSafe(payload.userData.fn), sharedNormalizeName);
    const ln = cleanAndHash(nameSafe(payload.userData.ln), sharedNormalizeName);
    const country = cleanAndHash(rawCountry, sharedNormalizeCountry);
    const st = cleanAndHash(payload.userData.st, (v) => sharedNormalizeState(v, countryIso));
    const ct = cleanAndHash(payload.userData.ct, sharedNormalizeCity);
    const zpRaw = payload.userData.zp;
    const zp = cleanAndHash(zpRaw && isHash(zpRaw) && isPlaceholderZipHash(zpRaw) ? undefined : zpRaw, (v) => sharedNormalizeZip(v, countryIso));
    const ge = cleanAndHash(payload.userData.ge, normalizeGeneric);
    const db = cleanAndHash(payload.userData.db, normalizeDob);

    // Every distinct normalized hash is sent: Meta matches on each one, and a shopper's
    // account email / phone often differs from the one typed at checkout.
    if (em) userData.em = emList;
    if (ph) userData.ph = phList;
    if (fn) userData.fn = [fn];
    if (ln) userData.ln = [ln];
    if (country) userData.country = [country];
    if (st) userData.st = [st];
    if (ct) userData.ct = [ct];
    if (zp) userData.zp = [zp];
    if (ge) userData.ge = [ge];
    if (db) userData.db = [db];

    // Hash every external_id with SHA-256 (Meta accepts a list): the customer id and
    // the device id together let Meta join a shopper's pre-login funnel to the Purchase.
    const extIds = Array.from(new Set(toList(payload.userData.external_id).map(raw => {
      const rawExtId = raw.trim();
      return /^[a-f0-9]{64}$/.test(rawExtId.toLowerCase())
        ? rawExtId.toLowerCase()
        : crypto.createHash('sha256').update(rawExtId.toLowerCase()).digest('hex');
    })));
    if (extIds.length) userData.external_id = extIds;
    if (payload.userData.fb_login_id) {
      userData.fb_login_id = payload.userData.fb_login_id.trim();
    }
  }

  // Clean empty fields from userData — ensure no key with empty/falsy content
  const cleanedUserData: Record<string, any> = {};
  for (const [key, val] of Object.entries(userData)) {
    if (val === undefined || val === null || val === '') continue;
    // Drop arrays that are empty or contain only empty strings
    if (Array.isArray(val)) {
      const filtered = val.filter((v: any) => v !== undefined && v !== null && v !== '');
      if (filtered.length > 0) {
        cleanedUserData[key] = filtered;
      }
      continue;
    }
    cleanedUserData[key] = val;
  }

  // Dev-only assertion: if the upstream userData had no em/ph, verify the key
  // is fully absent from cleanedUserData (not present as an empty array/string).
  if (process.env.NODE_ENV !== 'production' || process.env.META_TEST_EVENT_CODE) {
    for (const piiKey of ['em', 'ph'] as const) {
      if (!payload.userData?.[piiKey] && piiKey in cleanedUserData) {
        console.warn(
          `[Meta CAPI ASSERTION] ⚠️ "${piiKey}" key is present in cleanedUserData despite upstream having no value. ` +
          `This should never happen. Value:`, cleanedUserData[piiKey]
        );
        delete cleanedUserData[piiKey];
      }
    }
  }

  // Run dev-only validation before sending
  validateEventPayload(payload.eventName, cleanedCustomData);

  // Dev-only: log reported value for Purchase and InitiateCheckout events
  if (['Purchase', 'InitiateCheckout'].includes(payload.eventName) && cleanedCustomData.value !== undefined) {
    if (process.env.NODE_ENV !== 'production' || process.env.META_TEST_EVENT_CODE) {
      console.log(`[Meta CAPI DEBUG] ${payload.eventName} — reportedValue=${cleanedCustomData.value}, currency=${cleanedCustomData.currency || 'NOT SET'}`);
    }
  }

  const body: Record<string, any> = {
    data: [
      {
        event_name: payload.eventName,
        event_time: eventTime,
        event_source_url: payload.eventSourceUrl,
        event_id: payload.eventId,
        action_source: payload.actionSource ?? 'website',
        user_data: cleanedUserData,
        ...(Object.keys(cleanedCustomData).length > 0 ? { custom_data: cleanedCustomData } : {}),
        // Limited Data Use when NEXT_PUBLIC_META_LDU=1 (Meta applies it by the visitor's location).
        ...ldUFields(),
      },
    ],
  };

  if (TEST_EVENT_CODE) {
    body.test_event_code = TEST_EVENT_CODE;
  }

  // The token travels in the POST body (Meta accepts it there), never in the URL,
  // so no proxy, access log or error trace ever sees it.
  body.access_token = ACCESS_TOKEN;
  const url = graphUrl(`/${PIXEL_ID}/events`);

  try {
    const { data: resJson, logEntry } = await fetchMetaApi(url, {
      method: 'POST',
      body,
      label: `POST /${PIXEL_ID}/events [${payload.eventName}]`,
    });

    if (!logEntry.success) {
      // Structured, PII-free rejection log: which event, which id, Meta's reason + trace id.
      const e = (resJson as any)?.error || {};
      console.error('[Meta CAPI Rejected]', JSON.stringify({
        event: payload.eventName,
        event_id: payload.eventId,
        code: e.code,
        subcode: e.error_subcode,
        type: e.type,
        message: typeof e.message === 'string' ? e.message.slice(0, 300) : undefined,
        user_msg: typeof e.error_user_msg === 'string' ? e.error_user_msg.slice(0, 300) : undefined,
        fbtrace_id: logEntry.fbtrace_id || e.fbtrace_id,
      }));
      return {
        success: false,
        error: resJson,
        fbtrace_id: logEntry.fbtrace_id,
      };
    }

    return {
      success: true,
      data: resJson,
      fbtrace_id: logEntry.fbtrace_id,
    };
  } catch (err: any) {
    console.error('[Meta CAPI Network Error]', JSON.stringify({ event: payload.eventName, event_id: payload.eventId, message: err?.message || 'Fetch failed' }));
    return { success: false, error: err.message || 'Fetch failed' };
  }
}
