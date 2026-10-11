import { NextResponse } from 'next/server';
import { fetchCatalogForAdmin, fetchCollectionByHandle } from '@/lib/shopify-admin';
import { isStorefrontEligible } from '@/lib/storefrontCatalog';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopify/products
 *   (no params)           → EVERY Shopify product (all pages, any status) for CMS pickers.
 *                           Each product carries `live: boolean` = visible to customers on the website.
 *   ?collection=<handle>  → the products customers see in that collection, in CMS order.
 *   ?limit=N              → optional cap (only when explicitly requested).
 *
 * Errors are reported honestly (HTTP 502) instead of returning placeholder products.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const collectionHandle = url.searchParams.get('collection');
    const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;

    let products: any[];
    if (collectionHandle) {
      const result = await fetchCollectionByHandle(collectionHandle, limit);
      products = result.products.map((p) => ({ ...p, live: true }));
    } else {
      const all = await fetchCatalogForAdmin();
      products = all.map((p) => ({ ...p, live: isStorefrontEligible(p) }));
      if (limit) products = products.slice(0, limit);
    }

    return NextResponse.json({ products, total: products.length }, { status: 200 });
  } catch (error: any) {
    console.error('Shopify Products API Error:', error?.message || 'fetch failed');
    return NextResponse.json({ products: [], total: 0, error: 'Failed to fetch products from Shopify' }, { status: 502 });
  }
}
