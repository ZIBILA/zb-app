import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

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
  const paid = String(order.paymentStatus || '').toLowerCase() === 'paid';
  const updatedAt = new Date(order.updatedAt).toISOString();

  const isReturnInitiated = status.includes('return') || status.includes('exchange') || status === 'returned' || status === 'exchanged';

  if (isReturnInitiated) {
    const isApproved = status === 'return_approved' || status === 'returned' || status === 'exchanged';
    const isCompleted = status === 'returned' || status === 'exchanged';
    return [
      { step: 'order_placed', completedAt: createdAt },
      { step: 'delivered', completedAt: createdAt },
      { step: 'return_requested', completedAt: updatedAt },
      { step: 'pickup_approved', completedAt: isApproved ? updatedAt : null },
      { step: 'refund_completed', completedAt: isCompleted ? updatedAt : null },
    ];
  }

  const awaitingApprovalCompletedAt = status === 'awaiting_approval' ? createdAt : null;
  const approvedCompletedAt = status === 'approved' ? new Date(order.updatedAt).toISOString() : null;
  const shippedCompletedAt = delivery === 'shipped' ? new Date(order.updatedAt).toISOString() : null;
  const outForDeliveryCompletedAt = delivery === 'out_for_delivery' ? new Date(order.updatedAt).toISOString() : null;
  const deliveredCompletedAt = delivery === 'delivered' ? new Date(order.updatedAt).toISOString() : null;

  return [
    { step: 'order_placed', completedAt: createdAt },
    { step: 'awaiting_approval', completedAt: awaitingApprovalCompletedAt ?? (paid ? createdAt : createdAt) },
    { step: 'approved', completedAt: approvedCompletedAt },
    { step: 'shipped', completedAt: shippedCompletedAt },
    { step: 'out_for_delivery', completedAt: outForDeliveryCompletedAt },
    { step: 'delivered', completedAt: deliveredCompletedAt },
  ];
}

function formatItem(it: any) {
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
    variantId: null,
    title: productName,
    fullTitle: it.title,
    name: productName,
    size,
    quantity: it.quantity,
    price: it.price,
    sku: it.sku,
    image: null,
    imageUrl: null,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const customerId = url.searchParams.get('customerId')?.trim();
  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required', orders: [] }, { status: 400, headers: corsHeaders });
  }

  try {
    const orders = await prisma.order.findMany({
      where: { 
        customerId,
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
      },
      include: { items: true, shipments: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      orders: orders.map((o: any) => ({
        id: o.id,
        orderId: o.id,
        orderNumber: orderNumberFromOrder(o),
        createdAt: o.createdAt,
        status: o.status,
        paymentMethod: paymentMethodFromOrder(o),
        paymentStatus: paymentStatusFromOrder(o),
        fulfillmentStatus: o.fulfillmentStatus || 'unfulfilled',
        deliveryStatus: o.deliveryStatus || 'pending',
        items: (o.items || []).map(formatItem),
        lineItems: (o.items || []).map(formatItem),
        total: o.totalPrice,
        totalPrice: o.totalPrice,
        subtotal: o.subtotalPrice ?? o.totalPrice,
        subtotalPrice: o.subtotalPrice ?? o.totalPrice,
        deliveryFee: null,
        shippingAddress: parseShippingAddress(o.shippingAddress),
        tracking: trackingFromOrder(o),
        statusTimeline: statusTimeline(o),
        note: o.note,
        tags: o.tags,
      })),
    }, { headers: corsHeaders });
  } catch (e: any) {
    console.error('[App API] orders/list error:', e);
    return NextResponse.json({ error: e?.message || 'Internal server error', orders: [] }, { status: 500, headers: corsHeaders });
  }
}
