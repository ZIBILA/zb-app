import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requirePermission, handleAuthError } from "@/lib/auth/rbac";
import { refundExchangePayment } from "@/lib/services/exchangePaymentRefund";

export const dynamic = "force-dynamic";

// Statuses from which an exchange may still be rejected (nothing shipped back to the customer yet).
const REJECTABLE = [
  "pending_approval",
  "approved",
  "return_created",
  "in_transit",
  "delivered_to_warehouse",
  "approved_pickup_failed",
  "received", // parcel arrived but failed QC
];

/**
 * POST /api/admin/exchanges/[id]/reject
 * Rejects an exchange. If the customer paid the price difference online, it is refunded to the
 * original Razorpay payment (idempotently) as part of the rejection.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission("RETURNS_EXCHANGES", "edit");
    const actor = (session.user as { email?: string | null })?.email || "Admin";

    const { id } = params;
    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason : undefined;

    const exchangeRequest = await prisma.exchangeRequest.findUnique({
      where: { id },
      select: { id: true, status: true, orderId: true, paymentStatus: true },
    });

    if (!exchangeRequest) {
      return NextResponse.json({ error: "Exchange request not found" }, { status: 404 });
    }

    const previousStatus = String(exchangeRequest.status || "").toLowerCase();
    const alreadyRejected = previousStatus === "rejected";
    const payStatus = String(exchangeRequest.paymentStatus || "").toLowerCase();
    const refundOutstanding = ["paid", "refund_pending"].includes(payStatus);

    // A rejected exchange may be re-submitted only to finish an unfinished refund.
    if (alreadyRejected && !refundOutstanding) {
      return NextResponse.json({ error: "This exchange is already rejected." }, { status: 409 });
    }
    if (!alreadyRejected && !REJECTABLE.includes(previousStatus)) {
      return NextResponse.json(
        { error: `An exchange that is "${previousStatus}" can no longer be rejected.` },
        { status: 400 }
      );
    }

    // 1. Claim the rejection so a concurrent approve / receive cannot race it.
    if (!alreadyRejected) {
      const claimed = await prisma.exchangeRequest.updateMany({
        where: { id, status: exchangeRequest.status },
        data: { status: "rejected", ...(reason !== undefined ? { reason } : {}) },
      });
      if (claimed.count === 0) {
        return NextResponse.json(
          { error: "The exchange changed while rejecting it. Refresh and try again." },
          { status: 409 }
        );
      }
    }

    // 2. Refund the online payment (no-op for COD / free / negative-difference exchanges).
    const refund = await refundExchangePayment(id, actor, "Exchange rejected");
    if (!refund.ok) {
      if (!alreadyRejected) {
        // Put it back so the admin can retry; nothing is lost.
        await prisma.exchangeRequest.updateMany({
          where: { id, status: "rejected" },
          data: { status: exchangeRequest.status },
        });
      }
      return NextResponse.json(
        { error: `Exchange was not rejected because the payment refund failed. ${refund.error}` },
        { status: refund.inProgress ? 409 : 502 }
      );
    }

    // 3. Settle the line items and release the order.
    await prisma.exchange.updateMany({
      where: { exchangeRequestId: id },
      data: { status: "REJECTED" },
    });

    await prisma.order.update({
      where: { id: exchangeRequest.orderId },
      data: { status: "delivered" },
    });

    const updatedRequest = await prisma.exchangeRequest.findUnique({ where: { id } });

    return NextResponse.json({
      ...updatedRequest,
      refund: refund.refunded
        ? { amount: refund.amount, razorpayRefundId: refund.razorpayRefundId }
        : null,
    });
  } catch (error: any) {
    if (error?.message === "401" || error?.message === "403") {
      return handleAuthError(error);
    }
    console.error("Reject Exchange Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
