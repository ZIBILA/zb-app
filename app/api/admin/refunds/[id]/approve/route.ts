import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { createRefund } from '@/lib/shopify-admin';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { resolveRefundMethod } from '@/lib/returnPolicy';
import { splitRefundAcrossLines } from '@/lib/services/refundSplit';

export const dynamic = 'force-dynamic';

/** A release that has been "in progress" longer than this is treated as crashed and may be retried. */
const CLAIM_STALE_MS = 10 * 60 * 1000;

class ClaimLostError extends Error {
  constructor() {
    super('Refund claim was lost before it could be completed.');
  }
}

/**
 * POST /api/admin/refunds/[id]/approve
 * Releases the customer's money (Razorpay refund to the original source) or Store Credit for a
 * return that has been physically received.
 *
 * Integrity rules:
 *  - The request is CLAIMED atomically (status → refund_pending) before any money moves, so two
 *    admins / a double click / a retry can never both release it.
 *  - Store credit + the "refunded" status commit in ONE transaction (all or nothing).
 *  - Razorpay refunds are idempotent per request: a retry reuses an existing refund tagged with
 *    this request id instead of creating a second one.
 *  - Any failure releases the claim so the admin can retry.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission('RETURNS_EXCHANGES', 'edit');
    const user = session.user as { email?: string | null; role?: string };

    const refundId = params.id;
    const body = await req.json().catch(() => ({}));
    const { overrideRefundMethod, overrideAmount, manualSettlement } = body;

    // 1. Locate ReturnRequest or Standalone Return
    const returnRequest = await prisma.returnRequest.findUnique({
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
    const targetEntity: any = returnRequest || standaloneReturn;
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

    // COD → store credit only. Prepaid uses the customer's saved choice (no admin override).
    const refundMethod = resolveRefundMethod(order, initialMethod);

    // The customer's money / credit is released only after we physically hold the parcel.
    const receivedOk = isRequestGroup
      ? !!returnRequest!.receivedAt || ['received', 'qc_passed', 'refund_pending'].includes(String(returnRequest!.status).toLowerCase())
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

    if (!Number.isFinite(finalRefundAmount) || finalRefundAmount <= 0) {
      return NextResponse.json({ error: 'Invalid refund amount. Refund amount must be greater than 0.' }, { status: 400 });
    }

    // Guard against typos / tampering: never release more than the order was worth.
    const orderTotal = Number(order.totalPrice);
    if (Number.isFinite(orderTotal) && orderTotal > 0 && finalRefundAmount > orderTotal + 0.01) {
      return NextResponse.json(
        { error: `Refund amount ₹${finalRefundAmount} exceeds the order total ₹${orderTotal}.` },
        { status: 400 }
      );
    }

    const customerId = order.customerId;

    if (refundMethod === 'store_credit' && !customerId) {
      return NextResponse.json({ error: 'Customer record missing. Cannot issue store credit.' }, { status: 400 });
    }

    // Prepaid refund to the original source needs a real payment to refund against.
    const paymentId: string | null = order.razorpayPaymentId || null;
    if (refundMethod === 'original_method' && !paymentId && manualSettlement !== true) {
      return NextResponse.json(
        {
          error:
            'This order has no Razorpay payment on record, so nothing can be refunded to the original payment source. ' +
            'Issue Store Credit instead, or refund the customer manually and confirm with manualSettlement.',
        },
        { status: 400 }
      );
    }

    // 3. CLAIM the release atomically before any money moves.
    const staleCutoff = new Date(Date.now() - CLAIM_STALE_MS);
    const previousStatus: string = isRequestGroup ? returnRequest!.status : standaloneReturn!.status;
    const previousRefundStatus: string | null = isRequestGroup ? null : (standaloneReturn!.refundStatus ?? null);

    let claimed = 0;
    if (isRequestGroup) {
      const res = await prisma.returnRequest.updateMany({
        where: {
          id: refundId,
          refundReleasedAt: null,
          AND: [
            { status: { notIn: ['refunded', 'rejected', 'cancelled'] } },
            {
              OR: [
                { status: { in: ['received', 'qc_passed'] } },
                { receivedAt: { not: null }, status: { not: 'refund_pending' } },
                { status: 'refund_pending', updatedAt: { lt: staleCutoff } },
              ],
            },
          ],
        },
        data: { status: 'refund_pending' },
      });
      claimed = res.count;
    } else {
      const res = await prisma.return.updateMany({
        where: {
          id: refundId,
          status: 'RECEIVED',
          OR: [
            { refundStatus: null },
            { refundStatus: { notIn: ['COMPLETED', 'PROCESSING'] } },
            { refundStatus: 'PROCESSING', updatedAt: { lt: staleCutoff } },
          ],
        },
        data: { refundStatus: 'PROCESSING' },
      });
      claimed = res.count;
    }

    if (claimed === 0) {
      return NextResponse.json(
        { error: 'This refund is already being processed or has been completed. Refresh and check its status.' },
        { status: 409 }
      );
    }

    const releaseClaim = async () => {
      try {
        if (isRequestGroup) {
          await prisma.returnRequest.updateMany({
            where: { id: refundId, status: 'refund_pending' },
            data: { status: previousStatus === 'refund_pending' ? 'received' : previousStatus },
          });
        } else {
          await prisma.return.updateMany({
            where: { id: refundId, refundStatus: 'PROCESSING' },
            data: { refundStatus: previousRefundStatus ?? 'PENDING' },
          });
        }
      } catch (e: any) {
        console.error('[AdminRefundApprove] Failed to release claim:', e?.message);
      }
    };

    // 4. Move the money (Razorpay only; store credit happens inside the final transaction).
    let razorpayRefundId: string | null = null;
    let recordRefundPayment = false;

    if (refundMethod === 'original_method' && paymentId) {
      const isMock =
        paymentId.startsWith('pay_mock_') ||
        (order.razorpayOrderId && order.razorpayOrderId.startsWith('order_mock_')) ||
        process.env.NODE_ENV === 'test';

      if (isMock) {
        console.warn(`[AdminRefundApprove] Processing MOCK Razorpay refund for payment ${paymentId}`);
        razorpayRefundId = `mock_rf_${Date.now()}`;
        recordRefundPayment = true;
      } else {
        try {
          const { resolveRazorpayCredentials } = await import('@/lib/razorpay-credentials');
          const Razorpay = (await import('razorpay')).default;
          const creds = await resolveRazorpayCredentials();
          const razorpayInstance: any = new Razorpay({ key_id: creds.key_id, key_secret: creds.key_secret });

          // Idempotency: if a previous attempt already created a refund for THIS request, reuse it.
          let existingRefund: any = null;
          try {
            const prior = await razorpayInstance.payments.fetchMultipleRefund(paymentId, { count: 100 });
            existingRefund = (prior?.items || []).find(
              (r: any) => r?.notes?.refundRequestId === targetEntity.id && r?.status !== 'failed'
            );
          } catch (lookupErr: any) {
            // If we cannot prove no refund exists, refuse rather than risk a double refund.
            throw new Error(`Could not check existing Razorpay refunds (${lookupErr?.error?.description || lookupErr?.message || 'unknown'})`);
          }

          if (existingRefund) {
            razorpayRefundId = existingRefund.id;
            console.log(`[AdminRefundApprove] Reusing existing Razorpay refund ${razorpayRefundId} for request ${targetEntity.id}`);
          } else {
            const refundRes = await razorpayInstance.payments.refund(paymentId, {
              amount: Math.round(finalRefundAmount * 100),
              notes: {
                refundRequestId: targetEntity.id,
                orderId: order.id,
                approvedBy: user.email || 'Admin',
                reason: 'Admin Approved Customer Return Refund'
              }
            });
            razorpayRefundId = refundRes.id;
            console.log(`[AdminRefundApprove] Razorpay refund successful! Refund ID: ${razorpayRefundId}`);
          }
          recordRefundPayment = true;
        } catch (refundErr: any) {
          console.error('[AdminRefundApprove] Razorpay refund failed:', refundErr);
          await releaseClaim();
          const errMsg = refundErr?.error?.description || refundErr?.message || 'Razorpay refund execution failed';
          return NextResponse.json({ error: `Razorpay refund failed: ${errMsg}. Please verify transaction status.` }, { status: 500 });
        }
      }
    }

    // 5. Commit everything in ONE transaction: credit (if any) + final status + order.
    try {
      await prisma.$transaction(async (tx: any) => {
        if (isRequestGroup) {
          const done = await tx.returnRequest.updateMany({
            where: { id: refundId, status: 'refund_pending' },
            data: {
              status: 'refunded',
              actualRefund: finalRefundAmount,
              refundType: refundMethod === 'store_credit' ? 'store_credit' : 'original_source',
              refundReleasedAt: new Date()
            }
          });
          if (done.count !== 1) throw new ClaimLostError();

          for (const part of splitRefundAcrossLines(returnRequest!.returns, finalRefundAmount)) {
            await tx.return.update({
              where: { id: part.id },
              data: {
                status: 'REFUNDED',
                refundAmount: part.amount,
                refundStatus: 'COMPLETED',
                refundMethod: refundMethod,
                storeCreditAmount: refundMethod === 'store_credit' ? part.amount : 0
              }
            });
          }
        } else {
          const done = await tx.return.updateMany({
            where: { id: refundId, refundStatus: 'PROCESSING' },
            data: {
              status: 'REFUNDED',
              refundAmount: finalRefundAmount,
              refundStatus: 'COMPLETED',
              refundMethod: refundMethod,
              storeCreditAmount: refundMethod === 'store_credit' ? finalRefundAmount : 0
            }
          });
          if (done.count !== 1) throw new ClaimLostError();
        }

        if (refundMethod === 'store_credit') {
          await tx.customer.update({
            where: { id: customerId },
            data: { storeCredits: { increment: finalRefundAmount } }
          });
          await tx.storeCredit.create({
            data: {
              customerId,
              amount: finalRefundAmount,
              type: 'REFUND',
              description: `Approved Store Credit Refund for Order #${order.shopifyOrderId || order.id}`,
              orderId: order.id,
              returnId: targetEntity.id,
              // Spendable amount tracked per credit (checkout debits and expiry both read this).
              remainingAmount: finalRefundAmount
            }
          });
        } else if (recordRefundPayment) {
          await tx.payment.create({
            data: {
              orderId: order.id,
              customerId: order.customerId,
              amount: finalRefundAmount,
              type: 'refund',
              status: 'completed',
              gateway: 'razorpay'
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
    } catch (txErr: any) {
      console.error('[AdminRefundApprove] Final transaction failed:', txErr);
      await releaseClaim();
      const moneyMoved = refundMethod === 'original_method' && razorpayRefundId && !String(razorpayRefundId).startsWith('mock_');
      return NextResponse.json(
        {
          error: moneyMoved
            ? `Razorpay refund ${razorpayRefundId} was issued, but saving it failed. Click release again — the existing refund will be reused, not repeated.`
            : 'Could not complete the release. Nothing was changed — please retry.',
        },
        { status: 500 }
      );
    }

    if (refundMethod === 'store_credit') {
      console.log(`[AdminRefundApprove] Store Credit of ₹${finalRefundAmount} issued to Customer ${customerId}`);
    }

    // Reverse proportional coupon cashback / Store Coins earned on this order.
    try {
      const { reverseCouponCashbackForReturn } = await import('@/lib/storeCreditsHelper');
      const paidProductAmount = Math.max(
        0,
        Number(order.subtotalPrice || order.totalPrice || 0) - Number(order.discountAmount || 0)
      );
      await reverseCouponCashbackForReturn({
        orderId: order.id,
        customerId,
        refundAmount: finalRefundAmount,
        orderPaidAmount: paidProductAmount || Number(order.totalPrice || 0),
      });
    } catch (cashbackErr: any) {
      console.error('[AdminRefundApprove] Coupon cashback reversal warning:', cashbackErr?.message);
    }

    // 6. Restock SKUs if applicable (best effort — the release itself is already committed)
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

    // 7. Shopify Refund Sync if shopifyOrderId exists (best effort)
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
          await createRefund(
            order.shopifyOrderId,
            refundLineItems,
            `Admin approved refund (${refundMethod})`,
            { notify: refundMethod !== 'store_credit' }
          );
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
