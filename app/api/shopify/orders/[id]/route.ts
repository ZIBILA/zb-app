import { NextResponse } from 'next/server';
import { adminUrl, headers, ShopifyOrder } from '@/lib/shopify-admin';
import prisma from '@/lib/db';
import { resolveOutboundShipment } from '@/lib/services/orderTracking';
import { refreshShipmentFromCarrier } from '@/lib/services/shipmentStatusService';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await requirePermission('ORDERS', 'view');

    const orderId = params.id;
    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 },
      );
    }

    // 1. Fetch from Shopify
    const shopifyRes = await fetch(await adminUrl(`orders/${orderId}.json`), {
      method: 'GET',
      headers: await headers(),
    });

    if (!shopifyRes.ok) {
      const text = await shopifyRes.text();
      console.error(`Shopify Get Order Error for ${orderId}:`, shopifyRes.status, text);
      return NextResponse.json(
        { error: `Failed to fetch order ${orderId}`, details: text },
        { status: shopifyRes.status },
      );
    }

    const { order } = await shopifyRes.json();
    
    // 2. Fetch local metadata (shipments, returns, etc.)
    const localOrder = await prisma.order.findFirst({
      where: {
        OR: [
          { id: orderId },
          { shopifyOrderId: orderId.toString() }
        ]
      },
      include: {
        shipments: { orderBy: { createdAt: 'desc' } },
        returns: true,
        exchanges: true,
      }
    });

    // 3. Refresh status of the active outbound shipment (provider-aware, applied
    //    through the shared status service so Order.deliveryStatus stays canonical).
    let trackingInfo = null;
    const latestShipment = localOrder?.shipments?.[0];

    if (localOrder) {
      const resolved = await resolveOutboundShipment(localOrder.id, localOrder.delhivery_awb);
      if (resolved.shipmentId && resolved.awb) {
        try {
          const { tracking } = await refreshShipmentFromCarrier(resolved.shipmentId);
          if (tracking && tracking.status !== 'unknown') {
            trackingInfo = {
              ...tracking,
              trackingNumber: resolved.awb,
              courier: resolved.courier,
              shipmentId: resolved.shipmentId,
            };
          }
        } catch (e) {
          console.warn(`[Order API] Tracking refresh failed for ${resolved.awb}`);
        }
      }
    }

    return NextResponse.json({
      order: order as ShopifyOrder,
      local: localOrder || null,
      tracking: trackingInfo || (latestShipment ? {
        status: latestShipment.status,
        location: latestShipment.currentLocation,
        estimatedDelivery: latestShipment.estimatedDelivery,
        events: JSON.parse(latestShipment.events || '[]'),
        trackingNumber: latestShipment.trackingNumber,
        trackingUrl: latestShipment.trackingUrl,
        courier: latestShipment.courier,
      } : null),
    });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('Error in get order route:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requirePermission('ORDERS', 'edit');

    const orderId = params.id;
    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
    }

    const body = await request.json();

    const payload = {
      order: {
        id: parseInt(orderId, 10),
        note: body.note,
        tags: body.tags,
        shipping_address: body.shipping_address,
        email: body.email,
      }
    };

    const res = await fetch(await adminUrl(`orders/${orderId}.json`), {
      method: 'PUT',
      headers: await headers(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        console.error(`Shopify Update Order Error for ${orderId}:`, res.status, text);
        return NextResponse.json(
          { error: `Failed to update order ${orderId}`, details: text },
          { status: res.status }
        );
    }

    const data = await res.json();
    return NextResponse.json({ success: true, order: data.order as ShopifyOrder });

  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('Error in update order route:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
