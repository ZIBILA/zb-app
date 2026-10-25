import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/db';
import { getAuthenticatedCustomer } from '../auth';
import { generateUniqueAffiliateCode, generateUniqueLinkSlug } from '@/lib/affiliate/code';
import { AFFILIATE_CONFIG } from '@/lib/affiliate/config';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const ApplySchema = z.object({
  displayName: z.string().trim().min(2, 'Display name must be at least 2 characters').max(50),
  email: z.string().trim().email('Please provide a valid email address'),
  socialHandle: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const customer = await getAuthenticatedCustomer(req);
  if (!customer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limiting (3 applications per 10 minutes per customer)
  const { allowed } = await rateLimit(`aff_apply_${customer.id}`, { maxRequests: 3, windowMs: 600_000 });
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  try {
    const rawBody = await req.json().catch(() => ({}));
    const parseResult = ApplySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json({ error: parseResult.error.issues[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const { displayName, email, notes } = parseResult.data;

    // Check if customer already has an affiliate profile
    const existing = await prisma.affiliate.findUnique({
      where: { customerId: customer.id },
    });

    if (existing) {
      return NextResponse.json(
        {
          error: 'An affiliate account or application already exists for this profile.',
          status: existing.status,
        },
        { status: 409 }
      );
    }

    // Next sequential affiliate code (ZB + 5 digits)
    const code = await generateUniqueAffiliateCode();

    // Create affiliate row with PENDING status
    const affiliate = await prisma.$transaction(async (tx: any) => {
      // Update customer email if provided or changed
      if (email && customer.email !== email) {
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            email,
            ...(displayName && !customer.name ? { name: displayName } : {}),
          },
        });
      }

      const newAffiliate = await tx.affiliate.create({
        data: {
          customerId: customer.id,
          code,
          displayName: displayName || customer.name || code,
          status: 'PENDING',
          commissionRate: AFFILIATE_CONFIG.DEFAULT_COMMISSION_RATE,
          notes: notes ? `${notes}\nEmail: ${email}` : `Email: ${email}`,
        },
      });

      // Pre-create the primary store link
      const baseSlug = await generateUniqueLinkSlug(code, 'STORE');
      await tx.affiliateLink.create({
        data: {
          affiliateId: newAffiliate.id,
          slug: baseSlug,
          label: 'My Storefront Link',
          targetType: 'STORE',
          destination: '/',
          isActive: true,
        },
      });

      return newAffiliate;
    });

    return NextResponse.json({
      success: true,
      message: 'Application submitted successfully. It is currently under review.',
      affiliate: {
        id: affiliate.id,
        code: affiliate.code,
        displayName: affiliate.displayName,
        status: affiliate.status,
        appliedAt: affiliate.appliedAt,
      },
    });
  } catch (error: any) {
    console.error('[Affiliate Apply] Error submitting application:', error);
    return NextResponse.json({ error: 'Failed to submit application. Please try again.' }, { status: 500 });
  }
}
