import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import prisma from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveAndSyncCustomerAddress } from "@/lib/services/customerService";
import { toMinorUnits } from "@/lib/global-pricing";
import { assignFailedOrderNumber } from "@/lib/orderNumber";

export const dynamic = 'force-dynamic';

function getRazorpayInstance(): Razorpay | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (keyId && keySecret) {
    return new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return null;
}

async function getRazorpayFromDB(): Promise<Razorpay | null> {
  const shop = await prisma.shop.findFirst({
    select: { razorpayKeyId: true, razorpayKeySecret: true },
  });
  if (shop?.razorpayKeyId && shop?.razorpayKeySecret) {
    return new Razorpay({
      key_id: shop.razorpayKeyId,
      key_secret: shop.razorpayKeySecret,
    });
  }
  return null;
}

function getPublicKeyId(): string {
  return process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || "";
}

export async function POST(req: Request) {
  const rateLimitResult = await checkRateLimit(req, "checkout-razorpay", { maxRequests: 30, windowMs: 60_000 });
  if (!rateLimitResult.allowed && rateLimitResult.response) {
    return rateLimitResult.response;
  }
  try {
    const {
      amount,
      currency = "INR",
      displayCountry = "IN",
      receipt,
      notes,
      address,
      items,
      subtotal,
      total,
      shipping = 0,
      paymentMethod = 'razorpay',
      codFee = 0,
      couponCode,
      couponDiscount = 0,
      storeCreditAmount = 0,
      checkoutSessionId,
    } = await req.json();

    let finalCouponCode = couponCode ? String(couponCode).trim().toUpperCase() : null;
    let finalCouponDiscount = Number(couponDiscount) || 0;

    const pmUpper = (paymentMethod || '').toUpperCase().trim();
    const isCodOrder = pmUpper === 'COD' || pmUpper.includes('COD');

    if (finalCouponCode) {
      const dbCoupon = await prisma.webStoreCoupon.findFirst({
        where: { code: finalCouponCode, isActive: true }
      });

      if (!dbCoupon) {
        finalCouponCode = null;
        finalCouponDiscount = 0;
      } else {
        if (dbCoupon.applicability === 'PREPAID_ONLY' && isCodOrder) {
          console.warn(`[Razorpay Checkout] Stripped PREPAID_ONLY coupon ${finalCouponCode} from COD order`);
          finalCouponCode = null;
          finalCouponDiscount = 0;
        } else if (dbCoupon.applicability === 'COD_ONLY' && !isCodOrder) {
          console.warn(`[Razorpay Checkout] Stripped COD_ONLY coupon ${finalCouponCode} from prepaid order`);
          finalCouponCode = null;
          finalCouponDiscount = 0;
        } else if (dbCoupon.applicability === 'CUSTOM_RATES') {
          const rateType = isCodOrder ? dbCoupon.codDiscountType : dbCoupon.prepaidDiscountType;
          const rateVal = Number(isCodOrder ? dbCoupon.codDiscountValue : dbCoupon.prepaidDiscountValue);
          const sub = Number(subtotal || amount);
          if (rateType === 'percentage') {
            finalCouponDiscount = Math.round((sub * rateVal) / 100);
          } else {
            finalCouponDiscount = Math.min(rateVal, sub);
          }
          // CUSTOM_RATES with zero COD rate means no discount for COD
          if (isCodOrder && rateVal <= 0) {
            console.warn(`[Razorpay Checkout] CUSTOM_RATES coupon ${finalCouponCode} has zero COD discount — stripping`);
            finalCouponCode = null;
            finalCouponDiscount = 0;
          }
        }
      }

      // Safety net: strip coupons with "PREPAID" in the code name from COD orders
      if (finalCouponCode && isCodOrder && finalCouponCode.includes('PREPAID')) {
        console.warn(`[Razorpay Checkout] Safety-net stripped prepaid-named coupon ${finalCouponCode} from COD order`);
        finalCouponCode = null;
        finalCouponDiscount = 0;
      }
    }

    const rawSubtotal = Number(subtotal || amount || 0);
    const rawShipping = Number(shipping || 0);
    const rawStoreCredit = Number(storeCreditAmount || 0);
    const calculatedTotal = Math.max(0, rawSubtotal + rawShipping - finalCouponDiscount - rawStoreCredit);
    const chargeAmount = isCodOrder ? (Number(codFee) > 0 ? Number(codFee) : Number(amount)) : calculatedTotal;

    // Validate required fields
    if (!chargeAmount || typeof chargeAmount !== "number" || chargeAmount <= 0) {
      return NextResponse.json(
        { error: "Invalid amount. Must be a positive number." },
        { status: 400 }
      );
    }

    // Razorpay instance resolution
    let razorpay = getRazorpayInstance();
    let keyId = getPublicKeyId();

    if (!razorpay) {
      razorpay = await getRazorpayFromDB();
      if (!razorpay) {
        return NextResponse.json(
          { error: "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." },
          { status: 400 }
        );
      }
      const shop = await prisma.shop.findFirst({ select: { razorpayKeyId: true } });
      keyId = shop?.razorpayKeyId || keyId;
    }

    const currencyCode = (currency || "INR").toUpperCase();
    const options = {
      amount: toMinorUnits(chargeAmount, currencyCode),
      currency: currencyCode,
      receipt: receipt || `rcpt_${Date.now()}`,
      notes: notes || {},
    };

    const rzpOrder = await razorpay.orders.create(options);

    let localOrderId: string | null = null;
    let universalOrderNumber: string | null = null;

    // ─── Pre-Create or Update Pending Order & WebStoreOrder in Local DB ───
    if (address && items && Array.isArray(items) && items.length > 0) {
      try {
        const shop = await prisma.shop.findFirst();
        if (shop) {
          // 1. Save Customer & Address
          const { customer } = await resolveAndSyncCustomerAddress(shop.id, address);

          // 2. Resolve Line Items
          const resolvedItems = await Promise.all(items.map(async (item: any, index: number) => {
            let dbProductId = null;
            let image = item.image || null;
            if (item.productId) {
              const cleanId = String(item.productId);
              const byShopifyId = await prisma.product.findUnique({ where: { shopifyProductId: cleanId } });
              if (byShopifyId) {
                dbProductId = byShopifyId.id;
                if (!image) image = byShopifyId.featuredImage;
              } else {
                const byCuid = await prisma.product.findUnique({ where: { id: cleanId } });
                if (byCuid) {
                  dbProductId = byCuid.id;
                  if (!image) image = byCuid.featuredImage;
                }
              }
            }

            return {
              shopifyLineItemId: `pre_${rzpOrder.id}_${index}`,
              productId: dbProductId,
              title: item.title,
              quantity: item.quantity,
              price: parseFloat(item.price || '0'),
              sku: item.variantId || item.productId || null,
              image: image
            };
          }));

          const fullStreet = [address.houseNo, address.street, address.landmark, address.apartment].filter(Boolean).join(", ");
          const checkoutAddress = { ...address, street: fullStreet || address.street };

          // 3. Check for existing pending order in current checkout session
          let existingPendingOrder: any = null;
          if (checkoutSessionId) {
            existingPendingOrder = await prisma.order.findFirst({
              where: {
                status: 'payment_pending',
                tags: { contains: `cs_${checkoutSessionId}` },
              },
              orderBy: { createdAt: 'desc' },
            });
          }

          if (existingPendingOrder) {
            universalOrderNumber = existingPendingOrder.internalOrderNumber;
            const updatedOrder = await prisma.order.update({
              where: { id: existingPendingOrder.id },
              data: {
                totalPrice: calculatedTotal,
                subtotalPrice: rawSubtotal,
                shippingAddress: JSON.stringify(checkoutAddress),
                billingAddress: JSON.stringify(checkoutAddress),
                razorpayOrderId: rzpOrder.id,
                paymentMethod: isCodOrder ? "cod" : "razorpay",
                discountCode: finalCouponCode || null,
                discountAmount: Number(finalCouponDiscount) || 0,
                storeCreditAmount: Number(rawStoreCredit) || 0,
                note: rawStoreCredit > 0
                  ? `Order creation in process - ₹${rawStoreCredit} Store Credit applied - Remaining Payment pending`
                  : "Order creation in process - Payment pending",
              }
            });
            localOrderId = updatedOrder.id;

            await prisma.lineItem.deleteMany({ where: { orderId: updatedOrder.id } });
            await prisma.lineItem.createMany({
              data: resolvedItems.map((item: any) => ({
                orderId: updatedOrder.id,
                shopifyLineItemId: item.shopifyLineItemId,
                productId: item.productId,
                title: item.title,
                quantity: item.quantity,
                price: item.price,
                sku: item.sku,
                image: item.image
              }))
            });

            // Update matching WebStoreOrder if present
            const existingWsOrder = await prisma.webStoreOrder.findFirst({
              where: {
                orderNumber: universalOrderNumber,
                paymentStatus: 'payment_pending',
              }
            });

            if (existingWsOrder) {
              await prisma.webStoreOrder.update({
                where: { id: existingWsOrder.id },
                data: {
                  customerName: address.name,
                  customerEmail: address.email,
                  customerPhone: address.phone || "",
                  shippingAddress: checkoutAddress as any,
                  items: items.map((item: any) => ({
                    product_id: item.productId,
                    variant_id: item.variantId || "",
                    title: item.title,
                    image_url: item.image || "",
                    quantity: item.quantity,
                    price: Number(item.price) || 0,
                    size: item.size || ""
                  })) as any,
                  subtotal: rawSubtotal,
                  discountCode: finalCouponCode || null,
                  discountAmount: Number(finalCouponDiscount) || 0,
                  storeCreditAmount: Number(rawStoreCredit) || 0,
                  totalAmount: calculatedTotal,
                  paymentMethod: isCodOrder ? "cod" : "razorpay",
                  razorpayOrderId: rzpOrder.id,
                }
              });
            }
            console.log(`[Razorpay Pre-Create] Updated existing pending order ${universalOrderNumber} (${localOrderId}) for session cs_${checkoutSessionId}`);
          } else {
            // Generate pending order number (real ZB number assigned at payment success)
            try {
              universalOrderNumber = await assignFailedOrderNumber(prisma, { cause: 'pending' });
            } catch (seqErr: any) {
              console.error('[Razorpay Checkout] Failed to generate pending order number:', seqErr.message);
              universalOrderNumber = `ZBPP${Date.now().toString().slice(-8)}`;
            }

            const sessionTag = checkoutSessionId ? `, cs_${checkoutSessionId}` : '';
            const localOrder = await prisma.order.create({
              data: {
                shopId: shop.id,
                shopifyOrderId: null,
                customerId: customer.id,
                status: "payment_pending",
                totalPrice: calculatedTotal,
                subtotalPrice: rawSubtotal,
                totalTax: 0,
                currency: currencyCode,
                displayCountry: displayCountry || "IN",
                paymentStatus: "pending",
                fulfillmentStatus: "unfulfilled",
                deliveryStatus: "pending",
                shippingAddress: JSON.stringify(checkoutAddress),
                billingAddress: JSON.stringify(checkoutAddress),
                razorpayOrderId: rzpOrder.id,
                razorpayPaymentId: null,
                paymentMethod: isCodOrder ? "cod" : "razorpay",
                paymentCapturedAt: null,
                orderType: "WEB_STORE",
                tags: `WebStoreOrder, Web, ${isCodOrder ? "cod" : "razorpay"}, zb-order-${universalOrderNumber}, payment_pending, Order creation in process${sessionTag}`,
                note: rawStoreCredit > 0
                  ? `Order creation in process - ₹${rawStoreCredit} Store Credit applied - Remaining Payment pending`
                  : "Order creation in process - Payment pending",
                discountCode: finalCouponCode || null,
                discountAmount: Number(finalCouponDiscount) || 0,
                storeCreditAmount: Number(rawStoreCredit) || 0,
                internalOrderNumber: universalOrderNumber,
                shopifySyncStatus: 'failed',
                shopifySyncError: 'Order pre-created at payment initiation; payment pending',
                items: {
                  create: resolvedItems.map((item: any) => ({
                    shopifyLineItemId: item.shopifyLineItemId,
                    productId: item.productId,
                    title: item.title,
                    quantity: item.quantity,
                    price: item.price,
                    sku: item.sku,
                    image: item.image
                  }))
                }
              }
            });

            localOrderId = localOrder.id;

            // Create Pending WebStoreOrder for Web Store Dashboard
            try {
              await prisma.webStoreOrder.create({
                data: {
                  orderNumber: universalOrderNumber,
                  customerName: address.name,
                  customerEmail: address.email,
                  customerPhone: address.phone || "",
                  shippingAddress: checkoutAddress as any,
                  items: items.map((item: any) => ({
                    product_id: item.productId,
                    variant_id: item.variantId || "",
                    title: item.title,
                    image_url: item.image || "",
                    quantity: item.quantity,
                    price: Number(item.price) || 0,
                    size: item.size || ""
                  })) as any,
                  subtotal: rawSubtotal,
                  shippingCharge: 0,
                  discountCode: finalCouponCode || null,
                  discountAmount: Number(finalCouponDiscount) || 0,
                  storeCreditAmount: Number(rawStoreCredit) || 0,
                  totalAmount: calculatedTotal,
                  paymentStatus: "payment_pending",
                  paymentMethod: isCodOrder ? "cod" : "razorpay",
                  razorpayOrderId: rzpOrder.id,
                  razorpayPaymentId: null,
                  fulfillmentStatus: "unfulfilled",
                  notes: rawStoreCredit > 0
                    ? `Order creation in process - ₹${rawStoreCredit} Store Credit applied - Remaining Payment pending`
                    : "Order creation in process - Payment pending",
                  source: "web"
                }
              });
            } catch (wsErr: any) {
              console.error("[Razorpay Pre-Create] WebStoreOrder creation notice:", wsErr.message);
            }

            console.log(`[Razorpay Pre-Create] Successfully pre-created pending order ${universalOrderNumber} (${localOrder.id}) with ₹${rawStoreCredit} store credit for Razorpay order ${rzpOrder.id}`);
          }
        }
      } catch (dbErr: any) {
        console.warn("[Razorpay Pre-Create] Warning pre-creating order:", dbErr.message);
      }
    }

    return NextResponse.json({
      razorpay_order_id: rzpOrder.id,
      id: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      key_id: keyId,
      keyId: keyId,
      localOrderId,
      internalOrderNumber: universalOrderNumber,
    });
  } catch (error: any) {
    console.error("[Razorpay] Order creation error:", error);
    return NextResponse.json(
      { error: "Failed to create payment order. Please try again." },
      { status: 500 }
    );
  }
}
