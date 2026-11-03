import { NextResponse } from 'next/server';
import { cachedAppList } from '@/lib/app-list-cache';
import { buildAppProductList, listCacheKey, parseListParams } from '@/lib/app-products-list';

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  'Access-Control-Allow-Origin': '*',
};

export async function GET(req: Request) {
  try {
    const params = parseListParams(new URL(req.url));
    // Served from memory while fresh or stale; rebuilt once (not once per shopper) when empty. See lib/app-list-cache.ts.
    const { json, state } = await cachedAppList(listCacheKey(params), () => buildAppProductList(params));
    return new Response(json, {
      status: 200,
      headers: { ...HEADERS, 'Content-Type': 'application/json', 'X-ZB-Cache': state },
    });
  } catch (error: any) {
    console.error('[App API] Products error:', error.message);
    return NextResponse.json(
      { products: [], error: error.message },
      { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
