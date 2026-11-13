import { NextRequest, NextResponse } from 'next/server';
import { runCustomerEventsCycle } from '@/lib/notifications/run-customer-events';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Cron: /api/cron/customer-events
 *
 * Scans order / return / exchange / store-credit state and sends the lifecycle emails (event-scanner) and
 * WhatsApp messages (whatsapp-events) that are due. The server already runs this every 5 minutes
 * (lib/background-jobs.ts); this endpoint is the external backup trigger.
 * Each (event, channel) is claimed once in customer_event_deliveries, so overlapping runs never double-send.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
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
    return NextResponse.json({ success: true, ...(await runCustomerEventsCycle()) });
  } catch (error: any) {
    console.error('[Customer Events Cron] Error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
