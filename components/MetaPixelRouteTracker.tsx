'use client';
import { normalizePhone, normalizeState, normalizeZip } from '@/lib/tracking/identity-normalize';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import {
  initPixel,
  getMetaIdentityCookies,
  getClientCookie,
  setClientCookie,
  sha256,
  cleanCountry,
  withFbq,
  isDemoValue,
  clearGuestPiiCookies,
  deleteClientCookie,
} from '@/lib/metaPixel';
import { buildClientUserData } from '@/lib/buildMetaUserData';

import { pageview as trackGAPageView } from '@/lib/gtag';
import { trackPageView as trackZBPageView } from '@/lib/analytics-tracker';

let cachedProfileData: {
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  dob?: string;
} | null = null;

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function cleanStringNoSpaces(val: string | undefined): string {
  if (!val) return "";
  return val.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function MetaPixelRouteTracker() {
  const pathname = usePathname();
  // `status` distinguishes "still loading" from "really logged out" (data is undefined in both).
  const { data: session, status } = useSession();
  const sessionKey =
    (session?.user as any)?.id || session?.user?.email || (session ? 'anon-session' : 'no-session');
  const lastPageViewRef = useRef<{ path: string; at: number } | null>(null);

  useEffect(() => {
    // Don't fire any pixel/CAPI events on admin dashboard or admin routes
    if (pathname.startsWith('/dashboard') || pathname.startsWith('/admin') || pathname.startsWith('/web-store')) return;

    // ─── STEP 1: Synchronous setup (cookies, fbclid capture) ───

    // 1. Generate/verify visitor UUID (external_id)
    let extId = getClientCookie('zb_external_id');
    if (!extId) {
      extId = 'zb.' + uuidv4();
      setClientCookie('zb_external_id', extId, 365);
    }

    // 2. Generate/verify browser ID (_fbp) fallback
    let fbpVal = getClientCookie('_fbp');
    if (!fbpVal) {
      const randVal = Math.floor(Math.random() * 1000000000);
      fbpVal = `fb.1.${Date.now()}.${randVal}`;
      setClientCookie('_fbp', fbpVal, 90);
    }

    // 3. Capture fbclid from URL and set as _fbc cookie (Click ID)
    const urlParams = new URLSearchParams(window.location.search);
    const fbclid = urlParams.get('fbclid');
    let fbcVal = getClientCookie('_fbc') || undefined;
    if (fbclid) {
      const host = window.location.hostname;
      const depth = host.split('.').length > 2 ? host.split('.').length - 1 : 1;
      fbcVal = `fb.${depth}.${Date.now()}.${fbclid}`;
      setClientCookie('_fbc', fbcVal, 90);
    }

    // 4. Note: Client IP resolution relies on server CAPI proxy headers (x-forwarded-for) 
    // to avoid redundant client-side network calls and CSP violations.

    // One PageView per route change. This effect also re-runs when the session
    // hydrates (loading → authenticated / unauthenticated) or the session object
    // changes; those re-runs only refresh identity and must never send another
    // PageView, however long hydration takes (the previous 2.5 s window let a slow
    // hydration double-count).
    const shouldFirePageView = lastPageViewRef.current?.path !== pathname;
    if (shouldFirePageView) {
      lastPageViewRef.current = { path: pathname, at: Date.now() };
    }

    // ─── STEP 2: Fire PageView IMMEDIATELY with sync-available data ───

    const eventId = 'pv.' + uuidv4();
    const eventTime = Math.floor(Date.now() / 1000);

    if (shouldFirePageView) {
      // Client-side pixel PageView — fires NOW, no awaits
      withFbq((fbq) => {
        const options: Record<string, any> = { eventID: eventId };
        const testCode = process.env.NEXT_PUBLIC_META_TEST_EVENT_CODE;
        if (testCode) {
          options.test_event_code = testCode;
        }
        fbq('track', 'PageView', {}, options);
      }, 'PageView');
    }

    // Server-side CAPI PageView — fires NOW with sync-available identity data
    // Use the shared builder for consistent empty-value filtering and demo blocking.
    const rawIdentity = getMetaIdentityCookies();
    if (fbcVal && !rawIdentity.fbc) {
      rawIdentity.fbc = fbcVal;
    }
    const builtIdentity: Record<string, any> = { ...buildClientUserData(rawIdentity) };

    // Inject sessionStorage geo data fallback if cookies are absent
    try {
      const geoStr = sessionStorage.getItem('zb_geo_data');
      if (geoStr) {
        const geoData = JSON.parse(geoStr);
        if (!builtIdentity.country && geoData.countryCode) builtIdentity.country = geoData.countryCode.toLowerCase();
        if (!builtIdentity.st && geoData.state) builtIdentity.st = geoData.state.toLowerCase();
        if (!builtIdentity.ct && geoData.city) builtIdentity.ct = geoData.city.toLowerCase();
        if (!builtIdentity.zp && geoData.zip) builtIdentity.zp = geoData.zip;
      }
    } catch {}

    // For anonymous PageView events, strip identity PII fields (em, ph, fn, ln, db, fb_login_id).
    // Preserve address fields (country, st, ct, zp) from session cookies to improve Meta EMQ.
    if (!session?.user) {
      delete builtIdentity.em;
      delete builtIdentity.ph;
      delete builtIdentity.fn;
      delete builtIdentity.ln;
      delete builtIdentity.db;
      delete builtIdentity.fb_login_id;
    }

    // Include piiOwner so the server can verify PII cookie identity binding
    builtIdentity.piiOwner = getClientCookie('zb_pii_owner') || undefined;

    if (shouldFirePageView) {
      fetch('/api/meta/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName: 'PageView',
          eventId,
          eventTime,
          eventSourceUrl: window.location.href,
          userAgent: navigator.userAgent,
          actionSource: 'website',
          userData: builtIdentity,
        }),
      }).catch(err => console.warn('[Tracker Client] PageView CAPI failed:', err));

      // GA PageView
      trackGAPageView(pathname);

      // ZB First-Party Analytics PageView
      trackZBPageView(pathname);
    }

    // ─── STEP 3: Async identity enrichment (runs AFTER PageView) ───
    // This improves identity data for the NEXT event on this page (ViewContent, AddToCart, etc.)
    // but never gates or delays PageView itself.

    const enrichIdentityAsync = async () => {
      const sessionUserData: Record<string, any> = {};

      // Session not resolved yet: change nothing. Treating "loading" as "logged out"
      // used to wipe a logged-in customer's identity cookies right before the first
      // ViewContent of an ad landing. The effect re-runs once status settles.
      if (status === 'loading') return;

      if (session?.user) {
        setClientCookie('zb_user_logged_in', 'true', 365);

        const email = session.user.email;
        if (email && !isDemoValue('email', email)) {
          const hashedEmail = await sha256(email.trim().toLowerCase());
          sessionUserData.em = hashedEmail;
          setClientCookie('zb_guest_email', hashedEmail, 365);
        } else if (email) {
          // Demo / synthetic placeholder account email (e.g. guest_<ts>@zicabella.com):
          // remove a hash of it that older code may have stored, never send it.
          const placeholderHash = await sha256(email.trim().toLowerCase());
          if (getClientCookie('zb_guest_email') === placeholderHash) deleteClientCookie('zb_guest_email');
        }

        const name = session.user.name;
        if (name && !isDemoValue('name', name)) {
          const parts = name.trim().split(/\s+/);
          if (parts[0]) {
            const hashedFn = await sha256(cleanStringNoSpaces(parts[0]));
            sessionUserData.fn = hashedFn;
            setClientCookie('zb_guest_fn', hashedFn, 365);
          }
          if (parts.length > 1) {
            const hashedLn = await sha256(cleanStringNoSpaces(parts.slice(1).join('')));
            sessionUserData.ln = hashedLn;
            setClientCookie('zb_guest_ln', hashedLn, 365);
          }
        }

        // Fetch default address and DOB for logged-in user if not cached
        if (!cachedProfileData) {
          try {
            const res = await fetch('/api/customers/me/default-address');
            if (res.ok) {
              cachedProfileData = await res.json();
            }
          } catch (e) {
            console.error('Failed to fetch default address/profile:', e);
          }
        }

        // Phone after the profile fetch so a number saved without "+<dial code>"
        // is read in the customer's own country. OTP-login numbers carry their
        // dial code and parse correctly regardless; with no country known, a bare
        // number falls back to India (same as before).
        const phone = (session.user as any).phone || (session as any).customer?.phone;
        if (phone && !isDemoValue('phone', phone)) {
          const formattedPhone = normalizePhone(phone, cachedProfileData?.country);
          if (formattedPhone) {
            const hashedPhone = await sha256(formattedPhone);
            sessionUserData.ph = hashedPhone;
            setClientCookie('zb_guest_phone', hashedPhone, 365);
          }
        }

        if (cachedProfileData) {
          const { city, state, zip, country, dob } = cachedProfileData;
          if (city) {
            const hashedCity = await sha256(cleanStringNoSpaces(city));
            sessionUserData.ct = hashedCity;
            setClientCookie('zb_guest_ct', hashedCity, 365);
          }
          const normState = normalizeState(state, country);
          if (normState) {
            const hashedState = await sha256(normState);
            sessionUserData.st = hashedState;
            setClientCookie('zb_guest_st', hashedState, 365);
          }
          const normZip = normalizeZip(zip, country);
          if (normZip) {
            const hashedZip = await sha256(normZip);
            sessionUserData.zp = hashedZip;
            setClientCookie('zb_guest_zp', hashedZip, 365);
          }
          if (country) {
            const cleanC = cleanCountry(country);
            if (cleanC) {
              const hashedCountry = await sha256(cleanC);
              sessionUserData.country = hashedCountry;
              setClientCookie('zb_guest_country', hashedCountry, 365);
            }
          }
          if (dob) {
            const cleanD = dob.replace(/\D/g, "").slice(0, 8);
            if (cleanD.length === 8) {
              const hashedDob = await sha256(cleanD);
              sessionUserData.db = hashedDob;
              setClientCookie('zb_guest_dob', hashedDob, 365);
            }
          }
        }

        // Bind the identity cookies just written to this browser identity, so
        // getMetaIdentityCookies() (browser) and /api/meta/event (server) agree
        // that they belong to the current visitor.
        if (extId && Object.keys(sessionUserData).length > 0) {
          setClientCookie('zb_pii_owner', extId, 365);
        }

        // Reinit pixel with full enriched user data for subsequent events
        initPixel(sessionUserData);
      } else {
        // Really logged out (status === 'unauthenticated').
        // Clear identity cookies only on the transition from logged-in to logged-out
        // (logout or session expiry), so a previous user's data never leaks into the
        // next user's events on a shared device. Ordinary guest navigation keeps the
        // guest's own checkout identity (bound to zb_external_id via zb_pii_owner).
        const wasLoggedIn = getClientCookie('zb_user_logged_in') === 'true';
        setClientCookie('zb_user_logged_in', 'false', 365);
        if (wasLoggedIn) {
          clearGuestPiiCookies();
        }
        // Reinit pixel with browser-only params for subsequent events
        initPixel({});
      }
    };

    // Fire enrichment in background — NEVER blocks PageView
    enrichIdentityAsync().catch(err => {
      console.warn('[Meta Pixel Enrichment] Identity enrichment failed (non-fatal):', err);
    });


  }, [sessionKey, pathname, session, status]);
  // `session` kept so enrichment sees latest user fields when sessionKey flips (login).
  // PageView itself is deduped above so session object churn won't double-fire CAPI.

  return null;
}

export default MetaPixelRouteTracker;
