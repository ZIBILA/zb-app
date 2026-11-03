import { NextResponse } from 'next/server';
import { getAppProduct } from '@/lib/app-product-detail';

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  'Access-Control-Allow-Origin': '*',
};

export async function GET(
  _req: Request,
  { params }: { params: { handle: string } }
) {
  try {
    const product = await getAppProduct(params.handle);
    if (!product) {
      return NextResponse.json(
        { product: null, error: 'Product not found' },
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }
    return NextResponse.json({ product }, { headers: HEADERS });
  } catch (error: any) {
    console.error('[App API] Product by handle error:', error.message);
    return NextResponse.json(
      { product: null, error: error.message },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
