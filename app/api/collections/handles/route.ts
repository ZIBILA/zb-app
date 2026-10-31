import { NextResponse } from 'next/server';
import { fetchCollections } from '@/lib/shopify-admin';

/**
 * Public list of collection handles, used by middleware.ts to answer an unknown
 * /collections/<handle> with a real 404 (a notFound() inside the app streams a
 * 200 shell first because of the root loading.tsx). ISR-cached like the rest of
 * the catalogue and refreshed by the Shopify webhooks' revalidateTag; an empty
 * list is reported as 503 so the middleware fails open on a Shopify outage.
 */
export const revalidate = 120;

export async function GET() {
  try {
    const collections = await fetchCollections();
    const handles = Array.from(new Set(collections.map(c => String(c.handle || '').trim().toLowerCase()).filter(Boolean)));
    if (!handles.length) return NextResponse.json({ error: 'collections unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ handles }, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'collections unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
