import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { pollActiveShipments } from '@/lib/services/shipmentPollService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Cron: /api/cron/sync-shipments
 *
 * Polls Shiprocket for every in-flight forward / return / exchange shipment and applies the
 * result through the shared status pipeline. Lets the dashboard reflect pickup, transit,
 * delivery, failure and RTO automatically (no webhook required).
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (sent automatically by Vercel Cron).
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await pollActiveShipments();

    // Dead-man's-switch ping for /api/cron/health
    try {
      await prisma.syncLog.create({
        data: {
          orderId: 'system',
          action: 'CRON_PING_SHIPMENT_SYNC',
          status: summary.errors > 0 && summary.updated + summary.unchanged === 0 ? 'FAILED' : 'SUCCESS',
          payload: JSON.stringify(summary),
        },
      });
    } catch (logErr) {
      console.error('[Shipment Sync Cron] Failed to log cron ping:', logErr);
    }

    return NextResponse.json({ success: true, ...summary });
  } catch (error: any) {
    console.error('[Shipment Sync Cron] Error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
