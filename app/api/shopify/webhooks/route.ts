import { NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/db';
import { extractSizeFromVariant } from '@/lib/utils';
import { refreshStorefront } from '@/lib/storefrontRefresh';

export async function POST(req: Request) {
  try {
    const topic = req.headers.get('x-shopify-topic');
    const shop = req.headers.get('x-shopify-shop-domain');
    const hmac = req.headers.get('x-shopify-hmac-sha256');
    const webhookId = req.headers.get('x-shopify-webhook-id');

    if (!topic || !shop || !hmac) {
      return NextResponse.json({ error: 'Missing webhook headers' }, { status: 400 });
    }

    const rawBody = await req.text();
    let verified = false;
    if (process.env.SHOPIFY_API_SECRET) {
      const hash = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(rawBody, 'utf8').digest('base64');
      if (hash === hmac) verified = true;
    }
    if (!verified && process.env.SHOPIFY_WEBHOOK_SECRET) {
      const hash = crypto.createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET).update(rawBody, 'utf8').digest('base64');
      if (hash === hmac) verified = true;
    }

    if (!verified) {
      console.warn('Webhook HMAC validation failed (Warning only for dev/testing)');
      // If NOT in development and we have configured secrets, reject the request
      if (process.env.NODE_ENV === 'production') {
        console.error('Webhook signature validation failed in production. Blocking request.');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Idempotency check: prevent duplicate webhook processing
    if (webhookId) {
      try {
        const existing = await prisma.webhookEvent.findFirst({
          where: {
            source: 'shopify-admin',
            eventType: topic,
            payload: { contains: webhookId },
            processed: true,
          },
        });
        if (existing) {
          return NextResponse.json({ success: true, message: 'Webhook already processed' }, { status: 200 });
        }
      } catch (dbErr) {
        console.warn('[Shopify Admin Webhook] Idempotency lookup error:', dbErr);
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    switch (topic) {
      case 'orders/create':
      case 'orders/paid':
      case 'orders/fulfilled':
      case 'orders/cancelled':
      case 'orders/updated':
        await handleOrderWebhook(shop, payload, topic);
        break;
      case 'fulfillments/create':
      case 'fulfillments/update':
        await handleFulfillmentWebhook(shop, payload);
        break;
      case 'refunds/create':
        await handleRefundWebhook(shop, payload);
        break;
      case 'inventory_levels/update':
        await handleInventoryWebhook(shop, payload);
        break;
      case 'products/create':
      case 'products/update':
      case 'products/delete':
      case 'collections/create':
      case 'collections/update':
      case 'collections/delete':
        // Catalogue changed in Shopify → drop cached copies and re-render the storefront pages.
        await refreshStorefront();
        break;
      default:
        console.log(`Unhandled webhook topic: ${topic}`);
    }

    // Record webhook event in database for idempotency & audit
    if (webhookId) {
      try {
        await prisma.webhookEvent.create({
          data: {
            source: 'shopify-admin',
            eventType: topic,
            payload: JSON.stringify({ webhookId, shop, topic, receivedAt: new Date().toISOString() }),
            processed: true,
            processedAt: new Date(),
          },
        });
      } catch (dbErr) {
        console.warn('[Shopify Admin Webhook] Failed to log webhook event:', dbErr);
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error(`Error processing webhook:`, error);
    return NextResponse.json({ error: error?.message || 'Internal server error processing webhook' }, { status: 500 });
  }
}

async function handleOrderWebhook(shop: string, orderData: any, topic?: string) {
  let shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) {
     shopRecord = await prisma.shop.create({ data: { domain: shop, accessToken: 'dummy_for_webhook' }});
  }

  const customerId = orderData.customer?.id?.toString() || 'anonymous';
  let dbCustomer;
  
  if (orderData.customer) {
    dbCustomer = await prisma.customer.upsert({
      where: { shopifyId: customerId },
      create: {
        shopId: shopRecord.id,
        shopifyId: customerId,
        email: orderData.customer.email,
        name: `${orderData.customer.first_name || ''} ${orderData.customer.last_name || ''}`.trim(),
        phone: orderData.customer.phone
      },
      update: {
        email: orderData.customer.email,
        name: `${orderData.customer.first_name || ''} ${orderData.customer.last_name || ''}`.trim(),
        phone: orderData.customer.phone
      }
    });
  } else {
    dbCustomer = await prisma.customer.upsert({
      where: { shopifyId: 'anonymous' },
      create: { shopId: shopRecord.id, shopifyId: 'anonymous', name: 'Anonymous Customer' },
      update: {}
    });
  }

  const orderDate = orderData.created_at ? new Date(orderData.created_at) : new Date();

  // Determine delivery status from fulfillments and tags
  let deliveryStatus = 'pending';
  const lowerTags = (orderData.tags || '').toLowerCase();
  
  if (orderData.fulfillment_status === 'fulfilled') {
    deliveryStatus = 'shipped';
  }

  if (lowerTags.includes('delivered') || lowerTags.includes('shipped_successfully')) {
    deliveryStatus = 'delivered';
  }
  
  if (orderData.fulfillments && Array.isArray(orderData.fulfillments)) {
    for (const f of orderData.fulfillments) {
      const fStatus = (f.shipment_status || '').toLowerCase();
      if (fStatus === 'delivered' || fStatus === 'shipped' || fStatus === 'success') {
        deliveryStatus = 'delivered';
        break;
      } else if (fStatus === 'out_for_delivery') {
        deliveryStatus = 'out_for_delivery';
        break;
      }
    }
  }

  const isMobileAppOrder = lowerTags.includes('apporder') || lowerTags.includes('mobileapp');
  // NOTE: Order.status is intentionally coarse-grained: 'active', 'approved', or 'cancelled'.
  // It does NOT reflect delivery lifecycle states like 'shipped' or 'delivered'.
  // For shipment/delivery state, use Order.deliveryStatus and Order.fulfillmentStatus — those
  // are the fields of record, set by both this webhook handler and manual admin actions.
  let finalStatus = isMobileAppOrder ? 'approved' : 'active';
  
  if (topic === 'orders/cancelled' || orderData.cancelled_at) {
    finalStatus = 'cancelled';
    deliveryStatus = 'cancelled';
    orderData.fulfillment_status = 'cancelled';
  }

  // Attempt to link order by internalOrderNumber if shopifyOrderId doesn't match
  let existingLocalOrder = await prisma.order.findUnique({
    where: { shopifyOrderId: orderData.id.toString() }
  });

  let extractedNumber = '';
  if (!existingLocalOrder) {
    // 1. Try tags matching
    const tagMatch = (orderData.tags || '').match(/zb-order-(ZB(?:PF|PP|CX|XX)?\d+|ZB-\d{4}-\d{5})/i);
    if (tagMatch) {
      extractedNumber = tagMatch[1];
    }

    // 2. Try note attributes matching
    if (!extractedNumber && orderData.note_attributes) {
      const attr = orderData.note_attributes.find((na: any) => na.name === 'internal_order_number');
      if (attr && typeof attr.value === 'string' && attr.value.startsWith('ZB')) {
        extractedNumber = attr.value;
      }
    }

    if (extractedNumber) {
      console.log(`[Webhook] Extracted internal order number: ${extractedNumber}. Searching local database...`);
      const matchedOrder = await prisma.order.findUnique({
        where: { internalOrderNumber: extractedNumber }
      });
      if (matchedOrder) {
        console.log(`[Webhook] Found matching local order ${matchedOrder.id}. Updating shopifyOrderId to ${orderData.id}...`);
        existingLocalOrder = await prisma.order.update({
          where: { id: matchedOrder.id },
          data: {
            shopifyOrderId: orderData.id.toString(),
            shopifyOrderName: orderData.name || null,
            shopifySyncStatus: 'synced',
            shopifySyncError: null
          }
        });

        // Also update corresponding WebStoreOrder or MobileOrder if needed
        if (matchedOrder.orderType === 'WEB_STORE') {
          await prisma.webStoreOrder.updateMany({
            where: { orderNumber: extractedNumber },
            data: {
              notes: `Linked to Shopify: ${orderData.id.toString()} | Local: ${matchedOrder.id}`,
              shopifyOrderId: orderData.id.toString(),
              shopifyOrderName: orderData.name || null,
            }
          }).catch((e: any) => {
            console.error('[Webhook] Failed to update webStoreOrder notes and link:', e.message);
          });
        } else if (matchedOrder.orderType === 'MOBILE_APP') {
          await prisma.mobileOrder.updateMany({
            where: { orderNumber: extractedNumber },
            data: {
              shopifyOrderId: orderData.id.toString(),
              status: 'synced'
            }
          }).catch((e: any) => {
            console.error('[Webhook] Failed to update mobileOrder status:', e.message);
          });
        }
      }
    }
  }

  // Resolve WebStoreOrder to get discount details
  let webStoreOrder = null;
  const lookupNumber = extractedNumber || existingLocalOrder?.internalOrderNumber;
  if (lookupNumber) {
    webStoreOrder = await prisma.webStoreOrder.findUnique({
      where: { orderNumber: lookupNumber }
    });
  }
  if (!webStoreOrder) {
    webStoreOrder = await prisma.webStoreOrder.findFirst({
      where: {
        OR: [
          { shopifyOrderId: orderData.id.toString() },
          { razorpayOrderId: orderData.id.toString() },
          { notes: { contains: `Shopify: ${orderData.id}` } }
        ]
      }
    });
  }

  const discountAmount = webStoreOrder?.discountAmount 
    ? Number(webStoreOrder.discountAmount) 
    : (existingLocalOrder?.discountAmount || 0);
  const discountCode = webStoreOrder?.discountCode 
    ? webStoreOrder.discountCode 
    : (existingLocalOrder?.discountCode || null);

  let finalTotalPrice = parseFloat(orderData.total_price || '0');
  const finalSubtotalPrice = orderData.total_line_items_price 
    ? parseFloat(orderData.total_line_items_price) 
    : (orderData.subtotal_price ? parseFloat(orderData.subtotal_price) : finalTotalPrice);

  // Auto-correct undiscounted totalPrice synced from Shopify
  if (discountAmount > 0 && Math.abs(finalTotalPrice - finalSubtotalPrice) < 0.01) {
    finalTotalPrice = finalSubtotalPrice - discountAmount;
  }

  const order = await prisma.order.upsert({
    where: { shopifyOrderId: orderData.id.toString() },
    create: {
      shopId: shopRecord.id,
      shopifyOrderId: orderData.id.toString(),
      shopifyOrderName: orderData.name || null,
      internalOrderNumber: extractedNumber || null,
      shopifySyncStatus: 'synced',
      customerId: dbCustomer.id,
      status: finalStatus,
      totalPrice: finalTotalPrice,
      subtotalPrice: finalSubtotalPrice,
      totalTax: parseFloat(orderData.total_tax || '0'),
      currency: orderData.currency || 'INR',
      paymentStatus: orderData.financial_status || 'pending',
      paymentMethod: orderData.gateway || (orderData.payment_gateway_names && orderData.payment_gateway_names[0]) || null,
      fulfillmentStatus: orderData.fulfillment_status || 'unfulfilled',
      deliveryStatus: deliveryStatus,
      deliveredAt: deliveryStatus === 'delivered' ? new Date() : null,
      shippingAddress: orderData.shipping_address ? JSON.stringify(orderData.shipping_address) : null,
      billingAddress: orderData.billing_address ? JSON.stringify(orderData.billing_address) : null,
      note: orderData.note || null,
      tags: orderData.tags || null,
      discountAmount: discountAmount,
      discountCode: discountCode,
      createdAt: orderDate
    },
    update: {
      status: finalStatus,
      shopifyOrderName: orderData.name || null,
      totalPrice: finalTotalPrice,
      subtotalPrice: finalSubtotalPrice,
      totalTax: parseFloat(orderData.total_tax || '0'),
      currency: orderData.currency || 'INR',
      paymentStatus: orderData.financial_status || 'pending',
      paymentMethod: orderData.gateway || (orderData.payment_gateway_names && orderData.payment_gateway_names[0]) || null,
      fulfillmentStatus: orderData.fulfillment_status || 'unfulfilled',
      deliveryStatus: deliveryStatus,
      ...(deliveryStatus === 'delivered' ? { deliveredAt: existingLocalOrder?.deliveredAt || new Date() } : {}),
      shippingAddress: orderData.shipping_address ? JSON.stringify(orderData.shipping_address) : null,
      billingAddress: orderData.billing_address ? JSON.stringify(orderData.billing_address) : null,
      note: orderData.note || null,
      tags: orderData.tags || null,
      discountAmount: discountAmount,
      discountCode: discountCode,
    }
  });

  // Sync Fulfillments / Tracking Details to Shipment table in DB
  if (orderData.fulfillments && Array.isArray(orderData.fulfillments) && orderData.fulfillments.length > 0) {
    for (const f of orderData.fulfillments) {
      const trackingNumber = f.tracking_number || f.tracking_numbers?.[0];
      const courier = f.tracking_company || f.courier || 'Standard Express';
      const trackingUrl = f.tracking_url || f.tracking_urls?.[0] || (trackingNumber ? `https://www.shiprocket.in/shipment-tracking/?awb=${trackingNumber}` : null);
      
      if (trackingNumber) {
        await prisma.shipment.upsert({
          where: { awb: trackingNumber },
          create: {
            orderId: order.id,
            awb: trackingNumber,
            trackingNumber: trackingNumber,
            courier: courier,
            status: deliveryStatus,
            trackingUrl: trackingUrl,
          },
          update: {
            courier: courier,
            status: deliveryStatus,
            trackingUrl: trackingUrl,
          }
        }).catch((e: any) => console.error('[Webhook] Failed to upsert shipment:', e.message));

        await prisma.order.update({
          where: { id: order.id },
          data: {
            delhivery_awb: trackingNumber,
            tracking_status: deliveryStatus
          }
        }).catch((e: any) => console.error('[Webhook] Failed to update order AWB:', e.message));
      }
    }
  }

  // Fallback resolve WebStoreOrder if not matched earlier
  if (!webStoreOrder && (order.internalOrderNumber || order.shopifyOrderId)) {
    webStoreOrder = await prisma.webStoreOrder.findFirst({
      where: {
        OR: [
          ...(order.shopifyOrderId ? [{ shopifyOrderId: order.shopifyOrderId }] : []),
          ...(order.internalOrderNumber ? [{ orderNumber: order.internalOrderNumber }] : []),
        ]
      }
    }).catch(() => null);
  }

  // ── Sync fulfillment/tracking/delivery back to the customer-facing WebStoreOrder ──
  if (webStoreOrder) {
    // Derive tracking from fulfillments (first with an AWB), fall back to Order fields
    let wsTrackingNumber: string | null = null;
    let wsTrackingUrl: string | null = null;
    if (Array.isArray(orderData.fulfillments)) {
      for (const f of orderData.fulfillments) {
        const tn = f.tracking_number || f.tracking_numbers?.[0] || null;
        if (tn) {
          wsTrackingNumber = tn;
          wsTrackingUrl = f.tracking_url || f.tracking_urls?.[0]
            || (tn ? `https://www.shiprocket.in/shipment-tracking/?awb=${tn}` : null);
          break;
        }
      }
    }
    if (!wsTrackingNumber && !webStoreOrder.trackingNumber && order.delhivery_awb) {
      wsTrackingNumber = order.delhivery_awb;
    }

    const wsData: any = {
      fulfillmentStatus: orderData.fulfillment_status || webStoreOrder.fulfillmentStatus || 'unfulfilled',
      deliveryStatus: deliveryStatus,
    };
    // Only overwrite tracking fields when we actually have a value — never null out a
    // manually-entered AWB from the admin PATCH.
    if (wsTrackingNumber) wsData.trackingNumber = wsTrackingNumber;
    if (wsTrackingUrl) wsData.trackingUrl = wsTrackingUrl;
    if (deliveryStatus === 'delivered') wsData.deliveredAt = webStoreOrder.deliveredAt || new Date();
    // Ensure the link is persisted even if B1 didn't run this cycle
    if (!webStoreOrder.shopifyOrderId) {
      wsData.shopifyOrderId = orderData.id.toString();
      wsData.shopifyOrderName = orderData.name || null;
    }

    await prisma.webStoreOrder.update({
      where: { id: webStoreOrder.id },
      data: wsData,
    }).catch((e: any) => console.error('[Webhook] Failed to sync tracking to webStoreOrder:', e.message));
  }

  if (finalStatus === 'cancelled') {
    try {
      const { processOrderRefund } = await import('@/lib/services/refundService');
      await processOrderRefund(order.id);
    } catch (refundErr) {
      console.error(`[Webhook Route] Refund failed for order ${order.id}:`, refundErr);
    }
  }

  // Guard line-item sync: only delete local items not in payload when we have
  // an authoritative, full line-item list. Thin/partial payloads on topics like
  // orders/fulfilled or orders/cancelled may omit items and must not trigger deletion.
  if (orderData.line_items && Array.isArray(orderData.line_items) && orderData.line_items.length > 0) {
    const shopifyItemIds = orderData.line_items.map((item: any) => item.id.toString());

    // Only delete items that are no longer in the payload on authoritative topics
    const isAuthoritativeTopic = topic === 'orders/create' || topic === 'orders/updated';
    if (isAuthoritativeTopic) {
      // Safety check: count existing local items and compare with payload
      const existingItemCount = await prisma.orderItem.count({ where: { orderId: order.id } });
      const payloadItemCount = orderData.line_items.length;

      if (existingItemCount > 0 && payloadItemCount < existingItemCount * 0.5) {
        // Payload has significantly fewer items than local — likely a partial/thin payload
        console.warn(
          `[Webhook] SKIPPING item deletion for order ${order.id}: ` +
          `payload has ${payloadItemCount} items but local DB has ${existingItemCount}. ` +
          `This looks like a partial payload that could wipe legitimate items.`
        );
      } else {
        await prisma.orderItem.deleteMany({
          where: {
            orderId: order.id,
            shopifyLineItemId: { notIn: shopifyItemIds }
          }
        });
      }
    }

    for (const item of orderData.line_items) {
      const shopifyProductId = item.product_id?.toString();
      let dbProductId = null;
      let itemImage = null;
      
      if (shopifyProductId) {
        const prod = await prisma.product.findUnique({ where: { shopifyProductId } });
        dbProductId = prod?.id || null;
        itemImage = prod?.featuredImage || null;
      }

      const vTitle = item.variant_title && item.variant_title !== "Default Title" ? item.variant_title : null;
      const vId = item.variant_id ? String(item.variant_id) : null;
      const itemSize = extractSizeFromVariant(item.variant_title, item.sku, item.title);

      await prisma.orderItem.upsert({
        where: { shopifyLineItemId: item.id.toString() },
        create: {
          orderId: order.id,
          shopifyLineItemId: item.id.toString(),
          productId: dbProductId, 
          title: item.title,
          quantity: item.quantity,
          price: parseFloat(item.price || '0'),
          sku: item.sku || null,
          image: itemImage || null,
          variantId: vId,
          variantTitle: vTitle,
          size: itemSize,
        },
        update: {
          quantity: item.quantity,
          price: parseFloat(item.price || '0'),
          sku: item.sku || null,
          image: itemImage || null,
          variantId: vId,
          variantTitle: vTitle,
          size: itemSize,
        }
      });
    }
  }

  // Trigger WhatsApp Notifications
  const phone = orderData.customer?.phone || orderData.billing_address?.phone || orderData.shipping_address?.phone || dbCustomer?.phone;
  if (phone) {
    try {
      const { getWhatsAppSetting } = await import('@/lib/whatsapp/logger');
      let orderIdStr = orderData.order_number || orderData.id?.toString();
      if (order.internalOrderNumber) {
        orderIdStr = order.internalOrderNumber;
      }

      if (topic === 'orders/create' || (topic === 'orders/paid' && order.paymentStatus === 'paid')) {
        const gateway = (orderData.gateway || (orderData.payment_gateway_names && orderData.payment_gateway_names[0]) || '').toLowerCase();
        const isCOD = gateway.includes('cod') || gateway.includes('cash_on_delivery') || gateway.includes('delivery') || gateway.includes('manual');

        if (isCOD) {
          const isCodEnabled = await getWhatsAppSetting('cod_confirmation_enabled', 'true') === 'true';
          if (isCodEnabled) {
            const templateName = await getWhatsAppSetting('template_cod_confirmation', 'zica_cod_confirmation_v1');
            const alreadySent = await prisma.whatsAppMessage.findFirst({
              where: { orderId: String(orderIdStr), templateName }
            });
            if (!alreadySent) {
              const { sendCODConfirmation } = await import('@/lib/whatsapp/templates');
              await sendCODConfirmation({ phone, customerName: orderData.customer?.first_name || orderData.billing_address?.first_name || 'there', orderId: String(orderIdStr) });
            }
          }
        } else {
          const isConfirmedEnabled = await getWhatsAppSetting('order_confirmed', 'true') === 'true';
          if (isConfirmedEnabled) {
            const templateName = await getWhatsAppSetting('template_order_confirmed', 'zica_order_confirmed_v1');
            const alreadySent = await prisma.whatsAppMessage.findFirst({
              where: { orderId: String(orderIdStr), templateName }
            });
            if (!alreadySent) {
              const firstLineItem = (orderData.line_items || [])[0];
              const productImageUrl = firstLineItem?.image?.src || firstLineItem?.image || '';
              const orderStatusUrl = orderData.order_status_url || '';
              const totalAmount = orderData.total_price || orderData.current_total_price || '';
              const itemCount = (orderData.line_items || []).length || 1;
              const { sendOrderConfirmation } = await import('@/lib/whatsapp/templates');
              await sendOrderConfirmation({ phone, customerName: orderData.customer?.first_name || orderData.billing_address?.first_name || 'there', orderId: String(orderIdStr), productImageUrl, orderStatusUrl, totalAmount, itemCount });
            }
          }
        }
      } else if (topic === 'orders/fulfilled') {
        const isShippedEnabled = await getWhatsAppSetting('order_shipped', 'true') === 'true';
        if (isShippedEnabled) {
          const fulfillment = orderData.fulfillments?.[0] || {};
          const courier = fulfillment.tracking_company || 'our shipping partner';
          const trackingNumber = fulfillment.tracking_number || 'TBA';
          
          let estimatedDelivery = '3-5 business days';
          if (fulfillment.estimated_delivery_at) {
            try {
              estimatedDelivery = new Date(fulfillment.estimated_delivery_at).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
              });
            } catch (e: any) {
              console.warn('[Shopify Webhook WhatsApp] Failed to parse estimated_delivery_at date:', e.message);
            }
          }
          const trackingUrl = fulfillment.tracking_url || fulfillment.tracking_urls?.[0] || '';
          const templateName = await getWhatsAppSetting('template_order_shipped', 'zica_order_shipped');
          const alreadySent = await prisma.whatsAppMessage.findFirst({
            where: { orderId: String(orderIdStr), templateName }
          });
          if (!alreadySent) {
            const { sendShippingUpdate } = await import('@/lib/whatsapp/templates');
            await sendShippingUpdate({ phone, customerName: orderData.customer?.first_name || orderData.billing_address?.first_name || 'there', orderId: String(orderIdStr), trackingNumber, trackingUrl });
          }
        }
      } else if (topic === 'orders/cancelled' || orderData.cancelled_at) {
        const isStatusEnabled = await getWhatsAppSetting('order_status', 'true') === 'true';
        if (isStatusEnabled) {
          const templateName = await getWhatsAppSetting('template_order_status', 'zb_order_status');
          const alreadySent = await prisma.whatsAppMessage.findFirst({
            where: { orderId: String(orderIdStr), templateName, body: { contains: 'Cancelled' } }
          });
          if (!alreadySent) {
            const { sendOrderStatus } = await import('@/lib/whatsapp/templates');
            await sendOrderStatus({
              phone,
              customerName: orderData.customer?.first_name || orderData.billing_address?.first_name || 'there',
              orderId: String(orderIdStr),
              status: 'Cancelled',
              extraInfo: 'Your order has been cancelled. Any refund due will be processed shortly.',
              orderStatusUrl: orderData.order_status_url || ''
            });
          }
        }
      } else if (topic === 'orders/updated') {
        let shipmentStatus = '';
        if (orderData.fulfillments && Array.isArray(orderData.fulfillments)) {
          for (const f of orderData.fulfillments) {
            if (f.shipment_status) {
              shipmentStatus = f.shipment_status.toLowerCase();
              break;
            }
          }
        }
        
        const isDelivered = deliveryStatus === 'delivered' || shipmentStatus === 'delivered' || shipmentStatus === 'success';
        const isOutForDelivery = deliveryStatus === 'out_for_delivery' || shipmentStatus === 'out_for_delivery';
        
        if (isDelivered) {
          const isDeliveredEnabled = await getWhatsAppSetting('order_delivered', 'true') === 'true';
          if (isDeliveredEnabled) {
            const templateName = await getWhatsAppSetting('template_order_delivered', 'zica_order_delivered_v1');
            const alreadySent = await prisma.whatsAppMessage.findFirst({
              where: { orderId: String(orderIdStr), templateName }
            });
            if (!alreadySent) {
              const firstLineItem = (orderData.line_items || [])[0];
              const productImageUrl = firstLineItem?.image?.src || firstLineItem?.image || '';
              const totalAmount = orderData.total_price || orderData.current_total_price || '';
              const itemCount = (orderData.line_items || []).length || 1;
              const { sendDelivered } = await import('@/lib/whatsapp/templates');
              await sendDelivered({ phone, customerName: orderData.customer?.first_name || orderData.billing_address?.first_name || 'there', orderId: String(orderIdStr), productImageUrl, totalAmount, itemCount });
            }
          }
        } else if (isOutForDelivery) {
          const isOutForDeliveryEnabled = await getWhatsAppSetting('out_for_delivery', 'true') === 'true';
          if (isOutForDeliveryEnabled) {
            const templateName = await getWhatsAppSetting('template_out_for_delivery', 'zb_out_for_delivery');
            const alreadySent = await prisma.whatsAppMessage.findFirst({
              where: { orderId: String(orderIdStr), templateName }
            });
            if (!alreadySent) {
              const { sendOutForDelivery } = await import('@/lib/whatsapp/templates');
              await sendOutForDelivery({ phone, orderId: String(orderIdStr), customerName: orderData.customer?.first_name || orderData.billing_address?.first_name || 'there' });
            }
          }
        } else {
          const isStatusEnabled = await getWhatsAppSetting('order_status', 'true') === 'true';
          if (isStatusEnabled) {
            let status = '';
            let extraInfo = '';
            if (orderData.financial_status === 'refunded') {
              status = 'Refunded';
              extraInfo = 'Your refund has been processed. It should reflect in 5-7 business days.';
            } else if (orderData.fulfillment_status === 'partial') {
              status = 'Partially Shipped';
              extraInfo = 'Part of your order is on its way. The rest will follow soon.';
            }
            
            if (status) {
              const templateName = await getWhatsAppSetting('template_order_status', 'zb_order_status');
              const alreadySent = await prisma.whatsAppMessage.findFirst({
                where: { orderId: String(orderIdStr), templateName, body: { contains: status } }
              });
              if (!alreadySent) {
                const { sendOrderStatus } = await import('@/lib/whatsapp/templates');
                await sendOrderStatus({
                  phone,
                  customerName: orderData.customer?.first_name || orderData.billing_address?.first_name || 'there',
                  orderId: String(orderIdStr),
                  status,
                  extraInfo,
                  orderStatusUrl: orderData.order_status_url || ''
                });
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.error('[Shopify Webhook WhatsApp] Failed to process WhatsApp notifications:', err.message);
    }
  }
}

async function handleRefundWebhook(shop: string, refundData: any) {
  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) return;

  const orderId = refundData.order_id?.toString();
  if (!orderId) return;

  const order = await prisma.order.findUnique({
    where: { shopifyOrderId: orderId },
    include: { items: true },
  });
  if (!order) return;

  const refundLineItems =
    refundData.refund_line_items && Array.isArray(refundData.refund_line_items)
      ? refundData.refund_line_items
      : [];

  for (const rli of refundLineItems) {
    const lineItemId = rli.line_item_id?.toString();
    if (!lineItemId) continue;

    const orderItem = order.items.find(
      (item: any) => item.shopifyLineItemId === lineItemId,
    );
    if (!orderItem || !orderItem.productId) continue;

    // Upsert a Return record representing this Shopify refund
    await prisma.return.upsert({
      where: {
        // One return per order+product from Shopify refunds
        // (schema has id as PK only, so emulate by looking up then create if missing)
        id: `${order.id}-${orderItem.productId}-shopify-refund`,
      },
      update: {
        status: 'refunded',
        updatedAt: new Date(),
      },
      create: {
        id: `${order.id}-${orderItem.productId}-shopify-refund`,
        orderId: order.id,
        productId: orderItem.productId,
        customerId: order.customerId,
        sku: orderItem.sku,
        reason: refundData.note || 'Refund created in Shopify',
        status: 'refunded',
      },
    });
  }
}

async function handleInventoryWebhook(shop: string, inventoryData: any) {
  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) return;

  const inventoryItemId = inventoryData.inventory_item_id?.toString();
  const locationId = inventoryData.location_id?.toString();
  const available = inventoryData.available || 0;

  if (!inventoryItemId || !locationId) return;

  // 1. Try the legacy product-level lookup (matches the first variant stored on Product)
  let product = await prisma.product.findUnique({
    where: { inventoryItemId }
  });

  // 2. If not found, search product_skus for variant-level match
  // This captures webhooks for non-first variants that the product-level lookup misses
  if (!product) {
    try {
      const skuRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT product_id FROM product_skus WHERE inventory_item_id = $1 LIMIT 1`,
        inventoryItemId
      );
      if (skuRows.length > 0) {
        product = await prisma.product.findUnique({
          where: { id: skuRows[0].product_id }
        });
        if (product) {
          console.log(`[Webhook] Matched inventory_item_id ${inventoryItemId} via product_skus → product ${product.id} (${product.title})`);
        }
      }
    } catch (e) {
      console.error(`[Webhook] Error searching product_skus for inventory_item_id ${inventoryItemId}:`, e);
    }
  }

  if (!product) {
    console.warn(`Product not found for inventory item ${inventoryItemId} (checked Product.inventoryItemId and product_skus.inventory_item_id)`);
    return;
  }

  await prisma.inventory.upsert({
    where: {
      productId_locationId: { productId: product.id, locationId }
    },
    create: {
      productId: product.id,
      locationId: locationId,
      stockQuantity: available,
      reservedQuantity: 0
    },
    update: {
      stockQuantity: available
    }
  });

  console.log(`Inventory updated for ${inventoryItemId} at ${locationId} (product: ${product.title})`);
}

async function handleFulfillmentWebhook(shop: string, fulfillment: any) {
  if (!fulfillment || !fulfillment.order_id) {
    console.warn('[Fulfillment Webhook] Missing fulfillment or order_id in payload');
    return;
  }

  const shopifyOrderId = fulfillment.order_id.toString();

  // Find linked master Order and WebStoreOrder
  let order = await prisma.order.findUnique({
    where: { shopifyOrderId }
  }).catch((e: any) => {
    console.error('[Fulfillment Webhook] Error fetching Order:', e.message);
    return null;
  });

  let webStoreOrder = await prisma.webStoreOrder.findFirst({
    where: { shopifyOrderId }
  }).catch((e: any) => {
    console.error('[Fulfillment Webhook] Error fetching WebStoreOrder by shopifyOrderId:', e.message);
    return null;
  });

  // Fallback: If WebStoreOrder is not yet linked with shopifyOrderId, resolve via Order's internalOrderNumber
  if (!webStoreOrder && order?.internalOrderNumber) {
    webStoreOrder = await prisma.webStoreOrder.findUnique({
      where: { orderNumber: order.internalOrderNumber }
    }).catch(() => null);
  }

  // Derive tracking & courier info
  const trackingNumber = fulfillment.tracking_number || (Array.isArray(fulfillment.tracking_numbers) ? fulfillment.tracking_numbers[0] : null) || null;
  const courier = fulfillment.tracking_company || fulfillment.courier || 'Standard Express';
  const trackingUrl = fulfillment.tracking_url || (Array.isArray(fulfillment.tracking_urls) ? fulfillment.tracking_urls[0] : null)
    || (trackingNumber ? `https://www.shiprocket.in/shipment-tracking/?awb=${trackingNumber}` : null);

  // Map fulfillment shipment_status to deliveryStatus
  const shipmentStatus = (fulfillment.shipment_status || '').toLowerCase();
  let deliveryStatus = 'shipped';
  if (shipmentStatus === 'delivered' || shipmentStatus === 'success') {
    deliveryStatus = 'delivered';
  } else if (shipmentStatus === 'out_for_delivery') {
    deliveryStatus = 'out_for_delivery';
  } else if (shipmentStatus === 'failure' || shipmentStatus === 'error') {
    deliveryStatus = 'failed';
  } else if (fulfillment.status === 'cancelled') {
    deliveryStatus = 'cancelled';
  }

  const isCancelled = fulfillment.status === 'cancelled';
  const fulfillmentStatus = isCancelled ? 'unfulfilled' : 'fulfilled';

  // 1. Upsert Shipment row if trackingNumber is present
  if (trackingNumber && order) {
    await prisma.shipment.upsert({
      where: { awb: trackingNumber },
      create: {
        orderId: order.id,
        awb: trackingNumber,
        trackingNumber: trackingNumber,
        courier: courier,
        status: deliveryStatus,
        trackingUrl: trackingUrl,
      },
      update: {
        courier: courier,
        status: deliveryStatus,
        trackingUrl: trackingUrl,
      }
    }).catch((e: any) => console.error('[Fulfillment Webhook] Failed to upsert shipment:', e.message));
  }

  // 2. Update master Order
  if (order) {
    const orderData: any = {
      deliveryStatus: deliveryStatus,
      fulfillmentStatus: fulfillmentStatus,
    };
    if (trackingNumber) {
      orderData.delhivery_awb = trackingNumber;
      orderData.tracking_status = deliveryStatus;
    }
    if (deliveryStatus === 'delivered') {
      orderData.deliveredAt = order.deliveredAt || new Date();
    }

    await prisma.order.update({
      where: { id: order.id },
      data: orderData,
    }).catch((e: any) => console.error('[Fulfillment Webhook] Failed to update order:', e.message));
  }

  // 3. Update WebStoreOrder
  if (webStoreOrder) {
    const wsData: any = {
      fulfillmentStatus: fulfillmentStatus,
      deliveryStatus: deliveryStatus,
    };
    // Only overwrite tracking fields when we actually have a value — never null out a manually entered AWB
    if (trackingNumber) wsData.trackingNumber = trackingNumber;
    if (trackingUrl) wsData.trackingUrl = trackingUrl;
    if (deliveryStatus === 'delivered') wsData.deliveredAt = webStoreOrder.deliveredAt || new Date();
    if (!webStoreOrder.shopifyOrderId) {
      wsData.shopifyOrderId = shopifyOrderId;
    }

    await prisma.webStoreOrder.update({
      where: { id: webStoreOrder.id },
      data: wsData,
    }).catch((e: any) => console.error('[Fulfillment Webhook] Failed to update webStoreOrder:', e.message));
  }
}

