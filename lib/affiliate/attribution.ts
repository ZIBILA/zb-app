import crypto from 'crypto';
import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';
import { AFFILIATE_CONFIG } from './config';
import { verifyAffiliateCookie } from './cookie';
import { round2 } from './ledger';
import { triggerAffiliateEvent } from './pusher';

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Hash IP address with a salt to ensure GDPR/privacy compliance
 */
function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.NEXTAUTH_SECRET || 'affiliate-ip-salt';
  return crypto.createHmac('sha256', salt).update(ip).digest('hex').slice(0, 32);
}

/**
 * Records an incoming click from an affiliate link or ref code.
 * Implements 30-minute deduplication by (anonymousId, affiliateId).
 */
export async function recordClick(params: {
  slugOrCode: string;
  req?: Request;
  anonymousId?: string;
  sessionId?: string;
  referrer?: string;
  landingUrl?: string;
}) {
  const { slugOrCode, req, referrer, landingUrl } = params;
  const cleanToken = slugOrCode.trim();

  // 1. Resolve active affiliate and link via indexed equality
  let link = await prisma.affiliateLink.findUnique({
    where: { slug: cleanToken },
    include: { affiliate: true },
  });

  let affiliate = link?.affiliate;

  if (!affiliate) {
    // If slug lookup failed, check if token matches an affiliate code directly
    affiliate = await prisma.affiliate.findUnique({
      where: { code: cleanToken.toUpperCase() },
    });
  }

  if (!affiliate || affiliate.status !== 'APPROVED') {
    return null;
  }

  // 2. Extract request metadata
  let userAgent = '';
  let ipHash: string | null = null;
  let countryCode: string | null = null;
  let city: string | null = null;
  let deviceType: string | null = null;

  if (req) {
    userAgent = req.headers.get('user-agent') || '';
    const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
                  req.headers.get('x-real-ip') ||
                  null;
    ipHash = hashIp(rawIp);
    countryCode = req.headers.get('cf-ipcountry') || req.headers.get('x-vercel-ip-country') || null;
    city = req.headers.get('x-vercel-ip-city') || null;

    if (/mobile/i.test(userAgent)) deviceType = 'MOBILE';
    else if (/tablet/i.test(userAgent)) deviceType = 'TABLET';
    else deviceType = 'DESKTOP';
  }

  // Generate anonymousId for deduplication if not provided
  const anonymousId = params.anonymousId || (ipHash ? `anon_${ipHash.slice(0, 16)}` : `anon_${Date.now()}`);

  // 3. Deduplication check: Has this anonymousId clicked this affiliate's link in the last 30 minutes?
  const windowAgo = new Date(Date.now() - AFFILIATE_CONFIG.CLICK_DEDUP_MINUTES * 60 * 1000);
  const recentClick = await prisma.affiliateClick.findFirst({
    where: {
      affiliateId: affiliate.id,
      anonymousId,
      createdAt: { gte: windowAgo },
    },
    select: { id: true },
  });

  if (recentClick) {
    // Deduplicated: return existing clickId without inflating counters
    return {
      clickId: recentClick.id,
      affiliateId: affiliate.id,
      code: affiliate.code,
      linkSlug: link?.slug || null,
      linkId: link?.id || null,
      deduplicated: true,
    };
  }

  // 4. Insert click and increment counters in an atomic transaction
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const click = await tx.affiliateClick.create({
      data: {
        affiliateId: affiliate!.id,
        linkId: link?.id || null,
        anonymousId,
        sessionId: params.sessionId || null,
        ipHash,
        userAgent: userAgent.slice(0, 255) || null,
        referrer: (referrer || (req?.headers.get('referer') || '')).slice(0, 500) || null,
        landingUrl: landingUrl?.slice(0, 500) || null,
        countryCode,
        city,
        deviceType,
      },
    });

    await tx.affiliate.update({
      where: { id: affiliate!.id },
      data: { totalClicks: { increment: 1 } },
    });

    if (link) {
      await tx.affiliateLink.update({
        where: { id: link.id },
        data: { clicks: { increment: 1 } },
      });
    }

    return click;
  });

  // Trigger real-time Pusher notification (non-blocking)
  triggerAffiliateEvent(affiliate.id, 'click', {
    clickId: result.id,
    linkSlug: link?.slug,
    deviceType,
    countryCode,
  }).catch(() => {});

  return {
    clickId: result.id,
    affiliateId: affiliate.id,
    code: affiliate.code,
    linkSlug: link?.slug || null,
    linkId: link?.id || null,
    deduplicated: false,
  };
}

/**
 * Attributes a completed order to an approved creator.
 *
 * Rules:
 * - Reads signed zb_aff cookie
 * - Self-referral strictly BLOCKED (affiliate.customerId !== order.customerId)
 * - OrderId is unique (one order credits at most one affiliate)
 * - Commission eligible amount = subtotalPrice - discountAmount (excludes shipping/tax)
 * - Sets status = PENDING with holdUntil = now + HOLD_DAYS
 * - Isolated: an error here NEVER rolls back or fails the customer's checkout!
 */
export async function attributeOrder(params: {
  orderId: string;
  req?: Request;
  cookieVal?: string | null;
  client?: DbClient;
}): Promise<{ attributed: boolean; referralId?: string; error?: string }> {
  const { orderId, req, cookieVal, client = prisma } = params;

  try {
    // 1. Resolve cookie value
    let rawCookie = cookieVal;
    if (!rawCookie && req) {
      const cookieHeader = req.headers.get('cookie') || '';
      const match = cookieHeader.match(new RegExp(`(?:^|; )${AFFILIATE_CONFIG.COOKIE_NAME}=([^;]*)`));
      if (match) rawCookie = decodeURIComponent(match[1]);
    }

    if (!rawCookie) {
      return { attributed: false, error: 'No attribution cookie' };
    }

    const payload = await verifyAffiliateCookie(rawCookie);
    if (!payload || !payload.code) {
      return { attributed: false, error: 'Invalid or expired attribution cookie' };
    }

    // 2. Fetch order details
    const order = await client.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerId: true,
        totalPrice: true,
        subtotalPrice: true,
        discountAmount: true,
        currency: true,
        affiliateReferral: { select: { id: true } },
      },
    });

    if (!order) {
      return { attributed: false, error: 'Order not found' };
    }

    // Idempotency: order already referred
    if (order.affiliateReferral) {
      return { attributed: false, error: 'Order already attributed' };
    }

    // 3. Resolve affiliate
    const affiliate = await client.affiliate.findUnique({
      where: { code: payload.code.toUpperCase() },
      select: {
        id: true,
        customerId: true,
        code: true,
        status: true,
        commissionRate: true,
      },
    });

    if (!affiliate || affiliate.status !== 'APPROVED') {
      return { attributed: false, error: 'Affiliate not found or not approved' };
    }

    // 4. Guard against self-referral
    if (affiliate.customerId === order.customerId) {
      console.warn(`[Affiliate Attribution] Blocked self-referral for order ${orderId} by customer ${order.customerId}`);
      return { attributed: false, error: 'Self-referral blocked' };
    }

    // 5. Calculate net eligible amount & commission
    // Formula: eligibleAmount = subtotalPrice - discountAmount (min 0)
    const baseAmount = order.subtotalPrice != null ? order.subtotalPrice : order.totalPrice;
    const discount = order.discountAmount || 0;
    const eligibleAmount = Math.max(0, round2(baseAmount - discount));
    const commissionRate = affiliate.commissionRate;
    const commissionAmount = round2(eligibleAmount * commissionRate);

    const holdUntil = new Date(Date.now() + AFFILIATE_CONFIG.HOLD_DAYS * 24 * 60 * 60 * 1000);

    // 6. Execute atomic update
    const run = async (tx: Prisma.TransactionClient) => {
      // Re-check order referral inside transaction for race conditions
      const existingRef = await tx.affiliateReferral.findUnique({
        where: { orderId: order.id },
      });
      if (existingRef) {
        return { attributed: false, referralId: existingRef.id };
      }

      const referral = await tx.affiliateReferral.create({
        data: {
          affiliateId: affiliate.id,
          linkId: payload.linkId || null,
          orderId: order.id,
          customerId: order.customerId,
          clickId: payload.clickId || null,
          orderTotal: round2(order.totalPrice),
          eligibleAmount,
          commissionRate,
          commissionAmount,
          status: 'PENDING',
          holdUntil,
        },
      });

      // Increment cached counters on affiliate
      await tx.affiliate.update({
        where: { id: affiliate.id },
        data: {
          totalConversions: { increment: 1 },
          totalRevenue: { increment: eligibleAmount },
          pendingEarnings: { increment: commissionAmount },
        },
      });

      // Increment cached counters on link if applicable
      if (payload.linkId) {
        await tx.affiliateLink.update({
          where: { id: payload.linkId },
          data: {
            conversions: { increment: 1 },
            revenue: { increment: eligibleAmount },
          },
        }).catch(() => {});
      }

      return { attributed: true, referralId: referral.id };
    };

    let result;
    if ('$transaction' in client) {
      result = await (client as typeof prisma).$transaction(run);
    } else {
      result = await run(client);
    }

    console.log(`[Affiliate Attribution] Attributed order ${orderId} to creator ${affiliate.code} (commission: ₹${commissionAmount})`);

    // Push real-time event to creator
    triggerAffiliateEvent(affiliate.id, 'conversion', {
      orderId,
      orderTotal: order.totalPrice,
      commissionAmount,
      status: 'PENDING',
    }).catch(() => {});

    return result;
  } catch (error: any) {
    // Failure-isolated: never let attribution break order flow
    console.error(`[Affiliate Attribution] Non-fatal error attributing order ${orderId}:`, error.message);
    return { attributed: false, error: error.message };
  }
}
