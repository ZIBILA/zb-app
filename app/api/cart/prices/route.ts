import { NextResponse } from 'next/server';
import { fetchVariantPrices } from '@/lib/variant-prices';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cart/prices?variants=1,2,3 → { prices: { "<variantId>": "2799.00" } }
 *
 * Carts keep the price a line was added at. When a sale starts or ends, those go stale and checkout's
 * server-side price check would reject the order ("Cart total mismatch"), so the cart refreshes them here.
 */
export async function GET(req: Request) {
  const rateLimitResult = await checkRateLimit(req, 'cart-prices', { maxRequests: 60, windowMs: 60_000 });
  if (!rateLimitResult.allowed && rateLimitResult.response) {
    return rateLimitResult.response;
  }

  const ids = Array.from(
    new Set(
      (new URL(req.url).searchParams.get('variants') || '')
        .split(',')
        .map((id) => id.trim().split('/').pop() || '')
        .filter((id) => /^\d+$/.test(id))
    )
  ).slice(0, 100);
  if (ids.length === 0) return NextResponse.json({ prices: {} });

  try {
    const found = await fetchVariantPrices(ids);
    const prices: Record<string, string> = {};
    found.forEach((price, id) => {
      prices[id] = String(price);
    });
    return NextResponse.json({ prices });
  } catch (error: any) {
    console.error('[Cart Prices] Shopify variant fetch failed:', error?.message || error);
    return NextResponse.json({ prices: {} }, { status: 502 });
  }
}
