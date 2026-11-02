import prisma from "@/lib/db";
import { createRazorpayClient, type RazorpayClientLike } from "@/lib/razorpay-client";
import { nextOrderStatusOnCapture } from "@/lib/razorpay-webhook-events";
import { PAID_LIKE_STATUSES } from "@/lib/payment-status";

/** Pending web orders older than this with no capture / authorization at Razorpay are closed as timed out. */
export const PENDING_ORDER_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/** Rows older than this are left alone by the scans (a 7-day-old checkout is not coming back). */
const RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SCAN_BATCH_SIZE = 50;
/**
 * A scan used to look at the newest 50 pending rows only, so on a busy day an
 * order outside that window was never reconciled (2 Nov: ZBPP82722 sat pending
 * for 4.5 h). Scans now walk every PENDING row younger than RECOVERY_WINDOW_MS,
 * oldest first, in batches of SCAN_BATCH_SIZE — a set the timeouts keep small
 * (rows leave it as paid or failed) — and stop at this soft budget so a backlog
 * cannot run past the scheduler's curl timeout; the next run continues where the
 * set shrank. Two scans run back to back in /api/cron/sync-pending-orders, so the
 * pair stays within the ~60 s the old 2 × 50-row scans could take.
 */
const DEFAULT_SCAN_BUDGET_MS = 25_000;

export type SyncScanOptions = {
  /** Reuse a client (the reconcile job's, or a fake in the regression scripts). */
  razorpay?: RazorpayClientLike;
  budgetMs?: number;
};

/**
 * Every row matching `where` and younger than the recovery window, oldest first,
 * fetched in batches of SCAN_BATCH_SIZE (ids first, then rows by id, so rows that
 * change status while the scan runs are neither skipped nor double-counted).
 */
async function listRowsOldestFirst(
  model: { findMany: (args: any) => Promise<any[]> },
  where: Record<string, unknown>,
  since: Date,
  until?: Date
): Promise<any[]> {
  const ids = await model.findMany({
    where: { ...where, createdAt: { gte: since, ...(until ? { lte: until } : {}) } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += SCAN_BATCH_SIZE) {
    const chunk = ids.slice(i, i + SCAN_BATCH_SIZE).map((r: { id: string }) => r.id);
    const batch = await model.findMany({ where: { id: { in: chunk } } });
    batch.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    rows.push(...batch);
  }
  return rows;
}

export interface SyncedOrderInfo {
  id: string;
  orderNumber: string;
  oldStatus: string;
  newStatus: string;
  failureReason: string | null;
}

export interface SyncResult {
  updatedCount: number;
  syncedOrders: SyncedOrderInfo[];
}

export async function syncPendingWebStoreOrders(orderIds?: string[], opts: SyncScanOptions = {}): Promise<SyncResult> {
  const syncedOrders: SyncedOrderInfo[] = [];

  try {
    const razorpay = opts.razorpay || (await createRazorpayClient());
    if (!razorpay) {
      console.warn("[RazorpaySync] Razorpay credentials not configured, skipping sync.");
      return { updatedCount: 0, syncedOrders: [] };
    }

    // Build filter for pending + recently-failed orders (late Razorpay captures
    // after payment_timed_out must still be recoverable).
    const where: Record<string, unknown> = {
      razorpayOrderId: { not: null },
    };

    let pendingOrders: any[];
    if (orderIds && orderIds.length > 0) {
      where.id = { in: orderIds };
      pendingOrders = await prisma.webStoreOrder.findMany({ where });
    } else {
      const since = new Date(Date.now() - RECOVERY_WINDOW_MS);
      const pendingRows = await listRowsOldestFirst(
        prisma.webStoreOrder,
        { ...where, paymentStatus: { in: ["pending", "payment_pending", "awaiting_confirmation"] } },
        since
      );
      // Late captures after payment_timed_out: re-check the newest failed rows only,
      // as before. Failed rows stay failed for ever, so walking all of them oldest
      // first would spend every run on the same old ones and starve the new.
      const failedRows = await prisma.webStoreOrder.findMany({
        where: { ...where, paymentStatus: { in: ["failed", "payment_failed"] }, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: SCAN_BATCH_SIZE,
      });
      pendingOrders = [...pendingRows, ...failedRows];
    }
    const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_SCAN_BUDGET_MS);

    for (const order of pendingOrders) {
      if (!order.razorpayOrderId) continue;
      if (Date.now() > deadline) {
        console.warn(`[RazorpaySync] Scan budget reached after ${syncedOrders.length} update(s); remaining rows wait for the next run`);
        break;
      }

      try {
        // First check if main Order table already has confirmed/paid status for this razorpayOrderId
        const matchingMainOrders = await prisma.order.findMany({
          where: { razorpayOrderId: order.razorpayOrderId }
        });

        const confirmedMainOrder = matchingMainOrders.find(
          (m: Record<string, unknown>) => m.paymentStatus === "paid" || m.paymentStatus === "cod_upfront_paid" || m.paymentStatus === "partially_paid"
        );

        const { getConfiguredCodUpfrontAmount, DEFAULT_COD_UPFRONT_AMOUNT } = await import("@/lib/cod-upfront");
        const { isCapturedPaymentEntity, paymentAmountRupees } = await import("@/lib/razorpay-payment");
        const expectedCodUpfront = await getConfiguredCodUpfrontAmount().catch(() => DEFAULT_COD_UPFRONT_AMOUNT);

        // Always ask Razorpay — never trust local codUpfrontPaid / notes / payment IDs alone
        const rzpOrder = (await razorpay.orders.fetch(order.razorpayOrderId)) as unknown as Record<string, unknown>;
        let paymentsList: Record<string, unknown> | null = null;
        try {
          paymentsList = await razorpay.orders.fetchPayments(order.razorpayOrderId) as unknown as Record<string, unknown>;
        } catch {
          // ignore fetchPayments failure
        }

        const items: Record<string, unknown>[] = (paymentsList?.items as Record<string, unknown>[]) || [];
        const capturedPayment =
          items.find((p) =>
            isCapturedPaymentEntity(p, {
              orderId: order.razorpayOrderId,
              minRupees: ((order.paymentMethod || "").toLowerCase().trim() === "cod" ? expectedCodUpfront : 0) || undefined,
            })
          ) ||
          items.find((p) => isCapturedPaymentEntity(p, { orderId: order.razorpayOrderId })) ||
          null;
        const failedPayments = items.filter((p: Record<string, unknown>) => p.status === "failed");
        const latestFailedPayment = failedPayments.length > 0 ? failedPayments[failedPayments.length - 1] : null;

        const isCOD =
          (order.paymentMethod || "").toLowerCase().trim() === "cod" ||
          ((confirmedMainOrder?.paymentMethod as string) || "").toLowerCase().trim() === "cod" ||
          (order.notes || "").toLowerCase().includes("cod order");

        let upfrontPayment: Record<string, unknown> | null = null;
        const candidateUpfrontId =
          order.codUpfrontPaymentId ||
          (confirmedMainOrder?.razorpayPaymentId as string | null) ||
          order.razorpayPaymentId ||
          null;
        if (candidateUpfrontId) {
          try {
            upfrontPayment = (await razorpay.payments.fetch(candidateUpfrontId)) as unknown as Record<string, unknown>;
          } catch {}
        }

        const verifiedUpfront =
          (isCOD &&
            (isCapturedPaymentEntity(capturedPayment, {
              minRupees: expectedCodUpfront,
              orderId: order.razorpayOrderId,
            }) ||
              isCapturedPaymentEntity(upfrontPayment, {
                minRupees: expectedCodUpfront,
                orderId: order.razorpayOrderId,
              }))) ||
          false;

        const verifiedPrepaid =
          !isCOD &&
          (isCapturedPaymentEntity(capturedPayment, { orderId: order.razorpayOrderId }) ||
            isCapturedPaymentEntity(upfrontPayment, { orderId: order.razorpayOrderId }) ||
            rzpOrder.status === "paid");

        // If main Order already looks paid but Razorpay has no capture, do NOT copy that status
        if (confirmedMainOrder && (verifiedUpfront || verifiedPrepaid)) {
          const targetStatus = isCOD ? "cod_upfront_paid" : (confirmedMainOrder.paymentStatus as string);
          const paidRupees = isCOD
            ? paymentAmountRupees(
                (isCapturedPaymentEntity(upfrontPayment, { minRupees: expectedCodUpfront })
                  ? upfrontPayment
                  : capturedPayment) || {}
              )
            : 0;
          const paymentId =
            (capturedPayment?.id as string) ||
            (upfrontPayment?.id as string) ||
            (confirmedMainOrder.razorpayPaymentId as string) ||
            order.razorpayPaymentId ||
            null;

          if (order.paymentStatus !== targetStatus) {
            await prisma.webStoreOrder.update({
              where: { id: order.id },
              data: {
                paymentStatus: targetStatus,
                razorpayPaymentId: paymentId,
                paymentFailureReason: null,
                ...(isCOD
                  ? {
                      codUpfrontPaid: paidRupees || expectedCodUpfront,
                      codUpfrontPaymentId: paymentId,
                      notes: `COD Order (₹${paidRupees || expectedCodUpfront} upfront fee paid via Razorpay) | Order: ${order.orderNumber}`,
                    }
                  : {}),
              },
            });
            syncedOrders.push({
              id: order.id,
              orderNumber: order.orderNumber,
              oldStatus: order.paymentStatus,
              newStatus: targetStatus,
              failureReason: null,
            });
          }

          if (
            (!(confirmedMainOrder as any).shopifyOrderId || String((confirmedMainOrder as any).shopifyOrderId).startsWith('local_')) &&
            (confirmedMainOrder as any).shopifySyncStatus !== 'syncing'
          ) {
            try {
              const { syncOrderToShopify } = await import('@/lib/services/shopifyOrderSyncService');
              await syncOrderToShopify(String(confirmedMainOrder.id));
            } catch (syncErr: any) {
              console.error('[RazorpaySync] Shopify fallback sync error:', syncErr.message);
            }
          }

          continue;
        }

        const upfrontCaptured = verifiedUpfront;

        let newStatus: string | null = null;
        let newPaymentId: string | null = null;
        let failureReason: string | null = null;

        // 1. COD: only mark paid when Razorpay has a captured upfront ≥ configured fee
        if (isCOD && upfrontCaptured) {
          newStatus = "cod_upfront_paid";
          newPaymentId = (capturedPayment?.id as string) || (upfrontPayment?.id as string) || null;
          failureReason = null;
        } else if (!isCOD && (rzpOrder.status === "paid" || verifiedPrepaid)) {
          newStatus = "paid";
          newPaymentId = (capturedPayment?.id as string) || (upfrontPayment?.id as string) || order.razorpayPaymentId || null;
          failureReason = null;
        } else if (latestFailedPayment && !upfrontCaptured) {
          const rawReason =
            (latestFailedPayment.error_description as string) ||
            (latestFailedPayment.error_reason as string) ||
            (latestFailedPayment.error_code as string) ||
            "Payment failed";
          
          const rawCode = String(latestFailedPayment.error_code || "").toUpperCase();
          const rawDesc = String(latestFailedPayment.error_description || "").toLowerCase();

          if (
            rawCode === "BAD_REQUEST_ERROR" &&
            (rawDesc.includes("cancel") || rawDesc.includes("dismissed") || rawDesc.includes("closed"))
          ) {
            newStatus = "cancelled";
            failureReason = "payment_cancelled_by_user";
          } else {
            newStatus = "failed";
            failureReason = rawReason;
          }
        } else if (rzpOrder.status === "attempted" && !upfrontCaptured) {
          newStatus = "failed";
          failureReason = "Payment attempt failed or was cancelled by customer";
        } else if (!upfrontCaptured) {
          // Already failed — leave as-is unless Razorpay later shows a capture (handled above)
          const alreadyFailed =
            order.paymentStatus === "failed" || order.paymentStatus === "payment_failed";
          if (!alreadyFailed) {
            // Order status is "created", check age
            const ageMs = Date.now() - new Date(order.createdAt).getTime();
            // Mark as failed if order is > 15 minutes old and uncaptured
            if (ageMs > 15 * 60 * 1000) {
              newStatus = "failed";
              failureReason = "payment_timed_out";
            }
          }
        }

        // Downgrade protection guard: Do not overwrite previously collected status with failed/cancelled/pending unless refunded
        const isPreviouslyCollected =
          order.paymentStatus === "cod_upfront_paid" ||
          order.paymentStatus === "partially_paid" ||
          order.paymentStatus === "paid";

        if (isPreviouslyCollected && (newStatus === "failed" || newStatus === "cancelled" || newStatus === "pending" || newStatus === "payment_pending")) {
          // Keep existing collected status
          newStatus = order.paymentStatus;
          failureReason = null;
        }

        const finalPaymentStatus = (isCOD && (newStatus === "paid" || newStatus === "cod_upfront_paid" || newStatus === "partially_paid"))
          ? "cod_upfront_paid"
          : newStatus;

        if (
          finalPaymentStatus &&
          (finalPaymentStatus !== order.paymentStatus || failureReason !== order.paymentFailureReason)
        ) {
          console.log(`[RazorpaySync] Order ${order.orderNumber} status transition: ${order.paymentStatus} -> ${finalPaymentStatus}. Reason: ${failureReason || 'N/A'}, codUpfrontPaid: ${Number(order.codUpfrontPaid) || 0}, rzpOrderId: ${order.razorpayOrderId}, codUpfrontPaymentId: ${order.codUpfrontPaymentId || newPaymentId}`);

          // 1. Update WebStoreOrder — store the amount actually captured, never invent ₹99
          const syncedUpfront = isCOD
            ? paymentAmountRupees(
                (isCapturedPaymentEntity(upfrontPayment, { minRupees: expectedCodUpfront })
                  ? upfrontPayment
                  : capturedPayment) || { amount: expectedCodUpfront * 100 }
              )
            : 0;

          await prisma.webStoreOrder.update({
            where: { id: order.id },
            data: {
              paymentStatus: finalPaymentStatus,
              razorpayPaymentId: newPaymentId || order.razorpayPaymentId,
              paymentFailureReason: failureReason,
              ...(isCOD && (finalPaymentStatus === "cod_upfront_paid" || finalPaymentStatus === "partially_paid" || finalPaymentStatus === "paid") ? {
                codUpfrontPaid: syncedUpfront,
                codUpfrontPaymentId: newPaymentId || null,
                notes: order.notes || `COD Order (₹${syncedUpfront} upfront fee paid via Razorpay) | Order: ${order.orderNumber}`
              } : {})
            },
          });

          // 2. Update matching Order in main Order table ONLY for successful orders
          const isSuccessfulPayment = finalPaymentStatus === "paid" || finalPaymentStatus === "cod_upfront_paid" || finalPaymentStatus === "partially_paid";

          if (isSuccessfulPayment) {
            const { assignUniversalOrderNumber, isFailedPrefixNumber } = await import("@/lib/orderNumber");

            for (const mOrder of matchingMainOrders) {
              const cleanedTags = (mOrder.tags || '')
                .split(',')
                .map((t: string) => t.trim())
                .filter((t: string) => Boolean(t) && t !== 'payment_pending' && t !== 'Order creation in process')
                .concat(isCOD ? ['cod_upfront_paid'] : ['paid'])
                .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
                .join(', ');

              // Promote ZBPP/ZBPF → real ZB number when cron marks paid (complete may never have run)
              let promotedNumber = mOrder.internalOrderNumber as string | null;
              if (isFailedPrefixNumber(promotedNumber)) {
                const oldNumber = promotedNumber!;
                let mintedNumber = '';
                try {
                  mintedNumber = await assignUniversalOrderNumber(prisma);
                } catch {
                  mintedNumber = `ZB${Date.now().toString().slice(-8)}`;
                }
                const previousNumbers = [mOrder.previousOrderNumbers, oldNumber].filter(Boolean).join(',');
                const promoted = await prisma.order.updateMany({
                  where: {
                    id: mOrder.id,
                    internalOrderNumber: oldNumber,
                  },
                  data: {
                    internalOrderNumber: mintedNumber,
                    previousOrderNumbers: previousNumbers || null,
                    paymentStatus: finalPaymentStatus,
                    status: nextOrderStatusOnCapture(mOrder.status as string, isCOD),
                    razorpayPaymentId: newPaymentId || undefined,
                    paymentCapturedAt: mOrder.paymentCapturedAt || new Date(),
                    paymentFailureReason: null,
                    cancelledBy: null,
                    cancelledAt: null,
                    tags: cleanedTags,
                  },
                });
                if (promoted.count > 0) {
                  promotedNumber = mintedNumber;
                  await prisma.webStoreOrder.updateMany({
                    where: { orderNumber: oldNumber },
                    data: { orderNumber: mintedNumber },
                  });
                  await prisma.mobileOrder.updateMany({
                    where: { orderNumber: oldNumber },
                    data: { orderNumber: mintedNumber },
                  }).catch(() => {});
                  console.log(`[RazorpaySync] Promoted order number: ${oldNumber} -> ${mintedNumber}`);
                } else {
                  const fresh = await prisma.order.findUnique({
                    where: { id: mOrder.id },
                    select: { internalOrderNumber: true },
                  });
                  if (fresh?.internalOrderNumber && !isFailedPrefixNumber(fresh.internalOrderNumber)) {
                    promotedNumber = fresh.internalOrderNumber;
                  }
                }
              } else {
                await prisma.order.update({
                  where: { id: mOrder.id },
                  data: {
                    paymentStatus: finalPaymentStatus,
                    status: nextOrderStatusOnCapture(mOrder.status as string, isCOD),
                    razorpayPaymentId: newPaymentId || undefined,
                    paymentCapturedAt: mOrder.paymentCapturedAt || new Date(),
                    paymentFailureReason: null,
                    cancelledBy: null,
                    cancelledAt: null,
                    tags: cleanedTags,
                  },
                });
              }

              // 3. Upgrade WebStoreOrder number from ZBPP prefix to real order number
              const realOrderNumber = promotedNumber || (mOrder.shopifyOrderName as string);
              if (realOrderNumber && order.orderNumber.startsWith("ZBPP") && !isFailedPrefixNumber(realOrderNumber)) {
                try {
                  // Check if the real order number is already taken
                  const existing = await prisma.webStoreOrder.findUnique({
                    where: { orderNumber: realOrderNumber },
                  });
                  if (!existing || existing.id === order.id) {
                    const shopifyInfo = (mOrder.shopifyOrderName as string) ? `Shopify: ${mOrder.shopifyOrderName}` : '';
                    const localInfo = `Local: ${mOrder.id}`;
                    const notesSuffix = [shopifyInfo, localInfo].filter(Boolean).join(' | ');

                    await prisma.webStoreOrder.update({
                      where: { id: order.id },
                      data: {
                        orderNumber: realOrderNumber,
                        notes: order.notes
                          ? `${order.notes} | ${notesSuffix}`
                          : notesSuffix,
                      },
                    });
                    console.log(`[RazorpaySync] Upgraded order number: ${order.orderNumber} -> ${realOrderNumber}`);
                  }
                } catch (numErr: unknown) {
                  const numMsg = numErr instanceof Error ? numErr.message : String(numErr);
                  console.warn(`[RazorpaySync] Could not upgrade order number for ${order.orderNumber}:`, numMsg);
                }
              }

              // 4. Fallback Shopify sync if main order not yet synced and not in-flight
              if (
                (!mOrder.shopifyOrderId || String(mOrder.shopifyOrderId).startsWith('local_') || String(mOrder.shopifyOrderId).startsWith('app_pending_')) &&
                (mOrder as any).shopifySyncStatus !== 'syncing'
              ) {
                try {
                  const { syncOrderToShopify } = await import('@/lib/services/shopifyOrderSyncService');
                  await syncOrderToShopify(String(mOrder.id));
                } catch (syncErr: any) {
                  console.error('[RazorpaySync] Shopify fallback sync error:', syncErr.message);
                }
              }
            }
          }

          syncedOrders.push({
            id: order.id,
            orderNumber: order.orderNumber,
            oldStatus: order.paymentStatus,
            newStatus: finalPaymentStatus,
            failureReason,
          });
        }
      } catch (orderErr: unknown) {
        const msg = orderErr instanceof Error ? orderErr.message : String(orderErr);
        console.error(`[RazorpaySync] Error syncing order ${order.orderNumber}:`, msg);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[RazorpaySync] Service error:", msg);
  }

  return {
    updatedCount: syncedOrders.length,
    syncedOrders,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main `Order` reconciliation (PAYMENT_AUDIT.md P5 / P22).
//
// syncPendingWebStoreOrders() scans the `web_store_orders` mirror only, so an
// `Order` whose mirror row never got inserted, or whose mirror is already paid
// while the Order is not, was never repaired, and abandoned checkouts stayed
// `payment_pending` forever. This pass works on the `Order` table itself.
// ─────────────────────────────────────────────────────────────────────────────

export interface MainOrderReconcileResult {
  checked: number;
  markedPaid: string[];
  timedOut: string[];
  statusRepaired: number;
  /** Orders confirmed here that had been waiting longer than LATE_CONFIRMATION_MS: neither the browser nor the webhook got there. */
  lateConfirmed: string[];
}

export const LATE_CONFIRMATION_MS = 10 * 60 * 1000;
const lastCheckedAt = new Map<string, number>();

const PENDING_MAIN_STATUSES = ["pending", "payment_pending", "awaiting_confirmation"];

/**
 * Paid-like orders whose Order.status still says a payment attempt failed or is
 * pending (a successful retry recorded by a webhook that did not reset the
 * status) are invisible in the customer's order list. Cancelled orders are left
 * alone: a paid + cancelled order may be a legitimate post-payment cancellation.
 */
export async function repairPaidOrderStatuses(): Promise<number> {
  const paidLike = [...PAID_LIKE_STATUSES];
  const broken = await prisma.order.findMany({
    where: {
      orderType: "WEB_STORE",
      paymentStatus: { in: paidLike },
      status: { in: ["FAILED", "failed", "payment_failed", "payment_pending", "PENDING"] },
      cancelledAt: null,
    },
    select: { id: true, status: true, paymentMethod: true, tags: true, internalOrderNumber: true },
    take: 200,
  });
  let repaired = 0;
  for (const o of broken) {
    const isCOD = (o.paymentMethod || "").toLowerCase().trim() === "cod" || (o.tags || "").toLowerCase().includes("cod");
    const res = await prisma.order.updateMany({
      where: { id: o.id, status: o.status },
      data: { status: nextOrderStatusOnCapture(o.status, isCOD), paymentFailureReason: null },
    });
    if (res.count > 0) {
      repaired++;
      console.log(`[RazorpaySync] Repaired status of paid order ${o.internalOrderNumber || o.id}: ${o.status} -> ${nextOrderStatusOnCapture(o.status, isCOD)}`);
    }
  }
  return repaired;
}

/**
 * Statuses a targeted reconcile (explicit `orderIds`: Razorpay reported a capture
 * for exactly these orders) may flip to paid. A late capture after a failed or
 * cancelled attempt on the same Razorpay order is a real payment — the webhook
 * routes already treat FAILED / cancelled rows that way (nextOrderStatusOnCapture).
 * The scheduled scan keeps to the pending statuses, as before.
 */
const RECOVERABLE_MAIN_STATUSES = [...PENDING_MAIN_STATUSES, "failed", "payment_failed", "cancelled", "canceled"];

export type MainOrderReconcileOptions = SyncScanOptions & {
  /** Reconcile only these Order ids (payment-driven), instead of scanning. */
  orderIds?: string[];
  /** Reconcile just this Razorpay order (used when the shopper comes back to the site). */
  razorpayOrderId?: string;
  /** Reconcile just these customers' pending orders (used when they open My Orders). */
  customerIds?: string[];
  /** Skip orders younger than this, so the browser / webhook usually confirm first. */
  minAgeMs?: number;
  /** Max orders examined per run (targeted lookups). */
  limit?: number;
  /** Re-check older orders less often: every run up to 10 min old, then every 5 min, then every 15 min. */
  throttleOlderOrders?: boolean;
  /** The caller emails the customer itself (payment-driven reconcile), so don't send it here too. */
  skipConfirmationEmail?: boolean;
};

export async function reconcilePendingMainOrders(opts: MainOrderReconcileOptions = {}): Promise<MainOrderReconcileResult> {
  const result: MainOrderReconcileResult = { checked: 0, markedPaid: [], timedOut: [], statusRepaired: 0, lateConfirmed: [] };
  const byIds = Boolean(opts.orderIds && opts.orderIds.length > 0);
  const targeted = byIds || Boolean(opts.razorpayOrderId || opts.customerIds?.length);
  if (!targeted) {
    try {
      result.statusRepaired = await repairPaidOrderStatuses();
    } catch (repairErr: unknown) {
      console.error("[RazorpaySync] Status repair failed:", repairErr instanceof Error ? repairErr.message : String(repairErr));
    }
  }

  const razorpay = opts.razorpay || (await createRazorpayClient());
  if (!razorpay) return result;

  const flippableStatuses = byIds ? RECOVERABLE_MAIN_STATUSES : PENDING_MAIN_STATUSES;
  const baseWhere: Record<string, unknown> = {
    // Web checkout and the mobile app both pre-create a pending order before payment;
    // either can be left unconfirmed when the shopper leaves the payment screen.
    orderType: { in: ["WEB_STORE", "MOBILE_APP"] },
    razorpayOrderId: opts.razorpayOrderId ? opts.razorpayOrderId : { not: null },
    paymentStatus: { in: flippableStatuses },
    ...(opts.customerIds?.length ? { customerId: { in: opts.customerIds } } : {}),
  };
  const until = opts.minAgeMs ? new Date(Date.now() - opts.minAgeMs) : undefined;
  let pending = byIds
    ? await prisma.order.findMany({ where: { ...baseWhere, id: { in: opts.orderIds } } })
    // A shopper opening My Orders only needs their recent checkouts; abandoned ones from days ago are the
    // background scan's job.
    : await listRowsOldestFirst(
        prisma.order,
        baseWhere,
        new Date(Date.now() - (opts.customerIds?.length ? PENDING_ORDER_TIMEOUT_MS : RECOVERY_WINDOW_MS)),
        until
      );
  // The list is oldest-first: a cap must keep the NEWEST rows (the order the shopper just paid for).
  if (opts.limit) pending = pending.slice(-opts.limit);
  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_SCAN_BUDGET_MS);

  const { isCapturedPaymentEntity, paymentAmountRupees } = await import("@/lib/razorpay-payment");
  const { getConfiguredCodUpfrontAmount, DEFAULT_COD_UPFRONT_AMOUNT } = await import("@/lib/cod-upfront");
  const { assignUniversalOrderNumber, isFailedPrefixNumber } = await import("@/lib/orderNumber");
  const expectedCodUpfront = await getConfiguredCodUpfrontAmount().catch(() => DEFAULT_COD_UPFRONT_AMOUNT);

  if (lastCheckedAt.size > 5000) lastCheckedAt.clear();

  for (const order of pending) {
    if (Date.now() > deadline) {
      console.warn(`[RazorpaySync] Main-order scan budget reached after ${result.checked} row(s); remaining rows wait for the next run`);
      break;
    }
    if (opts.throttleOlderOrders) {
      // Fresh checkouts (the shopper may be mid-payment) are looked at on every run; older ones less
      // and less often, so a pile of abandoned carts does not cost thousands of Razorpay calls an hour.
      const ageMs = Date.now() - new Date(order.createdAt).getTime();
      const every = ageMs <= 10 * 60_000 ? 0 : ageMs <= 60 * 60_000 ? 5 * 60_000 : 15 * 60_000;
      const last = lastCheckedAt.get(order.id) || 0;
      if (every && Date.now() - last < every) continue;
      lastCheckedAt.set(order.id, Date.now());
    }
    result.checked++;
    const rzpOrderId = order.razorpayOrderId as string;
    try {
      const isCOD = (order.paymentMethod || "").toLowerCase().trim() === "cod" || (order.tags || "").toLowerCase().includes("cod");
      let payments: Record<string, unknown>[] = [];
      let rzpOrderStatus = "";
      try {
        const rzpOrder = (await razorpay.orders.fetch(rzpOrderId)) as unknown as Record<string, unknown>;
        rzpOrderStatus = String(rzpOrder?.status || "");
        // A Razorpay order nobody tried to pay has no payments: skip the second API call.
        const neverAttempted = rzpOrderStatus === "created" && Number(rzpOrder?.attempts ?? 1) === 0;
        if (!neverAttempted) {
          const list = (await razorpay.orders.fetchPayments(rzpOrderId)) as unknown as Record<string, unknown>;
          payments = (list?.items as Record<string, unknown>[]) || [];
        }
      } catch (fetchErr: unknown) {
        console.warn(`[RazorpaySync] Razorpay lookup failed for ${rzpOrderId}:`, fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
        continue; // unknown state — never time out on a lookup failure
      }

      const captured = payments.find((p) =>
        isCapturedPaymentEntity(p, {
          orderId: rzpOrderId,
          minRupees: isCOD ? expectedCodUpfront : Number(order.totalPrice) || 0,
        })
      ) || null;
      const authorizedPending = payments.some((p) => p.status === "authorized");

      if (captured) {
        const paymentId = String(captured.id);
        const paidRupees = paymentAmountRupees(captured as { amount?: number | null });
        const targetPaymentStatus = isCOD ? "cod_upfront_paid" : "paid";
        const cleanedTags = (order.tags || "")
          .split(",")
          .map((t: string) => t.trim())
          .filter((t: string) => Boolean(t) && t !== "payment_pending" && t !== "Order creation in process")
          .concat([targetPaymentStatus])
          .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
          .join(", ");

        // Guard against a concurrent webhook: only flip rows still unconfirmed.
        const updated = await prisma.order.updateMany({
          where: { id: order.id, paymentStatus: { in: flippableStatuses } },
          data: {
            paymentStatus: targetPaymentStatus,
            status: nextOrderStatusOnCapture(order.status, isCOD),
            razorpayPaymentId: paymentId,
            paymentCapturedAt: new Date(),
            paymentFailureReason: null,
            cancelledBy: null,
            cancelledAt: null,
            tags: cleanedTags,
            shopifySyncStatus: order.shopifySyncStatus === "needs_review" ? "needs_review" : "pending",
            ...(isCOD ? { codUpfrontPaid: paidRupees, codUpfrontPaymentId: paymentId } : {}),
          },
        });
        if (updated.count === 0) continue;

        // Promote ZBPP → ZB (compare-and-set, winner adoption as elsewhere)
        if (isFailedPrefixNumber(order.internalOrderNumber)) {
          const oldNumber = order.internalOrderNumber as string;
          let minted = "";
          try { minted = await assignUniversalOrderNumber(prisma); } catch { minted = `ZB${Date.now().toString().slice(-8)}`; }
          const promoted = await prisma.order.updateMany({
            where: { id: order.id, internalOrderNumber: oldNumber },
            data: { internalOrderNumber: minted, previousOrderNumbers: [order.previousOrderNumbers, oldNumber].filter(Boolean).join(",") || null },
          });
          if (promoted.count > 0) {
            await prisma.webStoreOrder.updateMany({ where: { orderNumber: oldNumber }, data: { orderNumber: minted } }).catch(() => {});
            await prisma.mobileOrder.updateMany({ where: { orderNumber: oldNumber }, data: { orderNumber: minted } }).catch(() => {});
          }
        }

        await prisma.webStoreOrder.updateMany({
          where: { razorpayOrderId: rzpOrderId, paymentStatus: { notIn: [...PAID_LIKE_STATUSES] } },
          data: {
            paymentStatus: targetPaymentStatus,
            razorpayPaymentId: paymentId,
            paymentFailureReason: null,
            ...(isCOD ? { codUpfrontPaid: paidRupees, codUpfrontPaymentId: paymentId } : {}),
          },
        }).catch(() => {});

        const existingPayment = await prisma.payment.findFirst({ where: { orderId: order.id, gateway: "razorpay" } });
        if (!existingPayment) {
          await prisma.payment.create({
            data: { orderId: order.id, customerId: order.customerId, amount: paidRupees, type: "CAPTURE", status: "success", gateway: "razorpay" },
          }).catch(() => {});
        }

        if (order.orderType === "MOBILE_APP") {
          // Same mirror update the app's own /payment/verify performs on capture.
          const mobileNumber = order.internalOrderNumber && !isFailedPrefixNumber(order.internalOrderNumber)
            ? order.internalOrderNumber
            : (await prisma.order.findUnique({ where: { id: order.id }, select: { internalOrderNumber: true } }))?.internalOrderNumber;
          if (mobileNumber) {
            await prisma.mobileOrder.updateMany({
              where: { orderNumber: mobileNumber },
              data: { paymentStatus: targetPaymentStatus, paymentId: paymentId },
            }).catch(() => {});
          }
        }

        if (order.shopifySyncStatus !== "needs_review") {
          try {
            const { syncOrderToShopify } = await import("@/lib/services/shopifyOrderSyncService");
            await syncOrderToShopify(order.id, order.orderType === "MOBILE_APP" ? { preserveAppTags: true } : undefined);
          } catch (syncErr: unknown) {
            console.error("[RazorpaySync] Shopify sync error (retry job picks it up):", syncErr instanceof Error ? syncErr.message : String(syncErr));
          }
        }
        void import("@/lib/meta/purchase-server")
          .then(({ emitMetaPurchase }) => emitMetaPurchase(order.id, undefined, { paymentConfirmed: true }))
          .catch(() => {});
        void import("@/lib/snap/purchase-server")
          .then(({ emitSnapPurchase }) => emitSnapPurchase(order.id, undefined, { paymentConfirmed: true }))
          .catch(() => {});

        // An order confirmed here was not confirmed by the browser, so /complete never emailed the
        // customer. Once per order (confirmation_emailed tag + EmailLog); web checkouts only.
        if (!opts.skipConfirmationEmail) {
          void import("@/lib/services/orderConfirmationNotice")
            .then(({ sendConfirmationForReconciledOrder }) => sendConfirmationForReconciledOrder(order.id, "reconcile"))
            .catch(() => {});
        }

        result.markedPaid.push(order.internalOrderNumber || order.id);
        if (Date.now() - new Date(order.createdAt).getTime() > LATE_CONFIRMATION_MS) {
          result.lateConfirmed.push(order.internalOrderNumber || order.id);
        }
        console.log(`[RazorpaySync] Order ${order.internalOrderNumber || order.id} marked ${targetPaymentStatus} from Razorpay capture ${paymentId}`);
        continue;
      }

      // No capture. Keep waiting while a payment is still authorized (bank polling
      // can take days) or the Razorpay order says paid (capture pending). Otherwise,
      // close checkouts abandoned long ago so they stop accumulating as pending.
      if (authorizedPending || rzpOrderStatus === "paid") continue;
      const ageMs = Date.now() - new Date(order.createdAt).getTime();
      if (ageMs > PENDING_ORDER_TIMEOUT_MS) {
        const closed = await prisma.order.updateMany({
          where: { id: order.id, paymentStatus: { in: PENDING_MAIN_STATUSES } },
          data: { paymentStatus: "failed", status: "FAILED", paymentFailureReason: "payment_timed_out" },
        });
        if (closed.count > 0) {
          await prisma.webStoreOrder.updateMany({
            where: { razorpayOrderId: rzpOrderId, paymentStatus: { in: PENDING_MAIN_STATUSES } },
            data: { paymentStatus: "failed", paymentFailureReason: "payment_timed_out" },
          }).catch(() => {});
          result.timedOut.push(order.internalOrderNumber || order.id);
        }
      }
    } catch (orderErr: unknown) {
      console.error(`[RazorpaySync] Error reconciling order ${order.id}:`, orderErr instanceof Error ? orderErr.message : String(orderErr));
    }
  }

  return result;
}
