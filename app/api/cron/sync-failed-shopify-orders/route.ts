import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { syncOrderToShopify } from '@/lib/services/shopifyOrderSyncService';

export const dynamic = 'force-dynamic';

/**
 * Cron worker: /api/cron/sync-failed-shopify-orders
 * Retries syncing orders that failed to sync to Shopify.
 * Runs in batches of 10, ordered by createdAt ASC to prevent starvation.
 * Excludes orders that are already synced or in-flight ('syncing').
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
    const failedOrders = await prisma.order.findMany({
      where: {
        shopifySyncStatus: 'failed',
        shopifyOrderId: null,
      },
      select: {
        id: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    if (failedOrders.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: 'No failed orders to sync' });
    }

    const results: Array<{ id: string; success: boolean; shopifyOrderId?: string; error?: string }> = [];

    for (const order of failedOrders) {
      try {
        const syncRes = await syncOrderToShopify(order.id);
        results.push({
          id: order.id,
          success: syncRes.success,
          shopifyOrderId: syncRes.shopifyOrderId,
          error: syncRes.error,
        });
      } catch (orderErr: any) {
        console.error(`[Sync Failed Orders Cron] Failed to sync order ${order.id}:`, orderErr.message);
        results.push({ id: order.id, success: false, error: orderErr.message });
      }
    }

    return NextResponse.json({
      success: true,
      processed: failedOrders.length,
      results,
    });
  } catch (err: any) {
    console.error('[Sync Failed Orders Cron] Top-level error:', err);
    return NextResponse.json({ error: 'Internal Server Error', message: err.message }, { status: 500 });
  }
}
