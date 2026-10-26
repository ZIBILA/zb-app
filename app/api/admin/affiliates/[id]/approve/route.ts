import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';
import { logAudit } from '@/lib/audit';
import { generateUniqueAffiliateCode, generateUniqueLinkSlug } from '@/lib/affiliate/code';
import { triggerAffiliateEvent } from '@/lib/affiliate/pusher';

export const dynamic = 'force-dynamic';

// Commission is entered by the admin for each affiliate at approval (fraction: 12.5% = 0.125).
const ApproveSchema = z.object({
  commissionRate: z
    .number({ error: 'Commission rate is required (a number, e.g. 0.12 for 12%)' })
    .gt(0, 'Commission rate must be greater than 0%')
    .max(1, 'Commission rate cannot exceed 100%'),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireAdmin('AFFILIATES' as any, 'edit');
    const { id } = params;
    const adminUserId = (session.user as any)?.id;

    const rawBody = await req.json().catch(() => ({}));
    const parseResult = ApproveSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message || 'Invalid commission rate' },
        { status: 400 }
      );
    }
    const commissionRate = Math.round(parseResult.data.commissionRate * 10000) / 10000;

    const affiliate = await prisma.affiliate.findUnique({
      where: { id },
      include: { customer: true, links: true },
    });

    if (!affiliate) {
      return NextResponse.json({ error: 'Affiliate record not found' }, { status: 404 });
    }

    // Ensure code exists
    let code = affiliate.code;
    if (!code) {
      code = await generateUniqueAffiliateCode();
    }

    const updated = await prisma.$transaction(async (tx: any) => {
      const app = await tx.affiliate.update({
        where: { id },
        data: {
          code,
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedByUserId: adminUserId || null,
          rejectedReason: null,
          commissionRate,
        },
      });

      // Ensure base store link exists
      if (affiliate.links.length === 0) {
        const slug = await generateUniqueLinkSlug(code, 'STORE');
        await tx.affiliateLink.create({
          data: {
            affiliateId: id,
            slug,
            label: 'Main Store Link',
            targetType: 'STORE',
            destination: '/',
            isActive: true,
          },
        });
      }

      return app;
    });

    // Audit log
    await logAudit({
      action: 'AFFILIATE_APPROVE',
      module: 'AFFILIATES',
      targetId: id,
      metadata: {
        adminUserId,
        code: updated.code,
        commissionRate: updated.commissionRate,
      },
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    // Trigger Pusher notification to creator
    triggerAffiliateEvent(id, 'withdrawal_update', {
      status: 'APPROVED',
      message: 'Your affiliate application has been approved!',
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: 'Affiliate application approved successfully.',
      affiliate: updated,
    });
  } catch (error: any) {
    return handleAuthError(error);
  }
}
