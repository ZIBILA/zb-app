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
  | 'STORE_COINS_EARNED'
  | 'STORE_CREDIT_EXPIRING';

export type DeliveryChannel = 'email' | 'whatsapp';

const MAX_ATTEMPTS = 3;
/** The cron has a 60s limit, so a claim still "sending" after this long was interrupted mid-send. */
const STALE_SENDING_MS = 5 * 60 * 1000;

/**
 * Read every row a query matches, a page at a time. A single `take: N` silently ignores row N+1 onwards —
 * e.g. a bulk carrier sync that delivers 300 orders in one go would only ever message the newest 200.
 * `fetchPage` must use a stable orderBy.
 */
export async function pageAll(
  fetchPage: (page: { take: number; skip: number }) => Promise<any[]>,
  opts: { pageSize?: number; maxPages?: number } = {}
): Promise<any[]> {
  const take = opts.pageSize ?? 200;
  const maxPages = opts.maxPages ?? 25;
  const out: any[] = [];
  for (let i = 0; i < maxPages; i++) {
    const rows = await fetchPage({ take, skip: i * take });
    out.push(...rows);
    if (rows.length < take) break;
  }
  return out;
}

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
    // Already claimed. Retry a previous failure, or a claim that was interrupted before it finished.
    const existing = await prisma.customerEventDelivery.findUnique({
      where: { eventKey_channel: { eventKey: opts.eventKey, channel: opts.channel } },
    });
    const attempts = Number(String(existing?.error || '').match(/^\[attempt (\d+)\]/)?.[1] || 1);
    const staleCutoff = new Date(Date.now() - STALE_SENDING_MS);
    const interrupted =
      existing?.status === 'sending' && new Date(existing.updatedAt).getTime() < staleCutoff.getTime();
    if (!existing || (existing.status !== 'failed' && !interrupted) || attempts >= MAX_ATTEMPTS) return 'duplicate';
    // Atomic re-claim: only one retrier can win it.
    const { count } = await prisma.customerEventDelivery.updateMany({
      where: interrupted
        ? { id: existing.id, status: 'sending', updatedAt: { lt: staleCutoff } }
        : { id: existing.id, status: 'failed' },
      data: interrupted
        ? { status: 'sending', error: `[attempt ${attempts + 1}] reclaimed after an interrupted send` }
        : { status: 'sending' },
    });
    if (count === 0) return 'duplicate';
    rowId = existing.id;
  }

  try {
    await opts.send();
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

  // The message is out. A bookkeeping hiccup must never turn into "failed" (which would resend it):
  // retry the status write, and report "sent" regardless.
  for (let i = 0; i < 3; i++) {
    try {
      await prisma.customerEventDelivery.update({ where: { id: rowId }, data: { status: 'sent', error: null } });
      break;
    } catch (updateErr: any) {
      if (i === 2) {
        console.error(`[CustomerEvents] ${opts.eventKey} was sent but could not be marked sent:`, updateErr?.message || updateErr);
      } else {
        await new Promise((r) => setTimeout(r, 150 * (i + 1)));
      }
    }
  }
  return 'sent';
}
