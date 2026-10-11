/**
 * POST /api/admin/logistics/rto-received — mark an RTO parcel as received back at the warehouse.
 *
 * Normally the carrier webhook reports "RTO Delivered". This lets operations confirm
 * physical receipt manually (e.g. webhook delayed) so the order can be re-shipped.
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import type { Shipment } from '@prisma/client';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';
import { logAudit } from '@/lib/audit';
import { normalizeCarrierStatus, pickActiveOutboundShipment } from '@/lib/logistics/status';
import { applyShipmentStatusUpdate } from '@/lib/services/shipmentStatusService';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    await requireAdmin('LOGISTICS', 'edit');

    let body: { order_id?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const orderId = String(body.order_id || '').trim();
    if (!orderId) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    }

    const shipments: Shipment[] = await prisma.shipment.findMany({ where: { orderId } });
    const shipment = pickActiveOutboundShipment(shipments);
    if (!shipment) {
      return NextResponse.json({ error: 'No active shipment on this order' }, { status: 404 });
    }

    const code = normalizeCarrierStatus(shipment.status);
    if (code === 'rto_delivered') {
      return NextResponse.json({ success: true, message: 'RTO already marked as received' });
    }
    if (code !== 'rto') {
      return NextResponse.json(
        { error: `Shipment is "${shipment.status}", not in RTO — nothing to receive` },
        { status: 409 }
      );
    }

    const result = await applyShipmentStatusUpdate({
      shipmentId: shipment.id,
      rawStatus: 'RTO Delivered',
      description: 'RTO parcel confirmed received at warehouse (manual)',
      timestamp: new Date().toISOString(),
    });

    await logAudit({
      action: 'RTO_MARKED_RECEIVED',
      module: 'LOGISTICS',
      targetId: orderId,
      metadata: { shipmentId: shipment.id, awb: shipment.awb, applied: result.applied },
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ success: result.applied, message: 'RTO marked as received' });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[Logistics] RTO received error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Failed to mark RTO received' }, { status: 500 });
  }
}
