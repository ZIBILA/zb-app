import { resolveRazorpayCredentials } from '@/lib/razorpay-credentials';
import Razorpay from 'razorpay';
import prisma from '@/lib/db';
import { toMinorUnits } from '@/lib/global-pricing';
import { assignRefundId } from '@/lib/orderNumber';

/**
 * Automatic refund for a cancelled order (customer or admin cancellation, Shopify cancel webhook, retries).
 *
 *  - Prepaid: the amount paid through Razorpay. COD: the upfront amount paid through Razorpay.
 *  - Store credit used on the order goes back to the customer's store credit balance; coupon cashback the order
 *    earned is taken back (the order no longer exists).
 *  - Never refunds twice: one worker claims the order atomically, Razorpay's own `amount_refunded` on the payment is
 *    checked before every refund (so a refund that went out but was not saved here is recognised, not repeated), and
 *    the store-credit movements carry unique idempotency keys.
 *  - A failure is recorded as `failed` and retried automatically with backoff (retryFailedRefunds, run by the
 *    server every 10 minutes); after MAX_AUTO_ATTEMPTS the team is emailed for manual action.
 *  - The refund is then recorded on the Shopify order, so Shopify shows it as refunded too.
 */

/** A claim still "processing" after this long was interrupted (crash / deploy) and may be taken again. */
const STALE_PROCESSING_MS = 10 * 60 * 1000;
/** Automatic attempts before the team is alerted (the dashboard Retry button keeps working after that). */
export const MAX_AUTO_ATTEMPTS = 5;
/** Only cancellations this recent are retried automatically; older ones are handled from the dashboard. */
const AUTO_RETRY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type RefundResult = { success: boolean; message?: string; error?: string; refundId?: string | null };

/** The part of the Razorpay SDK refunds need (tests pass a fake). */
export type RazorpayRefundClient = {
  payments: {
    fetch(paymentId: string): Promise<any>;
    refund(paymentId: string, params: Record<string, any>): Promise<any>;
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const appendNote = (note: string | null | undefined, line: string) => (note ? `${note}\n${line}` : line);

async function razorpayClient(): Promise<RazorpayRefundClient> {
  const creds = await resolveRazorpayCredentials();
  return new Razorpay({ key_id: creds.key_id, key_secret: creds.key_secret }) as unknown as RazorpayRefundClient;
}

/** WebStoreOrder mirror of an order (several historical link styles). */
async function findWebStoreOrder(order: any) {
  if (order.razorpayOrderId) {
    const w = await prisma.webStoreOrder.findFirst({ where: { razorpayOrderId: order.razorpayOrderId } });
    if (w) return w;
  }
  const byLocal = await prisma.webStoreOrder.findFirst({ where: { notes: { contains: `Local: ${order.id}` } } });
  if (byLocal) return byLocal;
  if (order.shopifyOrderId) {
    const w = await prisma.webStoreOrder.findFirst({ where: { notes: { contains: `Shopify: ${order.shopifyOrderId}` } } });
    if (w) return w;
  }
  if (order.internalOrderNumber || order.shopifyOrderName) {
    return prisma.webStoreOrder.findFirst({ where: { orderNumber: order.internalOrderNumber || order.shopifyOrderName } });
  }
  return null;
}

/**
 * Store credit actually taken from the customer's wallet for this order: the DEBIT ledger rows, matched by every
 * reference the checkouts have used (order id, "#<order number>" incl. numbers before a ZBCC renumber, Razorpay
 * order key). Capped by the amount the order says it used.
 */
async function storeCreditUsedOnOrder(order: any): Promise<number> {
  const numbers = [order.internalOrderNumber, ...String(order.previousOrderNumbers || '').split(',')]
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  const refs = [order.id, ...numbers.map((n) => `#${n}`), ...numbers];
  const keys = [`order:${order.id}`, ...(order.razorpayOrderId ? [`rzp:${order.razorpayOrderId}`] : [])];
  const debits = await prisma.storeCredit.findMany({
    where: {
      customerId: order.customerId,
      type: 'DEBIT',
      OR: [{ orderId: { in: refs } }, { idempotencyKey: { in: keys } }],
    },
    select: { amount: true },
  });
  const debited = round2(debits.reduce((s: number, d: { amount: number }) => s + Math.abs(Number(d.amount) || 0), 0));
  const declared = Number(order.storeCreditAmount) || 0;
  return declared > 0 ? Math.min(debited, declared) : debited;
}

/** Give the store credit used on a cancelled order back. Idempotent per order. Returns the amount restored now. */
async function restoreStoreCredit(order: any, amount: number): Promise<number> {
  if (!(amount > 0)) return 0;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);
  try {
    await prisma.$transaction(async (tx: any) => {
      // The unique key fails first on a repeat, so the balance is never incremented twice.
      await tx.storeCredit.create({
        data: {
          customerId: order.customerId,
          amount,
          type: 'CANCELLATION_REFUND',
          description: `Refund of store credit used on cancelled order ${order.internalOrderNumber || order.id}`,
          orderId: order.id,
          remainingAmount: amount,
          expiresAt,
          idempotencyKey: `cancel-refund:${order.id}`,
        },
      });
      await tx.customer.update({ where: { id: order.customerId }, data: { storeCredits: { increment: amount } } });
    });
    return amount;
  } catch (err: any) {
    if (err?.code === 'P2002') return 0; // already restored by an earlier run
    throw err;
  }
}

/** Take back the coupon cashback a cancelled order earned. Idempotent per order. */
async function reverseCashbackForCancelledOrder(order: any): Promise<number> {
  const pending = await prisma.storeCredit.findFirst({
    where: { orderId: order.id, type: 'PENDING_COUPON_REBATE', amount: { gt: 0 } },
  });
  if (pending) {
    await prisma.storeCredit.update({
      where: { id: pending.id },
      data: { amount: 0, remainingAmount: 0, description: `${pending.description} · voided (order cancelled)` },
    });
    return pending.amount;
  }
  const released = await prisma.storeCredit.findFirst({
    where: { orderId: order.id, type: 'COUPON_REBATE', amount: { gt: 0 } },
  });
  if (!released) return 0;
  const customer = await prisma.customer.findUnique({ where: { id: order.customerId }, select: { storeCredits: true } });
  const clawback = round2(Math.min(Number(released.amount) || 0, Number(customer?.storeCredits) || 0));
  if (!(clawback > 0)) return 0;
  const { debitStoreCredits } = await import('@/lib/storeCreditsHelper');
  const r = await debitStoreCredits(order.customerId, clawback, order.id, { idempotencyKey: `cancel-cashback:${order.id}` });
  return r.applied ? clawback : 0;
}

/** Best-effort: show the refund on the Shopify order. Never fails the refund itself. */
async function syncRefundToShopify(order: any, amount: number, label: string) {
  const shopifyId = String(order.shopifyOrderId || '');
  if (!/^\d+$/.test(shopifyId) || !(amount > 0)) return;
  try {
    const { recordShopifyOrderRefund } = await import('@/lib/shopify-admin');
    const done = await recordShopifyOrderRefund(shopifyId, amount, `Order cancelled — ${label}`);
    await prisma.syncLog.create({
      data: { orderId: order.id, action: 'SHOPIFY_REFUND_SYNC', status: 'SUCCESS', payload: JSON.stringify({ requested: amount, recorded: done }) },
    });
  } catch (err: any) {
    console.warn(`[AutoRefund] Shopify refund sync failed for ${order.id}:`, err?.message || err);
    await prisma.syncLog
      .create({ data: { orderId: order.id, action: 'SHOPIFY_REFUND_SYNC', status: 'FAILED', error: String(err?.message || err).slice(0, 500) } })
      .catch(() => {});
  }
}

export async function processOrderRefund(
  orderId: string,
  triggeredBy = 'system',
  deps: { razorpay?: RazorpayRefundClient } = {}
): Promise<RefundResult> {
  const logId = `sl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const order: any = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: true } });
  if (!order) return { success: false, error: 'Order not found' };
  if (String(order.status || '').toLowerCase() !== 'cancelled') return { success: false, error: 'Order is not cancelled' };
  if (order.refundStatus === 'completed') return { success: true, message: 'Already refunded' };

  // Automatic refunds start from go-live: an order cancelled before then is never refunded by a background job, a
  // webhook or a bulk sync (an admin pressing "Retry refund" passes their email and is not limited).
  const manual = triggeredBy.includes('@') || triggeredBy === 'manual';
  if (!manual) {
    const { getGoLive } = await import('@/lib/go-live');
    const goLive = await getGoLive();
    const cancelledOn = new Date(order.cancelledAt || order.createdAt);
    if (cancelledOn < goLive) {
      return { success: true, message: 'Cancelled before automatic refunds started; refund it manually if it is due' };
    }
  }

  // Atomic claim: only one worker continues. A "processing" claim older than 10 minutes was interrupted.
  // (This used to filter `refundStatus: null` on a non-null column, which Prisma rejects, and it excluded the
  // column's default "not_applicable", so no cancelled order was ever refunded automatically.)
  const claimed = await prisma.order.updateMany({
    where: {
      id: order.id,
      OR: [
        { refundStatus: { notIn: ['processing', 'completed'] } },
        { refundStatus: 'processing', updatedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
      ],
    },
    data: { refundStatus: 'processing', refundAttempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { success: true, message: 'Refund already in progress' };

  try {
    const webStoreOrder: any = await findWebStoreOrder(order);
    const isCod =
      order.paymentMethod?.toUpperCase() === 'COD' ||
      order.paymentMethod?.toLowerCase().includes('cash') ||
      webStoreOrder?.paymentMethod?.toUpperCase() === 'COD' ||
      webStoreOrder?.paymentMethod?.toLowerCase().includes('cash') ||
      order.tags?.split(',').map((t: string) => t.trim().toUpperCase()).includes('COD') ||
      order.note?.toLowerCase().includes('cod order');

    const paymentId: string | null = isCod
      ? order.codUpfrontPaymentId || webStoreOrder?.codUpfrontPaymentId || order.razorpayPaymentId || null
      : order.razorpayPaymentId || null;

    // ── What was paid through Razorpay ──
    let gatewayAmount = 0;
    if (paymentId) {
      if (isCod) {
        const { resolveStoredCodUpfrontPaid, DEFAULT_COD_UPFRONT_AMOUNT } = await import('@/lib/cod-upfront');
        gatewayAmount = resolveStoredCodUpfrontPaid({
          storedPaid: Number(order.codUpfrontPaid) || Number(webStoreOrder?.codUpfrontPaid) || 0,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          tags: order.tags,
          note: order.note,
          paymentId,
          configuredFallback: DEFAULT_COD_UPFRONT_AMOUNT,
        });
      } else {
        gatewayAmount = Number(order.totalPrice) || 0;
      }
      // The full amount paid. What was already refunded is read from Razorpay itself below, so earlier refunds
      // (ours, or made in the Razorpay dashboard) are never counted twice or repeated.
      gatewayAmount = round2(Math.max(0, gatewayAmount));
    }

    // ── What was paid with store credit ──
    const creditAmount = await storeCreditUsedOnOrder(order);

    // ── Razorpay ──
    let razorpayRefundId: string | null = null;
    let gatewayRefunded = 0;
    let gatewayNote = '';
    if (paymentId && gatewayAmount > 0) {
      const isMock =
        paymentId.startsWith('pay_mock_') ||
        String(order.razorpayOrderId || '').startsWith('order_mock_') ||
        String(webStoreOrder?.razorpayOrderId || '').startsWith('order_mock_');
      if (isMock) {
        gatewayRefunded = gatewayAmount;
        razorpayRefundId = `rfnd_mock_${order.id}`;
        gatewayNote = `Mock refund of ₹${gatewayAmount} processed.`;
      } else {
        const rzp = deps.razorpay || (await razorpayClient());
        const payment = await rzp.payments.fetch(paymentId);
        const currency = payment?.currency || order.currency || 'INR';
        const capturedMinor = Number(payment?.amount) || 0;
        const targetMinor = Math.min(toMinorUnits(gatewayAmount, currency), capturedMinor);
        const alreadyMinor = Number(payment?.amount_refunded) || 0;
        const status = String(payment?.status || '');

        if (status !== 'captured' && status !== 'refunded') {
          // Authorised-only or failed payment: nothing was captured, Razorpay releases it by itself.
          gatewayNote = `Razorpay payment ${paymentId} is "${status}" (never captured); nothing to refund.`;
        } else if (alreadyMinor >= targetMinor) {
          // Refunded already (an earlier run whose result was not saved, or a refund made in the Razorpay dashboard).
          gatewayRefunded = round2(alreadyMinor / 100);
          gatewayNote = `Razorpay already shows ₹${gatewayRefunded} refunded on ${paymentId}; no new refund issued.`;
        } else {
          const amountMinor = targetMinor - alreadyMinor;
          const refund = await rzp.payments.refund(paymentId, {
            amount: amountMinor,
            notes: { orderId: order.id, shopifyOrderId: order.shopifyOrderId || '', reason: 'Order cancelled', triggeredBy },
          });
          razorpayRefundId = refund?.id || null;
          gatewayRefunded = round2(amountMinor / 100);
          gatewayNote = `Auto-refund of ₹${gatewayRefunded} processed via Razorpay (Refund ID: ${razorpayRefundId}).`;
          console.log(`[AutoRefund] Razorpay refund ${razorpayRefundId} for order ${order.id}: ₹${gatewayRefunded}`);
        }
      }
    }

    // ── Store credit back to the wallet, cashback taken back ──
    const creditRestored = await restoreStoreCredit(order, creditAmount);
    let cashbackReversed = 0;
    try {
      cashbackReversed = await reverseCashbackForCancelledOrder(order);
    } catch (cbErr: any) {
      console.warn(`[AutoRefund] Cashback reversal for ${order.id} failed:`, cbErr?.message);
    }

    const refundedSomething = gatewayRefunded > 0 || creditAmount > 0;
    if (!refundedSomething) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          refundStatus: 'not_applicable',
          refundError: null,
          note: appendNote(order.note, `[Refund] Nothing to refund${gatewayNote ? `: ${gatewayNote}` : ' (no payment was captured).'}`),
        },
      });
      return { success: true, message: gatewayNote || 'Nothing was paid; no refund needed' };
    }

    let zbRefundId: string | null = order.refundId || null;
    if (!zbRefundId) {
      try {
        zbRefundId = await assignRefundId(prisma);
      } catch (rfErr) {
        console.error('[AutoRefund] Failed to generate refundId:', rfErr);
      }
    }

    const lines = [
      gatewayNote,
      creditAmount > 0 ? `₹${creditAmount} store credit returned to the customer's balance${creditRestored ? '' : ' (already returned earlier)'}.` : '',
      cashbackReversed > 0 ? `₹${cashbackReversed} coupon cashback earned on this order taken back.` : '',
    ].filter(Boolean);

    await prisma.$transaction([
      ...(razorpayRefundId
        ? [prisma.payment.create({ data: { orderId: order.id, customerId: order.customerId, amount: gatewayRefunded, type: 'refund', status: 'completed', gateway: 'razorpay' } })]
        : []),
      ...(creditRestored > 0
        ? [prisma.payment.create({ data: { orderId: order.id, customerId: order.customerId, amount: creditRestored, type: 'refund', status: 'completed', gateway: 'store_credit' } })]
        : []),
      prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'refunded',
          refundStatus: 'completed',
          refundError: null,
          ...(zbRefundId && !order.refundId ? { refundId: zbRefundId } : {}),
          note: appendNote(order.note, `[Refund] ${lines.join(' ')}${zbRefundId ? ` (${zbRefundId})` : ''}`),
        },
      }),
      prisma.syncLog.create({
        data: {
          id: logId,
          orderId: order.id,
          action: 'RAZORPAY_REFUND',
          status: 'SUCCESS',
          payload: JSON.stringify({ triggeredBy, paymentId, razorpayRefundId, gatewayRefunded, creditAmount, creditRestored, cashbackReversed, zbRefundId }),
        },
      }),
    ]);

    if (webStoreOrder) {
      await prisma.webStoreOrder
        .update({
          where: { id: webStoreOrder.id },
          data: { paymentStatus: 'refunded', notes: appendNote(webStoreOrder.notes, `[Refund] ${lines.join(' ')}`) },
        })
        .catch((e: any) => console.warn('[AutoRefund] WebStoreOrder update failed:', e?.message));
    }

    try {
      const { reverseReferral } = await import('@/lib/affiliate/earnings');
      await reverseReferral(order.id, 'refund_processed');
    } catch (affErr: any) {
      console.warn('[AutoRefund] Affiliate reversal warning:', affErr?.message);
    }

    await syncRefundToShopify(order, round2(gatewayRefunded + creditAmount), lines.join(' '));

    return { success: true, refundId: razorpayRefundId || zbRefundId };
  } catch (err: any) {
    const errorMessage = err?.error?.description || err?.message || 'Unknown error';
    console.warn(`[AutoRefund] Refund failed for ${orderId}: ${errorMessage}`);
    try {
      const current = await prisma.order.findUnique({ where: { id: orderId }, select: { note: true, refundAttempts: true, internalOrderNumber: true } });
      await prisma.$transaction([
        prisma.order.update({
          where: { id: orderId },
          data: {
            refundStatus: 'failed',
            refundError: errorMessage,
            note: appendNote(current?.note, `[Refund Failed] Attempt ${current?.refundAttempts ?? '?'}: ${errorMessage}`),
          },
        }),
        prisma.syncLog.create({
          data: { id: logId, orderId, action: 'RAZORPAY_REFUND', status: 'FAILED', error: errorMessage, payload: JSON.stringify({ triggeredBy, error: String(err) }) },
        }),
      ]);
      if ((current?.refundAttempts ?? 0) === MAX_AUTO_ATTEMPTS) {
        await alertRefundNeedsAttention(current?.internalOrderNumber || orderId, errorMessage);
      }
    } catch (dbErr) {
      console.error('[AutoRefund] Failed to record the refund failure:', dbErr);
    }
    return { success: false, error: errorMessage };
  }
}

async function alertRefundNeedsAttention(orderRef: string, error: string) {
  try {
    const { notifyAdminTeam } = await import('@/lib/services/zohoMailService');
    await notifyAdminTeam(
      `⚠️ Refund for ${orderRef} still failing after ${MAX_AUTO_ATTEMPTS} attempts`,
      `<div style="font-family:sans-serif;padding:20px;"><p>The automatic refund for cancelled order <b>${orderRef}</b> failed ${MAX_AUTO_ATTEMPTS} times and is no longer retried automatically.</p><p>Last error: <code>${String(error).replace(/</g, '&lt;').slice(0, 500)}</code></p><p>Open the order in the dashboard and use <b>Retry refund</b> once the cause is fixed.</p></div>`
    );
  } catch (err: any) {
    console.warn('[AutoRefund] Admin alert failed:', err?.message || err);
  }
}

/**
 * Retry failed / interrupted refunds of recent cancellations. Backoff: attempt n waits n × 15 minutes after the
 * previous one. Run every 10 minutes by the server (lib/background-jobs.ts) and by /api/cron/retry-refunds.
 */
export async function retryFailedRefunds(opts: { limit?: number; razorpay?: RazorpayRefundClient } = {}) {
  const now = Date.now();
  const { getGoLive } = await import('@/lib/go-live');
  const goLive = await getGoLive();
  const candidates = await prisma.order.findMany({
    where: {
      status: { in: ['cancelled', 'CANCELLED'] },
      // Only cancellations made after go-live; nothing from before is ever retried automatically.
      cancelledAt: { gte: goLive },
      refundAttempts: { lt: MAX_AUTO_ATTEMPTS },
      OR: [
        { refundStatus: 'failed' },
        { refundStatus: 'processing', updatedAt: { lt: new Date(now - STALE_PROCESSING_MS) } },
      ],
      AND: [{ OR: [{ cancelledAt: { gte: new Date(now - AUTO_RETRY_WINDOW_MS) } }, { cancelledAt: null, updatedAt: { gte: new Date(now - AUTO_RETRY_WINDOW_MS) } }] }],
    },
    select: { id: true, internalOrderNumber: true, refundAttempts: true, updatedAt: true },
    orderBy: { updatedAt: 'asc' },
    take: opts.limit ?? 20,
  });

  const results: Array<{ orderId: string; orderNumber: string | null; success: boolean; error: string | null }> = [];
  for (const o of candidates) {
    const waitMs = Math.max(1, o.refundAttempts) * 15 * 60 * 1000;
    if (now - new Date(o.updatedAt).getTime() < waitMs) continue;
    const res = await processOrderRefund(o.id, 'auto-retry', { razorpay: opts.razorpay });
    results.push({ orderId: o.id, orderNumber: o.internalOrderNumber, success: res.success, error: res.error || null });
  }
  return { processed: results.length, results };
}

export async function triggerAutoRefund(orderId: string, triggeredBy = 'system') {
  return processOrderRefund(orderId, triggeredBy);
}
