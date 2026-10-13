/**
 * Safe bridge for react-native-customui (Razorpay Custom UI SDK).
 *
 * The SDK's Razorpay.js creates a NativeEventEmitter at import time,
 * which crashes with "NativeEventEmitter requires a non-null argument"
 * if the native binary hasn't been rebuilt after installing the package.
 *
 * This wrapper:
 *  1. Lazy-loads the SDK so the app doesn't crash at startup
 *  2. Provides a graceful fallback with clear error messages
 *  3. Auto-recovers once the native binary is rebuilt
 */
import { NativeModules, Platform } from 'react-native';

export interface UPIApp {
  app_name: string;
  app_icon: string; // base64 encoded PNG
  package_name: string;
  is_available?: boolean;
}

export interface PaymentResult {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature?: string;
}

// Check if native module is available BEFORE importing the JS wrapper
function isNativeModuleAvailable(): boolean {
  return !!(
    NativeModules.RazorpayCustomui &&
    NativeModules.RazorpayEventEmitterCustom
  );
}

let _razorpay: any = null;
let _loadError: string | null = null;

const preferredUPIApps: UPIApp[] = [
  { app_name: 'Google Pay', app_icon: 'https://cdn.razorpay.com/app/google_pay.png', package_name: 'google_pay', is_available: false },
  { app_name: 'PhonePe', app_icon: 'https://cdn.razorpay.com/app/phonepe.png', package_name: 'phonepe', is_available: false },
  { app_name: 'Paytm', app_icon: 'https://cdn.razorpay.com/app/paytm.png', package_name: 'paytm', is_available: false },
  { app_name: 'MobiKwik', app_icon: 'https://cdn.razorpay.com/app/mobikwik.png', package_name: 'mobikwik', is_available: false },
  { app_name: 'BHIM UPI', app_icon: 'https://cdn.razorpay.com/app/bhim.png', package_name: 'bhim', is_available: false },
];

export const WALLET_APPS = [
  { id: 'paytm', name: 'Paytm', icon: 'https://cdn.razorpay.com/app/paytm.png', package_name: 'net.one97.paytm', scheme: 'paytmmp://' },
  { id: 'phonepe', name: 'PhonePe', icon: 'https://cdn.razorpay.com/app/phonepe.png', package_name: 'com.phonepe.app', scheme: 'phonepe://' },
  { id: 'mobikwik', name: 'MobiKwik', icon: 'https://cdn.razorpay.com/app/mobikwik.png', package_name: 'com.mobikwik_new', scheme: 'mobikwik://' },
  { id: 'freecharge', name: 'Freecharge', icon: 'https://cdn.razorpay.com/app/freecharge.png', package_name: 'com.freecharge.android', scheme: 'freecharge://' },
  { id: 'amazonpay', name: 'Amazon Pay', icon: 'https://cdn.razorpay.com/app/amazon_pay.png', package_name: 'com.amazon.mShop.android.shopping', scheme: 'amazonpay://' },
  { id: 'olamoney', name: 'Ola Money', icon: 'https://cdn.razorpay.com/app/olamoney.png', package_name: 'com.olacabs.customer', scheme: 'olamoney://' },
];

export function inferUPIPackageName(value: string): string {
  const normalized = value.toLowerCase().trim();

  // Preserve exact identifiers returned by Razorpay. Custom UI validates
  // upi_app_package_name against these values, not against URL schemes.
  if (['google_pay', 'phonepe', 'paytm', 'mobikwik', 'bhim'].includes(normalized)) {
    return normalized;
  }

  // If it already looks like a real Android package name, preserve it.
  if (normalized.includes('.') || normalized.includes('://')) {
    return normalized;
  }

  const slug = normalized.replace(/[^a-z0-9]/g, '');

  if (slug.includes('google') || slug.includes('gpay') || slug.includes('tez')) {
    return 'com.google.android.apps.nbu.paisa.user';
  }
  if (slug.includes('phonepe')) {
    return 'com.phonepe.app';
  }
  if (slug.includes('paytm')) {
    return 'net.one97.paytm';
  }
  if (slug.includes('mobikwik')) {
    return 'com.mobikwik_new';
  }
  if (slug.includes('bhim')) {
    return 'in.org.npci.upiapp';
  }

  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function formatUPIAppName(value: string): string {
  const pkg = inferUPIPackageName(value);
  if (pkg.includes('google')) return 'Google Pay';
  if (pkg.includes('phonepe')) return 'PhonePe';
  if (pkg.includes('paytm')) return 'Paytm';
  if (pkg.includes('mobikwik')) return 'MobiKwik';
  if (pkg.includes('bhim')) return 'BHIM UPI';
  
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function normalizeIcon(icon: unknown, packageName: string): string {
  if (typeof icon === 'string' && icon.length > 50) {
      return icon.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
  }
  // Fallback to high-quality hosted icons if SDK doesn't provide one
  const slug = packageName.toLowerCase();
  if (slug.includes('google') || slug.includes('tez')) return 'https://cdn.razorpay.com/app/google_pay.png';
  if (slug.includes('phonepe')) return 'https://cdn.razorpay.com/app/phonepe.png';
  if (slug.includes('paytm')) return 'https://cdn.razorpay.com/app/paytm.png';
  if (slug.includes('mobikwik')) return 'https://cdn.razorpay.com/app/mobikwik.png';
  if (slug.includes('bhim')) return 'https://cdn.razorpay.com/app/bhim.png';
  return '';
}

function normalizeUPIApp(item: unknown): UPIApp | null {
  const raw = typeof item === 'object' && item !== null && 'appName' in item
    ? (item as Record<string, unknown>).appName
    : item;

  if (typeof raw === 'string') {
    const pkg = inferUPIPackageName(raw);
    return {
      app_name: formatUPIAppName(raw),
      app_icon: normalizeIcon('', pkg),
      package_name: pkg,
      is_available: true,
    };
  }

  if (!raw || typeof raw !== 'object') return null;

  const app = raw as Record<string, unknown>;
  const nameValue = app.app_name || app.appName || app.name || app.displayName || app.package_name || app.packageName;
  const packageValue = app.package_name || app.packageName || app.package || app.id || nameValue;

  if (typeof nameValue !== 'string' && typeof packageValue !== 'string') return null;

  const packageName = inferUPIPackageName(String(packageValue));
  return {
    app_name: typeof nameValue === 'string' ? formatUPIAppName(nameValue) : formatUPIAppName(packageName),
    app_icon: normalizeIcon(app.app_icon || app.appIcon || app.icon, packageName),
    package_name: packageName,
    is_available: true,
  };
}

export function normalizeUPIApps(payload: unknown): UPIApp[] {
  const rawApps = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).data)
      ? (payload as Record<string, unknown>).data as unknown[]
      : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).upiApps)
        ? (payload as Record<string, unknown>).upiApps as unknown[]
        : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).apps)
          ? (payload as Record<string, unknown>).apps as unknown[]
          : [];

  const appMap = new Map<string, UPIApp>();
  rawApps.forEach(item => {
    const app = normalizeUPIApp(item);
    if (!app?.package_name) return;
    appMap.set(app.package_name, app);
  });

  preferredUPIApps.forEach(app => {
    if (!appMap.has(app.package_name)) {
      appMap.set(app.package_name, app);
    }
  });

  return Array.from(appMap.values()).sort((a, b) => {
    if (!!a.is_available !== !!b.is_available) return a.is_available ? -1 : 1;
    return a.app_name.localeCompare(b.app_name);
  });
}

function getRazorpay(): any {
  if (_razorpay) return _razorpay;
  if (_loadError) return null;

  if (!isNativeModuleAvailable()) {
    _loadError =
      'Razorpay Custom UI native module not found. ' +
      'Please rebuild the native binary: npx expo run:android';
    console.warn('[RazorpayBridge]', _loadError);
    return null;
  }

  try {
    // Safe to import now — native module exists
    _razorpay = require('react-native-customui').default;
    return _razorpay;
  } catch (e: any) {
    _loadError = `Failed to load Razorpay SDK: ${e.message}`;
    console.error('[RazorpayBridge]', _loadError);
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────

export function isRazorpayAvailable(): boolean {
  return !!getRazorpay();
}

export function getRazorpayLoadError(): string | null {
  if (!isNativeModuleAvailable()) {
    return 'Razorpay Custom UI native module not found. Rebuild required: npx expo run:android';
  }
  return _loadError;
}

export async function razorpayOpen(
  options: Record<string, any>,
): Promise<PaymentResult> {
  const sdk = getRazorpay();
  if (!sdk) {
    throw new Error(
      getRazorpayLoadError() ||
        'Razorpay SDK not available. Rebuild the native app.',
    );
  }
  return sdk.open(options);
}

export async function razorpayInit(key: string): Promise<void> {
  const sdk = getRazorpay();
  if (!sdk) {
    console.warn('[RazorpayBridge] SDK not available for init');
    return;
  }
  // react-native-customui@2.2.x creates a Promise here but never resolves it.
  // Awaiting that Promise blocks the checkout before Razorpay.open() is called.
  sdk.initRazorpay(key);
}

export function razorpayGetAppsWhichSupportUPI(
  callback: (apps: UPIApp[]) => void,
): void {
  const sdk = getRazorpay();
  if (!sdk) {
    console.warn('[RazorpayBridge] SDK not available, returning empty UPI apps');
    callback(normalizeUPIApps([]));
    return;
  }
  sdk.getAppsWhichSupportUPI((payload: unknown) => {
    callback(normalizeUPIApps(payload));
  });
}
