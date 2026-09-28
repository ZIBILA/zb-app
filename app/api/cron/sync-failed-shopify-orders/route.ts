import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import {
  syncOrderToShopify,
  SHOPIFY_SYNC_PAID_STATUSES,
} from '@/lib/services/shopifyOrderSyncService';

export const dynamic = 'force-dynamic';

/**
 * Cron worker: /api/cron/sync-failed-shopify-orders
 * Retries syncing paid orders that failed or never reached Shopify.
 * Payment gate: never sync unpaid / abandoned checkouts (ghost orders).
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
        shopifyOrderId: null,
        shopifySyncStatus: { in: ['failed', 'pending'] },
        paymentStatus: { in: [...SHOPIFY_SYNC_PAID_STATUSES] },
      },
      select: {
        id: true,
        paymentStatus: true,
        shopifySyncStatus: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    if (failedOrders.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: 'No failed orders to sync' });
    }

    const results: Array<{
      id: string;
      success: boolean;
      shopifyOrderId?: string;
      error?: string;
      skippedUnpaid?: boolean;
    }> = [];

    for (const order of failedOrders) {
      try {
        const syncRes = await syncOrderToShopify(order.id);
        results.push({
          id: order.id,
          success: syncRes.success,
          shopifyOrderId: syncRes.shopifyOrderId,
          error: syncRes.error,
          skippedUnpaid: syncRes.skippedUnpaid,
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
