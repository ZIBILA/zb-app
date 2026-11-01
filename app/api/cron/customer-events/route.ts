import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { scanCustomerEvents } from '@/lib/notifications/event-scanner';
import { scanWhatsAppEvents } from '@/lib/notifications/whatsapp-events';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Cron: /api/cron/customer-events
 *
 * Scans order / return / exchange / store-credit state and sends the lifecycle emails (event-scanner) and
 * WhatsApp messages (whatsapp-events) that are due.
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
    // WhatsApp is independent of email: a failure in one must never block the other.
    let whatsapp: Awaited<ReturnType<typeof scanWhatsAppEvents>> | { error: string };
    try {
      whatsapp = await scanWhatsAppEvents();
    } catch (waErr: any) {
      console.error('[Customer Events Cron] WhatsApp scan failed:', waErr);
      whatsapp = { error: waErr?.message || 'WhatsApp scan failed' };
    }
    try {
      await prisma.syncLog.create({
        data: { orderId: 'system', action: 'CRON_PING_CUSTOMER_EVENTS', status: 'SUCCESS', payload: JSON.stringify({ ...summary, whatsapp }) },
      });
    } catch (logErr) {
      console.error('[Customer Events Cron] Failed to log cron ping:', logErr);
    }
    return NextResponse.json({ success: true, ...summary, whatsapp });
  } catch (error: any) {
    console.error('[Customer Events Cron] Error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
