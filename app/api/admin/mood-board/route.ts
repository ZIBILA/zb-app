import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/admin/mood-board — list all mood boards or get one by productId
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get('productId');

    if (productId) {
      const moodBoard = await prisma.productMoodBoard.findUnique({
        where: { shopifyProductId: productId },
      });
      return NextResponse.json(moodBoard || { shopifyProductId: productId, images: '[]' });
    }

    // Return all mood boards
    const moodBoards = await prisma.productMoodBoard.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json(moodBoards);
  } catch (error: any) {
    console.error('Mood board GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/admin/mood-board — create or update mood board for a product
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { shopifyProductId, images } = body;

    if (!shopifyProductId) {
      return NextResponse.json({ error: 'shopifyProductId is required' }, { status: 400 });
    }

    // Validate images is an array with max 10 items
    let parsedImages: string[] = [];
    if (typeof images === 'string') {
      try {
        parsedImages = JSON.parse(images);
      } catch {
        parsedImages = [];
      }
    } else if (Array.isArray(images)) {
      parsedImages = images;
    }

    parsedImages = parsedImages
      .map((value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        try {
          const href = raw.startsWith('//') ? `https:${raw}` : raw;
          const url = new URL(href);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
          return url.href;
        } catch {
          return '';
        }
      })
      .filter(Boolean)
      .slice(0, 10);

    const moodBoard = await prisma.productMoodBoard.upsert({
      where: { shopifyProductId },
      update: {
        images: JSON.stringify(parsedImages),
      },
      create: {
        shopifyProductId,
        images: JSON.stringify(parsedImages),
      },
    });

    return NextResponse.json(moodBoard);
  } catch (error: any) {
    console.error('Mood board PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/admin/mood-board — delete mood board for a product
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get('productId');

    if (!productId) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 });
    }

    await prisma.productMoodBoard.delete({
      where: { shopifyProductId: productId },
    }).catch(() => null); // Silently handle if not found

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Mood board DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
