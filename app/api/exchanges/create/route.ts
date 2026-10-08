import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/options";
import prisma from "@/lib/db";
import { extractItemVariantAndSize } from "@/lib/utils";
import { allocateLinkedId } from "@/lib/linkedIds";

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
    const { orderId, userId: bodyUserId, exchangeItems, paymentDetails } = body;

    if (!resolvedUserId) {
      const authHeader = req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        resolvedUserId = bodyUserId;
      }
    }

    if (!resolvedUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!orderId || !exchangeItems || !exchangeItems.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
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
      return NextResponse.json({ error: "Exchanges are only available for delivered orders" }, { status: 400 });
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

    let calculatedPriceDifference = 0;
    const itemsToExchange = [];

    for (const item of exchangeItems) {
      const orderItem = order.items.find((oi: any) => oi.id === item.orderItemId);
      if (!orderItem) {
        return NextResponse.json({ error: `Order item ${item.orderItemId} not found` }, { status: 404 });
      }

      // Resolve original product ID — handle null productId gracefully
      let originalProductId = orderItem.productId;
      if (!originalProductId) {
        // Try to find a product by matching title or SKU
        if (orderItem.sku) {
          const matchedProduct = await prisma.product.findFirst({
            where: { sku: orderItem.sku }
          });
          if (matchedProduct) originalProductId = matchedProduct.id;
        }
        if (!originalProductId) {
          // Try by title match as last resort
          const matchedProduct = await prisma.product.findFirst({
            where: { title: orderItem.title }
          });
          if (matchedProduct) originalProductId = matchedProduct.id;
        }
        if (!originalProductId) {
          return NextResponse.json({
            error: `Cannot resolve product for order item "${orderItem.title}". Product association is missing.`
          }, { status: 400 });
        }
      }

      // Resolve replacement product ID - handle Prisma CUID, Shopify GID, or numeric Shopify ID
      let shopifyProductId = item.replacementProductId;
      if (shopifyProductId.startsWith('gid://shopify/Product/')) {
        shopifyProductId = shopifyProductId.split('/').pop() || '';
      }

      let newProduct = await prisma.product.findUnique({
        where: { id: item.replacementProductId }
      });

      if (!newProduct) {
        newProduct = await prisma.product.findUnique({
          where: { shopifyProductId }
        });
      }

      if (!newProduct) {
        newProduct = await prisma.product.findFirst({
          where: {
            OR: [
              { shopifyProductId: { contains: shopifyProductId } },
              { id: { contains: shopifyProductId } }
            ]
          }
        });
      }

      if (!newProduct) {
        return NextResponse.json({ error: `Replacement product ${item.replacementProductId} not found` }, { status: 404 });
      }

      // Calculate the price difference for this item
      const originalPrice = orderItem.price || 0;
      const newPrice = newProduct.price || 0;
      const itemDiff = (newPrice - originalPrice) * (item.quantity || 1);
      calculatedPriceDifference += itemDiff;

      const repSize = item.replacementVariant?.size || item.replacementSize || item.selectedSize || item.size || item.replacementVariantTitle || null;
      const repVariant = item.replacementVariantTitle || (repSize ? `Size: ${repSize}` : null) || item.variantTitle || null;

      const origV = extractItemVariantAndSize(orderItem.title, orderItem.sku, orderItem.variantTitle, orderItem.size);
      const newV = extractItemVariantAndSize(newProduct.title, newProduct.sku, repVariant || item.variantTitle);

      const resolvedOrigSize = item.originalSize || orderItem.size || origV.size || null;
      const resolvedOrigVariant = item.originalVariantTitle || orderItem.variantTitle || origV.variant || (resolvedOrigSize ? `Size: ${resolvedOrigSize}` : null);

      const resolvedNewSize = repSize || newV.size || null;
      const resolvedNewVariant = repVariant || newV.variant || (resolvedNewSize ? `Size: ${resolvedNewSize}` : null);

      itemsToExchange.push({
        originalProductId,
        newProductId: newProduct.id, // Store the resolved database CUID
        status: "REQUESTED",
        priceDifference: itemDiff,
        reason: item.reason || "Customer exchange request",
        originalVariantTitle: resolvedOrigVariant,
        originalSize: resolvedOrigSize,
        newVariantTitle: resolvedNewVariant,
        newSize: resolvedNewSize,
      });
    }

    // Extract settlement preference (PREPAID_NOW vs COD_ON_DELIVERY)
    const rawPref = body.settlementPreference || paymentDetails?.settlementPreference || paymentDetails?.paymentMethod;
    const settlementPreference = (rawPref === 'COD_ON_DELIVERY' || rawPref === 'cod') ? 'COD_ON_DELIVERY' : 'PREPAID_NOW';

    // Use calculated price difference, fall back to client-provided if available
    const finalPriceDifference = calculatedPriceDifference || paymentDetails?.priceDifference || 0;

    let paymentStatus = "not_required";
    if (finalPriceDifference > 0) {
      if (settlementPreference === "PREPAID_NOW") {
        if (!paymentDetails || !paymentDetails.paymentId) {
          return NextResponse.json({ error: "Payment required for prepaid exchange price difference" }, { status: 400 });
        }
        paymentStatus = "paid";
      } else {
        paymentStatus = "cod_pending";
      }
    }

    const displayId = await allocateLinkedId(prisma as any, 'exchange', order);
    const exchangeRequest = await prisma.exchangeRequest.create({
      data: {
        displayId,
        orderId,
        customerId: resolvedUserId,
        status: "pending_approval",
        priceDifference: finalPriceDifference,
        paymentStatus,
        paymentId: paymentDetails?.paymentId || null,
        settlementPreference: settlementPreference,
        reason: exchangeItems[0]?.reason || "Exchange request",
        exchanges: {
          create: itemsToExchange.map((item: any) => ({
            originalProductId: item.originalProductId,
            newProductId: item.newProductId,
            orderId,
            status: item.status,
            priceDifference: item.priceDifference,
            paymentStatus,
            reason: item.reason,
            originalVariantTitle: item.originalVariantTitle,
            originalSize: item.originalSize,
            newVariantTitle: item.newVariantTitle,
            newSize: item.newSize,
          }))
        }
      },
      include: {
        exchanges: {
          include: { originalProduct: true, newProduct: true }
        }
      }
    });

    // Update order status
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "exchange_initiated" }
    });

    return NextResponse.json({
      exchangeRequestId: exchangeRequest.id,
      displayId: exchangeRequest.displayId,
      orderId: exchangeRequest.orderId,
      status: exchangeRequest.status,
      priceDifference: exchangeRequest.priceDifference,
      paymentStatus: exchangeRequest.paymentStatus,
      createdAt: exchangeRequest.createdAt,
      items: exchangeRequest.exchanges
    });
  } catch (error: any) {
    console.error("Create Exchange Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
