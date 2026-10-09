import { NextRequest, NextResponse } from 'next/server';
import { eventTracker } from '@/lib/services/eventTracker';
import { rateLimitInMemory } from '@/lib/rate-limit-memory';
import { getClientIP } from '@/lib/ip-geo';

export const dynamic = 'force-dynamic';

/** Events the storefront sends through lib/track-client.ts (public, browser-facing). */
const ALLOWED_STOREFRONT_EVENTS = new Set([
  'Product Viewed', 'Category Viewed', 'Search Performed', 'Add To Wishlist', 'Add To Cart',
  'Remove From Cart', 'Checkout Started', 'Payment Initiated', 'Purchase Completed',
  'COD Order Placed', 'affiliate_applied',
]);
const MAX_ID_LEN = 128;
const MAX_METADATA_BYTES = 4096;

const optionalId = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() && v.length <= MAX_ID_LEN ? v.trim() : null;

export async function POST(req: NextRequest) {
  try {
    // In-memory throttle (no DB): storefront sends a handful per page; floods are dropped.
    const limited = rateLimitInMemory(`wa-track:${getClientIP(req)}`, { maxRequests: 60, windowMs: 60_000 });
    if (!limited.allowed) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(limited.resetAfter) } });
    }

    const body = await req.json();
    const { eventName, metadata = {} } = body || {};

    if (!eventName) {
      return NextResponse.json({ error: 'Missing eventName parameter' }, { status: 400 });
    }
    if (typeof eventName !== 'string' || !ALLOWED_STOREFRONT_EVENTS.has(eventName)) {
      return NextResponse.json({ error: 'Unsupported eventName' }, { status: 400 });
    }
    const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
    if (JSON.stringify(safeMetadata).length > MAX_METADATA_BYTES) {
      return NextResponse.json({ error: 'metadata too large' }, { status: 400 });
    }

    const result = await eventTracker.track({
      eventName,
      customerId: optionalId(body.customerId),
      customerPhone: typeof body.customerPhone === 'string' ? body.customerPhone.slice(0, 32) : null,
      orderId: optionalId(body.orderId),
      productId: optionalId(body.productId),
      // This public endpoint only ever records storefront (website) events; the source
      // is fixed so a caller cannot relabel website events as WhatsApp ones.
      eventSource: 'web',
      metadata: safeMetadata,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Track Event API Error]:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
