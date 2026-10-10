/**
 * Snap Conversions API v3 — NATIVE APP (action_source = MOBILE_APP) events.
 *
 * Separate from the website pixel on purpose: app conversions are sent to the
 * Snap APP endpoint  https://tr.snapchat.com/v3/{SNAP_APP_ID}/events  and never
 * through the web pixel.
 *
 * Required configuration (server env; nothing is sent while any is missing):
 *   SNAP_APP_ID_IOS          Snap App ID of the iOS app      (Ads Manager → Events Manager → app)
 *   SNAP_APP_ID_ANDROID      Snap App ID of the Android app  (may equal the iOS one if Snap shows one ID)
 *   SNAP_IOS_APP_STORE_ID    numeric App Store id, e.g. 6740000000   (app_data.app_id on iOS)
 *   SNAP_ANDROID_PACKAGE     Play Store package, default "com.zicabella.app" (app_data.app_id on Android)
 *   SNAP_APP_CAPI_ACCESS_TOKEN  optional; falls back to SNAP_CAPI_ACCESS_TOKEN
 *
 * Field rules (developers.snap.com → Conversions API → Parameters / Using the API):
 *   app_data.extinfo  16 positional strings; [0] "i2" (iOS) / "a2" (Android) and
 *                     [4] OS version are required; unknown positions are "".
 *   app_data.advertiser_tracking_enabled  iOS: 1 only when ATT is "authorized".
 *   user_data.idfv / madid  plain (not hashed); madid lowercase. Sent only when
 *                     the device actually provided them — never fabricated.
 */
import crypto from 'crypto';
import { normalizeIdentity, isSha256Hash, type RawIdentity } from '@/lib/tracking/identity-normalize';
import { isEventTimeSendable, toEventTimeMs } from '@/lib/snap-capi';

export type AppPlatform = 'ios' | 'android';
export type AttStatus = 'authorized' | 'denied' | 'restricted' | 'not_determined' | 'unavailable';

/** Device context the apps send at payment start (see ZicaBella and ZicaBella-android: src/services/snapDeviceContext.ts). */
export interface SnapDeviceContext {
  platform: AppPlatform;
  appPackage?: string;      // bundle id / package name
  appVersion?: string;      // e.g. "1.0.3"
  buildNumber?: string;     // e.g. "8" / versionCode
  osVersion?: string;       // e.g. "17.5" / "14"
  deviceModel?: string;     // e.g. "iPhone15,2"
  locale?: string;          // e.g. "en_IN"
  timezoneAbbr?: string;    // e.g. "GMT+5:30"
  timezone?: string;        // e.g. "Asia/Kolkata"
  screenWidth?: number;
  screenHeight?: number;
  screenDensity?: number;
  cpuCores?: number;
  attStatus?: AttStatus;    // iOS only
  idfv?: string;            // iOS identifierForVendor
  madid?: string;           // IDFA (iOS, ATT authorized) / AAID (Android, not limited)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const str = (v: unknown, max = 128) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown, min: number, max: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

/** Validate/strip a device context coming from the app. Returns null if unusable. */
export function parseSnapDeviceContext(raw: unknown): SnapDeviceContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const platform = r.platform === 'ios' || r.platform === 'android' ? r.platform : null;
  if (!platform) return null;
  const att = ['authorized', 'denied', 'restricted', 'not_determined', 'unavailable'].includes(String(r.attStatus))
    ? (r.attStatus as AttStatus) : undefined;
  const idfv = str(r.idfv, 64);
  const madid = str(r.madid, 64)?.toLowerCase();
  return {
    platform,
    appPackage: str(r.appPackage),
    appVersion: str(r.appVersion, 32),
    buildNumber: str(r.buildNumber, 32),
    osVersion: str(r.osVersion, 32),
    deviceModel: str(r.deviceModel, 64),
    locale: str(r.locale, 16),
    timezoneAbbr: str(r.timezoneAbbr, 16),
    timezone: str(r.timezone, 64),
    screenWidth: num(r.screenWidth, 1, 20000),
    screenHeight: num(r.screenHeight, 1, 20000),
    screenDensity: num(r.screenDensity, 0.1, 20),
    cpuCores: num(r.cpuCores, 1, 256),
    attStatus: platform === 'ios' ? att : undefined,
    // Only real identifiers: valid UUIDs, never the all-zero IDFA a denied ATT returns.
    idfv: platform === 'ios' && idfv && UUID_RE.test(idfv) ? idfv : undefined,
    madid: madid && UUID_RE.test(madid) && madid !== ZERO_UUID ? madid : undefined,
  };
}

/** Snap app config for a platform, or null when not configured. */
export function snapAppConfig(platform: AppPlatform, env = process.env) {
  const token = env.SNAP_APP_CAPI_ACCESS_TOKEN || env.SNAP_CAPI_ACCESS_TOKEN || '';
  if (platform === 'ios') {
    const snapAppId = env.SNAP_APP_ID_IOS || '';
    const appId = env.SNAP_IOS_APP_STORE_ID || '';
    if (!snapAppId || !/^\d+$/.test(appId) || !token) return null;
    return { snapAppId, appId, token };
  }
  const snapAppId = env.SNAP_APP_ID_ANDROID || '';
  const appId = env.SNAP_ANDROID_PACKAGE || 'com.zicabella.app';
  if (!snapAppId || !token) return null;
  return { snapAppId, appId, token };
}

/** 16-slot extinfo in Snap's documented order. */
export function buildExtinfo(d: SnapDeviceContext, packageName: string): string[] {
  const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  return [
    d.platform === 'ios' ? 'i2' : 'a2', // 0 extinfo version (required)
    s(d.appPackage || packageName),     // 1 app package name
    s(d.buildNumber),                   // 2 short version
    s(d.appVersion),                    // 3 long version
    s(d.osVersion),                     // 4 OS version (required)
    s(d.deviceModel),                   // 5 device model
    s(d.locale),                        // 6 locale
    s(d.timezoneAbbr),                  // 7 timezone abbreviation
    '',                                 // 8 carrier (not collected)
    s(d.screenWidth !== undefined ? Math.round(d.screenWidth) : ''),   // 9 screen width
    s(d.screenHeight !== undefined ? Math.round(d.screenHeight) : ''), // 10 screen height
    s(d.screenDensity !== undefined ? d.screenDensity.toFixed(2) : ''), // 11 screen density
    s(d.cpuCores),                      // 12 CPU cores
    '',                                 // 13 external storage size GB (not collected)
    '',                                 // 14 free external storage GB (not collected)
    s(d.timezone),                      // 15 device timezone
  ];
}

const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const hashIfNeeded = (v?: string) => (!v ? undefined : isSha256Hash(v) ? v.trim().toLowerCase() : sha(v));

export interface SnapAppEventInput {
  eventName: string;
  eventId: string;
  eventTime: number;
  device: SnapDeviceContext;
  appId: string;
  userData?: RawIdentity;
  externalId?: string;
  ipAddress?: string;
  userAgent?: string;
  customData?: Record<string, any>;
}

/** Exact MOBILE_APP v3 event object (exported for tests / validation). */
export function buildSnapAppEvent(input: SnapAppEventInput): Record<string, any> {
  const d = input.device;
  const norm = normalizeIdentity(input.userData || {});
  const user_data: Record<string, any> = {};
  (['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country'] as const).forEach(k => {
    const h = hashIfNeeded(norm[k]);
    if (h) user_data[k] = [h];
  });
  const ext = hashIfNeeded(input.externalId?.trim());
  if (ext) user_data.external_id = [ext];
  if (input.ipAddress) user_data.client_ip_address = input.ipAddress;
  if (input.userAgent) user_data.client_user_agent = input.userAgent;
  if (d.idfv) user_data.idfv = d.idfv;
  if (d.madid) user_data.madid = d.madid.toLowerCase();

  const app_data: Record<string, any> = {
    app_id: input.appId,
    extinfo: buildExtinfo(d, input.appId),
  };
  if (d.platform === 'ios') {
    app_data.advertiser_tracking_enabled = d.attStatus === 'authorized' ? 1 : 0;
  } else {
    // Android: an AAID is only returned when the user has not limited ad tracking.
    app_data.advertiser_tracking_enabled = d.madid ? 1 : 0;
  }

  const event: Record<string, any> = {
    event_name: input.eventName,
    event_time: toEventTimeMs(input.eventTime),
    event_id: input.eventId,
    action_source: 'MOBILE_APP',
    app_data,
    user_data,
  };
  if (input.customData && Object.keys(input.customData).length) event.custom_data = input.customData;
  return event;
}

const PRODUCTION_SITE = /^https?:\/\/(www\.)?zicabella\.com\/?$/i;

export async function sendSnapAppEvent(
  input: SnapAppEventInput,
  cfg: { snapAppId: string; token: string },
): Promise<{ success: boolean; error?: any; skipped?: boolean }> {
  try {
    if (!isEventTimeSendable(input.eventTime)) {
      return { success: false, skipped: true, error: 'event_time outside accepted window' };
    }
    const validate = process.env.SNAP_CAPI_VALIDATE === '1'
      && !PRODUCTION_SITE.test(process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com');
    const event = buildSnapAppEvent(input);
    const res = await fetch(
      `https://tr.snapchat.com/v3/${encodeURIComponent(cfg.snapAppId)}/${validate ? 'events/validate' : 'events'}?access_token=${cfg.token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [event] }), signal: AbortSignal.timeout(5000) },
    );
    const body: any = await res.json().catch(() => ({}));
    const ok = res.ok && body?.status !== 'INVALID' && body?.status !== 'FAILED';
    if (!ok || validate) {
      console[ok ? 'log' : 'warn'](`[Snap App CAPI${validate ? ' VALIDATE' : ''}] ${input.device.platform} ${event.event_name} HTTP ${res.status}`, JSON.stringify(body).slice(0, 800));
    }
    return ok ? { success: true } : { success: false, error: body };
  } catch (err: any) {
    return { success: false, error: err?.message || 'network error' };
  }
}
