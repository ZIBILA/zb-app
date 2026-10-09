import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { createRefund } from '@/lib/shopify-admin';
import { enrichSingleItem, enrichItemsWithSize } from '@/lib/enrichSize';
import { isCodOrder } from '@/lib/returnPolicy';
import { liveReverseFields } from '@/lib/services/reverseShipmentExtras';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/returns/[id]
 * Update return request status with full workflow support:
 *   REQUESTED → APPROVED → RECEIVED → REFUNDED
 *   REQUESTED → REJECTED
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { status, refundAmount, refundMethod } = body;
    const returnRequestId = params.id;

    const validStatuses = ['APPROVED', 'REJECTED', 'RECEIVED', 'REFUNDED', 'PICKUP_SCHEDULED', 'REFUND_PENDING'];
    const lowerStatus = status.toLowerCase(); // keep request level status lowercase
    if (!status || !validStatuses.includes(status.toUpperCase())) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
    }

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
    if (lowerStatus === 'refund_pending' || lowerStatus === 'refunded') {
      if (!alreadyReceived) {
        return NextResponse.json(
          { error: 'The returned parcel must be received at the warehouse before the refund / store credit can be released.' },
          { status: 400 }
        );
      }
    }
    if (lowerStatus === 'refunded' && isCodOrder(returnRequest.order)) {
      return NextResponse.json(
        { error: 'COD orders are refunded as Store Credit only. Use "Release Store Credit" (Refunds) to issue it.' },
        { status: 400 }
      );
    }

    const updateData: any = { status: lowerStatus };
    if (lowerStatus === 'received' && !returnRequest.receivedAt) updateData.receivedAt = new Date();
    if (lowerStatus === 'refunded') {
      updateData.refundType = 'original_source';
      updateData.refundReleasedAt = new Date();
    }
    const returnItemUpdateData: any = { status: status.toUpperCase() };

    if (lowerStatus === 'refunded') {
      const actualRefundAmount = refundAmount || returnRequest.actualRefund || returnRequest.estimatedRefund;
      updateData.actualRefund = actualRefundAmount;
      returnItemUpdateData.refundStatus = 'COMPLETED';
      returnItemUpdateData.refundAmount = actualRefundAmount;

      // Check if refund needs to go to Razorpay (original method)
      const isOriginalMethod = returnRequest.returns.some((r: any) => r.refundMethod === 'original_method') || 
                               !returnRequest.returns.some((r: any) => r.storeCreditAmount && r.storeCreditAmount > 0);

      if (isOriginalMethod && actualRefundAmount > 0) {
        const order = returnRequest.order;
        const paymentId = order.razorpayPaymentId;
        
        if (paymentId) {
          try {
            console.log(`[AdminRefund] Initiating Razorpay refund of ₹${actualRefundAmount} for payment ${paymentId}`);
            
            const isMock = paymentId.startsWith('pay_mock_') || 
                           (order.razorpayOrderId && order.razorpayOrderId.startsWith('order_mock_'));
            
            if (isMock) {
              console.warn(`[AdminRefund] Processing MOCK refund for mock payment ${paymentId}`);
              await prisma.payment.create({
                data: {
                  orderId: order.id,
                  customerId: order.customerId,
                  amount: actualRefundAmount,
                  type: 'refund',
                  status: 'completed',
                  gateway: 'razorpay'
                }
              });
            } else {
              const { resolveRazorpayCredentials } = await import('@/lib/razorpay-credentials');
              const Razorpay = (await import('razorpay')).default;
              const creds = await resolveRazorpayCredentials();
              const razorpayInstance = new Razorpay({ key_id: creds.key_id, key_secret: creds.key_secret });
              
              const amountInPaise = Math.round(actualRefundAmount * 100);
              const refund = await razorpayInstance.payments.refund(paymentId, {
                amount: amountInPaise,
                notes: {
                  returnRequestId: returnRequest.id,
                  orderId: order.id,
                  reason: 'Customer Return'
                }
              });
              
              console.log(`[AdminRefund] Razorpay refund successful! Refund ID: ${refund.id}`);
              
              await prisma.payment.create({
                data: {
                  orderId: order.id,
                  customerId: order.customerId,
                  amount: actualRefundAmount,
                  type: 'refund',
                  status: 'completed',
                  gateway: 'razorpay'
                }
              });
            }
          } catch (refundErr: any) {
            console.error(`[AdminRefund] Razorpay refund failed:`, refundErr);
            const errMsg = refundErr?.error?.description || refundErr?.message || 'Unknown error';
            return NextResponse.json({ error: `Refund failed on Razorpay: ${errMsg}. Please check credentials or transaction status.` }, { status: 500 });
          }
        } else {
          console.warn(`[AdminRefund] Return request ${returnRequestId} wants original method refund but order has no razorpayPaymentId.`);
        }
      }
    }

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

    // When marked REFUNDED, create a Shopify refund for the relevant line items
    if (lowerStatus === 'refunded') {
      try {
        const orderId = returnRequest.order.shopifyOrderId;
        const refundLineItems: any[] = [];
        
        for (const item of returnRequest.returns) {
           const matchingLineItem = returnRequest.order.items.find(
             (oi: any) => oi.sku === item.sku || oi.productId === item.productId
           );
           
           if (matchingLineItem?.shopifyLineItemId) {
              refundLineItems.push({
                line_item_id: parseInt(matchingLineItem.shopifyLineItemId, 10),
                quantity: item.quantity || 1,
                restock_type: 'return',
              });
           }
        }

        if (refundLineItems.length > 0) {
          await createRefund(
            orderId,
            refundLineItems,
            `Return completed: ${returnRequest.reason}`
          );
          console.log(`✅ Shopify refund created for order ${orderId}`);
        }
      } catch (refundError: any) {
        console.error('⚠️ Shopify Refund Error:', refundError.message);
        // We log but don't fail the request since local DB is updated
      }
    }

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

    // SKU lifecycle tracking: if marked REFUNDED but SKUs haven't been restocked yet, do it now
    if (lowerStatus === 'refunded') {
      try {
        const { restoreSkuToStock } = await import('@/lib/services/skuService');
        for (const ret of returnRequest.returns) {
          if (ret.sku) {
            await restoreSkuToStock(ret.sku, 'RETURN_RESTOCK', 'Admin (Return Refunded)');
          }
        }
      } catch (skuErr) {
        console.error('[Return PATCH] SKU restoration on refunded failed:', skuErr);
      }
    }

    return NextResponse.json({ success: true, returnRequest: updatedReturnRequest }, { status: 200 });
  } catch (error: any) {
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
