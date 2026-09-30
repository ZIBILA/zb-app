import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Post-checkout recovery: find a local order by Razorpay order id
 * after callback_url return when sessionStorage payload is missing.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId")?.trim();
  if (!orderId || !orderId.startsWith("order_")) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions).catch(() => null);
  const sessionUserId = (session?.user as any)?.id || null;

  const order = await prisma.order.findFirst({
    where: { razorpayOrderId: orderId },
    select: {
      id: true,
      customerId: true,
      paymentStatus: true,
      internalOrderNumber: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Prefer owner match; still return id for recent paid orders so confirmation can use bypass
  const paid =
    order.paymentStatus === "paid" ||
    order.paymentStatus === "partially_paid" ||
    order.paymentStatus === "cod_upfront_paid";

  if (sessionUserId && order.customerId && order.customerId !== sessionUserId && !paid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    orderId: order.id,
    paymentStatus: order.paymentStatus,
    orderNumber: order.internalOrderNumber,
  });
}
