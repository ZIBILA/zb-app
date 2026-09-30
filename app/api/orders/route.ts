import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/options";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userIdParam = searchParams.get('user_id');
    
    const session = await getServerSession(authOptions);
    const sessionUserId = session?.user ? (session.user as any).id : null;
    const sessionEmail = session?.user?.email || null;
    const sessionPhone = session?.user ? (session.user as any).phone || null : null;
    const phoneDigits = sessionPhone ? sessionPhone.replace(/\D/g, '') : null;
    const phoneLast10 = phoneDigits && phoneDigits.length >= 10 ? phoneDigits.slice(-10) : null;

    if (!sessionUserId && !userIdParam && !sessionEmail && !sessionPhone) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Resolve all matching customer records to capture all historical orders
    const customerWhereClauses: any[] = [];
    if (userIdParam) customerWhereClauses.push({ id: userIdParam });
    if (sessionUserId) customerWhereClauses.push({ id: sessionUserId });
    if (sessionEmail) customerWhereClauses.push({ email: sessionEmail });
    if (sessionPhone) customerWhereClauses.push({ phone: sessionPhone });
    if (phoneLast10) customerWhereClauses.push({ phoneLast10: phoneLast10 });

    const matchingCustomers = await prisma.customer.findMany({
      where: { OR: customerWhereClauses },
      select: { id: true, email: true, phone: true, phoneLast10: true }
    });

    const customerIds = Array.from(new Set([
      ...(userIdParam ? [userIdParam] : []),
      ...(sessionUserId ? [sessionUserId] : []),
      ...matchingCustomers.map((c: any) => c.id)
    ])).filter(Boolean);

    const customerEmails = Array.from(new Set([
      ...(sessionEmail ? [sessionEmail] : []),
      ...matchingCustomers.map((c: any) => c.email).filter(Boolean) as string[]
    ]));

    const customerPhones = Array.from(new Set([
      ...(sessionPhone ? [sessionPhone] : []),
      ...matchingCustomers.map((c: any) => c.phone).filter(Boolean) as string[]
    ]));

    const customerPhoneLast10s = Array.from(new Set([
      ...(phoneLast10 ? [phoneLast10] : []),
      ...matchingCustomers.map((c: any) => c.phoneLast10).filter(Boolean) as string[]
    ]));

    // Query master orders table with broad identity matching
    const masterOrClauses: any[] = [];
    if (customerIds.length > 0) masterOrClauses.push({ customerId: { in: customerIds } });
    if (customerEmails.length > 0) masterOrClauses.push({ customer: { email: { in: customerEmails } } });
    if (customerPhones.length > 0) masterOrClauses.push({ customer: { phone: { in: customerPhones } } });
    if (customerPhoneLast10s.length > 0) masterOrClauses.push({ customer: { phoneLast10: { in: customerPhoneLast10s } } });

    const orders = masterOrClauses.length > 0 ? await prisma.order.findMany({
      where: { 
        OR: masterOrClauses,
        NOT: {
          OR: [
            { internalOrderNumber: { startsWith: 'ZBPF' } },
            { internalOrderNumber: { startsWith: 'ZBPP' } },
            { paymentStatus: { in: ['failed', 'FAILED', 'voided'] } },
            { status: { in: ['payment_failed', 'failed', 'FAILED', 'payment_pending'] } }
          ]
        }
      },
      include: { 
        items: {
          include: {
            product: true
          }
        }, 
        shipments: true,
        returnRequests: {
          include: { returns: true }
        },
        exchangeRequests: {
          include: { exchanges: { include: { newProduct: true, originalProduct: true } } }
        }
      },
      orderBy: { createdAt: "desc" },
    }) : [];

    // Also query webStoreOrder table directly to catch web purchases
    const webOrClauses: any[] = [];
    if (customerEmails.length > 0) webOrClauses.push({ customerEmail: { in: customerEmails } });
    if (customerPhones.length > 0) webOrClauses.push({ customerPhone: { in: customerPhones } });
    if (customerPhoneLast10s.length > 0) webOrClauses.push({ phoneLast10: { in: customerPhoneLast10s } });

    const webStoreOrders = webOrClauses.length > 0 ? await prisma.webStoreOrder.findMany({
      where: {
        OR: webOrClauses,
        paymentStatus: { notIn: ['failed', 'payment_failed', 'FAILED', 'PAYMENT_FAILED'] }
      },
      orderBy: { createdAt: "desc" }
    }) : [];

    // Match each order with its corresponding webStoreOrder if any and compute eligibility
    const enrichedOrders = await Promise.all(
      orders.map(async (order: any) => {
        let webStoreOrder = null;
        if (order.razorpayOrderId) {
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
        
        const orderNumber = order.internalOrderNumber || webStoreOrder?.orderNumber || (order.shopifyOrderId && !order.shopifyOrderId.startsWith('app_pending_') ? order.shopifyOrderId : `#ZB${order.id.slice(-5).toUpperCase()}`);
        
        // Filter out auto-created internal exchange returns from customer view
        const userReturnRequests = (order.returnRequests || []).filter((r: any) => !r.reason || !r.reason.includes('EXCHANGE_RETURN'));
        const userExchangeRequests = order.exchangeRequests || [];

        const activeReturn = userReturnRequests.find((r: any) => r.status !== 'cancelled');
        const activeExchange = userExchangeRequests.find((e: any) => e.status !== 'cancelled');
        const hasActiveRequest = !!(activeReturn || activeExchange);

        const isDelivered = String(order.deliveryStatus || order.status || '').toLowerCase() === 'delivered';
        const deliveredTimestamp = order.deliveredAt || order.createdAt;
        const diffDays = isDelivered ? Math.ceil(Math.abs(Date.now() - new Date(deliveredTimestamp).getTime()) / (1000 * 60 * 60 * 24)) : 999;
        const isWithin15Days = isDelivered && diffDays <= 15;
        const isEligible = isWithin15Days && !hasActiveRequest;
        const remainingDays = Math.max(0, 15 - diffDays);

        return {
          ...order,
          orderNumber,
          userReturnRequests,
          userExchangeRequests,
          activeReturn: activeReturn || null,
          activeExchange: activeExchange || null,
          hasActiveRequest,
          isDelivered,
          isWithin15Days,
          isEligible,
          remainingDays
        };
      })
    );

    // Track master order IDs and razorpay IDs to deduplicate standalone WebStoreOrders
    const masterOrderRzpIds = new Set(orders.map((o: any) => o.razorpayOrderId).filter(Boolean));
    const masterOrderNums = new Set(orders.map((o: any) => (o.internalOrderNumber || "").toUpperCase()).filter(Boolean));

    const standaloneWebOrders = webStoreOrders.filter((wso: any) => {
      const numUpper = (wso.orderNumber || "").toUpperCase();
      const rzpId = wso.razorpayOrderId;
      if (numUpper && masterOrderNums.has(numUpper)) return false;
      if (rzpId && masterOrderRzpIds.has(rzpId)) return false;
      return true;
    });

    const transformedWebOrders = standaloneWebOrders.map((wso: any) => {
      const items = Array.isArray(wso.items) ? wso.items.map((i: any) => ({
        id: i.product_id || i.id || `web_item_${Date.now()}`,
        title: i.title || "Web Store Item",
        quantity: Number(i.quantity || 1),
        price: Number(i.price || 0),
        image: i.image_url || i.image || null,
        sku: i.sku || null,
        size: i.size || null
      })) : [];

      const isDelivered = String(wso.fulfillmentStatus || '').toLowerCase() === 'delivered';
      const deliveredTimestamp = wso.updatedAt || wso.createdAt;
      const diffDays = isDelivered ? Math.ceil(Math.abs(Date.now() - new Date(deliveredTimestamp).getTime()) / (1000 * 60 * 60 * 24)) : 999;
      const isWithin15Days = isDelivered && diffDays <= 15;

      return {
        id: wso.id,
        orderNumber: wso.orderNumber,
        status: wso.fulfillmentStatus === 'delivered' ? 'delivered' : 'active',
        paymentStatus: wso.paymentStatus,
        paymentMethod: wso.paymentMethod,
        totalPrice: Number(wso.totalAmount || 0),
        currency: "INR",
        createdAt: wso.createdAt,
        items,
        shipments: wso.trackingNumber ? [{ trackingNumber: wso.trackingNumber, trackingUrl: wso.trackingUrl }] : [],
        returnRequests: [],
        exchangeRequests: [],
        userReturnRequests: [],
        userExchangeRequests: [],
        activeReturn: null,
        activeExchange: null,
        hasActiveRequest: false,
        isDelivered,
        isWithin15Days,
        isEligible: isWithin15Days,
        remainingDays: Math.max(0, 15 - diffDays)
      };
    });

    const combinedOrders = [...enrichedOrders, ...transformedWebOrders].sort((a: any, b: any) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json({ orders: combinedOrders });
  } catch (error: any) {
    console.error("Fetch Orders Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
