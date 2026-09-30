import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/options";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const userIdParam = searchParams.get('user_id');
    const bypassAuth = searchParams.get('bypass_auth') === 'true';

    const session = await getServerSession(authOptions);
    const sessionUserId = session?.user ? (session.user as any).id : null;
    const sessionEmail = session?.user?.email;

    const orderId = params.id;

    const includeRelations = { 
      items: {
        include: {
          product: true
        }
      }, 
      shipments: true,
      customer: true,
      returnRequests: true,
      exchangeRequests: true
    };

    let order = await prisma.order.findUnique({
      where: { id: orderId },
      include: includeRelations,
    });

    if (!order) {
      order = await prisma.order.findFirst({
        where: { internalOrderNumber: orderId },
        include: includeRelations,
      });
    }

    if (!order) {
      order = await prisma.order.findFirst({
        where: { shopifyOrderId: orderId },
        include: includeRelations,
      });
    }

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Determine if we should bypass auth (recent checkout confirmation)
    const isRecent = Date.now() - new Date(order.createdAt).getTime() < 15 * 60 * 1000; // 15 mins
    const shouldBypass = bypassAuth && isRecent;

    if (!shouldBypass) {
      if (!sessionUserId && !userIdParam) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      // Security check: Ensure the order belongs to the requester
      const customer = await prisma.customer.findFirst({
          where: {
              OR: [
                  { id: userIdParam || "" },
                  { id: sessionUserId || "" },
                  { email: sessionEmail || "" }
              ]
          }
      });

      if (!customer || order.customerId !== customer.id) {
         return NextResponse.json({ error: "Unauthorized access to order" }, { status: 403 });
      }
    }

    // Enrich order with tracking data from the latest shipment
    const latestShipment = order.shipments?.sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];

    const enrichedOrder = {
      ...order,
      trackingNumber: latestShipment?.trackingNumber || null,
      trackingUrl: latestShipment?.trackingUrl || null,
      trackingStatus: latestShipment?.status || null,
      currentLocation: latestShipment?.currentLocation || null,
      estimatedDelivery: latestShipment?.estimatedDelivery || null,
      trackingEvents: latestShipment?.events ? JSON.parse(latestShipment.events) : [],
      courier: latestShipment?.courier || null,
      // Build timeline for the TrackingStepper component
      timeline: latestShipment?.events ? 
        JSON.parse(latestShipment.events).reduce((acc: any, event: any) => {
          acc[event.status] = event.timestamp;
          return acc;
        }, {}) : {},
    };

    // Find matching WebStoreOrder to get the nice #ZB40001 order number format
    let webStoreOrder = null;
    if (order.internalOrderNumber) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: { orderNumber: order.internalOrderNumber }
      });
    }
    if (!webStoreOrder && order.razorpayOrderId) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: { razorpayOrderId: order.razorpayOrderId }
      });
    }
    if (!webStoreOrder) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: {
          notes: {
            contains: `Local: ${order.id}`
          }
        }
      });
    }
    if (!webStoreOrder && order.shopifyOrderId) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: {
          notes: {
            contains: `Shopify: ${order.shopifyOrderId}`
          }
        }
      });
    }

    const rawMethod = (webStoreOrder?.paymentMethod || order.paymentMethod || '').toLowerCase();
    const tagsLower = (order.tags || '').toLowerCase();
    const noteLower = (order.note || '').toLowerCase();
    const isCodOrder = rawMethod === 'cod' || tagsLower.includes('cod') || noteLower.includes('cod order') || noteLower.includes('upfront fee paid');
    const finalPaymentMethod = isCodOrder ? 'COD' : (webStoreOrder?.paymentMethod || order.paymentMethod || 'razorpay').toUpperCase();

    let codUpfrontPaid = webStoreOrder?.codUpfrontPaid ? Number(webStoreOrder.codUpfrontPaid) : 0;
    if (isCodOrder && codUpfrontPaid === 0) {
      const pStat = (webStoreOrder?.paymentStatus || order.paymentStatus || '').toLowerCase();
      if (pStat === 'cod_upfront_paid' || pStat === 'partially_paid' || pStat === 'paid' || isCodOrder) {
        codUpfrontPaid = Number(order.codUpfrontPaid) || 99;
      }
    }

    const discountCode = webStoreOrder?.discountCode || order.discountCode || null;
    let discountAmount = webStoreOrder?.discountAmount ? Number(webStoreOrder.discountAmount) : (order.discountAmount || 0);
    if (isCodOrder && discountCode && discountCode.toUpperCase().includes('PREPAID')) {
      discountAmount = 0;
    }

    const storeCreditAmount = webStoreOrder?.storeCreditAmount ? Number(webStoreOrder.storeCreditAmount) : ((order as any).storeCreditAmount || 0);
    const subtotalPrice = order.subtotalPrice || webStoreOrder?.subtotal || (order.items || []).reduce((sum: number, item: any) => sum + (Number(item.price) * (item.quantity || 1)), 0);
    const codBalanceDue = isCodOrder ? Math.max(0, Number(order.totalPrice) - codUpfrontPaid) : 0;

    const orderNumber = order.internalOrderNumber || webStoreOrder?.orderNumber || (order.shopifyOrderId && !order.shopifyOrderId.startsWith('app_pending_') ? order.shopifyOrderId : `#ZB${order.id.slice(-5).toUpperCase()}`);

    const finalOrder = {
      ...enrichedOrder,
      orderNumber,
      paymentMethod: finalPaymentMethod,
      isCod: isCodOrder,
      codUpfrontPaid,
      codBalanceDue,
      discountCode,
      discountAmount,
      storeCreditAmount,
      subtotalPrice,
      statusTimeline: statusTimeline(order),
    };

    return NextResponse.json({ order: finalOrder });
  } catch (error: any) {
    console.error("Fetch Single Order Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function statusTimeline(order: any) {
  const createdAt = order.createdAt ? new Date(order.createdAt).toISOString() : null;
  const status = String(order.status || '').toLowerCase();
  const delivery = String(order.deliveryStatus || '').toLowerCase();
  const updatedAt = new Date(order.updatedAt).toISOString();

  const hasActiveReturn = order.returnRequests?.some((r: any) => r.status !== 'cancelled') || false;
  const hasActiveExchange = order.exchangeRequests?.some((e: any) => e.status !== 'cancelled') || false;
  const isReturnInitiated = status.includes('return') || status.includes('exchange') || status === 'returned' || status === 'exchanged' || hasActiveReturn || hasActiveExchange;

  if (isReturnInitiated) {
    const isApproved = status === 'return_approved' || status === 'exchange_approved' || status === 'returned' || status === 'exchanged' ||
      order.returnRequests?.some((r: any) => ['approved', 'refund_pending', 'pickup_scheduled', 'received', 'refunded'].includes(r.status)) ||
      order.exchangeRequests?.some((e: any) => ['approved', 'exchange_approved', 'qc_passed', 'received', 'new_order_created'].includes(e.status));
      
    const isCompleted = status === 'returned' || status === 'exchanged' ||
      order.returnRequests?.some((r: any) => r.status === 'refunded') ||
      order.exchangeRequests?.some((e: any) => e.status === 'new_order_created');

    const latestShipment = (order.shipments || []).find((s: any) => String(s.status).toLowerCase() === 'delivered');
    const deliveredAt = latestShipment?.updatedAt ? new Date(latestShipment.updatedAt).toISOString() : updatedAt;

    return [
      { step: 'order_placed', completedAt: createdAt },
      { step: 'delivered', completedAt: deliveredAt },
      { step: 'return_requested', completedAt: updatedAt },
      { step: 'pickup_approved', completedAt: isApproved ? updatedAt : null },
      { step: 'refund_completed', completedAt: isCompleted ? updatedAt : null },
    ];
  }

  const isDelivered = delivery === 'delivered';
  const isOutForDelivery = isDelivered || delivery === 'out_for_delivery';
  const isShipped = isOutForDelivery || delivery === 'shipped';
  const isApproved = isShipped || status === 'approved' || status === 'confirmed';

  return [
    { step: 'order_placed', completedAt: createdAt },
    { step: 'confirmed', completedAt: isApproved ? updatedAt : null },
    { step: 'shipped', completedAt: isShipped ? updatedAt : null },
    { step: 'out_for_delivery', completedAt: isOutForDelivery ? updatedAt : null },
    { step: 'delivered', completedAt: isDelivered ? updatedAt : null },
  ];
}
