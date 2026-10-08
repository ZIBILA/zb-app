import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await req.json();
    const { action } = body;

    if (action && action !== "approve") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const exchangeRequest = await prisma.exchangeRequest.findUnique({
      where: { id },
      include: {
        exchanges: { include: { newProduct: true, originalProduct: true } },
        order: { include: { items: true, customer: true, shop: true } }
      }
    });

    if (!exchangeRequest) {
      return NextResponse.json({ error: "Exchange request not found" }, { status: 404 });
    }

    if (exchangeRequest.status !== "pending_approval") {
      return NextResponse.json({ error: "Exchange request is not pending approval" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Create a ReturnRequest for the original items (customer needs to send them back)
      const returnItemsData = exchangeRequest.exchanges.map((ex: any) => {
        // Find the matching order item for the original product
        const orderItem = exchangeRequest.order.items.find(
          (oi: any) => oi.productId === ex.originalProductId
        );
        return {
          productId: ex.originalProductId,
          customerId: exchangeRequest.customerId,
          orderId: exchangeRequest.orderId,
          sku: orderItem?.sku || ex.originalProduct?.sku || "",
          reason: ex.reason || exchangeRequest.reason || "Exchange - returning original item",
          status: "APPROVED",
          refundAmount: 0, // No refund — this is an exchange
        };
      });

      const estimatedRefund = 0; // No refund for exchange returns

      const returnRequest = await tx.returnRequest.create({
        data: {
          orderId: exchangeRequest.orderId,
          customerId: exchangeRequest.customerId,
          status: "approved",
          estimatedRefund,
          actualRefund: 0,
          approvedAt: new Date(),
          reason: `EXCHANGE_RETURN - Auto-created return for exchange #${id.slice(0, 8)}`,
          returns: {
            create: returnItemsData
          }
        },
        include: { returns: true }
      });

      // 2. No courier is booked on accept: ops selects the logistics partner next
      //    (POST /api/admin/exchanges/[id]/pickup) which creates the reverse AWB + pickup.
      const reverseAwb: string | null = null;
      const requestStatus = 'approved';

      // 3. Update the ExchangeRequest status & link to the return request & store reverseAwb
      const updatedRequest = await tx.exchangeRequest.update({
        where: { id },
        data: {
          status: requestStatus,
          returnRequestId: returnRequest.id,
        }
      });

      // 4. Update individual exchange items
      await tx.exchange.updateMany({
        where: { exchangeRequestId: id },
        data: {
          status: "APPROVED",
          newOrderId: null
        }
      });

      // 5. Update original order status & auto-cancel pending customer return requests for mutual exclusivity
      await tx.order.update({
        where: { id: exchangeRequest.orderId },
        data: { status: "exchange_approved" }
      });

      await tx.returnRequest.updateMany({
        where: {
          orderId: exchangeRequest.orderId,
          status: { in: ["pending_approval", "submitted"] },
          reason: { not: { contains: "EXCHANGE_RETURN" } }
        },
        data: {
          status: "cancelled",
          reason: "Auto-cancelled due to approved Exchange Request"
        }
      });

      return {
        exchangeRequest: updatedRequest,
        returnRequestId: returnRequest.id,
        reverseAwb,
        requestStatus,
      };
    });

    console.log(`✅ Exchange ${id} processed. Status: ${result.requestStatus}, Return created: ${result.returnRequestId}, AWB: ${result.reverseAwb || 'NONE'}`);

    // SKU lifecycle tracking: mark original item SKUs as EXCHANGED
    try {
      const { markSkuStatus } = await import('@/lib/services/skuService');
      for (const ex of exchangeRequest.exchanges) {
        const orderItem = exchangeRequest.order.items.find(
          (oi: any) => oi.productId === ex.originalProductId
        );
        const sku = orderItem?.sku || (ex as any).originalProduct?.sku;
        if (sku) {
          await markSkuStatus(sku, 'EXCHANGED', 'EXCHANGE_OUT', 'Admin (Exchange Approve)');
        }
      }
    } catch (skuErr) {
      console.error('[Exchange Approve] SKU status update failed:', skuErr);
    }

    // Auto-send WhatsApp notifications with real reverse AWB if available
    try {
      const { sendExchangeConfirmed } = await import('@/lib/whatsapp/templates');
      const cust = exchangeRequest.order.customer;
      let phone = cust?.phone;
      if (!phone && exchangeRequest.order.shippingAddress) {
        try {
          const parsed = typeof exchangeRequest.order.shippingAddress === 'string'
            ? JSON.parse(exchangeRequest.order.shippingAddress)
            : exchangeRequest.order.shippingAddress;
          phone = parsed?.phone;
        } catch (_) {}
      }
      if (phone) {
        const orderIdDisplay = exchangeRequest.order.internalOrderNumber || exchangeRequest.order.shopifyOrderId || exchangeRequest.orderId;
        const customerName = cust?.name || 'Valued Customer';
        const newItemName = exchangeRequest.exchanges.map((ex: any) => ex.newProduct?.title || 'Replacement Item').join(', ');

        await sendExchangeConfirmed({
          phone,
          customerName,
          orderId: orderIdDisplay,
          newItemName,
        });
      }
    } catch (waErr: any) {
      console.error('[Exchange Approve] WhatsApp notification error:', waErr.message);
    }

    return NextResponse.json({
      success: true,
      returnRequestId: result.returnRequestId,
      exchangeRequest: result.exchangeRequest
    });
  } catch (error: any) {
    console.error("Approve Exchange Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
