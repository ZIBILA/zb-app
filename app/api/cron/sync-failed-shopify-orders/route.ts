import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { retryFailedPaidShopifySyncs } from '@/lib/services/orderLifecycleService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Cron worker: /api/cron/sync-failed-shopify-orders
 *
 * Runs every ~30 minutes. Retries paid orders that failed / never reached Shopify
 * (phone validation errors, temporary API failures, historical backlog).
 * Skips Razorpay recovery placeholders until data is fixed and status leaves needs_review.
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
    const limit = Math.min(Number(searchParams.get('limit') || 25) || 25, 50);
    const batch = await retryFailedPaidShopifySyncs(limit);
    const ok = batch.results.filter((r) => r.success).length;
    const failed = batch.results.filter((r) => !r.success && !r.skippedUnpaid).length;

    try {
      await prisma.syncLog.create({
        data: {
          orderId: 'system',
          action: 'CRON_PING_FAILED_SHOPIFY_SYNC',
          status: failed > 0 && ok === 0 ? 'ERROR' : 'SUCCESS',
          payload: JSON.stringify({
            processed: batch.processed,
            ok,
            failed,
            results: batch.results.slice(0, 25),
          }),
        },
      });
    } catch (logErr) {
      console.error('[Sync Failed Orders Cron] Failed to log cron ping:', logErr);
    }

    return NextResponse.json({
      success: true,
      processed: batch.processed,
      ok,
      failed,
      results: batch.results,
      message:
        batch.processed === 0
          ? 'No failed/pending paid orders to sync'
          : `Retried ${batch.processed} order(s): ${ok} synced, ${failed} still failing`,
    });
  } catch (err: any) {
    console.error('[Sync Failed Orders Cron] Top-level error:', err);
    return NextResponse.json({ error: 'Internal Server Error', message: err.message }, { status: 500 });
  }
}
