/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdminApiGuard } from '@/lib/auth/admin-api-guard';
import { cachedAnalytics } from '@/lib/analytics-cache';
import { convertedCartWhere, abandonedCartWhere } from '@/lib/cartConversion';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// Valid platform values for allow-list validation
const VALID_PLATFORMS = ['web', 'app'] as const;

// ─── Inline pLimit: cap concurrent DB queries per route ────────
function pLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => { if (queue.length > 0 && active < concurrency) { active++; queue.shift()!(); } };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => fn().then(resolve, reject).finally(() => { active--; next(); });
      queue.push(run);
      next();
    });
}

// Empty response shape for graceful degradation
const EMPTY_RESPONSE = {
  overview: { total: 0, active: 0, abandoned: 0, converted: 0, merged: 0, recovered: 0, recoveryRate: 0, abandonmentRate: 0 },
  values: { activeTotal: 0, activeAvg: 0, abandonedTotal: 0, abandonedAvg: 0, recoveredRevenue: 0, averageCartValue: 0 },
  topProducts: [],
  abandonedProducts: [],
  sources: [],
};

async function handler(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const rawPlatform = searchParams.get('platform');

    // Validate platform against allow-list
    const platform = rawPlatform && (VALID_PLATFORMS as readonly string[]).includes(rawPlatform) ? rawPlatform : null;

    const now = new Date();
    const startDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    let rawEnd = to ? new Date(to) : now;
    if (to && to.length === 10) {
      rawEnd.setHours(23, 59, 59, 999);
    }
    const endDate = rawEnd > now ? now : rawEnd;

    const data = await cachedAnalytics(
      ['carts', startDate.toISOString(), endDate.toISOString(), platform || 'all'],
      async () => {
        const dateFilter = { gte: startDate, lte: endDate };
        const limit = pLimit(4);

        // Platform filter for carts uses source field
        const cartPlatformFilter = platform === 'app'
          ? { source: 'mobile_app' }
          : platform === 'web'
            ? { source: 'webstore' }
            : {};

        const staleThreshold = new Date(now.getTime() - 30 * 60 * 1000);

        // FIX 3: Use shared cart conversion predicates (match abandoned-carts page)
        // Cart status breakdown
        const [totalCarts, activeCarts, abandonedCarts, convertedCarts, mergedCarts] = await Promise.all([
          prisma.cart.count({ where: { createdAt: dateFilter, status: { notIn: ['merged', 'expired'] }, ...cartPlatformFilter } }),
          prisma.cart.count({
            where: {
              status: 'active',
              convertedOrderId: null,
              items: { some: {} },
              lastActivityAt: { gte: staleThreshold },
              createdAt: dateFilter,
              ...cartPlatformFilter,
            },
          }),
          prisma.cart.count({
            where: abandonedCartWhere(dateFilter, staleThreshold, cartPlatformFilter),
          }),
          prisma.cart.count({
            where: convertedCartWhere(dateFilter, cartPlatformFilter),
          }),
          prisma.cart.count({ where: { status: 'merged', createdAt: dateFilter, ...cartPlatformFilter } }),
        ]);

        // Cart value aggregations
        const [activeCartValue, abandonedCartValue, convertedCartValue] = await Promise.all([
          prisma.cart.aggregate({
            where: {
              status: 'active',
              convertedOrderId: null,
              items: { some: {} },
              lastActivityAt: { gte: staleThreshold },
              createdAt: dateFilter,
              ...cartPlatformFilter,
            },
            _sum: { subtotal: true },
            _avg: { subtotal: true },
          }),
          prisma.cart.aggregate({
            where: abandonedCartWhere(dateFilter, staleThreshold, cartPlatformFilter),
            _sum: { subtotal: true },
            _avg: { subtotal: true },
          }),
          prisma.cart.aggregate({
            where: convertedCartWhere(dateFilter, cartPlatformFilter),
            _sum: { subtotal: true },
            _avg: { subtotal: true },
          }),
        ]);

        // Recovery rate: carts that were abandoned but then converted
        const recoveredCarts = await prisma.cart.count({
          where: {
            ...convertedCartWhere(dateFilter, cartPlatformFilter),
            abandonedAt: { not: null },
          },
        });
        const recoveryRate = abandonedCarts + recoveredCarts > 0
          ? (recoveredCarts / (abandonedCarts + recoveredCarts)) * 100
          : 0;

        // Most frequently added products (from CartItem)
        const topProducts: any[] = await prisma.cartItem.groupBy({
          by: ['productId'],
          where: {
            cart: { createdAt: dateFilter, ...cartPlatformFilter },
          },
          _count: true,
          _sum: { quantity: true },
          orderBy: { _count: { productId: 'desc' } },
          take: 10,
        });

        // Most abandoned products
        const abandonedProducts: any[] = await prisma.cartItem.groupBy({
          by: ['productId'],
          where: {
            cart: abandonedCartWhere(dateFilter, staleThreshold, cartPlatformFilter),
          },
          _count: true,
          orderBy: { _count: { productId: 'desc' } },
          take: 10,
        });

        // Resolve product titles
        const allPids = new Set<string>();
        [...topProducts, ...abandonedProducts].forEach((p: any) => allPids.add(p.productId));

        const productDetails = new Map<string, string>();
        if (allPids.size > 0) {
          const products = await prisma.product.findMany({
            where: {
              OR: [
                { shopifyProductId: { in: Array.from(allPids) } },
                { id: { in: Array.from(allPids) } },
              ],
            },
            select: { id: true, shopifyProductId: true, title: true },
          });
          for (const p of products) {
            productDetails.set(p.shopifyProductId, p.title);
            productDetails.set(p.id, p.title);
          }
        }

        // Cart source breakdown
        const sourceCounts: any[] = await prisma.cart.groupBy({
          by: ['source'],
          where: { createdAt: dateFilter, ...cartPlatformFilter },
          _count: true,
        });

        return {
          overview: {
            total: totalCarts,
            active: activeCarts,
            abandoned: abandonedCarts,
            converted: convertedCarts,
            merged: mergedCarts,
            recovered: recoveredCarts,
            recoveryRate: Math.round(recoveryRate * 10) / 10,
            abandonmentRate: totalCarts > 0
              ? Math.round((abandonedCarts / totalCarts) * 100 * 10) / 10
              : 0,
          },
          values: {
            activeTotal: Math.round((activeCartValue._sum.subtotal || 0) * 100) / 100,
            activeAvg: Math.round((activeCartValue._avg.subtotal || 0) * 100) / 100,
            abandonedTotal: Math.round((abandonedCartValue._sum.subtotal || 0) * 100) / 100,
            abandonedAvg: Math.round((abandonedCartValue._avg.subtotal || 0) * 100) / 100,
            recoveredRevenue: Math.round((convertedCartValue._sum.subtotal || 0) * 100) / 100,
            averageCartValue: Math.round(((activeCartValue._avg.subtotal || 0) + (abandonedCartValue._avg.subtotal || 0)) / 2 * 100) / 100,
          },
          topProducts: topProducts.map((p: any) => ({
            productId: p.productId,
            title: productDetails.get(p.productId) || 'Unknown',
            carts: p._count,
            totalQuantity: p._sum.quantity || 0,
          })),
          abandonedProducts: abandonedProducts.map((p: any) => ({
            productId: p.productId,
            title: productDetails.get(p.productId) || 'Unknown',
            carts: p._count,
          })),
          sources: sourceCounts.map((s: any) => ({ source: s.source, count: s._count })),
        };
      },
      30
    );

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[Analytics Carts] Error:', error.message);
    return NextResponse.json({
      ...EMPTY_RESPONSE,
      error: error.message,
    });
  }
}

export const GET = withAdminApiGuard(handler, { module: 'ANALYTICS', action: 'view' });
