/**
 * Shared Razorpay webhook helpers for the two webhook endpoints
 * (/api/webhooks/razorpay and /api/payments/webhook).
 *
 * - claimRazorpayWebhookEvent: insert-first de-duplication on a unique
 *   `WebhookEvent.eventKey` (Razorpay's x-razorpay-event-id when present,
 *   otherwise `${event}:${entity id}`). Razorpay delivers at-least-once and
 *   retries for 24 h; the old check-then-insert LIKE scan let two concurrent
 *   deliveries both run (duplicate Payment rows).
 * - nextOrderStatusOnCapture: every pre-confirmation Order.status (including
 *   FAILED / payment_failed / cancelled from an earlier attempt) becomes
 *   approved / open on capture. Leaving FAILED in place hid paid orders from
 *   the customer's order list.
 * - capturedAmountCheck: compares the captured amount with what the order
 *   expects (prepaid total, or the configured COD upfront fee).
 */
import prisma from '@/lib/db';
import { isPreConfirmationOrderStatus } from '@/lib/payment-status';
import { paymentAmountRupees } from '@/lib/razorpay-payment';

/** A delivery younger than this with processed=false is assumed to be in flight. */
export const WEBHOOK_INFLIGHT_WINDOW_MS = 90_000;

export function razorpayWebhookEventKey(req: Request, eventType: string, entityId: string): string {
  const headerId = req.headers.get('x-razorpay-event-id');
  if (headerId && headerId.trim()) return `evt:${headerId.trim().slice(0, 120)}`;
  return `${eventType}:${entityId}`.slice(0, 180);
}

export type WebhookClaim =
  | { duplicate: true; reason: 'processed' | 'in_flight' }
  | { duplicate: false; record: { id: string } };

export async function claimRazorpayWebhookEvent(opts: {
  eventType: string;
  eventKey: string;
  payload: string;
  source?: string;
}): Promise<WebhookClaim> {
  const source = opts.source || 'razorpay';
  try {
    const record = await prisma.webhookEvent.create({
      data: {
        source,
        eventType: opts.eventType,
        eventKey: opts.eventKey,
        payload: opts.payload,
        processed: false,
      },
      select: { id: true },
    });
    return { duplicate: false, record };
  } catch (err: any) {
    if (err?.code !== 'P2002') {
      // The eventKey column is added by prisma/migrations/20261029120000_webhook_event_key.
      // Until that migration has run in production, fall back to the previous
      // check-then-insert so webhooks keep working (without concurrency safety).
      const msg = String(err?.message || '');
      if (err?.code === 'P2022' || /eventKey/i.test(msg)) {
        console.error('[Razorpay Webhook] WebhookEvent.eventKey column missing — run the pending Prisma migration. Falling back to legacy de-duplication.');
        return legacyClaim(source, opts.eventType, opts.payload, opts.eventKey);
      }
      throw err;
    }
  }
  const existing = await prisma.webhookEvent.findFirst({
    where: { eventKey: opts.eventKey },
    select: { id: true, processed: true, createdAt: true },
  });
  if (!existing) {
    // Lost the insert race and the row vanished — treat as in flight; Razorpay retries.
    return { duplicate: true, reason: 'in_flight' };
  }
  if (existing.processed) return { duplicate: true, reason: 'processed' };
  const ageMs = Date.now() - new Date(existing.createdAt).getTime();
  if (ageMs < WEBHOOK_INFLIGHT_WINDOW_MS) return { duplicate: true, reason: 'in_flight' };
  // An earlier delivery recorded the event but never finished (crash / timeout):
  // reprocess it under the same row.
  return { duplicate: false, record: { id: existing.id } };
}

async function legacyClaim(source: string, eventType: string, payload: string, eventKey: string): Promise<WebhookClaim> {
  const entityId = eventKey.split(':').pop() || '';
  const existing = entityId
    ? await prisma.webhookEvent.findFirst({
        where: { source, eventType, payload: { contains: entityId }, processed: true },
        select: { id: true },
      })
    : null;
  if (existing) return { duplicate: true, reason: 'processed' };
  const record = await prisma.webhookEvent.create({
    data: { source, eventType, payload, processed: false },
    select: { id: true },
  });
  return { duplicate: false, record };
}

export function nextOrderStatusOnCapture(currentStatus: string | null | undefined, isCod: boolean): string {
  const confirmed = isCod ? 'open' : 'approved';
  if (!currentStatus) return confirmed;
  return isPreConfirmationOrderStatus(currentStatus) ? confirmed : currentStatus;
}

export type CapturedAmountCheck = {
  capturedRupees: number;
  expectedRupees: number;
  /** captured + tolerance < expected (same currency) */
  underpaid: boolean;
  /** payment currency differs from the order currency: amounts not comparable */
  currencyMismatch: boolean;
};

export function capturedAmountCheck(
  payment: { amount?: number | null; currency?: string | null },
  order: { totalPrice?: unknown; currency?: string | null },
  opts: { isCod: boolean; codUpfrontRupees: number; toleranceRupees?: number }
): CapturedAmountCheck {
  const capturedRupees = paymentAmountRupees(payment);
  const expectedRupees = opts.isCod ? Number(opts.codUpfrontRupees) || 0 : Number(order.totalPrice) || 0;
  const payCur = String(payment.currency || '').trim().toUpperCase();
  const orderCur = String(order.currency || 'INR').trim().toUpperCase();
  const currencyMismatch = Boolean(payCur) && payCur !== orderCur;
  const tol = opts.toleranceRupees ?? 1;
  const underpaid = !currencyMismatch && expectedRupees > 0 && capturedRupees + tol < expectedRupees;
  return { capturedRupees, expectedRupees, underpaid, currencyMismatch };
}

/** Admin alert body for an under-captured payment (plain HTML, no secrets). */
export function underpaidAlertHtml(args: {
  orderId: string;
  orderNumber?: string | null;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  capturedRupees: number;
  expectedRupees: number;
  currency?: string | null;
  source: string;
}): string {
  const cur = args.currency || 'INR';
  return `<div style="font-family: sans-serif; padding: 20px;">
    <h2 style="color:#d97706;margin-top:0;">Under-captured payment — order held for review</h2>
    <p>The captured amount is lower than the order total. The order is marked <b>partially_paid</b>, tagged <b>underpaid</b>, and its Shopify sync is held (<b>needs_review</b>) until someone checks it.</p>
    <table style="border-collapse:collapse;">
      <tr><td style="padding:4px 8px;font-weight:bold;">Order</td><td>${args.orderNumber || args.orderId}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Razorpay order</td><td>${args.razorpayOrderId || 'n/a'}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Razorpay payment</td><td>${args.razorpayPaymentId || 'n/a'}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Captured</td><td>${cur} ${args.capturedRupees.toLocaleString('en-IN')}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Expected</td><td>${cur} ${args.expectedRupees.toLocaleString('en-IN')}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Detected by</td><td>${args.source}</td></tr>
    </table>
  </div>`;
}
