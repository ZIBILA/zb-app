import { NextResponse } from 'next/server';
import { fetchCollections, fetchEnabledCollections, ShopifyCollection } from '@/lib/shopify-admin';

export const dynamic = 'force-dynamic';

function flattenCollection(c: ShopifyCollection) {
  return {
    id: `gid://shopify/Collection/${c.id}`,
    title: c.title,
    handle: c.handle,
    description: c.body_html ? c.body_html.replace(/<[^>]*>/g, '') : '',
    image: c.image?.src || null,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const location = url.searchParams.get('location') as 'header' | 'page' | 'menu' | null;
    const all = url.searchParams.get('all') === 'true';

    let collections: ShopifyCollection[];
    if (all) {
      collections = await fetchCollections();
    } else {
      collections = await fetchEnabledCollections(location || 'page');
    }

    if (url.searchParams.get('count') === 'true') {
      return NextResponse.json({ total: collections.length }, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    const flat = collections.map(flattenCollection);

    return NextResponse.json({ collections: flat }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error('[App API] Collections error:', error.message);
    return NextResponse.json(
      { collections: [], error: error.message },
      { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
