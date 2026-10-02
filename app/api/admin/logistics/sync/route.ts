import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getTrackingStatus } from '@/lib/services/logistics';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';
import { logAudit } from '@/lib/audit';

export async function POST(req: Request) {
  try {
    await requireAdmin('LOGISTICS', 'edit');
    // 1. Find all orders that are not yet delivered
    const orders = await prisma.order.findMany({
      where: {
        deliveryStatus: {
          not: 'delivered',
        },
      },
      include: {
        shipments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const syncResults = [];

    for (const order of orders) {
      const latestShipment = order.shipments[0];
      if (latestShipment?.trackingNumber) {
        try {
          const status = await getTrackingStatus(latestShipment.trackingNumber);
          if (status && status.status !== 'unknown') {
            // Update shipment
            await prisma.shipment.update({
              where: { id: latestShipment.id },
              data: {
                status: status.status,
                currentLocation: status.location,
                estimatedDelivery: status.estimatedDelivery ? new Date(status.estimatedDelivery) : undefined,
                events: JSON.stringify(status.events),
              },
            });

            // Update order delivery status for meaningful carrier states (incl. cancelled)
            const mapped = status.status.toLowerCase();
            let nextDelivery: string | null = null;
            if (mapped === 'delivered') nextDelivery = 'delivered';
            else if (mapped === 'cancelled' || mapped === 'canceled') nextDelivery = 'cancelled';
            else if (mapped === 'out_for_delivery') nextDelivery = 'out_for_delivery';
            else if (mapped === 'in_transit' || mapped === 'shipped') nextDelivery = 'shipped';
            else if (mapped === 'pickup_scheduled' || mapped === 'picked_up') nextDelivery = 'pickup_scheduled';
            else if (mapped === 'rto') nextDelivery = 'returned_to_origin';
            else if (mapped === 'confirmed') nextDelivery = 'confirmed';

            if (nextDelivery && order.deliveryStatus !== nextDelivery) {
              await prisma.order.update({
                where: { id: order.id },
                data: { deliveryStatus: nextDelivery },
              });
            }

            syncResults.push({ orderId: order.id, status: status.status, deliveryStatus: nextDelivery });
          }
        } catch (err) {
          console.error(`Sync failed for order ${order.id}:`, err);
        }
      }
    }

    // 2. Find all active returns with tracking numbers
    const activeReturns = await prisma.return.findMany({
      where: {
        status: { in: ['REQUESTED', 'APPROVED', 'PICKED_UP'] },
        trackingNumber: { not: null },
      },
    });

    for (const ret of activeReturns) {
      if (ret.trackingNumber) {
        try {
          const status = await getTrackingStatus(ret.trackingNumber);
          if (status && status.status !== 'unknown') {
            await prisma.return.update({
              where: { id: ret.id },
              data: {
                status: status.status.toUpperCase(),
              },
            });
            syncResults.push({ returnId: ret.id, status: status.status });
          }
        } catch (err) {
          console.error(`Sync failed for return ${ret.id}:`, err);
        }
      }
    }

    await logAudit({
      action: 'LOGISTICS_TRACKING_SYNCED',
      module: 'LOGISTICS',
      metadata: { syncedCount: syncResults.length },
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      success: true,
      syncedCount: syncResults.length,
      details: syncResults,
    });
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[Sync API] error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
