import { NextResponse } from 'next/server';
import { fetchCollectionByHandle, flattenProducts } from '@/lib/shopify-admin';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: { handle: string } }
) {
  try {
    const url = new URL(req.url);
    const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
    // No limit = every eligible product in the collection (the app used to be capped at 50).
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;

    const { collection, products } = await fetchCollectionByHandle(params.handle, limit);

    // Do not substitute "all products" when a collection is empty/missing — that made
    // Accessories (and similar sections) show unrelated apparel on the live storefront.
    if (!collection) {
      return NextResponse.json(
        { collection: null, products: [], error: 'Collection not found' },
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // Batch metafield hydration — avoids one REST call per product (Shopify 429s).
    const flatProducts = await flattenProducts(products);

    return NextResponse.json({
      collection: {
        id: `gid://shopify/Collection/${collection.id}`,
        title: collection.title,
        handle: collection.handle,
        description: collection.body_html ? collection.body_html.replace(/<[^>]*>/g, '') : '',
        image: collection.image?.src || null,
      },
      products: flatProducts,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error('[App API] Collection by handle error:', error.message);
    return NextResponse.json(
      { collection: null, products: [], error: error.message },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
