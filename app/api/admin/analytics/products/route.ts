/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdminApiGuard } from '@/lib/auth/admin-api-guard';
import { cachedAnalytics } from '@/lib/analytics-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// Valid platform values for allow-list validation (FIX 7)
const VALID_PLATFORMS = ['web', 'app'] as const;

async function handler(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const rawPlatform = searchParams.get('platform');

    // Validate platform against allow-list (FIX 7)
    const platform = rawPlatform && (VALID_PLATFORMS as readonly string[]).includes(rawPlatform) ? rawPlatform : null;
    const platformFilter = platform ? { platform } : {};

    const now = new Date();
    const startDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    let rawEnd = to ? new Date(to) : now;
    if (to && to.length === 10) {
      rawEnd.setHours(23, 59, 59, 999);
    }
    const endDate = rawEnd > now ? now : rawEnd;
    const dateFilter = { gte: startDate, lte: endDate };

    const data = await cachedAnalytics(
      ['products', startDate.toISOString(), endDate.toISOString(), platform || 'all'],
      async () => {

  // Execute all 3 groupBys with fast, indexed raw SQL queries with LIMIT 20
  const platformCondition = platform ? `AND platform = $3` : '';
  const queryArgs: any[] = platform ? [startDate, endDate, platform] : [startDate, endDate];

  const [rawViewed, rawAdded, rawPurchased]: [any[], any[], any[]] = await Promise.all([
    prisma.$queryRawUnsafe(`
      SELECT product_id AS "productId", COUNT(*) AS count
      FROM analytics_events
      WHERE event_name = 'view_item'
        AND created_at >= $1 AND created_at <= $2
        AND product_id IS NOT NULL
        ${platformCondition}
      GROUP BY product_id
      ORDER BY count DESC
      LIMIT 20
    `, ...queryArgs),
    prisma.$queryRawUnsafe(`
      SELECT product_id AS "productId", COUNT(*) AS count
      FROM analytics_events
      WHERE event_name = 'add_to_cart'
        AND created_at >= $1 AND created_at <= $2
        AND product_id IS NOT NULL
        ${platformCondition}
      GROUP BY product_id
      ORDER BY count DESC
      LIMIT 20
    `, ...queryArgs),
    prisma.$queryRawUnsafe(`
      SELECT product_id AS "productId", COUNT(*) AS count, COALESCE(SUM(value), 0) AS revenue
      FROM analytics_events
      WHERE event_name = 'purchase'
        AND created_at >= $1 AND created_at <= $2
        AND product_id IS NOT NULL
        ${platformCondition}
      GROUP BY product_id
      ORDER BY count DESC
      LIMIT 20
    `, ...queryArgs),
  ]);

  // Collect all unique product IDs to resolve titles
  const allProductIds = new Set<string>();
  [...rawViewed, ...rawAdded, ...rawPurchased].forEach((r: any) => {
    if (r.productId) allProductIds.add(String(r.productId));
  });

  // Resolve product details from DB
  const productDetails = new Map<string, { title: string; image: string | null; handle: string | null }>();
  if (allProductIds.size > 0) {
    const productIdsArr = Array.from(allProductIds);
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { shopifyProductId: { in: productIdsArr } },
          { id: { in: productIdsArr } },
        ],
      },
      select: { id: true, shopifyProductId: true, title: true, featuredImage: true, handle: true },
    });
    for (const p of products) {
      const info = { title: p.title, image: p.featuredImage, handle: p.handle };
      if (p.shopifyProductId) productDetails.set(p.shopifyProductId, info);
      if (p.id) productDetails.set(p.id, info);
    }
  }

  const enrich = (items: any[], includeRevenue = false) =>
    items.map(item => ({
      productId: String(item.productId),
      title: productDetails.get(String(item.productId))?.title || 'Product ' + String(item.productId).slice(-6),
      image: productDetails.get(String(item.productId))?.image || null,
      handle: productDetails.get(String(item.productId))?.handle || null,
      count: Number(item.count || 0),
      ...(includeRevenue ? { revenue: Math.round(Number(item.revenue || 0) * 100) / 100 } : {}),
    }));

  // Calculate view-to-cart and cart-to-purchase rates per product
  const viewMap = new Map<string, number>(rawViewed.map((v: any) => [String(v.productId), Number(v.count || 0)]));
  const cartMap = new Map<string, number>(rawAdded.map((v: any) => [String(v.productId), Number(v.count || 0)]));
  const purchaseMap = new Map<string, number>(rawPurchased.map((v: any) => [String(v.productId), Number(v.count || 0)]));

  const productRates = Array.from(allProductIds).map((pid: string) => {
    const views = viewMap.get(pid) || 0;
    const carts = cartMap.get(pid) || 0;
    const purchases = purchaseMap.get(pid) || 0;
    return {
      productId: pid,
      title: productDetails.get(pid)?.title || 'Product ' + pid.slice(-6),
      views,
      addToCarts: carts,
      purchases,
      viewToCartRate: views > 0 ? Math.round((carts / views) * 100 * 10) / 10 : 0,
      cartToPurchaseRate: carts > 0 ? Math.round((purchases / carts) * 100 * 10) / 10 : 0,
    };
  }).sort((a, b) => b.views - a.views).slice(0, 20);

    const responseData = {
      mostViewed: enrich(rawViewed),
      mostAddedToCart: enrich(rawAdded),
      bestSelling: enrich(rawPurchased, true),
      productRates,
    };
    return responseData;
      },
      30
    );

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[Analytics Products] Error:', error.message);
    return NextResponse.json({
      mostViewed: [],
      mostAddedToCart: [],
      bestSelling: [],
      productRates: [],
      error: error.message
    });
  }
}

export const GET = withAdminApiGuard(handler, { module: 'ANALYTICS', action: 'view' });
