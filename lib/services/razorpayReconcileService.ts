/**
 * Payment-driven Razorpay reconciliation (GET /api/cron/reconcile-razorpay, every 15 min).
 *
 * Why a second job next to sync-pending-orders: that cron starts from LOCAL
 * pending rows (and until now only the newest 50) and asks Razorpay about each.
 * On 2 Nov a customer paid ₹17,878 (pay_TvHpd9l4Vbz104) at 16:44 IST; the
 * browser never finished /api/checkout/complete, the Razorpay webhook had been
 * disabled since 30 Oct, and the GitHub-scheduled cron fires every 4–6 h in
 * practice — the order sat pending for 4.5 h until an admin opened it. This job
 * starts from RAZORPAY's side instead: every payment captured in the last
 * 3 hours is matched to a local order and, if that order is still unconfirmed,
 * pushed through the existing marking path (reconcilePendingMainOrders /
 * syncPendingWebStoreOrders — nothing is marked paid here directly, and those
 * functions re-verify the capture at Razorpay themselves). Captures with no
 * local order become placeholder orders (recoverOrphanedRazorpayOrder), paid
 * orders whose captured amount differs from the order are reported, orders this
 * job confirms get the customer confirmation email /complete would have sent,
 * and verified-but-unwritten /complete requests (checkout.complete.retry rows)
 * are finished. One admin email per run lists everything it did; a silent
 * webhook is called out in it.
 */
import prisma from '@/lib/db';
import { createRazorpayClient, type RazorpayClientLike } from '@/lib/razorpay-client';
import { isCapturedPaymentEntity, paymentAmountRupees } from '@/lib/razorpay-payment';
import { isPaidLikeStatus, isUnconfirmedStatus } from '@/lib/payment-status';
import { getConfiguredCodUpfrontAmount, DEFAULT_COD_UPFRONT_AMOUNT } from '@/lib/cod-upfront';
import { syncPendingWebStoreOrders, reconcilePendingMainOrders } from '@/lib/services/razorpaySyncService';
import { recoverOrphanedRazorpayOrder } from '@/lib/services/razorpayRecoveryService';
import { sendConfirmationForReconciledOrder } from '@/lib/services/orderConfirmationNotice';
import {
  listPendingCheckoutCompleteRetries,
  markWebhookEventProcessed,
  newestProcessedRazorpayWebhookAt,
} from '@/lib/razorpay-webhook-events';
import { notifyAdminTeam } from '@/lib/services/zohoMailService';
import { paymentLog } from '@/lib/payment-logger';

/** Captures younger than this are checked on every run (12 runs of overlap per payment). */
export const RECONCILE_WINDOW_MS = 3 * 60 * 60 * 1000;
/** No processed Razorpay delivery for this long while captures keep arriving = webhook is dead. */
export const WEBHOOK_SILENCE_ALERT_MS = 2 * 60 * 60 * 1000;
/** The dead-webhook warning alone (nothing else to report) is emailed at most this often. */
const WEBHOOK_SILENCE_REMINDER_MS = 6 * 60 * 60 * 1000;
/** The shopper's browser gets this long to finish its own /complete retries first. */
export const CHECKOUT_RETRY_MIN_AGE_MS = 60_000;
/** A retry row whose payment is still not captured after this long is closed (nothing to finish). */
const CHECKOUT_RETRY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Razorpay's list endpoint pages at most 100 items; 20 pages = 2,000 payments in 3 h. */
const RAZORPAY_PAGE_SIZE = 100;
const RAZORPAY_MAX_PAGES = 20;
export const RECONCILE_SYNC_LOG_ACTION = 'CRON_PING_RAZORPAY_RECONCILE';
const SOURCE = 'cron/reconcile-razorpay';

export type ReconcileLineKind = 'recovered' | 'orphan_recovered' | 'mismatch' | 'unresolved';

export type ReconcileLine = {
  kind: ReconcileLineKind;
  paymentId: string;
  razorpayOrderId: string | null;
  amountRupees: number;
  orderNumber: string | null;
  action: string;
};

export type ReconcileRunResult = {
  ok: boolean;
  skipped?: 'no_credentials';
  window: { from: string; to: string };
  capturedSeen: number;
  retryRowsSeen: number;
  recovered: number;
  orphanRecovered: number;
  mismatched: number;
  unresolved: number;
  /** Customer confirmation emails sent by this run. */
  confirmationEmails: number;
  lines: ReconcileLine[];
  webhookDead: boolean;
  /** ISO time of the newest processed Razorpay delivery (null = none recorded). */
  webhookLastDeliveryAt: string | null;
  adminEmailed: boolean;
  adminEmailHtml: string | null;
  errors: string[];
};

type WorkItem = { payment: any; retryRowId?: string };

async function listCapturedPayments(
  razorpay: RazorpayClientLike,
  fromSec: number,
  toSec: number,
  errors: string[]
): Promise<any[]> {
  const captured: any[] = [];
  for (let page = 0; page < RAZORPAY_MAX_PAGES; page++) {
    let res: any;
    try {
      res = await razorpay.payments.all({ from: fromSec, to: toSec, count: RAZORPAY_PAGE_SIZE, skip: page * RAZORPAY_PAGE_SIZE });
    } catch (err: any) {
      errors.push(`Razorpay payments.all failed on page ${page + 1}: ${err?.message || err}`);
      break;
    }
    const items: any[] = Array.isArray(res?.items) ? res.items : [];
    for (const p of items) if (p?.status === 'captured') captured.push(p);
    if (items.length < RAZORPAY_PAGE_SIZE) break;
  }
  return captured;
}

function istTime(d: Date): string {
  return `${d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST`;
}

export function webhookSilenceLine(lastDeliveryAt: Date | null): string {
  const since = lastDeliveryAt ? istTime(lastDeliveryAt) : 'ever (no processed delivery on record)';
  return `Razorpay webhook has not delivered since ${since} — check Settings → Webhooks (it was found Disabled on 2 Nov)`;
}

const KIND_LABEL: Record<ReconcileLineKind, string> = {
  recovered: 'Recovered (marked paid)',
  orphan_recovered: 'Orphan payment → placeholder order',
  mismatch: 'Amount mismatch (not modified)',
  unresolved: 'Needs a human',
};

export function reconcileReportHtml(result: ReconcileRunResult, now: number): string {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  const rows = result.lines
    .map(
      (l) => `<tr>
        <td style="padding:4px 8px;white-space:nowrap;">${KIND_LABEL[l.kind]}</td>
        <td style="padding:4px 8px;font-family:monospace;">${esc(l.paymentId)}</td>
        <td style="padding:4px 8px;font-family:monospace;">${esc(l.razorpayOrderId || 'n/a')}</td>
        <td style="padding:4px 8px;text-align:right;">₹${Number(l.amountRupees || 0).toLocaleString('en-IN')}</td>
        <td style="padding:4px 8px;">${esc(l.orderNumber || '—')}</td>
        <td style="padding:4px 8px;">${esc(l.action)}</td>
      </tr>`
    )
    .join('');
  const webhookBlock = result.webhookDead
    ? `<p style="color:#b91c1c;font-weight:bold;">${esc(webhookSilenceLine(result.webhookLastDeliveryAt ? new Date(result.webhookLastDeliveryAt) : null))}</p>`
    : '';
  const errorBlock = result.errors.length
    ? `<p style="color:#92400e;">Errors during this run:</p><ul>${result.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '';
  return `<div style="font-family: sans-serif; padding: 20px;">
    <h2 style="margin-top:0;">Razorpay reconciliation — ${istTime(new Date(now))}</h2>
    <p>Captured payments in the last ${Math.round(RECONCILE_WINDOW_MS / 3600000)} h: <b>${result.capturedSeen}</b>; retry rows: <b>${result.retryRowsSeen}</b>; recovered: <b>${result.recovered}</b>; orphan recovered: <b>${result.orphanRecovered}</b>; mismatched: <b>${result.mismatched}</b>; unresolved: <b>${result.unresolved}</b>; confirmation emails sent: <b>${result.confirmationEmails}</b>.</p>
    ${webhookBlock}
    ${rows ? `<table style="border-collapse:collapse;font-size:13px;"><thead><tr>
      <th style="text-align:left;padding:4px 8px;">What</th><th style="text-align:left;padding:4px 8px;">Payment</th><th style="text-align:left;padding:4px 8px;">Razorpay order</th><th style="text-align:right;padding:4px 8px;">Amount</th><th style="text-align:left;padding:4px 8px;">Local order</th><th style="text-align:left;padding:4px 8px;">What was done</th>
    </tr></thead><tbody>${rows}</tbody></table>` : '<p>No order needed attention.</p>'}
    ${errorBlock}
    <p style="color:#666;font-size:12px;">Source: ${SOURCE}. Open Admin → Transactions for the full Matched / Mismatched / Orphaned view.</p>
  </div>`;
}

/** True unless the dead-webhook warning was already emailed on its own within the reminder window. */
async function webhookSilenceReminderDue(now: number): Promise<boolean> {
  try {
    const recent = await prisma.syncLog.findFirst({
      where: {
        action: RECONCILE_SYNC_LOG_ACTION,
        payload: { contains: '"webhookDeadEmailed":true' },
        createdAt: { gte: new Date(now - WEBHOOK_SILENCE_REMINDER_MS) },
      },
      select: { id: true },
    });
    return !recent;
  } catch {
    return true;
  }
}

export async function reconcileRazorpayPayments(
  opts: { razorpay?: RazorpayClientLike; now?: number; windowMs?: number } = {}
): Promise<ReconcileRunResult> {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? RECONCILE_WINDOW_MS;
  const result: ReconcileRunResult = {
    ok: true,
    window: { from: new Date(now - windowMs).toISOString(), to: new Date(now).toISOString() },
    capturedSeen: 0,
    retryRowsSeen: 0,
    recovered: 0,
    orphanRecovered: 0,
    mismatched: 0,
    unresolved: 0,
    confirmationEmails: 0,
    lines: [],
    webhookDead: false,
    webhookLastDeliveryAt: null,
    adminEmailed: false,
    adminEmailHtml: null,
    errors: [],
  };
  const line = (l: ReconcileLine) => {
    result.lines.push(l);
    if (l.kind === 'recovered') result.recovered++;
    else if (l.kind === 'orphan_recovered') result.orphanRecovered++;
    else if (l.kind === 'mismatch') result.mismatched++;
    else result.unresolved++;
  };

  const razorpay = opts.razorpay || (await createRazorpayClient());
  if (!razorpay) {
    result.skipped = 'no_credentials';
    console.warn('[RazorpayReconcile] Razorpay credentials not configured, skipping run.');
    await writeSyncLog(result, false);
    return result;
  }

  // 1. Razorpay's side: every payment captured in the window.
  const captured = await listCapturedPayments(razorpay, Math.floor((now - windowMs) / 1000), Math.ceil(now / 1000), result.errors);
  result.capturedSeen = captured.length;
  const work = new Map<string, WorkItem>();
  for (const p of captured) if (p?.id && !work.has(p.id)) work.set(p.id, { payment: p });

  // 2. Verified-but-unwritten /complete requests. Their payment may be older than
  //    the window, so it is fetched live; only a CAPTURED payment is acted on.
  let retries: Awaited<ReturnType<typeof listPendingCheckoutCompleteRetries>> = [];
  try {
    retries = await listPendingCheckoutCompleteRetries(CHECKOUT_RETRY_MIN_AGE_MS, now);
  } catch (err: any) {
    result.errors.push(`Could not list checkout.complete.retry rows: ${err?.message || err}`);
  }
  result.retryRowsSeen = retries.length;
  for (const retry of retries) {
    try {
      if (!retry.razorpayPaymentId) {
        await markWebhookEventProcessed(retry.id); // nothing to act on
        continue;
      }
      let payment = work.get(retry.razorpayPaymentId)?.payment;
      if (!payment) payment = await razorpay.payments.fetch(retry.razorpayPaymentId);
      if (!isCapturedPaymentEntity(payment)) {
        if (now - new Date(retry.createdAt).getTime() > CHECKOUT_RETRY_MAX_AGE_MS) await markWebhookEventProcessed(retry.id);
        continue;
      }
      work.set(payment.id, { payment, retryRowId: retry.id });
    } catch (err: any) {
      result.errors.push(`Retry row ${retry.id} (${retry.razorpayPaymentId}): ${err?.message || err}`);
    }
  }

  // 3. Local side, one query each (as app/api/admin/transactions does).
  const paymentIds = [...work.keys()];
  const razorpayOrderIds = [...work.values()]
    .map((w) => w.payment.order_id || w.payment.notes?.order_id || w.payment.notes?.razorpay_order_id || null)
    .filter((id): id is string => Boolean(id));
  const localOrders: any[] = paymentIds.length
    ? await prisma.order.findMany({
        where: { OR: [{ razorpayOrderId: { in: razorpayOrderIds } }, { razorpayPaymentId: { in: paymentIds } }] },
      })
    : [];
  const byRzpOrder = new Map<string, any>();
  const byPaymentId = new Map<string, any>();
  for (const o of localOrders) {
    if (o.razorpayOrderId) byRzpOrder.set(o.razorpayOrderId, o);
    if (o.razorpayPaymentId) byPaymentId.set(o.razorpayPaymentId, o);
  }
  const webStoreRows: any[] = razorpayOrderIds.length
    ? await prisma.webStoreOrder.findMany({ where: { razorpayOrderId: { in: razorpayOrderIds } } })
    : [];
  const wsByRzpOrder = new Map<string, any>();
  for (const w of webStoreRows) if (w.razorpayOrderId) wsByRzpOrder.set(w.razorpayOrderId, w);
  const codUpfront = await getConfiguredCodUpfrontAmount().catch(() => DEFAULT_COD_UPFRONT_AMOUNT);

  // 4. One decision per captured payment.
  for (const { payment, retryRowId } of work.values()) {
    const paymentId: string = payment.id;
    const rzpOrderId: string | null = payment.order_id || payment.notes?.order_id || payment.notes?.razorpay_order_id || null;
    const amount = paymentAmountRupees(payment);
    const base = { paymentId, razorpayOrderId: rzpOrderId, amountRupees: amount };
    try {
      const local = (rzpOrderId && byRzpOrder.get(rzpOrderId)) || byPaymentId.get(paymentId) || null;

      if (!local) {
        if (!rzpOrderId) {
          line({ ...base, kind: 'unresolved', orderNumber: null, action: 'captured payment carries no Razorpay order id; resolve in Admin → Transactions' });
          continue;
        }
        const recovery = await recoverOrphanedRazorpayOrder({ razorpayOrderId: rzpOrderId, razorpayPaymentId: paymentId, triggerSource: 'reconciliation', razorpay });
        if (recovery.success) {
          line({ ...base, kind: 'orphan_recovered', orderNumber: recovery.internalOrderNumber || null, action: 'no local order; placeholder order created and held for review (customer not emailed)' });
          if (retryRowId) await markWebhookEventProcessed(retryRowId, recovery.orderId);
        } else {
          line({ ...base, kind: 'unresolved', orderNumber: null, action: `no local order and placeholder recovery failed: ${recovery.error || 'unknown error'}` });
        }
        continue;
      }

      const isCod = (local.paymentMethod || '').toLowerCase().trim() === 'cod' || (local.tags || '').toLowerCase().includes('cod');
      const expected = isCod ? codUpfront : Number(local.totalPrice) || 0;

      if (isUnconfirmedStatus(local.paymentStatus)) {
        const before = local.paymentStatus;
        // The existing marking path: it re-checks the capture at Razorpay, promotes
        // ZBPP → ZB, mirrors the WebStoreOrder, writes the Payment row, syncs Shopify
        // and emits the ad Purchase events — exactly what the cron / admin view does.
        await reconcilePendingMainOrders({ orderIds: [local.id], razorpay, skipConfirmationEmail: true }); // this run sends the email below
        let fresh = await prisma.order.findUnique({ where: { id: local.id } });
        const ws = rzpOrderId ? wsByRzpOrder.get(rzpOrderId) : null;
        if (fresh && !isPaidLikeStatus(fresh.paymentStatus) && amount + 1 >= expected && ws) {
          // Main-order path declined (e.g. a lookup hiccup); the WebStoreOrder path is
          // the one the admin page view uses and also updates the matching Order.
          await syncPendingWebStoreOrders([ws.id], { razorpay });
          fresh = await prisma.order.findUnique({ where: { id: local.id } });
        }
        if (fresh && isPaidLikeStatus(fresh.paymentStatus)) {
          if (ws) {
            // Keep the mirror row in step when only the Order was flipped.
            const wsNow = await prisma.webStoreOrder.findUnique({ where: { id: ws.id } }).catch(() => null);
            if (wsNow && !isPaidLikeStatus(wsNow.paymentStatus)) await syncPendingWebStoreOrders([ws.id], { razorpay });
          }
          const notice = await sendConfirmationForReconciledOrder(local.id, SOURCE);
          if (notice.status === 'sent') result.confirmationEmails++;
          const emailNote =
            notice.status === 'sent' ? `confirmation emailed to ${notice.email}`
            : notice.status === 'skipped' ? `confirmation email skipped (${notice.reason})`
            : `confirmation email failed (${notice.error})`;
          line({ ...base, kind: 'recovered', orderNumber: fresh.internalOrderNumber || fresh.id, action: `${before} → ${fresh.paymentStatus}; ${emailNote}` });
          if (retryRowId) await markWebhookEventProcessed(retryRowId, local.id);
          paymentLog('info', 'reconcile', { message: `Order ${fresh.internalOrderNumber || fresh.id} marked ${fresh.paymentStatus} from Razorpay capture`, orderId: local.id, paymentId });
        } else if (amount + 1 < expected) {
          line({ ...base, kind: 'mismatch', orderNumber: local.internalOrderNumber || local.id, action: `captured ₹${amount} is below the ${isCod ? 'COD upfront fee' : 'order total'} ₹${expected}; left ${fresh?.paymentStatus || before} for review` });
        } else {
          line({ ...base, kind: 'unresolved', orderNumber: local.internalOrderNumber || local.id, action: `still ${fresh?.paymentStatus || before} after the marking path ran; check the Razorpay lookup for this order` });
        }
        continue;
      }

      if (isPaidLikeStatus(local.paymentStatus)) {
        // /complete (or a webhook) did land after all: the retry row is finished.
        if (retryRowId) await markWebhookEventProcessed(retryRowId, local.id);
        if (Number(payment.amount_refunded || 0) > 0) continue;
        // COD: the upfront fee is the expected capture, never the order total.
        if (isCod && Math.abs(amount - codUpfront) <= 1) continue;
        if (local.razorpayPaymentId && local.razorpayPaymentId !== paymentId) {
          line({ ...base, kind: 'mismatch', orderNumber: local.internalOrderNumber || local.id, action: `order already paid by ${local.razorpayPaymentId}; this is a second capture on the same Razorpay order (refund candidate)` });
          continue;
        }
        if (Math.abs(amount - expected) > 1) {
          line({ ...base, kind: 'mismatch', orderNumber: local.internalOrderNumber || local.id, action: `captured ₹${amount} vs ${isCod ? 'COD upfront fee' : 'order total'} ₹${expected}; order left as ${local.paymentStatus}` });
        }
        continue;
      }

      // refunded / partial_refund / anything else: nothing to reconcile.
      if (retryRowId) await markWebhookEventProcessed(retryRowId, local.id);
    } catch (err: any) {
      result.errors.push(`${paymentId}: ${err?.message || err}`);
    }
  }

  // 5. Dead-webhook detection: captures keep arriving but no delivery was processed.
  try {
    const newest = await newestProcessedRazorpayWebhookAt();
    result.webhookLastDeliveryAt = newest ? newest.toISOString() : null;
    if (result.capturedSeen >= 1 && (!newest || now - newest.getTime() > WEBHOOK_SILENCE_ALERT_MS)) result.webhookDead = true;
  } catch (err: any) {
    result.errors.push(`Webhook freshness check failed: ${err?.message || err}`);
  }

  // 6. One admin email per run, only when there is something to say. The webhook
  //    line rides along with other findings; on its own it is repeated no more
  //    than every WEBHOOK_SILENCE_REMINDER_MS so 96 runs a day do not become 96 mails.
  const hasFindings = result.lines.length > 0;
  let webhookDeadEmailed = false;
  if (hasFindings || (result.webhookDead && (await webhookSilenceReminderDue(now)))) {
    const html = reconcileReportHtml(result, now);
    const parts = [
      result.recovered ? `${result.recovered} recovered` : '',
      result.orphanRecovered ? `${result.orphanRecovered} orphan` : '',
      result.mismatched ? `${result.mismatched} mismatched` : '',
      result.unresolved ? `${result.unresolved} unresolved` : '',
      result.webhookDead ? 'webhook silent' : '',
    ].filter(Boolean);
    const subject = `Razorpay reconciliation: ${parts.join(', ') || 'report'}`;
    try {
      await notifyAdminTeam(subject, html);
      result.adminEmailed = true;
      result.adminEmailHtml = html;
      webhookDeadEmailed = result.webhookDead;
    } catch (err: any) {
      result.errors.push(`Admin email failed: ${err?.message || err}`);
    }
  }

  result.ok = result.errors.length === 0;
  await writeSyncLog(result, webhookDeadEmailed);
  return result;
}

async function writeSyncLog(result: ReconcileRunResult, webhookDeadEmailed: boolean): Promise<void> {
  try {
    await prisma.syncLog.create({
      data: {
        orderId: 'system',
        action: RECONCILE_SYNC_LOG_ACTION,
        status: result.skipped ? 'SKIPPED' : result.ok ? 'SUCCESS' : 'PARTIAL',
        error: result.errors.length ? result.errors.join(' | ').slice(0, 2000) : null,
        payload: JSON.stringify({
          capturedSeen: result.capturedSeen,
          retryRowsSeen: result.retryRowsSeen,
          recovered: result.recovered,
          orphanRecovered: result.orphanRecovered,
          mismatched: result.mismatched,
          unresolved: result.unresolved,
          confirmationEmails: result.confirmationEmails,
          adminEmailed: result.adminEmailed,
          webhookDead: result.webhookDead,
          webhookDeadEmailed,
          errors: result.errors.length,
        }),
      },
    });
  } catch (logErr) {
    console.error('[RazorpayReconcile] Failed to log cron ping:', logErr);
  }
}
