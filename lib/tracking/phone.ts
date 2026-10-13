/**
 * One way of reading a customer's phone number, shared by the checkout / profile
 * validation (what gets stored) and the ad-platform normalization (what gets
 * hashed). Isomorphic; depends on nothing but libphonenumber.
 *
 * The number is always read for the country it was written in — the customer's
 * own country, never the store's. Two stored shapes need care:
 *
 *  - Numbers with a country code: "+1 415 555 2671", "0044 7700 900123",
 *    "919876543210". Read by their own code whatever the address says.
 *  - Numbers the old checkout stored for non-Indian customers: it put "+" in
 *    front of the national digits ("+4155552671", "+07700900123"), so read
 *    literally they belong to another country or to nobody. When such a "+"
 *    number cannot be a number of the country it claims, or the same digits make
 *    a BETTER number of the customer's own country, the customer's country wins.
 */
import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode, type PhoneNumber } from 'libphonenumber-js/min';

/** "US" → "1", "GB" → "44", "IN" → "91"; null for an unknown code. */
export function callingCodeOf(iso: string | null | undefined): string | null {
  if (!iso || !/^[A-Za-z]{2}$/.test(iso)) return null;
  try { return getCountryCallingCode(iso.toUpperCase() as CountryCode); } catch { return null; }
}

/** "0044 …" / "+0044 …" (international prefix typed out) → "+44 …"; otherwise trimmed. */
function withPlus(raw: string | null | undefined): string {
  const p = String(raw ?? '').trim();
  return p.replace(/^\+?\s*00(?=\s*\d)/, '+').replace(/^\+\s+/, '+');
}

function possible(text: string, defaultCountry?: string): PhoneNumber | null {
  try {
    const n = defaultCountry
      ? parsePhoneNumberFromString(text, defaultCountry.toUpperCase() as CountryCode)
      : parsePhoneNumberFromString(text);
    return n && n.isPossible() ? n : null;
  } catch {
    return null;
  }
}

/**
 * Parse `raw` as the number of a customer in country `iso` (ISO 3166-1 alpha-2;
 * may be empty when the country is unknown). Returns a *possible* number or null.
 *
 *  "+14155552671"  any     → +1 415 555 2671 (its own code)
 *  "+4155552671"   US      → +1 415 555 2671 (not a Swiss number; the US reading is)
 *  "+6045550199"   CA      → +1 604 555 0199 (a possible Malaysian number too — the
 *                             customer's own country wins the tie)
 *  "+919876543210" AE      → +91 98765 43210 (valid Indian number; the UAE reading is not)
 *  "4915123456789" DE      → +49 1512 3456789 (already carries the German code)
 *  "07700 900123"  GB      → +44 7700 900123
 *  "9876543210"    (none)  → null — see normalizePhone for the Indian-mobile default
 */
/**
 * Countries whose checkout always stored a real E.164 number: a "+" number of a
 * customer there is read as written. Everywhere else the old checkout stored the
 * national digits behind a "+", so a "+" number that also reads as a number of
 * the customer's own country is treated as one (see parsePhoneForCountry).
 */
const COUNTRIES_WITH_TRUSTED_PLUS = new Set(['IN']);

export function parsePhoneForCountry(raw: string | null | undefined, iso?: string | null): PhoneNumber | null {
  const p = withPlus(raw);
  if (!p) return null;
  const digits = p.replace(/\D/g, '');
  if (!digits) return null;
  const country = iso && /^[A-Za-z]{2}$/.test(iso) ? iso.toUpperCase() : '';
  const cc = callingCodeOf(country);

  if (p.startsWith('+')) {
    const own = possible(p);
    if (own && (!cc || own.countryCallingCode === cc)) return own;
    if (!cc) return own;
    const national = possible(digits, country);
    if (!own) return national;
    if (!national) return own;
    // Both readings are possible. A reading that is also VALID beats one that is
    // not. On a tie the customer's own country wins — unless that country's
    // checkout never stored a "+" in front of national digits.
    if (own.isValid() !== national.isValid()) return own.isValid() ? own : national;
    return COUNTRIES_WITH_TRUSTED_PLUS.has(country) ? own : national;
  }

  // Bare digits that already start with the customer's own calling code
  // ("919876543210" for India, "4915123456789" for Germany) must not get it twice.
  if (cc && digits.length >= 11) {
    const withCode = possible('+' + digits);
    if (withCode && withCode.countryCallingCode === cc) return withCode;
  }
  if (country) {
    const national = possible(p, country);
    if (national) return national;
  }
  if (digits.length >= 11) {
    const withCode = possible('+' + digits);
    if (withCode) return withCode;
  }
  return null;
}

/**
 * What a stored phone number should become for a customer in `iso`, or null when
 * it is fine as it is (or cannot be read at all). `ambiguous` is true when the
 * stored value is ALSO a possible number as written (of some other country), so
 * the repair is a judgement call rather than a certainty.
 */
export function repairStoredPhone(stored: string | null | undefined, iso: string | null | undefined): { next: string; ambiguous: boolean } | null {
  const current = String(stored ?? '').trim();
  if (!current || !iso) return null;
  const parsed = parsePhoneForCountry(current, iso);
  if (!parsed || parsed.number === current) return null;
  return { next: parsed.number, ambiguous: carriesCountryCode(current) };
}

/**
 * true when the number carries its own country code ("+…", "00…", or bare digits
 * long enough to include one) and reads as a possible number that way.
 */
export function carriesCountryCode(raw: string | null | undefined): boolean {
  const p = withPlus(raw);
  if (!p) return false;
  const digits = p.replace(/\D/g, '');
  if (p.startsWith('+')) return !!possible(p);
  return digits.length >= 11 && !!possible('+' + digits);
}
