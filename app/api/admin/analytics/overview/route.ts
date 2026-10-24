/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdminApiGuard } from '@/lib/auth/admin-api-guard';
import { cachedAnalytics } from '@/lib/analytics-cache';
import { convertedCartWhere, abandonedCartWhere } from '@/lib/cartConversion';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// ─── Inline pLimit: cap concurrent DB queries per route ────────
// No external dependency needed. Limits how many promises run at once.
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

// ─── Canonical status sets (Item 1) ─────────────────────────────
// Only these paymentStatus values count toward realized revenue & order counts.
// Exclude failed, unpaid, and payment-pending orders.
// Include only successfully paid orders and COD orders where the upfront payment has been successfully received.
const REALIZED_PAYMENT_STATUSES = [
  'paid',
  'PAID',
  'success',
  'SUCCESS',
  'cod_upfront_paid',
  'partially_paid',
] as const;

// Orders with these status values are excluded from all revenue/order metrics.
const EXCLUDED_ORDER_STATUSES = [
  'cancelled',
  'CANCELLED',
  'payment_failed',
  'failed',
  'FAILED',
  'draft',
  'abandoned',
  'pending',
  'payment_pending',
] as const;

// Valid platform values for allow-list validation (Item 6)
const VALID_PLATFORMS = ['web', 'app'] as const;

// Empty response shape for graceful degradation (FIX 6)
const EMPTY_RESPONSE = {
  period: { from: new Date().toISOString(), to: new Date().toISOString() },
  revenue: { total: 0, net: 0, gross: 0, refunds: 0, discounts: 0, change: 0 },
  orders: { total: 0, aov: 0, cancelled: 0, returned: 0, refunded: 0, change: 0, statusBreakdown: [], paymentBreakdown: [] },
  customers: { total: 0, new: 0, returning: 0, change: 0 },
  logins: { total: 0, new: 0, change: 0, newChange: 0 },
  visitors: { total: 0, active: 0, change: 0 },
  sessions: { total: 0, web: 0, app: 0, change: 0 },
  funnel: { pageViews: 0, productViews: 0, addToCart: 0, checkoutStarted: 0, paymentInitiated: 0, purchases: 0 },
  carts: { total: 0, active: 0, abandoned: 0, converted: 0, abandonmentRate: 0 },
  rates: { conversion: 0, addToCart: 0, cartToCheckout: 0, checkoutToPurchase: 0, cartAbandonment: 0 },
  platformSplit: {
    web: { orders: 0, revenue: 0, sessions: 0, visitors: 0 },
    app: { orders: 0, revenue: 0, sessions: 0, visitors: 0 },
  },
};

async function handler(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const rawPlatform = searchParams.get('platform'); // 'web' | 'app' | null (all)

    // Validate platform against allow-list
    const platform = rawPlatform && (VALID_PLATFORMS as readonly string[]).includes(rawPlatform) ? rawPlatform : null;

    const now = new Date();
    const startDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    let rawEnd = to ? new Date(to) : now;
    if (to && to.length === 10) {
      rawEnd.setHours(23, 59, 59, 999);
    }
    const endDate = rawEnd > now ? now : rawEnd;

    const data = await cachedAnalytics(
      ['overview', startDate.toISOString(), endDate.toISOString(), platform || 'all'],
      async () => {
    // Previous period for comparison
    const durationMs = endDate.getTime() - startDate.getTime();
    const prevStart = new Date(startDate.getTime() - durationMs);
    const prevEnd = new Date(startDate.getTime() - 1);

    const dateFilter = { gte: startDate, lte: endDate };
    const prevDateFilter = { gte: prevStart, lte: prevEnd };

    // Platform → orderType mapping
    const orderTypeFilter = platform === 'app'
      ? { orderType: { in: ['MOBILE', 'MOBILE_APP', 'APP'] } }
      : platform === 'web'
        ? { orderType: { in: ['WEB_STORE', 'REGULAR', 'EXCHANGE'] } }
        : {};

    const platformFilter = platform ? { platform } : {};

    // ── Platform SQL conditions for raw queries ──
    let orderTypeSql = '';
    if (platform === 'web') orderTypeSql = `AND "orderType" IN ('WEB_STORE', 'REGULAR', 'EXCHANGE')`;
    else if (platform === 'app') orderTypeSql = `AND "orderType" IN ('MOBILE', 'MOBILE_APP', 'APP')`;

    const realizedPaymentSql = `AND "paymentStatus" IN ('paid', 'PAID', 'success', 'SUCCESS', 'cod_upfront_paid', 'partially_paid')`;
    const excludedStatusSql = `AND "status" NOT IN ('cancelled', 'CANCELLED', 'payment_failed', 'failed', 'FAILED', 'draft', 'abandoned', 'pending', 'payment_pending')`;
    const draftExclusionSql = `AND "internal_order_number" NOT LIKE 'ZBPF%' AND NOT ("internal_order_number" LIKE 'ZBPP%' AND "paymentStatus" IN ('pending', 'payment_pending', 'failed', 'payment_failed'))`;

    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // ── Shared cart predicates ──
    const cartPlatformFilter = platform === 'app'
      ? { source: 'mobile_app' }
      : platform === 'web'
        ? { source: 'webstore' }
        : {};

    // ── PHASE 1: Consolidated Single-Pass Orders & Cart Aggregates ──
    const [
      orderMetricsRaw,
      prevOrderAggRaw,
      returnedCount,
      totalLogins,
      prevTotalLogins,
      newSignups,
      prevNewSignups,
      activeCarts,
      abandonedCarts,
      convertedCarts,
      totalCarts,
      activeVisitors,
    ]: any = await Promise.all([
      // 1. Single consolidated order aggregation for current period
      prisma.$queryRawUnsafe(`
        SELECT
          status,
          "paymentStatus",
          "orderType",
          "paymentMethod",
          "refund_status" AS "refundStatus",
          COUNT(*) AS count,
          COALESCE(SUM("totalPrice"), 0) AS total_price,
          COALESCE(SUM("subtotalPrice"), 0) AS subtotal_price,
          COALESCE(SUM("discountAmount"), 0) AS discount_amount
        FROM "Order"
        WHERE "createdAt" >= $1 AND "createdAt" <= $2
          ${draftExclusionSql}
          ${orderTypeSql}
        GROUP BY status, "paymentStatus", "orderType", "paymentMethod", "refund_status"
      `, startDate, endDate),

      // 2. Fast previous period realized revenue & orders
      prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*) AS count,
          COALESCE(SUM("totalPrice"), 0) AS total_price
        FROM "Order"
        WHERE "createdAt" >= $1 AND "createdAt" <= $2
          ${realizedPaymentSql}
          ${excludedStatusSql}
          ${draftExclusionSql}
          ${orderTypeSql}
      `, prevStart, prevEnd),

      prisma.return.count({
        where: { requestedAt: dateFilter, status: { in: ['APPROVED', 'COMPLETED'] } },
      }),
      prisma.appLogin.count({
        where: { createdAt: dateFilter, status: { in: ['LOGGED_IN', 'SUCCESS', 'ACCOUNT_CREATED'] } },
      }),
      prisma.appLogin.count({
        where: { createdAt: prevDateFilter, status: { in: ['LOGGED_IN', 'SUCCESS', 'ACCOUNT_CREATED'] } },
      }),
      prisma.customer.count({ where: { createdAt: dateFilter } }),
      prisma.customer.count({ where: { createdAt: prevDateFilter } }),
      prisma.cart.count({
        where: {
          status: 'active',
          convertedOrderId: null,
          items: { some: {} },
          lastActivityAt: { gte: new Date(now.getTime() - 30 * 60 * 1000) },
          createdAt: dateFilter,
          ...cartPlatformFilter,
        },
      }),
      prisma.cart.count({
        where: abandonedCartWhere(dateFilter, new Date(now.getTime() - 30 * 60 * 1000), cartPlatformFilter),
      }),
      prisma.cart.count({
        where: convertedCartWhere(dateFilter, cartPlatformFilter),
      }),
      prisma.cart.count({ where: { createdAt: dateFilter, status: { notIn: ['merged', 'expired'] }, ...cartPlatformFilter } }),
      prisma.analyticsSession.count({
        where: { lastActiveAt: { gte: fiveMinAgo }, ...platformFilter },
      }),
    ]);

    // ── PHASE 2: Heavy Analytical Raw Queries ──
    const platformCondition = platform ? `AND platform = $3` : '';
    const queryArgs: any[] = platform ? [startDate, endDate, platform] : [startDate, endDate];
    const prevQueryArgs: any[] = platform ? [prevStart, prevEnd, platform] : [prevStart, prevEnd];

    // For historical comparisons (>7 days), avoid expensive distinct UUID scans
    const isLongPeriod = (endDate.getTime() - startDate.getTime()) > 7 * 24 * 60 * 60 * 1000;
    const prevSessionQuerySql = isLongPeriod
      ? `SELECT COUNT(*) AS sessions FROM analytics_sessions WHERE started_at >= $1 AND started_at <= $2 ${platformCondition}`
      : `SELECT COUNT(*) AS sessions, COUNT(DISTINCT anonymous_id) AS visitors FROM analytics_sessions WHERE started_at >= $1 AND started_at <= $2 ${platformCondition}`;

    const [
      customerStatsRaw,
      prevCustomerCountRaw,
      prevSessionStatsRaw,
      eventCountsRaw,
      platformSessionsRaw,
    ] = await Promise.all([
      // 1. Customer realization CTE
      prisma.$queryRawUnsafe(`
        WITH realized_orders AS (
          SELECT "customerId", "createdAt"
          FROM "Order"
          WHERE "customerId" IS NOT NULL
            ${realizedPaymentSql}
            ${excludedStatusSql}
            ${orderTypeSql}
        ),
        first_orders AS (
          SELECT "customerId", MIN("createdAt") AS first_order_at
          FROM realized_orders
          GROUP BY "customerId"
        ),
        period_customers AS (
          SELECT DISTINCT "customerId"
          FROM realized_orders
          WHERE "createdAt" >= $1 AND "createdAt" <= $2
        )
        SELECT
          COUNT(*) AS total_customers,
          COUNT(CASE WHEN fo.first_order_at >= $1 AND fo.first_order_at <= $2 THEN 1 END) AS new_customers
        FROM period_customers pc
        JOIN first_orders fo ON pc."customerId" = fo."customerId"
      `, startDate, endDate) as Promise<any[]>,

      // 2. Previous period customer count
      prisma.$queryRawUnsafe(`
        SELECT COUNT(DISTINCT "customerId") AS count
        FROM "Order"
        WHERE "createdAt" >= $1 AND "createdAt" <= $2
          AND "customerId" IS NOT NULL
          ${realizedPaymentSql}
          ${excludedStatusSql}
          ${draftExclusionSql}
          ${orderTypeSql}
      `, prevStart, prevEnd) as Promise<any[]>,

      // 3. Previous period session count
      prisma.$queryRawUnsafe(prevSessionQuerySql, ...prevQueryArgs) as Promise<any[]>,

      // 4. Fast event counts via raw SQL utilizing index
      prisma.$queryRawUnsafe(`
        SELECT event_name AS "eventName", COUNT(*) AS count
        FROM analytics_events
        WHERE created_at >= $1 AND created_at <= $2
          AND event_name IN ('page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'payment_initiated', 'purchase')
          ${platformCondition}
        GROUP BY event_name
      `, ...queryArgs) as Promise<any[]>,

      // 5. Current sessions & visitors grouped by platform
      prisma.$queryRawUnsafe(`
        SELECT
          platform,
          COUNT(*) AS sessions,
          COUNT(DISTINCT anonymous_id) AS visitors
        FROM analytics_sessions
        WHERE started_at >= $1 AND started_at <= $2
        GROUP BY platform
      `, startDate, endDate) as Promise<any[]>,
    ]);

    // ── Derive revenue & order metrics from consolidated Order aggregate ──
    let totalRevenue = 0;
    let grossSales = 0;
    let totalDiscounts = 0;
    let totalOrders = 0;
    let totalRefunds = 0;
    let refundedOrders = 0;
    let cancelledOrders = 0;
    const statusMap = new Map<string, number>();
    const paymentMap = new Map<string, { count: number; revenue: number }>();
    let webOrderCount = 0, webRevenue = 0, appOrderCount = 0, appRevenue = 0;

    for (const r of (orderMetricsRaw as any[])) {
      const cnt = Number(r.count || 0);
      const rev = Number(r.total_price || 0);
      const sub = Number(r.subtotal_price || 0);
      const disc = Number(r.discount_amount || 0);
      const isRealized = (REALIZED_PAYMENT_STATUSES as readonly string[]).includes(r.paymentStatus) &&
        !(EXCLUDED_ORDER_STATUSES as readonly string[]).includes(r.status);

      if (isRealized) {
        totalRevenue += rev;
        grossSales += (sub > 0 ? sub : rev);
        totalDiscounts += disc;
        totalOrders += cnt;

        const pm = r.paymentMethod || 'other';
        const existingPm = paymentMap.get(pm) || { count: 0, revenue: 0 };
        paymentMap.set(pm, {
          count: existingPm.count + cnt,
          revenue: Math.round((existingPm.revenue + rev) * 100) / 100,
        });

        if (['WEB_STORE', 'REGULAR', 'EXCHANGE'].includes(r.orderType)) {
          webOrderCount += cnt;
          webRevenue += rev;
        } else if (['MOBILE', 'MOBILE_APP', 'APP'].includes(r.orderType)) {
          appOrderCount += cnt;
          appRevenue += rev;
        }
      }

      if (['refunded', 'partial_refund'].includes(r.refundStatus)) {
        totalRefunds += rev;
        refundedOrders += cnt;
      }
      if (r.status === 'cancelled' || r.status === 'CANCELLED') {
        cancelledOrders += cnt;
      }

      statusMap.set(r.status, (statusMap.get(r.status) || 0) + cnt);
    }

    const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const netRevenue = totalRevenue - totalRefunds;
    const prevRevenue = Number(prevOrderAggRaw[0]?.total_price || 0);
    const prevOrders = Number(prevOrderAggRaw[0]?.count || 0);

    const statusBreakdown = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));
    const paymentBreakdown = Array.from(paymentMap.entries()).map(([method, val]) => ({
      method,
      count: val.count,
      revenue: val.revenue,
    }));

    // ── Derive customer metrics ──
    const totalCustomersCount = Number(customerStatsRaw[0]?.total_customers || 0);
    const newCustomerCount = Number(customerStatsRaw[0]?.new_customers || 0);
    const returningCustomerCount = Math.max(0, totalCustomersCount - newCustomerCount);
    const prevTotalCustomersCount = Number(prevCustomerCountRaw[0]?.count || 0);

    // ── Derive platform split & session totals ──
    let webSessions = 0, webVisitors = 0, appSessions = 0, appVisitors = 0;
    for (const row of platformSessionsRaw) {
      if (row.platform === 'web') {
        webSessions = Number(row.sessions || 0);
        webVisitors = Number(row.visitors || 0);
      } else if (row.platform === 'app') {
        appSessions = Number(row.sessions || 0);
        appVisitors = Number(row.visitors || 0);
      }
    }
    const sessionCount = platform === 'web' ? webSessions : platform === 'app' ? appSessions : (webSessions + appSessions);
    const uniqueVisitorsCount = platform === 'web' ? webVisitors : platform === 'app' ? appVisitors : Math.max(webVisitors, appVisitors, 1);
    const prevSessionCount = Number(prevSessionStatsRaw[0]?.sessions || 0);
    const prevUniqueVisitorsCount = Number(prevSessionStatsRaw[0]?.visitors || Math.round(prevSessionCount * 0.75));

    // ── Derive funnel counts ──
    const getEventCount = (name: string) => Number(eventCountsRaw.find((e: any) => e.eventName === name)?.count || 0);
    const pageViews = getEventCount('page_view');
    const productViews = getEventCount('view_item');
    const addToCartEvents = getEventCount('add_to_cart');
    const checkoutStarted = getEventCount('begin_checkout');
    const paymentInitiated = getEventCount('payment_initiated');
    const purchases = getEventCount('purchase');

    // ─── DERIVED RATES ───────────────────────────────────────────
    const conversionRate = sessionCount > 0 ? (purchases / sessionCount) * 100 : 0;
    const addToCartRate = sessionCount > 0 ? (addToCartEvents / sessionCount) * 100 : 0;
    const cartToCheckoutRate = addToCartEvents > 0 ? (checkoutStarted / addToCartEvents) * 100 : 0;
    const checkoutToPurchaseRate = checkoutStarted > 0 ? (purchases / checkoutStarted) * 100 : 0;
    const cartAbandonmentRate = (abandonedCarts + convertedCarts) > 0
      ? (abandonedCarts / (abandonedCarts + convertedCarts)) * 100 : 0;

    function pctChange(current: number, previous: number): number {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100 * 10) / 10;
    }

    const responseData = {
      period: { from: startDate.toISOString(), to: endDate.toISOString() },
      revenue: {
        total: Math.round(totalRevenue * 100) / 100,
        net: Math.round(netRevenue * 100) / 100,
        gross: Math.round(grossSales * 100) / 100,
        refunds: Math.round(totalRefunds * 100) / 100,
        discounts: Math.round(totalDiscounts * 100) / 100,
        change: pctChange(totalRevenue, prevRevenue),
      },
      orders: {
        total: totalOrders,
        aov: Math.round(aov * 100) / 100,
        cancelled: cancelledOrders,
        returned: returnedCount,
        refunded: refundedOrders,
        change: pctChange(totalOrders, prevOrders),
        statusBreakdown,
        paymentBreakdown,
      },
      customers: {
        total: totalCustomersCount,
        new: newCustomerCount,
        returning: returningCustomerCount,
        change: pctChange(totalCustomersCount, prevTotalCustomersCount),
      },
      logins: {
        total: totalLogins,
        new: newSignups,
        change: pctChange(totalLogins, prevTotalLogins),
        newChange: pctChange(newSignups, prevNewSignups),
      },
      visitors: {
        total: uniqueVisitorsCount,
        active: activeVisitors,
        change: pctChange(uniqueVisitorsCount, prevUniqueVisitorsCount),
      },
      sessions: {
        total: sessionCount,
        web: webSessions,
        app: appSessions,
        change: pctChange(sessionCount, prevSessionCount),
      },
      funnel: {
        pageViews,
        productViews,
        addToCart: addToCartEvents,
        checkoutStarted,
        paymentInitiated,
        purchases,
      },
      carts: {
        total: totalCarts,
        active: activeCarts,
        abandoned: abandonedCarts,
        converted: convertedCarts,
        abandonmentRate: Math.round(cartAbandonmentRate * 10) / 10,
      },
      rates: {
        conversion: Math.round(conversionRate * 100) / 100,
        addToCart: Math.round(addToCartRate * 100) / 100,
        cartToCheckout: Math.round(cartToCheckoutRate * 100) / 100,
        checkoutToPurchase: Math.round(checkoutToPurchaseRate * 100) / 100,
        cartAbandonment: Math.round(cartAbandonmentRate * 100) / 100,
      },
      platformSplit: {
        web: {
          orders: webOrderCount,
          revenue: Math.round(webRevenue * 100) / 100,
          sessions: webSessions,
          visitors: webVisitors,
        },
        app: {
          orders: appOrderCount,
          revenue: Math.round(appRevenue * 100) / 100,
          sessions: appSessions,
          visitors: appVisitors,
        },
      },
    };

    return responseData;
      },
      30
    );

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[Analytics Overview] Error:', error.message);
    // FIX 6: Return HTTP 200 with error field (not 500) so client can show error state
    // uniformly across all analytics routes, without hanging.
    return NextResponse.json({
      error: error.message || 'Failed to load analytics overview',
      ...EMPTY_RESPONSE,
    });
  }
}

export const GET = withAdminApiGuard(handler, { module: 'ANALYTICS', action: 'view' });
