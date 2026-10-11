import { NextResponse } from 'next/server';
import { fetchCollectionByHandle, fetchProductById, flattenProduct, ShopifyProduct } from '@/lib/shopify-admin';
import { isStorefrontEligible } from '@/lib/storefrontCatalog';
import { getShopSettings } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') || '24', 10);
    const collectionHandle = url.searchParams.get('collection');

    const countOnly = url.searchParams.get('count') === 'true';

    const fetchAll = url.searchParams.get('all') === 'true' || limit >= 50;

    let products: ShopifyProduct[] = [];
    if (collectionHandle) {
      const result = await fetchCollectionByHandle(collectionHandle, limit);
      products = result.products;
    } else if (fetchAll) {
      // Everything eligible, in the Shop All order configured in the CMS.
      products = (await fetchCollectionByHandle('all')).products;
    } else {
      const shop = await getShopSettings();
      const homepageProducts = shop?.homepageProducts;
      const homepageCollection = shop?.homepageCollection;

      if (homepageProducts && homepageProducts.trim()) {
        const ids = homepageProducts.split(',').map((id: string) => id.trim()).filter(Boolean);
        const fetched = await Promise.all(
          ids.map((id: string) => fetchProductById(id).catch(() => null))
        );
        products = fetched.filter((p): p is ShopifyProduct => p !== null && isStorefrontEligible(p));
      } else if (homepageCollection && homepageCollection.trim()) {
        const result = await fetchCollectionByHandle(homepageCollection, limit);
        products = result.products;
      } else {
        products = (await fetchCollectionByHandle('all', limit)).products;
      }
    }

    if (countOnly) {
      return NextResponse.json({ total: products.length }, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    const flat = await Promise.all(products.map(flattenProduct));

    return NextResponse.json({ products: flat }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error('[App API] Products error:', error.message);
    return NextResponse.json(
      { products: [], error: error.message },
      { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
