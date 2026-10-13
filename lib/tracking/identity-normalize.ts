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
import {
  isPlaceholderEmail, isPlaceholderEmailHash, isPlaceholderPhone, isPlaceholderPhoneHash, isPlaceholderNamePart, isPlaceholderNameHash, isPlaceholderZipHash,
} from './placeholder-identity';
import { COUNTRIES } from '@/lib/countries';

/** Store's home market — used ONLY when a phone has no "+" and no known country. */
export const DEFAULT_COUNTRY_ISO = 'IN';

const SHA256_RE = /^[a-f0-9]{64}$/;
export function isSha256Hash(val: string | undefined | null): boolean {
  return !!val && SHA256_RE.test(val.trim().toLowerCase());
}

// ─── Country ────────────────────────────────────────────────────────────────

/**
 * Every ISO 3166-1 alpha-2 country code. The store's own list (lib/countries —
 * the address form's dropdown) is only a subset of it: Brazil, Puerto Rico,
 * Gibraltar, Jersey … are real countries a visitor's IP or a Google-completed
 * address can carry. A valid code must never be thrown away just because the
 * dropdown does not offer it — the country would be missing from the event and
 * the customer's phone number would be read as an Indian one.
 */
const ISO_ALPHA2 = new Set((
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' '));

/** Lower-case, accents removed, every run of punctuation / spaces → one space ("Côte d'Ivoire" → "cote d ivoire"). */
function countryKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Other names people and address services use, and names of countries the store list does not carry. */
const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'GB', 'u k': 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  'northern ireland': 'GB', britain: 'GB', 'united kingdom of great britain and northern ireland': 'GB', gbr: 'GB',
  usa: 'US', 'united states of america': 'US', america: 'US', 'u s a': 'US', 'u s': 'US',
  uae: 'AE', emirates: 'AE', are: 'AE', ind: 'IN', bharat: 'IN', ksa: 'SA', sau: 'SA',
  holland: 'NL', 'the netherlands': 'NL', 'south korea': 'KR', korea: 'KR', 'republic of korea': 'KR', 'korea republic of': 'KR',
  russia: 'RU', 'russian federation': 'RU', aus: 'AU', deu: 'DE', deutschland: 'DE', fra: 'FR', sgp: 'SG', nzl: 'NZ',
  turkiye: 'TR', 'viet nam': 'VN', czechia: 'CZ', 'cote d ivoire': 'CI', 'cote divoire': 'CI', macao: 'MO',
  'north macedonia': 'MK', burma: 'MM', 'myanmar burma': 'MM', 'republic of ireland': 'IE', 'cabo verde': 'CV',
  'brunei darussalam': 'BN', 'hong kong sar': 'HK', 'hong kong sar china': 'HK', 'bosnia herzegovina': 'BA',
  'trinidad tobago': 'TT', 'palestinian territories': 'PS', espana: 'ES', mexico: 'MX', italia: 'IT',
  // ISO countries missing from the store's dropdown list
  'antigua and barbuda': 'AG', anguilla: 'AI', antarctica: 'AQ', 'american samoa': 'AS', aruba: 'AW',
  'aland islands': 'AX', 'saint barthelemy': 'BL', 'st barthelemy': 'BL', bermuda: 'BM',
  'caribbean netherlands': 'BQ', 'bonaire sint eustatius and saba': 'BQ', bonaire: 'BQ',
  brazil: 'BR', brasil: 'BR', 'bouvet island': 'BV', 'cocos islands': 'CC', 'cocos keeling islands': 'CC',
  'democratic republic of the congo': 'CD', 'democratic republic of congo': 'CD', 'dr congo': 'CD', drc: 'CD', 'congo kinshasa': 'CD',
  'central african republic': 'CF', 'republic of the congo': 'CG', 'republic of congo': 'CG', congo: 'CG', 'congo brazzaville': 'CG',
  'cook islands': 'CK', curacao: 'CW', 'christmas island': 'CX', dominica: 'DM', 'western sahara': 'EH', eritrea: 'ER',
  'falkland islands': 'FK', micronesia: 'FM', 'federated states of micronesia': 'FM', 'faroe islands': 'FO',
  gabon: 'GA', grenada: 'GD', 'french guiana': 'GF', guernsey: 'GG', gibraltar: 'GI', greenland: 'GL',
  gambia: 'GM', 'the gambia': 'GM', guinea: 'GN', guadeloupe: 'GP', 'equatorial guinea': 'GQ',
  'south georgia and the south sandwich islands': 'GS', guam: 'GU', 'guinea bissau': 'GW',
  'heard island and mcdonald islands': 'HM', 'isle of man': 'IM', 'british indian ocean territory': 'IO', jersey: 'JE',
  kiribati: 'KI', comoros: 'KM', 'saint kitts and nevis': 'KN', 'st kitts and nevis': 'KN', 'north korea': 'KP',
  'cayman islands': 'KY', 'saint lucia': 'LC', 'st lucia': 'LC', lesotho: 'LS', 'saint martin': 'MF', 'st martin': 'MF',
  'marshall islands': 'MH', 'northern mariana islands': 'MP', martinique: 'MQ', mauritania: 'MR', montserrat: 'MS',
  'new caledonia': 'NC', 'norfolk island': 'NF', nauru: 'NR', niue: 'NU', 'french polynesia': 'PF',
  'saint pierre and miquelon': 'PM', 'st pierre and miquelon': 'PM', 'pitcairn islands': 'PN', pitcairn: 'PN',
  'puerto rico': 'PR', palau: 'PW', reunion: 'RE', 'solomon islands': 'SB', 'saint helena': 'SH', 'st helena': 'SH',
  'svalbard and jan mayen': 'SJ', 'san marino': 'SM', 'south sudan': 'SS', 'sao tome and principe': 'ST',
  'sint maarten': 'SX', eswatini: 'SZ', swaziland: 'SZ', 'turks and caicos islands': 'TC', chad: 'TD',
  'french southern territories': 'TF', tokelau: 'TK', 'timor leste': 'TL', 'east timor': 'TL', tonga: 'TO', tuvalu: 'TV',
  'united states minor outlying islands': 'UM', 'u s outlying islands': 'UM', 'vatican city': 'VA', 'holy see': 'VA',
  'saint vincent and the grenadines': 'VC', 'st vincent and the grenadines': 'VC', 'british virgin islands': 'VG',
  'u s virgin islands': 'VI', 'us virgin islands': 'VI', 'united states virgin islands': 'VI',
  vanuatu: 'VU', 'wallis and futuna': 'WF', samoa: 'WS', mayotte: 'YT',
};

/** Store country names (lib/countries) by the same key. */
const COUNTRY_NAMES: Map<string, string> = new Map(COUNTRIES.map(c => [countryKey(c.name), c.code]));

/**
 * "United Kingdom" → "GB", "uk" → "GB", "IN" → "IN", "br" → "BR", "Narnia" → "" (unknown).
 * Returns UPPERCASE ISO alpha-2, or "" if it cannot be resolved with confidence.
 */
export function toCountryIso(nameOrCode: string | undefined | null): string {
  if (!nameOrCode) return '';
  const raw = nameOrCode.trim();
  if (!raw || isSha256Hash(raw)) return '';
  const key = countryKey(raw);

  if (/^[a-z]{2}$/.test(key)) {
    const up = key.toUpperCase();
    if (up === 'UK') return 'GB';
    if (ISO_ALPHA2.has(up)) return up;
  }
  return COUNTRY_ALIASES[key] || COUNTRY_NAMES.get(key) || '';
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

/** Lowercase, keep letters + combining marks (any script: "ë", Devanagari matras) and digits; drop punctuation & spaces. */
function lettersDigitsOnly(val: string): string {
  return val
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}]/gu, '');
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
  // Placeholder values typed where the form demands a postcode the country does
  // not have (UAE, Hong Kong, Ireland …): "00000", "0", "NA", "none" — shared by
  // many customers, never an address.
  if (/^0+$/.test(compact) || ['na', 'n/a', 'none', 'null', 'nil', 'xxx', 'xxxx', 'xxxxx'].includes(compact)) return '';

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
  // Placeholder / dummy identities (guest@zicabella.com, "Valued Customer",
  // 9999999999 …) are dropped, raw or already hashed: they are not a person.
  const em = isPlaceholderEmail(src.em) || isPlaceholderEmailHash(src.em) ? '' : src.em;
  const ph = (isPlaceholderPhone(src.ph) && !isSha256Hash(src.ph || '')) || isPlaceholderPhoneHash(src.ph) ? '' : src.ph;
  const fn = isPlaceholderNamePart(src.fn) || isPlaceholderNameHash(src.fn) ? '' : src.fn;
  const ln = isPlaceholderNamePart(src.ln) || isPlaceholderNameHash(src.ln) ? '' : src.ln;
  const zp = isPlaceholderZipHash(src.zp) ? '' : src.zp;
  return {
    em: pass(em) || normalizeEmail(em),
    ph: pass(ph) || normalizePhone(ph, countryIso),
    fn: pass(fn) || normalizeName(fn),
    ln: pass(ln) || normalizeName(ln),
    ct: pass(src.ct) || normalizeCity(src.ct),
    st: pass(src.st) || normalizeState(src.st, countryIso),
    zp: pass(zp) || normalizeZip(zp, countryIso),
    country: pass(src.country) || countryIso.toLowerCase(),
  };
}
