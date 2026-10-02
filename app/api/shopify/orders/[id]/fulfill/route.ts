import { NextResponse } from 'next/server';
import { createFulfillment, fetchLocations, adminUrl, headers } from '@/lib/shopify-admin';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { shipOrder } from '@/lib/services/logistics';
import prisma from '@/lib/db';
import {
  markOrderFulfilledLocally,
  resolveLocalOrderId,
} from '@/lib/services/orderLifecycleService';

export const dynamic = 'force-dynamic';

function parseShippingAddress(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      name: String(parsed.name || '').trim(),
      address1: String(parsed.street || parsed.address1 || '').trim(),
      city: String(parsed.city || '').trim(),
      province: String(parsed.state || parsed.province || '').trim(),
      zip: String(parsed.zip || parsed.pincode || '').trim(),
      country: String(parsed.country || 'India').trim() || 'India',
      phone: String(parsed.phone || '').trim(),
    };
  } catch {
    return null;
  }
}

/**
 * POST /api/shopify/orders/[id]/fulfill
 * Book logistics from local DB order (when present), then fulfill in Shopify.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requirePermission('ORDERS', 'edit');

    const orderId = params.id;
    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { locationId, lineItems } = body;

    // Prefer local Order.id for logistics FK + status writes
    const localOrderId = await resolveLocalOrderId(orderId);

    const localOrder = localOrderId
      ? await prisma.order.findUnique({
          where: { id: localOrderId },
          include: { items: true },
        })
      : await prisma.order.findFirst({
          where: { shopifyOrderId: orderId },
          include: { items: true },
        });

    // Shopify still needed for fulfillment record + location
    const orderRes = await fetch(await adminUrl(`orders/${orderId}.json`), {
      method: 'GET',
      headers: await headers(),
    });

    if (!orderRes.ok) {
      const text = await orderRes.text();
      return NextResponse.json({ error: 'Failed to fetch order from Shopify', details: text }, { status: 400 });
    }

    const { order } = await orderRes.json();

    let resolvedLocationId = locationId;
    if (!resolvedLocationId) {
      const locations = await fetchLocations();
      const activeLocation = locations.find((l) => l.active);
      if (!activeLocation) {
        return NextResponse.json({ error: 'No active Shopify location found' }, { status: 400 });
      }
      resolvedLocationId = String(activeLocation.id);
    }

    let trackingNumber = '';
    let trackingUrl = '';
    let courierName = '';

    try {
      const dbAddress = parseShippingAddress(localOrder?.shippingAddress);
      const shipItems =
        localOrder?.items && localOrder.items.length > 0
          ? localOrder.items.map((i: { title: string; sku: string | null; quantity: number; price: unknown }) => ({
              title: i.title,
              sku: i.sku || undefined,
              quantity: i.quantity,
              price: Number(i.price),
            }))
          : order.line_items.map((i: any) => ({
              title: i.title,
              sku: i.sku,
              quantity: i.quantity,
              price: parseFloat(i.price),
            }));

      const shipment = await shipOrder(
        localOrder?.id || localOrderId || orderId,
        shipItems,
        {
          name:
            dbAddress?.name ||
            `${order.shipping_address?.first_name || ''} ${order.shipping_address?.last_name || ''}`.trim(),
          address1: dbAddress?.address1 || order.shipping_address?.address1 || '',
          city: dbAddress?.city || order.shipping_address?.city || '',
          province: dbAddress?.province || order.shipping_address?.province || '',
          zip: dbAddress?.zip || order.shipping_address?.zip || '',
          country: dbAddress?.country || order.shipping_address?.country || 'India',
          phone:
            dbAddress?.phone ||
            order.shipping_address?.phone ||
            order.customer?.phone ||
            '',
        }
      );

      trackingNumber = shipment.trackingNumber;
      trackingUrl = shipment.trackingUrl || '';
      courierName = shipment.courier;
    } catch (logisticsError: any) {
      console.error('[Logistics] Shipment booking failed:', logisticsError.message);
      if (!body?.forceFulfill) {
        return NextResponse.json(
          {
            error: `Shipment booking failed: ${logisticsError.message || 'Courier error'}. Shopify fulfillment was aborted. Set forceFulfill: true to fulfill without carrier tracking.`,
            logisticsError: logisticsError.message,
          },
          { status: 502 }
        );
      }
    }

    const fulfillment = await createFulfillment(
      orderId,
      resolvedLocationId,
      lineItems,
      trackingNumber
        ? {
            number: trackingNumber,
            url: trackingUrl,
            company: courierName,
          }
        : undefined
    );

    await markOrderFulfilledLocally({
      localOrderId: localOrder?.id || localOrderId,
      shopifyOrderId: orderId,
      trackingNumber: trackingNumber || null,
    });

    return NextResponse.json({
      success: true,
      fulfillment,
      tracking: {
        number: trackingNumber,
        url: trackingUrl,
        courier: courierName,
      },
    });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('Fulfillment Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
