import { pickActiveOutboundShipment, shipmentAwb } from "@/lib/logistics/status";
import { summarizeRequest } from "@/lib/services/requestSummary";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/options";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

function extractLocalOrderIdFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const m = String(notes).match(/Local:\s*([a-zA-Z0-9_-]+)/i);
  return m?.[1] || null;
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const userIdParam = searchParams.get("user_id");
    const bypassAuth = searchParams.get("bypass_auth") === "true";

    const session = await getServerSession(authOptions);
    const sessionUserId = session?.user ? (session.user as any).id : null;
    const sessionEmail = session?.user?.email || null;
    const sessionPhone = session?.user ? (session.user as any).phone || null : null;
    const phoneDigits = sessionPhone ? sessionPhone.replace(/\D/g, "") : null;
    const phoneLast10 = phoneDigits && phoneDigits.length >= 10 ? phoneDigits.slice(-10) : null;

    const orderId = params.id;

    const includeRelations = {
      items: {
        include: {
          product: true,
        },
      },
      shipments: true,
      customer: true,
      returnRequests: true,
      exchangeRequests: true,
    };

    // Resolve all matching customer records (same breadth as /api/orders list)
    const customerWhereClauses: any[] = [];
    if (userIdParam) customerWhereClauses.push({ id: userIdParam });
    if (sessionUserId) customerWhereClauses.push({ id: sessionUserId });
    if (sessionEmail) customerWhereClauses.push({ email: sessionEmail });
    if (sessionPhone) customerWhereClauses.push({ phone: sessionPhone });
    if (phoneLast10) customerWhereClauses.push({ phoneLast10: phoneLast10 });

    type MatchingCustomer = {
      id: string;
      email: string | null;
      phone: string | null;
      phoneLast10: string | null;
    };
    const matchingCustomers: MatchingCustomer[] =
      customerWhereClauses.length > 0
        ? await prisma.customer.findMany({
            where: { OR: customerWhereClauses },
            select: { id: true, email: true, phone: true, phoneLast10: true },
          })
        : [];

    const customerIds = new Set(matchingCustomers.map((c) => c.id));
    const customerEmails = new Set(
      [
        ...(sessionEmail ? [sessionEmail] : []),
        ...matchingCustomers.map((c) => c.email).filter(Boolean),
      ].map((e) => String(e).toLowerCase())
    );
    const customerPhoneLast10s = new Set(
      [
        ...(phoneLast10 ? [phoneLast10] : []),
        ...matchingCustomers.map((c) => c.phoneLast10).filter(Boolean),
      ].map((p) => String(p))
    );

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
      order = await prisma.order.findFirst({
        where: { previousOrderNumbers: { contains: orderId } },
        include: includeRelations,
      });
    }

    // Orders list also links WebStoreOrder UUIDs for standalone web purchases.
    // Resolve those → local Order when possible, otherwise return a WSO-shaped payload.
    // WebStoreOrder.id is Postgres UUID — only query by id when orderId looks like a UUID.
    let accessWebStoreOrder: any = null;
    let standaloneWebStoreOrder: any = null;
    if (!order) {
      try {
        const { isUuid } = await import('@/lib/is-uuid');
        const wso = await prisma.webStoreOrder.findFirst({
          where: {
            OR: [
              ...(isUuid(orderId) ? [{ id: orderId }] : []),
              { orderNumber: orderId },
            ],
          },
        });

        if (wso) {
          accessWebStoreOrder = wso;
          const linkedLocalId = extractLocalOrderIdFromNotes(wso.notes);
          if (linkedLocalId) {
            order = await prisma.order.findUnique({
              where: { id: linkedLocalId },
              include: includeRelations,
            });
          }
          if (!order && wso.razorpayOrderId) {
            order = await prisma.order.findFirst({
              where: { razorpayOrderId: wso.razorpayOrderId },
              include: includeRelations,
            });
          }
          if (!order && wso.orderNumber) {
            order = await prisma.order.findFirst({
              where: { internalOrderNumber: wso.orderNumber },
              include: includeRelations,
            });
          }
          if (!order && wso.shopifyOrderId) {
            order = await prisma.order.findFirst({
              where: { shopifyOrderId: wso.shopifyOrderId },
              include: includeRelations,
            });
          }
          if (!order) {
            standaloneWebStoreOrder = wso;
          }
        }
      } catch (wsoErr: any) {
        console.warn("[Orders] WebStoreOrder lookup skipped:", wsoErr?.message || wsoErr);
      }
    }

    if (!order && !standaloneWebStoreOrder) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const wsoIdentityMatches = (wso: any | null | undefined): boolean => {
      if (!wso) return false;
      const wsoEmail = wso.customerEmail ? String(wso.customerEmail).toLowerCase() : null;
      const wsoPhoneLast10 =
        wso.phoneLast10 ||
        (wso.customerPhone ? String(wso.customerPhone).replace(/\D/g, "").slice(-10) : null);
      if (wsoEmail && customerEmails.has(wsoEmail)) return true;
      if (wsoPhoneLast10 && customerPhoneLast10s.has(wsoPhoneLast10)) return true;
      return false;
    };

    const orderIdentityMatches = (o: any | null | undefined): boolean => {
      if (!o) return false;
      if (o.customerId && customerIds.has(o.customerId)) return true;
      if (o.customer) {
        const orderEmail = o.customer.email ? String(o.customer.email).toLowerCase() : null;
        const orderPhoneLast10 =
          o.customer.phoneLast10 ||
          (o.customer.phone ? String(o.customer.phone).replace(/\D/g, "").slice(-10) : null);
        if (orderEmail && customerEmails.has(orderEmail)) return true;
        if (orderPhoneLast10 && customerPhoneLast10s.has(orderPhoneLast10)) return true;
      }
      return false;
    };

    // Confirmation pages use unguessable cuid/uuid URLs. Allow a short post-checkout
    // window without session (sessionStorage can be missing after Razorpay
    // callback / new tab / hotspot). After that, require owner session.
    const CONFIRMATION_BYPASS_MS = 24 * 60 * 60 * 1000; // 24h
    const createdAt = order?.createdAt || standaloneWebStoreOrder?.createdAt;
    const ageMs = createdAt ? Date.now() - new Date(createdAt).getTime() : Number.POSITIVE_INFINITY;
    const isRecent = ageMs >= 0 && ageMs < CONFIRMATION_BYPASS_MS;
    const shouldBypass = bypassAuth && isRecent;

    if (!shouldBypass) {
      if (!sessionUserId && !userIdParam && !sessionEmail && !sessionPhone) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      // List shows orders by WSO phone/email OR Order customer. Detail must match that:
      // a WSO UUID can resolve to a local Order whose customerId was remapped by Shopify
      // sync — still allow if the WebStoreOrder contact matches the signed-in user.
      let allowed =
        orderIdentityMatches(order) ||
        wsoIdentityMatches(accessWebStoreOrder) ||
        wsoIdentityMatches(standaloneWebStoreOrder);

      if (!allowed && order && !accessWebStoreOrder) {
        const linkedWso = await prisma.webStoreOrder.findFirst({
          where: {
            OR: [
              ...(order.razorpayOrderId ? [{ razorpayOrderId: order.razorpayOrderId }] : []),
              ...(order.internalOrderNumber ? [{ orderNumber: order.internalOrderNumber }] : []),
              { notes: { contains: `Local: ${order.id}` } },
            ],
          },
          select: {
            customerEmail: true,
            customerPhone: true,
            phoneLast10: true,
          },
        }).catch(() => null);
        allowed = wsoIdentityMatches(linkedWso);
      }

      if (!allowed) {
        return NextResponse.json({ error: "Unauthorized access to order" }, { status: 403 });
      }
    }

    // Standalone WebStoreOrder (no local Order row yet)
    if (!order && standaloneWebStoreOrder) {
      const wso = standaloneWebStoreOrder;
      const items = Array.isArray(wso.items)
        ? wso.items.map((i: any) => ({
            id: i.product_id || i.id || `web_item_${wso.id}`,
            title: i.title || "Web Store Item",
            quantity: Number(i.quantity || 1),
            price: Number(i.price || 0),
            image: i.image_url || i.image || null,
            sku: i.sku || null,
            size: i.size || null,
          }))
        : [];

      const rawMethod = String(wso.paymentMethod || "").toLowerCase();
      const isCodOrder = rawMethod === "cod";
      const codUpfrontPaid = Number(wso.codUpfrontPaid || 0);
      const { getCodBalanceDue } = await import("@/lib/cod-upfront");
      const totalPrice = Number(wso.totalAmount || 0);

      const fulfillment = String(wso.fulfillmentStatus || "").toLowerCase();
      const delivery = String(wso.deliveryStatus || "").toLowerCase();
      // Order cancel only — delivery/shipment cancel must not flip the whole order
      const isCancelled = fulfillment.includes("cancel");
      const isDelivered = !isCancelled && (fulfillment === "delivered" || delivery === "delivered");
      const derivedStatus = isCancelled ? "cancelled" : isDelivered ? "delivered" : "active";

      return NextResponse.json({
        order: {
          id: wso.id,
          orderNumber: wso.orderNumber,
          status: derivedStatus,
          paymentStatus: wso.paymentStatus,
          paymentMethod: isCodOrder ? "COD" : String(wso.paymentMethod || "razorpay").toUpperCase(),
          isCod: isCodOrder,
          codUpfrontPaid,
          codBalanceDue: isCodOrder ? getCodBalanceDue(totalPrice, codUpfrontPaid) : 0,
          totalPrice,
          subtotalPrice: Number(wso.subtotal || 0),
          discountCode: wso.discountCode || null,
          discountAmount: Number(wso.discountAmount || 0),
          storeCreditAmount: Number(wso.storeCreditAmount || 0),
          currency: "INR",
          createdAt: wso.createdAt,
          updatedAt: wso.updatedAt,
          deliveryStatus: isCancelled ? "cancelled" : (delivery === "cancelled" ? "pending" : (wso.deliveryStatus || wso.fulfillmentStatus || "pending")),
          fulfillmentStatus: isCancelled ? "cancelled" : (wso.fulfillmentStatus || "unfulfilled"),
          shippingAddress: wso.shippingAddress ? JSON.stringify(wso.shippingAddress) : null,
          items,
          shipments: wso.trackingNumber
            ? [{ trackingNumber: wso.trackingNumber, trackingUrl: wso.trackingUrl, status: wso.deliveryStatus || "confirmed" }]
            : [],
          returnRequests: [],
          exchangeRequests: [],
          trackingNumber: wso.trackingNumber || null,
          trackingUrl: wso.trackingUrl || null,
          statusTimeline: [
            { step: "order_placed", completedAt: wso.createdAt ? new Date(wso.createdAt).toISOString() : null },
            { step: "confirmed", completedAt: wso.paymentStatus === "paid" || wso.paymentStatus === "cod_upfront_paid" ? new Date(wso.updatedAt).toISOString() : null },
            { step: "shipped", completedAt: wso.trackingNumber ? new Date(wso.updatedAt).toISOString() : null },
            { step: "out_for_delivery", completedAt: null },
            { step: "delivered", completedAt: String(wso.fulfillmentStatus || "").toLowerCase() === "delivered" ? new Date(wso.updatedAt).toISOString() : null },
          ],
        },
      });
    }

    // Enrich order with tracking data from the latest shipment
    // Outbound parcel only — a return/exchange pickup must never be shown as "your shipment".
    const latestShipment: any = pickActiveOutboundShipment((order!.shipments || []) as any[]);

    const enrichedOrder = {
      ...order!,
      trackingNumber: shipmentAwb(latestShipment) || null,
      trackingUrl: latestShipment?.trackingUrl || null,
      trackingStatus: latestShipment?.status || null,
      currentLocation: latestShipment?.currentLocation || null,
      estimatedDelivery: latestShipment?.estimatedDelivery || null,
      trackingEvents: latestShipment?.events ? JSON.parse(latestShipment.events) : [],
      courier: latestShipment?.courier || null,
      timeline: latestShipment?.events
        ? JSON.parse(latestShipment.events).reduce((acc: any, event: any) => {
            acc[event.status] = event.timestamp;
            return acc;
          }, {})
        : {},
    };

    // Find matching WebStoreOrder to get the nice #ZB40001 order number format
    let webStoreOrder = null;
    if (order!.internalOrderNumber) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: { orderNumber: order!.internalOrderNumber },
      });
    }
    if (!webStoreOrder && order!.razorpayOrderId) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: { razorpayOrderId: order!.razorpayOrderId },
      });
    }
    if (!webStoreOrder) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: {
          notes: {
            contains: `Local: ${order!.id}`,
          },
        },
      });
    }
    if (!webStoreOrder && order!.shopifyOrderId) {
      webStoreOrder = await prisma.webStoreOrder.findFirst({
        where: {
          notes: {
            contains: `Shopify: ${order!.shopifyOrderId}`,
          },
        },
      });
    }

    const rawMethod = (webStoreOrder?.paymentMethod || order!.paymentMethod || "").toLowerCase();
    const tagsLower = (order!.tags || "").toLowerCase();
    const noteLower = (order!.note || "").toLowerCase();
    const isCodOrder =
      rawMethod === "cod" ||
      tagsLower.includes("cod") ||
      noteLower.includes("cod order") ||
      noteLower.includes("upfront fee paid");
    const finalPaymentMethod = isCodOrder
      ? "COD"
      : (webStoreOrder?.paymentMethod || order!.paymentMethod || "razorpay").toUpperCase();

    const { resolveStoredCodUpfrontPaid, DEFAULT_COD_UPFRONT_AMOUNT } = await import("@/lib/cod-upfront");
    const codUpfrontPaid = isCodOrder
      ? resolveStoredCodUpfrontPaid({
          storedPaid:
            Number(webStoreOrder?.codUpfrontPaid) ||
            Number((order as any).codUpfrontPaid) ||
            0,
          paymentStatus: webStoreOrder?.paymentStatus || order!.paymentStatus,
          paymentMethod: order!.paymentMethod,
          tags: order!.tags,
          note: order!.note,
          paymentId:
            webStoreOrder?.codUpfrontPaymentId ||
            webStoreOrder?.razorpayPaymentId ||
            (order as any).codUpfrontPaymentId ||
            order!.razorpayPaymentId ||
            null,
          configuredFallback: DEFAULT_COD_UPFRONT_AMOUNT,
        })
      : 0;

    const discountCode = webStoreOrder?.discountCode || order!.discountCode || null;
    let discountAmount = webStoreOrder?.discountAmount
      ? Number(webStoreOrder.discountAmount)
      : order!.discountAmount || 0;
    if (isCodOrder && discountCode && discountCode.toUpperCase().includes("PREPAID")) {
      discountAmount = 0;
    }

    const storeCreditAmount = webStoreOrder?.storeCreditAmount
      ? Number(webStoreOrder.storeCreditAmount)
      : (order as any).storeCreditAmount || 0;
    const subtotalPrice =
      order!.subtotalPrice ||
      webStoreOrder?.subtotal ||
      (order!.items || []).reduce(
        (sum: number, item: any) => sum + Number(item.price) * (item.quantity || 1),
        0
      );
    const { getCodBalanceDue } = await import("@/lib/cod-upfront");
    const codBalanceDue = isCodOrder ? getCodBalanceDue(order!.totalPrice, codUpfrontPaid) : 0;

    const orderNumber =
      order!.internalOrderNumber ||
      webStoreOrder?.orderNumber ||
      (order!.shopifyOrderId && !order!.shopifyOrderId.startsWith("app_pending_")
        ? order!.shopifyOrderId
        : `#ZB${order!.id.slice(-5).toUpperCase()}`);

    // Return / exchange requests with one shared summary (id, pickup, received, refund, replacement)
    const replacementIds = (order!.exchangeRequests || []).map((e: any) => e.replacementOrderId).filter(Boolean) as string[];
    const replacementRows: any[] = replacementIds.length
      ? await prisma.order.findMany({
          where: { id: { in: replacementIds } },
          select: { id: true, internalOrderNumber: true, status: true, deliveryStatus: true, shipments: true },
        })
      : [];
    const summaryOrder = { paymentMethod: finalPaymentMethod, paymentStatus: order!.paymentStatus, tags: order!.tags, note: order!.note };
    const returnRequestsWithSummary = (order!.returnRequests || [])
      .filter((r: any) => !r.reason || !r.reason.includes('EXCHANGE_RETURN'))
      .map((r: any) => ({
        ...r,
        summary: summarizeRequest({ kind: 'return', request: r, order: summaryOrder, shipments: (order!.shipments || []) as any[] }),
      }));
    const exchangeRequestsWithSummary = (order!.exchangeRequests || []).map((e: any) => ({
      ...e,
      summary: summarizeRequest({
        kind: 'exchange',
        request: e,
        order: summaryOrder,
        shipments: (order!.shipments || []) as any[],
        replacementOrder: replacementRows.find((r: any) => r.id === e.replacementOrderId) || null,
      }),
    }));

    const finalOrder = {
      ...enrichedOrder,
      returnRequests: [...returnRequestsWithSummary, ...(order!.returnRequests || []).filter((r: any) => r.reason && r.reason.includes('EXCHANGE_RETURN'))],
      exchangeRequests: exchangeRequestsWithSummary,
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
  const status = String(order.status || "").toLowerCase();
  const delivery = String(order.deliveryStatus || "").toLowerCase();
  const updatedAt = new Date(order.updatedAt).toISOString();

  const isTerminalReq = (st: string) =>
    ["cancelled", "rejected", "refunded", "completed", "new_order_created"].includes(String(st || "").toLowerCase());
  const hasActiveReturn =
    order.returnRequests?.some(
      (r: any) => !isTerminalReq(r.status) && !String(r.reason || "").includes("EXCHANGE_RETURN")
    ) || false;
  const hasActiveExchange = order.exchangeRequests?.some((e: any) => !isTerminalReq(e.status)) || false;
  const isReturnInitiated =
    status.includes("return") ||
    status.includes("exchange") ||
    status === "returned" ||
    status === "exchanged" ||
    hasActiveReturn ||
    hasActiveExchange;

  if (isReturnInitiated) {
    const isApproved =
      status === "return_approved" ||
      status === "exchange_approved" ||
      status === "returned" ||
      status === "exchanged" ||
      order.returnRequests?.some((r: any) =>
        ["approved", "refund_pending", "pickup_scheduled", "received", "refunded"].includes(r.status)
      ) ||
      order.exchangeRequests?.some((e: any) =>
        ["approved", "exchange_approved", "qc_passed", "received", "new_order_created"].includes(e.status)
      );

    const isCompleted =
      status === "returned" ||
      status === "exchanged" ||
      order.returnRequests?.some((r: any) => r.status === "refunded") ||
      order.exchangeRequests?.some((e: any) => e.status === "new_order_created");

    const latestShipment = (order.shipments || []).find(
      (s: any) => String(s.status).toLowerCase() === "delivered"
    );
    const deliveredAt = latestShipment?.updatedAt
      ? new Date(latestShipment.updatedAt).toISOString()
      : updatedAt;

    return [
      { step: "order_placed", completedAt: createdAt },
      { step: "delivered", completedAt: deliveredAt },
      { step: "return_requested", completedAt: updatedAt },
      { step: "pickup_approved", completedAt: isApproved ? updatedAt : null },
      { step: "refund_completed", completedAt: isCompleted ? updatedAt : null },
    ];
  }

  const isDelivered = delivery === "delivered";
  const isOutForDelivery = isDelivered || delivery === "out_for_delivery";
  const isShipped = isOutForDelivery || delivery === "shipped";
  const isApproved = isShipped || status === "approved" || status === "confirmed";

  return [
    { step: "order_placed", completedAt: createdAt },
    { step: "confirmed", completedAt: isApproved ? updatedAt : null },
    { step: "shipped", completedAt: isShipped ? updatedAt : null },
    { step: "out_for_delivery", completedAt: isOutForDelivery ? updatedAt : null },
    { step: "delivered", completedAt: isDelivered ? updatedAt : null },
  ];
}
