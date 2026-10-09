import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { resolveRequestCustomer } from '@/lib/requestAuth';
import { refundExchangePayment } from '@/lib/services/exchangePaymentRefund';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: Request) {
  const customer = await resolveRequestCustomer(req);

  if (!customer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  try {
    const { returnRequestId } = await req.json();
    if (!returnRequestId) {
      return NextResponse.json({ error: 'returnRequestId required' }, { status: 400, headers: corsHeaders });
    }

    // Fetch the request (either ReturnRequest or ExchangeRequest)
    let returnRequest = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: { returns: true },
    });

    let exchangeRequest = null;
    let isExchange = false;

    if (!returnRequest) {
      exchangeRequest = await prisma.exchangeRequest.findUnique({
        where: { id: returnRequestId },
        include: { exchanges: true },
      });
      if (exchangeRequest) {
        isExchange = true;
      }
    }

    if (!returnRequest && !exchangeRequest) {
      return NextResponse.json({ error: 'Return or exchange request not found' }, { status: 404, headers: corsHeaders });
    }

    const customerId = isExchange ? exchangeRequest!.customerId : returnRequest!.customerId;
    const status = isExchange ? exchangeRequest!.status : returnRequest!.status;
    const orderId = isExchange ? exchangeRequest!.orderId : returnRequest!.orderId;

    if (customerId !== customer.id) {
      return NextResponse.json({ error: 'Unauthorized: not your request' }, { status: 403, headers: corsHeaders });
    }

    // Only allow cancellation when the request is still pending approval
    if (status !== 'pending_approval') {
      return NextResponse.json({ error: `Cannot cancel a processed ${isExchange ? 'exchange' : 'return'} request` }, { status: 400, headers: corsHeaders });
    }

    let updated;
    if (isExchange) {
      // 1. Claim the cancellation so an admin approve / reject cannot race it.
      const claimed = await prisma.exchangeRequest.updateMany({
        where: { id: returnRequestId, status: 'pending_approval' },
        data: { status: 'cancelled' },
      });
      if (claimed.count === 0) {
        return NextResponse.json({ error: 'This exchange request was just processed and can no longer be cancelled.' }, { status: 409, headers: corsHeaders });
      }

      // 2. Refund any price difference the customer already paid online (no-op for COD / free).
      const refund = await refundExchangePayment(returnRequestId, customer.email || customer.id, 'Exchange cancelled by customer');
      if (!refund.ok) {
        // Un-cancel so the customer can simply try again; nothing is lost.
        await prisma.exchangeRequest.updateMany({
          where: { id: returnRequestId, status: 'cancelled' },
          data: { status: 'pending_approval' },
        });
        return NextResponse.json(
          { error: 'We could not refund your payment right now, so your exchange was not cancelled. Please try again in a few minutes or contact support.' },
          { status: refund.inProgress ? 409 : 502, headers: corsHeaders }
        );
      }

      await prisma.$transaction([
        prisma.exchange.updateMany({
          where: { exchangeRequestId: returnRequestId },
          data: { status: 'cancelled' },
        }),
        prisma.order.update({
          where: { id: orderId },
          data: { status: 'delivered' },
        }),
      ]);

      updated = await prisma.exchangeRequest.findUnique({ where: { id: returnRequestId } });
      if (refund.ok && refund.refunded) {
        return NextResponse.json(
          { success: true, message: `Exchange request cancelled. ₹${refund.amount} will be refunded to your original payment method.`, updated, refund: { amount: refund.amount } },
          { headers: corsHeaders }
        );
      }
    } else {
      const claimed = await prisma.returnRequest.updateMany({
        where: { id: returnRequestId, status: 'pending_approval' },
        data: { status: 'cancelled' },
      });
      if (claimed.count === 0) {
        return NextResponse.json({ error: 'This return request was just processed and can no longer be cancelled.' }, { status: 409, headers: corsHeaders });
      }

      await prisma.$transaction([
        prisma.return.updateMany({
          where: { returnRequestId },
          data: { status: 'cancelled' },
        }),
        prisma.order.update({
          where: { id: orderId },
          data: { status: 'delivered' },
        }),
      ]);

      updated = await prisma.returnRequest.findUnique({ where: { id: returnRequestId } });
    }

    return NextResponse.json({ success: true, message: `${isExchange ? 'Exchange' : 'Return'} request cancelled`, updated }, { headers: corsHeaders });
  } catch (e: any) {
    console.error('[Cancel Return] Error:', e);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500, headers: corsHeaders });
  }
}
