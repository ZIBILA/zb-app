import { NextResponse } from 'next/server';
import { getAppAuthFromRequest } from '@/lib/appAuth';
import prisma from '@/lib/db';
import { syncOrderToShopify } from '@/lib/services/shopifyOrderSyncService';
import { extractNumericId } from '@/lib/utils';
import { assignUniversalOrderNumber, assignFailedOrderNumber, isFailedPrefixNumber } from '@/lib/orderNumber';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status, headers: corsHeaders });
}

export async function POST(req: Request) {
  // Try to get auth from request, but don't fail if missing (allows guest orders)
  const auth = getAppAuthFromRequest(req);

  // If token is present, validate version against DB to support revocation
  if (auth) {
    try {
      const customer = await prisma.customer.findUnique({
        where: { id: auth.customerId },
        select: { tokenVersion: true },
      });
      if (customer && auth.tokenVersion !== undefined && auth.tokenVersion < customer.tokenVersion) {
        return NextResponse.json(
          { success: false, error: 'Session expired. Please log in again.' },
          { status: 401, headers: corsHeaders }
        );
      }
    } catch (_) { /* proceed — don't block order on version check failure */ }
  }

  try {
    const body = await req.json();
    console.log('[App API] Order creation request body:', JSON.stringify(body).slice(0, 500));

    // Map fields from different naming conventions
    const customerId = body.customerId || body.customer_id;
    let customerEmail = body.customerEmail || body.email;
    const customerPhone = body.customerPhone || body.phone;
    const shippingAddress = body.shippingAddress || body.shipping_address;
    const lineItems = body.lineItems || body.line_items;
    const paymentMethod = (body.paymentMethod || body.payment_method || 'PREPAID').toUpperCase();
    const paymentId = body.paymentId || body.payment_id;
    const rzpOrderId = body.razorpayOrderId || body.razorpay_order_id;
    
    // Normalize payment status
    let paymentStatus = (body.paymentStatus || body.financial_status || 'pending').toLowerCase();
    if (paymentMethod === 'COD') {
      paymentStatus = 'pending';
    }

    const subtotal = Number(body.subtotal || body.subtotal_price || 0);
    const total = Number(body.total || body.total_price || 0);
    const appliedStoreCredits = Number(body.appliedStoreCredits || 0);

    // Fallback to auth email if missing in body
    if (!customerEmail && auth?.customerEmail) {
      customerEmail = auth.customerEmail;
    }

    if (!customerEmail && !customerPhone) {
      return jsonError('Either customerEmail or customerPhone is required', 400);
    }
    
    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return jsonError('lineItems is required and cannot be empty', 400);
    }

    const shop = await prisma.shop.findFirst();
    if (!shop) return jsonError('Shop not configured', 500);

    // Resolve or Create Customer
    let customer = null;
    if (customerId && customerId !== 'GUEST') {
      customer = await prisma.customer.findUnique({ where: { id: customerId } });
    }

    if (!customer && customerEmail) {
      customer = await prisma.customer.findFirst({ where: { email: customerEmail } });
    }

    if (!customer && customerPhone) {
      const phoneDigits = String(customerPhone).replace(/\D/g, '').slice(-10);
      if (phoneDigits.length === 10) {
        customer = await prisma.customer.findFirst({ where: { phone: { contains: phoneDigits } } });
      }
    }

    if (!customer) {
      // Create guest customer
      customer = await prisma.customer.create({
        data: {
          shopId: shop.id,
          shopifyId: `GUEST_${Date.now()}`,
          name: shippingAddress?.name || 'Guest User',
          email: customerEmail || 'guest@zicabella.com',
          phone: customerPhone || '',
        }
      });
    }

    // Check if order already exists (pre-created via initiate)
    let existingOrder = null;
    if (rzpOrderId) {
      existingOrder = await prisma.order.findUnique({
        where: { razorpayOrderId: rzpOrderId },
        include: { items: true }
      });
    }

    // Determine the universal order number: reuse if pre-initiated, otherwise generate based on payment status
    let orderNumber = '';
    if (existingOrder && existingOrder.internalOrderNumber) {
      // If the existing order has a pending prefix number and payment succeeded, promote it
      if (paymentStatus === 'paid' && isFailedPrefixNumber(existingOrder.internalOrderNumber)) {
        const oldNumber = existingOrder.internalOrderNumber;
        orderNumber = await assignUniversalOrderNumber(prisma);
        const previousNumbers = [existingOrder.previousOrderNumbers, oldNumber].filter(Boolean).join(',');
        await prisma.order.update({
          where: { id: existingOrder.id },
          data: { internalOrderNumber: orderNumber, previousOrderNumbers: previousNumbers || null }
        });
        console.log(`[MobileCheckoutComplete] Promoted order ${oldNumber} → ${orderNumber}`);
      } else {
        orderNumber = existingOrder.internalOrderNumber;
      }
    } else {
      try {
        if (paymentStatus === 'paid') {
          orderNumber = await assignUniversalOrderNumber(prisma);
        } else {
          orderNumber = await assignFailedOrderNumber(prisma, { cause: paymentMethod === 'COD' ? 'pending' : 'pending' });
        }
      } catch (seqErr: any) {
        console.error('[MobileCheckoutComplete] Failed to generate order number:', seqErr.message);
        orderNumber = paymentStatus === 'paid' ? `ZB${Date.now().toString().slice(-8)}` : `ZBPP${Date.now().toString().slice(-8)}`;
      }
    }

    // ─── Store Credit Redemption ───
    if (appliedStoreCredits > 0) {
      try {
        const { debitStoreCredits } = await import('@/lib/storeCreditsHelper');
        await debitStoreCredits(customer.id, appliedStoreCredits, `#${orderNumber}`);
      } catch (debitErr: any) {
        return jsonError(debitErr.message, 400);
      }
    }

    const resolvedCustomerId = customer.id;
    const now = new Date();

    const tags = [
      'mobile-app',
      `zb-order-${orderNumber}`,
      paymentMethod === 'COD' ? 'cod' : 'prepaid',
      appliedStoreCredits > 0 ? 'store-credit-used' : null
    ].filter(Boolean).join(', ');

    const note = [
      `Mobile app order`,
      `InternalOrderId: ${orderNumber}`,
      `PaymentMethod: ${paymentMethod}`,
      appliedStoreCredits > 0 ? `Store Credits Used: ₹${appliedStoreCredits}` : null,
      paymentId ? `PaymentId: ${paymentId}` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    // Status logic: 
    // 1. Paid -> OPEN (Auto-approved)
    // 2. COD -> awaiting_approval (Requires manual review)
    // 3. Unpaid Prepaid -> payment_pending (Abandoned/Failed flow)
    const initialStatus = paymentStatus === 'paid' 
      ? 'approved' 
      : paymentMethod === 'COD' 
        ? 'awaiting_approval' 
        : 'payment_pending';
    
    let finalShopifyOrderId = existingOrder?.shopifyOrderId || null;
    let finalTags = existingOrder?.tags || tags;
    let isSyncedNow = false;

    // --- SHOPIFY SYNC FLAG ---
    const shouldSyncNow = (paymentStatus === 'paid') && (!existingOrder?.shopifyOrderId || existingOrder.shopifyOrderId.startsWith('#') || existingOrder.shopifyOrderId.startsWith('local_') || existingOrder.shopifyOrderId.startsWith('app_pending_'));

    if (existingOrder) {
      console.log(`[App API] Updating existing order ${existingOrder.id}...`);
      const updated = await prisma.$transaction(async (tx: any) => {
        // Also update or create corresponding MobileOrder record
        const mobileOrder = await tx.mobileOrder.findUnique({
          where: { orderNumber: orderNumber }
        });

        const mobileOrderData = {
          shopifyOrderId: finalShopifyOrderId,
          status: isSyncedNow ? 'synced' : initialStatus,
          paymentStatus,
          paymentMethod: paymentMethod === 'COD' ? 'COD' : 'PREPAID',
          paymentId: paymentId || null,
          syncedAt: isSyncedNow ? now : null,
          tags: finalTags,
        };

        if (mobileOrder) {
          await tx.mobileOrder.update({
            where: { id: mobileOrder.id },
            data: mobileOrderData
          });
        } else {
          const mobileOrderItems = await Promise.all(lineItems.map(async (li: any) => {
            const rawPid = li.productId || li.product_id;
            const vid = extractNumericId(li.variantId || li.variant_id);
            
            let resolvedPid: string | null = null;
            if (rawPid) {
              const pidStr = String(rawPid);
              const byId = await tx.product.findUnique({ where: { id: pidStr }, select: { id: true } });
              if (byId) resolvedPid = byId.id;
            }

            return {
              productId: resolvedPid,
              title: li.name || li.title || 'Product',
              quantity: Number(li.quantity || 0),
              price: Number(li.price || 0),
              sku: li.sku || (vid ? `variant:${vid}` : null),
              image: li.image || li.imageUrl || null,
            };
          }));

          await tx.mobileOrder.create({
            data: {
              orderNumber: orderNumber,
              shopifyOrderId: finalShopifyOrderId,
              customerId: resolvedCustomerId,
              status: isSyncedNow ? 'synced' : initialStatus,
              paymentStatus,
              paymentMethod: paymentMethod === 'COD' ? 'COD' : 'PREPAID',
              paymentId: paymentId || null,
              totalPrice: total,
              subtotalPrice: subtotal,
              totalTax: 0,
              discountAmount: appliedStoreCredits,
              discountCode: appliedStoreCredits > 0 ? 'STORE_CREDIT' : null,
              currency: 'INR',
              fulfillmentStatus: 'unfulfilled',
              deliveryStatus: 'pending',
              shippingAddress: typeof shippingAddress === 'string' ? shippingAddress : JSON.stringify({
                name: shippingAddress?.name || customer!.name,
                address1: shippingAddress?.address1 || shippingAddress?.line1 || shippingAddress?.street || '',
                address2: shippingAddress?.address2 || shippingAddress?.line2 || '',
                city: shippingAddress?.city || '',
                province: shippingAddress?.province || shippingAddress?.state || '',
                zip: shippingAddress?.zip || shippingAddress?.pincode || '',
                country: shippingAddress?.country || 'India',
                phone: customerPhone || customer!.phone || shippingAddress?.phone || '',
                email: customerEmail || customer!.email || shippingAddress?.email || '',
              }),
              billingAddress: null,
              note,
              tags: finalTags,
              source: 'mobile_app',
              createdAt: now,
              syncedAt: isSyncedNow ? now : null,
              items: {
                create: mobileOrderItems
              }
            }
          });
        }

        return tx.order.update({
          where: { id: existingOrder!.id },
          data: {
            shopifyOrderId: finalShopifyOrderId,
            status: initialStatus,
            paymentStatus,
            paymentMethod: paymentMethod === 'COD' ? 'COD' : 'Razorpay',
            razorpayPaymentId: paymentId || existingOrder!.razorpayPaymentId || null,
            paymentCapturedAt: paymentStatus === 'paid' ? now : existingOrder!.paymentCapturedAt,
            tags: finalTags,
            note: note,
            shippingAddress: typeof shippingAddress === 'string' ? shippingAddress : JSON.stringify({
              name: shippingAddress?.name || customer!.name,
              address1: shippingAddress?.address1 || shippingAddress?.line1 || shippingAddress?.street || '',
              address2: shippingAddress?.address2 || shippingAddress?.line2 || '',
              city: shippingAddress?.city || '',
              province: shippingAddress?.province || shippingAddress?.state || '',
              zip: shippingAddress?.zip || shippingAddress?.pincode || '',
              country: shippingAddress?.country || 'India',
              phone: customerPhone || customer!.phone || shippingAddress?.phone || '',
              email: customerEmail || customer!.email || shippingAddress?.email || '',
            }),
            internalOrderNumber: orderNumber,
            shopifyOrderName: existingOrder!.shopifyOrderName || null,
            shopifySyncStatus: existingOrder!.shopifySyncStatus || 'not_synced',
            shopifySyncError: null,
          }
        });
      });

      // Email trigger
      if (customerEmail && (paymentStatus === 'paid' || paymentMethod === 'COD')) {
        await triggerMobileEmail(updated, orderNumber, subtotal, paymentMethod, total, lineItems, customer, shippingAddress, customerEmail, customerPhone);
      }

      // Mark active or abandoned cart converted and link convertedOrderId
      try {
        const cleanMobPhone = customerPhone ? customerPhone.replace(/\D/g, "") : null;
        const last10MobPhone = cleanMobPhone && cleanMobPhone.length >= 10 ? cleanMobPhone.slice(-10) : cleanMobPhone;

        const matchingCarts = await prisma.cart.findMany({
          where: {
            convertedOrderId: null,
            status: { notIn: ["converted"] },
            OR: [
              ...(resolvedCustomerId ? [{ customerId: resolvedCustomerId }] : []),
              ...(customerPhone ? [{ phone: customerPhone }] : []),
              ...(last10MobPhone ? [{ phone: { contains: last10MobPhone } }] : []),
              ...(customerEmail ? [{ email: { equals: customerEmail, mode: "insensitive" as const } }] : [])
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
              convertedOrderId: updated.id
            }
          });

          if (matchingCarts.length > 1) {
            const extraCartIds = matchingCarts.slice(1).map((c: any) => c.id);
            await prisma.cart.updateMany({
              where: { id: { in: extraCartIds } },
              data: { status: "merged" }
            });
          }
          console.log(`[MobileCheckout] Marked cart converted: ${primaryCart.id} for customer: ${resolvedCustomerId}`);
        }
      } catch (cartErr: any) {
        console.error("[MobileCheckout] Failed to mark cart converted:", cartErr.message);
      }

      // Delegate Shopify order creation to the single choke point
      if (shouldSyncNow) {
        try {
          const syncRes = await syncOrderToShopify(updated.id, { preserveAppTags: true });
          if (syncRes.success && syncRes.shopifyOrderId) {
            finalShopifyOrderId = syncRes.shopifyOrderId;
            isSyncedNow = true;
            await prisma.mobileOrder.updateMany({
              where: { orderNumber },
              data: {
                shopifyOrderId: syncRes.shopifyOrderId,
                status: 'synced',
                syncedAt: new Date(),
              },
            });
          }
        } catch (syncErr: any) {
          console.error('[App API] Shopify sync error:', syncErr.message);
        }
      }

      return NextResponse.json({
        success: true,
        orderId: updated.id,
        orderNumber: orderNumber,
        shopifyOrderId: isSyncedNow ? finalShopifyOrderId : updated.shopifyOrderId,
        status: updated.status,
      }, { headers: corsHeaders });
    }

    const created = await prisma.$transaction(async (tx: any) => {
      // 1. Create order
      const order = await tx.order.create({
        data: {
          shopId: shop.id,
          customerId: resolvedCustomerId,
          shopifyOrderId: finalShopifyOrderId,
          status: initialStatus,
          orderType: 'MOBILE_APP',
          totalPrice: total,
          subtotalPrice: subtotal,
          totalTax: 0,
          currency: 'INR',
          paymentStatus,
          razorpayOrderId: rzpOrderId,
          fulfillmentStatus: 'unfulfilled',
          deliveryStatus: 'pending',
          shippingAddress: typeof shippingAddress === 'string' ? shippingAddress : JSON.stringify({
            name: shippingAddress?.name || customer!.name,
            address1: shippingAddress?.address1 || shippingAddress?.line1 || shippingAddress?.street || '',
            address2: shippingAddress?.address2 || shippingAddress?.line2 || '',
            city: shippingAddress?.city || '',
            province: shippingAddress?.province || shippingAddress?.state || '',
            zip: shippingAddress?.zip || shippingAddress?.pincode || '',
            country: shippingAddress?.country || 'India',
            phone: customerPhone || customer!.phone || shippingAddress?.phone || '',
            email: customerEmail || customer!.email || shippingAddress?.email || '',
          }),
          billingAddress: null,
          note,
          tags: finalTags,
          razorpayPaymentId: paymentId || null,
          paymentMethod: paymentMethod === 'COD' ? 'COD' : 'Razorpay',
          paymentCapturedAt: paymentStatus === 'paid' ? now : null,
          
          internalOrderNumber: orderNumber,
          shopifyOrderName: null,
          shopifySyncStatus: shouldSyncNow ? 'pending' : 'not_synced',
          shopifySyncError: null,

          items: {
            create: await Promise.all(lineItems.map(async (li: any, idx: number) => {
              const rawPid = li.productId || li.product_id;
              const vid = extractNumericId(li.variantId || li.variant_id);
              
              let resolvedPid: string | null = null;
              if (rawPid) {
                const pidStr = String(rawPid);
                const byId = await tx.product.findUnique({ where: { id: pidStr }, select: { id: true } });
                if (byId) {
                  resolvedPid = byId.id;
                } else {
                  const numericPid = extractNumericId(pidStr);
                  if (numericPid) {
                    const byShopifyId = await tx.product.findUnique({ where: { shopifyProductId: numericPid }, select: { id: true } });
                    if (byShopifyId) resolvedPid = byShopifyId.id;
                  }
                }
              }

              return {
                shopifyLineItemId: `app_${orderNumber}_${idx}_${Date.now()}`,
                productId: resolvedPid,
                title: li.name || li.title || 'Product',
                quantity: Number(li.quantity || 0),
                price: Number(li.price || 0),
                sku: li.sku || (vid ? `variant:${vid}` : null),
                image: li.image || li.imageUrl || null,
              };
            })),
          },
          payments:
            paymentStatus === 'paid'
              ? {
                  create: {
                    customerId: resolvedCustomerId,
                    amount: total,
                    type: 'INITIAL',
                    status: 'success',
                    gateway: paymentMethod === 'COD' ? 'cod' : 'razorpay',
                  },
                }
              : undefined,
        },
      });

      // Also create MobileOrder and MobileOrderItem records
      const mobileOrderItems = await Promise.all(lineItems.map(async (li: any) => {
        const rawPid = li.productId || li.product_id;
        const vid = extractNumericId(li.variantId || li.variant_id);
        
        let resolvedPid: string | null = null;
        if (rawPid) {
          const pidStr = String(rawPid);
          const byId = await tx.product.findUnique({ where: { id: pidStr }, select: { id: true } });
          if (byId) {
            resolvedPid = byId.id;
          } else {
            const numericPid = extractNumericId(pidStr);
            if (numericPid) {
              const byShopifyId = await tx.product.findUnique({ where: { shopifyProductId: numericPid }, select: { id: true } });
              if (byShopifyId) resolvedPid = byShopifyId.id;
            }
          }
        }

        return {
          productId: resolvedPid,
          title: li.name || li.title || 'Product',
          quantity: Number(li.quantity || 0),
          price: Number(li.price || 0),
          sku: li.sku || (vid ? `variant:${vid}` : null),
          image: li.image || li.imageUrl || null,
        };
      }));

      await tx.mobileOrder.create({
        data: {
          orderNumber: orderNumber,
          shopifyOrderId: isSyncedNow ? finalShopifyOrderId : null,
          customerId: resolvedCustomerId,
          status: isSyncedNow ? 'synced' : initialStatus,
          paymentStatus,
          paymentMethod: paymentMethod === 'COD' ? 'COD' : 'PREPAID',
          paymentId: paymentId || null,
          totalPrice: total,
          subtotalPrice: subtotal,
          totalTax: 0,
          discountAmount: appliedStoreCredits,
          discountCode: appliedStoreCredits > 0 ? 'STORE_CREDIT' : null,
          currency: 'INR',
          fulfillmentStatus: 'unfulfilled',
          deliveryStatus: 'pending',
          shippingAddress: typeof shippingAddress === 'string' ? shippingAddress : JSON.stringify({
            name: shippingAddress?.name || customer!.name,
            address1: shippingAddress?.address1 || shippingAddress?.line1 || shippingAddress?.street || '',
            address2: shippingAddress?.address2 || shippingAddress?.line2 || '',
            city: shippingAddress?.city || '',
            province: shippingAddress?.province || shippingAddress?.state || '',
            zip: shippingAddress?.zip || shippingAddress?.pincode || '',
            country: shippingAddress?.country || 'India',
            phone: customerPhone || customer!.phone || shippingAddress?.phone || '',
            email: customerEmail || customer!.email || shippingAddress?.email || '',
          }),
          billingAddress: null,
          note,
          tags: finalTags,
          source: 'mobile_app',
          createdAt: now,
          syncedAt: isSyncedNow ? now : null,
          items: {
            create: mobileOrderItems
          }
        }
      });

      return order;
    });

    // ─── Trigger Dynamic Order Confirmation Email ───
    if (customerEmail && (paymentStatus === 'paid' || paymentMethod === 'COD')) {
      await triggerMobileEmail(created, orderNumber, subtotal, paymentMethod, total, lineItems, customer, shippingAddress, customerEmail, customerPhone);
    }

    // Mark active or abandoned cart converted and link convertedOrderId
    try {
      const cleanMobPhone2 = customerPhone ? customerPhone.replace(/\D/g, "") : null;
      const last10MobPhone2 = cleanMobPhone2 && cleanMobPhone2.length >= 10 ? cleanMobPhone2.slice(-10) : cleanMobPhone2;

      const matchingCarts = await prisma.cart.findMany({
        where: {
          convertedOrderId: null,
          status: { notIn: ["converted"] },
          OR: [
            ...(resolvedCustomerId ? [{ customerId: resolvedCustomerId }] : []),
            ...(customerPhone ? [{ phone: customerPhone }] : []),
            ...(last10MobPhone2 ? [{ phone: { contains: last10MobPhone2 } }] : []),
            ...(customerEmail ? [{ email: { equals: customerEmail, mode: "insensitive" as const } }] : [])
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
            convertedOrderId: created.id
          }
        });

        if (matchingCarts.length > 1) {
          const extraCartIds = matchingCarts.slice(1).map((c: any) => c.id);
          await prisma.cart.updateMany({
            where: { id: { in: extraCartIds } },
            data: { status: "merged" }
          });
        }
        console.log(`[MobileCheckout] Marked cart converted: ${primaryCart.id} for customer: ${resolvedCustomerId}`);
      }
    } catch (cartErr: any) {
      console.error("[MobileCheckout] Failed to mark cart converted:", cartErr.message);
    }

    // Delegate Shopify order creation to the single choke point
    if (shouldSyncNow) {
      try {
        const syncRes = await syncOrderToShopify(created.id, { preserveAppTags: true });
        if (syncRes.success && syncRes.shopifyOrderId) {
          finalShopifyOrderId = syncRes.shopifyOrderId;
          isSyncedNow = true;
          await prisma.mobileOrder.updateMany({
            where: { orderNumber },
            data: {
              shopifyOrderId: syncRes.shopifyOrderId,
              status: 'synced',
              syncedAt: new Date(),
            },
          });
        }
      } catch (syncErr: any) {
        console.error('[App API] Shopify sync error:', syncErr.message);
      }
    }

    return NextResponse.json({
      success: true,
      orderId: created.id,
      orderNumber,
      status: created.status,
      shopifyOrderId: isSyncedNow ? finalShopifyOrderId : created.shopifyOrderId,
    }, { headers: corsHeaders });
  } catch (e: any) {
    console.error('[App API] orders/create error:', e);
    return NextResponse.json({ success: false, error: e?.message || 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}

async function triggerMobileEmail(created: any, orderNumber: string, subtotal: number, paymentMethod: string, total: number, lineItems: any[], customer: any, shippingAddress: any, customerEmail: string, customerPhone: string) {
  try {
    const { sendMail } = await import('@/lib/mailer');
    const { orderConfirmationTemplate, renderDBTemplate } = await import('@/lib/email-templates');
    
    const customerName = shippingAddress?.name || customer?.name || 'Customer';
    const formattedItems = lineItems.map((item: any) => {
      let size = item.size || 'N/A';
      if (size === 'N/A' && item.name) {
        const sizeMatch = item.name.match(/\s*-\s*(XXS|XS|S|M|L|XL|XXL|XXXL|\d{2,3})$/i);
        if (sizeMatch) size = sizeMatch[1].toUpperCase();
      }
      return {
        name: item.name || item.title || 'Product',
        size: size,
        qty: item.quantity || 1,
        price: `INR ${item.price || 0}`,
        image: item.image || item.imageUrl || null,
      };
    });

    const itemsHtml = formattedItems
      .map(
        (item: any) => `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid rgba(255,255,255,0.15); border-radius:2px; overflow:hidden; margin-bottom: 15px;">
      <tr>
        <td class="item-img" width="110" style="vertical-align:top; padding:0;">
          ${item.image ? `<img src="${item.image}" width="110" height="130" style="display:block; object-fit:cover; opacity:0.8;" alt="${item.name}" />` : `<div style="width:110px; height:130px; background:rgba(255,255,255,0.05);"></div>`}
        </td>
        <td style="vertical-align:top; padding:20px 20px 20px 22px; border-left:1px solid rgba(255,255,255,0.1);">
          <p style="margin:0 0 4px; font-family:'DM Mono',monospace; font-size:9px; letter-spacing:2px; color:rgba(255,255,255,0.3); text-transform:uppercase;">Qty: ${item.qty}</p>
          <p style="margin:0 0 6px; font-family:'DM Serif Display',serif; font-size:17px; color:rgba(255,255,255,0.7); line-height:1.3;">${item.name}</p>
          ${item.size !== 'N/A' ? `<p style="margin:0 0 14px; font-family:'DM Mono',monospace; font-size:10px; color:rgba(255,255,255,0.3);">Size: ${item.size}</p>` : ''}
          <p style="margin:0; font-family:'DM Mono',monospace; font-size:12px; color:rgba(255,255,255,0.5);">${item.price}</p>
        </td>
      </tr>
    </table>
    `
      )
      .join('');

    const emailVars = {
      customerName,
      customerEmail,
      orderId: orderNumber, // Universal Order ID
      orderDate: new Date(created.createdAt).toLocaleDateString('en-IN', { dateStyle: 'long' }),
      itemsHtml,
      items: itemsHtml,
      products: itemsHtml,
      variants: formattedItems.map((i: any) => `${i.name} (${i.size})`).join(' | '),
      subtotal: `INR ${subtotal}`,
      shipping: `INR ${paymentMethod === 'COD' ? 99 : 0}`,
      total: `INR ${total}`,
      totalPrice: `INR ${total}`,
      amount: `INR ${total}`,
      price: `INR ${total}`,
      currency: 'INR',
      paymentMethod: paymentMethod || 'Prepaid',
      shippingAddress: typeof shippingAddress === 'string' ? shippingAddress : `${shippingAddress?.line1 || shippingAddress?.street || ''}, ${shippingAddress?.city || ''}, ${shippingAddress?.state || ''} - ${shippingAddress?.pincode || shippingAddress?.zip || ''}, ${shippingAddress?.country || 'India'}`,
      orderStatusUrl: `https://zicabella.com/account/orders`,
    };

    const fallbackFn = () => orderConfirmationTemplate({
      customerName,
      orderId: orderNumber, // Universal Order ID
      orderDate: new Date(created.createdAt).toLocaleDateString(),
      items: formattedItems,
      subtotal: `INR ${subtotal}`,
      shipping: `INR ${paymentMethod === 'COD' ? 99 : 0}`,
      total: `INR ${total}`,
      shippingAddress: emailVars.shippingAddress,
    });

    const rendered = await renderDBTemplate('ORDER_CONFIRMATION', emailVars, fallbackFn);

    const emailResult = await sendMail({
      to: customerEmail,
      subject: rendered.subject || `Order Confirmed - ${orderNumber}`,
      html: rendered.html,
    });

    await prisma.emailLog.create({
      data: {
        recipientEmail: customerEmail,
        recipientName: customerName,
        subject: rendered.subject || `Order Confirmed - ${orderNumber}`,
        templateName: 'Order Confirmed',
        triggerEvent: 'app/orders/create',
        referenceId: created.id,
        status: emailResult.messageId ? 'sent' : 'failed',
        messageId: emailResult.messageId || null,
        sentBy: 'system',
      }
    });
  } catch (emailErr: any) {
    console.error('[Email Trigger Error] Failed to send order confirmation email:', emailErr.message);
  }
}
