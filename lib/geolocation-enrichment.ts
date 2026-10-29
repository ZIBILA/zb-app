/**
 * One-Shot Geolocation Enrichment for Meta EMQ
 *
 * Silently captures the visitor's city/state/postcode/country via the browser's
 * Geolocation API + the server-side reverse geocoder (/api/geo/reverse), then
 * feeds them into the shared Meta PII cookie pipeline so subsequent events
 * include address fields.
 *
 * Google Maps is deliberately not loaded here: the Maps key is referrer-restricted
 * to the checkout, so on product / collection / home pages the ~300 KB Maps SDK
 * always failed with RefererNotAllowedMapError (a console error on every product
 * page for shoppers who had granted location) and the code fell back to the
 * server geocoder anyway. Checkout keeps its own Maps loader.
 *
 * Behavior:
 * - Runs at most ONCE per session (sessionStorage guard).
 * - If permission is already 'granted': fetches silently, no prompt.
 * - If permission is 'prompt': triggers the native browser dialog once.
 * - If permission is 'denied': skips entirely, no nag.
 * - Never blocks rendering, hydration, or PageView firing.
 * - Never shows custom UI — only the native browser permission dialog.
 * - Fails silently on any error (timeout, GPS failure, API error).
 * - Only runs on webstore pages, never on /dashboard.
 */

import { saveUserDataToCookies, initPixel } from './metaPixel';

const SESSION_KEY = 'zb_geo_done';

/**
 * Main entry point. Call this from MetaPixelRouteTracker after PageView fires.
 * Fire-and-forget — never awaited on the critical path.
 */
export async function enrichSessionWithGeolocation(): Promise<void> {
  try {
    // Guard: browser environment only
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    // Guard: NEVER run or prompt on admin dashboard, admin routes, or API endpoints
    const path = window.location.pathname;
    if (path.startsWith('/dashboard') || path.startsWith('/admin') || path.startsWith('/api') || path.startsWith('/web-store') || path.startsWith('/checkout')) {
      return;
    }

    // Guard: Geolocation API available
    if (!navigator.geolocation) {
      sessionStorage.setItem(SESSION_KEY, 'unsupported');
      return;
    }

    // Check permission state without triggering a prompt
    let permissionState: PermissionState | 'unknown' = 'unknown';
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        permissionState = status.state;
      }
    } catch {
      // Permissions API not supported — state is unknown, proceed to getCurrentPosition
      permissionState = 'unknown';
    }

    // If explicitly denied, respect the user's choice — don't call getCurrentPosition
    // BUT still try IP-based location so downstream events get approximate address data
    if (permissionState === 'denied') {
      try {
        const geoRes = await fetch('/api/geo');
        const geoData = await geoRes.json();
        if (geoData.ok) {
          sessionStorage.setItem('zb_geo_data', JSON.stringify({
            source: 'ip', // ISP-level: city / zip are not the shopper's address
            city: geoData.city || null,
            state: geoData.region || null,
            zip: geoData.zip || null,
            country: geoData.country || null,
            countryCode: geoData.countryCode || null,
            latitude: geoData.lat,
            longitude: geoData.lng,
          }));
          // IP geolocation is reliable to the country only. Its region is the
          // carrier's egress (often another state on Indian mobile networks), and
          // city / postal code are the ISP's, so none of those are stored as the
          // shopper's address (Meta already geo-matches on the client IP; the relay
          // rule is "st / ct / zp never from IP").
          await saveUserDataToCookies({
            country: geoData.country || undefined,
          });
          initPixel();
        }
      } catch {
        // IP-geo also failed — that's fine, fail silently
      }
      sessionStorage.setItem(SESSION_KEY, 'denied_ip_fallback');
      return;
    }

    // Guard: if it's 'prompt' or 'unknown' (which triggers the browser dialog),
    // enforce the single-shot per session limit to avoid annoying the user.
    // If it is already 'granted', we bypass this guard to silently fetch the location.
    if (permissionState !== 'granted' && sessionStorage.getItem(SESSION_KEY)) {
      return;
    }

    // For 'granted', 'prompt', or 'unknown': call getCurrentPosition.
    // - 'granted': fetches silently
    // - 'prompt': triggers native browser dialog
    // - 'unknown': same as prompt (Permissions API unsupported)
    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 3500);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          resolve(pos);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
        {
          enableHighAccuracy: false,
          timeout: 3000,
          maximumAge: 300000,
        }
      );
    });

    if (!position) {
      // GPS failed or timed out — try IP fallback
      try {
        const geoRes = await fetch('/api/geo');
        const geoData = await geoRes.json();
        if (geoData.ok) {
          const cleanZip = geoData.zip && geoData.zip !== '0' && geoData.zip !== 'null' ? geoData.zip : null;
          sessionStorage.setItem('zb_geo_data', JSON.stringify({
            source: 'ip', // ISP-level: city / zip are not the shopper's address
            city: geoData.city || null,
            state: geoData.region || null,
            zip: cleanZip,
            country: geoData.country || null,
            countryCode: geoData.countryCode || null,
            latitude: geoData.lat,
            longitude: geoData.lng,
          }));
          // IP-derived: country only (see above).
          await saveUserDataToCookies({
            country: geoData.country || undefined,
          });
          initPixel();
          sessionStorage.setItem(SESSION_KEY, 'gps_failed_ip_fallback');
          return;
        }
      } catch {
        // IP-geo also failed
      }
      sessionStorage.setItem(SESSION_KEY, 'failed');
      return;
    }

    const { latitude, longitude } = position.coords;

    let parsed: any = null;

    // Server-side reverse geocode via Nominatim / OSM (see the header comment for why the
    // client-side Google Maps geocoder is not attempted on storefront pages).
    {
      try {
        const revRes = await fetch(`/api/geo/reverse?lat=${latitude}&lng=${longitude}`);
        if (revRes.ok) {
          const revData = await revRes.json();
          if (revData && revData.ok) {
            parsed = {
              city: revData.city || null,
              state: revData.state || null,
              zip: revData.zip || null,
              country: revData.country || null,
              countryCode: revData.countryCode || null,
            };
          }
        }
      } catch {
        // Fallback failed
      }
    }

    if (!parsed || (!parsed.city && !parsed.state && !parsed.zip && !parsed.country)) {
      sessionStorage.setItem(SESSION_KEY, 'no_address_data');
      return;
    }

    const cleanZip = parsed.zip && parsed.zip !== '0' && parsed.zip !== 'null' ? parsed.zip : null;

    // Cache the resolved data in sessionStorage for reference
    sessionStorage.setItem('zb_geo_data', JSON.stringify({
      city: parsed.city,
      state: parsed.state,
      zip: cleanZip,
      country: parsed.country,
      countryCode: parsed.countryCode,
      latitude,
      longitude,
    }));

    // Save to Meta PII cookies (hashed) via the existing pipeline
    await saveUserDataToCookies({
      city: parsed.city || undefined,
      state: parsed.state || undefined,
      zip: cleanZip || undefined,
      country: parsed.country || undefined,
    });

    // Re-init pixel with the new location data for advanced matching
    initPixel();

    sessionStorage.setItem(SESSION_KEY, 'success');
  } catch {
    // Fail completely silently — never crash the page
    try {
      sessionStorage.setItem(SESSION_KEY, 'error');
    } catch {
      // Even sessionStorage might fail in some contexts — that's fine
    }
  }
}
