import prisma from '@/lib/db';

/**
 * Reviews are stored under the product id of the order line they came from — our internal Product.id —
 * while product pages know the Shopify product id. Resolve both so reviews show on the product page.
 */
async function reviewProductIds(productId: string): Promise<string[]> {
  const ids = new Set<string>([productId]);
  try {
    const rows = await prisma.product.findMany({
      where: { OR: [{ shopifyProductId: productId }, { id: productId }] },
      select: { id: true, shopifyProductId: true },
    });
    for (const r of rows as Array<{ id: string; shopifyProductId: string }>) {
      ids.add(r.id);
      ids.add(r.shopifyProductId);
    }
  } catch (err) {
    console.error('[Reviews] product id resolution failed:', err);
  }
  return Array.from(ids);
}

/**
 * Compute the aggregate rating for a single product from VISIBLE reviews.
 * Returns { value, count } or undefined if no reviews exist.
 */
export async function getProductAggregateRating(
  productId: string
): Promise<{ value: number; count: number } | undefined> {
  try {
    const result = await prisma.productReview.aggregate({
      where: {
        productId: { in: await reviewProductIds(productId) },
        status: 'VISIBLE',
      },
      _avg: { rating: true },
      _count: { rating: true },
    });

    if (!result?._count?.rating || result._count.rating === 0) {
      return undefined;
    }

    return {
      value: Math.round((result._avg?.rating || 0) * 10) / 10, // one decimal
      count: result._count.rating,
    };
  } catch (err) {
    console.error('[Reviews] getProductAggregateRating error:', err);
    return undefined;
  }
}

/**
 * Fetch visible reviews for a product for on-page display.
 */
export async function getProductReviews(
  productId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<
  {
    id: string;
    rating: number;
    title: string | null;
    body: string;
    photos: string[];
    userId: string;
    verifiedPurchase: boolean;
    createdAt: Date;
  }[]
> {
  const { limit = 20, offset = 0 } = options;

  try {
    return await prisma.productReview.findMany({
      where: {
        productId: { in: await reviewProductIds(productId) },
        status: 'VISIBLE',
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        photos: true,
        userId: true,
        verifiedPurchase: true,
        createdAt: true,
      },
    });
  } catch (err) {
    console.error('[Reviews] getProductReviews error:', err);
    return [];
  }
}

/**
 * Compute the aggregate rating across ALL visible product reviews store-wide.
 * Used for Organization / ClothingStore JSON-LD.
 * Returns { value, count } or undefined if no reviews exist.
 */
export async function getStoreAggregateRating(): Promise<
  { value: number; count: number } | undefined
> {
  try {
    const result = await prisma.productReview.aggregate({
      where: {
        status: 'VISIBLE',
      },
      _avg: { rating: true },
      _count: { rating: true },
    });

    if (!result?._count?.rating || result._count.rating === 0) {
      return undefined;
    }

    return {
      value: Math.round((result._avg?.rating || 0) * 10) / 10,
      count: result._count.rating,
    };
  } catch (err) {
    console.error('[Reviews] getStoreAggregateRating error:', err);
    return undefined;
  }
}
