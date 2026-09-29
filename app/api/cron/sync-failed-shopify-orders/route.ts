import { NextRequest, NextResponse } from 'next/server';
import { retryFailedPaidShopifySyncs } from '@/lib/services/orderLifecycleService';

export const dynamic = 'force-dynamic';

/**
 * Cron worker: /api/cron/sync-failed-shopify-orders
 * Retries syncing paid orders that failed or never reached Shopify.
 * Payment gate lives in syncOrderToShopify (via retryFailedPaidShopifySyncs).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[Sync Failed Orders Cron] CRON_SECRET is not configured in environment.');
    return NextResponse.json({ error: 'Unauthorized (Config missing)' }, { status: 401 });
  }

  const authHeader = req.headers.get('Authorization');
  if (secret !== cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const limit = Math.min(Number(searchParams.get('limit') || 15) || 15, 50);
    const batch = await retryFailedPaidShopifySyncs(limit);

    return NextResponse.json({
      success: true,
      processed: batch.processed,
      results: batch.results,
      message: batch.processed === 0 ? 'No failed orders to sync' : undefined,
    });
  } catch (err: any) {
    console.error('[Sync Failed Orders Cron] Top-level error:', err);
    return NextResponse.json({ error: 'Internal Server Error', message: err.message }, { status: 500 });
  }
}
