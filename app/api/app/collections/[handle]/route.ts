import { NextResponse } from 'next/server';
import { fetchCollectionByHandle, flattenProducts } from '@/lib/shopify-admin';
import { cachedAppList } from '@/lib/app-list-cache';
import { parseFields, trimProduct } from '@/lib/app-products-list';

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  'Access-Control-Allow-Origin': '*',
};

class CollectionNotFound extends Error {}

export async function GET(
  req: Request,
  { params }: { params: { handle: string } }
) {
  try {
    const url = new URL(req.url);
    const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
    // No limit = every eligible product in the collection (the app used to be capped at 50).
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
    const fields = parseFields(url.searchParams.get('fields'));
    const handle = params.handle;

    // Same cache as the product list (lib/app-list-cache.ts): instant when warm, one rebuild for many shoppers.
    // A missing collection is not cached.
    const key = `coll:${String(handle).toLowerCase()}:${limit ?? 'all'}|${fields ? Array.from(fields).sort().join(',') : '*'}`;
    const { json, state } = await cachedAppList(key, async () => {
      const { collection, products } = await fetchCollectionByHandle(handle, limit);
      // Do not substitute "all products" when a collection is empty/missing — that made
      // Accessories (and similar sections) show unrelated apparel on the live storefront.
      if (!collection) throw new CollectionNotFound();
      // Batch metafield hydration — avoids one REST call per product (Shopify 429s).
      const flatProducts = await flattenProducts(products);
      return {
        collection: {
          id: `gid://shopify/Collection/${collection.id}`,
          title: collection.title,
          handle: collection.handle,
          description: collection.body_html ? collection.body_html.replace(/<[^>]*>/g, '') : '',
          image: collection.image?.src || null,
        },
        // Only what product cards need when the app names its fields (see lib/app-products-list.ts).
        products: flatProducts.map((p: any) => trimProduct(p, fields)),
      };
    });
    return new Response(json, { status: 200, headers: { ...HEADERS, 'Content-Type': 'application/json', 'X-ZB-Cache': state } });
  } catch (error: any) {
    if (error instanceof CollectionNotFound) {
      return NextResponse.json(
        { collection: null, products: [], error: 'Collection not found' },
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }
    console.error('[App API] Collection by handle error:', error.message);
    return NextResponse.json(
      { collection: null, products: [], error: error.message },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
