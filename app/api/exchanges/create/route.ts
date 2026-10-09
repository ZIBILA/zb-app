import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/db";
import { extractItemVariantAndSize } from "@/lib/utils";
import { createWithLinkedId } from "@/lib/linkedIds";
import { requestEligibilityError } from "@/lib/returnPolicy";
import { resolveRequestCustomer } from "@/lib/requestAuth";
import { resolveRazorpayCredentials } from "@/lib/razorpay-credentials";
import { assertCapturedCharge } from "@/lib/razorpay-payment";

/**
 * Prove that a Razorpay payment is real, captured, for at least `expectedRupees`, belongs to the
 * Razorpay order the client was given, and has not already paid for something else.
 * Throws a user-safe Error on any failure.
 */
async function verifyExchangePayment(
  expectedRupees: number,
  details: { razorpayOrderId?: string; razorpayPaymentId?: string; razorpaySignature?: string }
) {
  const paymentId = String(details.razorpayPaymentId || "").trim();
  const razorpayOrderId = String(details.razorpayOrderId || "").trim();
  const signature = String(details.razorpaySignature || "").trim();

  if (!paymentId || !razorpayOrderId || !signature) {
    throw new Error("Payment details are incomplete. Please retry the payment.");
  }

  // Test-mode shortcut only — never accepted in production.
  if (process.env.NODE_ENV !== "production" && paymentId.startsWith("pay_mock_")) {
    return paymentId;
  }

  let credentials;
  try {
    credentials = await resolveRazorpayCredentials();
  } catch {
    throw new Error("Online payments are not available right now. Please try again later.");
  }

  const expected = crypto
    .createHmac("sha256", credentials.key_secret)
    .update(`${razorpayOrderId}|${paymentId}`)
    .digest("hex");
  const a = Buffer.from(signature, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Payment signature could not be verified.");
  }

  try {
    await assertCapturedCharge({
      paymentId,
      credentials,
      expectedMinRupees: expectedRupees,
      orderId: razorpayOrderId,
    });
  } catch {
    throw new Error(`We could not confirm this payment with Razorpay. If money was debited, please contact support with payment reference ${paymentId}.`);
  }

  // One payment can only ever pay for one thing.
  const [usedByExchange, usedByOrder] = await Promise.all([
    prisma.exchangeRequest.findFirst({ where: { paymentId }, select: { id: true } }),
    prisma.order.findFirst({ where: { razorpayPaymentId: paymentId }, select: { id: true } }),
  ]);
  if (usedByExchange || usedByOrder) {
    throw new Error("This payment has already been used.");
  }

  return paymentId;
}

export async function POST(req: Request) {
  try {
    // Identity comes from the verified app JWT / web session only — never from the body.
    const authCustomer = await resolveRequestCustomer(req);
    const resolvedUserId: string | null = authCustomer?.id ?? null;

    const body = await req.json();
    const { orderId, exchangeItems, paymentDetails } = body;

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

    // Delivered + inside the window + no other active request (shared with return create).
    const eligibilityError = requestEligibilityError(order, 'exchange');
    if (eligibilityError) {
      return NextResponse.json({ error: eligibilityError }, { status: 400 });
    }

    let calculatedPriceDifference = 0;
    const itemsToExchange: any[] = [];

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
      // Never trust the client quantity: 1..ordered quantity, whole units only.
      const orderedQty = Math.max(1, Math.floor(Number(orderItem.quantity) || 1));
      const exchangeQty = Math.min(orderedQty, Math.max(1, Math.floor(Number(item.quantity) || 1)));
      const itemDiff = (newPrice - originalPrice) * exchangeQty;
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

    // The price difference is ALWAYS the server-calculated value. Any amount sent by the client
    // (paymentDetails.priceDifference) is ignored.
    const finalPriceDifference = Math.round(calculatedPriceDifference * 100) / 100;

    let paymentStatus = "not_required";
    let verifiedPaymentId: string | null = null;
    if (finalPriceDifference > 0) {
      if (settlementPreference === "PREPAID_NOW") {
        try {
          verifiedPaymentId = await verifyExchangePayment(finalPriceDifference, {
            razorpayOrderId: paymentDetails?.razorpayOrderId,
            razorpayPaymentId: paymentDetails?.razorpayPaymentId || paymentDetails?.paymentId,
            razorpaySignature: paymentDetails?.razorpaySignature,
          });
        } catch (payErr: any) {
          return NextResponse.json({ error: payErr?.message || "Payment verification failed" }, { status: 402 });
        }
        paymentStatus = "paid";
      } else {
        paymentStatus = "cod_pending";
      }
    }

    const exchangeRequest = await createWithLinkedId<any>(prisma as any, 'exchange', order, (displayId) => prisma.exchangeRequest.create({
      data: {
        displayId,
        orderId,
        customerId: resolvedUserId,
        status: "pending_approval",
        priceDifference: finalPriceDifference,
        paymentStatus,
        // Only ever a payment id that passed verification above.
        paymentId: verifiedPaymentId,
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
    }));

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
