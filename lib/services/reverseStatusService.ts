import prisma from '@/lib/db';
import type { CarrierStatus } from '@/lib/logistics/status';

/**
 * Drives ReturnRequest / ExchangeRequest.status from carrier events of their reverse pickup.
 *
 *   approved ──picked up / in transit──▶ in_transit ──delivered at warehouse──▶ delivered_to_warehouse
 *      │                                     │
 *      └──── pickup failed / cancelled / lost / RTO ───▶ approved_pickup_failed   (ops re-selects a partner)
 *
 * "received" is deliberately NOT set here: it requires the warehouse team to physically
 * confirm the parcel (POST receive / PATCH received), which also gates the refund.
 * Matching is by the request's own reverse AWB only — never by order id — so a second
 * request on the same order can't be advanced by another request's parcel.
 */

const PRE_PICKUP = ['approved', 'approved_pickup_failed'];
const MOVING = ['approved', 'approved_pickup_failed', 'in_transit'];

function nextStatus(current: string, carrier: CarrierStatus): string | null {
  const c = String(current || '').toLowerCase();
  switch (carrier) {
    case 'picked_up':
    case 'in_transit':
    case 'out_for_delivery':
      return PRE_PICKUP.includes(c) ? 'in_transit' : null;
    case 'delivered':
      return MOVING.includes(c) ? 'delivered_to_warehouse' : null;
    case 'pickup_failed':
    case 'undelivered':
    case 'cancelled':
    case 'lost':
    case 'rto':
    case 'rto_delivered':
      return ['approved', 'in_transit'].includes(c) ? 'approved_pickup_failed' : null;
    default:
      return null;
  }
}

export interface ReverseSyncResult {
  returnRequestId: string | null;
  exchangeRequestId: string | null;
  status: string | null;
}

export async function syncRequestsFromReverseShipment(
  awb: string | null | undefined,
  carrier: CarrierStatus
): Promise<ReverseSyncResult> {
  const out: ReverseSyncResult = { returnRequestId: null, exchangeRequestId: null, status: null };
  const code = String(awb || '').trim();
  if (!code) return out;

  const exchange = await prisma.exchangeRequest.findFirst({ where: { reverseAwb: code } });
  if (exchange) {
    const next = nextStatus(exchange.status, carrier);
    out.exchangeRequestId = exchange.id;
    if (next) {
      await prisma.exchangeRequest.update({ where: { id: exchange.id }, data: { status: next } });
      out.status = next;
      // Keep the internal return that mirrors the exchange pickup in step
      if (exchange.returnRequestId) {
        await prisma.returnRequest
          .updateMany({
            where: { id: exchange.returnRequestId, status: { in: MOVING } },
            data: { status: next },
          })
          .catch(() => {});
      }
    }
  }

  const ret = await prisma.returnRequest.findFirst({ where: { reverseAwb: code } });
  if (ret) {
    const next = nextStatus(ret.status, carrier);
    out.returnRequestId = ret.id;
    if (next) {
      await prisma.returnRequest.update({ where: { id: ret.id }, data: { status: next } });
      out.status = next;
    }
  }

  return out;
}
