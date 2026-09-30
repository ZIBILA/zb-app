import prisma from "@/lib/db";
import { resolveRazorpayCredentials } from "@/lib/razorpay-credentials";
import Razorpay from "razorpay";

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

export async function syncPendingWebStoreOrders(orderIds?: string[]): Promise<SyncResult> {
  const syncedOrders: SyncedOrderInfo[] = [];

  try {
    const creds = await resolveRazorpayCredentials().catch(() => null);
    if (!creds) {
      console.warn("[RazorpaySync] Razorpay credentials not configured, skipping sync.");
      return { updatedCount: 0, syncedOrders: [] };
    }

    const razorpay = new Razorpay({
      key_id: creds.key_id,
      key_secret: creds.key_secret,
    });

    // Build filter for pending orders
    const where: Record<string, unknown> = {
      razorpayOrderId: { not: null },
    };

    if (orderIds && orderIds.length > 0) {
      where.id = { in: orderIds };
    } else {
      where.paymentStatus = { in: ["pending", "payment_pending", "awaiting_confirmation"] };
    }

    const pendingOrders = await prisma.webStoreOrder.findMany({
      where,
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    for (const order of pendingOrders) {
      if (!order.razorpayOrderId) continue;

      try {
        // First check if main Order table already has confirmed/paid status for this razorpayOrderId
        const matchingMainOrders = await prisma.order.findMany({
          where: { razorpayOrderId: order.razorpayOrderId }
        });

        const confirmedMainOrder = matchingMainOrders.find(
          (m: Record<string, unknown>) => m.paymentStatus === "paid" || m.paymentStatus === "cod_upfront_paid" || m.paymentStatus === "partially_paid"
        );

        if (confirmedMainOrder) {
          // Main order is already confirmed paid! Sync WebStoreOrder to match it and do not check Razorpay for failures.
          const isCOD = (order.paymentMethod || "").toLowerCase().trim() === "cod" || ((confirmedMainOrder.paymentMethod as string) || "").toLowerCase().trim() === "cod";
          const targetStatus = confirmedMainOrder.paymentStatus as string;
          
          if (order.paymentStatus !== targetStatus) {
            await prisma.webStoreOrder.update({
              where: { id: order.id },
              data: {
                paymentStatus: targetStatus,
                razorpayPaymentId: (confirmedMainOrder.razorpayPaymentId as string) || order.razorpayPaymentId,
                paymentFailureReason: null,
                ...(isCOD ? {
                  codUpfrontPaid: Number(order.codUpfrontPaid) || Number((confirmedMainOrder as any).codUpfrontPaid) || 99,
                  codUpfrontPaymentId: (confirmedMainOrder.razorpayPaymentId as string) || order.razorpayPaymentId || null,
                  notes: `COD Order (₹${Number(order.codUpfrontPaid) || Number((confirmedMainOrder as any).codUpfrontPaid) || 99} upfront fee paid via Razorpay) | Order: ${order.orderNumber}`
                } : {})
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

          // Fallback Shopify sync if main order not yet synced and not in-flight
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

        // Main order is not yet marked paid, fetch Razorpay status
        const rzpOrder = (await razorpay.orders.fetch(order.razorpayOrderId)) as unknown as Record<string, unknown>;
        let paymentsList: Record<string, unknown> | null = null;
        try {
          paymentsList = await razorpay.orders.fetchPayments(order.razorpayOrderId) as unknown as Record<string, unknown>;
        } catch {
          // ignore fetchPayments failure
        }

        const items: Record<string, unknown>[] = (paymentsList?.items as Record<string, unknown>[]) || [];
        const capturedPayment = items.find((p: Record<string, unknown>) => p.status === "captured");
        const failedPayments = items.filter((p: Record<string, unknown>) => p.status === "failed");
        const latestFailedPayment = failedPayments.length > 0 ? failedPayments[failedPayments.length - 1] : null;

        const isCOD =
          (order.paymentMethod || "").toLowerCase().trim() === "cod" ||
          (order.notes || "").toLowerCase().includes("cod order") ||
          (order.notes || "").toLowerCase().includes("upfront fee paid");

        // Check if upfront fee was already captured or is captured in Razorpay
        let upfrontPayment: Record<string, unknown> | null = null;
        if (order.codUpfrontPaymentId) {
          try {
            upfrontPayment = await razorpay.payments.fetch(order.codUpfrontPaymentId) as unknown as Record<string, unknown>;
          } catch {}
        }

        const upfrontCaptured =
          capturedPayment ||
          upfrontPayment?.status === "captured" ||
          Number(order.codUpfrontPaid) > 0 ||
          Boolean(order.codUpfrontPaymentId) ||
          (order.notes || "").toLowerCase().includes("upfront fee paid");

        let newStatus: string | null = null;
        let newPaymentId: string | null = null;
        let failureReason: string | null = null;

        // 1. Explicit COD Guard: if COD and upfront fee was captured, status is partially_paid
        if (isCOD && upfrontCaptured) {
          newStatus = "partially_paid";
          newPaymentId = (capturedPayment?.id as string) || (upfrontPayment?.id as string) || order.codUpfrontPaymentId || order.razorpayPaymentId || null;
          failureReason = null;
        } else if (rzpOrder.status === "paid" || capturedPayment) {
          newStatus = isCOD ? "partially_paid" : "paid";
          newPaymentId = (capturedPayment?.id as string) || order.razorpayPaymentId || null;
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
          // Order status is "created", check age
          const ageMs = Date.now() - new Date(order.createdAt).getTime();
          // Mark as failed if order is > 15 minutes old and uncaptured
          if (ageMs > 15 * 60 * 1000) {
            newStatus = "failed";
            failureReason = "payment_timed_out";
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

        const finalPaymentStatus = (isCOD && (newStatus === "paid" || newStatus === "cod_upfront_paid" || newStatus === "partially_paid")) ? "partially_paid" : newStatus;

        if (
          finalPaymentStatus &&
          (finalPaymentStatus !== order.paymentStatus || failureReason !== order.paymentFailureReason)
        ) {
          console.log(`[RazorpaySync] Order ${order.orderNumber} status transition: ${order.paymentStatus} -> ${finalPaymentStatus}. Reason: ${failureReason || 'N/A'}, codUpfrontPaid: ${Number(order.codUpfrontPaid) || 99}, rzpOrderId: ${order.razorpayOrderId}, codUpfrontPaymentId: ${order.codUpfrontPaymentId || newPaymentId}`);

          // 1. Update WebStoreOrder
          await prisma.webStoreOrder.update({
            where: { id: order.id },
            data: {
              paymentStatus: finalPaymentStatus,
              razorpayPaymentId: newPaymentId || order.razorpayPaymentId,
              paymentFailureReason: failureReason,
              ...(isCOD && (finalPaymentStatus === "cod_upfront_paid" || finalPaymentStatus === "partially_paid" || finalPaymentStatus === "paid") ? {
                codUpfrontPaid: Number(order.codUpfrontPaid) || 99,
                codUpfrontPaymentId: newPaymentId || order.codUpfrontPaymentId || order.razorpayPaymentId || null,
                notes: order.notes || `COD Order (₹${Number(order.codUpfrontPaid) || 99} upfront fee paid via Razorpay) | Order: ${order.orderNumber}`
              } : {})
            },
          });

          // 2. Update matching Order in main Order table ONLY for successful orders
          const isSuccessfulPayment = finalPaymentStatus === "paid" || finalPaymentStatus === "cod_upfront_paid" || finalPaymentStatus === "partially_paid";

          if (isSuccessfulPayment) {
            for (const mOrder of matchingMainOrders) {
              const cleanedTags = (mOrder.tags || '')
                .split(',')
                .map((t: string) => t.trim())
                .filter((t: string) => Boolean(t) && t !== 'payment_pending' && t !== 'Order creation in process')
                .concat(isCOD ? ['cod_upfront_paid', 'partially_paid'] : ['paid'])
                .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
                .join(', ');

              await prisma.order.update({
                where: { id: mOrder.id },
                data: {
                  paymentStatus: finalPaymentStatus,
                  status: "open",
                  razorpayPaymentId: newPaymentId || undefined,
                  paymentFailureReason: null,
                  tags: cleanedTags,
                },
              });

              // 3. Upgrade WebStoreOrder number from ZBPP prefix to real order number
              const realOrderNumber = (mOrder.internalOrderNumber as string) || (mOrder.shopifyOrderName as string);
              if (realOrderNumber && order.orderNumber.startsWith("ZBPP")) {
                try {
                  // Check if the real order number is already taken
                  const existing = await prisma.webStoreOrder.findUnique({
                    where: { orderNumber: realOrderNumber },
                  });
                  if (!existing) {
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
