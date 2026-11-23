/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { analyticsWriter } from '@/lib/analytics/analytics-writer';
import { rateLimitInMemory } from '@/lib/rate-limit-memory';
import { getClientIP, lookupIpGeo } from '@/lib/ip-geo';

export const dynamic = 'force-dynamic';

const VALID_EVENTS = new Set([
  'page_view', 'view_item', 'add_to_cart', 'remove_from_cart',
  'view_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info',
  'payment_initiated', 'purchase', 'refund', 'cart_abandoned', 'cart_recovered',
  'session_started',
]);

/** A finite number or null — one NaN would make the whole batched insert fail. */
function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function POST(req: Request) {
  // Rate limit: 120 req/min per IP. In-memory (no DB) — this endpoint fires on every page view.
  const limited = rateLimitInMemory(`analytics-track:${getClientIP(req)}`, { maxRequests: 120, windowMs: 60_000 });
  if (!limited.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(limited.resetAfter) } });
  }

  try {
    const body = await req.json();
    const {
      eventId, eventName, sessionId, anonymousId, platform,
      productId, variantId, cartId, orderId,
      value, currency, quantity, pageUrl, customerId,
      deviceType, browser, os, referrer,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
      countryCode: rawCountryCode, country: rawCountry, region: rawRegion, city: rawCity,
      lat: rawLat, lng: rawLng, metadata,
    } = body;

    if (!eventId || !eventName) {
      return NextResponse.json({ error: 'eventId and eventName are required' }, { status: 400 });
    }

    if (!VALID_EVENTS.has(eventName)) {
      return NextResponse.json({ error: 'Invalid event name' }, { status: 400 });
    }

    // Geo lookup runs after the response; the database writes are queued in memory and flushed in
    // batches by lib/analytics/write-buffer.ts (sessions at most once a minute, events in one
    // INSERT per batch) — tracking must never slow the storefront or hold a pool connection per event.
    void (async () => {
      const ip = getClientIP(req);
      const needsIpGeo = !rawCountryCode && !rawCountry;
      const ipGeo = needsIpGeo ? await lookupIpGeo(ip, req) : null;

      const finalCountryCode = (
        rawCountryCode ||
        ipGeo?.countryCode ||
        (rawCountry && rawCountry.length === 2 ? rawCountry : null)
      )?.toUpperCase() || null;

      const finalCountry = rawCountry || ipGeo?.country || null;
      const finalRegion = rawRegion || ipGeo?.region || null;
      const finalCity = rawCity || ipGeo?.city || null;
      const finalLat = rawLat != null ? num(rawLat) : (ipGeo?.lat ?? null);
      const finalLng = rawLng != null ? num(rawLng) : (ipGeo?.lng ?? null);

      if (sessionId && anonymousId) {
        const location: Record<string, any> = {};
        if (finalCountryCode) location.countryCode = finalCountryCode;
        if (finalCountry) location.country = finalCountry;
        if (finalRegion) location.region = finalRegion;
        if (finalCity) location.city = finalCity;
        if (finalLat != null) location.lat = finalLat;
        if (finalLng != null) location.lng = finalLng;
        if (rawLat != null && rawLng != null && num(rawLat) != null && num(rawLng) != null) {
          location.lat = num(rawLat);
          location.lng = num(rawLng);
        }

        analyticsWriter.touchSession(
          {
            id: sessionId,
            anonymousId,
            customerId: customerId || null,
            platform: platform || 'web',
            landingPage: pageUrl || null,
            currentPage: pageUrl || null,
            deviceType: deviceType || null,
            browser: browser || null,
            os: os || null,
            referrer: referrer || null,
            utmSource: utmSource || null,
            utmMedium: utmMedium || null,
            utmCampaign: utmCampaign || null,
            countryCode: finalCountryCode,
            country: finalCountry,
            region: finalRegion,
            city: finalCity,
            lat: finalLat,
            lng: finalLng,
            isNew: true,
          },
          { pageView: eventName === 'page_view', pageUrl: pageUrl || null, customerId: customerId || null, location },
        );
      }

      analyticsWriter.enqueueEvent({
        eventId: String(eventId),
        eventName,
        sessionId: sessionId || null,
        customerId: customerId || null,
        anonymousId: anonymousId || null,
        platform: platform || 'web',
        productId: productId || null,
        variantId: variantId || null,
        cartId: cartId || null,
        orderId: orderId || null,
        value: num(value),
        currency: currency || 'INR',
        quantity: int(quantity),
        pageUrl: pageUrl || null,
        referrer: referrer || null,
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        utmContent: utmContent || null,
        utmTerm: utmTerm || null,
        deviceType: deviceType || null,
        browser: browser || null,
        os: os || null,
        countryCode: finalCountryCode,
        country: finalCountry,
        region: finalRegion,
        city: finalCity,
        lat: finalLat,
        lng: finalLng,
        metadata: metadata || null,
      });
    })().catch((persistErr: any) => {
      console.error('[Analytics Track] Error:', persistErr?.message || persistErr);
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[Analytics Track] Error:', error.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
