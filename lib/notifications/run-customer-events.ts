import prisma from '@/lib/db';
import { scanCustomerEvents } from '@/lib/notifications/event-scanner';
import { scanWhatsAppEvents } from '@/lib/notifications/whatsapp-events';
import { issueMissingCouponCashback } from '@/lib/storeCreditsHelper';

/**
 * One pass of the customer lifecycle notifications: lifecycle emails, then the WhatsApp lifecycle messages
 * (order cancelled, refund, out for delivery, delivered, store credit...).
 *
 * Run every 5 minutes by the server's job runner (lib/background-jobs.ts) and by /api/cron/customer-events
 * (GitHub Actions backup). Every (event, channel) is claimed once in customer_event_deliveries, so overlapping
 * runs never double-send.
 */
export async function runCustomerEventsCycle() {
  // Paid prepaid orders confirmed by the webhook / reconciler never got their coupon cashback (only the browser's
  // /complete call issued it), so there was no store credit to announce. Issue it first.
  let cashbackIssued = 0;
  try {
    cashbackIssued = await issueMissingCouponCashback();
  } catch (err: any) {
    console.error('[Customer Events] Missing cashback sweep failed:', err?.message || err);
  }

  const summary = await scanCustomerEvents();
  // WhatsApp is independent of email: a failure in one must never block the other.
  let whatsapp: Awaited<ReturnType<typeof scanWhatsAppEvents>> | { error: string };
  try {
    whatsapp = await scanWhatsAppEvents();
  } catch (waErr: any) {
    console.error('[Customer Events] WhatsApp scan failed:', waErr);
    whatsapp = { error: waErr?.message || 'WhatsApp scan failed' };
  }
  try {
    await prisma.syncLog.create({
      data: {
        orderId: 'system',
        action: 'CRON_PING_CUSTOMER_EVENTS',
        status: 'SUCCESS',
        payload: JSON.stringify({ ...summary, whatsapp, cashbackIssued }),
      },
    });
  } catch (logErr) {
    console.error('[Customer Events] Failed to log cron ping:', logErr);
  }
  return { ...summary, whatsapp, cashbackIssued };
}
