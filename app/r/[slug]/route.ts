import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { recordClick } from '@/lib/affiliate/attribution';
import { signAffiliateCookie, getAffiliateCookieOptions } from '@/lib/affiliate/cookie';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const host = req.headers.get('host') || 'zicabella.com';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const fallbackUrl = new URL('/', `${proto}://${host}`).toString();

  try {
    const rawSlug = params?.slug;
    if (!rawSlug || typeof rawSlug !== 'string') {
      return NextResponse.redirect(fallbackUrl, 302);
    }

    const cleanSlug = rawSlug.trim();

    // 1. IP Rate Limiting (60 requests per minute per IP to prevent spam)
    const ip =
      req.headers.get('do-connecting-ip') ||
      req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '127.0.0.1';

    const { allowed } = await rateLimit(`aff_click_${ip}`, { maxRequests: 60, windowMs: 60_000 });
    if (!allowed) {
      return NextResponse.redirect(fallbackUrl, 302);
    }

    // 2. Resolve link via indexed equality
    const link = await prisma.affiliateLink.findUnique({
      where: { slug: cleanSlug },
      include: {
        affiliate: {
          select: {
            id: true,
            code: true,
            status: true,
          },
        },
      },
    });

    if (!link || !link.isActive || !link.affiliate || link.affiliate.status !== 'APPROVED') {
      // If not an exact link, check if it's a direct affiliate code (/r/ZB12345)
      const directAffiliate = await prisma.affiliate.findUnique({
        where: { code: cleanSlug.toUpperCase() },
        select: { id: true, code: true, status: true },
      });

      if (!directAffiliate || directAffiliate.status !== 'APPROVED') {
        return NextResponse.redirect(fallbackUrl, 302);
      }

      // Record click for direct affiliate code
      const clickResult = await recordClick({
        slugOrCode: directAffiliate.code,
        req,
      });

      const token = await signAffiliateCookie({
        code: directAffiliate.code,
        linkSlug: null,
        linkId: null,
        clickId: clickResult?.clickId || null,
        ts: Date.now(),
      });

      const cookieOpts = getAffiliateCookieOptions();
      const response = NextResponse.redirect(fallbackUrl, 302);
      response.cookies.set(cookieOpts.name, token, cookieOpts);
      return response;
    }

    // 3. Record click in database (with 30-min dedup)
    const clickResult = await recordClick({
      slugOrCode: link.slug,
      req,
    });

    // 4. Sign attribution cookie
    const token = await signAffiliateCookie({
      code: link.affiliate.code,
      linkSlug: link.slug,
      linkId: link.id,
      clickId: clickResult?.clickId || null,
      ts: Date.now(),
    });

    // 5. Build destination URL
    let targetUrl = link.destination || '/';
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = new URL(targetUrl.startsWith('/') ? targetUrl : `/${targetUrl}`, `${proto}://${host}`).toString();
    }

    const response = NextResponse.redirect(targetUrl, 302);
    const cookieOpts = getAffiliateCookieOptions();
    response.cookies.set(cookieOpts.name, token, cookieOpts);

    return response;
  } catch (error: any) {
    console.error(`[Affiliate Short-link] Error resolving /r/${params?.slug}:`, error.message);
    return NextResponse.redirect(fallbackUrl, 302);
  }
}
