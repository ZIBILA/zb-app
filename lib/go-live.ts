/**
 * The moment the order-automation fixes went live. Everything the new automations do on their own (refunds,
 * cashback, status repairs, Shopify sync, customer messages) applies only to what happens AFTER this moment, never
 * to history: deploying must not refund, credit, repair or message about anything that already happened.
 *
 * Stored once, in the existing customer_event_deliveries table (no migration), the first time any job asks for it.
 * Explicit admin actions (Retry refund button, manual sync endpoints) are not limited by it.
 */
import prisma from '@/lib/db';

const KEY = { eventKey_channel: { eventKey: '__fixes_go_live__', channel: 'system' } };
let cached: Date | null = null;

export async function getGoLive(): Promise<Date> {
  if (cached) return cached;
  try {
    const existing = await prisma.customerEventDelivery.findUnique({ where: KEY });
    if (existing) return (cached = existing.createdAt);
    try {
      const row = await prisma.customerEventDelivery.create({
        data: { eventKey: '__fixes_go_live__', eventType: 'SCANNER_INIT', channel: 'system', status: 'sent' },
      });
      return (cached = row.createdAt);
    } catch {
      const row = await prisma.customerEventDelivery.findUnique({ where: KEY });
      return (cached = row?.createdAt || new Date());
    }
  } catch (err: any) {
    // If the marker cannot be read or written, fail CLOSED: act on nothing older than now.
    console.error('[go-live] could not read the go-live marker; acting on nothing older than this moment:', err?.message || err);
    return new Date();
  }
}
