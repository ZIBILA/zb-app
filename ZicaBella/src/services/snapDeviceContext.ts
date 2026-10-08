/**
 * Device context for Snap MOBILE_APP conversions (server: lib/snap/app-capi.ts).
 *
 * Sent with /api/app/payment/create-order (and verify) so the server can send
 * the Purchase to Snap as an APP event — never through the website pixel.
 *
 * Privacy rules enforced here:
 *  - IDFA (iOS) is read only when the user granted App Tracking Transparency.
 *  - AAID (Android) is read only when the user has not limited ad tracking
 *    (the OS returns null otherwise).
 *  - Nothing is invented: unknown values stay undefined.
 */
import { Dimensions, PixelRatio, Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as Tracking from 'expo-tracking-transparency';

export type AttStatus = 'authorized' | 'denied' | 'restricted' | 'not_determined' | 'unavailable';

export interface SnapDeviceContext {
  platform: 'ios' | 'android';
  appPackage?: string;
  appVersion?: string;
  buildNumber?: string;
  osVersion?: string;
  deviceModel?: string;
  locale?: string;
  timezoneAbbr?: string;
  timezone?: string;
  screenWidth?: number;
  screenHeight?: number;
  screenDensity?: number;
  attStatus?: AttStatus;
  idfv?: string;
  madid?: string;
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function gmtOffsetLabel(): string {
  const mins = -new Date().getTimezoneOffset();
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

async function attStatus(): Promise<AttStatus> {
  if (Platform.OS !== 'ios') return 'unavailable';
  try {
    if (!Tracking.isAvailable()) return 'unavailable';
    const res = await Tracking.getTrackingPermissionsAsync();
    if (res.granted) return 'authorized';
    if (res.status === 'undetermined') return 'not_determined';
    // iOS reports "restricted" as denied with canAskAgain=false.
    return res.canAskAgain === false && res.status === 'denied' ? 'restricted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

let cached: { at: number; value: SnapDeviceContext } | null = null;

/** Never throws; resolves within a few ms after the first call. */
export async function getSnapDeviceContext(): Promise<SnapDeviceContext | undefined> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return undefined;
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  try {
    const { width, height } = Dimensions.get('screen');
    const intl = Intl.DateTimeFormat().resolvedOptions();
    const ctx: SnapDeviceContext = {
      platform: Platform.OS,
      appPackage: Application.applicationId || undefined,
      appVersion: Application.nativeApplicationVersion || undefined,
      buildNumber: Application.nativeBuildVersion || undefined,
      osVersion: Device.osVersion || String(Platform.Version || '') || undefined,
      deviceModel: Device.modelId || Device.modelName || undefined,
      locale: (intl.locale || '').replace('-', '_') || undefined,
      timezoneAbbr: gmtOffsetLabel(),
      timezone: intl.timeZone || undefined,
      screenWidth: Math.round(width * PixelRatio.get()),
      screenHeight: Math.round(height * PixelRatio.get()),
      screenDensity: PixelRatio.get(),
    };

    if (Platform.OS === 'ios') {
      ctx.attStatus = await attStatus();
      try { ctx.idfv = (await Application.getIosIdForVendorAsync()) || undefined; } catch { /* unavailable */ }
      if (ctx.attStatus === 'authorized') {
        try {
          const idfa = Tracking.getAdvertisingId();
          if (idfa && idfa !== ZERO_UUID) ctx.madid = idfa.toLowerCase();
        } catch { /* unavailable */ }
      }
    } else {
      try {
        const aaid = Tracking.getAdvertisingId(); // null when the user limited ad tracking
        if (aaid && aaid !== ZERO_UUID) ctx.madid = aaid.toLowerCase();
      } catch { /* unavailable */ }
    }

    cached = { at: Date.now(), value: ctx };
    return ctx;
  } catch {
    return undefined;
  }
}

/**
 * iOS only: ask for App Tracking Transparency once, after the user accepted the
 * in-app consent screen. iOS itself never shows the prompt twice.
 */
export async function requestTrackingConsentOnce(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    if (!Tracking.isAvailable()) return;
    const current = await Tracking.getTrackingPermissionsAsync();
    if (current.status === 'undetermined') {
      await Tracking.requestTrackingPermissionsAsync();
    }
    cached = null; // re-read ATT / IDFA on the next checkout
  } catch {
    /* never block the app */
  }
}
