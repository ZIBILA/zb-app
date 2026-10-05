/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIP, lookupIpGeo } from '@/lib/ip-geo';

export const dynamic = 'force-dynamic';

const VALID_EVENTS = new Set([
  'page_view', 'view_item', 'add_to_cart', 'remove_from_cart',
  'view_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info',
  'payment_initiated', 'purchase', 'refund', 'cart_abandoned', 'cart_recovered',
  'session_started',
]);

export async function POST(req: Request) {
  // Rate limit: 120 req/min per IP
  const rateLimitResult = await checkRateLimit(req, 'analytics-track', { maxRequests: 120, windowMs: 60_000 });
  if (!rateLimitResult.allowed && rateLimitResult.response) {
    return rateLimitResult.response;
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

    // Validate required fields
    if (!eventId || !eventName) {
      return NextResponse.json({ error: 'eventId and eventName are required' }, { status: 400 });
    }

    if (!VALID_EVENTS.has(eventName)) {
      return NextResponse.json({ error: 'Invalid event name' }, { status: 400 });
    }

    // IP Extraction & Server Geolocation Lookup — only when client sent no country signal
    const ip = getClientIP(req);
    const needsIpGeo = !rawCountryCode && !rawCountry;
    const ipGeo = needsIpGeo ? await lookupIpGeo(ip, req) : null;

    // Determine normalized location fields (Client GPS wins over IP Geo)
    const finalCountryCode = (
      rawCountryCode ||
      ipGeo?.countryCode ||
      (rawCountry && rawCountry.length === 2 ? rawCountry : null)
    )?.toUpperCase() || null;

    const finalCountry = rawCountry || ipGeo?.country || null;
    const finalRegion = rawRegion || ipGeo?.region || null;
    const finalCity = rawCity || ipGeo?.city || null;
    const finalLat = rawLat != null ? parseFloat(String(rawLat)) : (ipGeo?.lat ?? null);
    const finalLng = rawLng != null ? parseFloat(String(rawLng)) : (ipGeo?.lng ?? null);

    // Upsert session (if sessionId and anonymousId provided)
    if (sessionId && anonymousId) {
      try {
        const existing = await prisma.analyticsSession.findUnique({
          where: { id: sessionId },
        });

        if (existing) {
          // Update existing session: only set location fields if currently null,
          // or if client GPS provided direct precise coords.
          const updateLocationData: Record<string, any> = {};

          if (finalCountryCode && !existing.countryCode) updateLocationData.countryCode = finalCountryCode;
          if (finalCountry && !existing.country) updateLocationData.country = finalCountry;
          if (finalRegion && !existing.region) updateLocationData.region = finalRegion;
          if (finalCity && !existing.city) updateLocationData.city = finalCity;
          if (finalLat != null && existing.lat == null) updateLocationData.lat = finalLat;
          if (finalLng != null && existing.lng == null) updateLocationData.lng = finalLng;

          // GPS override
          if (rawLat != null && rawLng != null) {
            updateLocationData.lat = parseFloat(String(rawLat));
            updateLocationData.lng = parseFloat(String(rawLng));
            if (finalCountryCode) updateLocationData.countryCode = finalCountryCode;
            if (finalCountry) updateLocationData.country = finalCountry;
            if (finalRegion) updateLocationData.region = finalRegion;
            if (finalCity) updateLocationData.city = finalCity;
          }

          await prisma.analyticsSession.update({
            where: { id: existing.id },
            data: {
              lastActiveAt: new Date(),
              currentPage: pageUrl || existing.currentPage,
              pageViews: eventName === 'page_view' ? { increment: 1 } : undefined,
              customerId: customerId || existing.customerId,
              ...updateLocationData,
            },
          });
        } else {
          try {
            await prisma.analyticsSession.create({
              data: {
                id: sessionId,
                anonymousId,
                customerId: customerId || null,
                platform: platform || 'web',
                landingPage: pageUrl || null,
                currentPage: pageUrl || null,
                pageViews: eventName === 'page_view' ? 1 : 0,
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
                // Approximate: first session row for this browser session id.
                // Avoids an extra count(*) under concurrent page_view storms.
                isNew: true,
              },
            });
          } catch (createErr: any) {
            if (createErr?.code === 'P2002') {
              await prisma.analyticsSession.update({
                where: { id: sessionId },
                data: {
                  lastActiveAt: new Date(),
                  currentPage: pageUrl || undefined,
                  pageViews: eventName === 'page_view' ? { increment: 1 } : undefined,
                  customerId: customerId || undefined,
                },
              });
            } else {
              throw createErr;
            }
          }
        }
      } catch (sessionErr: any) {
        if (sessionErr?.code !== 'P2002') {
          console.warn('[Analytics] Session upsert failed:', sessionErr?.message || 'error');
        }
      }
    }

    // Insert event with deduplication via unique eventId
    try {
      await prisma.analyticsEvent.create({
        data: {
          eventId,
          eventName,
          sessionId: sessionId || null,
          customerId: customerId || null,
          anonymousId: anonymousId || null,
          platform: platform || 'web',
          productId: productId || null,
          variantId: variantId || null,
          cartId: cartId || null,
          orderId: orderId || null,
          value: value != null ? parseFloat(String(value)) : null,
          currency: currency || 'INR',
          quantity: quantity != null ? parseInt(String(quantity), 10) : null,
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
        },
      });
    } catch (eventErr: any) {
      if (eventErr.code === 'P2002') {
        return NextResponse.json({ ok: true, dedup: true });
      }
      throw eventErr;
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[Analytics Track] Error:', error.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
