import { NextResponse } from 'next/server';
import { createFulfillment, fetchLocations, adminUrl, headers } from '@/lib/shopify-admin';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { shipOrder } from '@/lib/services/logistics';
import {
  markOrderFulfilledLocally,
  resolveLocalOrderId,
} from '@/lib/services/orderLifecycleService';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopify/orders/[id]/fulfill
 * 1. Fetches order from Shopify to get shipping address & items.
 * 2. Books a shipment via Delhivery/Shiprocket.
 * 3. Creates a fulfillment in Shopify with the tracking number.
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

    // 1. Fetch Order Details from Shopify
    const orderRes = await fetch(await adminUrl(`orders/${orderId}.json`), {
      method: 'GET',
      headers: await headers(),
    });

    if (!orderRes.ok) {
      const text = await orderRes.text();
      return NextResponse.json({ error: 'Failed to fetch order from Shopify', details: text }, { status: 400 });
    }

    const { order } = await orderRes.json();

    // 2. Resolve Location
    let resolvedLocationId = locationId;
    if (!resolvedLocationId) {
      const locations = await fetchLocations();
      const activeLocation = locations.find((l) => l.active);
      if (!activeLocation) {
        return NextResponse.json({ error: 'No active Shopify location found' }, { status: 400 });
      }
      resolvedLocationId = String(activeLocation.id);
    }

    // 3. Book Shipment via Logistics Partner (Delhivery/Shiprocket)
    let trackingNumber = '';
    let trackingUrl = '';
    let courierName = '';

    try {
      const shipment = await shipOrder(
        localOrderId || orderId,
        order.line_items.map((i: any) => ({
          title: i.title,
          sku: i.sku,
          quantity: i.quantity,
          price: parseFloat(i.price),
        })),
        {
          name: `${order.shipping_address?.first_name || ''} ${order.shipping_address?.last_name || ''}`.trim(),
          address1: order.shipping_address?.address1 || '',
          city: order.shipping_address?.city || '',
          province: order.shipping_address?.province || '',
          zip: order.shipping_address?.zip || '',
          country: order.shipping_address?.country || 'India',
          phone: order.shipping_address?.phone || order.customer?.phone || '',
        }
      );

      trackingNumber = shipment.trackingNumber;
      trackingUrl = shipment.trackingUrl;
      courierName = shipment.courier;
    } catch (logisticsError: any) {
      console.error('[Logistics] Shipment booking failed:', logisticsError.message);
      // Continue with Shopify fulfillment even if logistics fails
    }

    // 4. Create Fulfillment in Shopify
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

    // 5. Update local Order + WebStoreOrder (never OR inside update.where)
    await markOrderFulfilledLocally({
      localOrderId,
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
