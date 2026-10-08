import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/options";
import prisma from "@/lib/db";
import { allocateLinkedId } from "@/lib/linkedIds";
import { resolveRefundMethod } from "@/lib/returnPolicy";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    let resolvedUserId = null;

    if (session && session.user) {
      const whereClause: any = { OR: [] };
      if (session.user.email) {
        whereClause.OR.push({ email: session.user.email });
      }
      const sessionUserId = (session.user as any).id;
      if (sessionUserId) {
        whereClause.OR.push({ id: sessionUserId });
      }

      if (whereClause.OR.length > 0) {
        const customer = await prisma.customer.findFirst({
          where: whereClause
        });
        if (customer) {
          resolvedUserId = customer.id;
        }
      }
    }

    const body = await req.json();
    const { orderId, userId: bodyUserId, returnItems, refundMethod } = body;

    if (!resolvedUserId) {
      const authHeader = req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        resolvedUserId = bodyUserId;
      }
    }

    if (!resolvedUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!orderId || !returnItems || !returnItems.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        returnRequests: true,
        exchangeRequests: true
      }
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.customerId !== resolvedUserId) {
      return NextResponse.json({ error: "Unauthorized: Order does not belong to user" }, { status: 403 });
    }

    const isDelivered = String(order.status || '').toLowerCase() === "delivered" ||
                        String(order.deliveryStatus || '').toLowerCase() === "delivered";
    if (!isDelivered) {
      return NextResponse.json({ error: "Returns are only available for delivered orders" }, { status: 400 });
    }

    // 15-Day Delivery Window Enforcement
    const deliveredTimestamp = order.deliveredAt || order.createdAt;
    const diffDays = Math.ceil(Math.abs(Date.now() - new Date(deliveredTimestamp).getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 15) {
      return NextResponse.json({ error: "The 15-day return/exchange window for this order has expired." }, { status: 400 });
    }

    // Mutual Exclusivity Check: prevent duplicate or conflicting active requests
    const activeReturn = order.returnRequests?.find(
      (r: any) => r.status !== 'cancelled' && (!r.reason || !r.reason.includes('EXCHANGE_RETURN'))
    );
    const activeExchange = order.exchangeRequests?.find((e: any) => e.status !== 'cancelled');

    if (activeReturn || activeExchange) {
      return NextResponse.json({
        error: "An active return or exchange request already exists for this order."
      }, { status: 400 });
    }

    // COD orders can only be refunded as store credit (policy); prepaid may choose.
    const effectiveRefundMethod = resolveRefundMethod(order, refundMethod);

    let estimatedRefund = 0;
    const itemsToReturn = [];

    for (const returnItem of returnItems) {
      const orderItem = order.items.find((item: any) => item.id === returnItem.orderItemId);
      if (!orderItem) continue;

      let productId = orderItem.productId;
      if (!productId) {
        if (orderItem.sku) {
          const matched = await prisma.product.findFirst({ where: { sku: orderItem.sku } });
          if (matched) productId = matched.id;
        }
        if (!productId && orderItem.title) {
          const matched = await prisma.product.findFirst({ where: { title: orderItem.title } });
          if (matched) productId = matched.id;
        }
      }

      if (!productId) {
        return NextResponse.json({
          error: `Cannot resolve product for "${orderItem.title || 'item'}". Product record missing.`
        }, { status: 400 });
      }

      const itemRefund = orderItem.price * returnItem.quantity;
      estimatedRefund += itemRefund;

      itemsToReturn.push({
        productId,
        orderId: order.id,
        customerId: resolvedUserId,
        sku: orderItem.sku,
        reason: returnItem.reason,
        status: "REQUESTED",
        refundAmount: itemRefund,
        refundMethod: effectiveRefundMethod,
        comments: returnItem.comments,
        variantTitle: orderItem.variantTitle,
        size: orderItem.size,
        title: orderItem.title,
      });
    }

    // Create the ReturnRequest
    const displayId = await allocateLinkedId(prisma as any, 'return', order);
    const returnRequest = await prisma.returnRequest.create({
      data: {
        displayId,
        refundType: effectiveRefundMethod === 'store_credit' ? 'store_credit' : 'original_source',
        orderId,
        customerId: resolvedUserId,
        status: "pending_approval",
        estimatedRefund,
        returns: {
          create: itemsToReturn.map((item: any) => ({
            productId: item.productId,
            customerId: item.customerId,
            orderId: item.orderId,
            sku: item.sku,
            reason: item.comments ? `${item.reason} - ${item.comments}` : item.reason,
            status: item.status,
            refundAmount: item.refundAmount,
            refundMethod: item.refundMethod,
            refundStatus: "PENDING",
            variantTitle: item.variantTitle,
            size: item.size,
            title: item.title,
          }))
        }
      },
      include: {
        returns: { include: { product: true } }
      }
    });

    // Update order status
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "return_initiated" }
    });

    // Dispatch notification to developer@zicabella.com
    try {
      const customer = await prisma.customer.findUnique({ where: { id: resolvedUserId } });
      const { sendRefundRequestNotification } = await import("@/lib/services/refundNotificationService");
      await sendRefundRequestNotification({
        returnRequestId: returnRequest.id,
        orderId: order.id,
        shopifyOrderId: order.shopifyOrderId,
        customerName: customer?.name || "Customer",
        customerEmail: customer?.email,
        customerPhone: customer?.phone,
        items: returnRequest.returns.map((r: any) => ({
          title: r.product?.title || r.sku || "Returned Item",
          sku: r.sku,
          quantity: r.quantity || 1,
          price: r.refundAmount || 0,
          reason: r.reason
        })),
        totalRefundAmount: estimatedRefund,
        refundMethod: effectiveRefundMethod,
        reason: returnItems[0]?.reason,
        requestType: "RETURN"
      });
    } catch (notifErr: any) {
      console.error("[CreateReturn] Failed to send notification email:", notifErr);
    }

    return NextResponse.json({
      returnRequestId: returnRequest.id,
      displayId: returnRequest.displayId,
      refundMethod: effectiveRefundMethod,
      orderId: returnRequest.orderId,
      status: returnRequest.status,
      estimatedRefund: returnRequest.estimatedRefund,
      createdAt: returnRequest.createdAt,
      items: returnRequest.returns
    });
  } catch (error: any) {
    console.error("Create Return Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
