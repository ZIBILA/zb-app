import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { REVERSE_SHIPMENT_TYPES } from '@/lib/logistics/status';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/mobile-orders/[id]/mark-delivered
 * Manually confirm delivery. Goes through the SAME pipeline as a carrier "Delivered" scan so the
 * shipment, order, web-store copy and COD settlement (balance collected → Paid) stay consistent.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission('MOBILE_ORDERS', 'edit');

    const order = await prisma.order.findUnique({ where: { id: params.id } });
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    const current = String(order.deliveryStatus || '').toLowerCase();
    if (['cancelled', 'canceled', 'rto', 'returned_to_origin', 'rto_delivered', 'lost'].includes(current)) {
      return NextResponse.json(
        { error: `An order that is "${current.replace(/_/g, ' ')}" cannot be marked as delivered.` },
        { status: 400 }
      );
    }

    // Prefer the real outbound shipment so its status moves with the order.
    const shipment = await prisma.shipment.findFirst({
      where: {
        orderId: order.id,
        NOT: { type: { in: [...REVERSE_SHIPMENT_TYPES] } },
        status: { notIn: ['cancelled', 'canceled'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    let handledByPipeline = false;
    if (shipment) {
      const { applyShipmentStatusUpdate } = await import('@/lib/services/shipmentStatusService');
      const result = await applyShipmentStatusUpdate({ shipmentId: shipment.id, rawStatus: 'Delivered' });
      handledByPipeline = !!result?.applied;
    }

    if (!handledByPipeline) {
      // No usable shipment (e.g. hand-delivered): update the order directly, including COD settlement.
      const { isCodOrder } = await import('@/lib/returnPolicy');
      const payStatus = String(order.paymentStatus || '').toLowerCase();
      const settle =
        isCodOrder(order) &&
        !['paid', 'refunded', 'partially_refunded', 'failed', 'payment_failed', 'cancelled'].includes(payStatus);

      await prisma.order.update({
        where: { id: order.id },
        data: {
          deliveryStatus: 'delivered',
          deliveredAt: order.deliveredAt || new Date(),
          ...(settle ? { paymentStatus: 'paid', paymentCapturedAt: new Date() } : {}),
        },
      });
    }

    // Push notification (non-blocking)
    try {
      const orderNumber =
        String(order.tags || '').match(/zb-order-(ZB[71\d-]+)/i)?.[1]?.toUpperCase() ||
        String(order.shopifyOrderId || '').replace(/^#/, '') ||
        'your order';
      const { NotificationService } = await import('@/lib/services/notification.service');
      await NotificationService.sendToUser(
        order.customerId,
        'Zica Bella Order Update',
        `Your order ${orderNumber} is now delivered.`,
        { orderId: order.id, status: 'delivered' }
      );
    } catch (e) {
      console.error('[Admin] delivered push failed:', e);
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e?.message === '401' || e?.message === '403') return handleAuthError(e);
    console.error('[Admin] mark-delivered error:', e);
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 });
  }
}
