import { NextResponse } from 'next/server';
import { fetchProducts, fetchCollectionByHandle } from '@/lib/shopify-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawLimit = url.searchParams.get('limit') || url.searchParams.get('pageSize') || '50';
    const pageSize = Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), 250);
    const collectionHandle = url.searchParams.get('collection');

    let products = [];
    if (collectionHandle) {
      const { products: collectionProducts } = await fetchCollectionByHandle(collectionHandle, pageSize);
      products = collectionProducts;
    } else {
      // Single page only — do not walk the full Shopify product catalog on every poll
      products = await fetchProducts(pageSize);
    }

    return NextResponse.json({ products }, { status: 200 });
  } catch (error: any) {
    console.error('Shopify Products API Error:', error?.message || 'fetch failed');
    return NextResponse.json(
      { products: [], error: 'Failed to fetch products' },
      { status: 200 },
    );
  }
}
