import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { refreshShipmentFromCarrier } from '@/lib/services/shipmentStatusService';
import { toOrderDeliveryStatus } from '@/lib/logistics/status';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';
import { logAudit } from '@/lib/audit';

export async function POST(req: Request) {
  try {
    await requireAdmin('LOGISTICS', 'edit');
    // 1. Refresh every active outbound shipment (not delivered / RTO-received / cancelled)
    const REVERSE_TYPES = ['reverse_pickup', 'reverse', 'return', 'exchange_pickup'];
    const activeShipments = await prisma.shipment.findMany({
      where: {
        NOT: { type: { in: REVERSE_TYPES } },
        status: { notIn: ['delivered', 'rto_delivered', 'cancelled', 'canceled', 'lost'] },
        order: {
          deliveryStatus: { notIn: ['delivered', 'cancelled', 'returned_to_origin', 'lost'] },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const syncResults: Array<Record<string, unknown>> = [];

    for (const shipment of activeShipments) {
      if (!shipment.awb && !shipment.trackingNumber) continue;
      try {
        const { tracking, result } = await refreshShipmentFromCarrier(shipment.id);
        if (tracking && tracking.status !== 'unknown') {
          syncResults.push({
            orderId: shipment.orderId,
            status: result?.status && result.status !== 'unknown' ? result.status : tracking.status,
            deliveryStatus:
              result && result.applied && !result.isReverse ? toOrderDeliveryStatus(result.status) : null,
          });
        }
      } catch (err) {
        console.error(`Sync failed for order ${shipment.orderId}:`, err);
      }
    }

    // 2. Refresh in-flight reverse pickups (returns / exchanges). Status changes also advance
    //    the linked request through applyShipmentStatusUpdate.
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const activeReverse = await prisma.shipment.findMany({
      where: {
        type: { in: REVERSE_TYPES },
        awb: { not: null },
        createdAt: { gte: since },
        status: { notIn: ['delivered', 'cancelled', 'canceled', 'lost', 'rto_delivered'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    for (const shipment of activeReverse) {
      try {
        const { tracking, result } = await refreshShipmentFromCarrier(shipment.id);
        if (tracking && tracking.status !== 'unknown') {
          syncResults.push({ shipmentId: shipment.id, reverse: true, status: result?.status || tracking.status });
        }
      } catch (err) {
        console.error(`Sync failed for reverse shipment ${shipment.id}:`, err);
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
