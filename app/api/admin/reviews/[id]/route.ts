import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/reviews/[id]
 * Approve (VISIBLE), reject / take down (HIDDEN), or send back to the queue (PENDING).
 * Body: { status: 'VISIBLE' | 'HIDDEN' | 'PENDING' }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = (await getServerSession(authOptions as any)) as any;
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const role = session.user.role;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { status, rating, title, body: reviewBody, verifiedPurchase } = body;

    const dataToUpdate: any = {};

    if (status) {
      if (!['VISIBLE', 'HIDDEN', 'PENDING'].includes(status)) {
        return NextResponse.json(
          { error: 'status must be VISIBLE, HIDDEN or PENDING' },
          { status: 400 }
        );
      }
      dataToUpdate.status = status;
    }

    if (rating !== undefined) {
      const ratingNum = Number(rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return NextResponse.json(
          { error: 'Rating must be an integer between 1 and 5' },
          { status: 400 }
        );
      }
      dataToUpdate.rating = Math.round(ratingNum);
    }

    if (title !== undefined) {
      dataToUpdate.title = title ? title.trim() : null;
    }

    if (reviewBody !== undefined) {
      if (typeof reviewBody !== 'string' || reviewBody.trim().length < 3) {
        return NextResponse.json(
          { error: 'Review body must be at least 3 characters long' },
          { status: 400 }
        );
      }
      dataToUpdate.body = reviewBody.trim();
    }

    if (verifiedPurchase !== undefined) {
      dataToUpdate.verifiedPurchase = Boolean(verifiedPurchase);
    }

    if (Object.keys(dataToUpdate).length === 0) {
      return NextResponse.json(
        { error: 'No valid update fields provided' },
        { status: 400 }
      );
    }

    const review = await prisma.productReview.update({
      where: { id: params.id },
      data: dataToUpdate,
    });

    return NextResponse.json({ success: true, review });
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return NextResponse.json(
        { error: 'Review not found' },
        { status: 404 }
      );
    }
    console.error('[PATCH /api/admin/reviews/[id]] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/reviews/[id]
 * Permanently delete a review.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = (await getServerSession(authOptions as any)) as any;
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const role = session.user.role;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.productReview.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return NextResponse.json(
        { error: 'Review not found' },
        { status: 404 }
      );
    }
    console.error('[DELETE /api/admin/reviews/[id]] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
