import { NextRequest, NextResponse } from 'next/server';
import { syncRecentOrderLifecyclesToShopify } from '@/lib/services/shopifyLifecycleSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Cron: /api/cron/shopify-lifecycle-sync[?days=3]
 *
 * Pushes fulfillment + tracking, delivery, COD payment and cancellation of recently changed orders to Shopify.
 * The server already runs it every 10 minutes (lib/background-jobs.ts); call it with `?days=60` once to backfill.
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 3, 1), 120);
  try {
    const summary = await syncRecentOrderLifecyclesToShopify({ days, limit: days > 3 ? 2000 : 300, budgetMs: 270_000 });
    return NextResponse.json({ success: true, days, ...summary });
  } catch (error: any) {
    console.error('[Shopify Lifecycle Cron] Error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
