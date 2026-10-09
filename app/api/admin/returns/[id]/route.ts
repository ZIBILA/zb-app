import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { enrichSingleItem, enrichItemsWithSize } from '@/lib/enrichSize';
import { liveReverseFields } from '@/lib/services/reverseShipmentExtras';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/returns/[id]
 * Update return request workflow status (e.g. mark RECEIVED).
 * This endpoint never moves money: refunds / store credit go through
 * POST /api/admin/refunds/[id]/approve.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'edit');

    const body = await req.json().catch(() => ({}));
    const { status } = body;
    const returnRequestId = params.id;

    const validStatuses = ['APPROVED', 'REJECTED', 'RECEIVED', 'REFUNDED', 'PICKUP_SCHEDULED', 'REFUND_PENDING'];
    if (!status || typeof status !== 'string' || !validStatuses.includes(status.toUpperCase())) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
    }
    const lowerStatus = status.toLowerCase(); // keep request level status lowercase

    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: {
        returns: { include: { product: true } },
        order: { include: { items: true, shop: true } },
      },
    });

    if (!returnRequest) {
      return NextResponse.json({ error: 'Return request not found' }, { status: 404 });
    }

    const currentRequestStatus = String(returnRequest.status || '').toLowerCase();
    const alreadyReceived =
      !!returnRequest.receivedAt || ['received', 'qc_passed', 'refunded'].includes(currentRequestStatus);

    if (['refunded', 'refund_pending'].includes(currentRequestStatus)) {
      return NextResponse.json(
        { error: `This request is already "${currentRequestStatus}" and can no longer be changed here.` },
        { status: 409 }
      );
    }

    // State machine guards — the customer's money is only released after we hold the parcel.
    if (lowerStatus === 'received') {
      const receivable = ['approved', 'in_transit', 'delivered_to_warehouse', 'approved_pickup_failed', 'pickup_scheduled'];
      if (!receivable.includes(currentRequestStatus) && !alreadyReceived) {
        return NextResponse.json(
          { error: `A request that is "${currentRequestStatus}" cannot be marked as received. Accept it first.` },
          { status: 400 }
        );
      }
    }
    // Money movement is NOT allowed through this generic status endpoint. Refunds and store credit
    // are released only through POST /api/admin/refunds/[id]/approve, which is atomic and idempotent.
    if (lowerStatus === 'refund_pending' || lowerStatus === 'refunded') {
      return NextResponse.json(
        { error: 'Refunds cannot be set from here. Use "Release Refund" / "Release Store Credit" so the money movement is recorded safely.' },
        { status: 400 }
      );
    }

    const updateData: any = { status: lowerStatus };
    if (lowerStatus === 'received' && !returnRequest.receivedAt) updateData.receivedAt = new Date();
    const returnItemUpdateData: any = { status: status.toUpperCase() };

    const updatedReturnRequest = await prisma.$transaction(async (tx: any) => {
      // 1. Update the ReturnRequest
      const reqUpdate = await tx.returnRequest.update({
        where: { id: returnRequestId },
        data: updateData,
        include: { returns: true }
      });

      // 2. Update individual Return items
      await tx.return.updateMany({
        where: { returnRequestId },
        data: returnItemUpdateData
      });

      return reqUpdate;
    });

    // SKU lifecycle tracking: restore SKUs when items are physically received back
    if (lowerStatus === 'received') {
      try {
        const { restoreSkuToStock } = await import('@/lib/services/skuService');
        for (const ret of returnRequest.returns) {
          if (ret.sku) {
            await restoreSkuToStock(ret.sku, 'RETURN_RESTOCK', 'Admin (Return Received)');
          }
        }
      } catch (skuErr) {
        console.error('[Return PATCH] SKU restoration on received failed:', skuErr);
      }
    }

    return NextResponse.json({ success: true, returnRequest: updatedReturnRequest }, { status: 200 });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('Admin Return API Error:', error);
    return NextResponse.json({ error: 'Failed to update return request' }, { status: 500 });
  }
}

/**
 * GET /api/admin/returns/[id]
 * Fetch a single return request with full details
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: params.id },
      include: {
        returns: {
          include: { product: true }
        },
        order: {
          include: {
            items: true,
            customer: true,
            shipments: {
              select: {
                awb: true,
                trackingNumber: true,
                status: true,
                currentLocation: true,
                estimatedDelivery: true,
                courier: true,
                trackingUrl: true,
              },
            },
          },
        },
      },
    });

    if (!returnRequest) {
      const standalone = await prisma.return.findUnique({
        where: { id: params.id },
        include: {
          product: true,
          customer: true,
          order: { include: { items: true, customer: true } }
        }
      });
      
      if (!standalone) {
        return NextResponse.json({ error: 'Return request not found' }, { status: 404 });
      }

      // Map to ReturnRequest structure synthetically
      const syntheticRequest = {
        id: standalone.id,
        orderId: standalone.orderId,
        customerId: standalone.customerId,
        status: standalone.status.toLowerCase(),
        estimatedRefund: standalone.refundAmount || 0,
        actualRefund: standalone.refundAmount,
        createdAt: standalone.requestedAt,
        updatedAt: standalone.updatedAt,
        approvedAt: standalone.status === 'APPROVED' ? standalone.updatedAt : null,
        reason: standalone.reason,
        returns: [{
          id: standalone.id,
          orderId: standalone.orderId,
          productId: standalone.productId,
          customerId: standalone.customerId,
          sku: standalone.sku,
          quantity: standalone.quantity || 1,
          reason: standalone.reason,
          status: standalone.status,
          requestedAt: standalone.requestedAt,
          updatedAt: standalone.updatedAt,
          returnMethod: standalone.returnMethod,
          refundMethod: standalone.refundMethod,
          trackingNumber: standalone.trackingNumber,
          refundAmount: standalone.refundAmount,
          storeCreditAmount: standalone.storeCreditAmount,
          refundStatus: standalone.refundStatus,
          returnRequestId: null,
          product: standalone.product
        }],
        order: standalone.order
      };

      const enrichedReturns = await Promise.all(
        (syntheticRequest.returns || []).map(enrichSingleItem)
      );

      const enrichedOrderItems = syntheticRequest.order?.items
        ? await enrichItemsWithSize(syntheticRequest.order.items)
        : [];

      return NextResponse.json({
        return: {
          ...syntheticRequest,
          returns: enrichedReturns,
          order: syntheticRequest.order
            ? { ...syntheticRequest.order, items: enrichedOrderItems }
            : null
        }
      }, { status: 200 });
    }

    const enrichedReturns = await Promise.all(
      (returnRequest.returns || []).map(enrichSingleItem)
    );

    const enrichedOrderItems = returnRequest.order?.items
      ? await enrichItemsWithSize(returnRequest.order.items)
      : [];

    const live = liveReverseFields({
      requestStatus: returnRequest.status,
      receivedAt: returnRequest.receivedAt,
      reverseAwb: returnRequest.reverseAwb,
      shipments: returnRequest.order?.shipments,
    });

    return NextResponse.json({
      return: {
        ...returnRequest,
        returns: enrichedReturns,
        order: returnRequest.order
          ? { ...returnRequest.order, items: enrichedOrderItems }
          : null,
        ...live,
      }
    }, { status: 200 });
  } catch (error: any) {
    console.error('Return Detail API Error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch return' }, { status: 500 });
  }
}
