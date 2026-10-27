import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/affiliates/payout-accounts
 * Current (default) payout account of every affiliate — masked only. Full details are revealed
 * per affiliate via POST /api/admin/affiliates/[id]/reveal-bank (audit-logged).
 */
export async function GET() {
  try {
    await requireAdmin('AFFILIATES' as any, 'view');

    const accounts = await prisma.affiliatePayoutAccount.findMany({
      where: { isDefault: true },
      orderBy: { updatedAt: 'desc' },
      include: {
        affiliate: {
          select: {
            id: true,
            code: true,
            displayName: true,
            status: true,
            customer: { select: { name: true, email: true, phone: true } },
          },
        },
      },
    });

    return NextResponse.json({
      accounts: accounts.map((a: any) => ({
        id: a.id,
        method: a.method,
        accountHolderName: a.accountHolderName,
        bankName: a.bankName,
        last4: a.last4,
        isVerified: a.isVerified,
        updatedAt: a.updatedAt,
        affiliate: {
          id: a.affiliate.id,
          code: a.affiliate.code,
          status: a.affiliate.status,
          name: a.affiliate.displayName || a.affiliate.customer?.name || null,
          email: a.affiliate.customer?.email || null,
          phone: a.affiliate.customer?.phone || null,
        },
      })),
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
