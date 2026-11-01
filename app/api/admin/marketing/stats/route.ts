/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import {
  ATTRIBUTION_LOOKBACK_MS,
  CHANNEL_GROUPS,
  attributeOrders,
  classifyChannel,
  type Channel,
} from '@/lib/analytics/attribution';

export const dynamic = 'force-dynamic';

/**
 * Omnichannel Analytics (Developer Brief #33) — real data only.
 *
 *  traffic   sessions per channel (analytics_sessions)
 *  orders    paid, non-cancelled orders in the range, each credited to ONE channel
 *            (last non-direct touch, 7-day lookback — see lib/analytics/attribution.ts)
 *  revenue   sum of those orders' totals per channel; channels add up to the store total, no double counting
 *  messaging what each owned channel actually sent / delivered / opened / clicked; null = not tracked
 *
 * Nothing is estimated: when data is missing the API returns 0 / null and the page says so.
 */

const PAID_ORDER_STATUSES = ['paid', 'cod_upfront_paid', 'partially_paid'];
const RANGES: Record<string, number | null> = { '7': 7, '30': 30, '90': 90, lifetime: null };
const LIFETIME_CHART_DAYS = 90;

function rangeWindow(range: string, now: Date) {
  const days = RANGES[range] ?? null;
  if (days === null) return { start: null as Date | null, prevStart: null as Date | null, prevEnd: null as Date | null };
  const start = new Date(now);
  start.setDate(now.getDate() - days);
  start.setHours(0, 0, 0, 0);
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(start.getTime() - (now.getTime() - start.getTime()));
  return { start, prevStart, prevEnd };
}

type SessionGroupRow = {
  utm_source: string | null;
  utm_medium: string | null;
  referrer: string | null;
  gclid: boolean;
  sccid: boolean;
  fbclid: boolean;
  day: Date;
  sessions: bigint | number;
};

/** Sessions grouped by everything classifyChannel needs (+ day), so we never load raw rows. */
async function sessionGroups(start: Date | null, end: Date): Promise<SessionGroupRow[]> {
  const from = start ?? new Date(0);
  return db.$queryRaw<SessionGroupRow[]>`
    SELECT utm_source, utm_medium, referrer,
           (landing_page ~* '[?&](gclid|gbraid|wbraid)=') AS gclid,
           (landing_page ~* '[?&]sccid=') AS sccid,
           (landing_page ~* '[?&]fbclid=') AS fbclid,
           date_trunc('day', started_at) AS day,
           COUNT(*) AS sessions
    FROM analytics_sessions
    WHERE started_at >= ${from} AND started_at <= ${end}
    GROUP BY 1, 2, 3, 4, 5, 6, 7`;
}

function channelOfGroup(row: SessionGroupRow): Channel {
  const params = [row.gclid && 'gclid=1', row.sccid && 'sccid=1', row.fbclid && 'fbclid=1'].filter(Boolean).join('&');
  return classifyChannel({
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    referrer: row.referrer,
    landingPage: params ? `/?${params}` : null,
  });
}

async function attributedOrders(start: Date | null, end: Date) {
  const orders = await db.order.findMany({
    where: {
      paymentStatus: { in: PAID_ORDER_STATUSES },
      status: { not: 'cancelled' },
      createdAt: { ...(start ? { gte: start } : {}), lte: end },
    },
    select: { id: true, createdAt: true, totalPrice: true, customerId: true },
  });
  if (orders.length === 0) return { orders, channelOf: new Map<string, Channel>() };

  const orderIds = orders.map((o: any) => o.id);
  const purchaseEvents = await db.analyticsEvent.findMany({
    where: { eventName: 'purchase', orderId: { in: orderIds } },
    select: { orderId: true, anonymousId: true, customerId: true },
  });
  const identities = new Map<string, Set<string>>();
  for (const o of orders) identities.set(o.id, new Set(o.customerId ? [o.customerId] : []));
  for (const e of purchaseEvents) {
    const set = identities.get(e.orderId as string);
    if (!set) continue;
    if (e.anonymousId) set.add(e.anonymousId);
    if (e.customerId) set.add(e.customerId);
  }

  const allIds = Array.from(new Set(Array.from(identities.values()).flatMap((s) => Array.from(s))));
  const earliest = new Date(Math.min(...orders.map((o: any) => o.createdAt.getTime())) - ATTRIBUTION_LOOKBACK_MS);
  const sessions = allIds.length
    ? await db.analyticsSession.findMany({
        where: {
          startedAt: { gte: earliest, lte: end },
          OR: [{ anonymousId: { in: allIds } }, { customerId: { in: allIds } }],
        },
        select: { anonymousId: true, customerId: true, startedAt: true, utmSource: true, utmMedium: true, referrer: true, landingPage: true },
      })
    : [];

  const channelOf = attributeOrders(
    orders.map((o: any) => ({ id: o.id, createdAt: o.createdAt, identities: Array.from(identities.get(o.id) || []) })),
    sessions
  );
  return { orders, channelOf };
}

function summarise(orders: any[], channelOf: Map<string, Channel>) {
  const revenue = orders.reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
  const attributed = orders.filter((o) => channelOf.get(o.id) !== 'Unattributed');
  return { orders: orders.length, revenue, attributedOrders: attributed.length };
}

const pctChange = (current: number, previous: number | null): number | null => {
  if (previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

export async function GET(req: Request) {
  try {
    const range = new URL(req.url).searchParams.get('range') || '30';
    const now = new Date();
    const { start, prevStart, prevEnd } = rangeWindow(range, now);

    const [groups, current, previous, prevGroups] = await Promise.all([
      sessionGroups(start, now),
      attributedOrders(start, now),
      prevStart && prevEnd ? attributedOrders(prevStart, prevEnd) : Promise.resolve(null),
      prevStart && prevEnd ? sessionGroups(prevStart, prevEnd) : Promise.resolve(null),
    ]);

    // ── Per-channel traffic, orders, revenue ──
    const byChannel = new Map<Channel, { sessions: number; orders: number; revenue: number }>();
    const bucket = (c: Channel) => {
      if (!byChannel.has(c)) byChannel.set(c, { sessions: 0, orders: 0, revenue: 0 });
      return byChannel.get(c)!;
    };
    for (const g of groups) bucket(channelOfGroup(g)).sessions += Number(g.sessions);
    for (const o of current.orders) {
      const b = bucket(current.channelOf.get(o.id) || 'Unattributed');
      b.orders += 1;
      b.revenue += Number(o.totalPrice) || 0;
    }

    const totals = summarise(current.orders, current.channelOf);
    const totalSessions = groups.reduce((s, g) => s + Number(g.sessions), 0);
    const channels = Array.from(byChannel.entries())
      .map(([name, v]) => ({
        name,
        group: CHANNEL_GROUPS[name],
        sessions: v.sessions,
        orders: v.orders,
        revenue: Math.round(v.revenue),
        conversionRate: v.sessions > 0 ? Math.round((v.orders / v.sessions) * 10000) / 100 : null,
        revenueShare: totals.revenue > 0 ? Math.round((v.revenue / totals.revenue) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions);

    // ── Daily traffic by channel group (fixed groups → stable colors across ranges) ──
    const chartFrom = start ?? new Date(now.getTime() - LIFETIME_CHART_DAYS * 86400000);
    const daily = new Map<string, Record<string, number>>();
    for (let d = new Date(chartFrom); d <= now; d.setDate(d.getDate() + 1)) {
      daily.set(d.toISOString().slice(0, 10), { 'Paid social': 0, Search: 0, 'Owned messaging': 0, 'Direct & other': 0 });
    }
    for (const g of groups) {
      const key = new Date(g.day).toISOString().slice(0, 10);
      const row = daily.get(key);
      if (row) row[CHANNEL_GROUPS[channelOfGroup(g)]] += Number(g.sessions);
    }
    const chartData = Array.from(daily.entries()).map(([date, v]) => ({ date, ...v }));

    // ── Owned messaging delivery stats (only what each system actually records) ──
    const sentFilter = start ? { sentAt: { gte: start, lte: now } } : {};
    const [push, email, wa, sms] = await Promise.all([
      db.notificationSend.aggregate({ where: { status: 'sent', ...sentFilter }, _sum: { sentCount: true, deliveredCount: true, openedCount: true } }),
      db.emailCampaign.aggregate({ where: { status: 'sent', ...sentFilter }, _sum: { statsSent: true, statsOpened: true, statsClicked: true } }),
      db.whatsAppCampaign.aggregate({ where: { status: 'sent', ...sentFilter }, _sum: { statsSent: true, statsDelivered: true, statsRead: true, click_count: true } }),
      db.smsCampaign.aggregate({ where: { status: 'sent', ...sentFilter }, _sum: { statsSent: true, statsDelivered: true } }),
    ]);
    const messaging = [
      { name: 'WhatsApp', sent: wa._sum.statsSent || 0, delivered: wa._sum.statsDelivered || 0, opened: wa._sum.statsRead || 0, clicked: wa._sum.click_count || 0 },
      { name: 'Email', sent: email._sum.statsSent || 0, delivered: null, opened: email._sum.statsOpened || 0, clicked: email._sum.statsClicked || 0 },
      { name: 'Push Notifications', sent: push._sum.sentCount || 0, delivered: push._sum.deliveredCount || 0, opened: push._sum.openedCount || 0, clicked: null },
      { name: 'SMS', sent: sms._sum.statsSent || 0, delivered: sms._sum.statsDelivered || 0, opened: null, clicked: null },
    ];

    const prevTotals = previous ? summarise(previous.orders, previous.channelOf) : null;
    const prevSessions = prevGroups ? prevGroups.reduce((s, g) => s + Number(g.sessions), 0) : null;

    return NextResponse.json({
      range,
      model: {
        name: 'Last non-direct touch',
        lookbackDays: ATTRIBUTION_LOOKBACK_MS / 86400000,
        note: 'Each paid order is credited to one channel only, so channel revenue adds up to total revenue.',
      },
      summary: {
        sessions: totalSessions,
        orders: totals.orders,
        revenue: Math.round(totals.revenue),
        conversionRate: totalSessions > 0 ? Math.round((totals.orders / totalSessions) * 10000) / 100 : null,
        attributedShare: totals.orders > 0 ? Math.round((totals.attributedOrders / totals.orders) * 1000) / 10 : null,
        changes: {
          sessions: pctChange(totalSessions, prevSessions),
          orders: pctChange(totals.orders, prevTotals ? prevTotals.orders : null),
          revenue: pctChange(totals.revenue, prevTotals ? prevTotals.revenue : null),
        },
      },
      channels,
      chartData,
      messaging,
    });
  } catch (error: any) {
    console.error('Failed to fetch marketing stats:', error);
    return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
  }
}
