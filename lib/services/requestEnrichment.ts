import prisma from '@/lib/db';
import { summarizeRequest, type RequestSummary } from '@/lib/services/requestSummary';

/**
 * Attaches the shared customer-facing `summary` (id, pickup, received, refund / store credit,
 * replacement) to every return / exchange request of the given orders. Used by the mobile
 * app APIs so the apps show exactly what the website shows.
 *
 * The internal return that the system auto-creates for an exchange (reason contains
 * EXCHANGE_RETURN) is never summarised — customers only ever see the exchange itself.
 */

export function isInternalExchangeReturn(r: { reason?: string | null }): boolean {
  return !!r.reason && r.reason.includes('EXCHANGE_RETURN');
}

type OrderWithRequests = {
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  tags?: string | null;
  note?: string | null;
  shipments?: any[] | null;
  returnRequests?: any[] | null;
  exchangeRequests?: any[] | null;
};

async function loadReplacementOrders(orders: OrderWithRequests[]): Promise<Map<string, any>> {
  const ids = Array.from(
    new Set(
      orders.flatMap((o) => (o.exchangeRequests || []).map((e: any) => e.replacementOrderId).filter(Boolean))
    )
  ) as string[];
  if (ids.length === 0) return new Map();
  const rows = await prisma.order.findMany({
    where: { id: { in: ids } },
    select: { id: true, internalOrderNumber: true, status: true, deliveryStatus: true, shipments: true },
  });
  return new Map<string, any>(rows.map((r: any) => [r.id, r]));
}

export interface OrderRequestSummaries {
  returnSummaries: Map<string, RequestSummary>;
  exchangeSummaries: Map<string, RequestSummary>;
}

/** Builds request-id → summary lookups for every order passed in. */
export async function buildRequestSummaries(orders: OrderWithRequests[]): Promise<OrderRequestSummaries> {
  const replacementById = await loadReplacementOrders(orders);
  const returnSummaries = new Map<string, RequestSummary>();
  const exchangeSummaries = new Map<string, RequestSummary>();

  for (const order of orders) {
    const shipments = (order.shipments || []) as any[];
    for (const r of order.returnRequests || []) {
      if (isInternalExchangeReturn(r)) continue;
      returnSummaries.set(r.id, summarizeRequest({ kind: 'return', request: r, order, shipments }));
    }
    for (const e of order.exchangeRequests || []) {
      exchangeSummaries.set(
        e.id,
        summarizeRequest({
          kind: 'exchange',
          request: e,
          order,
          shipments,
          replacementOrder: e.replacementOrderId ? replacementById.get(e.replacementOrderId) || null : null,
        })
      );
    }
  }

  return { returnSummaries, exchangeSummaries };
}
