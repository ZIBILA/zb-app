/**
 * Normalizes a phone number to standard E.164 format for Shopify / Shiprocket /
 * OTP identity. Rejects invalid numbers to avoid API 422s.
 *
 * Handles legacy India accounts stored as `+9830896900` (10 digits after `+`
 * without the `91` country code) by prepending `91` when defaultCountry is IN.
 */
export function toE164(raw: string | null | undefined, defaultCountry: string = 'IN'): string | null {
  if (!raw) return null;
  const cleaned = String(raw).trim();
  if (!cleaned) return null;

  const country = String(defaultCountry || 'IN').toUpperCase();
  const hadPlus = cleaned.startsWith('+');
  const digits = cleaned.replace(/\D/g, '');

  if (!digits || digits.length < 7 || digits.length > 15) {
    return null;
  }

  if (country === 'IN') {
    // 10-digit Indian mobile (with or without a stray leading +)
    if (digits.length === 10 && /^[6-9]/.test(digits)) {
      return `+91${digits}`;
    }
    // 11-digit with leading 0: 09876543210
    if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
      return `+91${digits.slice(1)}`;
    }
    // 12-digit with 91 country code: 919876543210
    if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
      return `+${digits}`;
    }
    // Already E.164-ish with +91…
    if (hadPlus && digits.startsWith('91') && digits.length >= 12) {
      return `+${digits}`;
    }
  }

  // International: keep caller-supplied country code when present
  if (hadPlus) {
    return `+${digits}`;
  }

  // Bare digits with an explicit non-IN default country — leave as +digits
  // (callers should pass a number that already includes the country code).
  if (digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

/** Last 10 national digits — useful for India identity matching. */
export function phoneLast10(raw: string | null | undefined): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/**
 * True when `stored` should be overwritten with the verified OTP E.164.
 * Covers legacy rows like `+9830896900` (missing country code) when the user
 * verifies as `+919830896900`.
 */
export function shouldUpgradeStoredPhone(
  stored: string | null | undefined,
  verifiedE164: string | null | undefined
): boolean {
  if (!verifiedE164) return false;
  const canonical = toE164(verifiedE164, 'IN') || verifiedE164;
  if (!stored) return true;
  // Already persisted in the canonical form
  if (stored === canonical) return false;

  const lastStored = phoneLast10(stored);
  const lastVerified = phoneLast10(canonical);
  // Same national number, different formatting (e.g. +9830… vs +919830…)
  if (lastStored && lastVerified && lastStored === lastVerified) return true;

  // Stored value cannot be normalized but verified can
  if (!toE164(stored, 'IN') && toE164(canonical, 'IN')) return true;

  return false;
}
