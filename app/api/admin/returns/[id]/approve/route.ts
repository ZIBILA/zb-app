import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { resolveRefundMethod } from "@/lib/returnPolicy";
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { splitRefundAcrossLines } from '@/lib/services/refundSplit';

async function POST_impl(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await req.json();
    const { actualRefund, isStoreCredit, customerId } = body;

    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id },
      include: { 
        returns: true,
        order: {
          include: {
            customer: true
          }
        }
      }
    });

    if (!returnRequest) {
      return NextResponse.json({ error: "Return request not found" }, { status: 404 });
    }

    if (!["pending_approval", "submitted"].includes(returnRequest.status)) {
      return NextResponse.json(
        { error: `Return request is already "${returnRequest.status}" and cannot be accepted again.` },
        { status: 400 }
      );
    }

    const refundAmount = actualRefund !== undefined ? Number(actualRefund) : returnRequest.estimatedRefund;
    const orderTotal = Number(returnRequest.order?.totalPrice);
    if (!Number.isFinite(refundAmount) || refundAmount < 0) {
      return NextResponse.json({ error: "Refund amount must be a valid number." }, { status: 400 });
    }
    if (Number.isFinite(orderTotal) && orderTotal > 0 && refundAmount > orderTotal + 0.01) {
      return NextResponse.json({ error: `Refund amount ₹${refundAmount} exceeds the order total ₹${orderTotal}.` }, { status: 400 });
    }
    // COD orders → store credit only. Prepaid keeps the customer's choice (or admin override).
    const requestedMethod =
      typeof isStoreCredit === 'boolean'
        ? (isStoreCredit ? 'store_credit' : 'original_method')
        : returnRequest.returns[0]?.refundMethod || 'original_method';
    const refundMethod = resolveRefundMethod(returnRequest.order, requestedMethod);
    const storeCreditRefund = refundMethod === 'store_credit';

    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Update the return request status
      const updatedRequest = await tx.returnRequest.update({
        where: { id },
        data: {
          status: "approved",
          actualRefund: refundAmount,
          approvedAt: new Date(),
          refundType: storeCreditRefund ? "store_credit" : "original_source"
        }
      });

      // 2. Update individual return items (keep refundStatus PENDING until QC and Admin Refund Approval)
      // Each line carries ITS OWN share; the shares add up to the request total.
      for (const part of splitRefundAcrossLines(returnRequest.returns, refundAmount)) {
        await tx.return.update({
          where: { id: part.id },
          data: {
            status: "APPROVED",
            refundAmount: part.amount,
            storeCreditAmount: storeCreditRefund ? part.amount : 0,
            refundStatus: "PENDING",
            refundMethod
          }
        });
      }

      // 4. Update order status & auto-cancel any pending exchange requests for mutual exclusivity
      await tx.order.update({
        where: { id: returnRequest.orderId },
        data: { status: "return_approved" }
      });

      await tx.exchangeRequest.updateMany({
        where: {
          orderId: returnRequest.orderId,
          status: { in: ["pending_approval", "submitted"] }
        },
        data: {
          status: "cancelled",
          reason: "Auto-cancelled due to approved Return Request"
        }
      });

      // Accepting does NOT book a courier any more: ops now selects the logistics partner
      // (POST /api/admin/returns/[id]/pickup) which creates the AWB and requests the pickup.
      return { finalRequest: updatedRequest, reverseAwb: null as string | null, awaitingPartner: true };

    });

    // Mark SKUs on returned items as RETURNED (not yet restocked — that happens on RECEIVED)
    try {
      const { markSkuStatus } = await import('@/lib/services/skuService');
      for (const ret of returnRequest.returns) {
        if (ret.sku) {
          await markSkuStatus(ret.sku, 'RETURNED', 'RETURN_IN', 'Admin (Return Approve)');
        }
      }
    } catch (skuErr) {
      console.error('[Return Approve] SKU status update failed:', skuErr);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Approve Return Error:", error);
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
