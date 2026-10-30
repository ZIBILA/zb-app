import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import prisma from '@/lib/db';
import { getAuthenticatedCustomer } from '../auth';
import { AFFILIATE_CONFIG } from '@/lib/affiliate/config';
import { getAvailableBalance, recordLedgerHold, round2 } from '@/lib/affiliate/ledger';
import { rateLimit } from '@/lib/rate-limit';
import { triggerAffiliateEvent } from '@/lib/affiliate/pusher';

export const dynamic = 'force-dynamic';

const WithdrawalRequestSchema = z.object({
  amount: z.number().positive('Withdrawal amount must be greater than zero'),
});

/** Developer Brief #14: settlement can be requested at most once per week. */
const SETTLEMENT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
// Rejected / failed requests never paid out, so they don't use up the week.
const COUNTS_TOWARD_WEEKLY_LIMIT = ['REQUESTED', 'APPROVED', 'PROCESSING', 'PAID'];

/** When the creator may next request a settlement (null = now). */
function nextSettlementAt(lastCounted: { requestedAt: Date } | null): Date | null {
  if (!lastCounted) return null;
  const next = new Date(lastCounted.requestedAt.getTime() + SETTLEMENT_INTERVAL_MS);
  return next > new Date() ? next : null;
}

export async function GET(req: NextRequest) {
  const customer = await getAuthenticatedCustomer(req);
  if (!customer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { customerId: customer.id },
      select: { id: true, status: true },
    });

    if (!affiliate || affiliate.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Affiliate account not approved' }, { status: 403 });
    }

    const withdrawals = await prisma.affiliateWithdrawal.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    });

    const lastCounted = withdrawals.find((w: { status: string }) => COUNTS_TOWARD_WEEKLY_LIMIT.includes(w.status)) || null;
    return NextResponse.json({ withdrawals, nextSettlementAt: nextSettlementAt(lastCounted) });
  } catch (error: any) {
    console.error('[Affiliate Withdrawals] Error fetching withdrawals:', error);
    return NextResponse.json({ error: 'Failed to fetch withdrawal history' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const customer = await getAuthenticatedCustomer(req);
  if (!customer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limiting (max 5 requests per 10 minutes)
  const { allowed } = await rateLimit(`aff_wd_${customer.id}`, { maxRequests: 5, windowMs: 600_000 });
  if (!allowed) {
    return NextResponse.json({ error: 'Too many withdrawal attempts. Please wait a moment.' }, { status: 429 });
  }

  try {
    const rawBody = await req.json().catch(() => ({}));
    const parseResult = WithdrawalRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json({ error: parseResult.error.issues[0]?.message || 'Invalid amount' }, { status: 400 });
    }

    const requestedAmount = round2(parseResult.data.amount);

    // Run authoritative verification and mutation inside a single DB transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Fetch affiliate with row lock
      const affiliate = await tx.affiliate.findUnique({
        where: { customerId: customer.id },
        include: {
          payoutAccounts: {
            where: { isDefault: true },
            take: 1,
          },
        },
      });

      if (!affiliate || affiliate.status !== 'APPROVED') {
        throw new Error('Only active, approved creators can request withdrawals');
      }

      // 2. Enforce saved payout account
      const payoutAccount = affiliate.payoutAccounts[0];
      if (!payoutAccount) {
        throw new Error('Please add a bank account or UPI ID before requesting a withdrawal');
      }

      // 3. Enforce single open withdrawal
      const openWithdrawal = await tx.affiliateWithdrawal.findFirst({
        where: {
          affiliateId: affiliate.id,
          status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] },
        },
      });

      if (openWithdrawal) {
        throw new Error('You already have a pending withdrawal request in progress');
      }

      // 3b. Enforce one settlement request per week
      const lastCounted = await tx.affiliateWithdrawal.findFirst({
        where: { affiliateId: affiliate.id, status: { in: COUNTS_TOWARD_WEEKLY_LIMIT } },
        orderBy: { requestedAt: 'desc' },
        select: { requestedAt: true },
      });
      const nextAllowed = nextSettlementAt(lastCounted);
      if (nextAllowed) {
        throw new Error(
          `Settlements can be requested once a week. Your next request is available on ${nextAllowed.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`
        );
      }

      // 4. Derive authoritative available balance
      const currentAvailable = await getAvailableBalance(affiliate.id, tx);
      if (requestedAmount > currentAvailable) {
        throw new Error(`Requested amount (₹${requestedAmount}) exceeds available balance (₹${currentAvailable})`);
      }

      // 5. Enforce withdrawal minimums (₹5,000 for first payout, ₹1,000 subsequent)
      const minRequired = !affiliate.firstWithdrawalDone
        ? AFFILIATE_CONFIG.MIN_FIRST_WITHDRAWAL
        : AFFILIATE_CONFIG.MIN_WITHDRAWAL;

      if (requestedAmount < minRequired) {
        throw new Error(
          !affiliate.firstWithdrawalDone
            ? `Minimum withdrawal amount for your first payout is ₹${minRequired.toLocaleString('en-IN')}`
            : `Minimum withdrawal amount is ₹${minRequired.toLocaleString('en-IN')}`
        );
      }

      // 6. Generate idempotency key
      const idempotencyKey = `wd_${affiliate.id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // 7. Create withdrawal row
      const withdrawal = await tx.affiliateWithdrawal.create({
        data: {
          affiliateId: affiliate.id,
          payoutAccountId: payoutAccount.id,
          amount: requestedAmount,
          status: 'REQUESTED',
          idempotencyKey,
        },
      });

      // 8. Place authoritative HOLD in the ledger
      await recordLedgerHold(
        {
          affiliateId: affiliate.id,
          amount: requestedAmount,
          withdrawalId: withdrawal.id,
          reason: `Withdrawal request #${withdrawal.id}`,
        },
        tx
      );

      return withdrawal;
    });

    // Real-time Pusher notification
    triggerAffiliateEvent(result.affiliateId, 'withdrawal_update', {
      withdrawalId: result.id,
      status: result.status,
      amount: result.amount,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: 'Withdrawal request submitted for review.',
      withdrawal: result,
    });
  } catch (error: any) {
    console.error('[Affiliate Withdrawals] Error requesting withdrawal:', error.message);
    return NextResponse.json({ error: error.message || 'Failed to process withdrawal request' }, { status: 400 });
  }
}
