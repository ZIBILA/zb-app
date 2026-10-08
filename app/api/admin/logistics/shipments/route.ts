import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';
import { getActiveLogisticsProvider } from '@/lib/services/logistics';
import { isReverseShipmentType, normalizeCarrierStatus, shipmentAwb } from '@/lib/logistics/status';

export const dynamic = 'force-dynamic';

/** UI filter value → stored Shipment.status values (canonical + legacy rows). */
const STATUS_FILTERS: Record<string, string[]> = {
  manifested: ['confirmed', 'manifested', 'packed'],
  confirmed: ['confirmed', 'manifested', 'packed'],
  pickup_scheduled: ['pickup_scheduled', 'pickup_pending'],
  shipped: ['in_transit', 'shipped', 'picked_up', 'in transit', 'dispatched'],
  in_transit: ['in_transit', 'shipped', 'picked_up', 'in transit', 'dispatched'],
  out_for_delivery: ['out_for_delivery', 'out for delivery'],
  delivered: ['delivered'],
  rto: ['rto'],
  rto_delivered: ['rto_delivered'],
  cancelled: ['cancelled', 'canceled'],
};

export async function GET(req: Request) {
  try {
    await requireAdmin('LOGISTICS', 'view');
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search');
    const status = searchParams.get('status');

    const onlyAwaitingManifest = status === 'manifest_required';

    // Fetch all shipments with their orders
    const shipmentWhere: Record<string, unknown> = {};
    if (status && !onlyAwaitingManifest) {
      shipmentWhere.status = { in: STATUS_FILTERS[status] || [status] };
    }
    if (search) {
      shipmentWhere.OR = [
        { awb: { contains: search, mode: 'insensitive' } },
        { trackingNumber: { contains: search, mode: 'insensitive' } },
        { order: { shopifyOrderId: { contains: search, mode: 'insensitive' } } },
        { order: { shopifyOrderName: { contains: search, mode: 'insensitive' } } },
        { order: { internalOrderNumber: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const shipments = onlyAwaitingManifest
      ? []
      : await prisma.shipment.findMany({
          where: shipmentWhere,
          include: {
            order: {
              select: {
                shopifyOrderId: true,
                shopifyOrderName: true,
                internalOrderNumber: true,
                fulfillmentStatus: true,
                customer: { select: { name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

    // Also fetch orders that need shipment — fulfilled without a Shipment record,
    // OR unfulfilled but paid/active orders ready to be manifested
    const includeUnshipped = !status || onlyAwaitingManifest;
    const orderWhereConditions: Record<string, unknown>[] = [
      { shipments: { none: {} } },
      { status: { notIn: ['cancelled', 'CANCELLED', 'FAILED', 'payment_failed', 'REFUNDED'] } },
      {
        OR: [
          { fulfillmentStatus: 'fulfilled' },
          {
            fulfillmentStatus: 'unfulfilled',
            status: { in: ['active', 'PAID', 'confirmed', 'open'] },
          },
        ],
      },
    ];

    if (search) {
      orderWhereConditions.push({
        OR: [
          { shopifyOrderId: { contains: search, mode: 'insensitive' as const } },
          { shopifyOrderName: { contains: search, mode: 'insensitive' as const } },
          { internalOrderNumber: { contains: search, mode: 'insensitive' as const } },
          { delhivery_awb: { contains: search, mode: 'insensitive' as const } },
        ],
      });
    }

    const ordersNeedingShipmentRecord = includeUnshipped
      ? await prisma.order.findMany({
          where: { AND: orderWhereConditions },
          include: {
            customer: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : [];

    const shipmentRows = shipments.map((s: any) => {
      return {
        ...s,
        // Aggregator order ids must not be shown as AWBs.
        awb: shipmentAwb(s),
        provider: 'shiprocket',
        isReverse: isReverseShipmentType(s.type),
        statusCode: normalizeCarrierStatus(s.status),
        order: {
          ...s.order,
          shopifyOrderId: s.order?.internalOrderNumber || s.order?.shopifyOrderName || s.order?.shopifyOrderId || '',
        },
      };
    });

    // Merge them into a unified list for the UI
    const unifiedShipments = [
      ...shipmentRows,
      ...ordersNeedingShipmentRecord
        .filter((o: any) => !shipments.some((s: any) => s.orderId === o.id)) // avoid duplicates
        .map((o: any) => ({
          id: `pending-${o.id}`,
          orderId: o.id,
          awb: o.delhivery_awb || null,
          courier: o.delhivery_awb ? 'Courier' : 'Pending',
          provider: 'shiprocket',
          isReverse: false,
          status: o.delhivery_awb ? 'manifested' : 'manifest_required',
          trackingUrl: o.delhivery_awb ? `https://shiprocket.co/tracking/${o.delhivery_awb}` : null,
          createdAt: o.createdAt,
          order: {
            shopifyOrderId: o.internalOrderNumber || o.shopifyOrderName || o.shopifyOrderId || '',
            fulfillmentStatus: o.fulfillmentStatus,
            customer: o.customer,
          },
        })),
    ];

    return NextResponse.json({ success: true, shipments: unifiedShipments });
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[Logistics API] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
