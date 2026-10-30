/**
 * Customer lifecycle events — the shared trigger layer for email now and WhatsApp later
 * (Developer Brief #23 / #24).
 *
 * Every notification goes through deliverOnce(): it first CLAIMS the (eventKey, channel) row, and only
 * the caller that wins the claim sends. A second run, a retried webhook, a manual admin resend of the same
 * status, or two servers racing all hit the unique constraint and skip — nothing is sent twice.
 * A failed send is recorded as "failed" and retried on a later scan (up to MAX_ATTEMPTS).
 */

import prisma from '@/lib/db';

export type CustomerEventType =
  | 'ORDER_CONFIRMED'
  | 'ORDER_SHIPPED'
  | 'ORDER_OUT_FOR_DELIVERY'
  | 'ORDER_DELIVERED'
  | 'ORDER_CANCELLED'
  | 'RETURN_ACCEPTED'
  | 'RETURN_PICKUP_UPDATE'
  | 'RETURN_RECEIVED'
  | 'REFUND_PROCESSED'
  | 'EXCHANGE_CONFIRMED'
  | 'EXCHANGE_PICKUP_UPDATE'
  | 'EXCHANGE_QC_PASSED'
  | 'REPLACEMENT_CREATED'
  | 'REPLACEMENT_SHIPPED'
  | 'REPLACEMENT_OUT_FOR_DELIVERY'
  | 'REPLACEMENT_DELIVERED'
  | 'FEEDBACK_REQUEST'
  | 'STORE_CREDIT_EARNED'
  | 'STORE_CREDIT_EXPIRING';

export type DeliveryChannel = 'email' | 'whatsapp';

const MAX_ATTEMPTS = 3;

/** Display order number used in keys, so "#ZB72210" and "zb72210" are the same order. */
export const normalizeOrderRef = (ref: string | number | null | undefined) =>
  String(ref ?? '').replace(/^#/, '').trim().toUpperCase();

/** Placeholder addresses created for guest checkouts — never email them. */
export function isDeliverableEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  return !/^guest_\d+@zicabella\.com$/.test(e) && !e.endsWith('@example.com');
}

/**
 * Run `send` at most once for (eventKey, channel).
 * Returns "sent" | "duplicate" (already handled) | "failed".
 */
export async function deliverOnce(opts: {
  eventKey: string;
  eventType: CustomerEventType;
  channel: DeliveryChannel;
  recipient: string;
  send: () => Promise<void>;
}): Promise<'sent' | 'duplicate' | 'failed'> {
  let rowId: string;
  try {
    const row = await prisma.customerEventDelivery.create({
      data: {
        eventKey: opts.eventKey,
        eventType: opts.eventType,
        channel: opts.channel,
        recipient: opts.recipient,
        status: 'sending',
      },
    });
    rowId = row.id;
  } catch (err: any) {
    if (err?.code !== 'P2002') throw err;
    // Already claimed. Retry only a previous failure, and only a few times.
    const existing = await prisma.customerEventDelivery.findUnique({
      where: { eventKey_channel: { eventKey: opts.eventKey, channel: opts.channel } },
    });
    const attempts = Number(String(existing?.error || '').match(/^\[attempt (\d+)\]/)?.[1] || 1);
    if (!existing || existing.status !== 'failed' || attempts >= MAX_ATTEMPTS) return 'duplicate';
    // Atomic re-claim: only one retrier can flip failed → sending.
    const { count } = await prisma.customerEventDelivery.updateMany({
      where: { id: existing.id, status: 'failed' },
      data: { status: 'sending' },
    });
    if (count === 0) return 'duplicate';
    rowId = existing.id;
  }

  try {
    await opts.send();
    await prisma.customerEventDelivery.update({ where: { id: rowId }, data: { status: 'sent', error: null } });
    return 'sent';
  } catch (err: any) {
    const prev = await prisma.customerEventDelivery.findUnique({ where: { id: rowId }, select: { error: true } });
    const attempt = Number(String(prev?.error || '').match(/^\[attempt (\d+)\]/)?.[1] || 0) + 1;
    await prisma.customerEventDelivery.update({
      where: { id: rowId },
      data: { status: 'failed', error: `[attempt ${attempt}] ${String(err?.message || err).slice(0, 500)}` },
    });
    console.error(`[CustomerEvents] ${opts.eventType} via ${opts.channel} failed for ${opts.eventKey}:`, err?.message || err);
    return 'failed';
  }
}
