import { NextResponse } from 'next/server';
import { fetchProductByHandle, flattenProduct } from '@/lib/shopify-admin';
import { isStorefrontEligible } from '@/lib/storefrontCatalog';
import {
  getCachedAppProduct,
  getInflightAppProduct,
  setCachedAppProduct,
  setInflightAppProduct,
  deleteInflightAppProduct,
} from '@/lib/appProductCache';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { handle: string } }
) {
  try {
    const handle = params.handle;
    const cached = getCachedAppProduct(handle);
    if (cached) {
      return NextResponse.json({ product: cached }, {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const inflight = getInflightAppProduct(handle);
    if (inflight) {
      const product = await inflight;
      if (!product) {
        return NextResponse.json(
          { product: null, error: 'Product not found' },
          { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
        );
      }
      return NextResponse.json({ product }, {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const fetchPromise = (async () => {
      const rawProduct = await fetchProductByHandle(handle);
      // Drafted / unpublished products are not sold in the app either.
      if (!rawProduct || !isStorefrontEligible(rawProduct)) return null;
      const flattened = await flattenProduct(rawProduct);
      setCachedAppProduct(handle, flattened);
      return flattened;
    })().finally(() => {
      deleteInflightAppProduct(handle);
    });

    setInflightAppProduct(handle, fetchPromise);
    const product = await fetchPromise;

    if (!product) {
      return NextResponse.json(
        { product: null, error: 'Product not found' },
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    return NextResponse.json({ product }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error('[App API] Product by handle error:', error.message);
    return NextResponse.json(
      { product: null, error: error.message },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
