import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { razorpayOrderId, localOrderId, reason } = body;

    if (!razorpayOrderId && !localOrderId) {
      return NextResponse.json({ error: "Order ID missing" }, { status: 400 });
    }

    const failureReason = reason || "payment_cancelled_by_user";
    const isCancelled = failureReason === "payment_cancelled_by_user";

    // 1. Update Order in Prisma if present (NEVER cancel already-paid or confirmed orders)
    if (razorpayOrderId || localOrderId) {
      const whereCondition: any = razorpayOrderId
        ? { razorpayOrderId }
        : { id: localOrderId };

      whereCondition.paymentStatus = {
        notIn: ['paid', 'cod_upfront_paid', 'partially_paid', 'PAID', 'COD_UPFRONT_PAID', 'PARTIALLY_PAID', 'success', 'SUCCESS'],
      };

      await prisma.order.updateMany({
        where: whereCondition,
        data: {
          paymentStatus: isCancelled ? "cancelled" : "failed",
          status: isCancelled ? "cancelled" : "FAILED",
          paymentFailureReason: failureReason,
          cancelledAt: isCancelled ? new Date() : undefined,
          cancelledBy: isCancelled ? "customer" : undefined,
        },
      });
    }

    // 2. Update WebStoreOrder in Prisma if present (NEVER cancel already-paid orders)
    if (razorpayOrderId) {
      await prisma.webStoreOrder.updateMany({
        where: {
          razorpayOrderId,
          paymentStatus: {
            notIn: ['paid', 'cod_upfront_paid', 'partially_paid', 'PAID', 'COD_UPFRONT_PAID', 'PARTIALLY_PAID', 'success', 'SUCCESS'],
          },
        },
        data: {
          paymentStatus: isCancelled ? "cancelled" : "failed",
          paymentFailureReason: failureReason,
        },
      });
    }

    console.log(`[Checkout Cancel] Updated order(s) for Razorpay Order ${razorpayOrderId || localOrderId} with reason: ${failureReason}`);

    return NextResponse.json({ success: true, reason: failureReason });
  } catch (error: any) {
    console.error("[Checkout Cancel Error]:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
