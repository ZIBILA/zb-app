/**
 * OpenAI (ChatGPT) Ads — Server-Side Conversions API Sender
 * Parallels lib/snap-capi.ts
 *
 * Sends events to:
 *   POST https://bzr.openai.com/v1/events?pid=<PIXEL_ID>
 *   Authorization: Bearer <OPENAI_ADS_CAPI_KEY>
 *
 * Fire-and-forget safe — never throws. Returns success/error status.
 */

import crypto from 'crypto';

const OPENAI_ADS_PIXEL_ID = process.env.NEXT_PUBLIC_OPENAI_ADS_PIXEL_ID || '';
const OPENAI_ADS_CAPI_KEY = process.env.OPENAI_ADS_CAPI_KEY || '';

// ── Hashing helpers (mirrors snap-capi.ts) ─────────────────────

function isSha256Hash(val: string | undefined): boolean {
  if (!val) return false;
  return /^[a-f0-9]{64}$/.test(val.trim().toLowerCase());
}

function cleanAndHashField(val: string | undefined, normalizer?: (v: string) => string): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();
  if (isSha256Hash(trimmed)) {
    return trimmed.toLowerCase();
  }
  const normalized = normalizer ? normalizer(trimmed) : trimmed.toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// ── Minor-unit conversion (shared with client) ─────────────────

const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
  'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

export function toMinorUnits(amount: number, currency = 'INR'): number {
  const upper = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(upper)) {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
}

// ── Types ───────────────────────────────────────────────────────

export interface OpenAiContentItem {
  id: string;              // internal SKU / item id
  group_id?: string;       // CAPI-only, product/parent id
  name?: string;
  content_type?: string;   // e.g. "product"
  quantity?: number;
  amount?: number;         // integer minor units
  currency?: string;
  variant_dict?: Record<string, string>; // CAPI-only
}

export interface OpenAiCapiPayload {
  eventName: string;       // OpenAI event name (e.g. "order_created")
  eventId: string;         // shared with pixel event_id for dedup
  eventSourceUrl: string;  // REQUIRED when action_source is "web"
  userAgent?: string;
  ipAddress?: string;
  actionSource?: 'web' | 'mobile_app' | 'offline' | 'physical_store' | 'phone_call' | 'email';
  obref?: string;          // __obref cookie value for hybrid dedup
  userData?: {
    em?: string;           // email — will be SHA-256 hashed
    ph?: string;           // phone — will be SHA-256 hashed with +91 normalization
    fn?: string;
    ln?: string;
    ct?: string;
    st?: string;
    zp?: string;
    country?: string;
  };
  data?: {
    type: 'contents' | 'customer_action';
    amount?: number;       // if already in minor units, pass directly; else use toMinorUnits()
    currency?: string;
    contents?: OpenAiContentItem[];
  };
  validateOnly?: boolean;
}

export interface OpenAiCapiResult {
  success: boolean;
  data?: any;
  error?: any;
  skipped?: boolean;
}

// ── Main sender ─────────────────────────────────────────────────

export async function sendOpenAiEvent(payload: OpenAiCapiPayload): Promise<OpenAiCapiResult> {
  try {
    // Defense-in-depth: admin route exclusion FIRST
    const urlLower = (payload.eventSourceUrl || '').toLowerCase();
    if (urlLower.includes('/dashboard') || urlLower.includes('/admin') || urlLower.includes('/web-store')) {
      return { success: false, skipped: true };
    }

    const pixelId = OPENAI_ADS_PIXEL_ID;
    const key = OPENAI_ADS_CAPI_KEY;

    if (!pixelId || !key) {
      return { success: false, error: 'OpenAI Ads Pixel ID or CAPI key not configured' };
    }

    // Timestamp validation: must be within last 7 days and no more than 10 min in the future
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const TEN_MIN_MS = 10 * 60 * 1000;
    let timestampMs = now;

    if (timestampMs < now - SEVEN_DAYS_MS) {
      // Too old — skip
      return { success: false, error: 'Event timestamp is older than 7 days' };
    }
    if (timestampMs > now + TEN_MIN_MS) {
      // Too far in the future — clamp to now
      timestampMs = now;
    }

    // Hash PII fields (reusing snap-capi patterns)
    const emailsHash = cleanAndHashField(payload.userData?.em, e => e.trim().toLowerCase());
    const phoneHash = cleanAndHashField(payload.userData?.ph, p => {
      const digits = p.replace(/\D/g, '');
      let base = digits;
      if (digits.length === 12 && digits.startsWith('91')) base = digits.slice(2);
      else if (digits.length === 11 && digits.startsWith('0')) base = digits.slice(1);
      return `91${base}`;
    });
    const fnHash = cleanAndHashField(payload.userData?.fn, s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const lnHash = cleanAndHashField(payload.userData?.ln, s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));

    // Geo fields (raw string normalization per official OpenAI Developers spec)
    const cleanCountry = payload.userData?.country?.trim();
    const countryCode = cleanCountry ? (
      cleanCountry.toLowerCase() === 'india' || cleanCountry.toLowerCase() === 'ind' || cleanCountry.toLowerCase() === 'in' ? 'IN' :
      cleanCountry.toLowerCase() === 'united states' || cleanCountry.toLowerCase() === 'usa' || cleanCountry.toLowerCase() === 'us' ? 'US' :
      cleanCountry.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
    ) : undefined;
    const cleanCity = payload.userData?.ct?.trim();
    const cleanState = payload.userData?.st?.trim();
    const cleanZip = payload.userData?.zp?.trim();

    // Hashed geo fields for cross-platform compatibility
    const cityHash = cleanAndHashField(payload.userData?.ct, s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const stateHash = cleanAndHashField(payload.userData?.st, s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const zipHash = cleanAndHashField(payload.userData?.zp, s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const countryHash = cleanAndHashField(payload.userData?.country, c => {
      const clean = c.trim().toLowerCase();
      if (clean === 'india' || clean === 'ind' || clean === 'in') return 'in';
      if (clean === 'united states' || clean === 'usa' || clean === 'us') return 'us';
      return clean.replace(/[^a-z]/g, '').slice(0, 2);
    });

    // Build user object
    const userObj: Record<string, any> = {};
    if (emailsHash) userObj.emails_sha256 = [emailsHash];
    if (phoneHash) userObj.phone_numbers_sha256 = [phoneHash];
    if (fnHash) userObj.first_names_sha256 = [fnHash];
    if (lnHash) userObj.last_names_sha256 = [lnHash];

    // Official OpenAI CAPI geo arrays (raw strings per documentation)
    if (countryCode) userObj.countries = [countryCode];
    if (cleanCity) userObj.cities = [cleanCity];
    if (cleanState) userObj.regions = [cleanState];
    if (cleanZip) userObj.postal_codes = [cleanZip];

    // Compatibility hashed geo fields
    if (cityHash) userObj.cities_sha256 = [cityHash];
    if (stateHash) userObj.regions_sha256 = [stateHash];
    if (zipHash) userObj.postal_codes_sha256 = [zipHash];
    if (countryHash) userObj.country_codes_sha256 = [countryHash];

    // Client network & device metadata (supports official ip_address/user_agent & client_* aliases)
    if (payload.ipAddress) {
      userObj.ip_address = payload.ipAddress;
      userObj.client_ip_address = payload.ipAddress;
    }
    if (payload.userAgent) {
      userObj.user_agent = payload.userAgent;
      userObj.client_user_agent = payload.userAgent;
    }
    if (payload.obref) userObj.obref = payload.obref;

    // Build data object
    const dataObj: Record<string, any> = {};
    if (payload.data) {
      dataObj.type = payload.data.type || 'contents';
      if (payload.data.amount !== undefined && payload.data.amount !== null) {
        dataObj.amount = payload.data.amount; // Already expected in minor units
      }
      if (payload.data.currency) {
        dataObj.currency = payload.data.currency;
      }
      if (payload.data.contents && payload.data.contents.length > 0) {
        dataObj.contents = payload.data.contents;
      }
    }

    // Build the event
    const eventObj: Record<string, any> = {
      id: payload.eventId,
      type: payload.eventName,
      timestamp_ms: timestampMs,
      source_url: payload.eventSourceUrl,
      action_source: payload.actionSource || 'web',
    };

    if (Object.keys(dataObj).length > 0) {
      eventObj.data = dataObj;
    }
    if (Object.keys(userObj).length > 0) {
      eventObj.user = userObj;
    }

    const requestBody = {
      validate_only: payload.validateOnly ?? false,
      events: [eventObj],
    };

    const endpoint = `https://bzr.openai.com/v1/events?pid=${pixelId}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify(requestBody),
    });

    const resData = await res.json().catch(() => ({}));

    if (res.ok) {
      return { success: true, data: resData };
    } else {
      console.warn(`[OpenAI CAPI Error] HTTP ${res.status}:`, (resData as any)?.error || (resData as any)?.message || 'error');
      return { success: false, error: resData };
    }
  } catch (err: any) {
    console.error('[OpenAI CAPI Catch Error]', err);
    return { success: false, error: err.message || 'Network request failed' };
  }
}
