/**
 * Customer list with order count and lifetime revenue computed from real orders, sortable and filterable in SQL.
 *
 * Lifetime revenue used to be the sum of the customer's last 10 orders whose fulfillment status was
 * fulfilled/shipped/delivered, a status almost no order ever reached, so it showed ₹0 for customers with several
 * orders. Now: every placed order (paid, COD with upfront paid, partially paid) that was not cancelled, failed,
 * returned to origin or an exchange replacement, minus the refunds actually paid out on it. INR orders only
 * (amounts in other currencies cannot be added to rupees).
 */
import prisma from '@/lib/db';

export type CustomerSort = 'newest' | 'oldest' | 'orders_desc' | 'orders_asc' | 'revenue_desc' | 'revenue_asc';

export const CUSTOMER_SORTS: CustomerSort[] = ['newest', 'oldest', 'orders_desc', 'orders_asc', 'revenue_desc', 'revenue_asc'];

const ORDER_BY: Record<CustomerSort, string> = {
  newest: 'c."createdAt" DESC',
  oldest: 'c."createdAt" ASC',
  orders_desc: 'orders DESC, revenue DESC, c."createdAt" DESC',
  orders_asc: 'orders ASC, c."createdAt" DESC',
  revenue_desc: 'revenue DESC, orders DESC, c."createdAt" DESC',
  revenue_asc: 'revenue ASC, c."createdAt" DESC',
};

/** Orders that count as placed (same idea as the analytics "realized" revenue). */
const PLACED_ORDER_SQL = `
  o."paymentStatus" IN ('paid', 'PAID', 'success', 'SUCCESS', 'captured', 'cod_upfront_paid', 'partially_paid', 'partially-paid', 'partial_refund', 'partially_refunded')
  AND o.status NOT IN ('cancelled', 'CANCELLED', 'payment_failed', 'failed', 'FAILED', 'draft', 'abandoned', 'payment_pending')
  AND COALESCE(o."orderType", '') <> 'EXCHANGE'
  AND COALESCE(o."deliveryStatus", '') NOT IN ('rto', 'rto_delivered', 'returned_to_origin')
  AND UPPER(COALESCE(o.currency, 'INR')) = 'INR'`;

const STATS_CTE = `
  WITH refunds AS (
    SELECT "orderId", SUM(amount) AS refunded
    FROM "Payment"
    WHERE type = 'refund' AND status = 'completed'
    GROUP BY "orderId"
  ),
  stats AS (
    SELECT o."customerId" AS cid,
           COUNT(*)::int AS orders,
           GREATEST(COALESCE(SUM(o."totalPrice"), 0) - COALESCE(SUM(r.refunded), 0), 0)::float8 AS revenue
    FROM "Order" o
    LEFT JOIN refunds r ON r."orderId" = o.id
    WHERE ${PLACED_ORDER_SQL}
    GROUP BY o."customerId"
  )`;

export interface CustomerListQuery {
  search?: string | null;
  sort?: CustomerSort;
  joinedFrom?: Date | null;
  joinedTo?: Date | null;
  limit: number;
  offset: number;
}

function whereClause(q: CustomerListQuery, params: unknown[]): string {
  const parts: string[] = [];
  if (q.search) {
    params.push(`%${q.search}%`);
    const p = `$${params.length}`;
    parts.push(`(c.name ILIKE ${p} OR c.email ILIKE ${p} OR c.phone ILIKE ${p} OR c."shopifyId" ILIKE ${p})`);
  }
  if (q.joinedFrom) {
    params.push(q.joinedFrom);
    parts.push(`c."createdAt" >= $${params.length}`);
  }
  if (q.joinedTo) {
    params.push(q.joinedTo);
    parts.push(`c."createdAt" <= $${params.length}`);
  }
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

/** One page of customer ids with their stats, plus the total matching the filters. */
export async function listCustomerStats(q: CustomerListQuery): Promise<{
  rows: Array<{ id: string; orders: number; revenue: number }>;
  total: number;
}> {
  const sort: CustomerSort = CUSTOMER_SORTS.includes(q.sort as CustomerSort) ? (q.sort as CustomerSort) : 'newest';
  const params: unknown[] = [];
  const where = whereClause(q, params);
  params.push(q.limit, q.offset);
  const rows: any[] = await prisma.$queryRawUnsafe(
    `${STATS_CTE}
     SELECT c.id, COALESCE(s.orders, 0)::int AS orders, COALESCE(s.revenue, 0)::float8 AS revenue
     FROM "Customer" c
     LEFT JOIN stats s ON s.cid = c.id
     ${where}
     ORDER BY ${ORDER_BY[sort]}, c.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    ...params
  );
  const countParams: unknown[] = [];
  const countWhere = whereClause(q, countParams);
  const counted: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS total FROM "Customer" c ${countWhere}`, ...countParams);
  return {
    rows: rows.map((r) => ({ id: String(r.id), orders: Number(r.orders) || 0, revenue: Math.round((Number(r.revenue) || 0) * 100) / 100 })),
    total: Number(counted[0]?.total) || 0,
  };
}

/** Parse the dashboard's date filter: `range=7d|30d` or `from` / `to` (YYYY-MM-DD, IST calendar days). */
export function resolveJoinedRange(params: URLSearchParams, now = new Date()): { from: Date | null; to: Date | null } {
  const range = params.get('range');
  if (range === '7d' || range === '30d') {
    const days = range === '7d' ? 7 : 30;
    return { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), to: null };
  }
  const day = (v: string | null, endOfDay: boolean) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    // Calendar day in India time (UTC+5:30).
    const d = new Date(`${v}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return { from: day(params.get('from'), false), to: day(params.get('to'), true) };
}

/** Order count + lifetime revenue of one customer (same rules as the list). */
export async function getCustomerStats(customerId: string): Promise<{ orders: number; revenue: number }> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `${STATS_CTE}
     SELECT COALESCE(s.orders, 0)::int AS orders, COALESCE(s.revenue, 0)::float8 AS revenue
     FROM (SELECT $1::text AS id) c LEFT JOIN stats s ON s.cid = c.id`,
    customerId
  );
  return { orders: Number(rows[0]?.orders) || 0, revenue: Math.round((Number(rows[0]?.revenue) || 0) * 100) / 100 };
}
