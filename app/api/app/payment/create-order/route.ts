import Razorpay from 'razorpay';
import { NextResponse } from 'next/server';
import { resolveRazorpayCredentials } from '@/lib/razorpay-credentials';
import { requireAppAuth, handleAppAuthError, type AppAuthTokenPayload } from '@/lib/appAuth';
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

async function resolveMobileCustomer(shopId: string, orderData: any, userAuth: AppAuthTokenPayload) {
  // Prefer auth customer so prepaid orders always stick to the logged-in account
  const bodyCustomerId = orderData?.customerId && orderData.customerId !== 'GUEST' ? orderData.customerId : null;
  const customerId = userAuth.customerId || bodyCustomerId;
  const customerEmail = orderData?.customerEmail || orderData?.shippingAddress?.email || userAuth.customerEmail;
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
    const { auth: userAuth } = await requireAppAuth(req);

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
    const { getConfiguredCodUpfrontAmount } = await import('@/lib/cod-upfront');
    const configuredCodFee = isCod ? await getConfiguredCodUpfrontAmount() : 0;
    // COD: charge dashboard fee only. Prepaid: charge the client amount (order total).
    const chargeAmountRupees = isCod ? configuredCodFee : amountRupees;
    const orderTotalRupees = isCod
      ? Number(orderData?.total ?? orderData?.total_price ?? amountRupees)
      : amountRupees;

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
        customerId: userAuth.customerId || orderData?.customerId,
        source: 'mobile-app',
        ...(isCod ? { payment_type: 'cod_upfront', cod_upfront: String(chargeAmountRupees) } : {}),
      }
    });

    // ─── Create a PENDING order in our DB ───
    // This allows webhooks to find the order even if the app crashes/user leaves.
    if (orderData) {
      try {
        const shop = await prisma.shop.findFirst();
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
              price: Number(li.price || 0),
              sku: li.sku || null,
              image: li.image || null,
            };
          }));

          let pendingOrderId: string | null = null;
          await prisma.$transaction(async (tx: any) => {
            // 1. Create pending Order
            const pendingOrder = await tx.order.create({
              data: {
                shopId: shop.id,
                customerId: customer.id,
                shopifyOrderId: null, // Null initially, set when synced
                razorpayOrderId: order.id,
                totalPrice: orderTotalRupees,
                subtotalPrice: orderData.subtotal || orderTotalRupees,
                totalTax: 0,
                currency: 'INR',
                paymentStatus: 'pending',
                status: 'payment_pending',
                orderType: 'MOBILE_APP',
                fulfillmentStatus: 'unfulfilled',
                deliveryStatus: 'pending',
                paymentMethod: isCod ? 'COD' : 'Razorpay',
                codUpfrontPaid: isCod ? chargeAmountRupees : 0,
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

          console.log(`[Razorpay] Pre-created pending order and mobile order ${order.id} in DB with internalOrderNumber: ${universalOrderNumber}`);

          // Tracking only: store the app's device context (platform, OS/app version,
          // ATT, IDFV/AAID) so the MOBILE_APP Snap Purchase can be sent once the
          // payment is captured — even if the app never calls back.
          if (pendingOrderId && snapDevice) {
            recordSnapAppContext(pendingOrderId, snapDevice, appRequestContext(req, customer.id)).catch(() => {});
          }
        }
      } catch (dbErr: any) {
        console.warn('[Razorpay] Failed to pre-create pending order:', dbErr.message);
        // Non-blocking: we still want to return the Razorpay order_id
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
