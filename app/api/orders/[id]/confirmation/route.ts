import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../auth/[...nextauth]/options";
import prisma from "@/lib/db";
import { isUuid } from "@/lib/is-uuid";

export const dynamic = "force-dynamic";

/**
 * Lightweight confirmation payload — no product includes, returns/exchanges, or
 * sequential WebStoreOrder fan-out. Used only by /orders/[id]/confirmation.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const bypassAuth = searchParams.get("bypass_auth") === "true";
    const orderId = params.id;

    const slimInclude = {
      items: {
        select: {
          id: true,
          title: true,
          quantity: true,
          price: true,
          sku: true,
          size: true,
          variantId: true,
          productId: true,
          image: true,
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    } as const;

    // Primary path: confirmation always navigates with local Order cuid
    let order = await prisma.order.findUnique({
      where: { id: orderId },
      include: slimInclude,
    });

    // Fallbacks for shared links / WSO uuid / ZB number
    if (!order) {
      order = await prisma.order.findFirst({
        where: {
          OR: [
            { internalOrderNumber: orderId },
            { shopifyOrderId: orderId },
          ],
        },
        include: slimInclude,
      });
    }

    let standaloneWebStoreOrder: any = null;
    if (!order) {
      try {
        const wso = await prisma.webStoreOrder.findFirst({
          where: {
            OR: [
              ...(isUuid(orderId) ? [{ id: orderId }] : []),
              { orderNumber: orderId },
            ],
          },
        });
        if (wso) {
          const noteMatch = wso.notes ? String(wso.notes).match(/Local:\s*([a-zA-Z0-9_-]+)/i) : null;
          const linkedLocalId = noteMatch?.[1] || null;
          if (linkedLocalId) {
            order = await prisma.order.findUnique({
              where: { id: linkedLocalId },
              include: slimInclude,
            });
          }
          if (!order && wso.razorpayOrderId) {
            order = await prisma.order.findFirst({
              where: { razorpayOrderId: wso.razorpayOrderId },
              include: slimInclude,
            });
          }
          if (!order && wso.orderNumber) {
            order = await prisma.order.findFirst({
              where: { internalOrderNumber: wso.orderNumber },
              include: slimInclude,
            });
          }
          if (!order) {
            standaloneWebStoreOrder = wso;
          }
        }
      } catch (wsoErr: any) {
        console.warn("[Confirmation] WebStoreOrder lookup skipped:", wsoErr?.message || wsoErr);
      }
    }

    if (!order && !standaloneWebStoreOrder) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const CONFIRMATION_BYPASS_MS = 24 * 60 * 60 * 1000;
    const createdAt = order?.createdAt || standaloneWebStoreOrder?.createdAt;
    const ageMs = createdAt ? Date.now() - new Date(createdAt).getTime() : Number.POSITIVE_INFINITY;
    const isRecent = ageMs >= 0 && ageMs < CONFIRMATION_BYPASS_MS;
    const shouldBypass = bypassAuth && isRecent;

    // Skip session lookup on the hot post-checkout path (bypass + recent order)
    if (!shouldBypass) {
      const session = await getServerSession(authOptions);
      const sessionUserId = session?.user ? (session.user as any).id : null;
      const sessionEmail = session?.user?.email || null;
      const sessionPhone = session?.user ? (session.user as any).phone || null : null;
      const phoneDigits = sessionPhone ? String(sessionPhone).replace(/\D/g, "") : null;
      const phoneLast10 = phoneDigits && phoneDigits.length >= 10 ? phoneDigits.slice(-10) : null;

      if (!sessionUserId && !sessionEmail && !sessionPhone) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const customerWhereClauses: any[] = [];
      if (sessionUserId) customerWhereClauses.push({ id: sessionUserId });
      if (sessionEmail) customerWhereClauses.push({ email: sessionEmail });
      if (sessionPhone) customerWhereClauses.push({ phone: sessionPhone });
      if (phoneLast10) customerWhereClauses.push({ phoneLast10: phoneLast10 });

      type MatchingCustomer = { id: string; email: string | null; phoneLast10: string | null };
      const matchingCustomers: MatchingCustomer[] =
        customerWhereClauses.length > 0
          ? await prisma.customer.findMany({
              where: { OR: customerWhereClauses },
              select: { id: true, email: true, phoneLast10: true },
            })
          : [];

      const customerIds = new Set(matchingCustomers.map((c: MatchingCustomer) => c.id));
      const customerEmails = new Set(
        [
          ...(sessionEmail ? [sessionEmail] : []),
          ...matchingCustomers.map((c: MatchingCustomer) => c.email).filter(Boolean),
        ].map((e) => String(e).toLowerCase())
      );
      const customerPhoneLast10s = new Set(
        [
          ...(phoneLast10 ? [phoneLast10] : []),
          ...matchingCustomers.map((c: MatchingCustomer) => c.phoneLast10).filter(Boolean),
        ].map((p) => String(p))
      );

      let allowed = false;
      if (order) {
        if (order.customerId && customerIds.has(order.customerId)) allowed = true;
        if (!allowed && order.customer) {
          const orderEmail = order.customer.email ? String(order.customer.email).toLowerCase() : null;
          if (orderEmail && customerEmails.has(orderEmail)) allowed = true;
        }
      }
      if (!allowed && standaloneWebStoreOrder) {
        const wsoEmail = standaloneWebStoreOrder.customerEmail
          ? String(standaloneWebStoreOrder.customerEmail).toLowerCase()
          : null;
        const wsoPhoneLast10 =
          standaloneWebStoreOrder.phoneLast10 ||
          (standaloneWebStoreOrder.customerPhone
            ? String(standaloneWebStoreOrder.customerPhone).replace(/\D/g, "").slice(-10)
            : null);
        if (wsoEmail && customerEmails.has(wsoEmail)) allowed = true;
        if (wsoPhoneLast10 && customerPhoneLast10s.has(wsoPhoneLast10)) allowed = true;
      }

      if (!allowed) {
        return NextResponse.json({ error: "Unauthorized access to order" }, { status: 403 });
      }
    }

    const { getCodBalanceDue, resolveStoredCodUpfrontPaid, DEFAULT_COD_UPFRONT_AMOUNT } = await import(
      "@/lib/cod-upfront"
    );

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
            variantId: i.variant_id || i.variantId || null,
            productId: i.product_id || i.productId || null,
          }))
        : [];

      const rawMethod = String(wso.paymentMethod || "").toLowerCase();
      const isCodOrder = rawMethod === "cod";
      const codUpfrontPaid = isCodOrder
        ? resolveStoredCodUpfrontPaid({
            storedPaid: Number(wso.codUpfrontPaid || 0),
            paymentStatus: wso.paymentStatus,
            paymentMethod: wso.paymentMethod,
            paymentId: wso.codUpfrontPaymentId || wso.razorpayPaymentId || null,
            configuredFallback: DEFAULT_COD_UPFRONT_AMOUNT,
          })
        : 0;
      const totalPrice = Number(wso.totalAmount || 0);

      return NextResponse.json({
        order: {
          id: wso.id,
          orderNumber: wso.orderNumber || null,
          shopifyOrderId: null,
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
          shippingAddress: wso.shippingAddress ? JSON.stringify(wso.shippingAddress) : null,
          items,
          customer: {
            id: null,
            name: wso.customerName || null,
            email: wso.customerEmail || null,
            phone: wso.customerPhone || null,
          },
          customerId: null,
          customerPhone: wso.customerPhone || null,
        },
      });
    }

    // Single WSO lookup for ZB number / COD fields (no sequential fan-out)
    const webStoreOrder = await prisma.webStoreOrder.findFirst({
      where: {
        OR: [
          ...(order!.internalOrderNumber ? [{ orderNumber: order!.internalOrderNumber }] : []),
          ...(order!.razorpayOrderId ? [{ razorpayOrderId: order!.razorpayOrderId }] : []),
          { notes: { contains: `Local: ${order!.id}` } },
        ],
      },
      select: {
        orderNumber: true,
        paymentMethod: true,
        paymentStatus: true,
        codUpfrontPaid: true,
        discountCode: true,
        discountAmount: true,
        storeCreditAmount: true,
        subtotal: true,
      },
    });

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

    // Prefer internal ZB number — never surface raw Shopify id on confirmation
    const orderNumber =
      order!.internalOrderNumber ||
      webStoreOrder?.orderNumber ||
      `#ZB${order!.id.slice(-6).toUpperCase()}`;

    return NextResponse.json({
      order: {
        id: order!.id,
        orderNumber,
        shopifyOrderId: null,
        paymentMethod: finalPaymentMethod,
        isCod: isCodOrder,
        codUpfrontPaid,
        codBalanceDue: isCodOrder ? getCodBalanceDue(order!.totalPrice, codUpfrontPaid) : 0,
        totalPrice: order!.totalPrice,
        subtotalPrice,
        discountCode,
        discountAmount,
        storeCreditAmount,
        currency: order!.currency || "INR",
        createdAt: order!.createdAt,
        shippingAddress: order!.shippingAddress,
        items: order!.items,
        customer: order!.customer,
        customerId: order!.customerId,
        customerPhone: order!.customer?.phone || null,
      },
    });
  } catch (error: any) {
    console.error("Fetch Confirmation Order Error:", error);
    return NextResponse.json({ error: error.message || "Failed to load confirmation" }, { status: 500 });
  }
}
