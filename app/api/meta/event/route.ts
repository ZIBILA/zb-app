import { NextRequest, NextResponse } from 'next/server';
import { sendCapiEvent, getReportedValue } from '@/lib/metaCapi';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/db';
import { DEMO_PHONES_RAW, DEMO_EMAILS_RAW } from '@/lib/metaPixel';
import { buildServerUserData } from '@/lib/buildMetaUserData';
import { getClientIP, lookupIpGeo, type IpGeoResult } from '@/lib/ip-geo';
import crypto from 'crypto';

function normalizePhone(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const digits = p.replace(/\D/g, "");
  let base = digits;
  if (digits.length === 12 && digits.startsWith("91")) base = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) base = digits.slice(1);
  return `91${base}`;
}

// ── Dev-mode duplicate PII detection safeguard ──
// Tracks how many distinct external_id values send the same em/ph hash.
// If a single hash appears for >5 distinct identities in 10 minutes,
// logs a warning so this class of bug surfaces immediately.
const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const DEDUP_THRESHOLD = 5;
const dedupTracker = new Map<string, { ids: Set<string>; firstSeen: number }>();

function checkDuplicatePii(field: string, hashedValue: string | undefined, externalId: string | undefined): void {
  if (!hashedValue || !externalId) return;
  // Only run in dev or when test event code is set
  if (process.env.NODE_ENV === 'production' && !process.env.META_TEST_EVENT_CODE) return;

  const key = `${field}:${hashedValue}`;
  const now = Date.now();
  let entry = dedupTracker.get(key);

  if (!entry || (now - entry.firstSeen) > DEDUP_WINDOW_MS) {
    entry = { ids: new Set(), firstSeen: now };
    dedupTracker.set(key, entry);
  }

  entry.ids.add(externalId);

  if (entry.ids.size > DEDUP_THRESHOLD) {
    console.warn(
      `[Meta CAPI DUPLICATE WARNING] ⚠️ Same ${field} hash sent for ${entry.ids.size} distinct external_ids ` +
      `in the last ${Math.round((now - entry.firstSeen) / 1000)}s. Hash prefix: ${hashedValue.slice(0, 12)}... ` +
      `This may trigger Meta's duplicate PII warning.`
    );
  }

  // Prune old entries periodically (keep map bounded)
  if (dedupTracker.size > 500) {
    for (const [k, v] of dedupTracker) {
      if ((now - v.firstSeen) > DEDUP_WINDOW_MS) dedupTracker.delete(k);
    }
  }
}

/** Pre-compute demo phone hashes so we can block them on the server side too. */
const DEMO_PHONE_HASHES = DEMO_PHONES_RAW.map(p => {
  const digits = p.replace(/\D/g, '');
  let base = digits;
  if (digits.length === 12 && digits.startsWith('91')) base = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) base = digits.slice(1);
  return crypto.createHash('sha256').update(`91${base}`).digest('hex');
});
const DEMO_EMAIL_HASHES = DEMO_EMAILS_RAW.map(e =>
  crypto.createHash('sha256').update(e.trim().toLowerCase()).digest('hex')
);

/** Check if a hashed value matches a known demo account hash. */
function isDemoHash(field: 'em' | 'ph', hash: string | undefined): boolean {
  if (!hash) return false;
  const clean = hash.trim().toLowerCase();
  return field === 'ph'
    ? DEMO_PHONE_HASHES.includes(clean)
    : DEMO_EMAIL_HASHES.includes(clean);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      eventName,
      eventId,
      eventTime, // Received from client for perfect browser-server timestamp sync
      eventSourceUrl,
      userAgent,
      userData,
      customData,
      actionSource,
    } = body;

    // Strict payload validation
    if (!eventName || !eventId || !eventSourceUrl || !userAgent) {
      console.warn('[Meta CAPI Route] Rejected invalid payload: Missing required event metadata');
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Issue 4 diagnostics (no session dependency — runs before fast path)
    if (process.env.NODE_ENV !== 'production' || process.env.META_TEST_EVENT_CODE) {
      const headersObj: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headersObj[key] = value;
      });
      console.log(`[Meta CAPI Route IP Diagnostics] Event: ${eventName} | Raw Headers:`, JSON.stringify(headersObj));
    }

    // Extract request-scoped data (synchronous — no I/O)
    const ip = req.cookies.get('zb_client_ip')?.value || getClientIP(req);

    const fbp = req.cookies.get('_fbp')?.value;
    const fbc = req.cookies.get('_fbc')?.value;
    const externalId = req.cookies.get('zb_external_id')?.value;
    const isLoggedIn = req.cookies.get('zb_user_logged_in')?.value === 'true';

    const guestEmail = req.cookies.get('zb_guest_email')?.value;
    const guestPhone = req.cookies.get('zb_guest_phone')?.value;
    const guestFn = req.cookies.get('zb_guest_fn')?.value;
    const guestLn = req.cookies.get('zb_guest_ln')?.value;
    const guestCountry = req.cookies.get('zb_guest_country')?.value;
    const guestState = req.cookies.get('zb_guest_st')?.value;
    const guestCity = req.cookies.get('zb_guest_ct')?.value;
    const guestZip = req.cookies.get('zb_guest_zp')?.value;
    const fbLoginId = req.cookies.get('zb_fb_login_id')?.value;
    const guestDob = req.cookies.get('zb_guest_dob')?.value;
    const piiOwnerCookie = req.cookies.get('zb_pii_owner')?.value;

    // ── IP Geolocation Fallback ──
    // If all client-side address cookies are absent (user denied/ignored location prompt),
    // look up city/state/country from the visitor's IP address.
    // Applies to ALL events so country/region parameters are always sent to Meta.
    let ipGeo: IpGeoResult | null = null;
    const hasClientGeo = !!(guestCountry || guestState || guestCity || guestZip);
    if (!hasClientGeo) {
      ipGeo = await lookupIpGeo(ip, req);
    }

    // Issue 5 fix: Apply server-side value adjustment for Purchase and InitiateCheckout.
    // The client sends the real order/cart value; the adjustment happens here so
    // the real value is never exposed in browser JS or network traffic to Meta.
    // This runs BEFORE any I/O so it's available for the fast-path response.
    let adjustedCustomData = customData ? { ...customData } : undefined;
    if (adjustedCustomData?.value !== undefined) {
      const realValue = adjustedCustomData.value;
      const reportedValue = getReportedValue(eventName, realValue);
      if (reportedValue !== undefined && reportedValue !== realValue) {
        // Dev-only: log both values for internal debugging (never sent to Meta or client)
        if (process.env.NODE_ENV !== 'production' || process.env.META_TEST_EVENT_CODE) {
          console.log(`[Meta CAPI Route] ${eventName} value adjustment — realValue=${realValue}, reportedValue=${reportedValue}, currency=${adjustedCustomData.currency || 'NOT SET'}`);
        }
        adjustedCustomData.value = reportedValue;

        // Scale individual product prices in contents array to avoid mismatch
        if (realValue > 0 && Array.isArray(adjustedCustomData.contents)) {
          const ratio = reportedValue / realValue;
          adjustedCustomData.contents = adjustedCustomData.contents.map((item: any) => {
            const originalItemPrice = item.price !== undefined ? item.price : item.item_price;
            if (originalItemPrice !== undefined && originalItemPrice !== null) {
              const scaledPrice = Math.round(originalItemPrice * ratio * 100) / 100;
              return {
                ...item,
                price: scaledPrice,
                item_price: scaledPrice
              };
            }
            return item;
          });
        }
      }
    }

    // === FAST PATH: Purchase/InitiateCheckout ===
    // Return reportedValue/currency immediately; fire session/Prisma/CAPI in background.
    // This ensures the client receives the adjusted value well within the 2500ms timeout,
    // eliminating the Pixel↔CAPI value mismatch that was degrading Data Quality Score.
    if (['Purchase', 'InitiateCheckout'].includes(eventName)) {
      // Build mergedUserData from cookies + body userData (no session await needed).
      // By the time a user reaches checkout/purchase, MetaPixelRouteTracker has already
      // hashed and stored all session PII in cookies (email, phone, name, DOB, address).
      const mergedUserData = buildServerUserData({
        client_ip_address: ip,
        client_user_agent: userData?.client_user_agent || userAgent,
        fbp: userData?.fbp || fbp,
        fbc: userData?.fbc || fbc,
        external_id: userData?.external_id || externalId,
        em: userData?.em || guestEmail,
        ph: userData?.ph || guestPhone,
        fn: userData?.fn || guestFn,
        ln: userData?.ln || guestLn,
        country: userData?.country || guestCountry || ipGeo?.countryCode?.toLowerCase(),
        st: userData?.st || guestState || ipGeo?.region,
        ct: userData?.ct || guestCity || ipGeo?.city,
        zp: userData?.zp || guestZip || ipGeo?.zip || undefined,
        fb_login_id: userData?.fb_login_id || fbLoginId,
        db: userData?.db || guestDob,
      });

      // FIX 1c: Drop em/ph if they came from a cookie owned by a different identity
      const resolvedExtId = (mergedUserData.external_id as string) || externalId;
      const piiOwner = userData?.piiOwner || piiOwnerCookie;
      if (piiOwner && resolvedExtId && piiOwner !== resolvedExtId) {
        // The PII was written by a different guest — don't send it
        if (mergedUserData.em === guestEmail) delete mergedUserData.em;
        if (mergedUserData.ph === guestPhone) delete mergedUserData.ph;
      }

      // Remove piiOwner — it's not a Meta field
      delete (mergedUserData as any).piiOwner;

      // Duplicate detection safeguard
      checkDuplicatePii('em', mergedUserData.em as string, mergedUserData.external_id as string);
      checkDuplicatePii('ph', mergedUserData.ph as string, mergedUserData.external_id as string);

      const presentKeys = Object.entries(mergedUserData)
        .filter(([_, value]) => value !== undefined && value !== null && value !== '')
        .map(([key]) => key);
      console.log(`[Meta CAPI Event Received] ${eventName} — Deduplication ID: ${eventId} — Customer Identifiers Present: [${presentKeys.join(', ')}]`);

      // Fire CAPI send in background — do NOT await before responding
      sendCapiEvent({
        eventName,
        eventId,
        eventTime,
        eventSourceUrl,
        userAgent,
        userData: mergedUserData,
        customData: adjustedCustomData,
        actionSource: actionSource ?? 'website',
      }).catch((err: any) => {
        console.error(`[Meta CAPI Background ${eventName}] eventId=${eventId} Error:`, err);
      });

      return NextResponse.json({
        success: true,
        reportedValue: adjustedCustomData?.value,
        currency: adjustedCustomData?.currency,
        contents: adjustedCustomData?.contents
      });
    }

    // === STANDARD PATH: All other events (sequential — existing behavior) ===
    const session = await getServerSession(authOptions);

    const sessionUserData: Record<string, any> = {};
    if (session?.user) {
      // Block demo account values from reaching Meta
      const rawEmail = session.user.email || undefined;
      const rawPhone = (session.user as any).phone || (session as any).customer?.phone || undefined;
      const rawPhoneDigits = rawPhone ? rawPhone.replace(/\D/g, '').slice(-10) : '';
      const isPhoneDemo = DEMO_PHONES_RAW.some(d => d.replace(/\D/g, '').slice(-10) === rawPhoneDigits);
      const isEmailDemo = rawEmail ? DEMO_EMAILS_RAW.includes(rawEmail.trim().toLowerCase()) : false;

      if (!isEmailDemo) sessionUserData.em = rawEmail;
      if (!isPhoneDemo) sessionUserData.ph = normalizePhone(rawPhone);

      const name = session.user.name;
      // Block "Demo User" name
      const isDemoName = name ? name.trim().toLowerCase() === 'demo user' : false;
      if (name && !isDemoName) {
        const parts = name.trim().split(/\s+/);
        if (parts[0]) sessionUserData.fn = parts[0];
        if (parts.length > 1) sessionUserData.ln = parts.slice(1).join(' ');
      }
      sessionUserData.external_id = (session.user as any).id || undefined;

      const customerId = (session.user as any).id;
      if (customerId) {
        const member = await prisma.communityMember.findUnique({
          where: { customerId },
          select: { dob: true, isVerified: true }
        });
        if (member?.isVerified && member?.dob) {
          const d = new Date(member.dob);
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          sessionUserData.db = `${yyyy}${mm}${dd}`;
        }
      }
    }

    // Merge user identity data. Priority: body userData (client-forwarded cookies, most reliable)
    // → server-side cookies → session data. The client always forwards identity cookies in the
    // body for reliability, since server-side cookie access can fail on edge/CDN.
    const mergedUserData = buildServerUserData({
      client_ip_address: ip,
      client_user_agent: userData?.client_user_agent || userAgent,
      fbp: userData?.fbp || fbp,
      fbc: userData?.fbc || fbc,
      external_id: userData?.external_id || externalId || sessionUserData.external_id,
      em: userData?.em || guestEmail || sessionUserData.em,
      ph: userData?.ph || guestPhone || sessionUserData.ph,
      fn: userData?.fn || guestFn || sessionUserData.fn,
      ln: userData?.ln || guestLn || sessionUserData.ln,
      country: userData?.country || guestCountry || ipGeo?.countryCode?.toLowerCase(),
      st: userData?.st || guestState || ipGeo?.region,
      ct: userData?.ct || guestCity || ipGeo?.city,
      zp: userData?.zp || guestZip || ipGeo?.zip || undefined,
      fb_login_id: userData?.fb_login_id || fbLoginId,
      db: userData?.db || guestDob || sessionUserData.db,
    });

    // FIX 1c: Drop em/ph if they came from a cookie owned by a different identity
    const resolvedExtId = (mergedUserData.external_id as string) || externalId;
    const piiOwner = userData?.piiOwner || piiOwnerCookie;
    if (piiOwner && resolvedExtId && piiOwner !== resolvedExtId) {
      // The PII was written by a different guest — don't send stale cookie PII
      // Only strip if the value came from cookies (not from session)
      if (mergedUserData.em === guestEmail && !sessionUserData.em) delete mergedUserData.em;
      if (mergedUserData.ph === guestPhone && !sessionUserData.ph) delete mergedUserData.ph;
    }

    // Remove piiOwner — it's not a Meta field
    delete (mergedUserData as any).piiOwner;

    // Duplicate detection safeguard
    checkDuplicatePii('em', mergedUserData.em as string, mergedUserData.external_id as string);
    checkDuplicatePii('ph', mergedUserData.ph as string, mergedUserData.external_id as string);

    const userIsLoggedIn = isLoggedIn || !!session?.user;
    const isCheckoutEvent = ['InitiateCheckout', 'AddPaymentInfo', 'Purchase'].includes(eventName);

    // If the visitor is not logged in and it's not a checkout event, strip identity PII parameters (em, ph, name, DOB, fb_login_id).
    // Address fields (country, st, ct, zp) are preserved to improve Meta EMQ via consented session location enrichment.
    if (!userIsLoggedIn && !isCheckoutEvent) {
      delete mergedUserData.em;
      delete mergedUserData.ph;
      delete mergedUserData.fn;
      delete mergedUserData.ln;
      delete mergedUserData.db;
      delete mergedUserData.fb_login_id;
    }

    // Log identifier coverage summary (what identifiers are present, not the actual values)
    const presentKeys = Object.entries(mergedUserData)
      .filter(([_, value]) => value !== undefined && value !== null && value !== '')
      .map(([key]) => key);
    console.log(`[Meta CAPI Event Received] ${eventName} — Deduplication ID: ${eventId} — Customer Identifiers Present: [${presentKeys.join(', ')}]`);

    const result = await sendCapiEvent({
      eventName,
      eventId,
      eventTime, // Forward the exact event time generated on the client
      eventSourceUrl,
      userAgent,
      userData: mergedUserData,
      customData: adjustedCustomData,
      actionSource: actionSource ?? 'website',
    });

    return NextResponse.json({ ...result }, { status: result.success ? 200 : 400 });
  } catch (err: any) {
    console.error('[Meta CAPI Route Error]', err);
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 });
  }
}
