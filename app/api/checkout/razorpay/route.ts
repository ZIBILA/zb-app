import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import prisma from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveAndSyncCustomerAddress } from "@/lib/services/customerService";
import { toMinorUnits } from "@/lib/global-pricing";
import { assignFailedOrderNumber } from "@/lib/orderNumber";
import { recordSnapPurchaseContext, snapContextFromRequest } from "@/lib/snap/purchase-server";
import { normalizeVariantId } from "@/lib/snap/catalog-id";
import { recordMetaPurchaseContext, metaContextFromRequest } from "@/lib/meta/purchase-server";

export const dynamic = 'force-dynamic';

/** Normalize to a single `cs_<id>` tag (client already sends `cs_…`). */
function checkoutSessionTag(raw?: string | null): string | null {
  if (!raw) return null;
  const id = String(raw).trim().replace(/^cs_+/i, '');
  return id ? `cs_${id}` : null;
}

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

    // Item #25: Store coins can only be redeemed through the mobile app
    if (rawStoreCredit > 0) {
      return NextResponse.json(
        {
          error: "Store coins can only be redeemed through the Zica Bella mobile app. Please open or download the app to redeem your coins.",
          appDownloadUrl: "/app"
        },
        { status: 400 }
      );
    }

    const calculatedTotal = Math.max(0, rawSubtotal + rawShipping - finalCouponDiscount - rawStoreCredit);

    // COD: always charge the dashboard-configured upfront fee (ignore client amount for safety).
    // Prepaid: charge the calculated order total.
    const { getConfiguredCodUpfrontAmount } = await import("@/lib/cod-upfront");
    const configuredCodFee = isCodOrder ? await getConfiguredCodUpfrontAmount() : 0;
    const chargeAmount = isCodOrder ? configuredCodFee : calculatedTotal;

    // Soft-warn if client sent a mismatched COD fee (UI stale cache) but still use server value
    if (isCodOrder && Number(codFee) > 0 && Math.abs(Number(codFee) - configuredCodFee) > 0.01) {
      console.warn(
        `[Razorpay Checkout] Client COD fee ₹${codFee} differs from configured ₹${configuredCodFee}; using configured amount`
      );
    }

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

    // Checkout with items MUST pre-create a local Order linked to this Razorpay order
    // before the client can pay. Silent pre-create failures cause webhook Path B
    // (recoverOrphanedRazorpayOrder) → Shopify "Unresolved order" placeholders.
    const mustPreCreateLocalOrder =
      !!address && Array.isArray(items) && items.length > 0;

    // ─── Pre-Create or Update Pending Order & WebStoreOrder in Local DB ───
    if (mustPreCreateLocalOrder) {
      try {
        const shop = await prisma.shop.findFirst();
        if (!shop) {
          throw new Error('Shop record not found — cannot pre-create pending order');
        }

        // 1. Save Customer & Address (prefer logged-in session customer)
        const session = await getServerSession(authOptions).catch(() => null);
        const sessionUserId = (session?.user as any)?.id || null;
        const { customer } = await resolveAndSyncCustomerAddress(shop.id, address, sessionUserId);

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
              variantId: normalizeVariantId(item.variantId),
              image: image
            };
          }));

          const fullStreet = [address.houseNo, address.street, address.landmark, address.apartment].filter(Boolean).join(", ");
          const checkoutAddress = { ...address, street: fullStreet || address.street };

          // Reuse pending order for this checkout session (advisory lock vs parallel prefetch)
          const sessionTag = checkoutSessionTag(checkoutSessionId);

          const upsertPending = async (tx: typeof prisma) => {
            let existingPendingOrder: any = null;
            if (sessionTag) {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionTag}))`;
              existingPendingOrder = await tx.order.findFirst({
                where: {
                  status: 'payment_pending',
                  OR: [
                    { tags: { contains: sessionTag } },
                    { tags: { contains: `cs_${sessionTag}` } },
                  ],
                },
                orderBy: { createdAt: 'desc' },
              });
            }

            if (existingPendingOrder) {
              universalOrderNumber = existingPendingOrder.internalOrderNumber;
              const updatedOrder = await tx.order.update({
                where: { id: existingPendingOrder.id },
                data: {
                  totalPrice: calculatedTotal,
                  subtotalPrice: rawSubtotal,
                  shippingAddress: JSON.stringify(checkoutAddress),
                  billingAddress: JSON.stringify(checkoutAddress),
                  razorpayOrderId: rzpOrder.id,
                  paymentMethod: isCodOrder ? "cod" : "razorpay",
                  codUpfrontPaid: isCodOrder ? configuredCodFee : 0,
                  discountCode: finalCouponCode || null,
                  discountAmount: Number(finalCouponDiscount) || 0,
                  storeCreditAmount: Number(rawStoreCredit) || 0,
                  note: rawStoreCredit > 0
                    ? `Order creation in process - ₹${rawStoreCredit} Store Credit applied - Remaining Payment pending`
                    : "Order creation in process - Payment pending",
                }
              });
              localOrderId = updatedOrder.id;

              await tx.orderItem.deleteMany({ where: { orderId: updatedOrder.id } });
              await tx.orderItem.createMany({
                data: resolvedItems.map((item: any) => ({
                  orderId: updatedOrder.id,
                  shopifyLineItemId: item.shopifyLineItemId,
                  productId: item.productId,
                  title: item.title,
                  quantity: Number(item.quantity) || 1,
                  price: item.price,
                  sku: item.sku,
                  variantId: item.variantId ?? null,
                  image: item.image
                }))
              });
              console.log(`[Checkout Razorpay] Refreshed ${resolvedItems.length} OrderItem(s) on pre-created order ${updatedOrder.id}`);

              const existingWsOrder = await tx.webStoreOrder.findFirst({
                where: {
                  orderNumber: universalOrderNumber!,
                  paymentStatus: 'payment_pending',
                }
              });

              if (existingWsOrder) {
                await tx.webStoreOrder.update({
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
                    codUpfrontPaid: isCodOrder ? configuredCodFee : 0,
                  }
                });
              }
              console.log(`[Razorpay Pre-Create] Updated existing pending order ${universalOrderNumber} (${localOrderId}) for session ${sessionTag}`);
              return;
            }

            // Isolate missing-sequence errors so fallback ZBPP… can still insert
            await tx.$executeRawUnsafe('SAVEPOINT zb_pending_seq');
            try {
              universalOrderNumber = await assignFailedOrderNumber(tx as any, { cause: 'pending' });
              await tx.$executeRawUnsafe('RELEASE SAVEPOINT zb_pending_seq');
            } catch (seqErr: any) {
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT zb_pending_seq');
              console.error('[Razorpay Checkout] Failed to generate pending order number:', seqErr.message);
              universalOrderNumber = `ZBPP${Date.now().toString().slice(-8)}`;
            }

            const sessionTagSuffix = sessionTag ? `, ${sessionTag}` : '';
            const localOrder = await tx.order.create({
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
                codUpfrontPaid: isCodOrder ? configuredCodFee : 0,
                paymentCapturedAt: null,
                orderType: "WEB_STORE",
                tags: `WebStoreOrder, Web, ${isCodOrder ? "cod" : "razorpay"}, zb-order-${universalOrderNumber}, payment_pending, Order creation in process${sessionTagSuffix}`,
                note: rawStoreCredit > 0
                  ? `Order creation in process - ₹${rawStoreCredit} Store Credit applied - Remaining Payment pending`
                  : "Order creation in process - Payment pending",
                discountCode: finalCouponCode || null,
                discountAmount: Number(finalCouponDiscount) || 0,
                storeCreditAmount: Number(rawStoreCredit) || 0,
                internalOrderNumber: universalOrderNumber,
                shopifySyncStatus: 'pending',
                shopifySyncError: 'Order pre-created at payment initiation; payment pending',
                items: {
                  create: resolvedItems.map((item: any) => ({
                    shopifyLineItemId: item.shopifyLineItemId,
                    productId: item.productId,
                    title: item.title,
                    quantity: item.quantity,
                    price: item.price,
                    sku: item.sku,
                    variantId: item.variantId ?? null,
                    image: item.image
                  }))
                }
              }
            });

            localOrderId = localOrder.id;

            try {
              await tx.webStoreOrder.create({
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
                  codUpfrontPaid: isCodOrder ? configuredCodFee : 0,
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
          };

          // Always use an interactive transaction so SAVEPOINT / advisory lock are valid
          await prisma.$transaction(async (tx: any) => upsertPending(tx as typeof prisma), {
            maxWait: 10000,
            timeout: 20000,
          });

          if (!localOrderId) {
            throw new Error('Pending order upsert completed without localOrderId');
          }

          // Confirm the paid Razorpay order id is linked before returning to the client
          const linked = await prisma.order.findFirst({
            where: { id: localOrderId, razorpayOrderId: rzpOrder.id },
            select: { id: true },
          });
          if (!linked) {
            throw new Error(`Pending order ${localOrderId} missing razorpayOrderId ${rzpOrder.id}`);
          }
      } catch (dbErr: any) {
        console.error("[Razorpay Pre-Create] FAILED — refusing chargeable order:", dbErr.message);
        return NextResponse.json(
          {
            error: "Could not prepare your order for payment. Please try again.",
            detail: process.env.NODE_ENV === 'development' ? dbErr.message : undefined,
          },
          { status: 500 }
        );
      }
    }

    // Tracking only (no effect on payment/order logic): remember the shopper's
    // Snap click context so a webhook-completed order can still be attributed.
    if (localOrderId) {
      recordSnapPurchaseContext(localOrderId, snapContextFromRequest(req)).catch(() => {});
      // Same for Meta: real browser UA / IP / _fbp / _fbc / external_id for a webhook-sent Purchase.
      recordMetaPurchaseContext(localOrderId, metaContextFromRequest(req)).catch(() => {});
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
      codFee: isCodOrder ? configuredCodFee : 0,
      codUpfrontAmount: isCodOrder ? configuredCodFee : 0,
    });
  } catch (error: any) {
    console.error("[Razorpay] Order creation error:", error);
    return NextResponse.json(
      { error: "Failed to create payment order. Please try again." },
      { status: 500 }
    );
  }
}
