import { NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * POST /api/admin/exchanges/[id]/receive
 * Mark exchange items as received at the facility.
 * Optionally pass quality check status.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
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

    return NextResponse.json({
      success: true,
      exchangeRequest: result
    });
  } catch (error: any) {
    console.error("Receive Exchange Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
