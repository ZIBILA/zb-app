import crypto from 'crypto';
import { normalizeIdentity, isSha256Hash, type RawIdentity } from '@/lib/tracking/identity-normalize';

const SNAP_PIXEL_ID = process.env.NEXT_PUBLIC_SNAP_PIXEL_ID || '7d2481be-4ccf-42b2-b9ea-958c6c7bbdcd';
const SNAP_CAPI_ACCESS_TOKEN = process.env.SNAP_CAPI_ACCESS_TOKEN || '';
/**
 * Set SNAP_CAPI_VALIDATE=1 (e.g. on a staging deploy) to send every event to
 * Snap's /events/validate endpoint instead of /events. Snap checks the payload
 * and returns field-level problems without recording a conversion.
 */
const PRODUCTION_SITE = /^https?:\/\/(www\.)?zicabella\.com\/?$/i;
const SNAP_CAPI_VALIDATE =
  process.env.SNAP_CAPI_VALIDATE === '1' &&
  // Hard guard: never validation-only on the production storefront, where it
  // would silently stop real conversions from being recorded.
  !PRODUCTION_SITE.test(process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com');
if (process.env.SNAP_CAPI_VALIDATE === '1' && !SNAP_CAPI_VALIDATE) {
  console.error('[Snap CAPI] SNAP_CAPI_VALIDATE=1 ignored on the production site — events are sent normally.');
}

/** Snap CAPI v3 standard web events. */
export type SnapEventName =
  | 'PAGE_VIEW' | 'VIEW_CONTENT' | 'ADD_CART' | 'ADD_TO_WISHLIST' | 'SEARCH'
  | 'START_CHECKOUT' | 'ADD_BILLING' | 'PURCHASE' | 'SIGN_UP' | 'LOGIN' | 'SUBSCRIBE'
  | 'LIST_VIEW' | 'SAVE' | 'SHARE';

export interface SnapContentItem {
  id: string;
  quantity?: number;
  item_price?: number;
}

/**
 * Field names here are the Snap Conversions API v3 names
 * (developers.snap.com → Conversions API → Parameters). The browser pixel uses
 * DIFFERENT names (item_ids / price / transaction_id / number_items) — those are
 * produced in lib/snapPixel.ts, never here.
 */
export interface SnapCapiCustomData {
  value?: number | string;
  currency?: string;
  content_ids?: string[];
  content_category?: string;
  content_name?: string;
  content_type?: 'product' | 'product_group';
  contents?: SnapContentItem[];
  num_items?: number | string;
  order_id?: string;
  search_string?: string;
}

export interface SnapCapiEventPayload {
  eventName: SnapEventName | string;
  /** seconds or milliseconds; defaults to now */
  eventTime?: number;
  eventSourceUrl: string;
  /** MUST equal the browser pixel's client_dedup_id for the same event */
  eventId: string;
  userAgent: string;
  ipAddress?: string;
  /** ScCid from the ad click URL (do NOT hash) */
  scClickId?: string;
  /** _scid first-party cookie written by the Snap pixel (do NOT hash) */
  scCookie1?: string;
  /** Stable first-party visitor/customer id (hashed before sending) */
  externalId?: string;
  /** Raw or already-SHA-256 PII. Raw values are normalized per Snap spec, then hashed. */
  userData?: RawIdentity;
  customData?: SnapCapiCustomData;
  /** 'WEB' for the storefront. Mobile-app purchases currently also report as WEB. */
  actionSource?: 'WEB' | 'MOBILE_APP' | 'OFFLINE';
}

export function sha256Hex(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}

function hashIfNeeded(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return isSha256Hash(v) ? v.trim().toLowerCase() : sha256Hex(v);
}

/** Snap rejects events older than 7 days. Keep a small safety margin. */
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000 - 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Seconds or milliseconds → milliseconds (Snap prefers ms). Never rewrites the moment. */
export function toEventTimeMs(t?: number): number {
  if (!t || !Number.isFinite(t)) return Date.now();
  return t < 1e12 ? Math.round(t * 1000) : Math.round(t);
}

/**
 * true when Snap will accept this timestamp. Old or far-future events are NOT
 * re-dated — callers must skip them (see sendSnapEvent / emitSnapPurchase).
 */
export function isEventTimeSendable(t?: number, now = Date.now()): boolean {
  const ms = toEventTimeMs(t);
  return now - ms <= MAX_EVENT_AGE_MS && ms - now <= MAX_CLOCK_SKEW_MS;
}

function toFiniteNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

const cleanIds = (ids?: unknown[]): string[] | undefined => {
  if (!Array.isArray(ids)) return undefined;
  const out = Array.from(new Set(ids.map(i => String(i ?? '').trim()).filter(Boolean)));
  return out.length ? out : undefined;
};

/** Build the exact v3 event object (exported so it can be unit-tested). */
export function buildSnapCapiEvent(payload: SnapCapiEventPayload): Record<string, any> {
  // ── user_data ──
  const norm = normalizeIdentity(payload.userData || {});
  const user_data: Record<string, any> = {};
  (['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country'] as const).forEach(k => {
    const h = hashIfNeeded(norm[k]);
    if (h) user_data[k] = [h];
  });
  const ext = hashIfNeeded(payload.externalId?.trim());
  if (ext) user_data.external_id = [ext];
  if (payload.ipAddress) user_data.client_ip_address = payload.ipAddress.trim();
  if (payload.userAgent) user_data.client_user_agent = payload.userAgent;
  if (payload.scClickId) user_data.sc_click_id = payload.scClickId.trim();
  if (payload.scCookie1) user_data.sc_cookie1 = payload.scCookie1.trim();

  // ── custom_data ──
  const cd = payload.customData || {};
  const custom_data: Record<string, any> = {};
  const value = toFiniteNumber(cd.value);
  if (value !== undefined) custom_data.value = value;
  if (cd.currency) custom_data.currency = String(cd.currency).toUpperCase();
  const contentIds = cleanIds(cd.content_ids);
  if (contentIds) {
    custom_data.content_ids = contentIds;
    custom_data.content_type = cd.content_type || 'product';
  }
  if (cd.content_category) custom_data.content_category = cd.content_category;
  if (cd.content_name) custom_data.content_name = cd.content_name;
  if (Array.isArray(cd.contents) && cd.contents.length) {
    custom_data.contents = cd.contents
      .filter(c => c && c.id)
      .map(c => ({
        id: String(c.id),
        ...(c.quantity !== undefined ? { quantity: Number(c.quantity) || 1 } : {}),
        ...(toFiniteNumber(c.item_price) !== undefined ? { item_price: toFiniteNumber(c.item_price) } : {}),
      }));
  }
  if (cd.num_items !== undefined && cd.num_items !== null && cd.num_items !== '') {
    custom_data.num_items = String(cd.num_items);
  }
  if (cd.order_id) custom_data.order_id = String(cd.order_id);
  if (cd.search_string) custom_data.search_string = cd.search_string;

  const event: Record<string, any> = {
    event_name: payload.eventName,
    event_time: toEventTimeMs(payload.eventTime),
    event_id: payload.eventId,
    action_source: payload.actionSource || 'WEB',
    event_source_url: payload.eventSourceUrl,
    user_data,
  };
  if (Object.keys(custom_data).length > 0) event.custom_data = custom_data;
  return event;
}

/**
 * Sends a server-side Conversions API event to Snapchat.
 * Never throws; returns a status object.
 */
export async function sendSnapEvent(payload: SnapCapiEventPayload): Promise<{ success: boolean; data?: any; error?: any; skipped?: boolean }> {
  try {
    const urlLower = (payload.eventSourceUrl || '').toLowerCase();
    if (urlLower.includes('/dashboard') || urlLower.includes('/admin') || urlLower.includes('/web-store')) {
      return { success: false, skipped: true };
    }
    if (!SNAP_PIXEL_ID || !SNAP_CAPI_ACCESS_TOKEN) {
      return { success: false, error: 'Snap Pixel ID or CAPI Access Token not configured' };
    }

    if (!isEventTimeSendable(payload.eventTime)) {
      console.warn(`[Snap CAPI] ${payload.eventName} ${payload.eventId} not sent: event_time outside Snap's 7-day window`);
      return { success: false, skipped: true, error: 'event_time outside accepted window' };
    }

    const event = buildSnapCapiEvent(payload);

    if (event.event_name === 'PURCHASE' && (event.custom_data?.value === undefined || !event.custom_data?.currency)) {
      console.warn('[Snap CAPI] PURCHASE without value/currency — Snap requires both', {
        event_id: event.event_id,
      });
    }

    const path = SNAP_CAPI_VALIDATE ? 'events/validate' : 'events';
    const endpoint = `https://tr.snapchat.com/v3/${SNAP_PIXEL_ID}/${path}?access_token=${SNAP_CAPI_ACCESS_TOKEN}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event] }),
      signal: AbortSignal.timeout(5000),
    });
    const resData: any = await res.json().catch(() => ({}));

    const ok = res.ok && resData?.status !== 'INVALID' && resData?.status !== 'FAILED';
    if (!ok || SNAP_CAPI_VALIDATE) {
      console[ok ? 'log' : 'warn'](
        `[Snap CAPI${SNAP_CAPI_VALIDATE ? ' VALIDATE' : ''}] ${event.event_name} HTTP ${res.status}`,
        JSON.stringify(resData).slice(0, 1000),
      );
    }
    return ok ? { success: true, data: resData } : { success: false, error: resData };
  } catch (err: any) {
    console.error('[Snap CAPI Catch Error]', err?.message || err);
    return { success: false, error: err?.message || 'Network request failed' };
  }
}
