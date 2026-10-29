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
import { resolveWebCoupon } from "@/lib/web-coupon";
import { fetchVariantPrices, variantNumericId } from "@/lib/variant-prices";

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

/** Guest/device cookie used to scope rate limits when nobody is signed in. */
function deviceIdFromCookies(req: Request): string | null {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)zb_device_id=([^;]+)/);
  return m ? decodeURIComponent(m[1]).slice(0, 64) : null;
}

export async function POST(req: Request) {
  // Resolve the shopper once: the rate limit is scoped per customer / device so
  // shoppers behind one carrier (CGNAT) IP do not share a single 30/min bucket,
  // and the same session is reused by the pending-order pre-create below.
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionUserId: string | null = (session?.user as any)?.id || null;
  const limitScope = sessionUserId || deviceIdFromCookies(req) || null;
  const rateLimitResult = await checkRateLimit(req, "checkout-razorpay", {
    maxRequests: 60,
    windowMs: 60_000,
    scope: limitScope,
  });
  if (!rateLimitResult.allowed && rateLimitResult.response) {
    return rateLimitResult.response;
  }
  // Coarse per-IP abuse cap (many shoppers or one script on one IP).
  const ipCap = await checkRateLimit(req, "checkout-razorpay-ip", { maxRequests: 300, windowMs: 60_000, memoryOnly: true });
  if (!ipCap.allowed && ipCap.response) {
    return ipCap.response;
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

    // Coupon amounts are recomputed server-side after the cart is re-priced
    // (lib/web-coupon.ts); the client's couponDiscount is never charged.
    let finalCouponCode: string | null = null;
    let finalCouponDiscount = 0;
    const requestedCouponCode = couponCode ? String(couponCode).trim().toUpperCase() : null;
    void couponDiscount;

    const pmUpper = (paymentMethod || '').toUpperCase().trim();
    const isCodOrder = pmUpper === 'COD' || pmUpper.includes('COD');
    const { isCodAllowedForCountry, resolveCheckoutCountry, COD_INDIA_ONLY_ERROR } = await import('@/lib/cod-availability');
    const checkoutCountry = resolveCheckoutCountry({ displayCountry, currency, address });
    if (isCodOrder && !isCodAllowedForCountry(checkoutCountry)) {
      return NextResponse.json({ error: COD_INDIA_ONLY_ERROR }, { status: 400 });
    }

    // ── Server-side re-pricing (PAYMENT_AUDIT.md P2) ──
    // The Razorpay order used to be created for the client's subtotal; a tampered
    // cart paid ₹2 for ₹2,998 of goods and, when the webhook beat /complete, the
    // Shopify order was created from that snapshot. Unit prices now come from
    // Shopify (cached), converted to the checkout currency the same way the
    // storefront displays them. If the lookup fails the client prices are used
    // but the order is tagged `prices_unverified`, which holds the webhook-first
    // Shopify sync for review until /complete verifies the amounts.
    const currencyCodeForPricing = String(currency || "INR").toUpperCase();
    let toCheckoutCurrency: ((inr: number) => number) | null = null;
    if (currencyCodeForPricing !== "INR") {
      try {
        const { isGlobalStoreEnabled, getCountryConfig, formatPriceWithConfig } = await import("@/lib/global-pricing");
        const enabled = await isGlobalStoreEnabled();
        const cfg = await getCountryConfig(String(displayCountry || "").trim().toUpperCase());
        if (enabled && cfg && !cfg.isBase && String(cfg.currencyCode).toUpperCase() === currencyCodeForPricing) {
          toCheckoutCurrency = (inr: number) => formatPriceWithConfig(inr, cfg, true).amount;
        }
      } catch (fxErr: any) {
        console.warn("[Razorpay Pre-Create] Global pricing config unavailable:", fxErr?.message);
      }
    }
    let pricedItems: any[] = Array.isArray(items) ? items : [];
    let serverSubtotal: number | null = null;
    if (pricedItems.length > 0 && pricedItems.every((it: any) => variantNumericId(it?.variantId))) {
      const canConvert = currencyCodeForPricing === "INR" || Boolean(toCheckoutCurrency);
      if (canConvert) {
        const priceMap = await fetchVariantPrices(pricedItems.map((it: any) => String(it.variantId)), { timeoutMs: 5000 });
        const allPriced = pricedItems.every((it: any) => priceMap.has(variantNumericId(it.variantId)));
        if (allPriced) {
          let sum = 0;
          pricedItems = pricedItems.map((it: any) => {
            const inr = priceMap.get(variantNumericId(it.variantId)) as number;
            const unit = toCheckoutCurrency ? toCheckoutCurrency(inr) : inr;
            sum += unit * (Number(it.quantity) || 1);
            return { ...it, price: String(unit) };
          });
          serverSubtotal = Math.round(sum * 100) / 100;
        }
      }
    }
    const pricesVerified = serverSubtotal !== null;
    const clientSubtotal = Number(subtotal || amount || 0);
    if (pricesVerified && Math.abs((serverSubtotal as number) - clientSubtotal) > 1) {
      console.warn(`[Razorpay Pre-Create] Client subtotal ₹${clientSubtotal} ≠ server ₹${serverSubtotal}; charging the server amount`);
    }
    if (!pricesVerified) {
      console.warn("[Razorpay Pre-Create] Could not verify prices with Shopify; using client prices and tagging prices_unverified");
    }

    const rawSubtotal = pricesVerified ? (serverSubtotal as number) : clientSubtotal;
    const rawShipping = Number(shipping || 0);
    const rawStoreCredit = Number(storeCreditAmount || 0);

    // Coupon: validity + discount from the coupon row, on the server subtotal.
    {
      const couponRes = await resolveWebCoupon({ code: requestedCouponCode, subtotal: rawSubtotal, isCod: isCodOrder });
      finalCouponCode = couponRes.code;
      finalCouponDiscount = couponRes.payableDiscount;
      if (requestedCouponCode && !couponRes.valid) {
        console.warn(`[Razorpay Pre-Create] Coupon ${requestedCouponCode} rejected (${couponRes.reason}); client discount ignored`);
      }
    }

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
      // Capture automatically regardless of the dashboard default (the mobile
      // route already did; an authorized-only web payment stalls as 202 pending).
      payment_capture: 1,
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
        const { customer } = await resolveAndSyncCustomerAddress(shop.id, address, sessionUserId);

          // 2. Resolve Line Items
          const resolvedItems = await Promise.all(pricedItems.map(async (item: any, index: number) => {
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
                  // A row that already recorded a payment attempt on its current
                  // Razorpay order is never re-pointed (the paid order would be lost).
                  razorpayPaymentId: null,
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
                  // The total above is in THIS request's currency, and the Razorpay
                  // order it now points to was created in it. A reused pending order
                  // may have been opened in another currency (the shopper's country
                  // resolved, or was changed, after the first request), so the stored
                  // currency must follow — otherwise the order would read e.g.
                  // "49 INR" for a 49 USD charge (admin, reports, ad conversions).
                  currency: currencyCode,
                  displayCountry: displayCountry || "IN",
                  shippingAddress: JSON.stringify(checkoutAddress),
                  billingAddress: JSON.stringify(checkoutAddress),
                  razorpayOrderId: rzpOrder.id,
                  paymentMethod: isCodOrder ? "cod" : "razorpay",
                  tags: [
                    ...String(existingPendingOrder.tags || '').split(',').map((t: string) => t.trim()).filter((t: string) => t && t !== 'prices_unverified'),
                    ...(pricesVerified ? [] : ['prices_unverified']),
                  ].join(', '),
                  // Never store the fee as "paid" before Razorpay capture
                  codUpfrontPaid: 0,
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
                    items: pricedItems.map((item: any) => ({
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
                    codUpfrontPaid: 0,
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
                codUpfrontPaid: 0,
                paymentCapturedAt: null,
                orderType: "WEB_STORE",
                tags: `WebStoreOrder, Web, ${isCodOrder ? "cod" : "razorpay"}, zb-order-${universalOrderNumber}, payment_pending, Order creation in process${pricesVerified ? '' : ', prices_unverified'}${sessionTagSuffix}`,
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
                  items: pricedItems.map((item: any) => ({
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
                  codUpfrontPaid: 0,
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
