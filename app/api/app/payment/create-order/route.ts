import Razorpay from 'razorpay';
import { NextResponse } from 'next/server';
import { resolveRazorpayCredentials } from '@/lib/razorpay-credentials';
import { requireAppAuth, handleAppAuthError, getAppAuthFromRequest, type AppAuthTokenPayload } from '@/lib/appAuth';
import prisma from '@/lib/db';
import { assignFailedOrderNumber } from '@/lib/orderNumber';

import { getCorsHeaders, handleCorsOptions } from '@/lib/cors';
import { normalizeVariantId } from '@/lib/snap/catalog-id';
import { recordSnapAppContext, appRequestContext } from '@/lib/snap/app-purchase-server';

export async function OPTIONS(req: Request) {
  return handleCorsOptions(req);
}

function razorpayErrMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { error?: { description?: string; code?: string }; message?: string };
    if (e.error?.description) return e.error.description;
    if (e.message) return e.message;
  }
  return 'Order creation failed';
}

async function resolveMobileCustomer(shopId: string, orderData: any, userAuth: AppAuthTokenPayload | null) {
  // Prefer auth customer so prepaid orders always stick to the logged-in account
  const bodyCustomerId = orderData?.customerId && orderData.customerId !== 'GUEST' ? orderData.customerId : null;
  const customerId = userAuth?.customerId || bodyCustomerId;
  const customerEmail = orderData?.customerEmail || orderData?.shippingAddress?.email || userAuth?.customerEmail;
  const customerPhone = orderData?.customerPhone || orderData?.shippingAddress?.phone || '';

  let customer = customerId
    ? await prisma.customer.findUnique({ where: { id: customerId } })
    : null;

  if (!customer && customerEmail) {
    customer = await prisma.customer.findFirst({ where: { email: customerEmail } });
  }

  if (!customer && customerPhone) {
    const phoneDigits = String(customerPhone).replace(/\D/g, '').slice(-10);
    if (phoneDigits.length === 10) {
      customer = await prisma.customer.findFirst({ where: { phone: { contains: phoneDigits } } });
    }
  }

  if (customer) return customer;

  const shippingAddress = orderData?.shippingAddress || {};
  return prisma.customer.create({
    data: {
      shopId,
      shopifyId: `GUEST_${Date.now()}`,
      name: shippingAddress.name || orderData?.customerName || 'Guest User',
      email: customerEmail || 'guest@zicabella.com',
      phone: customerPhone || '',
    },
  });
}

export async function POST(req: Request) {
  const corsHeaders = getCorsHeaders(req);
  try {
    const authHeader = req.headers.get('authorization') || '';
    const userAuth = getAppAuthFromRequest(req);

    // If client supplied a Bearer token but it's expired/invalid, reject with clear session expired message
    if (authHeader && !userAuth) {
      return NextResponse.json(
        { error: 'Session expired. Please log in again.' },
        { status: 401, headers: corsHeaders }
      );
    }

    let { key_id, key_secret, source } = await resolveRazorpayCredentials();
    key_id = key_id.trim();
    key_secret = key_secret.trim();
    
    const instance = new Razorpay({
      key_id,
      key_secret,
    });

    const body = await req.json();
    const { amount, currency = 'INR', receipt: receiptIn, orderData, snapDevice } = body;
    const amountRupees = Number(amount);
    if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400, headers: corsHeaders });
    }

    const isCod = String(orderData?.paymentMethod || '').toUpperCase() === 'COD';

    const { isCodAllowedForCountry, resolveCheckoutCountry, COD_INDIA_ONLY_ERROR } = await import('@/lib/cod-availability');
    const appCountry = resolveCheckoutCountry({
      displayCountry: orderData?.displayCountry || orderData?.countryCode,
      currency,
      address: orderData?.shippingAddress || orderData?.shipping_address,
    });
    if (isCod && !isCodAllowedForCountry(appCountry)) {
      return NextResponse.json({ error: COD_INDIA_ONLY_ERROR }, { status: 400, headers: corsHeaders });
    }
    const { getConfiguredCodUpfrontAmount } = await import('@/lib/cod-upfront');
    const configuredCodFee = isCod ? await getConfiguredCodUpfrontAmount() : 0;

    // Reprice line items from Shopify when possible (null = reprice unavailable).
    const lineItems = Array.isArray(orderData?.lineItems) ? orderData.lineItems : [];
    for (const li of lineItems) {
      const q = Number(li?.quantity);
      if (!Number.isInteger(q) || q < 1) {
        return NextResponse.json({ error: 'Invalid item quantity. Please refresh your bag and try again.' }, { status: 400, headers: corsHeaders });
      }
    }
    const clientLinesTotal = lineItems.reduce(
      (sum: number, li: any) => sum + (Number(li?.price) || 0) * Math.max(1, Number(li?.quantity) || 1), 0);
    let pricedSubtotal: number | null = null;
    let allPriced = false;
    let unitPrices = new Map<string, number>();
    if (lineItems.length > 0) {
      try {
        const { fetchVariantPriceMap, sumLineItemsWithAuthoritativePrices } = await import(
          '@/lib/shopify-variant-prices'
        );
        const priceMap = await fetchVariantPriceMap(
          lineItems.map((li: any) => String(li?.variantId || li?.variant_id || ''))
        );
        if (priceMap.size > 0) {
          unitPrices = priceMap;
          const priced = sumLineItemsWithAuthoritativePrices(lineItems, priceMap);
          pricedSubtotal = priced.subtotal;
          allPriced = priced.allMapped;
        }
      } catch (e: any) {
        console.warn('[MobileCheckout] Reprice failed:', e?.message);
      }
    }
    // Prepaid money is only taken against a cart the server has priced itself:
    // fail closed when there are no items or Shopify prices could not be confirmed.
    if (!isCod && lineItems.length === 0) {
      return NextResponse.json({ error: 'Your bag is empty or invalid. Please review your bag and try again.' }, { status: 400, headers: corsHeaders });
    }
    if (!isCod && !allPriced) {
      console.error('[MobileCheckout] Refusing prepaid charge: could not confirm Shopify prices for every item');
      return NextResponse.json(
        { error: 'We could not confirm item prices right now. Please try again in a moment.', code: 'PRICE_UNVERIFIED' },
        { status: 503, headers: corsHeaders }
      );
    }
    // The goods on the order (unit price × quantity). The charge below is derived from
    // THIS, never from the client's `amount`, so charge and items cannot disagree.
    const linesSubtotal = pricedSubtotal ?? clientLinesTotal;

    // Re-validate the coupon and its amount before any payment order is created.
    let verifiedDiscount = 0;
    {
      const { verifyAppOrderDiscount } = await import('@/lib/appDiscounts');
      const discountCheck = await verifyAppOrderDiscount({
        code: orderData?.discountCode || orderData?.discount_code,
        claimedAmount: orderData?.discountAmount ?? orderData?.discount_amount,
        orderAmount: linesSubtotal,
        paymentMethod: orderData?.paymentMethod,
      });
      if (!discountCheck.ok) {
        return NextResponse.json({ error: discountCheck.error }, { status: 400, headers: corsHeaders });
      }
      verifiedDiscount = discountCheck.discountAmount;
    }
    const appliedCredits = Math.max(0, Number(orderData?.appliedStoreCredits || 0));
    if (appliedCredits > 0) {
      const creditCustomerId = userAuth?.customerId;
      const creditCustomer = creditCustomerId
        ? await prisma.customer.findUnique({ where: { id: creditCustomerId }, select: { storeCredits: true } })
        : null;
      if (!creditCustomer || appliedCredits > Number(creditCustomer.storeCredits || 0) + 0.01) {
        return NextResponse.json(
          { error: 'Store credits applied exceed your available balance. Please review your bag and try again.', code: 'CREDITS_INVALID' },
          { status: 400, headers: corsHeaders }
        );
      }
    }

    // Prepaid: charge exactly what the items cost (after verified discount/credits).
    // If the app's amount disagrees (stale quantity/total in the bag), refuse instead of
    // opening Razorpay for a different amount than the order's items.
    let prepaidCharge = amountRupees;
    if (!isCod && lineItems.length > 0) {
      prepaidCharge = Math.max(0, Math.round((linesSubtotal - appliedCredits - verifiedDiscount) * 100) / 100);
      if (Math.abs(prepaidCharge - amountRupees) > 1) {
        console.error(
          `[MobileCheckout] Amount mismatch: client ₹${amountRupees} vs items ₹${prepaidCharge} (lines ₹${linesSubtotal}, discount ₹${verifiedDiscount}, credits ₹${appliedCredits}, items=${JSON.stringify(lineItems.map((li: any) => ({ v: li?.variantId, q: li?.quantity, p: li?.price })))})`
        );
        return NextResponse.json(
          { error: 'Your bag total changed. Please review your bag and try again.', code: 'AMOUNT_MISMATCH', expectedAmount: prepaidCharge },
          { status: 409, headers: corsHeaders }
        );
      }
    }
    if (!isCod && prepaidCharge <= 0) {
      return NextResponse.json(
        { error: 'Invalid prepaid amount after discounts' },
        { status: 400, headers: corsHeaders }
      );
    }

    // COD: charge dashboard fee only. Prepaid: server-floor amount.
    const chargeAmountRupees = isCod ? configuredCodFee : prepaidCharge;
    const orderTotalRupees = isCod
      ? Number(orderData?.total ?? orderData?.total_price ?? amountRupees)
      : chargeAmountRupees;

    // Razorpay receipt: required, max 40 chars
    let receipt = typeof receiptIn === 'string' && receiptIn.trim() ? receiptIn.trim() : `zb_${Date.now()}`;
    if (receipt.length > 40) {
      receipt = receipt.slice(0, 40);
    }

    const order = await instance.orders.create({
      amount: Math.round(chargeAmountRupees * 100),
      currency,
      receipt,
      payment_capture: true,
      notes: {
        customerId: userAuth?.customerId || orderData?.customerId,
        source: 'mobile-app',
        items_qty: String(lineItems.reduce((n: number, li: any) => n + (Number(li?.quantity) || 0), 0)),
        items_subtotal: String(linesSubtotal),
        ...(isCod ? { payment_type: 'cod_upfront', cod_upfront: String(chargeAmountRupees) } : {}),
      }
    });

    // ─── Create a PENDING order in our DB ───
    // This allows webhooks to find the order even if the app crashes/user leaves.
    let pendingOrderId: string | null = null;
    if (orderData) {
      try {
        const shop = await prisma.shop.findFirst();
        if (!shop && !isCod) throw new Error('Shop record not found — cannot record the order before payment');
        if (shop) {
          const customer = await resolveMobileCustomer(shop.id, orderData, userAuth);
          
          // Generate pending order number (real ZB number assigned at payment success)
          let universalOrderNumber = '';
          try {
            universalOrderNumber = await assignFailedOrderNumber(prisma, { cause: 'pending' });
          } catch (seqErr: any) {
            console.error('[MobileCheckout] Failed to generate pending order number:', seqErr.message);
            universalOrderNumber = `ZBPP${Date.now().toString().slice(-8)}`;
          }

          const resolvedItems = await Promise.all((orderData.lineItems || []).map(async (li: any, idx: number) => {
            let resolvedPid: string | null = null;
            const rawPid = li.productId || li.product_id;
            if (rawPid) {
              const pidStr = String(rawPid);
              const byId = await prisma.product.findUnique({ where: { id: pidStr }, select: { id: true } }).catch(() => null);
              if (byId) {
                resolvedPid = byId.id;
              } else {
                const { extractNumericId } = await import('@/lib/utils');
                const numericPid = extractNumericId(pidStr);
                if (numericPid) {
                  const byShopifyId = await prisma.product.findUnique({ where: { shopifyProductId: numericPid }, select: { id: true } }).catch(() => null);
                  if (byShopifyId) resolvedPid = byShopifyId.id;
                }
              }
            }
            
            // Shopify backend variant id = Snap catalog <g:id> (feed.xml). Stored on the
            // PENDING item so it survives even if the app never calls orders/create.
            const variantId = normalizeVariantId(li.variantId || li.variant_id);
            return {
              productId: resolvedPid,
              variantId,
              title: li.name || li.title || 'Product',
              quantity: Number(li.quantity || 1),
              // Unit price the charge was computed from (Shopify), not the app's copy.
              price: unitPrices.get(String(li.variantId || li.variant_id || '').split('/').pop() || '') ?? Number(li.price || 0),
              sku: li.sku || null,
              image: li.image || null,
            };
          }));

          await prisma.$transaction(async (tx: any) => {
            // 1. Create pending Order
            const pendingOrder = await tx.order.create({
              data: {
                shopId: shop.id,
                customerId: customer.id,
                shopifyOrderId: null, // Null initially, set when synced
                razorpayOrderId: order.id,
                totalPrice: orderTotalRupees,
                subtotalPrice: lineItems.length > 0 ? linesSubtotal : (orderData.subtotal || orderTotalRupees),
                discountCode: orderData.discountCode || orderData.discount_code || null,
                discountAmount: verifiedDiscount,
                storeCreditAmount: appliedCredits,
                totalTax: 0,
                currency: 'INR',
                paymentStatus: 'pending',
                status: 'payment_pending',
                orderType: 'MOBILE_APP',
                fulfillmentStatus: 'unfulfilled',
                deliveryStatus: 'pending',
                paymentMethod: isCod ? 'COD' : 'Razorpay',
                // Fee is charged at Razorpay; only store as paid after capture
                codUpfrontPaid: 0,
                shippingAddress: typeof orderData.shippingAddress === 'string' ? orderData.shippingAddress : JSON.stringify({
                  ...orderData.shippingAddress,
                  address1: orderData.shippingAddress?.address1 || orderData.shippingAddress?.line1 || orderData.shippingAddress?.street || '',
                  province: orderData.shippingAddress?.province || orderData.shippingAddress?.state || '',
                  zip: orderData.shippingAddress?.zip || orderData.shippingAddress?.pincode || '',
                }),
                billingAddress: null,
                tags: orderData.tags || `mobile-app, pending${isCod ? ', COD' : ''}`,
                note: orderData.note || (isCod
                  ? `COD upfront ₹${chargeAmountRupees} pending via Razorpay`
                  : 'Created via Payment Initiation'),
                
                // Set universal numbering and status — pending until payment confirms (not 'failed')
                internalOrderNumber: universalOrderNumber,
                shopifySyncStatus: 'pending',
                shopifySyncError: 'Order initiated on mobile, payment pending',

                items: {
                  create: resolvedItems.map((item, idx) => ({
                    shopifyLineItemId: `pending_${order.id}_${idx}`,
                    productId: item.productId,
                    title: item.title,
                    quantity: item.quantity,
                    price: item.price,
                    sku: item.sku,
                    variantId: item.variantId,
                    image: item.image,
                  }))
                }
              }
            });
            pendingOrderId = pendingOrder.id;

            // 2. Create pending MobileOrder
            await tx.mobileOrder.create({
              data: {
                orderNumber: universalOrderNumber,
                customerId: customer.id,
                status: 'payment_pending',
                paymentStatus: 'pending',
                paymentMethod: isCod ? 'COD' : 'PREPAID',
                totalPrice: orderTotalRupees,
                subtotalPrice: orderData.subtotal || orderTotalRupees,
                currency: 'INR',
                fulfillmentStatus: 'unfulfilled',
                deliveryStatus: 'pending',
                shippingAddress: typeof orderData.shippingAddress === 'string' ? orderData.shippingAddress : JSON.stringify(orderData.shippingAddress),
                tags: orderData.tags || `mobile-app, pending${isCod ? ', COD' : ''}`,
                note: orderData.note || (isCod
                  ? `COD upfront ₹${chargeAmountRupees} pending via Razorpay`
                  : 'Created via Payment Initiation'),
                source: 'mobile_app',
                items: {
                  create: resolvedItems.map(item => ({
                    productId: item.productId,
                    variantId: item.variantId,
                    title: item.title,
                    quantity: item.quantity,
                    price: item.price,
                    sku: item.sku,
                    image: item.image,
                  }))
                }
              }
            });
          });

          // Read the order back from the DB and require it to equal what Razorpay was opened
          // for (prepaid). Any difference aborts before the customer can pay.
          if (!isCod) {
            const saved: any = pendingOrderId
              ? await prisma.order.findUnique({ where: { id: pendingOrderId }, include: { items: true } })
              : null;
            const { itemsPayableRupees } = await import('@/lib/razorpay-webhook-events');
            const dbPayable = saved ? itemsPayableRupees(saved) : null;
            const razorpayRupees = Number(order.amount) / 100;
            if (
              !saved ||
              saved.razorpayOrderId !== order.id ||
              dbPayable === null ||
              Math.abs(dbPayable - razorpayRupees) > 0.01 ||
              Math.abs(Number(saved.totalPrice) - razorpayRupees) > 0.01 ||
              (saved.items || []).length !== lineItems.length
            ) {
              throw new Error(
                `DB/Razorpay mismatch: db items ₹${dbPayable}, db total ₹${saved?.totalPrice}, razorpay ₹${razorpayRupees}`
              );
            }
          }

          console.log(`[Razorpay] Pre-created pending order and mobile order ${order.id} in DB with internalOrderNumber: ${universalOrderNumber}`);

          // Tracking only: store the app's device context (platform, OS/app version,
          // ATT, IDFV/AAID) so the MOBILE_APP Snap Purchase can be sent once the
          // payment is captured — even if the app never calls back.
          if (pendingOrderId && snapDevice) {
            recordSnapAppContext(pendingOrderId, snapDevice, appRequestContext(req, customer.id)).catch(() => {});
          }
        }
      } catch (dbErr: any) {
        console.error('[Razorpay] Failed to pre-create / verify pending order:', dbErr.message);
        if (!isCod) {
          // Prepaid is never opened for an order we could not record and verify.
          if (pendingOrderId) {
            await prisma.order.update({
              where: { id: pendingOrderId },
              data: { status: 'payment_failed', paymentFailureReason: 'Order/amount verification failed before payment' },
            }).catch(() => {});
          }
          return NextResponse.json(
            { error: 'We could not prepare your order for payment. Please try again.', code: 'ORDER_NOT_RECORDED' },
            { status: 500, headers: corsHeaders }
          );
        }
        // COD upfront: keep the previous behaviour (webhook can still find the order).
      }
    }

    return NextResponse.json(
      {
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id,
        codFee: isCod ? chargeAmountRupees : 0,
      },
      { headers: corsHeaders }
    );
  } catch (err: unknown) {
    if ((err as any)?.statusCode === 401) return handleAppAuthError(err);
    console.error('Razorpay create-order error:', err);
    const message = err instanceof Error ? err.message : razorpayErrMessage(err);
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
