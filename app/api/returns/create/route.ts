import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { createWithLinkedId } from "@/lib/linkedIds";
import { resolveRefundMethod, requestEligibilityError } from "@/lib/returnPolicy";
import { resolveRequestCustomer } from "@/lib/requestAuth";

export async function POST(req: Request) {
  try {
    // Identity comes from the verified app JWT / web session only — never from the body.
    const authCustomer = await resolveRequestCustomer(req);
    const resolvedUserId: string | null = authCustomer?.id ?? null;

    const body = await req.json();
    const { orderId, returnItems, refundMethod } = body;

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

    // Delivered + inside the window + no other active request (shared with mobile + exchange create).
    const eligibilityError = requestEligibilityError(order, 'return');
    if (eligibilityError) {
      return NextResponse.json({ error: eligibilityError }, { status: 400 });
    }

    // COD orders can only be refunded as store credit (policy); prepaid may choose.
    const effectiveRefundMethod = resolveRefundMethod(order, refundMethod);

    let estimatedRefund = 0;
    const itemsToReturn: any[] = [];

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

      // Never trust the client quantity: 1..ordered quantity, whole units only.
      const orderedQty = Math.max(1, Math.floor(Number(orderItem.quantity) || 1));
      const quantity = Math.min(orderedQty, Math.max(1, Math.floor(Number(returnItem.quantity) || 1)));

      const itemRefund = orderItem.price * quantity;
      estimatedRefund += itemRefund;

      itemsToReturn.push({
        productId,
        orderId: order.id,
        customerId: resolvedUserId,
        quantity,
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
    const returnRequest = await createWithLinkedId<any>(prisma as any, 'return', order, (displayId) => prisma.returnRequest.create({
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
            quantity: item.quantity,
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
    }));

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
