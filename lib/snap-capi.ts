import crypto from 'crypto';
import { normalizeIdentity, isSha256Hash, type RawIdentity } from '@/lib/tracking/identity-normalize';
import {
  cleanEnvValue, isSnapExcludedPath, isSnapProductionSite, resolveSnapPixelId, snapDefaultSiteOrigin,
} from '@/lib/snap/config';

/**
 * Snap Conversions API v3 — website (action_source WEB) sender.
 *
 * Configuration (server environment, read on every call — never cached, never logged):
 *   SNAP_CAPI_ACCESS_TOKEN     required. Conversions API token of the Snap pixel
 *                              (Ads Manager → Business Details → Conversions API Tokens).
 *   NEXT_PUBLIC_SNAP_PIXEL_ID  optional, see lib/snap/config.ts.
 *   SNAP_CAPI_VALIDATE=1       staging only: send every event to Snap's
 *                              /events/validate endpoint, which checks the payload
 *                              and records NOTHING. Ignored on the live storefront.
 */

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

/**
 * Outcome of one send.
 *  - success        Snap accepted the event (or, with validateOnly, its payload).
 *  - skipped        the event can never be sent (too old, admin page) → do not retry.
 *  - blocked        nothing could be attempted with the CURRENT setup:
 *                     'config' = pixel id / access token missing on the server,
 *                     'auth'   = Snap refused the access token (HTTP 401 / 403).
 *                   The event itself is fine: callers keep it retryable and do not
 *                   count this against its retry attempts.
 *  - validateOnly   Snap's /events/validate endpoint was used: the payload was
 *                   checked but NOT recorded as a conversion.
 */
export interface SnapSendResult {
  success: boolean;
  data?: any;
  error?: any;
  skipped?: boolean;
  blocked?: 'config' | 'auth';
  validateOnly?: boolean;
  httpStatus?: number;
}

export function sha256Hex(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}

function hashIfNeeded(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return isSha256Hash(v) ? v.trim().toLowerCase() : sha256Hex(v);
}

// ── Configuration ───────────────────────────────────────────────────────────

/** The website Conversions API token (trimmed; wrapping quotes removed). Server-only. */
export function snapCapiToken(): string {
  return cleanEnvValue(process.env.SNAP_CAPI_ACCESS_TOKEN);
}

/**
 * Why the website CAPI cannot send right now, or null when it can. The message
 * names the variable to fix and never contains the token.
 */
export function snapCapiConfigError(): string | null {
  if (!resolveSnapPixelId()) return 'Snap Pixel ID is not configured (NEXT_PUBLIC_SNAP_PIXEL_ID is unset or "off" on this deployment)';
  const token = snapCapiToken();
  if (!token) return 'SNAP_CAPI_ACCESS_TOKEN is not set on the server';
  if (/\s/.test(token)) return 'SNAP_CAPI_ACCESS_TOKEN contains a space or line break — paste the token as a single line';
  return null;
}

/**
 * SHA-256 of the access token that was once committed to this (public)
 * repository. Only this fingerprint is kept, so the code can tell when that
 * token is configured again; the token itself must be deleted in Snap.
 */
const EXPOSED_TOKEN_SHA256 = 'a65876fd25dc6fd61704732803e4a2edf8555a04cb2900ddd0e9e3c2fc0a3828';

/** true when the configured token is the one that was exposed in the Git history. */
export function isExposedSnapToken(token: string = snapCapiToken()): boolean {
  return !!token && sha256Hex(token) === EXPOSED_TOKEN_SHA256;
}

/**
 * Non-secret facts about a token, for diagnostics: whether it has the shape of a
 * Snap token (a three-part JWT) and when Snap issued it. Never returns the token
 * or any identifying claim.
 */
export function describeSnapToken(token: string = snapCapiToken()): { set: boolean; looksValid: boolean; issuedAt: string | null; exposed: boolean } {
  if (!token) return { set: false, looksValid: false, issuedAt: null, exposed: false };
  const parts = token.split('.');
  const looksValid = parts.length === 3 && parts.every(p => /^[A-Za-z0-9_-]+$/.test(p));
  let issuedAt: string | null = null;
  if (looksValid) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      const ts = Number(claims?.iat ?? claims?.nbf);
      if (Number.isFinite(ts) && ts > 0) issuedAt = new Date(ts * 1000).toISOString();
    } catch { /* not a readable JWT — shape only */ }
  }
  return { set: true, looksValid, issuedAt, exposed: isExposedSnapToken(token) };
}

/** true when events go to /events/validate (checked, not recorded). Never on the live storefront. */
export function isSnapValidateMode(): boolean {
  if (cleanEnvValue(process.env.SNAP_CAPI_VALIDATE) !== '1') return false;
  if (isSnapProductionSite()) {
    logEvery('validate-ignored', 60 * 60_000, () =>
      console.error('[Snap CAPI] SNAP_CAPI_VALIDATE=1 ignored on the production site — events are sent normally.'));
    return false;
  }
  return true;
}

// ── Logging hygiene ─────────────────────────────────────────────────────────

const lastLogAt = new Map<string, number>();
/** Log at most once per `everyMs` per key (this module runs on every page view). */
function logEvery(key: string, everyMs: number, log: () => void): void {
  const now = Date.now();
  if ((lastLogAt.get(key) || 0) + everyMs > now) return;
  lastLogAt.set(key, now);
  log();
}

/** Remove access tokens from any text before it is logged, stored or returned. */
export function redactSnapSecrets(text: unknown): string {
  let out = String(text ?? '').replace(/(access_token=)[^&\s"'<>]+/gi, '$1[redacted]');
  for (const secret of [snapCapiToken(), cleanEnvValue(process.env.SNAP_APP_CAPI_ACCESS_TOKEN)]) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out;
}

// ── Event time ──────────────────────────────────────────────────────────────

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

// ── Payload ─────────────────────────────────────────────────────────────────

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
  if (cd.currency) custom_data.currency = String(cd.currency).trim().toUpperCase();
  const contentIds = cleanIds(cd.content_ids);
  if (contentIds) {
    custom_data.content_ids = contentIds;
    custom_data.content_type = cd.content_type || 'product';
  }
  if (cd.content_category) custom_data.content_category = cd.content_category;
  if (cd.content_name) custom_data.content_name = cd.content_name;
  if (Array.isArray(cd.contents) && cd.contents.length) {
    const contents = cd.contents
      .filter(c => c && c.id)
      .map(c => ({
        id: String(c.id),
        ...(c.quantity !== undefined ? { quantity: Number(c.quantity) || 1 } : {}),
        ...(toFiniteNumber(c.item_price) !== undefined ? { item_price: toFiniteNumber(c.item_price) } : {}),
      }));
    if (contents.length) custom_data.contents = contents;
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

// ── Transport ───────────────────────────────────────────────────────────────

/** Snap's v3 events endpoint for a pixel / Snap App id (token goes in the query, as Snap documents). */
export function snapEventsEndpoint(assetId: string, token: string, validate: boolean): string {
  return `https://tr.snapchat.com/v3/${encodeURIComponent(assetId)}/${validate ? 'events/validate' : 'events'}?access_token=${encodeURIComponent(token)}`;
}

const AUTH_TEXT_RE = /\b(unauthori[sz]ed|unauthenticated|forbidden|invalid (access[ _-]?)?token|(access[ _-]?)?token (is |has )?(invalid|expired|revoked|missing)|expired (access[ _-]?)?token)\b/i;

/**
 * Read Snap's answer. `auth: true` means Snap refused the credentials themselves
 * (HTTP 401 / 403, or a 4xx whose message says so) — a setup problem, not a
 * problem with the event.
 */
export function classifySnapResponse(httpStatus: number, httpOk: boolean, body: any): { ok: boolean; auth: boolean; summary: string } {
  const status = String(body?.status || '').toUpperCase();
  const ok = httpOk && status !== 'INVALID' && status !== 'FAILED';
  const text = [body?.reason, body?.error_message, body?.message, body?.error, body?.display_message]
    .filter((v): v is string => typeof v === 'string').join(' ');
  const auth = !ok && (httpStatus === 401 || httpStatus === 403 || (httpStatus >= 400 && httpStatus < 500 && AUTH_TEXT_RE.test(text)));
  let raw = '';
  try { raw = JSON.stringify(body ?? {}); } catch { raw = ''; }
  return { ok, auth, summary: redactSnapSecrets(`HTTP ${httpStatus}${status ? ` ${status}` : ''} ${raw === '{}' ? '' : raw}`.trim()).slice(0, 480) };
}

function isExcludedSourceUrl(url: string | undefined): boolean {
  if (!url) return false;
  try { return isSnapExcludedPath(new URL(url).pathname); } catch { return false; }
}

/**
 * Sends a server-side Conversions API event to Snapchat.
 * Never throws; returns a status object (see SnapSendResult).
 */
export async function sendSnapEvent(payload: SnapCapiEventPayload): Promise<SnapSendResult> {
  try {
    if (isExcludedSourceUrl(payload.eventSourceUrl)) {
      return { success: false, skipped: true };
    }

    const configError = snapCapiConfigError();
    if (configError) {
      // Loud, but not once per page view.
      logEvery('config-missing', 10 * 60_000, () =>
        console.error(`[Snap CAPI][ALERT] snap_config_missing — no server event is reaching Snapchat: ${configError}`));
      return { success: false, blocked: 'config', error: `snap_config_missing: ${configError}` };
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

    const validate = isSnapValidateMode();
    const res = await fetch(snapEventsEndpoint(resolveSnapPixelId(), snapCapiToken(), validate), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event] }),
      signal: AbortSignal.timeout(5000),
    });
    const resData: any = await res.json().catch(() => ({}));
    const verdict = classifySnapResponse(res.status, res.ok, resData);

    if (verdict.ok) {
      if (validate) console.log(`[Snap CAPI VALIDATE] ${event.event_name} ${verdict.summary}`);
      return { success: true, data: resData, httpStatus: res.status, ...(validate ? { validateOnly: true } : {}) };
    }
    if (verdict.auth) {
      logEvery('auth-rejected', 10 * 60_000, () =>
        console.error(`[Snap CAPI][ALERT] snap_auth_rejected — Snapchat refused SNAP_CAPI_ACCESS_TOKEN (${verdict.summary}). Generate a new Conversions API token for this pixel and update the server variable.`));
      return { success: false, blocked: 'auth', error: `snap_auth_rejected: ${verdict.summary}`, httpStatus: res.status };
    }
    console.warn(`[Snap CAPI${validate ? ' VALIDATE' : ''}] ${event.event_name} ${verdict.summary}`);
    return { success: false, error: `snap_rejected: ${verdict.summary}`, httpStatus: res.status, ...(validate ? { validateOnly: true } : {}) };
  } catch (err: any) {
    const message = redactSnapSecrets(err?.message || 'Network request failed');
    console.error('[Snap CAPI Catch Error]', message);
    return { success: false, error: message };
  }
}

// ── Live connection check ───────────────────────────────────────────────────

export interface SnapProbeResult {
  /** ok = Snap accepted the credentials · auth_rejected = Snap refused them ·
   *  config_missing = nothing to test · inconclusive = Snap answered something
   *  else (see detail) · unreachable = no answer from Snap. */
  state: 'ok' | 'auth_rejected' | 'config_missing' | 'inconclusive' | 'unreachable';
  httpStatus?: number;
  detail?: string;
}

/**
 * Check the pixel id + access token against Snap's VALIDATE endpoint with a
 * synthetic PAGE_VIEW. Snap inspects the request and records nothing, so this is
 * safe on production. Never throws and never returns the token.
 */
export async function probeSnapCapi(opts: { ipAddress?: string } = {}): Promise<SnapProbeResult> {
  const configError = snapCapiConfigError();
  if (configError) return { state: 'config_missing', detail: configError };
  try {
    const event = buildSnapCapiEvent({
      eventName: 'PAGE_VIEW',
      eventId: `connection_test_${Date.now()}`,
      eventTime: Date.now(),
      eventSourceUrl: `${snapDefaultSiteOrigin()}/`,
      userAgent: 'ZicaBella-Snap-Connection-Test/1.0',
      ipAddress: opts.ipAddress,
    });
    const res = await fetch(snapEventsEndpoint(resolveSnapPixelId(), snapCapiToken(), true), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event] }),
      signal: AbortSignal.timeout(8000),
    });
    const body: any = await res.json().catch(() => ({}));
    const verdict = classifySnapResponse(res.status, res.ok, body);
    if (verdict.ok) return { state: 'ok', httpStatus: res.status, detail: verdict.summary };
    if (verdict.auth) return { state: 'auth_rejected', httpStatus: res.status, detail: verdict.summary };
    return { state: 'inconclusive', httpStatus: res.status, detail: verdict.summary };
  } catch (err: any) {
    return { state: 'unreachable', detail: redactSnapSecrets(err?.message || 'no response from Snapchat') };
  }
}
