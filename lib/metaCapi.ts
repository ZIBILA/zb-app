import crypto from 'crypto';
import { graphUrl, validateTokenFormat, validatePixelIdFormat } from './metaErrors';
import { fetchMetaApi } from './metaApiLogger';

const PIXEL_ID = process.env.META_PIXEL_ID || process.env.NEXT_PUBLIC_META_PIXEL_ID || '2049977412558608';
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN!;
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE;

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
    em?: string;
    ph?: string;
    external_id?: string;
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

const normalizePhone = (p: string) => {
  const digits = p.replace(/\D/g, "");
  let base = digits;
  if (digits.length === 12 && digits.startsWith("91")) base = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) base = digits.slice(1);
  return `91${base}`;
};

const normalizeCountry = (c: string) => {
  const clean = c.trim().toLowerCase();
  if (clean === 'india' || clean === 'ind' || clean === 'in') return 'in';
  if (clean === 'united states' || clean === 'usa' || clean === 'us' || clean === 'united states of america') return 'us';
  return clean.replace(/[^a-z]/g, '').slice(0, 2);
};

const normalizeGeneric = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeEmail = (e: string) => e.trim().toLowerCase();
const normalizeDob = (d: string) => d.trim().replace(/\D/g, "");

export async function sendCapiEvent(payload: CapiEventPayload): Promise<{ success: boolean; data?: any; error?: any; fbtrace_id?: string }> {
  // Pre-request validation
  const tokenErr = validateTokenFormat(ACCESS_TOKEN);
  if (tokenErr) {
    console.error('[Meta CAPI] Token validation failed:', tokenErr);
    console.error('[Meta CAPI CONFIG ERROR]', tokenErr, '— check DigitalOcean App Platform env vars');
    return { success: false, error: tokenErr };
  }

  const pixelErr = validatePixelIdFormat(PIXEL_ID);
  if (pixelErr) {
    console.error('[Meta CAPI] Pixel ID validation failed:', pixelErr);
    console.error('[Meta CAPI CONFIG ERROR]', pixelErr, '— check DigitalOcean App Platform env vars');
    return { success: false, error: pixelErr };
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
    
    // Hash PII fields
    const em = cleanAndHash(payload.userData.em, normalizeEmail);
    const ph = cleanAndHash(payload.userData.ph, normalizePhone);
    const fn = cleanAndHash(payload.userData.fn, normalizeGeneric);
    const ln = cleanAndHash(payload.userData.ln, normalizeGeneric);
    const country = cleanAndHash(payload.userData.country, normalizeCountry);
    const st = cleanAndHash(payload.userData.st, normalizeGeneric);
    const ct = cleanAndHash(payload.userData.ct, normalizeGeneric);
    const zp = cleanAndHash(payload.userData.zp, normalizeGeneric);
    const ge = cleanAndHash(payload.userData.ge, normalizeGeneric);
    const db = cleanAndHash(payload.userData.db, normalizeDob);

    if (em) userData.em = [em];
    if (ph) userData.ph = [ph];
    if (fn) userData.fn = [fn];
    if (ln) userData.ln = [ln];
    if (country) userData.country = [country];
    if (st) userData.st = [st];
    if (ct) userData.ct = [ct];
    if (zp) userData.zp = [zp];
    if (ge) userData.ge = [ge];
    if (db) userData.db = [db];

    // Hash external_id with SHA-256 as Meta requires for proper matching
    if (payload.userData.external_id) {
      const rawExtId = payload.userData.external_id.trim();
      // If already hashed (64-char hex), use as-is; otherwise hash it
      if (/^[a-f0-9]{64}$/.test(rawExtId.toLowerCase())) {
        userData.external_id = [rawExtId.toLowerCase()];
      } else {
        userData.external_id = [crypto.createHash('sha256').update(rawExtId.toLowerCase()).digest('hex')];
      }
    }
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
      },
    ],
  };

  if (TEST_EVENT_CODE) {
    body.test_event_code = TEST_EVENT_CODE;
  }

  const url = graphUrl(`/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`);

  try {
    const { data: resJson, logEntry } = await fetchMetaApi(url, {
      method: 'POST',
      body,
      label: `POST /${PIXEL_ID}/events [${payload.eventName}]`,
    });

    if (!logEntry.success) {
      console.error('[Meta CAPI Error]', resJson);
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
    console.error('[Meta CAPI Catch Error]', err);
    return { success: false, error: err.message || 'Fetch failed' };
  }
}
