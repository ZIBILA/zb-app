/**
 * Shared Meta User Data Builder
 *
 * Single source of truth for constructing the `user_data` object sent to
 * Meta Pixel (via fbq advanced matching) and CAPI (via /api/meta/event).
 *
 * Ensures:
 * - Only real, non-empty, non-demo values are included
 * - Every field is normalized per Meta's spec before hashing
 * - No placeholder, empty string, or "N/A" value ever reaches Meta
 * - Identical behavior across all event types (no per-event drift)
 */

import { isDemoValue } from './metaPixel';
import { isPlaceholderEmailHash, isPlaceholderNameHash, isPlaceholderPhoneHash, isPlaceholderZipHash } from './tracking/placeholder-identity';
import {
  normalizePhone as sharedNormalizePhone,
  normalizeCountry as sharedNormalizeCountry,
} from './tracking/identity-normalize';

// ── Types ──

export interface MetaUserSignals {
  // Browser/session identifiers (never hashed)
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string;
  fbc?: string;
  external_id?: string;
  fb_login_id?: string;

  // PII fields (will be normalized + hashed)
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  gender?: string;
  dob?: string;      // Expected YYYYMMDD or with separators

  // Pre-hashed PII from cookies (64-char hex strings)
  em?: string;
  ph?: string;
  fn?: string;
  ln?: string;
  ct?: string;
  st?: string;
  zp?: string;
  ge?: string;
  db?: string;
}

export interface MetaUserData {
  [key: string]: string | string[] | undefined;
}

// ── Normalization (shared between client and server) ──

export function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

/**
 * Worldwide: delegates to lib/tracking/identity-normalize (one implementation
 * for every Meta path). The customer's country decides the calling code; India
 * is only the last-resort default for a bare number with no country.
 */
export function normalizePhone(p: string, countryIso?: string | null): string {
  return sharedNormalizePhone(p, countryIso);
}

export function normalizeGeneric(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** ISO alpha-2 lowercase ("United Kingdom" → "gb"), "" when unknown. */
export function normalizeCountry(c: string): string {
  return sharedNormalizeCountry(c);
}

export function normalizeDob(d: string): string {
  return d.trim().replace(/\D/g, '');
}

// ── Hash detection ──

function isHash(val: string | undefined): boolean {
  if (!val) return false;
  return /^[a-f0-9]{64}$/.test(val.trim().toLowerCase());
}

// ── Cleaning / validation ──

function isRealValue(val: string | undefined | null): val is string {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  // Reject known placeholder patterns
  const lower = trimmed.toLowerCase();
  if (lower === 'n/a' || lower === 'na' || lower === 'unknown' || lower === 'null' || lower === 'undefined') return false;
  return true;
}

export const DEMO_PHONE_HASHES = [
  // +919876543210 / 9876543210 (current demo)
  '92b5072176e723878b5e06ff3ca61898e4eb74e8c46642a0f2db800b17364ab0',
  // +919999999999 / 9999999999 (legacy demo — keep blocked)
  '5a15bf8887c41bb21f3b33a5bf1a06064711a6495cbbd97ddb92995d5df8b1b5',
];

export const DEMO_EMAIL_HASHES = [
  '0816700ca2bdcad72bb405f3f9d7e0e0a7636d4e415453c655547657abd6af00',
  '7462108984f629db2ced1aeb2dc3e747e53a2e1c607059f72955ab864c724335'
];

function isDemoHash(field: 'em' | 'ph', hash: string | undefined): boolean {
  if (!hash) return false;
  const clean = hash.trim().toLowerCase();
  return field === 'ph'
    ? DEMO_PHONE_HASHES.includes(clean) || isPlaceholderPhoneHash(clean)
    : DEMO_EMAIL_HASHES.includes(clean) || isPlaceholderEmailHash(clean);
}

/**
 * Build Meta user_data for the CLIENT side (fbq advanced matching).
 *
 * Takes raw signals + pre-hashed cookie values and returns an object
 * containing only keys with real values. Pre-hashed values (from cookies)
 * are passed through as-is. Raw values are NOT hashed here — the Pixel SDK
 * handles hashing for advanced matching, or the cookies are already hashed.
 *
 * For the client side, the primary source is pre-hashed cookies (em, ph, etc.)
 * which are already SHA-256 hashed by saveUserDataToCookies.
 */
export function buildClientUserData(signals: MetaUserSignals): MetaUserData {
  const result: MetaUserData = {};

  // Browser identifiers (never hashed, pass through)
  if (isRealValue(signals.client_user_agent)) result.client_user_agent = signals.client_user_agent!;
  if (isRealValue(signals.fbp)) result.fbp = signals.fbp!;
  if (isRealValue(signals.fbc)) result.fbc = signals.fbc!;
  if (isRealValue(signals.external_id)) result.external_id = signals.external_id!;
  if (isRealValue(signals.fb_login_id)) result.fb_login_id = signals.fb_login_id!;

  // Pre-hashed PII from cookies — validate they're real hashes, not demo
  if (isRealValue(signals.em) && isHash(signals.em) && !isDemoHash('em', signals.em)) result.em = signals.em!;
  if (isRealValue(signals.ph) && isHash(signals.ph) && !isDemoHash('ph', signals.ph)) result.ph = signals.ph!;
  // Hashed placeholder names ('customer', 'guest', 'valued' …) are never sent.
  if (isRealValue(signals.fn) && isHash(signals.fn) && !isPlaceholderNameHash(signals.fn)) result.fn = signals.fn!;
  if (isRealValue(signals.ln) && isHash(signals.ln) && !isPlaceholderNameHash(signals.ln)) result.ln = signals.ln!;
  if (isRealValue(signals.ct) && isHash(signals.ct)) result.ct = signals.ct!;
  if (isRealValue(signals.st) && isHash(signals.st)) result.st = signals.st!;
  if (isRealValue(signals.zp) && isHash(signals.zp) && !isPlaceholderZipHash(signals.zp)) result.zp = signals.zp!;
  if (isRealValue(signals.country) && isHash(signals.country)) result.country = signals.country!;
  if (isRealValue(signals.ge) && isHash(signals.ge)) result.ge = signals.ge!;
  if (isRealValue(signals.db) && isHash(signals.db)) result.db = signals.db!;

  return result;
}

/**
 * Build Meta user_data for the SERVER side (CAPI).
 *
 * Takes a merged set of signals (from cookies, request body, session) and
 * returns an object containing only keys with real values. Values that are
 * already hashed (64-char hex) pass through; raw values will be hashed by
 * metaCapi.ts's cleanAndHash() layer downstream.
 *
 * This function is the single gateway — it filters out demo values, empty
 * strings, and placeholder data before anything reaches sendCapiEvent().
 */
export function buildServerUserData(signals: MetaUserSignals): MetaUserData {
  const result: MetaUserData = {};

  // Browser/transport identifiers (never hashed)
  if (isRealValue(signals.client_ip_address)) result.client_ip_address = signals.client_ip_address!;
  if (isRealValue(signals.client_user_agent)) result.client_user_agent = signals.client_user_agent!;
  if (isRealValue(signals.fbp)) result.fbp = signals.fbp!;
  if (isRealValue(signals.fbc)) result.fbc = signals.fbc!;
  if (isRealValue(signals.external_id)) result.external_id = signals.external_id!;
  if (isRealValue(signals.fb_login_id)) result.fb_login_id = signals.fb_login_id!;

  // PII fields — check against demo blocklist (raw values) and validate
  // For em/ph: may be pre-hashed (from cookies) or raw (from session)
  const emVal = signals.em || signals.email;
  if (isRealValue(emVal)) {
    // If raw (not a hash), check demo blocklist. If hashed, check demo hash list.
    if (!isHash(emVal) && isDemoValue('email', emVal!)) {
      // skip — demo email
    } else if (isHash(emVal) && isDemoHash('em', emVal!)) {
      // skip — demo email hash
    } else {
      result.em = emVal!;
    }
  }

  const phVal = signals.ph || signals.phone;
  if (isRealValue(phVal)) {
    if (!isHash(phVal) && isDemoValue('phone', phVal!)) {
      // skip — demo phone
    } else if (isHash(phVal) && isDemoHash('ph', phVal!)) {
      // skip — demo phone hash
    } else {
      result.ph = phVal!;
    }
  }

  // Names: demo / placeholder names ('Customer', 'Valued Customer', 'Guest' …),
  // raw or hashed (zb_guest_fn / zb_guest_ln cookies), are never sent.
  const nameOk = (v: string | undefined) =>
    isRealValue(v) && !(isHash(v) ? isPlaceholderNameHash(v!) : isDemoValue('name', v!));
  const fnVal = signals.fn || signals.firstName;
  if (nameOk(fnVal)) result.fn = fnVal!;

  const lnVal = signals.ln || signals.lastName;
  if (nameOk(lnVal)) result.ln = lnVal!;

  const ctVal = signals.ct || signals.city;
  if (isRealValue(ctVal)) result.ct = ctVal!;

  const stVal = signals.st || signals.state;
  if (isRealValue(stVal)) result.st = stVal!;

  const zpVal = signals.zp || signals.zip;
  if (isRealValue(zpVal)) result.zp = zpVal!;

  const countryVal = signals.country;
  if (isRealValue(countryVal)) result.country = countryVal!;

  const geVal = signals.ge || signals.gender;
  if (isRealValue(geVal)) result.ge = geVal!;

  const dbVal = signals.db || signals.dob;
  if (isRealValue(dbVal)) result.db = dbVal!;

  return result;
}
