import { NextResponse } from 'next/server';
import prisma, { getShopSettings } from '@/lib/db';
import { getTrackingStatus } from '@/lib/services/logistics';
import { createOrder as createShopifyOrder } from '@/lib/shopify-admin';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const customerId = url.searchParams.get('customerId')?.trim();
    const phone = url.searchParams.get('phone')?.trim();
    const email = url.searchParams.get('email')?.trim();
    const orderId = url.searchParams.get('orderId')?.trim();
    const limitRaw = url.searchParams.get('limit');
    const offsetRaw = url.searchParams.get('offset');
    const limit = limitRaw ? Math.max(1, Math.min(50, parseInt(limitRaw, 10) || 10)) : null;
    const offset = offsetRaw ? Math.max(0, parseInt(offsetRaw, 10) || 0) : 0;
    // allow 'all' if requested (used by admin dashboard)
    const all = url.searchParams.get('all') === 'true';

    // Quick count mode for admin sync stats (global)
    const countOnly = url.searchParams.get('count') === 'true';
    if (countOnly && !customerId && !phone && !email && !orderId && !all) {
      const total = await prisma.order.count();
      return NextResponse.json({ total }, { headers: corsHeaders });
    }

    // Extract auth token from Authorization header
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    // Allow specialized admin bypass for dashboard sync
    const isAdmin = token === 'ADMIN_SESSION_BYPASS';
    
    console.log(`[Orders GET] Fetching orders. All=${all}, Phone=${phone}, Email=${email}, CustomerId=${customerId}`);

    if (!customerId && !phone && !email && !orderId && !all) {
      return NextResponse.json(
        { orders: [], error: 'customerId, phone, email or orderId query parameter required' },
        { status: 400, headers: corsHeaders }
      );
    }

    let customerIds: string[] = [];

    if (orderId) {
      // Direct order lookup – no need for customer resolution
    } else {
      // Build a flexible customer lookup that handles phone number variants
      const customerWhere: any = { OR: [] };

      if (customerId) customerWhere.OR.push({ id: customerId });

      if (phone) {
        const phoneDigits = phone.replace(/\D/g, '');
        const last10 = phoneDigits.slice(-10);
        customerWhere.OR.push({ phone });
        if (phoneDigits !== phone) customerWhere.OR.push({ phone: phoneDigits });
        if (last10.length === 10) {
          customerWhere.OR.push({ phone: { contains: last10 } });
        }
      }

      if (email) customerWhere.OR.push({ email });

      if (customerWhere.OR.length === 0) {
        return NextResponse.json({ orders: [] }, { headers: corsHeaders });
      }

      const customers = await prisma.customer.findMany({
        where: customerWhere,
        select: { id: true },
      });

      if (customers.length === 0) {
        return NextResponse.json({ orders: [] }, { headers: corsHeaders });
      }
      customerIds = customers.map((c: { id: string }) => c.id);
    }

    const orders = await prisma.order.findMany({
      where: all ? {
        OR: [
          { orderType: 'MOBILE_APP' },
          { tags: { contains: 'mobile-app' } },
          { tags: { contains: 'AppOrder' } }
        ]
      } : (orderId ? { id: orderId } : { 
        customerId: { in: customerIds },
        NOT: {
          OR: [
            { status: { in: ['failed', 'FAILED', 'payment_failed', 'payment_pending'] } },
            { paymentStatus: { in: ['failed', 'payment_failed', 'FAILED', 'PAYMENT_FAILED'] } },
            {
              AND: [
                { paymentStatus: { notIn: ['paid', 'partially_paid', 'refunded', 'partially_refunded', 'PAID', 'PARTIALLY_PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'success', 'SUCCESS'] } },
                { paymentMethod: { notIn: ['COD', 'cod', 'Cash on Delivery', 'cash_on_delivery'] } }
              ]
            }
          ]
        }
      }),
      include: {
        items: {
          include: {
            product: { select: { id: true, shopifyProductId: true, title: true, featuredImage: true } },
          },
        },
        customer: {
          select: { id: true, name: true, email: true, phone: true, shopifyId: true },
        },
        shipments: true,
        returns: true,
        exchanges: true,
        payments: true,
        returnRequests: true,
        exchangeRequests: true,
      },
      orderBy: { createdAt: 'desc' },
      ...(limit ? { skip: offset, take: limit } : {}),
    });

    const formatted = orders.map((o: any) => {
      const latestShipment = o.shipments?.sort(
        (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];

      let parsedShippingAddress: any = null;
      if (o.shippingAddress) {
        try {
          const raw = typeof o.shippingAddress === 'string' ? JSON.parse(o.shippingAddress) : o.shippingAddress;
          parsedShippingAddress = {
            ...raw,
            name: raw.name || raw.first_name ? `${raw.first_name} ${raw.last_name || ''}`.trim() : null,
            address1: raw.address1 || raw.line1 || raw.street || '',
            address2: raw.address2 || raw.line2 || '',
            city: raw.city || '',
            province: raw.province || raw.state || '',
            zip: raw.zip || raw.pincode || '',
          };
        } catch {
          parsedShippingAddress = { raw: o.shippingAddress };
        }
      }

      let parsedBillingAddress = null;
      if (o.billingAddress) {
        try {
          parsedBillingAddress = JSON.parse(o.billingAddress);
        } catch {
          parsedBillingAddress = { raw: o.billingAddress };
        }
      }

      // Extract human-readable order number from shopifyOrderId (e.g. "#ZB71451" → "ZB71451")
      const rawOrderId = o.shopifyOrderId || '';
      const orderNumber = rawOrderId.replace(/^#/, '');

      // Extract variant/size info from item title (e.g. "URBANGLYPH LOWER - XL" → size "XL")
      const itemsFormatted = o.items.map((item: any) => {
        let size: string | null = null;
        let productName = item.title;
        
        // Try to extract size from title like "PRODUCT NAME - SIZE"
        const sizeMatch = item.title.match(/\s*-\s*(XXS|XS|S|M|L|XL|XXL|XXXL|\d{2,3})$/i);
        if (sizeMatch) {
          size = sizeMatch[1].toUpperCase();
          productName = item.title.replace(sizeMatch[0], '').trim();
        }

        return {
          id: item.id,
          lineItemId: item.shopifyLineItemId,
          title: productName,
          fullTitle: item.title,
          quantity: item.quantity,
          price: item.price,
          sku: item.sku,
          size,
          productId: item.productId,
          shopifyProductId: item.product?.shopifyProductId || null,
          image: item.image || item.product?.featuredImage || null,
        };
      });

      // Status Normalization
      let normalizedStatus = (o.status || 'PENDING').toUpperCase();
      if (normalizedStatus.includes(' / ')) {
        normalizedStatus = normalizedStatus.split(' / ')[0].trim();
      }
      
      // Payment method extraction
      const paymentGateway = o.payments?.[0]?.gateway || null;
      const paymentMethod = paymentGateway 
        ? paymentGateway.includes('COD') || paymentGateway.includes('Cash') 
          ? 'Cash on Delivery'
          : paymentGateway
        : null;

      // Parse note for discount/shipping info
      let discountInfo = null;
      let shippingMethodInfo = null;
      if (o.note) {
        const discountMatch = o.note.match(/Discount:\s*([^\|]+)/);
        if (discountMatch) discountInfo = discountMatch[1].trim();
        const shippingMatch = o.note.match(/Shipping:\s*([^\|]+)/);
        if (shippingMatch) shippingMethodInfo = shippingMatch[1].trim();
      }


      // Build comprehensive status timeline for the app
      const timeline = {
        placedAt: o.createdAt,
        confirmedAt: o.paymentStatus === 'paid' ? o.updatedAt : null,
        packedAt: (o.fulfillmentStatus && String(o.fulfillmentStatus).toLowerCase() !== 'unfulfilled') ? o.updatedAt : null,
        shippedAt: latestShipment?.createdAt || (o.fulfillmentStatus && String(o.fulfillmentStatus).toLowerCase() !== 'unfulfilled' ? o.updatedAt : null),
        outForDeliveryAt: String(o.deliveryStatus || '').toLowerCase() === 'out_for_delivery' ? o.updatedAt : null,
        deliveredAt: String(o.deliveryStatus || '').toLowerCase() === 'delivered' ? o.updatedAt : null,
      };

      const statusTimeline = [
        { step: 'order_placed', label: 'Order Placed', completedAt: timeline.placedAt },
        { step: 'confirmed', label: 'Confirmed', completedAt: timeline.confirmedAt },
        { step: 'shipped', label: 'Shipped', completedAt: timeline.shippedAt },
        { step: 'out_for_delivery', label: 'Out for Delivery', completedAt: timeline.outForDeliveryAt },
        { step: 'delivered', label: 'Delivered', completedAt: timeline.deliveredAt },
      ];

      return {
        id: o.id,
        orderNumber,
        shopifyOrderId: o.shopifyOrderId,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        status: normalizedStatus,
        rawStatus: o.status,
        paymentStatus: o.paymentStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        deliveryStatus: o.deliveryStatus,
        trackingNumber: latestShipment?.trackingNumber || null,
        trackingUrl: latestShipment?.trackingUrl || (latestShipment?.trackingNumber
          ? latestShipment.courier?.toLowerCase() === 'shiprocket'
            ? `https://shiprocket.co/tracking/${latestShipment.trackingNumber}`
            : `https://www.delhivery.com/track/package/${latestShipment.trackingNumber}`
          : null),
        courier: latestShipment?.courier || null,
        shipmentCreatedAt: latestShipment?.createdAt || null,
        totalPrice: o.totalPrice,
        subtotalPrice: o.subtotalPrice,
        totalTax: o.totalTax,
        currency: o.currency,
        note: o.note,
        tags: o.tags,
        paymentMethod,
        paymentMethod2: o.paymentMethod, // direct from DB
        razorpayOrderId: o.razorpayOrderId,
        razorpayPaymentId: o.razorpayPaymentId,
        shippingMethod: shippingMethodInfo,
        discountInfo,
        shippingAddress: parsedShippingAddress,
        billingAddress: parsedBillingAddress,
        customer: o.customer ? {
          id: o.customer.id,
          name: o.customer.name,
          email: o.customer.email,
          phone: o.customer.phone,
        } : null,
        items: itemsFormatted,
        returns: (o.returns || []).map((r: any) => ({
          id: r.id,
          productId: r.productId,
          reason: r.reason,
          status: r.status,
          refundMethod: r.refundMethod,
          refundAmount: r.refundAmount,
          requestedAt: r.requestedAt,
        })),
        exchanges: (o.exchanges || []).map((e: any) => ({
          id: e.id,
          originalProductId: e.originalProductId,
          newProductId: e.newProductId,
          status: e.status,
          priceDifference: e.priceDifference,
          createdAt: e.createdAt,
        })),
        returnRequests: (o.returnRequests || []).map((r: any) => ({
          id: r.id,
          orderId: r.orderId,
          customerId: r.customerId,
          status: r.status,
          estimatedRefund: r.estimatedRefund,
          actualRefund: r.actualRefund,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          approvedAt: r.approvedAt,
          reason: r.reason,
        })),
        exchangeRequests: (o.exchangeRequests || []).map((e: any) => ({
          id: e.id,
          orderId: e.orderId,
          customerId: e.customerId,
          status: e.status,
          priceDifference: e.priceDifference,
          paymentStatus: e.paymentStatus,
          paymentId: e.paymentId,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
          reason: e.reason,
          returnRequestId: e.returnRequestId,
          newShopifyOrderId: e.newShopifyOrderId,
        })),
        timeline,
        statusTimeline, // Added for mobile app compatibility
        shipmentEvents: (() => {
          if (!latestShipment?.events) return [];
          try {
            return typeof latestShipment.events === 'string' ? JSON.parse(latestShipment.events) : latestShipment.events;
          } catch (e) {
            console.error('Failed to parse shipment events:', e);
            return [];
          }
        })(),
      };
    });

    // Real-time tracking refresh if single order requested
    if (orderId && formatted.length > 0) {
      const order = formatted[0];
      if (order.trackingNumber && order.deliveryStatus !== 'delivered') {
        try {
          const status = await getTrackingStatus(order.trackingNumber);
          if (status && status.status !== 'unknown') {
             // Update the order object in memory for the response
             order.deliveryStatus = status.status;
             order.shipmentEvents = status.events;
             if (status.estimatedDelivery) {
                (order.timeline as any).estimatedDelivery = status.estimatedDelivery;
             }

             // Update statusTimeline too
             if (status.status.toLowerCase() === 'delivered') {
               const deliveredStep = order.statusTimeline.find((s: any) => s.step === 'delivered');
               if (deliveredStep) deliveredStep.completedAt = new Date().toISOString();
             }
             if (status.status.toLowerCase() === 'out_for_delivery') {
               const ofdStep = order.statusTimeline.find((s: any) => s.step === 'out_for_delivery');
               if (ofdStep) ofdStep.completedAt = new Date().toISOString();
             }

             // Update DB in background
             prisma.shipment.updateMany({
               where: { trackingNumber: order.trackingNumber },
               data: { 
                 status: status.status,
                 currentLocation: status.location,
                 estimatedDelivery: status.estimatedDelivery ? new Date(status.estimatedDelivery) : undefined,
                 events: JSON.stringify(status.events)
               }
             }).catch((e: any) => console.error('DB Status Sync Error:', e));

             // Also update order delivery status if changed
             if (status.status.toLowerCase() === 'delivered') {
                prisma.order.update({
                   where: { id: order.id },
                   data: { deliveryStatus: 'delivered' }
                }).catch((e: any) => console.error('DB Order Sync Error:', e));
             }
          }
        } catch (e: any) {
          console.error('Real-time sync failed:', e);
        }
      }
    }

    // Optional pagination metadata
    if (limit && !orderId) {
      const total = await prisma.order.count({
        where: { customerId: { in: customerIds } },
      });
      const hasMore = offset + formatted.length < total;
      return NextResponse.json({ orders: formatted, page: { limit, offset, total, hasMore } }, { headers: corsHeaders });
    }

    if (orderId && formatted.length > 0) {
      return NextResponse.json({ order: formatted[0] }, { headers: corsHeaders });
    }

    return NextResponse.json({ orders: formatted }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[App API] Orders error:', error.message);
    return NextResponse.json(
      { orders: [], error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      customerId, 
      email,
      phone,
      lineItems, 
      shipping_address, 
      appliedStoreCredits = 0, 
      payment_method = 'razorpay',
      financial_status = 'pending',
      payment_id = null,
      razorpay_order_id = null,
      total_price = 0,
      subtotal_price = 0,
      currency = 'INR'
    } = body;

    if (!lineItems?.length || !customerId) {
      return NextResponse.json(
        { success: false, error: 'lineItems and customerId are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // 0. Resolve Customer
    let customer = null;
    
    if (customerId && customerId !== 'GUEST') {
      customer = await prisma.customer.findUnique({
        where: { id: customerId }
      });
    }

    if (!customer && email) {
      customer = await prisma.customer.findFirst({
        where: { email }
      });
    }

    if (!customer && phone) {
      const phoneDigits = phone.replace(/\D/g, '');
      if (phoneDigits.length >= 10) {
        customer = await prisma.customer.findFirst({
          where: { phone: { contains: phoneDigits.slice(-10) } }
        });
      }
    }

    if (!customer) {
      const shop = await prisma.shop.findFirst();
      customer = await prisma.customer.create({
        data: {
          shopId: shop?.id || '',
          shopifyId: `guest_${Date.now()}`,
          name: shipping_address?.first_name ? `${shipping_address.first_name} ${shipping_address.last_name || ''}`.trim() : 'Guest User',
          email: email || 'guest@zicabella.com',
          phone: phone || shipping_address?.phone || '',
        }
      });
    }

    const resolvedCustomerId = customer.id;

    // 1. Handle Store Credits if applied
    let creditReduction = 0;
    if (appliedStoreCredits > 0) {
      try {
        const { debitStoreCredits } = await import('@/lib/storeCreditsHelper');
        await debitStoreCredits(resolvedCustomerId, appliedStoreCredits, `mobile_purchase`);
        creditReduction = appliedStoreCredits;
      } catch (debitErr: any) {
        return NextResponse.json(
          { success: false, error: debitErr.message },
          { status: 400, headers: corsHeaders }
        );
      }
    }

    // 2. Create order in Shopify
    // Use shopifyId if available, otherwise fallback to email/phone
    const shopifyOrderPayload: any = {
      line_items: lineItems.map((li: any) => ({
        variant_id: parseInt(li.variant_id, 10) || li.variant_id,
        quantity: li.quantity || 1,
        title: li.title,
      })).filter((li: any) => li.variant_id),
      financial_status: financial_status === 'paid' ? 'paid' : 'pending',
      tags: `AppOrder, ${payment_method.toUpperCase() === 'COD' ? 'COD' : 'Prepaid, Razorpay'}${creditReduction > 0 ? `, Credit: ${creditReduction}` : ''}`,
      note: `Ordered via Zica Bella App. Method: ${payment_method.toUpperCase()}. ${creditReduction > 0 ? `Used ${creditReduction} credits.` : ''}`,
      shipping_address,
      use_customer_default_address: !shipping_address,
    };

    if (customer.shopifyId && !customer.shopifyId.startsWith('GUEST')) {
      shopifyOrderPayload.customer = { id: parseInt(customer.shopifyId, 10) };
    } else {
      shopifyOrderPayload.customer = {
        email: customer.email,
        first_name: customer.name?.split(' ')[0] || 'App',
        last_name: customer.name?.split(' ').slice(1).join(' ') || 'User',
      };
    }

    // Add transactions for prepaid orders so Shopify records the correct gateway
    if (financial_status === 'paid' && payment_method.toUpperCase() !== 'COD') {
      shopifyOrderPayload.transactions = [{
        kind: "sale",
        status: "success",
        amount: parseFloat(String(total_price || 0)).toFixed(2),
        currency: currency || "INR",
        gateway: "razorpay",
        authorization: payment_id || null
      }];
    }

    
    let shopifyOrder: any = null;
    let fallbackOrderId = `app_pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    try {
      shopifyOrder = await createShopifyOrder(shopifyOrderPayload);
    } catch (shopifyErr: any) {
      console.error('[App API] Shopify order creation failed (will sync later):', shopifyErr.message);
      // We will proceed with saving the order locally
    }

    // 3. Save to local database
    const shop = await getShopSettings();
    if (!shop) throw new Error('No shop configuration found');

    const localOrder = await prisma.order.create({
      data: {
        shopId: shop.id,
        customerId: resolvedCustomerId,
        shopifyOrderId: shopifyOrder ? String(shopifyOrder.id) : fallbackOrderId,
        totalPrice: total_price || (shopifyOrder ? parseFloat(shopifyOrder.total_price) : 0),
        subtotalPrice: subtotal_price || (shopifyOrder ? parseFloat(shopifyOrder.subtotal_price) : 0),
        currency: currency || (shopifyOrder ? shopifyOrder.currency : 'INR'),
        orderType: 'MOBILE_APP',
        status: financial_status === 'paid' ? 'approved' : 'OPEN',
        paymentStatus: financial_status,
        fulfillmentStatus: 'unfulfilled',
        shippingAddress: typeof ((shopifyOrder ? shopifyOrder.shipping_address : null) || shipping_address) === 'string' 
          ? ((shopifyOrder ? shopifyOrder.shipping_address : null) || shipping_address)
          : JSON.stringify((shopifyOrder ? shopifyOrder.shipping_address : null) || shipping_address),
        razorpayOrderId: razorpay_order_id || undefined,
        razorpayPaymentId: payment_id || undefined,
        paymentMethod: payment_method,
        tags: shopifyOrder ? shopifyOrder.tags : shopifyOrderPayload.tags,
        items: {
          create: await Promise.all((shopifyOrder ? shopifyOrder.line_items : lineItems).map(async (li: any, idx: number) => {
            // Resolve product ID: validate it actually exists in our DB
            let validProductId: string | undefined = undefined;

            if (shopifyOrder) {
              // From Shopify line item — look up by shopifyProductId
              if (li.product_id) {
                const p = await prisma.product.findUnique({ where: { shopifyProductId: String(li.product_id) } });
                if (p) validProductId = p.id;
              }
            } else {
              // From app line item — product_id could be a Prisma CUID or a Shopify ID
              const appProductId = li.product_id || li.productId;
              if (appProductId) {
                // First try as direct Prisma ID
                const byId = await prisma.product.findUnique({ where: { id: appProductId } }).catch(() => null);
                if (byId) {
                  validProductId = byId.id;
                } else {
                  // Try as Shopify product ID
                  const bySid = await prisma.product.findUnique({ where: { shopifyProductId: String(appProductId) } }).catch(() => null);
                  if (bySid) validProductId = bySid.id;
                }
              }
            }

            return {
              shopifyLineItemId: shopifyOrder ? String(li.id) : `app_${Date.now()}_${idx}_${li.variant_id || li.variantId || Math.random().toString(36).slice(2, 8)}`,
              productId: validProductId,
              title: li.title || li.name || 'Product',
              quantity: li.quantity || 1,
              price: shopifyOrder ? parseFloat(li.price) : parseFloat(li.price || 0),
              sku: li.sku || null,
            };
          }))
        }
      },
      include: { items: true }
    });

    // 4. Record initial payment if captured
    if (financial_status === 'paid' && payment_id) {
       await prisma.payment.create({
         data: {
           orderId: localOrder.id,
           customerId: resolvedCustomerId,
           amount: localOrder.totalPrice,
           type: 'INITIAL',
           status: 'success',
           gateway: payment_method,
         }
       });
    }

    // 5. Affiliate / Creator Attribution
    try {
      const { attributeOrder } = await import('@/lib/affiliate/attribution');
      await attributeOrder({ orderId: localOrder.id, req });
    } catch (affErr: any) {
      console.warn('[App API] Affiliate attribution failed non-fatally:', affErr.message);
    }

    return NextResponse.json({ success: true, order: localOrder }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[App API] Create order error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
