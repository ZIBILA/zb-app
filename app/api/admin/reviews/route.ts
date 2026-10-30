import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/reviews
 * Fetch paginated product reviews with filters, product metadata, user metadata, and aggregate stats.
 */
export async function GET(request: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as any;
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const role = session.user.role;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'ALL'; // ALL | PENDING | VISIBLE | HIDDEN
    const ratingStr = searchParams.get('rating') || 'ALL';
    const search = searchParams.get('search')?.trim() || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const sort = searchParams.get('sort') || 'newest'; // newest | oldest | rating_desc | rating_asc

    // Build where clause
    const where: any = {};

    if (status !== 'ALL') {
      where.status = status;
    }

    if (ratingStr !== 'ALL') {
      const ratingNum = parseInt(ratingStr);
      if (!isNaN(ratingNum)) {
        where.rating = ratingNum;
      }
    }

    if (search) {
      // Find product IDs matching search title or handle
      const matchingProducts = await prisma.product.findMany({
        where: {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { handle: { contains: search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      const matchingProductIds = matchingProducts.map((p: any) => p.id);

      // Find customer/user IDs matching search name or email
      const [matchingCustomers, matchingUsers] = await Promise.all([
        prisma.customer.findMany({
          where: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        }),
        prisma.user.findMany({
          where: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        }),
      ]);
      const matchingUserIds = Array.from(
        new Set([
          ...matchingCustomers.map((c: any) => c.id),
          ...matchingUsers.map((u: any) => u.id),
        ])
      );

      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
        { orderId: { contains: search, mode: 'insensitive' } },
        { productId: { contains: search, mode: 'insensitive' } },
        ...(matchingProductIds.length > 0 ? [{ productId: { in: matchingProductIds } }] : []),
        ...(matchingUserIds.length > 0 ? [{ userId: { in: matchingUserIds } }] : []),
      ];
    }

    // Build orderBy
    let orderBy: any = { createdAt: 'desc' };
    if (sort === 'oldest') orderBy = { createdAt: 'asc' };
    else if (sort === 'rating_desc') orderBy = { rating: 'desc' };
    else if (sort === 'rating_asc') orderBy = { rating: 'asc' };

    const offset = (page - 1) * limit;

    // Execute queries in parallel
    const [reviews, totalCount, totalAll, visibleCount, hiddenCount, avgRatingResult, fiveStarCount, pendingCount] = await Promise.all([
      prisma.productReview.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
      }),
      prisma.productReview.count({ where }),
      prisma.productReview.count(),
      prisma.productReview.count({ where: { status: 'VISIBLE' } }),
      prisma.productReview.count({ where: { status: 'HIDDEN' } }),
      prisma.productReview.aggregate({
        _avg: { rating: true },
        where: { status: 'VISIBLE' },
      }),
      prisma.productReview.count({ where: { rating: 5 } }),
      prisma.productReview.count({ where: { status: 'PENDING' } }),
    ]);

    // Gather product and user IDs for enrichment
    const productIds = Array.from(new Set(reviews.map((r: any) => r.productId)));
    const userIds = Array.from(new Set(reviews.map((r: any) => r.userId)));

    type ProductDetail = { id: string; title: string; featuredImage: string | null; price: number | null; handle: string | null };
    type UserDetail = { id: string; name: string | null; email: string | null };

    const [products, customers, staffUsers] = await Promise.all([
      productIds.length > 0
        ? prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, title: true, featuredImage: true, price: true, handle: true },
          })
        : [],
      userIds.length > 0
        ? prisma.customer.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : [],
      userIds.length > 0
        ? prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : [],
    ]);

    const productMap = new Map<string, ProductDetail>(products.map((p: ProductDetail) => [p.id, p]));
    const userMap = new Map<string, UserDetail>();
    customers.forEach((c: UserDetail) => userMap.set(c.id, c));
    staffUsers.forEach((u: UserDetail) => {
      if (!userMap.has(u.id)) userMap.set(u.id, u);
    });

    const enrichedReviews = reviews.map((rev: any) => {
      const prod = productMap.get(rev.productId);
      const user = userMap.get(rev.userId);

      return {
        ...rev,
        product: prod
          ? {
              id: prod.id,
              title: prod.title,
              slug: prod.handle || prod.id,
              price: prod.price || 0,
              image: prod.featuredImage || null,
            }
          : null,
        user: user
          ? {
              id: user.id,
              name: user.name || 'Customer',
              email: user.email || '',
            }
          : null,
      };
    });

    const totalPages = Math.ceil(totalCount / limit);
    const avgRating = avgRatingResult._avg.rating
      ? Math.round(avgRatingResult._avg.rating * 10) / 10
      : 0;
    const fiveStarRatio = totalAll > 0 ? Math.round((fiveStarCount / totalAll) * 100) : 0;

    return NextResponse.json({
      success: true,
      reviews: enrichedReviews,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
      },
      stats: {
        totalReviews: totalAll,
        visibleCount,
        hiddenCount,
        pendingCount,
        avgRating,
        fiveStarRatio,
      },
    });
  } catch (err: any) {
    console.error('[GET /api/admin/reviews] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/reviews
 * Admin endpoint to manually create/add a product review.
 */
export async function POST(request: NextRequest) {
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
    const {
      productId,
      rating,
      title,
      body: reviewBody,
      reviewerName,
      reviewerEmail,
      verifiedPurchase = true,
      status = 'VISIBLE',
      orderId,
    } = body;

    if (!productId || !rating || !reviewBody) {
      return NextResponse.json(
        { error: 'Missing required fields: productId, rating, body' },
        { status: 400 }
      );
    }

    const ratingNum = Number(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return NextResponse.json(
        { error: 'Rating must be an integer between 1 and 5' },
        { status: 400 }
      );
    }

    // Verify product exists
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true },
    });

    if (!product) {
      return NextResponse.json(
        { error: 'Specified product does not exist' },
        { status: 404 }
      );
    }

    // Identify or resolve user
    let userId = session.user.id;
    if (reviewerEmail) {
      const cleanEmail = reviewerEmail.toLowerCase().trim();
      const existingCustomer = await prisma.customer.findFirst({
        where: { email: { equals: cleanEmail, mode: 'insensitive' } },
        select: { id: true },
      });

      if (existingCustomer) {
        userId = existingCustomer.id;
      } else {
        const existingUser = await prisma.user.findUnique({
          where: { email: cleanEmail },
          select: { id: true },
        });

        if (existingUser) {
          userId = existingUser.id;
        } else {
          // Create customer record if reviewer details provided
          const newCust = await prisma.customer.create({
            data: {
              shopId: (await prisma.shop.findFirst({ select: { id: true } }))?.id || 'default',
              shopifyId: `manual_cust_${Date.now()}`,
              email: cleanEmail,
              name: reviewerName?.trim() || 'Verified Customer',
            },
            select: { id: true },
          });
          userId = newCust.id;
        }
      }
    }

    const review = await prisma.productReview.create({
      data: {
        productId,
        orderId: orderId || `MANUAL-${Date.now()}`,
        userId,
        rating: Math.round(ratingNum),
        title: title?.trim() || null,
        body: reviewBody.trim(),
        verifiedPurchase: Boolean(verifiedPurchase),
        status: status === 'HIDDEN' ? 'HIDDEN' : 'VISIBLE',
      },
    });

    return NextResponse.json({ success: true, review }, { status: 201 });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json(
        { error: 'A review by this user already exists for this product' },
        { status: 409 }
      );
    }
    console.error('[POST /api/admin/reviews] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
