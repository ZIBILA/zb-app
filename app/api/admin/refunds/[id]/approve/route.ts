import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { createRefund } from '@/lib/shopify-admin';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { resolveRefundMethod } from '@/lib/returnPolicy';
import { splitRefundAcrossLines } from '@/lib/services/refundSplit';
import { calculateOrderRefundLimits } from '@/lib/services/refundAccuracy';
import { assignRefundId } from '@/lib/orderNumber';

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
 * return or exchange difference refund that has passed physical Quality Check.
 *
 * Integrity rules:
 *  - Enforces strict QC & approval rules: cannot approve refunds that failed QC or have not been received.
 *  - Prevents incorrect & duplicate refunds: caps refund at remaining order refundable balance.
 *  - Atomic claim: prevents concurrent double-releases.
 *  - Idempotent Razorpay execution: reuses existing refund if already issued.
 *  - Updates status to completed / processing / failed and syncs with Razorpay.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission('RETURNS_EXCHANGES', 'edit');
    const user = session.user as { email?: string | null; role?: string };

    const refundId = params.id;
    const body = await req.json().catch(() => ({}));
    const { overrideAmount, manualSettlement } = body;

    // 1. Locate ReturnRequest, Standalone Return, or ExchangeRequest
    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: refundId },
      include: {
        returns: { include: { product: true } },
        order: { include: { items: true, customer: true, payments: true } }
      }
    });

    let standaloneReturn: any = null;
    let exchangeRequest: any = null;

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
      exchangeRequest = await prisma.exchangeRequest.findUnique({
        where: { id: refundId },
        include: {
          exchanges: { include: { originalProduct: true, newProduct: true } },
          order: { include: { items: true, customer: true, payments: true } }
        }
      });
    }

    if (!returnRequest && !standaloneReturn && !exchangeRequest) {
      return NextResponse.json({ error: 'Refund request record not found.' }, { status: 404 });
    }

    const isExchange = !!exchangeRequest;
    const isReturnRequestGroup = !!returnRequest;
    const targetEntity: any = returnRequest || standaloneReturn || exchangeRequest;
    const order = targetEntity.order;

    if (!order) {
      return NextResponse.json({ error: 'Associated order not found.' }, { status: 404 });
    }

    // 3. Check if already refunded
    const alreadyRefunded = isReturnRequestGroup
      ? returnRequest!.returns.some((r: any) => r.refundStatus === 'COMPLETED') || returnRequest!.status === 'refunded'
      : isExchange
      ? ['refunded', 'refunded_original'].includes(String(exchangeRequest!.paymentStatus || '').toLowerCase())
      : standaloneReturn!.refundStatus === 'COMPLETED' || standaloneReturn!.status === 'REFUNDED';

    if (alreadyRefunded) {
      return NextResponse.json({ error: 'This refund request has already been processed and completed.' }, { status: 400 });
    }

    // 2. QC & approval flow: money is released only after the parcel was received AND passed QC.
    if (isReturnRequestGroup) {
      const currentStatus = String(returnRequest!.status || '').toLowerCase();
      if (currentStatus === 'qc_failed') {
        return NextResponse.json(
          { error: 'Quality Check failed for this return parcel. Refund cannot be approved for items that failed QC.' },
          { status: 400 }
        );
      }
      if (['rejected', 'cancelled'].includes(currentStatus)) {
        return NextResponse.json(
          { error: `Return request is ${currentStatus} and cannot be refunded.` },
          { status: 400 }
        );
      }
      // A retry after a failed / interrupted release keeps the QC result on the return lines.
      const qcPassed =
        currentStatus === 'qc_passed' ||
        (['refund_pending', 'refund_failed'].includes(currentStatus) &&
          returnRequest!.returns.length > 0 &&
          returnRequest!.returns.every((r: any) => String(r.status).toUpperCase() === 'QC_PASSED'));
      if (!qcPassed) {
        return NextResponse.json(
          { error: 'Quality Check not passed yet. Mark the parcel received and pass QC before releasing the refund / store credit.' },
          { status: 400 }
        );
      }
    } else if (standaloneReturn) {
      const currentStatus = String(standaloneReturn!.status || '').toUpperCase();
      if (currentStatus === 'QC_FAILED') {
        return NextResponse.json(
          { error: 'Quality Check failed for this return item. Refund cannot be approved for items that failed QC.' },
          { status: 400 }
        );
      }
      if (currentStatus !== 'QC_PASSED') {
        return NextResponse.json(
          { error: 'Quality Check not passed yet. Receive the parcel and pass QC before releasing the refund.' },
          { status: 400 }
        );
      }
    } else if (isExchange) {
      const currentStatus = String(exchangeRequest!.status || '').toLowerCase();
      const qcOf = (e: any) => String(e.qcStatus || '').toLowerCase();
      if (exchangeRequest!.exchanges.some((e: any) => qcOf(e) === 'failed')) {
        return NextResponse.json(
          { error: 'Quality Check failed for this exchange parcel. Refund cannot be approved for items that failed QC.' },
          { status: 400 }
        );
      }
      if (['rejected', 'cancelled'].includes(currentStatus)) {
        return NextResponse.json(
          { error: `Exchange request is ${currentStatus} and cannot be refunded.` },
          { status: 400 }
        );
      }
      if (exchangeRequest!.exchanges.length === 0 || !exchangeRequest!.exchanges.every((e: any) => qcOf(e) === 'passed')) {
        return NextResponse.json(
          { error: 'Quality Check not passed yet. Receive the exchange parcel and pass QC before releasing the refund.' },
          { status: 400 }
        );
      }
    }

    // 4. Refund Accuracy & Calculation
    const orderLimits = await calculateOrderRefundLimits(order.id);

    if (orderLimits.maxRemainingRefundable <= 0) {
      return NextResponse.json(
        {
          error: `This order has already been fully refunded. Total paid: ₹${orderLimits.totalPaid}, Already refunded: ₹${orderLimits.totalAlreadyRefunded}. No additional refund can be processed.`,
        },
        { status: 400 }
      );
    }

    // Calculate base refund amount
    let rawAmount = 0;
    if (isReturnRequestGroup) {
      rawAmount = returnRequest!.actualRefund || returnRequest!.estimatedRefund || returnRequest!.returns.reduce((s: number, r: any) => s + (r.refundAmount || 0), 0);
    } else if (standaloneReturn) {
      rawAmount = standaloneReturn!.refundAmount || 0;
    } else if (isExchange) {
      // Only a negative difference (customer took a cheaper item) is owed back; a positive one was paid by them.
      const priceDifference = Number(exchangeRequest!.priceDifference || 0);
      if (!(priceDifference < 0)) {
        return NextResponse.json(
          { error: 'This exchange has no refundable price difference — the customer owes or paid the difference, not the store.' },
          { status: 400 }
        );
      }
      rawAmount = -priceDifference;
    }

    const finalRefundAmount = overrideAmount !== undefined && Number(overrideAmount) > 0
      ? Number(overrideAmount)
      : rawAmount;

    if (!Number.isFinite(finalRefundAmount) || finalRefundAmount <= 0) {
      return NextResponse.json({ error: 'Invalid refund amount. Refund amount must be greater than 0.' }, { status: 400 });
    }

    // Guard: never refund more than remaining refundable on the order
    if (finalRefundAmount > orderLimits.maxRemainingRefundable + 0.01) {
      return NextResponse.json(
        {
          error: `Refund amount ₹${finalRefundAmount} exceeds the remaining refundable balance of ₹${orderLimits.maxRemainingRefundable} for this order.`,
        },
        { status: 400 }
      );
    }

    // 5. Determine Target Refund Method
    let initialMethod = 'original_method';
    if (isReturnRequestGroup) {
      initialMethod = returnRequest!.returns[0]?.refundMethod || returnRequest!.refundType || 'original_method';
    } else if (standaloneReturn) {
      initialMethod = standaloneReturn!.refundMethod || 'original_method';
    } else if (isExchange) {
      initialMethod = exchangeRequest!.settlementPreference === 'REFUND_STORE_CREDIT' ? 'store_credit' : 'original_method';
    }

    // COD -> Store credit only. Prepaid uses customer's saved choice
    const refundMethod = resolveRefundMethod(order, initialMethod);
    const customerId = order.customerId;

    if (refundMethod === 'store_credit' && !customerId) {
      return NextResponse.json({ error: 'Customer record missing. Cannot issue store credit.' }, { status: 400 });
    }

    // Prepaid refund to original source needs a real payment
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

    // 6. CLAIM the release atomically before moving any money
    const staleCutoff = new Date(Date.now() - CLAIM_STALE_MS);
    const previousExchangePaymentStatus: string | null = isExchange ? (exchangeRequest!.paymentStatus ?? null) : null;
    let claimed = 0;

    if (isReturnRequestGroup) {
      const res = await prisma.returnRequest.updateMany({
        where: {
          id: refundId,
          refundReleasedAt: null,
          AND: [
            {
              OR: [
                { status: { in: ['qc_passed', 'refund_failed'] } },
                { status: 'refund_pending', updatedAt: { lt: staleCutoff } },
              ],
            },
          ],
        },
        data: { status: 'refund_pending' },
      });
      claimed = res.count;
    } else if (standaloneReturn) {
      const res = await prisma.return.updateMany({
        where: {
          id: refundId,
          status: 'QC_PASSED',
          OR: [
            { refundStatus: null },
            { refundStatus: { notIn: ['COMPLETED', 'PROCESSING'] } },
            { refundStatus: 'PROCESSING', updatedAt: { lt: staleCutoff } },
          ],
        },
        data: { refundStatus: 'PROCESSING' },
      });
      claimed = res.count;
    } else if (isExchange) {
      const res = await prisma.exchangeRequest.updateMany({
        where: {
          id: refundId,
          priceDifference: { lt: 0 },
          AND: [
            { status: { notIn: ['rejected', 'cancelled'] } },
            {
              OR: [
                { paymentStatus: { in: ['refund_original_pending', 'refund_credit_pending', 'refund_failed'] } },
                { paymentStatus: 'refund_pending', updatedAt: { lt: staleCutoff } },
              ],
            },
          ],
        },
        data: { paymentStatus: 'refund_pending' },
      });
      claimed = res.count;
    }

    if (claimed === 0) {
      return NextResponse.json(
        { error: 'This refund is already being processed or has been completed. Refresh and check its status.' },
        { status: 409 }
      );
    }

    const releaseClaim = async (statusOnFailure = 'failed', errorMessage?: string) => {
      try {
        if (isReturnRequestGroup) {
          await prisma.returnRequest.updateMany({
            where: { id: refundId, status: 'refund_pending' },
            data: { status: statusOnFailure === 'failed' ? 'refund_failed' : 'qc_passed' },
          });
        } else if (standaloneReturn) {
          await prisma.return.updateMany({
            where: { id: refundId, refundStatus: 'PROCESSING' },
            data: { refundStatus: statusOnFailure === 'failed' ? 'FAILED' : 'PENDING' },
          });
        } else if (isExchange) {
          await prisma.exchangeRequest.updateMany({
            where: { id: refundId, paymentStatus: 'refund_pending' },
            data: {
              paymentStatus: statusOnFailure === 'failed'
                ? 'refund_failed'
                : (previousExchangePaymentStatus && previousExchangePaymentStatus !== 'refund_pending'
                  ? previousExchangePaymentStatus
                  : refundMethod === 'store_credit' ? 'refund_credit_pending' : 'refund_original_pending'),
            },
          });
        }

        if (statusOnFailure === 'failed' && errorMessage) {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              refundStatus: 'failed',
              refundError: errorMessage,
            },
          }).catch(() => {});
        }
      } catch (e: any) {
        console.error('[AdminRefundApprove] Failed to update failure state:', e?.message);
      }
    };

    // 7. Move the money (Razorpay or Mock)
    let razorpayRefundId: string | null = null;
    let recordRefundPayment = false;
    let isMock = false;
    let gatewayStatus: string | null = null;

    if (refundMethod === 'original_method' && paymentId) {
      isMock =
        paymentId.startsWith('pay_mock_') ||
        (order.razorpayOrderId && order.razorpayOrderId.startsWith('order_mock_')) ||
        process.env.NODE_ENV === 'test';

      if (isMock) {
        console.warn(`[AdminRefundApprove] Processing MOCK Razorpay refund for payment ${paymentId}`);
        let generatedZBRF: string | null = null;
        try {
          generatedZBRF = await assignRefundId(prisma);
        } catch {}
        razorpayRefundId = generatedZBRF || `mock_rf_${Date.now()}`;
        recordRefundPayment = true;
      } else {
        try {
          const { resolveRazorpayCredentials } = await import('@/lib/razorpay-credentials');
          const Razorpay = (await import('razorpay')).default;
          const creds = await resolveRazorpayCredentials();
          const razorpayInstance: any = new Razorpay({ key_id: creds.key_id, key_secret: creds.key_secret });

          // Idempotency: check if already refunded at Razorpay
          let existingRefund: any = null;
          try {
            const prior = await razorpayInstance.payments.fetchMultipleRefund(paymentId, { count: 100 });
            existingRefund = (prior?.items || []).find(
              (r: any) =>
                (r?.notes?.refundRequestId === targetEntity.id || r?.notes?.exchangeRequestId === targetEntity.id) &&
                r?.status !== 'failed'
            );
          } catch (lookupErr: any) {
            throw new Error(`Could not check existing Razorpay refunds (${lookupErr?.error?.description || lookupErr?.message || 'unknown'})`);
          }

          if (existingRefund) {
            razorpayRefundId = existingRefund.id;
            gatewayStatus = String(existingRefund.status || '').toLowerCase();
            console.log(`[AdminRefundApprove] Reusing existing Razorpay refund ${razorpayRefundId} for request ${targetEntity.id}`);
          } else {
            const refundRes = await razorpayInstance.payments.refund(paymentId, {
              amount: Math.round(finalRefundAmount * 100),
              notes: {
                refundRequestId: targetEntity.id,
                exchangeRequestId: isExchange ? targetEntity.id : undefined,
                orderId: order.id,
                approvedBy: user.email || 'Admin',
                reason: isExchange ? 'Exchange Price Difference Refund' : 'Customer Return Refund'
              }
            });
            razorpayRefundId = refundRes.id;
            gatewayStatus = String(refundRes.status || '').toLowerCase();
            console.log(`[AdminRefundApprove] Razorpay refund successful! Refund ID: ${razorpayRefundId}`);
          }
          recordRefundPayment = true;
        } catch (refundErr: any) {
          const errMsg = refundErr?.error?.description || refundErr?.message || 'Razorpay refund execution failed';
          console.error('[AdminRefundApprove] Razorpay refund failed:', errMsg);
          await releaseClaim('failed', errMsg);
          return NextResponse.json({ error: `Razorpay refund failed: ${errMsg}. Refund marked as failed in dashboard.` }, { status: 500 });
        }
      }
    }

    // Razorpay accepts most refunds as "pending" and settles later (refund.processed webhook / Sync).
    // Until it reports "processed" the refund is PROCESSING, never COMPLETED.
    const settling = refundMethod === 'original_method' && recordRefundPayment && !isMock && gatewayStatus !== 'processed';

    // 8. Commit everything transactionally
    try {
      await prisma.$transaction(async (tx: any) => {
        if (isReturnRequestGroup) {
          const done = await tx.returnRequest.updateMany({
            where: { id: refundId, status: 'refund_pending' },
            data: {
              status: settling ? 'refund_pending' : 'refunded',
              actualRefund: finalRefundAmount,
              refundType: refundMethod === 'store_credit' ? 'store_credit' : 'original_source',
              refundReleasedAt: settling ? undefined : new Date()
            }
          });
          if (done.count !== 1) throw new ClaimLostError();

          for (const part of splitRefundAcrossLines(returnRequest!.returns, finalRefundAmount)) {
            await tx.return.update({
              where: { id: part.id },
              data: {
                status: settling ? undefined : 'REFUNDED',
                refundAmount: part.amount,
                refundStatus: settling ? 'PROCESSING' : 'COMPLETED',
                refundMethod: refundMethod,
                storeCreditAmount: refundMethod === 'store_credit' ? part.amount : 0
              }
            });
          }
        } else if (standaloneReturn) {
          const done = await tx.return.updateMany({
            where: { id: refundId, refundStatus: 'PROCESSING' },
            data: {
              status: settling ? undefined : 'REFUNDED',
              refundAmount: finalRefundAmount,
              refundStatus: settling ? 'PROCESSING' : 'COMPLETED',
              refundMethod: refundMethod,
              storeCreditAmount: refundMethod === 'store_credit' ? finalRefundAmount : 0
            }
          });
          if (done.count !== 1) throw new ClaimLostError();
        } else if (isExchange) {
          const done = await tx.exchangeRequest.updateMany({
            where: { id: refundId, paymentStatus: 'refund_pending' },
            data: {
              paymentStatus: settling ? 'refund_pending' : refundMethod === 'store_credit' ? 'refunded' : 'refunded_original',
            }
          });
          if (done.count !== 1) throw new ClaimLostError();

          await tx.exchange.updateMany({
            where: { exchangeRequestId: refundId },
            data: {
              paymentStatus: settling ? 'refund_pending' : 'refunded',
            }
          });
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
              type: isExchange ? 'EXCHANGE_ADJUSTMENT' : 'REFUND',
              description: `Approved Store Credit Refund for Order #${order.shopifyOrderId || order.id}`,
              orderId: order.id,
              returnId: isExchange ? undefined : targetEntity.id,
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
              status: settling ? 'processing' : 'completed',
              gateway: 'razorpay'
            }
          });
        }

        await tx.order.update({
          where: { id: order.id },
          data: {
            refundStatus: settling ? 'processing' : 'completed',
            refundError: null,
            paymentStatus: settling ? undefined : 'refunded',
            status: settling || isExchange ? undefined : 'returned'
          }
        });
      });
    } catch (txErr: any) {
      console.error('[AdminRefundApprove] Final transaction failed:', txErr);
      const moneyMoved = refundMethod === 'original_method' && !!razorpayRefundId && !isMock;
      if (moneyMoved) {
        // Money already left via Razorpay: keep the request retryable, not "failed" — a retry reuses the same refund.
        await releaseClaim('retry');
      } else {
        await releaseClaim('failed', txErr.message);
      }
      return NextResponse.json(
        {
          error: moneyMoved
            ? `Razorpay refund ${razorpayRefundId} was issued, but saving it failed. Click release again — the existing refund will be reused, not repeated.`
            : 'Could not complete the release. Nothing was changed — please retry.',
        },
        { status: 500 }
      );
    }

    // Reverse proportional coupon cashback / Store Coins earned on this order (returns only).
    if (!isExchange) {
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
    }

    // 9. Sync with Shopify if applicable
    if (order.shopifyOrderId && !isExchange) {
      try {
        const itemsToRefund = isReturnRequestGroup ? returnRequest!.returns : [standaloneReturn!];
        const refundLineItems: any[] = [];

        for (const item of itemsToRefund) {
          const matchingLineItem = order.items.find(
            (oi: any) => oi.sku === item.sku || oi.productId === item.productId
          );

          if (matchingLineItem?.shopifyLineItemId) {
            refundLineItems.push({
              line_item_id: parseInt(matchingLineItem.shopifyLineItemId, 10),
              quantity: item.quantity || 1,
              restock_type: 'no_restock'
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
      message: settling
        ? `Refund of ₹${finalRefundAmount} submitted to Razorpay and is processing. Status updates when Razorpay confirms.`
        : `Refund of ₹${finalRefundAmount} successfully approved and processed via ${refundMethod.toUpperCase().replace('_', ' ')}.`,
      refundMethod,
      finalRefundAmount,
      razorpayRefundId,
      refundStatus: settling ? 'PROCESSING' : 'COMPLETED'
    });

  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('POST /api/admin/refunds/[id]/approve Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to approve refund' }, { status: 500 });
  }
}
