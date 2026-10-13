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
 *    number is not a VALID number of the country it claims, the customer's own
 *    country wins. A "+" number that is valid as written is always kept: the
 *    customer wrote it (see repairStoredPhone for the stored leftovers).
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
 *  "+6505551234"   US      → +1 650 555 1234 (possible but not a valid Singapore number)
 *  "+6045550199"   CA      → +60 45550199 — a VALID Malaysian number as written, kept
 *                             (a legacy Vancouver number would be repaired by the script)
 *  "+919876543210" DE      → +91 98765 43210 (valid as written; never read as German)
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
    // A number that is VALID as written is what the customer wrote: a German
    // address does not turn "+91 98765 43210" into a German number, even though
    // Germany's numbering plan would accept those digits. (A stored legacy
    // "+<national digits>" that happens to be valid elsewhere is left alone here
    // and listed for review by scripts/fix-international-phones.ts.)
    if (own?.isValid()) return own;
    const national = possible(digits, country);
    if (!own) return national;
    if (!national) return own;
    // Neither reading is valid, both are possible: the customer's own country
    // wins — unless that country's checkout never stored a "+" in front of
    // national digits, in which case the "+" is taken at its word.
    if (national.isValid()) return national;
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
 * it is fine as it is (or cannot be read at all).
 *
 *  - not a possible number as written, or possible but not valid ("+6505551234"
 *    is not a real Singapore number) → the reading for the customer's country,
 *    `ambiguous: false`;
 *  - VALID as written ("+6045550199" is a real Malaysian number) AND valid for
 *    the customer's country (604-555-0199, Vancouver) → `ambiguous: true`: a
 *    judgement call for a human, never applied by default.
 */
export function repairStoredPhone(stored: string | null | undefined, iso: string | null | undefined): { next: string; ambiguous: boolean } | null {
  const current = String(stored ?? '').trim();
  if (!current || !iso) return null;
  const parsed = parsePhoneForCountry(current, iso);
  if (!parsed) return null;
  if (parsed.number !== current) return { next: parsed.number, ambiguous: false };
  // Kept as written. Is there a valid reading for the customer's country too?
  const cc = callingCodeOf(iso);
  if (!cc || !current.startsWith('+') || parsed.countryCallingCode === cc) return null;
  const national = possible(current.replace(/\D/g, ''), iso.toUpperCase());
  if (national && national.isValid() && national.number !== current) return { next: national.number, ambiguous: true };
  return null;
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
