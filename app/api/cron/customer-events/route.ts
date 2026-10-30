import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { scanCustomerEvents } from '@/lib/notifications/event-scanner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Cron: /api/cron/customer-events
 *
 * Scans order / return / exchange / store-credit state and sends the lifecycle emails that are due.
 * Each (event, channel) is claimed once in customer_event_deliveries, so overlapping runs never double-send.
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
    const summary = await scanCustomerEvents();
    try {
      await prisma.syncLog.create({
        data: { orderId: 'system', action: 'CRON_PING_CUSTOMER_EVENTS', status: 'SUCCESS', payload: JSON.stringify(summary) },
      });
    } catch (logErr) {
      console.error('[Customer Events Cron] Failed to log cron ping:', logErr);
    }
    return NextResponse.json({ success: true, ...summary });
  } catch (error: any) {
    console.error('[Customer Events Cron] Error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
