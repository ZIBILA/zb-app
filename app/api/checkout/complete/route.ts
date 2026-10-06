import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/db";
import { createCustomer, updateCustomer } from "@/lib/shopify-admin";
import { syncOrderToShopify } from "@/lib/services/shopifyOrderSyncService";
import { resolveRazorpayCredentials } from "@/lib/razorpay-credentials";
import { sendOrderConfirmationEmail, sendOrderCodConfirmationEmail } from "@/lib/services/orderEmailService";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/options";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveAndSyncCustomerAddress } from "@/lib/services/customerService";
import { debitStoreCredits } from "@/lib/storeCreditsHelper";
import { assignUniversalOrderNumber, isFailedPrefixNumber } from "@/lib/orderNumber";
import { sendCapiEvent } from "@/lib/metaCapi";
import { sendSnapEvent } from '@/lib/snap-capi';
import { sendOpenAiEvent, toMinorUnits } from '@/lib/openai-capi';
import { getConfiguredCodUpfrontAmount } from '@/lib/cod-upfront';

export async function POST(req: Request) {
  const rateLimitResult = await checkRateLimit(req, "checkout-complete", { maxRequests: 30, windowMs: 60_000 });
  if (!rateLimitResult.allowed && rateLimitResult.response) {
    return rateLimitResult.response;
  }
  const requestStartedAt = Date.now();
  // Non-critical work (Shopify sync, analytics, cart cleanup, profile writes) runs
  // AFTER the response is returned so the customer isn't stuck on "Payment successful".
  // Safe on a long-running Node server (Render / next start): the process outlives the request.
  const deferredTasks: Array<{ name: string; run: () => Promise<void> }> = [];
  try {
    const body = await req.json();
    const {
      address,
      paymentMethod = "razorpay",
      items,
      total,
      subtotal,
      codFee,
      razorpay,
      couponCode,
      couponDiscount,
      applyAsStoreCredit,
      cashbackAmount,
      storeCreditAmount = 0,
    } = body;

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
          console.warn(`[Checkout Complete] Stripped PREPAID_ONLY coupon ${finalCouponCode} from COD order`);
          finalCouponCode = null;
          finalCouponDiscount = 0;
        } else if (dbCoupon.applicability === 'COD_ONLY' && !isCodOrder) {
          console.warn(`[Checkout Complete] Stripped COD_ONLY coupon ${finalCouponCode} from prepaid order`);
          finalCouponCode = null;
          finalCouponDiscount = 0;
        } else if (dbCoupon.applicability === 'CUSTOM_RATES') {
          const rateType = isCodOrder ? dbCoupon.codDiscountType : dbCoupon.prepaidDiscountType;
          const rateVal = Number(isCodOrder ? dbCoupon.codDiscountValue : dbCoupon.prepaidDiscountValue);
          const sub = Number(subtotal || 0);
          if (rateType === 'percentage') {
            finalCouponDiscount = Math.round((sub * rateVal) / 100);
          } else {
            finalCouponDiscount = Math.min(rateVal, sub);
          }
          // CUSTOM_RATES with zero COD rate means no discount for COD
          if (isCodOrder && rateVal <= 0) {
            console.warn(`[Checkout Complete] CUSTOM_RATES coupon ${finalCouponCode} has zero COD discount — stripping`);
            finalCouponCode = null;
            finalCouponDiscount = 0;
          }
        }
      }

      // Safety net: strip coupons with "PREPAID" in the code name from COD orders
      if (finalCouponCode && isCodOrder && (finalCouponCode.includes('PREPAID') || /^PREPAID/i.test(finalCouponCode))) {
        console.warn(`[Checkout Complete] Safety-net stripped prepaid-named coupon ${finalCouponCode} from COD order`);
        finalCouponCode = null;
        finalCouponDiscount = 0;
      }
    }

    const parsedStoreCredit = Number(storeCreditAmount) || 0;

    // Item #25: Store coins can only be redeemed through the mobile app
    if (parsedStoreCredit > 0 || paymentMethod === "store_credit" || paymentMethod === "STORE_CREDIT") {
      return NextResponse.json(
        {
          error: "Store coins can only be redeemed through the Zica Bella mobile app. Please open or download the app to redeem your coins.",
          appDownloadUrl: "/app"
        },
        { status: 400 }
      );
    }

    // Resolve COD upfront fee from dashboard config only — never trust client-supplied codFee
    // (Razorpay create-order also charges this same server value).
    const configuredCodFee = isCodOrder ? await getConfiguredCodUpfrontAmount() : 0;
    const resolvedCodFee = configuredCodFee;

    const shop = await prisma.shop.findFirst();
    if (!shop) {
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }

    // ── P0-11: Server-side price recomputation ─────────────────────────
    // Never trust client-supplied subtotal/total. Recompute from authoritative variant prices.
    let serverSubtotal = 0;
    let priceVerified = false;
    let authoritativeTotal = Math.max(0, Number(total || 0));
    let authoritativeSubtotal = Math.max(0, Number(subtotal || 0));
    let paymentUnderpaid = false;
    let capturedRupees: number | null = null;
    try {
      const variantIds = items
        .map((item: any) => {
          if (!item.variantId) return null;
          const rawId = String(item.variantId).split('/').pop() || '';
          return rawId;
        })
        .filter(Boolean);

      if (variantIds.length > 0 && variantIds.length === items.length) {
        // Batch fetch variant prices from Shopify Admin API
        const { shopifyFetch, adminUrl: buildAdminUrl } = await import('@/lib/shopify-admin');
        const variantPriceMap = new Map<string, number>();

        // Fetch variants in batches (Shopify supports comma-separated IDs)
        const batchSize = 50;
        for (let i = 0; i < variantIds.length; i += batchSize) {
          const batch = variantIds.slice(i, i + batchSize);
          try {
            const data = await shopifyFetch<{ variants: Array<{ id: number; price: string }> }>(
              `variants.json`,
              { ids: batch.join(','), fields: 'id,price' }
            );
            if (data?.variants) {
              for (const v of data.variants) {
                variantPriceMap.set(String(v.id), parseFloat(v.price));
              }
            }
          } catch (fetchErr) {
            console.warn('[Checkout] Variant price fetch batch failed:', fetchErr);
          }
        }

        if (variantPriceMap.size > 0) {
          serverSubtotal = 0;
          for (const item of items) {
            const rawId = String(item.variantId).split('/').pop() || '';
            const authoritative = variantPriceMap.get(rawId);
            if (authoritative !== undefined) {
              serverSubtotal += authoritative * (item.quantity || 1);
            } else {
              // Variant not found in Shopify — fall back to client price with a warning
              console.warn(`[Checkout] Variant ${rawId} not found in Shopify; using client price ₹${item.price}`);
              serverSubtotal += parseFloat(item.price || '0') * (item.quantity || 1);
            }
          }
          serverSubtotal = Math.round(serverSubtotal * 100) / 100;
          priceVerified = true;
        }
      }
    } catch (priceErr) {
      console.warn('[Checkout] Server-side price verification failed; proceeding with client values:', priceErr);
    }

    // If verified, derive server total and compare
    if (priceVerified) {
      // Webstore COD upfront is an advance deposit deducted from total (not added on top).
      // Mobile historically added fee to total — still tolerate that within ₹1.
      const serverCodFee = isCodOrder ? resolvedCodFee : 0;
      const baseServerTotal = Math.max(0, serverSubtotal - Number(finalCouponDiscount || 0) - parsedStoreCredit);
      const serverTotalWithFee = baseServerTotal + serverCodFee;
      const clientTotal = Number(total || 0);

      const isMatch = Math.abs(baseServerTotal - clientTotal) <= 1 || (isCodOrder && Math.abs(serverTotalWithFee - clientTotal) <= 1);

      if (!isMatch) {
        console.error(`[Checkout] Price mismatch! ServerBase: ₹${baseServerTotal}, ServerWithFee: ₹${serverTotalWithFee}, Client: ₹${clientTotal}, ServerSubtotal: ₹${serverSubtotal}`);
        // If Razorpay already returned a payment id, money may already be captured —
        // never 400 the customer into a "paid but no order" dead-end. Force server totals.
        if (razorpay?.razorpay_payment_id) {
          console.error(`[Checkout] Proceeding despite mismatch because payment ${razorpay.razorpay_payment_id} was returned by gateway — using server totals`);
          authoritativeSubtotal = serverSubtotal;
          authoritativeTotal = baseServerTotal;
        } else {
          return NextResponse.json(
            { error: 'Cart total mismatch. Please refresh and retry.' },
            { status: 400 }
          );
        }
      } else {
        authoritativeSubtotal = serverSubtotal;
        authoritativeTotal = baseServerTotal;
      }
    }

    const isFullStoreCredit = paymentMethod === "store_credit" || paymentMethod === "STORE_CREDIT" || Number(total) === 0;


    // 1. Verify Payment (Required for prepaid and COD upfront fee, unless 100% store credit)
    if (!isFullStoreCredit) {
      if (paymentMethod !== "COD" || razorpay) {
        if (!razorpay || !razorpay.razorpay_order_id || !razorpay.razorpay_payment_id || !razorpay.razorpay_signature) {
          return NextResponse.json({ error: "Payment details missing" }, { status: 400 });
        }

        // Accept mock payments ONLY in non-production with explicit opt-in
        const isMock =
          process.env.NODE_ENV !== 'production' &&
          process.env.ALLOW_MOCK_PAYMENTS === 'true' &&
          (razorpay.razorpay_order_id.startsWith('order_mock_') ||
           razorpay.razorpay_signature === 'mock_sig_valid');

        if (!isMock) {
          let secret: string;
          try {
            secret = (await resolveRazorpayCredentials()).key_secret;
          } catch {
            return NextResponse.json({ error: "Payment verification not configured" }, { status: 500 });
          }

          const generated_signature = crypto
            .createHmac("sha256", secret)
            .update(razorpay.razorpay_order_id + "|" + razorpay.razorpay_payment_id)
            .digest("hex");

          try {
            const sigBuffer = Buffer.from(razorpay.razorpay_signature, "utf-8");
            const genBuffer = Buffer.from(generated_signature, "utf-8");
            if (sigBuffer.length !== genBuffer.length || !crypto.timingSafeEqual(sigBuffer, genBuffer)) {
              console.error("[Razorpay] Signature mismatch for order:", razorpay.razorpay_order_id);
              return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
            }
          } catch {
            console.error("[Razorpay] Signature verification error");
            return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
          }

          // Confirm captured amount matches what we should have charged (COD fee or full prepaid total).
          try {
            const creds = await resolveRazorpayCredentials();
            const { fetchCapturedPayment } = await import('@/lib/razorpay-payment');
            const payment = await fetchCapturedPayment(razorpay.razorpay_payment_id, {
              key_id: creds.key_id,
              key_secret: creds.key_secret,
            });
            capturedRupees = Number(payment.amount) / 100;
            const expectedCharge = isCodOrder ? resolvedCodFee : authoritativeTotal;
            if (Number.isFinite(capturedRupees) && capturedRupees + 1 < expectedCharge) {
              paymentUnderpaid = true;
              console.error(
                `[Checkout] Underpayment: captured ₹${capturedRupees} < expected ₹${expectedCharge} (payment ${razorpay.razorpay_payment_id})`
              );
            }
          } catch (amtErr: any) {
            console.warn('[Checkout] Could not verify Razorpay captured amount:', amtErr?.message || amtErr);
          }
        } else {
          console.warn('[Checkout] Accepting MOCK payment for testing');
        }
      } else {
        return NextResponse.json({ error: "COD upfront payment details missing" }, { status: 400 });
      }
    }

    // 2. Find/Sync Customer & Address using customerService
    const session = await getServerSession(authOptions);
    const sessionUserId = (session?.user as any)?.id || null;
    const { customer: localCustomer, normalizedAddress } = await resolveAndSyncCustomerAddress(shop.id, address, sessionUserId);

    // Duplicate account check and merge
    if (address.phone) {
      const duplicateCustomer = await prisma.customer.findFirst({
        where: {
          phone: address.phone,
          id: { not: localCustomer.id }
        }
      });

      if (duplicateCustomer) {
        console.log(`[Checkout Merge] Merging duplicate customer account: ${duplicateCustomer.id} -> ${localCustomer.id}`);
        try {
          await prisma.$transaction([
            prisma.order.updateMany({
              where: { customerId: duplicateCustomer.id },
              data: { customerId: localCustomer.id }
            }),
            prisma.address.updateMany({
              where: { customerId: duplicateCustomer.id },
              data: { customerId: localCustomer.id }
            }),
            prisma.return.updateMany({
              where: { customerId: duplicateCustomer.id },
              data: { customerId: localCustomer.id }
            }),
            prisma.returnRequest.updateMany({
              where: { customerId: duplicateCustomer.id },
              data: { customerId: localCustomer.id }
            }),
            prisma.exchangeRequest.updateMany({
              where: { customerId: duplicateCustomer.id },
              data: { customerId: localCustomer.id }
            }),
            prisma.payment.updateMany({
              where: { customerId: duplicateCustomer.id },
              data: { customerId: localCustomer.id }
            }),
            prisma.profileHistory.updateMany({
              where: { customerId: duplicateCustomer.id },
              data: { customerId: localCustomer.id }
            }),
            prisma.mobileOrder.updateMany({
              where: { customerId: duplicateCustomer.id },
              data: { customerId: localCustomer.id }
            }),
            prisma.communityMessage.updateMany({
              where: { customerId: duplicateCustomer.id },
              data: { customerId: localCustomer.id }
            }),
            prisma.cart.deleteMany({
              where: { customerId: duplicateCustomer.id }
            }),
            prisma.follow.deleteMany({
              where: {
                OR: [
                  { followerId: duplicateCustomer.id },
                  { followingId: duplicateCustomer.id }
                ]
              }
            })
          ]);

          const dupWishlist = await prisma.wishlist.findMany({
            where: { customerId: duplicateCustomer.id }
          });
          for (const item of dupWishlist) {
            try {
              await prisma.wishlist.update({
                where: { id: item.id },
                data: { customerId: localCustomer.id }
              });
            } catch {
              await prisma.wishlist.delete({
                where: { id: item.id }
              });
            }
          }

          const dupCommunity = await prisma.communityMember.findUnique({
            where: { customerId: duplicateCustomer.id }
          });
          if (dupCommunity) {
            const primCommunity = await prisma.communityMember.findUnique({
              where: { customerId: localCustomer.id }
            });
            if (!primCommunity) {
              await prisma.communityMember.update({
                where: { id: dupCommunity.id },
                data: { customerId: localCustomer.id }
              });
            } else {
              await prisma.communityMember.delete({
                where: { id: dupCommunity.id }
              });
            }
          }

          await prisma.customer.delete({
            where: { id: duplicateCustomer.id }
          });
          console.log(`[Checkout Merge] Merging completed successfully.`);
        } catch (mergeErr: any) {
          console.error("[Checkout Merge] Error occurred during account merge:", mergeErr);
        }
      }
    }

    // Sync with Shopify if needed
    let shopifyCustomerId = localCustomer.shopifyId;
    if (shopifyCustomerId.startsWith('temp_') || shopifyCustomerId.startsWith('google_') || shopifyCustomerId.startsWith('apple_')) {
      try {
        const hasValidEmail = Boolean(address.email && String(address.email).includes('@'));
        const sCustomer = await createCustomer({
          first_name: address.name.split(' ')[0],
          last_name: address.name.split(' ').slice(1).join(' ') || '.',
          email: hasValidEmail ? address.email : undefined,
          phone: address.phone,
          verified_email: hasValidEmail,
          addresses: [{
            address1: address.street,
            city: address.city,
            province: address.state,
            zip: address.zip,
            country: address.country,
            default: true
          }]
        });
        shopifyCustomerId = sCustomer.id.toString();
        await prisma.customer.update({
          where: { id: localCustomer.id },
          data: { shopifyId: shopifyCustomerId }
        });
      } catch (e) {
        console.error("Shopify Customer Sync Error:", e);
      }
    }

    // ─── BUG 1 FIX: Determine final order number BEFORE Shopify creation ───
    // Look up any pre-created order FIRST so we can reuse its number if it
    // already has a real ZB number, avoiding the Shopify/DB divergence bug.
    const rzpOrderId = razorpay?.razorpay_order_id;
    let existingPreCreatedOrder: any = null;
    if (rzpOrderId || body.localOrderId) {
      existingPreCreatedOrder = await prisma.order.findFirst({
        where: {
          OR: [
            ...(rzpOrderId ? [{ razorpayOrderId: rzpOrderId }] : []),
            ...(body.localOrderId ? [{ id: body.localOrderId }] : [])
          ]
        }
      });
    }

    // Determine the final universalOrderNumber based on pre-created order state
    let universalOrderNumber = '';
    let preCreatedWasPromoted = false;
    if (existingPreCreatedOrder) {
      const oldNumber = existingPreCreatedOrder.internalOrderNumber;
      if (oldNumber && !isFailedPrefixNumber(oldNumber)) {
        // Pre-created order already has a real ZB number → reuse it, do NOT mint
        universalOrderNumber = oldNumber;
        console.log(`[Checkout Complete] Reusing existing real order number: ${universalOrderNumber}`);
      } else if (isFailedPrefixNumber(oldNumber)) {
        // Pre-created order has a failed-prefix number → mint a new real number and promote NOW
        let mintedNumber = '';
        try {
          mintedNumber = await assignUniversalOrderNumber(prisma);
        } catch (seqErr: any) {
          console.error('[Checkout] Failed to generate universal order number:', seqErr.message);
          mintedNumber = `ZB${Date.now().toString().slice(-8)}`;
        }
        // Promote the pre-created order's number before Shopify creation using atomic updateMany
        const previousNumbers = [existingPreCreatedOrder.previousOrderNumbers, oldNumber].filter(Boolean).join(',');
        const promoted = await prisma.order.updateMany({
          where: {
            id: existingPreCreatedOrder.id,
            internalOrderNumber: oldNumber,
          },
          data: {
            internalOrderNumber: mintedNumber,
            previousOrderNumbers: previousNumbers || null,
          }
        });

        if (promoted.count === 0) {
          // Another concurrent process (e.g. Razorpay webhook) already promoted this order!
          const fresh = await prisma.order.findUnique({
            where: { id: existingPreCreatedOrder.id },
            select: { internalOrderNumber: true }
          });
          if (fresh?.internalOrderNumber && !isFailedPrefixNumber(fresh.internalOrderNumber)) {
            universalOrderNumber = fresh.internalOrderNumber;
            console.log(`[Checkout Complete] Concurrent promotion detected; adopted winner number: ${universalOrderNumber}`);
          } else {
            universalOrderNumber = mintedNumber;
          }
        } else {
          universalOrderNumber = mintedNumber;
          // Keep WebStoreOrder & MobileOrder in lockstep with the promoted number
          await prisma.webStoreOrder.updateMany({
            where: { orderNumber: oldNumber },
            data: { orderNumber: universalOrderNumber },
          });
          await prisma.mobileOrder.updateMany({
            where: { orderNumber: oldNumber },
            data: { orderNumber: universalOrderNumber },
          });
          preCreatedWasPromoted = true;
          console.log(`[Checkout Complete] Pre-promoted order ${oldNumber} → ${universalOrderNumber}`);
        }
      } else {
        // Pre-created order exists but has no number at all → mint a new one
        try {
          universalOrderNumber = await assignUniversalOrderNumber(prisma);
        } catch (seqErr: any) {
          console.error('[Checkout] Failed to generate universal order number:', seqErr.message);
          universalOrderNumber = `ZB${Date.now().toString().slice(-8)}`;
        }
      }
    } else {
      // No pre-created order → mint a fresh number
      try {
        universalOrderNumber = await assignUniversalOrderNumber(prisma);
      } catch (seqErr: any) {
        console.error('[Checkout] Failed to generate universal order number:', seqErr.message);
        universalOrderNumber = `ZB${Date.now().toString().slice(-8)}`;
      }
    }

    // Resolve products from DB
    const resolvedItems = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      let dbProductId = null;
      let image = item.image || null;
      if (item.productId) {
        const cleanId = String(item.productId);
        const byShopifyId = await prisma.product.findUnique({
          where: { shopifyProductId: cleanId }
        });
        if (byShopifyId) {
          dbProductId = byShopifyId.id;
          if (!image) image = byShopifyId.featuredImage;
        } else {
          const byCuid = await prisma.product.findUnique({
            where: { id: cleanId }
          });
          if (byCuid) {
            dbProductId = byCuid.id;
            if (!image) image = byCuid.featuredImage;
          }
        }
      }
      resolvedItems.push({
        shopifyLineItemId: `web_${Date.now()}_${index}_${item.productId || item.variantId || 'item'}`,
        productId: dbProductId,
        title: item.title,
        quantity: item.quantity,
        price: parseFloat(item.price || '0'),
        sku: item.variantId || item.productId || null,
        image: image
      });
    }

    // 4. Update existing pre-created Order OR Create Order in local DB
    if (existingPreCreatedOrder) {
      // Race-condition guard: re-read the order to detect if another process
      // (e.g. Razorpay webhook) already assigned a different real number
      const freshOrder = await prisma.order.findUnique({
        where: { id: existingPreCreatedOrder.id }
      });
      if (freshOrder && freshOrder.internalOrderNumber && !isFailedPrefixNumber(freshOrder.internalOrderNumber)) {
        const adoptedNumber = freshOrder.internalOrderNumber;
        if (adoptedNumber !== universalOrderNumber) {
          const oldPrefixNumber = existingPreCreatedOrder.internalOrderNumber;
          if (oldPrefixNumber && isFailedPrefixNumber(oldPrefixNumber)) {
            await prisma.webStoreOrder.updateMany({
              where: { orderNumber: oldPrefixNumber },
              data: { orderNumber: adoptedNumber },
            });
            await prisma.mobileOrder.updateMany({
              where: { orderNumber: oldPrefixNumber },
              data: { orderNumber: adoptedNumber },
            });
          }
        }
        universalOrderNumber = adoptedNumber;
      }
    }

    let localOrder: any = null;
    const finalPaymentMethod = isFullStoreCredit ? "store_credit" : isCodOrder ? "cod" : "razorpay";
    const orderPaymentStatus = isFullStoreCredit
      ? "paid"
      : isCodOrder
        ? "cod_upfront_paid"
        : paymentUnderpaid
          ? "partially_paid"
          : "paid";
    const orderTotalPrice = priceVerified
      ? authoritativeTotal
      : Math.max(0, Number(subtotal || total || 0) - Number(finalCouponDiscount || 0) - parsedStoreCredit);
    const orderSubtotalPrice = priceVerified ? authoritativeSubtotal : Number(subtotal || 0);
    const underpayNote = paymentUnderpaid && capturedRupees != null
      ? ` | UNDERPAID: captured ₹${capturedRupees} vs expected ₹${isCodOrder ? resolvedCodFee : orderTotalPrice}`
      : '';

    if (existingPreCreatedOrder) {
      // Recalculate correct total: prefer server-verified totals when available
      const correctedTotal = orderTotalPrice;

      const wasRazorpayRecovery =
        (existingPreCreatedOrder.tags || '').includes('RazorpayRecovery') ||
        existingPreCreatedOrder.shopifySyncStatus === 'needs_review' ||
        (existingPreCreatedOrder.shopifySyncError || '').includes('pending manual');

      const updateData: any = {
        status: isCodOrder ? "open" : "approved",
        paymentStatus: orderPaymentStatus,
        razorpayPaymentId: razorpay?.razorpay_payment_id || null,
        paymentCapturedAt: (razorpay || isFullStoreCredit) ? new Date() : null,
        paymentMethod: finalPaymentMethod,
        storeCreditAmount: parsedStoreCredit,
        totalPrice: correctedTotal,
        subtotalPrice: orderSubtotalPrice,
        discountCode: finalCouponCode || null,
        discountAmount: Number(finalCouponDiscount) || 0,
        paymentFailureReason: null,
        codUpfrontPaid: isCodOrder ? resolvedCodFee : 0,
        codUpfrontPaymentId: isCodOrder ? (razorpay?.razorpay_payment_id || null) : null,
        tags: `WebStoreOrder, Web, ${finalPaymentMethod}, zb-order-${universalOrderNumber}`,
        note: isFullStoreCredit
          ? `Paid 100% via Store Credit (₹${parsedStoreCredit}) from Web Store`
          : isCodOrder
          ? `COD Order from Web Store ${parsedStoreCredit > 0 ? `(₹${parsedStoreCredit} Store Credit applied)` : ''} - ₹${resolvedCodFee} upfront fee paid via Razorpay${underpayNote}`
          : `Paid via Razorpay ${parsedStoreCredit > 0 ? `+ ₹${parsedStoreCredit} Store Credit` : ''} from Web Store (Payment ID: ${razorpay?.razorpay_payment_id || 'N/A'})${underpayNote}`,
        internalOrderNumber: universalOrderNumber,
        customerId: localCustomer.id,
        // Always refresh address on complete — pre-create may have been sparse / stale
        shippingAddress: JSON.stringify(normalizedAddress || address),
        billingAddress: JSON.stringify(normalizedAddress || address),
        // Clear recovery hold so Shopify sync can run with real items/address
        shopifySyncStatus: 'pending',
        shopifySyncError: null,
      };

      localOrder = await prisma.order.update({
        where: { id: existingPreCreatedOrder.id },
        data: updateData,
      });

      // Always replace line items from the verified checkout payload.
      // Pre-create refresh used to call a non-existent prisma.lineItem model, so
      // stale quantities (e.g. qty 2) could survive while totals/Razorpay charged qty 1.
      await prisma.orderItem.deleteMany({ where: { orderId: localOrder.id } });
      await prisma.orderItem.createMany({
        data: resolvedItems.map((item: any) => ({
          orderId: localOrder.id,
          shopifyLineItemId: item.shopifyLineItemId,
          productId: item.productId,
          title: item.title,
          quantity: Number(item.quantity) || 1,
          price: item.price,
          sku: item.sku,
          image: item.image,
        })),
      });
      console.log(`[Checkout Complete] Updated pre-created order ${localOrder.id} (${universalOrderNumber}) + refreshed ${resolvedItems.length} item(s)`);

      // If a recovery placeholder already synced to Shopify, cancel it and clear the
      // link so the choke-point below can create the real order.
      if (
        wasRazorpayRecovery &&
        localOrder.shopifyOrderId &&
        /^\d+$/.test(String(localOrder.shopifyOrderId))
      ) {
        try {
          const { cancelOrder } = await import('@/lib/shopify-admin');
          await cancelOrder(String(localOrder.shopifyOrderId), 'other');
          console.warn(
            `[Checkout Complete] Cancelled recovery Shopify order ${localOrder.shopifyOrderId} for ${localOrder.id}`
          );
        } catch (cancelErr: any) {
          console.error(
            `[Checkout Complete] Could not cancel recovery Shopify order ${localOrder.shopifyOrderId}:`,
            cancelErr?.message
          );
        }
        localOrder = await prisma.order.update({
          where: { id: localOrder.id },
          data: {
            shopifyOrderId: null,
            shopifyOrderName: null,
            shopifySyncStatus: 'pending',
            shopifySyncError: 'Cleared recovery Shopify placeholder for re-sync',
          },
        });
      }
    } else {
      localOrder = await prisma.order.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: null,
          customerId: localCustomer.id,
          status: isCodOrder ? "open" : "approved",
          totalPrice: orderTotalPrice,
          subtotalPrice: orderSubtotalPrice,
          currency: body.currency || "INR",
          displayCountry: body.displayCountry || "IN",
          paymentStatus: orderPaymentStatus,
          fulfillmentStatus: "unfulfilled",
          deliveryStatus: "pending",
          shippingAddress: JSON.stringify(normalizedAddress || address),
          billingAddress: JSON.stringify(normalizedAddress || address),
          razorpayOrderId: razorpay?.razorpay_order_id || null,
          razorpayPaymentId: razorpay?.razorpay_payment_id || null,
          paymentMethod: finalPaymentMethod,
          codUpfrontPaid: isCodOrder ? resolvedCodFee : 0,
          codUpfrontPaymentId: isCodOrder ? (razorpay?.razorpay_payment_id || null) : null,
          storeCreditAmount: parsedStoreCredit,
          paymentCapturedAt: (razorpay || isFullStoreCredit) ? new Date() : null,
          orderType: "WEB_STORE",
          tags: `WebStoreOrder, Web, ${finalPaymentMethod}, zb-order-${universalOrderNumber}`,
          discountCode: finalCouponCode || null,
          discountAmount: Number(finalCouponDiscount) || 0,
          internalOrderNumber: universalOrderNumber,
          shopifySyncStatus: 'pending',
          shopifySyncError: null,
          note: underpayNote
            ? `Web checkout${underpayNote}`
            : undefined,
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
    }

    // ─── ONE AND ONLY ONE SHOPIFY-CREATE CHOKE POINT (FIX 1) ───
    // Deferred: syncOrderToShopify is idempotent (atomic claim + Shopify idempotency key) and is
    // also retried by the Razorpay webhook / recovery jobs, so it must not block the customer.
    // Runs after the WebStoreOrder upsert below, and updates that row's notes itself.
    const localOrderIdForSync = localOrder.id;
    deferredTasks.push({
      name: 'shopify-order-sync',
      run: async () => {
        try {
          await syncOrderToShopify(localOrderIdForSync);
        } catch (syncErr: any) {
          console.error('[Checkout Complete] Shopify order sync error (will be retried):', syncErr.message);
        }
      },
    });

    // ─── AUTO-SHIPMENT DISABLED ───────────────────────────────────────────────
    // Shiprocket AWB is no longer auto-assigned on checkout completion.
    // The operations team must open the order in the Zica Bella dashboard,
    // enter the actual parcel weight and box dimensions, fetch available couriers,
    // select the preferred courier, and then click "Generate Shipment / AWB".
    // This gives full control over courier selection and avoids weight mismatches.
    console.log(`[Checkout Complete] Skipping auto-shipment for ${localOrder.id} — manual AWB required from dashboard.`);

    // ─── AFFILIATE / CREATOR ATTRIBUTION (deferred; non-fatal) ───
    {
      const attributionOrderId = localOrder.id;
      deferredTasks.push({
        name: 'affiliate-attribution',
        run: async () => {
          try {
            const { attributeOrder } = await import('@/lib/affiliate/attribution');
            await attributeOrder({ orderId: attributionOrderId, req });
          } catch (affErr: any) {
            console.warn('[Checkout Complete] Affiliate attribution failed non-fatally:', affErr.message);
          }
        },
      });
    }

    // ─── DEBIT STORE CREDITS FROM CUSTOMER WALLET ───
    if (parsedStoreCredit > 0) {
      try {
        await debitStoreCredits(localCustomer.id, parsedStoreCredit, localOrder.id);
        console.log(`[Checkout Complete] Successfully debited ₹${parsedStoreCredit} store credit for order ${localOrder.id}`);
      } catch (storeCreditDebitErr: any) {
        console.error(`[Checkout Complete] Error debiting store credit for customer ${localCustomer.id}:`, storeCreditDebitErr.message);
      }
    }

    // ─── Authoritative server-side Meta CAPI Purchase (Item #30) ───
    // Fires promptly and accurately when the order is confirmed, preserving campaign
    // attribution (_fbp, _fbc) and permitted customer matching data.
    // Uses eventId = localOrder.id to match the browser pixel's Purchase event for deduplication.
    const resolvedOrderCurrency = (body.currency || 'INR').toUpperCase();
    try {
      const cookieHeader = req.headers.get('cookie') || '';
      const parseCookie = (name: string): string | undefined => {
        const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : undefined;
      };

      const fbp = body.fbp || parseCookie('_fbp');
      const fbc = body.fbc || parseCookie('_fbc');
      const externalId = body.externalId || parseCookie('zb_external_id') || localCustomer.id;
      const clientIp = req.headers.get('do-connecting-ip')
        || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
        || req.headers.get('x-real-ip')
        || parseCookie('zb_client_ip')
        || undefined;

      const toMetaItemId = (item: any): string => {
        const raw = item.variantId || item.sku || item.productId || '';
        const s = String(raw);
        const stripped = s.startsWith('variant:') ? s.slice(8) : s;
        const m = stripped.match(/(\d+)\s*$/);
        return m ? m[1] : stripped;
      };
      const metaContentIds = items.map(toMetaItemId);
      const metaContents = items.map((item: any, idx: number) => ({
        id: metaContentIds[idx],
        quantity: item.quantity || 1,
        item_price: parseFloat(item.price || '0'),
        title: item.title,
      }));

      sendCapiEvent({
        eventName: 'Purchase',
        eventId: localOrder.id,
        eventTime: Math.floor(Date.now() / 1000),
        eventSourceUrl: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com'}/orders/${localOrder.id}/confirmation`,
        userAgent: req.headers.get('user-agent') || '',
        actionSource: 'website',
        userData: {
          client_ip_address: clientIp,
          client_user_agent: req.headers.get('user-agent') || undefined,
          fbp: fbp || undefined,
          fbc: fbc || undefined,
          external_id: externalId || undefined,
          em: address.email || undefined,
          ph: address.phone || undefined,
          fn: address.name?.trim().split(/\s+/)[0] || undefined,
          ln: address.name?.trim().split(/\s+/).slice(1).join(' ') || undefined,
          ct: address.city || undefined,
          st: address.state || undefined,
          zp: address.zip || undefined,
          country: address.country || undefined,
        },
        customData: {
          value: Number(orderTotalPrice || total || 0),
          currency: resolvedOrderCurrency,
          order_id: localOrder.id,
          content_type: 'product',
          content_ids: metaContentIds,
          contents: metaContents,
          num_items: items.reduce((sum: number, it: any) => sum + (it.quantity || 1), 0),
        },
      }).catch((capiErr: any) => {
        console.error('[Checkout Complete] Meta CAPI Purchase fire error:', capiErr?.message || capiErr);
      });
    } catch (metaErr: any) {
      console.warn('[Checkout Complete] Meta CAPI Purchase dispatch failed:', metaErr.message);
    }

    // ─── FIX 3: Authoritative server-side Snap CAPI Purchase ───
    // Fires exactly once when payment is verified, regardless of whether the
    // browser reaches the confirmation page. Uses eventId = localOrder.id to
    // match the browser pixel's Purchase event for Snap deduplication.
    try {
      const toSnapItemId = (item: any): string => {
        const raw = item.variantId || item.sku || item.productId || '';
        const s = String(raw);
        const stripped = s.startsWith('variant:') ? s.slice(8) : s;
        const m = stripped.match(/(\d+)\s*$/);
        return m ? m[1] : stripped;
      };
      const snapItemIds = items.map(toSnapItemId);

      sendSnapEvent({
        eventName: 'PURCHASE',
        eventId: localOrder.id,
        eventSourceUrl: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com'}/orders/${localOrder.id}/confirmation`,
        userAgent: req.headers.get('user-agent') || '',
        ipAddress: req.headers.get('do-connecting-ip')
          || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
          || req.headers.get('x-real-ip') || undefined,
        userData: {
          em: address.email || undefined,
          ph: address.phone || undefined,
          fn: address.name?.trim().split(/\s+/)[0] || undefined,
          ln: address.name?.trim().split(/\s+/).slice(1).join(' ') || undefined,
          ct: address.city || undefined,
          st: address.state || undefined,
          zp: address.zip || undefined,
          country: address.country || undefined,
        },
        customData: {
          price: Number(total || 0),
          currency: resolvedOrderCurrency,
          item_ids: snapItemIds,
          transaction_id: localOrder.id,
          number_items: items.length || 1,
        },
      }).catch(() => {}); // fire-and-forget; never block order response
    } catch (snapErr: any) {
      console.warn('[Checkout Complete] Snap CAPI Purchase fire failed:', snapErr.message);
    }

    // ─── Authoritative server-side OpenAI Ads order_created ───
    // Same dedup pattern: id = localOrder.id matches browser pixel event_id.
    try {
      const openAiContents = items.map((item: any) => {
        const raw = item.variantId || item.sku || item.productId || '';
        const s = String(raw);
        const stripped = s.startsWith('variant:') ? s.slice(8) : s;
        const m = stripped.match(/(\d+)\s*$/);
        const itemId = m ? m[1] : stripped;
        return {
          id: itemId,
          name: item.title,
          content_type: 'product' as const,
          quantity: item.quantity || 1,
          amount: toMinorUnits(parseFloat(item.price || '0'), resolvedOrderCurrency),
          currency: resolvedOrderCurrency,
        };
      });

      sendOpenAiEvent({
        eventName: 'order_created',
        eventId: localOrder.id,
        eventSourceUrl: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com'}/orders/${localOrder.id}/confirmation`,
        userAgent: req.headers.get('user-agent') || '',
        ipAddress: req.headers.get('do-connecting-ip')
          || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
          || req.headers.get('x-real-ip') || undefined,
        userData: {
          em: address.email || undefined,
          ph: address.phone || undefined,
          fn: address.name?.trim().split(/\s+/)[0] || undefined,
          ln: address.name?.trim().split(/\s+/).slice(1).join(' ') || undefined,
          ct: address.city || undefined,
          st: address.state || undefined,
          zp: address.zip || undefined,
          country: address.country || undefined,
        },
        data: {
          type: 'contents',
          amount: toMinorUnits(Number(total || 0), resolvedOrderCurrency),
          currency: resolvedOrderCurrency,
          contents: openAiContents,
        },
      }).catch(() => {}); // fire-and-forget; never block order response
    } catch (oaiErr: any) {
      console.warn('[Checkout Complete] OpenAI CAPI order_created fire failed:', oaiErr.message);
    }

    // Record purchase event in analytics (deferred; non-fatal)
    deferredTasks.push({
      name: 'analytics-purchase-event',
      run: async () => {
        try {
          await prisma.analyticsEvent.create({
            data: {
              eventId: `purchase_${localOrder.id}`,
              eventName: 'purchase',
              customerId: localCustomer.id,
              anonymousId: body.guestId || null,
              sessionId: null,
              platform: 'web',
              orderId: localOrder.id,
              value: total,
              currency: localOrder.currency || body.currency || 'INR',
              quantity: items.reduce((sum: number, i: any) => sum + (i.quantity || 1), 0),
              pageUrl: '/checkout/complete',
              metadata: {
                paymentMethod: finalPaymentMethod,
                orderNumber: universalOrderNumber,
                couponCode: finalCouponCode || null,
                discountAmount: Number(finalCouponDiscount) || 0,
                storeCreditAmount: parsedStoreCredit,
              },
            },
          });
        } catch (analyticsErr: any) {
          if (analyticsErr.code !== 'P2002') {
            console.warn('[Checkout Analytics] Failed to record purchase event:', analyticsErr.message);
          }
        }
      },
    });

    // Mark active or abandoned cart converted (deferred; non-fatal)
    deferredTasks.push({
      name: 'cart-converted',
      run: async () => {
        try {
          const cleanPhone = address.phone ? address.phone.replace(/\D/g, "") : null;
          const last10Phone = cleanPhone && cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
          const rawCartId = body.cartId || body.cart_id;

          const matchingCarts = await prisma.cart.findMany({
            where: {
              convertedOrderId: null,
              status: { notIn: ["converted"] },
              OR: [
                ...(rawCartId ? [{ id: rawCartId }, { sessionToken: rawCartId }] : []),
                ...(body.guestId ? [{ sessionToken: body.guestId }] : []),
                ...(localCustomer?.id ? [{ customerId: localCustomer.id }] : []),
                ...(address.phone ? [{ phone: address.phone }] : []),
                ...(last10Phone ? [{ phone: { contains: last10Phone } }] : []),
                ...(address.email ? [{ email: { equals: address.email, mode: "insensitive" as const } }] : [])
              ]
            },
            orderBy: { lastActivityAt: "desc" }
          });

          if (matchingCarts.length > 0) {
            const primaryCart = matchingCarts[0];
            await prisma.cart.update({
              where: { id: primaryCart.id },
              data: {
                status: "converted",
                convertedOrderId: localOrder.id
              }
            });

            if (matchingCarts.length > 1) {
              const extraCartIds = matchingCarts.slice(1).map((c: any) => c.id);
              await prisma.cart.updateMany({
                where: { id: { in: extraCartIds } },
                data: { status: "merged" }
              });
            }
            console.log(`[Checkout] Marked cart converted: ${primaryCart.id} for order: ${localOrder.id}`);
          }
        } catch (cartErr: any) {
          console.error("[Checkout] Failed to mark cart converted:", cartErr.message);
        }
      },
    });

    // Increment coupon usedCount if coupon was applied
    if (finalCouponCode) {
      try {
        await prisma.webStoreCoupon.update({
          where: { code: finalCouponCode.toUpperCase().trim() },
          data: { usedCount: { increment: 1 } },
        });
        console.log(`[Checkout] Successfully incremented usage for coupon: ${finalCouponCode}`);
      } catch (couponUsageErr: any) {
        console.error(`[Checkout] Failed to increment usedCount for coupon: ${finalCouponCode}`, couponUsageErr.message);
      }
    }

    // Issue cashback if coupon has cashback store credits enabled
    if (finalCouponCode && Number(cashbackAmount) > 0) {
      try {
        const cbAmt = parseFloat(String(cashbackAmount));
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 90);

        await prisma.$transaction([
          prisma.customer.update({
            where: { id: localCustomer.id },
            data: {
              storeCredits: { increment: cbAmt }
            }
          }),
          prisma.storeCredit.create({
            data: {
              customerId: localCustomer.id,
              amount: cbAmt,
              type: "COUPON_REBATE",
              description: `Cashback for applying coupon code ${finalCouponCode.toUpperCase()}`,
              orderId: localOrder.id,
              expiresAt,
              remainingAmount: cbAmt
            }
          })
        ]);
        console.log(`[Checkout Store Credit] Successfully credited ₹${cbAmt} (90-day expiry) to customer ${localCustomer.id}`);
      } catch (storeCreditErr: any) {
        console.error("[Checkout Store Credit] Failed to issue cashback:", storeCreditErr.message);
      }
    }

    // Sync WebStoreOrder for dashboard integration
    let webStoreOrder: any = null;
    try {
      const prevNumbers = existingPreCreatedOrder?.previousOrderNumbers
        ? existingPreCreatedOrder.previousOrderNumbers.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      const oldInternalNumber = existingPreCreatedOrder?.internalOrderNumber;

      let existingWebStoreOrder = await prisma.webStoreOrder.findFirst({
        where: {
          OR: [
            ...(razorpay?.razorpay_order_id ? [{ razorpayOrderId: razorpay.razorpay_order_id }] : []),
            { orderNumber: universalOrderNumber },
            ...(oldInternalNumber ? [{ orderNumber: oldInternalNumber }] : []),
            ...prevNumbers.map((num: string) => ({ orderNumber: num })),
            ...(existingPreCreatedOrder?.id ? [{ notes: { contains: `Local: ${existingPreCreatedOrder.id}` } }] : [])
          ]
        }
      });

      const wsPaymentStatus = orderPaymentStatus;
      const wsCodUpfrontPaid = isCodOrder ? resolvedCodFee : 0;
      const wsCodUpfrontPaymentId = isCodOrder ? (razorpay?.razorpay_payment_id || null) : null;
      const wsNotes = isFullStoreCredit
        ? `Paid 100% via Store Credit (₹${parsedStoreCredit})`
        : `${isCodOrder ? `COD Order (₹${wsCodUpfrontPaid} upfront fee paid)` : "Paid via Razorpay"} ${parsedStoreCredit > 0 ? `+ ₹${parsedStoreCredit} Store Credit` : ''} | Shopify: ${localOrder.shopifyOrderId || 'Pending'} | Local: ${localOrder.id}`;

      if (existingWebStoreOrder) {
        webStoreOrder = await prisma.webStoreOrder.update({
          where: { id: existingWebStoreOrder.id },
          data: {
            orderNumber: universalOrderNumber,
            paymentStatus: wsPaymentStatus,
            paymentMethod: finalPaymentMethod,
            razorpayOrderId: razorpay?.razorpay_order_id || existingWebStoreOrder.razorpayOrderId,
            razorpayPaymentId: razorpay?.razorpay_payment_id || null,
            storeCreditAmount: parsedStoreCredit,
            codUpfrontPaid: wsCodUpfrontPaid,
            codUpfrontPaymentId: wsCodUpfrontPaymentId,
            paymentFailureReason: null,
            notes: wsNotes,
            customerName: (normalizedAddress as any)?.name || address.name || existingWebStoreOrder.customerName,
            customerEmail: (normalizedAddress as any)?.email || address.email || existingWebStoreOrder.customerEmail || "",
            customerPhone: (normalizedAddress as any)?.phone || address.phone || existingWebStoreOrder.customerPhone || "",
            shippingAddress: (normalizedAddress || address) as any,
          }
        });
        console.log(`[Checkout Complete] Updated pre-created WebStoreOrder ${webStoreOrder.id} (${universalOrderNumber}) to ${wsPaymentStatus}`);
      } else {
        // Double check by orderNumber before create to prevent P2002 unique constraint conflict
        const byOrderNum = await prisma.webStoreOrder.findUnique({
          where: { orderNumber: universalOrderNumber }
        });

        if (byOrderNum) {
          webStoreOrder = await prisma.webStoreOrder.update({
            where: { id: byOrderNum.id },
            data: {
              paymentStatus: wsPaymentStatus,
              paymentMethod: finalPaymentMethod,
              razorpayOrderId: razorpay?.razorpay_order_id || byOrderNum.razorpayOrderId,
              razorpayPaymentId: razorpay?.razorpay_payment_id || null,
              storeCreditAmount: parsedStoreCredit,
              codUpfrontPaid: wsCodUpfrontPaid,
              codUpfrontPaymentId: wsCodUpfrontPaymentId,
              paymentFailureReason: null,
              notes: wsNotes,
              customerName: (normalizedAddress as any)?.name || address.name || byOrderNum.customerName,
              customerEmail: (normalizedAddress as any)?.email || address.email || byOrderNum.customerEmail || "",
              customerPhone: (normalizedAddress as any)?.phone || address.phone || byOrderNum.customerPhone || "",
              shippingAddress: (normalizedAddress || address) as any,
            }
          });
          console.log(`[Checkout Complete] Re-adopted WebStoreOrder by orderNumber: ${universalOrderNumber}`);
        } else {
          webStoreOrder = await prisma.webStoreOrder.create({
            data: {
              orderNumber: universalOrderNumber,
              customerName: (normalizedAddress as any)?.name || address.name,
              customerEmail: (normalizedAddress as any)?.email || address.email || "",
              customerPhone: (normalizedAddress as any)?.phone || address.phone || "",
              shippingAddress: (normalizedAddress || address) as any,
              items: items.map((item: any) => ({
                product_id: item.productId,
                variant_id: item.variantId || "",
                title: item.title,
                image_url: item.image || "",
                quantity: item.quantity,
                price: Number(item.price) || 0,
                size: item.size || ""
              })) as any,
              subtotal: subtotal,
              shippingCharge: 0,
              discountCode: finalCouponCode || null,
              discountAmount: Number(finalCouponDiscount) || 0,
              storeCreditAmount: parsedStoreCredit,
              totalAmount: total,
              paymentStatus: wsPaymentStatus,
              paymentMethod: finalPaymentMethod,
              razorpayOrderId: razorpay?.razorpay_order_id || null,
              razorpayPaymentId: razorpay?.razorpay_payment_id || null,
              codUpfrontPaid: wsCodUpfrontPaid,
              codUpfrontPaymentId: wsCodUpfrontPaymentId,
              fulfillmentStatus: "unfulfilled",
              notes: wsNotes,
              source: "web"
            }
          });
        }
      }
      console.log(`[Checkout] Successfully synced WebStoreOrder for localOrder: ${localOrder.id}, shopifyOrderId: ${localOrder.shopifyOrderId}`);
    } catch (webStoreOrderErr: any) {
      console.error("[Checkout] Failed to sync WebStoreOrder in DB:", webStoreOrderErr.message);
    }

    // Send order confirmation email to the user
    try {
      const orderPayload = {
        orderId: universalOrderNumber,
        customerEmail: address.email,
        customerName: address.name || "Customer",
        items: items.map((item: any) => ({
          name: item.title,
          size: item.size || 'N/A',
          quantity: Number(item.quantity || 1),
          price: Number(item.price || 0),
          image: item.image || '',
          product_id: item.productId || null,
          variant_title: item.variantId || null,
        })),
        total: Number(total),
        currency: localOrder.currency || body.currency || 'INR',
        orderDate: new Date(localOrder.createdAt).toLocaleDateString('en-IN', { dateStyle: 'long' }),
        paymentMethod: finalPaymentMethod,
        subtotal: Number(subtotal),
        shipping: 0,
        discount: Number(finalCouponDiscount) || 0,
        shippingAddress: `${address.street || ''}, ${address.city || ''}, ${address.state || ''} - ${address.zip || ''}, ${address.country || 'India'}`,
      };

      // Send order confirmation email in background (non-blocking for fast redirect)
      const sendEmailTask = async () => {
        try {
          if (paymentMethod.toLowerCase() === 'cod') {
            await sendOrderCodConfirmationEmail(orderPayload);
          } else {
            await sendOrderConfirmationEmail(orderPayload);
          }

          await prisma.emailLog.create({
            data: {
              recipientEmail: address.email,
              recipientName: address.name,
              subject: `Order Confirmed - ${orderPayload.orderId}`,
              templateName: 'ORDER_CONFIRMATION',
              triggerEvent: 'checkout/complete',
              referenceId: localOrder.id,
              status: 'sent',
              sentBy: 'system',
            }
          });
        } catch (emailErr: any) {
          console.error("[Email Trigger Error] Failed to send order confirmation email:", emailErr.message);
          await prisma.emailLog.create({
            data: {
              recipientEmail: address.email,
              recipientName: address.name,
              subject: `Order Confirmed - ${webStoreOrder?.orderNumber || localOrder.shopifyOrderId || localOrder.id}`,
              templateName: 'ORDER_CONFIRMATION',
              triggerEvent: 'checkout/complete',
              referenceId: localOrder.id,
              status: 'failed',
              errorMessage: emailErr.message,
            }
          }).catch(() => null);
        }
      };

      sendEmailTask();
    } catch (emailErr: any) {
      console.error("[Email Trigger Setup Error]:", emailErr.message);
    }

    // Send order confirmation WhatsApp to the user in background (non-blocking)
    try {
      const customerPhone = address.phone || localCustomer?.phone;
      const orderIdStr = String(universalOrderNumber);
      const isCod = paymentMethod.toLowerCase() === 'cod';
      const customerName = address.name || "Customer";
      const firstLineItem = items[0];
      const productImageUrl = firstLineItem?.image || '';
      const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://zicabella.com';
      const orderStatusUrl = `${appBaseUrl}/orders/${orderIdStr}`;
      const totalAmount = Number(total);
      const itemCount = items.length || 1;

      const sendWhatsAppTask = async () => {
        try {
          const { getWhatsAppSetting } = await import('@/lib/whatsapp/logger');
          if (isCod) {
            const enabled = (await getWhatsAppSetting('cod_confirmation_enabled', 'true')) === 'true';
            if (enabled && customerPhone) {
              const templateName = await getWhatsAppSetting('template_cod_confirmation', 'zica_cod_confirmation_v1');
              const alreadySent = await prisma.whatsAppMessage.findFirst({
                where: { orderId: orderIdStr, templateName }
              });
              if (!alreadySent) {
                const { sendCODConfirmation } = await import('@/lib/whatsapp/templates');
                await sendCODConfirmation({ phone: customerPhone, customerName, orderId: orderIdStr });
              }
            }
          } else {
            const enabled = (await getWhatsAppSetting('order_confirmed', 'true')) === 'true';
            if (enabled && customerPhone) {
              const templateName = await getWhatsAppSetting('template_order_confirmed', 'zica_order_confirmed_v1');
              const alreadySent = await prisma.whatsAppMessage.findFirst({
                where: { orderId: orderIdStr, templateName }
              });
              if (!alreadySent) {
                const { sendOrderConfirmation } = await import('@/lib/whatsapp/templates');
                await sendOrderConfirmation({
                  phone: customerPhone,
                  customerName,
                  orderId: orderIdStr,
                  productImageUrl,
                  orderStatusUrl,
                  totalAmount,
                  itemCount
                });
              }
            }
          }
        } catch (waErr: any) {
          console.error('[WhatsApp Trigger Error] Failed to send webstore order confirmation:', waErr.message);
        }
      };

      sendWhatsAppTask().catch(err => console.error('[WhatsApp Async Error]', err));
    } catch (waSetupErr: any) {
      console.error('[WhatsApp Trigger Setup Error]:', waSetupErr.message);
    }

    // Update customer name/phone/address for next time, save the address book entry and
    // refresh the Shopify customer (deferred; none of this is needed to show the confirmation).
    deferredTasks.push({
      name: 'customer-profile-and-address',
      run: async () => {
        try {
          await prisma.customer.update({
            where: { id: localCustomer.id },
            data: {
              name: address.name,
              phone: address.phone,
              defaultAddress: JSON.stringify(address)
            }
          });
        } catch (profileErr: any) {
          console.error("[Checkout] Failed to update customer profile:", profileErr.message);
        }

        // Save shipping address to Address table
        try {
          const existingAddr = await prisma.address.findFirst({
            where: {
              customerId: localCustomer.id,
              address1: address.street,
              city: address.city,
              zip: address.zip,
              phone: address.phone || ""
            }
          });

          if (!existingAddr) {
            const addressesCount = await prisma.address.count({
              where: { customerId: localCustomer.id }
            });

            await prisma.address.create({
              data: {
                customerId: localCustomer.id,
                name: address.name,
                phone: address.phone || "",
                email: address.email || "",
                address1: address.street,
                address2: address.apartment || "",
                city: address.city,
                state: address.state,
                zip: address.zip,
                country: address.country || "India",
                isDefault: addressesCount === 0,
                lat: address.lat != null ? parseFloat(address.lat) : null,
                lng: address.lng != null ? parseFloat(address.lng) : null,
                placeId: address.placeId || null,
              }
            });
            console.log(`[Checkout] Saved new shipping address for customer: ${localCustomer.id}`);
          }
        } catch (addrErr: any) {
          console.error("[Checkout] Error saving shipping address to Address table:", addrErr.message);
        }

        try {
          await updateCustomer(shopifyCustomerId, {
            first_name: address.name.split(' ')[0],
            last_name: address.name.split(' ').slice(1).join(' ') || '.',
            phone: address.phone,
          });
        } catch (e: any) {
          // Shopify 422 "phone has already been taken" is expected for returning customers.
          console.warn("[Checkout] Shopify customer name update skipped:", e?.message || e);
        }
      },
    });

    const orderIdToReturn = localOrder.id;
    const respondedInMs = Date.now() - requestStartedAt;

    // Fire the deferred queue AFTER the response is built. Tasks are independent, so they
    // run in parallel; each handles its own errors and can never fail the checkout.
    void (async () => {
      const queueStartedAt = Date.now();
      const results = await Promise.allSettled(
        deferredTasks.map(async (task) => {
          const taskStartedAt = Date.now();
          try {
            await task.run();
          } finally {
            console.log(`[Checkout Complete][deferred] ${task.name} finished in ${Date.now() - taskStartedAt}ms`);
          }
        })
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      console.log(
        `[Checkout Complete][deferred] order ${orderIdToReturn}: ${deferredTasks.length} task(s) done in ` +
        `${Date.now() - queueStartedAt}ms (${failed} failed); response was sent after ${respondedInMs}ms`
      );
    })().catch((queueErr: any) => {
      console.error('[Checkout Complete][deferred] queue error:', queueErr?.message || queueErr);
    });

    return NextResponse.json({ orderId: orderIdToReturn });
  } catch (error: any) {
    console.error("Order Completion Error:", error);
    return NextResponse.json({ error: error.message || "Order completion failed" }, { status: 500 });
  }
}
