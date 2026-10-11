import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { isRenderDevEnv } from '@/lib/isRenderDevEnv';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/orders/[id]/mark-delivered-test
 * Dev/Render only — marks an order delivered so return/exchange flows can be tested
 * without a real courier delivery.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!isRenderDevEnv()) {
      return NextResponse.json(
        { error: 'This test action is only available when NODE_ENV (or SHOPIFY_ENV) is "render".' },
        { status: 403 }
      );
    }

    await requirePermission('ORDERS', 'edit');

    const { id } = params;
    const now = new Date();
    const data = {
      deliveryStatus: 'delivered',
      status: 'delivered',
      fulfillmentStatus: 'fulfilled',
      deliveredAt: now,
    };

    let updated =
      (await prisma.order
        .update({ where: { id }, data })
        .catch(() => null)) ||
      (await prisma.mobileOrder
        .update({
          where: { id },
          data: {
            deliveryStatus: 'delivered',
            status: 'delivered',
            fulfillmentStatus: 'fulfilled',
          },
        })
        .catch(() => null));

    if (!updated) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Keep WebStoreOrder in sync when present (best-effort).
    try {
      const orderNumber =
        (updated as any).internalOrderNumber ||
        (updated as any).orderNumber ||
        (updated as any).shopifyOrderId;
      if (orderNumber) {
        await prisma.webStoreOrder.updateMany({
          where: {
            OR: [
              { orderNumber: String(orderNumber) },
              { shopifyOrderId: String((updated as any).shopifyOrderId || '') },
            ],
          },
          data: {
            deliveryStatus: 'delivered',
            status: 'delivered',
            fulfillmentStatus: 'fulfilled',
            deliveredAt: now,
          },
        });
      }
    } catch {
      /* non-critical */
    }

    await logAudit({
      action: 'ORDER_MARK_DELIVERED_TEST',
      module: 'ORDERS',
      targetId: id,
      metadata: { reason: 'render-dev test helper' },
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: 'Order marked as delivered for testing. Customer can now request a return/exchange.',
      order: updated,
    });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') return handleAuthError(error);
    console.error('[MarkDeliveredTest]', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to mark delivered' }, { status: 500 });
  }
}
