/**
 * Region-aware consent for Meta tracking + Limited Data Use. Everything here is
 * OFF unless the environment says otherwise, so production is unchanged until the
 * business decides which regions need opt-in.
 *
 * Environment (build-time NEXT_PUBLIC_, read by the browser bundle and the server)
 *   NEXT_PUBLIC_META_CONSENT_REGIONS   comma-separated ISO 3166-1 alpha-2 codes, or
 *                                      the shortcuts EEA (the 30 EEA countries) and
 *                                      UK (GB). Visitors from these countries are
 *                                      tracked only after they accept the consent
 *                                      prompt: the Pixel is held with
 *                                      fbq('consent','revoke') before init, and the
 *                                      browser→CAPI relay is held too; on accept
 *                                      both release (queued Pixel events are sent by
 *                                      the SDK). Everyone else is unaffected.
 *   NEXT_PUBLIC_META_LDU               "1" sends Limited Data Use on every event —
 *                                      fbq('dataProcessingOptions', ['LDU'], 0, 0)
 *                                      and data_processing_options on CAPI — with
 *                                      country/state 0 so Meta applies it only where
 *                                      the visitor's location requires it
 *                                      (California and similar US-state laws).
 *
 * Cookies (first-party, 1 year): zb_consent = granted | denied (the visitor's
 * choice), zb_geo_cc = ISO country of the visitor's IP (1 day; so the first
 * script on later page loads knows the region without waiting for /api/geo).
 *
 * Isomorphic and dependency-free; the inline Pixel snippet re-implements the
 * same `needsConsent` decision in plain JS (app/layout.tsx) because it runs before
 * any module loads.
 */

export const CONSENT_COOKIE = 'zb_consent';
export const GEO_COUNTRY_COOKIE = 'zb_geo_cc';

export const EEA_COUNTRIES: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
];

/** Parse NEXT_PUBLIC_META_CONSENT_REGIONS into a set of ISO codes ('' or unset → empty = no gating). */
export function parseConsentRegions(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const tok of String(raw || '').split(',')) {
    const t = tok.trim().toUpperCase();
    if (!t) continue;
    if (t === 'EEA' || t === 'EU') { for (const c of EEA_COUNTRIES) out.add(c); continue; }
    if (t === 'UK') { out.add('GB'); continue; }
    if (/^[A-Z]{2}$/.test(t)) out.add(t);
  }
  return out;
}

export type ConsentChoice = 'granted' | 'denied';
export type ConsentState =
  | { gated: false }                                  // no regions configured, or visitor outside them
  | { gated: true; status: 'granted' | 'denied' | 'pending' };

/**
 * Decide the visitor's consent state.
 *   regions empty          → not gated (today's behaviour)
 *   choice already made    → granted / denied (sticky, whatever the country)
 *   country known, outside → not gated
 *   country in regions, or unknown → pending (hold tracking until the country or the choice is known)
 */
export function consentState(opts: {
  regions: Set<string>;
  choice?: string | null;
  countryCode?: string | null;
}): ConsentState {
  if (opts.regions.size === 0) return { gated: false };
  const choice = String(opts.choice || '').toLowerCase();
  if (choice === 'granted') return { gated: true, status: 'granted' };
  if (choice === 'denied') return { gated: true, status: 'denied' };
  const cc = String(opts.countryCode || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(cc) && !opts.regions.has(cc)) return { gated: false };
  return { gated: true, status: 'pending' };
}

/** The visitor is in a consent region (banner territory). Unknown country → false (no banner yet). */
export function inConsentRegion(regions: Set<string>, countryCode: string | null | undefined): boolean {
  const cc = String(countryCode || '').trim().toUpperCase();
  return regions.size > 0 && /^[A-Z]{2}$/.test(cc) && regions.has(cc);
}

/** Limited Data Use fields for a CAPI event when NEXT_PUBLIC_META_LDU=1 (Meta geolocates: country/state 0). */
export function ldUFields(enabled: string | undefined = process.env.NEXT_PUBLIC_META_LDU): Record<string, unknown> {
  return String(enabled || '').trim() === '1'
    ? { data_processing_options: ['LDU'], data_processing_options_country: 0, data_processing_options_state: 0 }
    : {};
}
