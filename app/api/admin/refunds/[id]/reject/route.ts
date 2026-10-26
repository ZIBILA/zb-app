import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/refunds/[id]/reject
 * Rejects a return/exchange refund request with reason.
 * Admin-only security check enforced.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'edit');

    const refundId = params.id;
    const body = await req.json().catch(() => ({}));
    const { reason } = body;

    const rejectionReason = reason || 'Refund request rejected by Admin following Quality Check (QC).';

    let returnRequest = await prisma.returnRequest.findUnique({
      where: { id: refundId }
    });

    let standaloneReturn: any = null;
    let exchangeRequest: any = null;

    if (!returnRequest) {
      standaloneReturn = await prisma.return.findUnique({
        where: { id: refundId }
      });
    }

    if (!returnRequest && !standaloneReturn) {
      exchangeRequest = await prisma.exchangeRequest.findUnique({
        where: { id: refundId }
      });
    }

    if (!returnRequest && !standaloneReturn && !exchangeRequest) {
      return NextResponse.json({ error: 'Refund request record not found.' }, { status: 404 });
    }

    if (returnRequest) {
      await prisma.$transaction([
        prisma.returnRequest.update({
          where: { id: refundId },
          data: {
            status: 'rejected',
            reason: `REJECTED: ${rejectionReason}`
          }
        }),
        prisma.return.updateMany({
          where: { returnRequestId: refundId },
          data: {
            status: 'REJECTED',
            refundStatus: 'REJECTED'
          }
        })
      ]);
    } else if (standaloneReturn) {
      await prisma.return.update({
        where: { id: refundId },
        data: {
          status: 'REJECTED',
          refundStatus: 'REJECTED',
          reason: `REJECTED: ${rejectionReason}`
        }
      });
    } else if (exchangeRequest) {
      await prisma.$transaction([
        prisma.exchangeRequest.update({
          where: { id: refundId },
          data: {
            paymentStatus: 'rejected',
            reason: `REJECTED: ${rejectionReason}`
          }
        }),
        prisma.exchange.updateMany({
          where: { exchangeRequestId: refundId },
          data: {
            paymentStatus: 'rejected'
          }
        })
      ]);
    }

    return NextResponse.json({
      success: true,
      message: 'Refund request has been rejected.'
    });

  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('POST /api/admin/refunds/[id]/reject Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to reject refund' }, { status: 500 });
  }
}
