import crypto from 'crypto';

const SNAP_PIXEL_ID = process.env.NEXT_PUBLIC_SNAP_PIXEL_ID || '7d2481be-4ccf-42b2-b9ea-958c6c7bbdcd';
const SNAP_CAPI_ACCESS_TOKEN = process.env.SNAP_CAPI_ACCESS_TOKEN || '';

export interface SnapCapiEventPayload {
  eventName: string; // PAGE_VIEW, VIEW_CONTENT, ADD_CART, ADD_TO_WISHLIST, SEARCH, START_CHECKOUT, ADD_BILLING, PURCHASE, SIGN_UP, LOGIN, SUBSCRIBE
  eventTime?: number;
  eventSourceUrl: string;
  eventId: string;
  userAgent: string;
  ipAddress?: string;
  scClickId?: string;
  scCookie1?: string;
  uuidC1?: string;
  userData?: {
    em?: string;
    ph?: string;
    fn?: string;
    ln?: string;
    ct?: string;
    st?: string;
    zp?: string;
    country?: string;
  };
  customData?: {
    price?: number | string;
    currency?: string;
    item_ids?: string[];
    item_category?: string;
    number_items?: number | string;
    search_string?: string;
    description?: string;
    transaction_id?: string;
  };
}

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

/**
 * Sends a server-side Conversions API event to Snapchat.
 * Fire-and-forget safe — never throws, returns success status with diagnostics.
 * Uses URL query parameter authentication: ?access_token=${SNAP_CAPI_ACCESS_TOKEN}
 */
export async function sendSnapEvent(payload: SnapCapiEventPayload): Promise<{ success: boolean; data?: any; error?: any; skipped?: boolean }> {
  try {
    // Defense-in-depth: check admin route exclusions FIRST
    const urlLower = (payload.eventSourceUrl || '').toLowerCase();
    if (urlLower.includes('/dashboard') || urlLower.includes('/admin') || urlLower.includes('/web-store')) {
      return { success: false, skipped: true };
    }

    const pixelId = SNAP_PIXEL_ID;
    const token = SNAP_CAPI_ACCESS_TOKEN;

    if (!pixelId || !token) {
      return { success: false, error: 'Snap Pixel ID or CAPI Access Token not configured' };
    }

    const eventTime = payload.eventTime ?? Math.floor(Date.now() / 1000);

    // Format PII fields (reusing pre-hashed SHA-256 strings if already hashed)
    const em = cleanAndHashField(payload.userData?.em, e => e.trim().toLowerCase());
    const ph = cleanAndHashField(payload.userData?.ph, p => {
      const digits = p.replace(/\D/g, '');
      let base = digits;
      if (digits.length === 12 && digits.startsWith('91')) base = digits.slice(2);
      else if (digits.length === 11 && digits.startsWith('0')) base = digits.slice(1);
      return `91${base}`;
    });
    const fn = cleanAndHashField(payload.userData?.fn, s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const ln = cleanAndHashField(payload.userData?.ln, s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const ct = cleanAndHashField(payload.userData?.ct, s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const st = cleanAndHashField(payload.userData?.st, s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const zp = cleanAndHashField(payload.userData?.zp, s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const country = cleanAndHashField(payload.userData?.country, c => {
      const clean = c.trim().toLowerCase();
      if (clean === 'india' || clean === 'ind' || clean === 'in') return 'in';
      if (clean === 'united states' || clean === 'usa' || clean === 'us') return 'us';
      return clean.replace(/[^a-z]/g, '').slice(0, 2);
    });

    // Build user_data dictionary
    const userDataObj: Record<string, any> = {};
    if (em) userDataObj.em = em;
    if (ph) userDataObj.ph = ph;
    if (fn) userDataObj.fn = fn;
    if (ln) userDataObj.ln = ln;
    if (ct) userDataObj.ct = ct;
    if (st) userDataObj.st = st;
    if (zp) userDataObj.zp = zp;
    if (country) userDataObj.country = country;
    if (payload.ipAddress) userDataObj.client_ip_address = payload.ipAddress;
    if (payload.userAgent) userDataObj.client_user_agent = payload.userAgent;
    if (payload.scClickId) userDataObj.sc_click_id = payload.scClickId;
    if (payload.scCookie1) userDataObj.sc_cookie1 = payload.scCookie1;
    if (payload.uuidC1) userDataObj.uuid_c1 = payload.uuidC1;

    // FIX 3: Extract OS family from User-Agent for direct os coverage
    if (payload.userAgent) {
      const ua = payload.userAgent;
      if (/Android/i.test(ua)) {
        userDataObj.os = 'android';
      } else if (/iPhone|iPad|iPod/i.test(ua)) {
        userDataObj.os = 'ios';
      } else if (/Windows/i.test(ua)) {
        userDataObj.os = 'windows';
      } else if (/Macintosh|Mac OS/i.test(ua)) {
        userDataObj.os = 'macos';
      } else if (/Linux/i.test(ua)) {
        userDataObj.os = 'linux';
      }
    }

    // Build custom_data dictionary
    const customDataObj: Record<string, any> = {};
    if (payload.customData) {
      if (payload.customData.price !== undefined && payload.customData.price !== null) {
        const numericVal = parseFloat(String(payload.customData.price));
        customDataObj.price = String(numericVal);
        customDataObj.value = numericVal;
      }
      if (payload.customData.currency) {
        customDataObj.currency = payload.customData.currency;
      }
      if (Array.isArray(payload.customData.item_ids) && payload.customData.item_ids.length > 0) {
        customDataObj.item_ids = payload.customData.item_ids;
      }
      if (payload.customData.item_category) {
        customDataObj.item_category = payload.customData.item_category;
      }
      if (payload.customData.number_items !== undefined && payload.customData.number_items !== null) {
        customDataObj.number_items = String(payload.customData.number_items);
      }
      if (payload.customData.search_string) {
        customDataObj.search_string = payload.customData.search_string;
      }
      if (payload.customData.description) {
        customDataObj.description = payload.customData.description;
      }
      if (payload.customData.transaction_id) {
        customDataObj.transaction_id = payload.customData.transaction_id;
      }
    }

    // Build Snap CAPI event object — Snap V3 reads identity ONLY from user_data.
    // All PII/identity keys live exclusively in userDataObj (no top-level duplicates).
    const eventObj: Record<string, any> = {
      pixel_id: pixelId,
      event_name: payload.eventName,
      event_type: payload.eventName,
      event_time: eventTime,
      timestamp: String(eventTime),
      action_source: 'website',
      event_conversion_type: 'WEB',
      event_source_url: payload.eventSourceUrl,
      page_url: payload.eventSourceUrl,
      event_id: payload.eventId,
      user_data: userDataObj,
      ...(Object.keys(customDataObj).length > 0 ? { custom_data: customDataObj } : {}),
    };

    // Clean undefined/null keys
    const cleanedEvent: Record<string, any> = {};
    for (const [key, val] of Object.entries(eventObj)) {
      if (val !== undefined && val !== null && val !== '') {
        cleanedEvent[key] = val;
      }
    }

    const requestBody = {
      data: [cleanedEvent]
    };

    const endpoint = `https://tr.snapchat.com/v3/${pixelId}/events?access_token=${token}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const resData = await res.json().catch(() => ({}));

    if (res.ok && resData.status !== 'INVALID' && resData.status !== 'FAILED') {
      return { success: true, data: resData };
    } else {
      console.warn(`[Snap CAPI Error] HTTP ${res.status}:`, (resData as any)?.error || (resData as any)?.message || 'error');
      return { success: false, error: resData };
    }
  } catch (err: any) {
    console.error('[Snap CAPI Catch Error]', err);
    return { success: false, error: err.message || 'Network request failed' };
  }
}
