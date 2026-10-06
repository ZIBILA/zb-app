import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getAppAuthFromRequest } from '@/lib/appAuth';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

function parseShippingAddress(raw: string | null) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return {
      name: o.name || '',
      line1: o.line1 || o.address1 || o.street || '',
      line2: o.line2 || o.address2 || '',
      city: o.city || '',
      state: o.state || o.province || '',
      pincode: o.pincode || o.zip || '',
      phone: o.phone || '',
      email: o.email || '',
      country: 'India' as const,
    };
  } catch {
    return null;
  }
}

function orderNumberFromOrder(order: any) {
  const tags = String(order.tags || '');
  const m = tags.match(/zb-order-(ZB-?\d+)/i);
  if (m?.[1]) return m[1].replace('-', '').toUpperCase();
  
  const so = String(order.shopifyOrderId || '');
  if (so.toUpperCase().startsWith('ZB')) {
    return so.toUpperCase();
  }
  if (so.toUpperCase().startsWith('#ZB')) {
    return so.replace(/^#/, '').replace('-', '').toUpperCase();
  }
  return order.id;
}

function paymentMethodFromOrder(order: any): 'COD' | 'PREPAID' {
  const pm = String(order.paymentMethod || '').toUpperCase();
  if (pm.includes('COD') || pm.includes('CASH')) return 'COD';
  return 'PREPAID';
}

function paymentStatusFromOrder(order: any): 'pending' | 'paid' | 'failed' {
  const ps = String(order.paymentStatus || '').toLowerCase();
  if (ps === 'paid') return 'paid';
  if (ps === 'failed') return 'failed';
  return 'pending';
}

function trackingFromOrder(order: any) {
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  const latest = shipments
    .slice()
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (!latest?.awb && !latest?.trackingNumber) return null;
  return {
    awb: latest.awb || latest.trackingNumber || null,
    carrier: latest.courier || null,
    lastLocation: latest.currentLocation || null,
    estimatedDelivery: latest.estimatedDelivery ? new Date(latest.estimatedDelivery).toISOString() : null,
  };
}

function statusTimeline(order: any) {
  const createdAt = order.createdAt ? new Date(order.createdAt).toISOString() : null;
  const status = String(order.status || '').toLowerCase();
  const delivery = String(order.deliveryStatus || '').toLowerCase();
  const updatedAt = new Date(order.updatedAt).toISOString();

  const hasActiveReturn = order.returnRequests?.some((r: any) => r.status !== 'cancelled') || false;
  const hasActiveExchange = order.exchangeRequests?.some((e: any) => e.status !== 'cancelled') || false;
  const isReturnInitiated = status.includes('return') || status.includes('exchange') || status === 'returned' || status === 'exchanged' || hasActiveReturn || hasActiveExchange;

  if (isReturnInitiated) {
    const isApproved = status === 'return_approved' || status === 'exchange_approved' || status === 'returned' || status === 'exchanged' ||
      order.returnRequests?.some((r: any) => ['approved', 'refund_pending', 'pickup_scheduled', 'received', 'refunded'].includes(r.status)) ||
      order.exchangeRequests?.some((e: any) => ['approved', 'exchange_approved', 'qc_passed', 'received', 'new_order_created'].includes(e.status));
      
    const isCompleted = status === 'returned' || status === 'exchanged' ||
      order.returnRequests?.some((r: any) => r.status === 'refunded') ||
      order.exchangeRequests?.some((e: any) => e.status === 'new_order_created');

    const latestShipment = (order.shipments || []).find((s: any) => String(s.status).toLowerCase() === 'delivered');
    const deliveredAt = latestShipment?.updatedAt ? new Date(latestShipment.updatedAt).toISOString() : updatedAt;

    return [
      { step: 'order_placed', completedAt: createdAt },
      { step: 'delivered', completedAt: deliveredAt },
      { step: 'return_requested', completedAt: updatedAt },
      { step: 'pickup_approved', completedAt: isApproved ? updatedAt : null },
      { step: 'refund_completed', completedAt: isCompleted ? updatedAt : null },
    ];
  }

  const isDelivered = delivery === 'delivered';
  const isOutForDelivery = isDelivered || delivery === 'out_for_delivery';
  const isShipped = isOutForDelivery || delivery === 'shipped';
  const isApproved = isShipped || status === 'approved';

  return [
    { step: 'order_placed', completedAt: createdAt },
    { step: 'confirmed', completedAt: isApproved ? updatedAt : null },
    { step: 'shipped', completedAt: isShipped ? updatedAt : null },
    { step: 'out_for_delivery', completedAt: isOutForDelivery ? updatedAt : null },
    { step: 'delivered', completedAt: isDelivered ? updatedAt : null },
  ];
}

function extractLocalOrderIdFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const m = String(notes).match(/Local:\s*([a-zA-Z0-9_-]+)/i);
  return m?.[1] || null;
}

export async function GET(req: Request, { params }: { params: { orderId: string } }) {
  const url = new URL(req.url);
  const qCustomerId = url.searchParams.get('customerId');
  const qPhone = url.searchParams.get('phone');
  const qEmail = url.searchParams.get('email');

  const auth = getAppAuthFromRequest(req);
  
  try {
    const includeRelations = {
      items: {
        include: {
          product: {
            select: { id: true, shopifyProductId: true, title: true, featuredImage: true, handle: true }
          }
        }
      },
      shipments: true,
      customer: true,
      returnRequests: true,
      exchangeRequests: true,
    } as const;

    let order = await prisma.order.findUnique({
      where: { id: params.orderId },
      include: includeRelations,
    });

    // Resolve by internal / previous numbers (ZBCC renumber after admin cancel)
    if (!order) {
      order = await prisma.order.findFirst({
        where: {
          OR: [
            { internalOrderNumber: params.orderId },
            { shopifyOrderId: params.orderId },
            { previousOrderNumbers: { contains: params.orderId } },
          ],
        },
        include: includeRelations,
      });
    }

    // Resolve WebStoreOrder UUID → local Order (list may still surface WSO ids)
    if (!order) {
      try {
        const wso = await prisma.webStoreOrder.findFirst({
          where: {
            OR: [{ id: params.orderId }, { orderNumber: params.orderId }],
          },
        });
        if (wso) {
          const linkedLocalId = extractLocalOrderIdFromNotes(wso.notes);
          if (linkedLocalId) {
            order = await prisma.order.findUnique({
              where: { id: linkedLocalId },
              include: includeRelations,
            });
          }
          if (!order && wso.razorpayOrderId) {
            order = await prisma.order.findFirst({
              where: { razorpayOrderId: wso.razorpayOrderId },
              include: includeRelations,
            });
          }
          if (!order && wso.orderNumber) {
            order = await prisma.order.findFirst({
              where: {
                OR: [
                  { internalOrderNumber: wso.orderNumber },
                  { previousOrderNumbers: { contains: wso.orderNumber } },
                ],
              },
              include: includeRelations,
            });
          }
        }
      } catch (wsoErr: any) {
        console.warn('[App API] WebStoreOrder lookup skipped:', wsoErr?.message || wsoErr);
      }
    }

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404, headers: corsHeaders });

    // Auth check: Allow if JWT matches OR if guest tracking info (phone/email) matches the customer
    let isAuthorized = false;
    if (auth && order.customerId === auth.customerId) {
      isAuthorized = true;
    } else if (order.customer) {
      // Check query params for guest tracking
      if (qCustomerId === order.customerId) isAuthorized = true;
      if (qEmail && order.customer.email === qEmail) isAuthorized = true;
      if (qPhone) {
        const orderPhone = order.customer.phone?.replace(/\D/g, '').slice(-10);
        const inputPhone = qPhone.replace(/\D/g, '').slice(-10);
        if (orderPhone && inputPhone && orderPhone === inputPhone) isAuthorized = true;
      }
    } else if (qCustomerId === order.customerId) {
      // Fallback for orders without customer record but matching ID
      isAuthorized = true;
    }

    if (!isAuthorized && !auth) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in again.' }, { status: 401, headers: corsHeaders });
    }
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized: not your order' }, { status: 403, headers: corsHeaders });
    }


    // Extract size from title if present (e.g. "PRODUCT NAME - XL" → size "XL")
    const formatItem = (it: any) => {
      let size: string | null = null;
      let productName = it.title;
      const sizeMatch = it.title.match(/\s*-\s*(XXS|XS|S|M|L|XL|XXL|XXXL|\d{2,3})$/i);
      if (sizeMatch) {
        size = sizeMatch[1].toUpperCase();
        productName = it.title.replace(sizeMatch[0], '').trim();
      }

      return {
        id: it.id,
        productId: it.productId,
        title: productName,
        fullTitle: it.title,
        name: productName,
        size,
        quantity: it.quantity,
        price: it.price,
        sku: it.sku,
        image: it.image || it.product?.featuredImage || null,
        imageUrl: it.image || it.product?.featuredImage || null,
        shopifyProductId: it.product?.shopifyProductId || null,
        handle: it.product?.handle || null,
      };
    };

    return NextResponse.json({
      order: {
        id: order.id,
        orderId: order.id,
        orderNumber: order.internalOrderNumber || orderNumberFromOrder(order),
        createdAt: order.createdAt,
        status: order.status,
        cancelledBy: order.cancelledBy || null,
        cancelledAt: order.cancelledAt || null,
        paymentMethod: paymentMethodFromOrder(order),
        paymentStatus: paymentStatusFromOrder(order),
        fulfillmentStatus: order.fulfillmentStatus || 'unfulfilled',
        deliveryStatus: order.deliveryStatus || 'pending',
        delhivery_awb: order.delhivery_awb || null,
        items: (order.items || []).map(formatItem),
        lineItems: (order.items || []).map(formatItem),
        total: order.totalPrice,
        totalPrice: order.totalPrice,
        subtotal: order.subtotalPrice ?? order.totalPrice,
        subtotalPrice: order.subtotalPrice ?? order.totalPrice,
        totalTax: order.totalTax || 0,
        currency: order.currency || 'INR',
        deliveryFee: null,
        shippingAddress: parseShippingAddress(order.shippingAddress),
        tracking: trackingFromOrder(order),
        statusTimeline: statusTimeline(order),
        shipments: order.shipments || [],
        note: order.note,
        tags: order.tags,
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: order.razorpayPaymentId,
        returnRequests: order.returnRequests || [],
        exchangeRequests: order.exchangeRequests || [],
      },
    }, { headers: corsHeaders });
  } catch (e: any) {
    console.error('[App API] orders/[orderId] error:', e);
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}
