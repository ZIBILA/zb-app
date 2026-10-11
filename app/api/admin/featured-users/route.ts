import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const users = await prisma.featuredUser.findMany({
      include: {
        reviews: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    
    // Disable caching explicitly for Vercel
    return NextResponse.json({ users }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name, email, imageUrl, styleDescription, instagramUrl, status = 'APPROVED' } = await req.json();

    if (!name || !email || !imageUrl) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const user = await prisma.featuredUser.create({
      data: {
        name,
        email,
        imageUrl,
        instagramUrl,
        styleDescription,
        status,
        isTopFeatured: false,
      },
    });

    return NextResponse.json({ success: true, user });
  } catch (error: any) {
    console.error('[Featured User API POST Error]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
    }

    await prisma.featuredUser.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Featured User API DELETE Error]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
