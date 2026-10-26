import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/db';
import { AFFILIATE_CONFIG } from '@/lib/affiliate/config';
import { recordLedgerDebit, recordLedgerRelease } from '@/lib/affiliate/ledger';
import { logAudit } from '@/lib/audit';
import { triggerAffiliateEvent } from '@/lib/affiliate/pusher';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // If RazorpayX is disabled, no-op cleanly
  if (!AFFILIATE_CONFIG.RAZORPAY_PAYOUTS_ENABLED) {
    return NextResponse.json({ success: true, message: 'RazorpayX payouts are disabled; event ignored' });
  }

  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');
    const webhookSecret = process.env.RAZORPAYX_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET;

    // Fail closed: require configured secret + valid signature (timing-safe)
    if (!webhookSecret) {
      console.error('[RazorpayX Webhook] RAZORPAYX_WEBHOOK_SECRET / RAZORPAY_WEBHOOK_SECRET not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (
      sigBuf.length !== expBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expBuf)
    ) {
      console.warn('[RazorpayX Webhook] Signature mismatch');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const payload = JSON.parse(rawBody);
    const event = payload.event;
    const payoutEntity = payload.payload?.payout?.entity;

    if (!payoutEntity) {
      return NextResponse.json({ success: true, message: 'No payout entity in payload' });
    }

    const payoutId = payoutEntity.id;
    const withdrawalId = payoutEntity.reference_id;

    const withdrawal = await prisma.affiliateWithdrawal.findFirst({
      where: {
        OR: [
          ...(withdrawalId ? [{ id: withdrawalId }] : []),
          { payoutRef: payoutId },
        ],
      },
    });

    if (!withdrawal) {
      console.warn(`[RazorpayX Webhook] No withdrawal found matching payoutId=${payoutId}, ref=${withdrawalId}`);
      return NextResponse.json({ success: true, message: 'Withdrawal not found' });
    }

    if (event === 'payout.processed') {
      if (withdrawal.status !== 'PAID') {
        await prisma.$transaction(async (tx: any) => {
          await tx.affiliateWithdrawal.update({
            where: { id: withdrawal.id },
            data: {
              status: 'PAID',
              paidAt: new Date(),
              payoutRef: payoutId,
            },
          });

          await recordLedgerDebit(
            {
              affiliateId: withdrawal.affiliateId,
              amount: withdrawal.amount,
              withdrawalId: withdrawal.id,
              reason: `RazorpayX payout settled (ID: ${payoutId})`,
            },
            tx
          );
        });

        await logAudit({
          action: 'RAZORPAYX_PAYOUT_PROCESSED',
          module: 'AFFILIATES',
          targetId: withdrawal.id,
          metadata: { payoutId, amount: withdrawal.amount },
        });

        triggerAffiliateEvent(withdrawal.affiliateId, 'withdrawal_update', {
          withdrawalId: withdrawal.id,
          status: 'PAID',
          amount: withdrawal.amount,
        }).catch(() => {});
      }
    } else if (event === 'payout.failed' || event === 'payout.reversed') {
      if (withdrawal.status !== 'FAILED' && withdrawal.status !== 'REJECTED') {
        const failureReason = payoutEntity.failure_reason || payoutEntity.status_details?.description || 'Payout failed';

        await prisma.$transaction(async (tx: any) => {
          await tx.affiliateWithdrawal.update({
            where: { id: withdrawal.id },
            data: {
              status: 'FAILED',
              rejectionReason: failureReason,
            },
          });

          // Release held funds back to creator
          await recordLedgerRelease(
            {
              affiliateId: withdrawal.affiliateId,
              amount: withdrawal.amount,
              withdrawalId: withdrawal.id,
              reason: `RazorpayX payout failed: ${failureReason}`,
            },
            tx
          );
        });

        await logAudit({
          action: 'RAZORPAYX_PAYOUT_FAILED',
          module: 'AFFILIATES',
          targetId: withdrawal.id,
          metadata: { payoutId, failureReason },
        });

        triggerAffiliateEvent(withdrawal.affiliateId, 'withdrawal_update', {
          withdrawalId: withdrawal.id,
          status: 'FAILED',
          amount: withdrawal.amount,
          reason: failureReason,
        }).catch(() => {});
      }
    }

    return NextResponse.json({ success: true, event });
  } catch (error: any) {
    console.error('[RazorpayX Webhook] Error processing event:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
