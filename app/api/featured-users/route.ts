import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { createCommunitySubmission, resolveSubmitter } from '@/lib/community-submissions';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const isTopFeatured = searchParams.get('isTopFeatured') === 'true';

  try {
    const where: any = { status: 'APPROVED' };
    if (isTopFeatured) {
      where.isTopFeatured = true;
    }
    const users = await prisma.featuredUser.findMany({
      where,
      include: {
        reviews: true,
      },
      orderBy: { createdAt: 'desc' },
      take: isTopFeatured ? 20 : undefined,
    });
    return NextResponse.json({ users }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (error: any) {
    console.error("[Featured Users GET] Direct Prisma query failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** Submissions from customers: same rules as /api/community/submit (this open route used to accept anything). */
export async function POST(req: Request) {
  try {
    const who = await resolveSubmitter(req);
    if (!who) return NextResponse.json({ error: 'Please log in to share your look.' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const result = await createCommunitySubmission(who, {
      imageUrl: body?.imageUrl,
      styleDescription: body?.styleDescription,
      instagramUrl: body?.instagramUrl,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, user: { id: result.id, status: result.status } });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500 });
  }
}
