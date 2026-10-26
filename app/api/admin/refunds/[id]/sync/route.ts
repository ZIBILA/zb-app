import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/refunds/[id]/sync
 * Syncs the current status of a refund directly with Razorpay API.
 * Updates return/exchange/order status to reflect the live status (processed, failed, pending).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'edit');

    const refundId = params.id;

    // Check ReturnRequest, Standalone Return, or ExchangeRequest
    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: refundId },
      include: {
        order: { include: { payments: true } },
        returns: true
      }
    });

    let standaloneReturn: any = null;
    let exchangeRequest: any = null;

    if (!returnRequest) {
      standaloneReturn = await prisma.return.findUnique({
        where: { id: refundId },
        include: { order: { include: { payments: true } } }
      });
    }

    if (!returnRequest && !standaloneReturn) {
      exchangeRequest = await prisma.exchangeRequest.findUnique({
        where: { id: refundId },
        include: { order: { include: { payments: true } }, exchanges: true }
      });
    }

    if (!returnRequest && !standaloneReturn && !exchangeRequest) {
      return NextResponse.json({ error: 'Refund request record not found' }, { status: 404 });
    }

    const order = (returnRequest || standaloneReturn || exchangeRequest).order;
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const paymentId = order.razorpayPaymentId;
    if (!paymentId) {
      return NextResponse.json({
        success: true,
        message: 'No Razorpay payment on record to sync',
        status: 'not_applicable'
      });
    }

    // Mock check
    if (paymentId.startsWith('pay_mock_') || process.env.NODE_ENV === 'test') {
      return NextResponse.json({
        success: true,
        message: 'Mock payment — nothing to sync with Razorpay',
        status: 'not_applicable',
        isMock: true
      });
    }

    // Connect to Razorpay to inspect refunds on this payment
    const { resolveRazorpayCredentials } = await import('@/lib/razorpay-credentials');
    const Razorpay = (await import('razorpay')).default;
    const creds = await resolveRazorpayCredentials();
    const razorpay: any = new Razorpay({ key_id: creds.key_id, key_secret: creds.key_secret });

    const refundList = await razorpay.payments.fetchMultipleRefund(paymentId, { count: 50 });
    // Only refunds tagged with THIS request; prefer a processed one, then pending, then the failed one.
    const candidates = (refundList?.items || []).filter(
      (r: any) => r?.notes?.refundRequestId === refundId || r?.notes?.exchangeRequestId === refundId
    );
    const matchingRefund =
      candidates.find((r: any) => r?.status === 'processed') ||
      candidates.find((r: any) => r?.status === 'pending') ||
      candidates[0];

    if (!matchingRefund) {
      return NextResponse.json({
        success: true,
        message: 'No refund matching this request found on Razorpay',
        razorpayStatus: 'not_found'
      });
    }

    const rzpStatus = String(matchingRefund.status || '').toLowerCase(); // processed, failed, pending

    if (rzpStatus === 'processed') {
      await prisma.$transaction(async (tx: any) => {
        if (returnRequest) {
          await tx.returnRequest.update({
            where: { id: refundId },
            data: { status: 'refunded', refundReleasedAt: new Date() }
          });
          await tx.return.updateMany({
            where: { returnRequestId: refundId },
            data: { status: 'REFUNDED', refundStatus: 'COMPLETED' }
          });
        } else if (standaloneReturn) {
          await tx.return.update({
            where: { id: refundId },
            data: { status: 'REFUNDED', refundStatus: 'COMPLETED' }
          });
        } else if (exchangeRequest) {
          await tx.exchangeRequest.update({
            where: { id: refundId },
            data: { paymentStatus: 'refunded_original' }
          });
          await tx.exchange.updateMany({
            where: { exchangeRequestId: refundId },
            data: { paymentStatus: 'refunded' }
          });
        }

        await tx.payment.updateMany({
          where: { orderId: order.id, type: 'refund', status: 'processing', amount: Number(matchingRefund.amount) / 100 },
          data: { status: 'completed' }
        });

        await tx.order.update({
          where: { id: order.id },
          data: { refundStatus: 'completed', paymentStatus: 'refunded', refundError: null }
        });
      });

      return NextResponse.json({
        success: true,
        message: `Refund ${matchingRefund.id} is confirmed PROCESSED by Razorpay`,
        razorpayRefundId: matchingRefund.id,
        status: 'completed'
      });
    } else if (rzpStatus === 'failed') {
      const errorMsg = matchingRefund.error_description || 'Refund failed at Razorpay';
      await prisma.payment.updateMany({
        where: { orderId: order.id, type: 'refund', status: 'processing', amount: Number(matchingRefund.amount) / 100 },
        data: { status: 'failed' }
      });
      if (returnRequest) {
        await prisma.returnRequest.update({
          where: { id: refundId },
          data: { status: 'refund_failed' }
        });
        await prisma.return.updateMany({
          where: { returnRequestId: refundId },
          data: { refundStatus: 'FAILED' }
        });
      } else if (standaloneReturn) {
        await prisma.return.update({
          where: { id: refundId },
          data: { refundStatus: 'FAILED' }
        });
      } else if (exchangeRequest) {
        await prisma.exchangeRequest.update({
          where: { id: refundId },
          data: { paymentStatus: 'refund_failed' }
        });
      }
      await prisma.order.update({
        where: { id: order.id },
        data: { refundStatus: 'failed', refundError: errorMsg }
      });

      return NextResponse.json({
        success: true,
        message: `Refund ${matchingRefund.id} marked FAILED by Razorpay: ${errorMsg}`,
        razorpayRefundId: matchingRefund.id,
        status: 'failed',
        error: errorMsg
      });
    }

    return NextResponse.json({
      success: true,
      message: `Refund ${matchingRefund.id} is ${rzpStatus} at Razorpay`,
      razorpayRefundId: matchingRefund.id,
      status: rzpStatus
    });

  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('POST /api/admin/refunds/[id]/sync Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to sync refund' }, { status: 500 });
  }
}
