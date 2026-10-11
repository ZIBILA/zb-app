import prisma from '@/lib/db';

/**
 * Refunds the online "price difference" a customer paid when creating an exchange, back to the
 * original Razorpay payment. Used when an exchange is rejected by admin or cancelled by the customer.
 *
 * Guarantees:
 *  - Idempotent: the exchange is claimed (paymentStatus paid → refund_pending) before any money
 *    moves, and an existing Razorpay refund tagged with this exchange id is reused on retry.
 *  - On failure the claim is released (paymentStatus back to "paid") so the caller can retry.
 *  - Exchanges that were never paid online (COD / free / negative difference) are a no-op.
 */

const CLAIM_STALE_MS = 10 * 60 * 1000;

export type ExchangeRefundOutcome =
  | { ok: true; refunded: false; reason: 'not_paid' | 'already_refunded' }
  | { ok: true; refunded: true; amount: number; razorpayRefundId: string }
  | { ok: false; error: string; inProgress?: boolean };

export async function refundExchangePayment(
  exchangeRequestId: string,
  actor: string,
  reason: string
): Promise<ExchangeRefundOutcome> {
  const er = await prisma.exchangeRequest.findUnique({
    where: { id: exchangeRequestId },
    select: {
      id: true,
      orderId: true,
      customerId: true,
      paymentStatus: true,
      paymentId: true,
      priceDifference: true,
    },
  });

  if (!er) return { ok: false, error: 'Exchange request not found' };

  const status = String(er.paymentStatus || '').toLowerCase();
  if (status === 'refunded') return { ok: true, refunded: false, reason: 'already_refunded' };

  const amount = Math.round((er.priceDifference || 0) * 100) / 100;
  if (!(status === 'paid' || status === 'refund_pending') || !er.paymentId || !(amount > 0)) {
    return { ok: true, refunded: false, reason: 'not_paid' };
  }

  const paymentId = er.paymentId;

  // 1. Claim (a stale refund_pending claim from a crashed attempt may be retaken).
  const claim = await prisma.exchangeRequest.updateMany({
    where: {
      id: er.id,
      OR: [
        { paymentStatus: 'paid' },
        { paymentStatus: 'refund_pending', updatedAt: { lt: new Date(Date.now() - CLAIM_STALE_MS) } },
      ],
    },
    data: { paymentStatus: 'refund_pending' },
  });
  if (claim.count === 0) {
    return { ok: false, inProgress: true, error: 'A refund for this exchange is already being processed. Please retry in a few minutes.' };
  }

  const releaseClaim = async () => {
    await prisma.exchangeRequest
      .updateMany({ where: { id: er.id, paymentStatus: 'refund_pending' }, data: { paymentStatus: 'paid' } })
      .catch((e: any) => console.error('[ExchangeRefund] Failed to release claim:', e?.message));
  };

  // 2. Move the money.
  let razorpayRefundId: string;
  try {
    if (paymentId.startsWith('pay_mock_') || process.env.NODE_ENV === 'test') {
      razorpayRefundId = `mock_rf_${Date.now()}`;
    } else {
      const { resolveRazorpayCredentials } = await import('@/lib/razorpay-credentials');
      const Razorpay = (await import('razorpay')).default;
      const creds = await resolveRazorpayCredentials();
      const razorpay: any = new Razorpay({ key_id: creds.key_id, key_secret: creds.key_secret });

      // Reuse a refund created by an earlier (partially failed) attempt instead of refunding twice.
      const prior = await razorpay.payments.fetchMultipleRefund(paymentId, { count: 100 });
      const existing = (prior?.items || []).find(
        (r: any) => r?.notes?.exchangeRequestId === er.id && r?.status !== 'failed'
      );

      if (existing) {
        razorpayRefundId = existing.id;
      } else {
        const refund = await razorpay.payments.refund(paymentId, {
          amount: Math.round(amount * 100),
          notes: {
            exchangeRequestId: er.id,
            orderId: er.orderId,
            approvedBy: actor,
            reason,
          },
        });
        razorpayRefundId = refund.id;
      }
    }
  } catch (err: any) {
    await releaseClaim();
    const msg = err?.error?.description || err?.message || 'Razorpay refund failed';
    console.error('[ExchangeRefund] Razorpay refund failed:', err);
    return { ok: false, error: `Refund failed: ${msg}` };
  }

  // 3. Record it atomically.
  try {
    await prisma.$transaction(async (tx: any) => {
      const done = await tx.exchangeRequest.updateMany({
        where: { id: er.id, paymentStatus: 'refund_pending' },
        data: { paymentStatus: 'refunded' },
      });
      if (done.count !== 1) throw new Error('Refund claim was lost');

      await tx.exchange.updateMany({
        where: { exchangeRequestId: er.id },
        data: { paymentStatus: 'refunded' },
      });

      await tx.payment.create({
        data: {
          orderId: er.orderId,
          customerId: er.customerId,
          amount,
          type: 'refund',
          status: 'completed',
          gateway: 'razorpay',
        },
      });
    });
  } catch (err: any) {
    await releaseClaim();
    console.error('[ExchangeRefund] Could not record refund', razorpayRefundId, err);
    return {
      ok: false,
      error: `Refund ${razorpayRefundId} was issued at Razorpay but could not be saved. Retry — the existing refund will be reused, not repeated.`,
    };
  }

  console.log(`[ExchangeRefund] Refunded ₹${amount} (${razorpayRefundId}) for exchange ${er.id}`);
  return { ok: true, refunded: true, amount, razorpayRefundId };
}
