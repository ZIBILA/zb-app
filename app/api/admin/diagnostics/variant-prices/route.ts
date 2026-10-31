import { NextResponse } from 'next/server';
import { withAdminApiGuard } from '@/lib/auth/admin-api-guard';
import { fetchVariantPrices, variantNumericId } from '@/lib/variant-prices';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/diagnostics/variant-prices?ids=123,456
 *
 * Read-only check that the server can price variants from Shopify (the lookup
 * the Razorpay pre-create and /api/checkout/complete rely on). Returns what
 * Shopify answered and how long it took; no order or cart data is touched.
 */
export const GET = withAdminApiGuard(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const ids = String(searchParams.get('ids') || '')
    .split(',')
    .map((v) => variantNumericId(v))
    .filter(Boolean)
    .slice(0, 50);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Pass ?ids=<variant id>[,<variant id>…]' }, { status: 400 });
  }
  const startedAt = Date.now();
  const prices = await fetchVariantPrices(ids, { timeoutMs: 8000 });
  return NextResponse.json({
    requested: ids,
    found: Object.fromEntries(prices),
    missing: ids.filter((id) => !prices.has(id)),
    ms: Date.now() - startedAt,
  });
});
