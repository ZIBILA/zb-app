/**
 * ISO Country list and helper functions for international address management.
 */

import { toE164 } from "@/lib/shopify-phone";
import { parsePhoneForCountry } from "@/lib/tracking/phone";

export interface CountryOption {
  name: string;
  code: string; // 2-letter ISO alpha-2 code
}

export const COUNTRIES: CountryOption[] = [
  { name: "India", code: "IN" },
  { name: "United States", code: "US" },
  { name: "United Kingdom", code: "GB" },
  { name: "Australia", code: "AU" },
  { name: "Canada", code: "CA" },
  { name: "United Arab Emirates", code: "AE" },
  { name: "Singapore", code: "SG" },
  { name: "Saudi Arabia", code: "SA" },
  { name: "Germany", code: "DE" },
  { name: "France", code: "FR" },
  { name: "Afghanistan", code: "AF" },
  { name: "Albania", code: "AL" },
  { name: "Algeria", code: "DZ" },
  { name: "Andorra", code: "AD" },
  { name: "Angola", code: "AO" },
  { name: "Argentina", code: "AR" },
  { name: "Armenia", code: "AM" },
  { name: "Austria", code: "AT" },
  { name: "Azerbaijan", code: "AZ" },
  { name: "Bahamas", code: "BS" },
  { name: "Bahrain", code: "BH" },
  { name: "Bangladesh", code: "BD" },
  { name: "Barbados", code: "BB" },
  { name: "Belarus", code: "BY" },
  { name: "Belgium", code: "BE" },
  { name: "Belize", code: "BZ" },
  { name: "Benin", code: "BJ" },
  { name: "Bhutan", code: "BT" },
  { name: "Bolivia", code: "BO" },
  { name: "Bosnia and Herzegovina", code: "BA" },
  { name: "Botswana", code: "BW" },
  { name: "Brunei", code: "BN" },
  { name: "Bulgaria", code: "BG" },
  { name: "Burkina Faso", code: "BF" },
  { name: "Burundi", code: "BI" },
  { name: "Cambodia", code: "KH" },
  { name: "Cameroon", code: "CM" },
  { name: "Cape Verde", code: "CV" },
  { name: "Chile", code: "CL" },
  { name: "China", code: "CN" },
  { name: "Colombia", code: "CO" },
  { name: "Costa Rica", code: "CR" },
  { name: "Croatia", code: "HR" },
  { name: "Cuba", code: "CU" },
  { name: "Cyprus", code: "CY" },
  { name: "Czech Republic", code: "CZ" },
  { name: "Denmark", code: "DK" },
  { name: "Djibouti", code: "DJ" },
  { name: "Dominican Republic", code: "DO" },
  { name: "Ecuador", code: "EC" },
  { name: "Egypt", code: "EG" },
  { name: "El Salvador", code: "SV" },
  { name: "Estonia", code: "EE" },
  { name: "Ethiopia", code: "ET" },
  { name: "Fiji", code: "FJ" },
  { name: "Finland", code: "FI" },
  { name: "Georgia", code: "GE" },
  { name: "Ghana", code: "GH" },
  { name: "Greece", code: "GR" },
  { name: "Guatemala", code: "GT" },
  { name: "Guyana", code: "GY" },
  { name: "Haiti", code: "HT" },
  { name: "Honduras", code: "HN" },
  { name: "Hong Kong", code: "HK" },
  { name: "Hungary", code: "HU" },
  { name: "Iceland", code: "IS" },
  { name: "Indonesia", code: "ID" },
  { name: "Iran", code: "IR" },
  { name: "Iraq", code: "IQ" },
  { name: "Ireland", code: "IE" },
  { name: "Israel", code: "IL" },
  { name: "Italy", code: "IT" },
  { name: "Ivory Coast", code: "CI" },
  { name: "Jamaica", code: "JM" },
  { name: "Japan", code: "JP" },
  { name: "Jordan", code: "JO" },
  { name: "Kazakhstan", code: "KZ" },
  { name: "Kenya", code: "KE" },
  { name: "Kuwait", code: "KW" },
  { name: "Kyrgyzstan", code: "KG" },
  { name: "Laos", code: "LA" },
  { name: "Latvia", code: "LV" },
  { name: "Lebanon", code: "LB" },
  { name: "Liberia", code: "LR" },
  { name: "Libya", code: "LY" },
  { name: "Liechtenstein", code: "LI" },
  { name: "Lithuania", code: "LT" },
  { name: "Luxembourg", code: "LU" },
  { name: "Macau", code: "MO" },
  { name: "Macedonia", code: "MK" },
  { name: "Madagascar", code: "MG" },
  { name: "Malawi", code: "MW" },
  { name: "Malaysia", code: "MY" },
  { name: "Maldives", code: "MV" },
  { name: "Mali", code: "ML" },
  { name: "Malta", code: "MT" },
  { name: "Mauritius", code: "MU" },
  { name: "Mexico", code: "MX" },
  { name: "Moldova", code: "MD" },
  { name: "Monaco", code: "MC" },
  { name: "Mongolia", code: "MN" },
  { name: "Montenegro", code: "ME" },
  { name: "Morocco", code: "MA" },
  { name: "Mozambique", code: "MZ" },
  { name: "Myanmar", code: "MM" },
  { name: "Namibia", code: "NA" },
  { name: "Nepal", code: "NP" },
  { name: "Netherlands", code: "NL" },
  { name: "New Zealand", code: "NZ" },
  { name: "Nicaragua", code: "NI" },
  { name: "Niger", code: "NE" },
  { name: "Nigeria", code: "NG" },
  { name: "Norway", code: "NO" },
  { name: "Oman", code: "OM" },
  { name: "Pakistan", code: "PK" },
  { name: "Palestine", code: "PS" },
  { name: "Panama", code: "PA" },
  { name: "Papua New Guinea", code: "PG" },
  { name: "Paraguay", code: "PY" },
  { name: "Peru", code: "PE" },
  { name: "Philippines", code: "PH" },
  { name: "Poland", code: "PL" },
  { name: "Portugal", code: "PT" },
  { name: "Qatar", code: "QA" },
  { name: "Romania", code: "RO" },
  { name: "Russia", code: "RU" },
  { name: "Rwanda", code: "RW" },
  { name: "Senegal", code: "SN" },
  { name: "Serbia", code: "RS" },
  { name: "Seychelles", code: "SC" },
  { name: "Sierra Leone", code: "SL" },
  { name: "Slovakia", code: "SK" },
  { name: "Slovenia", code: "SI" },
  { name: "Somalia", code: "SO" },
  { name: "South Africa", code: "ZA" },
  { name: "South Korea", code: "KR" },
  { name: "Spain", code: "ES" },
  { name: "Sri Lanka", code: "LK" },
  { name: "Sudan", code: "SD" },
  { name: "Suriname", code: "SR" },
  { name: "Sweden", code: "SE" },
  { name: "Switzerland", code: "CH" },
  { name: "Syria", code: "SY" },
  { name: "Taiwan", code: "TW" },
  { name: "Tajikistan", code: "TJ" },
  { name: "Tanzania", code: "TZ" },
  { name: "Thailand", code: "TH" },
  { name: "Togo", code: "TG" },
  { name: "Trinidad and Tobago", code: "TT" },
  { name: "Tunisia", code: "TN" },
  { name: "Turkey", code: "TR" },
  { name: "Turkmenistan", code: "TM" },
  { name: "Uganda", code: "UG" },
  { name: "Ukraine", code: "UA" },
  { name: "Uruguay", code: "UY" },
  { name: "Uzbekistan", code: "UZ" },
  { name: "Venezuela", code: "VE" },
  { name: "Vietnam", code: "VN" },
  { name: "Yemen", code: "YE" },
  { name: "Zambia", code: "ZM" },
  { name: "Zimbabwe", code: "ZW" }
];

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa",
  "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland",
  "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
  "Ladakh", "Lakshadweep", "Puducherry"
];

const STATE_ALIASES: Record<string, string> = {
  // ISO-3166-2:IN codes
  "ap": "Andhra Pradesh",
  "ar": "Arunachal Pradesh",
  "as": "Assam",
  "br": "Bihar",
  "cg": "Chhattisgarh",
  "ct": "Chhattisgarh",
  "ga": "Goa",
  "gj": "Gujarat",
  "hr": "Haryana",
  "hp": "Himachal Pradesh",
  "jh": "Jharkhand",
  "ka": "Karnataka",
  "kl": "Kerala",
  "mp": "Madhya Pradesh",
  "mh": "Maharashtra",
  "mn": "Manipur",
  "ml": "Meghalaya",
  "mz": "Mizoram",
  "nl": "Nagaland",
  "od": "Odisha",
  "or": "Odisha",
  "pb": "Punjab",
  "rj": "Rajasthan",
  "sk": "Sikkim",
  "tn": "Tamil Nadu",
  "ts": "Telangana",
  "tg": "Telangana",
  "tr": "Tripura",
  "up": "Uttar Pradesh",
  "uk": "Uttarakhand",
  "ut": "Uttarakhand",
  "wb": "West Bengal",
  "an": "Andaman and Nicobar Islands",
  "ch": "Chandigarh",
  "dh": "Dadra and Nagar Haveli and Daman and Diu",
  "dd": "Dadra and Nagar Haveli and Daman and Diu",
  "dl": "Delhi",
  "jk": "Jammu and Kashmir",
  "la": "Ladakh",
  "ld": "Lakshadweep",
  "py": "Puducherry",
  // Common aliases
  "nct of delhi": "Delhi",
  "national capital territory of delhi": "Delhi",
  "new delhi": "Delhi",
  "orissa": "Odisha",
  "pondicherry": "Puducherry",
  "uttaranchal": "Uttarakhand",
  "state of maharashtra": "Maharashtra",
  "state of kerala": "Kerala",
  "state of karnataka": "Karnataka",
  "state of tamil nadu": "Tamil Nadu",
  "state of gujarat": "Gujarat",
};

/**
 * Normalizes any Indian state input (full name, abbreviation, or alias)
 * to match an entry in INDIAN_STATES exactly.
 */
export function matchIndianState(stateInput?: string | null): string {
  if (!stateInput) return "";
  const clean = stateInput.trim().toLowerCase().replace(/^in-/i, "");
  
  if (STATE_ALIASES[clean]) {
    return STATE_ALIASES[clean];
  }

  for (const s of INDIAN_STATES) {
    const sLower = s.toLowerCase();
    if (sLower === clean || clean.includes(sLower) || sLower.includes(clean)) {
      return s;
    }
  }

  return stateInput;
}

/**
 * Check if the given country string or code represents India.
 */
export function isIndia(country?: string, countryCode?: string): boolean {
  if (countryCode && countryCode.toUpperCase() === "IN") return true;
  if (country) {
    const norm = country.trim().toLowerCase();
    return norm === "india" || norm === "in";
  }
  return true; // Default to India if unspecified
}

/**
 * Find country object matching name or ISO code. Defaults to India.
 */
export function findCountry(nameOrCode?: string): CountryOption {
  if (!nameOrCode) return COUNTRIES[0];
  const query = nameOrCode.trim().toLowerCase();
  const matched = COUNTRIES.find(
    c => c.code.toLowerCase() === query || c.name.toLowerCase() === query
  );
  return matched || { name: nameOrCode, code: "" };
}

/**
 * Validate postal/zip code based on country.
 */
export function validatePostalCode(zip: string, country?: string, countryCode?: string): boolean {
  const cleanZip = zip.trim();
  if (isIndia(country, countryCode)) {
    return /^\d{6}$/.test(cleanZip);
  }
  return cleanZip.length >= 2 && cleanZip.length <= 12 && /^[A-Za-z0-9\s\-]{2,12}$/.test(cleanZip);
}

/**
 * Validate phone number based on country and return it in E.164.
 *
 * India: formats via toE164 so legacy `+9830…` numbers become `+919830…`.
 *
 * Everywhere else the number is read for the selected country
 * (lib/tracking/phone.ts): "415 555 2671" with United States → "+14155552671",
 * "07700 900123" with United Kingdom → "+447700900123", and a number typed with
 * its own code ("+1 …", "0044 …") keeps that code. The previous version put a
 * "+" in front of whatever digits were typed, which stored numbers like
 * "+4155552671" — a number of nobody, unusable for delivery calls, OTP and ad
 * matching alike.
 */
export function validatePhoneNumber(phone: string, country?: string, countryCode?: string): {
  valid: boolean;
  formattedPhone: string;
  error: string;
} {
  if (isIndia(country, countryCode)) {
    const formatted = toE164(phone, "IN");
    const digits = formatted ? formatted.replace(/\D/g, "") : "";
    const national = digits.startsWith("91") && digits.length === 12 ? digits.slice(2) : digits;
    const valid = Boolean(formatted) && /^[6-9]\d{9}$/.test(national);
    return {
      valid,
      formattedPhone: formatted || phone.trim(),
      error: valid ? "" : "Enter a valid 10-digit mobile number",
    };
  }

  const iso = ((countryCode || "").trim() || findCountry(country).code || "").toUpperCase();
  const parsed = parsePhoneForCountry(phone, iso || undefined);
  if (parsed) {
    return { valid: true, formattedPhone: parsed.number, error: "" };
  }
  const trimmed = phone.trim();
  const countryName = (country || "").trim() || iso;
  return {
    valid: false,
    formattedPhone: trimmed.startsWith("+") ? trimmed : trimmed ? `+${trimmed.replace(/\D/g, "")}` : "",
    error: countryName
      ? `Enter a valid phone number for ${countryName}, or include the country code (for example +1 …)`
      : "Enter a valid phone number with its country code (for example +1 …)",
  };
}
