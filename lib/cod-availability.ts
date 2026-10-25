/**
 * Cash on Delivery is India-only. Every other Global Store market is prepaid.
 */

const NAME_TO_CODE: Record<string, string> = {
  INDIA: "IN",
  IN: "IN",
  IND: "IN",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  USA: "US",
  US: "US",
  "UNITED KINGDOM": "GB",
  "GREAT BRITAIN": "GB",
  UK: "GB",
  GB: "GB",
  "UNITED ARAB EMIRATES": "AE",
  UAE: "AE",
  AE: "AE",
  SINGAPORE: "SG",
  SG: "SG",
};

export function normalizeCountryCode(codeOrName?: string | null): string {
  const raw = String(codeOrName || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (NAME_TO_CODE[upper]) return NAME_TO_CODE[upper];
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return "";
}

export function isCodAllowedForCountry(codeOrName?: string | null): boolean {
  return normalizeCountryCode(codeOrName) === "IN";
}

export function resolveCheckoutCountry(input: {
  displayCountry?: string | null;
  currency?: string | null;
  address?: any;
}): string {
  const addr = input.address || {};
  const fromMarket = normalizeCountryCode(input.displayCountry);
  if (fromMarket) return fromMarket;

  const fromAddress =
    normalizeCountryCode(addr.countryCode) ||
    normalizeCountryCode(addr.country_code) ||
    normalizeCountryCode(addr.country);
  if (fromAddress) return fromAddress;

  const currency = String(input.currency || "").trim().toUpperCase();
  if (currency && currency !== "INR") return "";

  return "IN";
}

export const COD_INDIA_ONLY_ERROR =
  "Cash on Delivery is only available for orders in India. Please pay in full (Prepaid).";
