import { NextResponse } from 'next/server';
import { fetchStorefrontCatalog } from '@/lib/shopify-admin';

/**
 * Public list of product keys (handles and numeric ids) of the storefront catalogue,
 * used by middleware.ts to answer /products/<unknown> with a real 404 (the page
 * otherwise renders its not-found UI with status 200 behind the root loading.tsx).
 * ISR-cached like the catalogue; an empty list is 503 so the middleware fails open.
 */
export const revalidate = 120;

export async function GET() {
  try {
    const products = await fetchStorefrontCatalog();
    const keys = new Set<string>();
    for (const p of products) {
      const h = String(p.handle || '').trim().toLowerCase();
      if (h) keys.add(h);
      if (p.id !== undefined && p.id !== null) keys.add(String(p.id));
    }
    if (!keys.size) return NextResponse.json({ error: 'catalogue unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ handles: Array.from(keys) }, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'catalogue unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
