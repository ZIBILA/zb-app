/**
 * Client-Callable IP Geolocation API
 *
 * GET /api/geo
 *
 * Returns approximate location based on the visitor's IP address.
 * Uses edge headers (Vercel/Cloudflare) when available for 0ms latency,
 * otherwise falls back to the multi-provider IP lookup chain in lib/ip-geo.
 *
 * This endpoint is used by:
 * - Checkout "Detect my location" when GPS permission is denied
 * - Geolocation enrichment when browser geolocation is denied
 *
 * Always returns 200 with { ok: true/false } — never throws to the client.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClientIP, lookupIpGeo, extractEdgeGeo } from '@/lib/ip-geo';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // 1. Try edge headers first (0ms on Vercel / Cloudflare)
    const edge = extractEdgeGeo(req as unknown as Request);

    // 2. Extract IP and lookup via multi-provider chain
    const ip = getClientIP(req as unknown as Request);
    const geo = edge || (await lookupIpGeo(ip, req as unknown as Request));

    if (!geo || geo.isDevFallback) {
      // Unknown (or a development placeholder): never hand the browser a made-up
      // location — it would be stored as the customer's address for a year.
      return NextResponse.json({ ok: false }, { status: 200 });
    }

    return NextResponse.json({
      ok: true,
      city: geo.city,
      region: geo.region,
      country: geo.country,
      countryCode: geo.countryCode,
      zip: geo.zip ?? null,
      lat: geo.lat,
      lng: geo.lng,
      source: 'ip',
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
