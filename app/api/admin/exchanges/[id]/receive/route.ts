import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

/**
 * POST /api/admin/exchanges/[id]/receive
 * Mark exchange items as received at the facility.
 * Optionally pass quality check status.
 */
async function POST_impl(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await req.json();
    const { qcStatus, qcNotes } = body;

    const exchangeRequest = await prisma.exchangeRequest.findUnique({
      where: { id },
      include: {
        exchanges: true,
      }
    });

    if (!exchangeRequest) {
      return NextResponse.json({ error: "Exchange request not found" }, { status: 404 });
    }

    if (!["approved", "return_created", "in_transit", "delivered_to_warehouse", "approved_pickup_failed"].includes(exchangeRequest.status)) {
      return NextResponse.json({ error: `Exchange in status "${exchangeRequest.status}" cannot be marked as received` }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx: any) => {
      // Update exchange request status
      const finalQcStatus = qcStatus || "passed";
      const newStatus = finalQcStatus === "passed" ? "qc_passed" : "received";

      const updatedRequest = await tx.exchangeRequest.update({
        where: { id },
        data: {
          status: newStatus,
          receivedAt: new Date(),
        }
      });

      // Update individual exchange items with QC info
      await tx.exchange.updateMany({
        where: { exchangeRequestId: id },
        data: {
          status: newStatus === "qc_passed" ? "QC_PASSED" : "RECEIVED",
          qcStatus: finalQcStatus,
          qcNotes: qcNotes || null,
        }
      });

      // Also update the linked return request to RECEIVED status
      if (exchangeRequest.returnRequestId) {
        await tx.returnRequest.update({
          where: { id: exchangeRequest.returnRequestId },
          data: { status: "received", receivedAt: new Date() }
        }).catch(() => {
          // Ignore if return request not found
        });

        await tx.return.updateMany({
          where: { returnRequestId: exchangeRequest.returnRequestId },
          data: { status: "RECEIVED" }
        }).catch(() => {});
      }

      return updatedRequest;
    });

    console.log(`✅ Exchange ${id} marked as received. QC: ${qcStatus || "passed"}`);

    // SKU lifecycle tracking: restore original item SKUs when QC passes
    if (result.status === 'qc_passed' || (!qcStatus || qcStatus === 'passed')) {
      try {
        const { restoreSkuToStock } = await import('@/lib/services/skuService');
        // Fetch the full exchange with order items to find the SKUs
        const fullExchange = await prisma.exchangeRequest.findUnique({
          where: { id },
          include: {
            exchanges: true,
            order: { include: { items: true } }
          }
        });
        if (fullExchange) {
          for (const ex of fullExchange.exchanges) {
            const orderItem = fullExchange.order.items.find(
              (oi: any) => oi.productId === ex.originalProductId
            );
            const sku = orderItem?.sku;
            if (sku) {
              await restoreSkuToStock(sku, 'EXCHANGE_RESTOCK', 'Admin (Exchange QC Passed)');
            }
          }
        }
      } catch (skuErr) {
        console.error('[Exchange Receive] SKU restoration failed:', skuErr);
      }
    }

    // Auto-create G_E_ replacement order once QC passes (ops still books outbound AWB).
    let replacement: any = null;
    if (result.status === 'qc_passed') {
      try {
        const { createExchangeReplacementOrder } = await import(
          '@/lib/services/exchangeReplacementOrder'
        );
        replacement = await createExchangeReplacementOrder(id);
        if (!replacement.success) {
          console.error('[Exchange Receive] Auto replacement create failed:', replacement.error);
        } else {
          console.log(
            `[Exchange Receive] Auto-created replacement ${replacement.replacementDisplayId}`
          );
        }
      } catch (createErr: any) {
        console.error('[Exchange Receive] Auto replacement create error:', createErr?.message || createErr);
      }
    }

    return NextResponse.json({
      success: true,
      exchangeRequest: replacement?.success ? replacement.exchangeRequest : result,
      replacement: replacement?.success
        ? {
            replacementDisplayId: replacement.replacementDisplayId,
            localOrderId: replacement.localOrderId,
            shopifyOrderId: replacement.shopifyOrderId,
          }
        : null,
      replacementError: replacement && !replacement.success ? replacement.error : null,
    });
  } catch (error: any) {
    console.error("Receive Exchange Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: any) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'edit');
  } catch (authError) {
    return handleAuthError(authError);
  }
  return (POST_impl as any)(req, ctx);
}
