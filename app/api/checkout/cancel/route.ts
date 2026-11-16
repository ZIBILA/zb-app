import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

const COLLECTED_STATUSES = [
  'paid', 'cod_upfront_paid', 'partially_paid', 'PAID', 'COD_UPFRONT_PAID', 'PARTIALLY_PAID', 'success', 'SUCCESS',
];

/**
 * Records a dismissed / failed Razorpay attempt on the shopper's own pending order.
 *
 * Previously unauthenticated and keyed on any Razorpay order id, so anyone could
 * flip any unpaid order to cancelled/FAILED (PAYMENT_AUDIT.md P13). The checkout
 * requires a signed-in customer, so the update is now bound to that customer.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const sessionUserId: string | null = (session?.user as any)?.id || null;
    if (!sessionUserId) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }

    const body = await req.json();
    const { razorpayOrderId, localOrderId, reason } = body;

    if (!razorpayOrderId && !localOrderId) {
      return NextResponse.json({ error: "Order ID missing" }, { status: 400 });
    }
    if (razorpayOrderId && !/^order_[A-Za-z0-9_]{6,60}$/.test(String(razorpayOrderId))) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    // Ask Razorpay before cancelling anything. Closing the Razorpay window does NOT mean the shopper did not pay:
    // after paying in the UPI app the window often sits on "Processing" (the page was suspended) and gets closed
    // while the payment is captured seconds later. Cancelling on the dismiss alone showed paid, shipped orders as
    // "Cancelled" to the customer. A payment that is captured, authorized or still being processed blocks the
    // cancel; if Razorpay cannot be asked, nothing is cancelled (the reconciler settles the order either way).
    let rzpId: string | null = razorpayOrderId ? String(razorpayOrderId) : null;
    if (!rzpId && localOrderId) {
      const local = await prisma.order.findFirst({
        where: { id: String(localOrderId), customerId: sessionUserId },
        select: { razorpayOrderId: true },
      });
      rzpId = local?.razorpayOrderId || null;
    }
    if (rzpId) {
      try {
        const { createRazorpayClient } = await import("@/lib/razorpay-client");
        const rzp = await createRazorpayClient();
        if (!rzp) {
          return NextResponse.json({ success: true, updated: 0, reason: "unverified" });
        }
        const res: any = await rzp.orders.fetchPayments(rzpId);
        const payments: any[] = Array.isArray(res?.items) ? res.items : [];
        const inFlight = payments.some((p) => ["captured", "authorized", "created"].includes(String(p?.status)));
        if (inFlight) {
          console.warn(`[Checkout Cancel] Not cancelling ${rzpId}: Razorpay has a payment that is captured, authorized or in progress`);
          return NextResponse.json({ success: true, updated: 0, reason: "payment_in_progress" });
        }
      } catch (verifyErr: any) {
        console.warn(`[Checkout Cancel] Could not verify ${rzpId} with Razorpay; leaving the order as it is:`, verifyErr?.message || verifyErr);
        return NextResponse.json({ success: true, updated: 0, reason: "unverified" });
      }
    }

    const failureReason = String(reason || "payment_cancelled_by_user").slice(0, 200);
    const isCancelled = failureReason === "payment_cancelled_by_user";

    const whereCondition: any = razorpayOrderId
      ? { razorpayOrderId: String(razorpayOrderId) }
      : { id: String(localOrderId) };
    whereCondition.customerId = sessionUserId;
    whereCondition.paymentStatus = { notIn: COLLECTED_STATUSES };

    const updated = await prisma.order.updateMany({
      where: whereCondition,
      data: {
        paymentStatus: isCancelled ? "cancelled" : "failed",
        status: isCancelled ? "cancelled" : "FAILED",
        paymentFailureReason: failureReason,
        cancelledAt: isCancelled ? new Date() : undefined,
        cancelledBy: isCancelled ? "customer" : undefined,
      },
    });

    if (updated.count === 0) {
      // Not this customer's pending order (or already collected): nothing to do.
      return NextResponse.json({ success: true, updated: 0, reason: failureReason });
    }

    if (razorpayOrderId) {
      await prisma.webStoreOrder.updateMany({
        where: {
          razorpayOrderId: String(razorpayOrderId),
          paymentStatus: { notIn: COLLECTED_STATUSES },
        },
        data: {
          paymentStatus: isCancelled ? "cancelled" : "failed",
          paymentFailureReason: failureReason,
        },
      });
    }

    console.log(`[Checkout Cancel] Updated ${updated.count} order(s) for ${razorpayOrderId || localOrderId} with reason: ${failureReason}`);

    return NextResponse.json({ success: true, updated: updated.count, reason: failureReason });
  } catch (error: any) {
    console.error("[Checkout Cancel Error]:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
