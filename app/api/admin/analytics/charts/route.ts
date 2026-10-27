/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAdminApiGuard } from '@/lib/auth/admin-api-guard';
import { cachedAnalytics } from '@/lib/analytics-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// Canonical realized-revenue statuses (must match overview/route.ts)
const REALIZED_PAYMENT_SQL = `('paid', 'PAID', 'success', 'SUCCESS', 'cod_upfront_paid', 'partially_paid')`;
const EXCLUDED_STATUS_SQL = `('cancelled', 'CANCELLED', 'payment_failed', 'failed', 'FAILED', 'draft', 'abandoned', 'pending', 'payment_pending')`;

// Valid platform values for allow-list validation
const VALID_PLATFORMS = ['web', 'app'] as const;

async function handler(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const rawPlatform = searchParams.get('platform');

    // Validate platform against allow-list (Item 6)
    const platform = rawPlatform && (VALID_PLATFORMS as readonly string[]).includes(rawPlatform) ? rawPlatform : null;

    const now = new Date();
    const startDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    let rawEnd = to ? new Date(to) : now;
    if (to && to.length === 10) {
      rawEnd.setHours(23, 59, 59, 999);
    }
    const endDate = rawEnd > now ? now : rawEnd;

    const data = await cachedAnalytics(
      ['charts', startDate.toISOString(), endDate.toISOString(), platform || 'all'],
      async () => {
        // Determine aggregation granularity
        const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        let truncUnit: string;
        if (durationDays <= 2) truncUnit = 'hour';
        else if (durationDays <= 90) truncUnit = 'day';
        else if (durationDays <= 365) truncUnit = 'week';
        else truncUnit = 'month';

        // Build parameterized platform conditions
        const orderTypeCondition = platform === 'web'
          ? `AND "orderType" IN ('WEB_STORE', 'REGULAR', 'EXCHANGE')`
          : platform === 'app'
            ? `AND "orderType" IN ('MOBILE', 'MOBILE_APP', 'APP')`
            : '';

        const draftExclusionSql = `AND "internal_order_number" NOT LIKE 'ZBPF%' AND NOT ("internal_order_number" LIKE 'ZBPP%' AND "paymentStatus" IN ('pending', 'payment_pending', 'failed', 'payment_failed'))`;

        // Platform filter for analytics tables — parameterized (Item 6)
        const platformCondition = platform ? `AND platform = $3` : '';
        const baseArgs: any[] = [startDate, endDate];
        const platformArgs: any[] = platform ? [startDate, endDate, platform] : [startDate, endDate];

        // Run time series queries concurrently
        const [orderTimeSeries, sessionTimeSeries, eventTimeSeries, loginTimeSeries]: [any[], any[], any[], any[]] = await Promise.all([
          prisma.$queryRawUnsafe(`
            SELECT
              date_trunc('${truncUnit}', "createdAt") AS bucket,
              COUNT(*) AS orders,
              COALESCE(SUM("totalPrice"), 0) AS revenue
            FROM "Order"
            WHERE "createdAt" >= $1 AND "createdAt" <= $2
              AND "paymentStatus" IN ${REALIZED_PAYMENT_SQL}
              AND "status" NOT IN ${EXCLUDED_STATUS_SQL}
              ${draftExclusionSql}
              ${orderTypeCondition}
            GROUP BY bucket
            ORDER BY bucket ASC
          `, ...baseArgs),

          prisma.$queryRawUnsafe(`
            SELECT
              date_trunc('${truncUnit}', started_at) AS bucket,
              COUNT(*) AS sessions,
              COUNT(DISTINCT anonymous_id) AS visitors
            FROM analytics_sessions
            WHERE started_at >= $1 AND started_at <= $2
              ${platformCondition}
            GROUP BY bucket
            ORDER BY bucket ASC
          `, ...platformArgs),

          prisma.$queryRawUnsafe(`
            SELECT
              date_trunc('${truncUnit}', created_at) AS bucket,
              event_name,
              COUNT(*) AS count
            FROM analytics_events
            WHERE created_at >= $1 AND created_at <= $2
              AND event_name IN ('add_to_cart', 'begin_checkout', 'purchase', 'page_view', 'view_item')
              ${platformCondition}
            GROUP BY bucket, event_name
            ORDER BY bucket ASC
          `, ...platformArgs),

          prisma.$queryRawUnsafe(`
            SELECT
              date_trunc('${truncUnit}', "createdAt") AS bucket,
              COUNT(*) AS logins,
              SUM(CASE WHEN status = 'ACCOUNT_CREATED' THEN 1 ELSE 0 END) AS new_logins
            FROM "AppLogin"
            WHERE "createdAt" >= $1 AND "createdAt" <= $2
              AND status IN ('LOGGED_IN', 'SUCCESS', 'ACCOUNT_CREATED')
            GROUP BY bucket
            ORDER BY bucket ASC
          `, ...baseArgs),
        ]);

        // Merge into unified time series
        const bucketMap = new Map<string, any>();

        for (const row of orderTimeSeries) {
          const key = new Date(row.bucket).toISOString();
          if (!bucketMap.has(key)) bucketMap.set(key, { date: key });
          const entry = bucketMap.get(key)!;
          entry.orders = Number(row.orders);
          entry.revenue = Math.round(Number(row.revenue) * 100) / 100;
        }

        for (const row of sessionTimeSeries) {
          const key = new Date(row.bucket).toISOString();
          if (!bucketMap.has(key)) bucketMap.set(key, { date: key });
          const entry = bucketMap.get(key)!;
          entry.sessions = Number(row.sessions);
          entry.visitors = Number(row.visitors);
        }

        for (const row of eventTimeSeries) {
          const key = new Date(row.bucket).toISOString();
          if (!bucketMap.has(key)) bucketMap.set(key, { date: key });
          const entry = bucketMap.get(key)!;
          entry[row.event_name] = Number(row.count);
        }

        for (const row of loginTimeSeries) {
          const key = new Date(row.bucket).toISOString();
          if (!bucketMap.has(key)) bucketMap.set(key, { date: key });
          const entry = bucketMap.get(key)!;
          entry.logins = Number(row.logins);
          entry.newLogins = Number(row.new_logins);
        }

        // Sort and fill defaults
        const timeSeries = Array.from(bucketMap.values())
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
          .map(entry => ({
            date: entry.date,
            revenue: entry.revenue || 0,
            orders: entry.orders || 0,
            sessions: entry.sessions || 0,
            visitors: entry.visitors || 0,
            page_view: entry.page_view || 0,
            view_item: entry.view_item || 0,
            add_to_cart: entry.add_to_cart || 0,
            begin_checkout: entry.begin_checkout || 0,
            purchase: entry.purchase || 0,
            logins: entry.logins || 0,
            newLogins: entry.newLogins || 0,
            conversionRate: entry.sessions > 0
              ? Math.round(((entry.purchase || 0) / entry.sessions) * 100 * 100) / 100
              : 0,
          }));

        const responseData = { timeSeries, granularity: truncUnit };
        return responseData;
      },
      30
    );

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[Analytics Charts] Error:', error.message);
    return NextResponse.json({ timeSeries: [], granularity: 'day', error: error.message });
  }
}

export const GET = withAdminApiGuard(handler, { module: 'ANALYTICS', action: 'view' });
