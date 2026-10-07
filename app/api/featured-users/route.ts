import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, email, imageUrl, styleDescription, instagramUrl } = body;

    const user = await prisma.featuredUser.create({
      data: {
        name,
        email,
        imageUrl,
        styleDescription,
        instagramUrl,
        status: 'PENDING',
      },
    });

    return NextResponse.json({ success: true, user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
