import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { createRefund } from '@/lib/shopify-admin';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { resolveRefundMethod } from '@/lib/returnPolicy';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/refunds/[id]/approve
 * Explicitly approves and processes a pending return/exchange refund.
 * Admin-only security check enforced.
 * Supports Razorpay Auto-Refund or Store Credit issuance upon Admin approval.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission('RETURNS_EXCHANGES', 'edit');
    const user = session.user as { email?: string | null; role?: string };

    const refundId = params.id;
    const body = await req.json().catch(() => ({}));
    const { overrideRefundMethod, overrideAmount, qcNotes } = body;

    // 1. Locate ReturnRequest or Standalone Return
    let returnRequest = await prisma.returnRequest.findUnique({
      where: { id: refundId },
      include: {
        returns: { include: { product: true } },
        order: { include: { items: true, customer: true, payments: true } }
      }
    });

    let standaloneReturn: any = null;

    if (!returnRequest) {
      standaloneReturn = await prisma.return.findUnique({
        where: { id: refundId },
        include: {
          product: true,
          customer: true,
          order: { include: { items: true, customer: true, payments: true } }
        }
      });
    }

    if (!returnRequest && !standaloneReturn) {
      return NextResponse.json({ error: 'Refund request record not found.' }, { status: 404 });
    }

    const isRequestGroup = !!returnRequest;
    const targetEntity = returnRequest || standaloneReturn;
    const order = targetEntity.order;

    if (!order) {
      return NextResponse.json({ error: 'Associated order not found.' }, { status: 404 });
    }

    // 2. Check if already refunded
    const alreadyRefunded = isRequestGroup
      ? returnRequest!.returns.some((r: any) => r.refundStatus === 'COMPLETED') || returnRequest!.status === 'refunded'
      : standaloneReturn!.refundStatus === 'COMPLETED' || standaloneReturn!.status === 'REFUNDED';

    if (alreadyRefunded) {
      return NextResponse.json({ error: 'This refund request has already been processed and completed.' }, { status: 400 });
    }

    // Determine target refund method & amount
    const initialMethod = isRequestGroup 
      ? (returnRequest!.returns[0]?.refundMethod || 'original_method') 
      : (standaloneReturn!.refundMethod || 'original_method');

    // COD orders → Store Credit only (policy). Prepaid: admin override > customer's choice.
    const refundMethod = resolveRefundMethod(order, overrideRefundMethod || initialMethod);

    // The customer's money / credit is released only after we physically hold the parcel.
    const receivedOk = isRequestGroup
      ? !!returnRequest!.receivedAt || ['received', 'qc_passed'].includes(String(returnRequest!.status).toLowerCase())
      : String(standaloneReturn!.status).toUpperCase() === 'RECEIVED';
    if (!receivedOk) {
      return NextResponse.json(
        { error: 'Parcel not received yet. Mark the return as received at the warehouse before releasing the refund / store credit.' },
        { status: 400 }
      );
    }

    const calculatedAmount = isRequestGroup
      ? (returnRequest!.actualRefund || returnRequest!.estimatedRefund || returnRequest!.returns.reduce((s: number, r: any) => s + (r.refundAmount || 0), 0))
      : (standaloneReturn!.refundAmount || 0);

    const finalRefundAmount = overrideAmount !== undefined && Number(overrideAmount) > 0 
      ? Number(overrideAmount) 
      : calculatedAmount;

    if (finalRefundAmount <= 0) {
      return NextResponse.json({ error: 'Invalid refund amount. Refund amount must be greater than 0.' }, { status: 400 });
    }

    const customerId = order.customerId;

    // 3. Process Refund according to method
    let razorpayRefundId: string | null = null;
    let isStoreCreditProcessed = false;

    if (refundMethod === 'store_credit') {
      // ─── STORE CREDIT REFUND ──────────────────────────────────────────
      if (!customerId) {
        return NextResponse.json({ error: 'Customer record missing. Cannot issue store credit.' }, { status: 400 });
      }

      await prisma.$transaction(async (tx: any) => {
        // Increment customer store credit balance
        await tx.customer.update({
          where: { id: customerId },
          data: {
            storeCredits: {
              increment: finalRefundAmount
            }
          }
        });

        // Create audit log transaction record
        await tx.storeCredit.create({
          data: {
            customerId,
            amount: finalRefundAmount,
            type: 'REFUND',
            description: `Approved Store Credit Refund for Order #${order.shopifyOrderId || order.id}`,
            orderId: order.id,
            returnId: targetEntity.id
          }
        });
      });

      isStoreCreditProcessed = true;
      console.log(`[AdminRefundApprove] Store Credit of ₹${finalRefundAmount} issued to Customer ${customerId}`);

    } else {
      // ─── RAZORPAY / ORIGINAL PAYMENT METHOD REFUND ───────────────────
      const paymentId = order.razorpayPaymentId;

      if (!paymentId) {
        console.warn(`[AdminRefundApprove] Order ${order.id} has no razorpayPaymentId. Logging local refund record.`);
      } else {
        const isMock = paymentId.startsWith('pay_mock_') || 
                       (order.razorpayOrderId && order.razorpayOrderId.startsWith('order_mock_')) ||
                       process.env.NODE_ENV === 'test';

        if (isMock) {
          console.warn(`[AdminRefundApprove] Processing MOCK Razorpay refund for payment ${paymentId}`);
          await prisma.payment.create({
            data: {
              orderId: order.id,
              customerId: order.customerId,
              amount: finalRefundAmount,
              type: 'refund',
              status: 'completed',
              gateway: 'razorpay'
            }
          });
          razorpayRefundId = `mock_rf_${Date.now()}`;
        } else {
          try {
            const { resolveRazorpayCredentials } = await import('@/lib/razorpay-credentials');
            const Razorpay = (await import('razorpay')).default;
            const creds = await resolveRazorpayCredentials();
            const razorpayInstance = new Razorpay({ key_id: creds.key_id, key_secret: creds.key_secret });

            const amountInPaise = Math.round(finalRefundAmount * 100);
            const refundRes = await razorpayInstance.payments.refund(paymentId, {
              amount: amountInPaise,
              notes: {
                refundRequestId: targetEntity.id,
                orderId: order.id,
                approvedBy: user.email || 'Admin',
                reason: 'Admin Approved Customer Return Refund'
              }
            });

            razorpayRefundId = refundRes.id;
            console.log(`[AdminRefundApprove] Razorpay refund successful! Refund ID: ${razorpayRefundId}`);

            await prisma.payment.create({
              data: {
                orderId: order.id,
                customerId: order.customerId,
                amount: finalRefundAmount,
                type: 'refund',
                status: 'completed',
                gateway: 'razorpay'
              }
            });
          } catch (refundErr: any) {
            console.error('[AdminRefundApprove] Razorpay refund failed:', refundErr);
            const errMsg = refundErr?.error?.description || refundErr?.message || 'Razorpay refund execution failed';
            return NextResponse.json({ error: `Razorpay refund failed: ${errMsg}. Please verify transaction status.` }, { status: 500 });
          }
        }
      }
    }

    // 4. Update Database State to REFUNDED / COMPLETED
    await prisma.$transaction(async (tx: any) => {
      if (isRequestGroup) {
        await tx.returnRequest.update({
          where: { id: refundId },
          data: {
            status: 'refunded',
            actualRefund: finalRefundAmount,
            refundType: refundMethod === 'store_credit' ? 'store_credit' : 'original_source',
            refundReleasedAt: new Date()
          }
        });

        await tx.return.updateMany({
          where: { returnRequestId: refundId },
          data: {
            status: 'REFUNDED',
            refundAmount: finalRefundAmount,
            refundStatus: 'COMPLETED',
            refundMethod: refundMethod,
            storeCreditAmount: refundMethod === 'store_credit' ? finalRefundAmount : 0
          }
        });
      } else {
        await tx.return.update({
          where: { id: refundId },
          data: {
            status: 'REFUNDED',
            refundAmount: finalRefundAmount,
            refundStatus: 'COMPLETED',
            refundMethod: refundMethod,
            storeCreditAmount: refundMethod === 'store_credit' ? finalRefundAmount : 0
          }
        });
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          refundStatus: 'completed',
          paymentStatus: 'refunded',
          status: 'returned'
        }
      });
    });

    // 5. Restock SKUs if applicable
    try {
      const { restoreSkuToStock } = await import('@/lib/services/skuService');
      const itemsToRestock = isRequestGroup ? returnRequest!.returns : [standaloneReturn!];
      for (const ret of itemsToRestock) {
        if (ret.sku) {
          await restoreSkuToStock(ret.sku, 'RETURN_RESTOCK', `Admin Approved Refund (${user.email || 'Admin'})`);
        }
      }
    } catch (skuErr: any) {
      console.error('[AdminRefundApprove] SKU restock warning:', skuErr?.message);
    }

    // 6. Shopify Refund Sync if shopifyOrderId exists
    if (order.shopifyOrderId) {
      try {
        const itemsToRefund = isRequestGroup ? returnRequest!.returns : [standaloneReturn!];
        const refundLineItems: any[] = [];

        for (const item of itemsToRefund) {
          const matchingLineItem = order.items.find(
            (oi: any) => oi.sku === item.sku || oi.productId === item.productId
          );

          if (matchingLineItem?.shopifyLineItemId) {
            refundLineItems.push({
              line_item_id: parseInt(matchingLineItem.shopifyLineItemId, 10),
              quantity: item.quantity || 1,
              restock_type: 'return'
            });
          }
        }

        if (refundLineItems.length > 0) {
          await createRefund(order.shopifyOrderId, refundLineItems, `Admin approved refund (${refundMethod})`);
          console.log(`✅ Shopify refund synced for Order ${order.shopifyOrderId}`);
        }
      } catch (shopifyErr: any) {
        console.error('⚠️ Shopify refund sync warning:', shopifyErr?.message);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Refund of ₹${finalRefundAmount} successfully approved and processed via ${refundMethod.toUpperCase().replace('_', ' ')}.`,
      refundMethod,
      finalRefundAmount,
      razorpayRefundId
    });

  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('POST /api/admin/refunds/[id]/approve Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to approve refund' }, { status: 500 });
  }
}
