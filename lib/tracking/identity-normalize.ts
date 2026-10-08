/**
 * Isomorphic (browser + server) normalization of customer identity fields
 * for ad-platform matching (Snap CAPI/Pixel, Meta CAPI/Pixel, OpenAI Ads).
 *
 * Rules follow Snap's Conversions API "Parameters" spec, which match Meta's:
 *   em  – trim + lowercase
 *   ph  – digits only, WITH country calling code, no "+", no leading 00 / trunk 0
 *   fn/ln – lowercase, no punctuation (UTF‑8 letters such as "ë" are kept)
 *   ct  – lowercase, no punctuation, no spaces
 *   st  – US: 2-letter ANSI code lowercase; elsewhere lowercase, no punctuation/spaces
 *   zp  – lowercase, no spaces/dashes; US: first 5 digits; UK: area+district+sector
 *   country – ISO‑3166 alpha‑2, lowercase
 *
 * The store sells worldwide, so NOTHING here may assume India except as the
 * last-resort default when a phone number arrives with no country at all.
 *
 * No hashing happens here — see sha256Hex (server) / sha256 (browser).
 */
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';
import { COUNTRIES } from '@/lib/countries';

/** Store's home market — used ONLY when a phone has no "+" and no known country. */
export const DEFAULT_COUNTRY_ISO = 'IN';

const SHA256_RE = /^[a-f0-9]{64}$/;
export function isSha256Hash(val: string | undefined | null): boolean {
  return !!val && SHA256_RE.test(val.trim().toLowerCase());
}

// ─── Country ────────────────────────────────────────────────────────────────

const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  'northern ireland': 'GB', britain: 'GB',
  usa: 'US', 'united states of america': 'US', america: 'US', 'u s a': 'US', 'u s': 'US',
  uae: 'AE', emirates: 'AE', ind: 'IN', bharat: 'IN', ksa: 'SA',
  holland: 'NL', 'south korea': 'KR', korea: 'KR', russia: 'RU',
};

/**
 * "United Kingdom" → "GB", "uk" → "GB", "IN" → "IN", "Deutschland"? → "" (unknown).
 * Returns UPPERCASE ISO alpha-2, or "" if it cannot be resolved with confidence.
 */
export function toCountryIso(nameOrCode: string | undefined | null): string {
  if (!nameOrCode) return '';
  const raw = nameOrCode.trim();
  if (!raw || isSha256Hash(raw)) return '';
  const key = raw.toLowerCase().replace(/[.\-_]/g, ' ').replace(/\s+/g, ' ').trim();

  if (/^[a-z]{2}$/.test(key)) {
    const up = key.toUpperCase();
    if (up === 'UK') return 'GB';
    if (COUNTRIES.some(c => c.code === up)) return up;
  }
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  const byName = COUNTRIES.find(c => c.name.toLowerCase() === key);
  return byName ? byName.code : '';
}

/** ISO alpha-2 lowercase, as the ad platforms expect before hashing. */
export function normalizeCountry(nameOrCode: string | undefined | null): string {
  return toCountryIso(nameOrCode).toLowerCase();
}

// ─── Email ──────────────────────────────────────────────────────────────────

export function normalizeEmail(email: string | undefined | null): string {
  if (!email) return '';
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

// ─── Phone ──────────────────────────────────────────────────────────────────

/**
 * Returns digits-only E.164 without "+" (e.g. "447700900123", "919876543210",
 * "14155552671"), or "" if the number cannot be parsed as a possible number.
 *
 * countryIso is the CUSTOMER's country (shipping/billing), NOT the store's.
 * "+44…" / "0044…" numbers are parsed by their own prefix regardless of countryIso.
 */
export function normalizePhone(phone: string | undefined | null, countryIso?: string | null): string {
  if (!phone) return '';
  let p = phone.trim();
  if (!p || isSha256Hash(p)) return '';
  if (p.startsWith('00')) p = '+' + p.slice(2);

  const iso = (toCountryIso(countryIso || '') || DEFAULT_COUNTRY_ISO) as CountryCode;

  // Bare digits that already START with the country's calling code, e.g. "919876543210".
  // Try "+<digits>" first when the digit count is long enough to contain a calling code.
  const digitsOnly = p.replace(/\D/g, '');
  const candidates: string[] = [];
  if (p.startsWith('+')) {
    candidates.push(p);
  } else {
    candidates.push(p); // national format for the customer's country
    if (digitsOnly.length >= 11) candidates.push('+' + digitsOnly);
  }

  for (const c of candidates) {
    try {
      const parsed = c.startsWith('+')
        ? parsePhoneNumberFromString(c)
        : parsePhoneNumberFromString(c, iso);
      if (parsed && parsed.isPossible()) {
        return parsed.number.replace(/^\+/, '');
      }
    } catch {
      /* try next candidate */
    }
  }
  return '';
}

// ─── Names / City ───────────────────────────────────────────────────────────

/** Lowercase, keep letters (any script, incl. accents) and digits, drop punctuation & spaces. */
function lettersDigitsOnly(val: string): string {
  return val
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function normalizeName(name: string | undefined | null): string {
  if (!name || isSha256Hash(name)) return '';
  return lettersDigitsOnly(name);
}

/** "Rahul Kumar Sharma" → { fn: "rahul", ln: "kumarsharma" } (pre-normalization raw strings). */
export function splitFullName(full: string | undefined | null): { fn?: string; ln?: string } {
  if (!full) return {};
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  return { fn: parts[0], ln: parts.length > 1 ? parts.slice(1).join(' ') : undefined };
}

export function normalizeCity(city: string | undefined | null): string {
  if (!city || isSha256Hash(city)) return '';
  return lettersDigitsOnly(city);
}

// ─── State ──────────────────────────────────────────────────────────────────

const US_STATES: Record<string, string> = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca',
  colorado: 'co', connecticut: 'ct', delaware: 'de', districtofcolumbia: 'dc',
  washingtondc: 'dc', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id',
  illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky',
  louisiana: 'la', maine: 'me', maryland: 'md', massachusetts: 'ma',
  michigan: 'mi', minnesota: 'mn', mississippi: 'ms', missouri: 'mo',
  montana: 'mt', nebraska: 'ne', nevada: 'nv', newhampshire: 'nh',
  newjersey: 'nj', newmexico: 'nm', newyork: 'ny', northcarolina: 'nc',
  northdakota: 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or',
  pennsylvania: 'pa', rhodeisland: 'ri', southcarolina: 'sc', southdakota: 'sd',
  tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt', virginia: 'va',
  washington: 'wa', westvirginia: 'wv', wisconsin: 'wi', wyoming: 'wy',
  puertorico: 'pr', guam: 'gu', virginislands: 'vi', americansamoa: 'as',
};
const US_STATE_CODES = new Set(Object.values(US_STATES));

export function normalizeState(state: string | undefined | null, countryIso?: string | null): string {
  if (!state || isSha256Hash(state)) return '';
  const compact = lettersDigitsOnly(state);
  if (!compact) return '';
  if (toCountryIso(countryIso || '') === 'US') {
    if (US_STATE_CODES.has(compact)) return compact;
    return US_STATES[compact] || compact;
  }
  return compact;
}

// ─── Postal code ────────────────────────────────────────────────────────────

export function normalizeZip(zip: string | undefined | null, countryIso?: string | null): string {
  if (!zip || isSha256Hash(zip)) return '';
  const iso = toCountryIso(countryIso || '');
  const compact = zip.trim().toLowerCase().replace(/[\s-]/g, '');
  if (!compact) return '';

  if (iso === 'US') {
    const m = compact.match(/^(\d{5})/);
    return m ? m[1] : '';
  }
  if (iso === 'GB') {
    // Full UK postcode = outward (2–4 chars) + inward (digit + 2 letters).
    // Spec wants "area, district and sector" = outward + first digit of inward.
    const m = compact.match(/^([a-z]{1,2}\d[a-z\d]?)(\d)[a-z]{2}$/);
    if (m) return `${m[1]}${m[2]}`;
    return compact; // already outward-only / partial — keep as given
  }
  return compact;
}

// ─── Aggregate ──────────────────────────────────────────────────────────────

export interface RawIdentity {
  em?: string | null;
  ph?: string | null;
  fn?: string | null;
  ln?: string | null;
  ct?: string | null;
  st?: string | null;
  zp?: string | null;
  country?: string | null;
}

/**
 * Normalize every field that is still raw. Fields that are already SHA-256
 * hashes are passed through untouched (lowercased) so callers can mix
 * cookie-sourced hashes with raw checkout data safely.
 */
export function normalizeIdentity(src: RawIdentity): Record<keyof RawIdentity, string> {
  const pass = (v: string | null | undefined) => (v && isSha256Hash(v) ? v.trim().toLowerCase() : '');
  const countryIso = toCountryIso(src.country || '');
  return {
    em: pass(src.em) || normalizeEmail(src.em),
    ph: pass(src.ph) || normalizePhone(src.ph, countryIso),
    fn: pass(src.fn) || normalizeName(src.fn),
    ln: pass(src.ln) || normalizeName(src.ln),
    ct: pass(src.ct) || normalizeCity(src.ct),
    st: pass(src.st) || normalizeState(src.st, countryIso),
    zp: pass(src.zp) || normalizeZip(src.zp, countryIso),
    country: pass(src.country) || countryIso.toLowerCase(),
  };
}
