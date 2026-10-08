/**
 * Single place that applies a carrier status update to a Shipment and its Order.
 *
 * Used by the logistics webhook, the tracking/sync routes and the Delhivery
 * tracking helper so every path produces the same state:
 *   - Shipment.status           canonical carrier status (see lib/logistics/status.ts)
 *   - Order.deliveryStatus      what the admin Logistics filter and customer UI read
 *   - Order "RTO" tag           added automatically when an RTO shipment is detected
 *   - COD payment settlement    COD (upfront) orders become Paid/Settled on delivery
 */

import prisma from '@/lib/db';
import type { Prisma } from '@prisma/client';
import {
  addTag,
  canAdvanceCarrierStatus,
  isRtoCarrierStatus,
  normalizeCarrierStatus,
  toOrderDeliveryStatus,
  type CarrierStatus,
} from '@/lib/logistics/status';
import {
  getTrackingStatus,
  isShiprocketCodOrder,
  parseShiprocketMeta,
  type TrackingStatus,
} from '@/lib/services/logistics';
import { isReverseShipmentType, REVERSE_SHIPMENT_TYPES } from '@/lib/logistics/status';

export interface ShipmentScanEvent {
  status: string;
  location?: string | null;
  timestamp?: string | null;
  description?: string | null;
}

export interface ShipmentStatusUpdate {
  shipmentId: string;
  rawStatus: string;
  location?: string | null;
  estimatedDelivery?: string | Date | null;
  /** Timestamp of this status (for the event log). */
  timestamp?: string | null;
  description?: string | null;
  /** Full scan history from the carrier (merged into stored events). */
  events?: ShipmentScanEvent[];
  trackingUrl?: string | null;
}

export interface ShipmentStatusResult {
  found: boolean;
  applied: boolean;
  previous: CarrierStatus;
  status: CarrierStatus;
  orderId: string | null;
  isReverse: boolean;
  enteredRto: boolean;
  deliveredNow: boolean;
}

const MAX_EVENTS = 200;
export { isReverseShipmentType };

function parseEvents(raw: string | null | undefined): ShipmentScanEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function eventKey(e: ShipmentScanEvent): string {
  return `${String(e.timestamp || '').trim()}|${String(e.status || '').trim().toLowerCase()}|${String(e.location || '').trim().toLowerCase()}`;
}

export function mergeScanEvents(
  existing: ShipmentScanEvent[],
  incoming: ShipmentScanEvent[]
): ShipmentScanEvent[] {
  const seen = new Set(existing.map(eventKey));
  const merged = [...existing];
  for (const e of incoming) {
    if (!e || !e.status) continue;
    const key = eventKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      status: e.status,
      location: e.location || '',
      timestamp: e.timestamp || '',
      description: e.description || e.status,
    });
  }
  return merged.slice(-MAX_EVENTS);
}

function toValidDate(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function applyShipmentStatusUpdate(
  update: ShipmentStatusUpdate
): Promise<ShipmentStatusResult> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: update.shipmentId },
    include: {
      order: {
        select: {
          id: true,
          tags: true,
          paymentMethod: true,
          paymentStatus: true,
          note: true,
          deliveryStatus: true,
          deliveredAt: true,
          internalOrderNumber: true,
          razorpayOrderId: true,
          shopifyOrderId: true,
        },
      },
    },
  });

  const empty: ShipmentStatusResult = {
    found: false,
    applied: false,
    previous: 'unknown',
    status: 'unknown',
    orderId: null,
    isReverse: false,
    enteredRto: false,
    deliveredNow: false,
  };
  if (!shipment) return empty;

  const isReverse = isReverseShipmentType(shipment.type);
  const previous = normalizeCarrierStatus(shipment.status);
  const next = normalizeCarrierStatus(update.rawStatus);

  // Always keep the scan log current, even if the status itself is not applied.
  const existingEvents = parseEvents(shipment.events);
  const incomingEvents: ShipmentScanEvent[] = [...(update.events || [])];
  // Webhooks deliver a single status; a full carrier scan list already contains it.
  if (update.rawStatus && incomingEvents.length === 0) {
    const last = existingEvents[existingEvents.length - 1];
    const repeatsLast =
      !update.timestamp &&
      last &&
      String(last.status || '').trim().toLowerCase() === update.rawStatus.trim().toLowerCase();
    if (!repeatsLast) {
      incomingEvents.push({
        status: update.rawStatus,
        location: update.location || '',
        timestamp: update.timestamp || new Date().toISOString(),
        description: update.description || update.rawStatus,
      });
    }
  }
  const events = mergeScanEvents(existingEvents, incomingEvents);
  const eta = toValidDate(update.estimatedDelivery);

  const base: ShipmentStatusResult = {
    ...empty,
    found: true,
    previous,
    status: previous,
    orderId: shipment.orderId,
    isReverse,
  };

  if (!canAdvanceCarrierStatus(shipment.status, next)) {
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        events: JSON.stringify(events),
        ...(update.location ? { currentLocation: update.location } : {}),
        ...(eta ? { estimatedDelivery: eta } : {}),
      },
    });
    return base;
  }

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      status: next,
      events: JSON.stringify(events),
      ...(update.location ? { currentLocation: update.location } : {}),
      ...(eta ? { estimatedDelivery: eta } : {}),
      ...(update.trackingUrl ? { trackingUrl: update.trackingUrl } : {}),
    },
  });

  const enteredRto = isRtoCarrierStatus(next) && !isRtoCarrierStatus(previous);
  const deliveredNow = next === 'delivered' && previous !== 'delivered';
  const result: ShipmentStatusResult = {
    ...base,
    applied: true,
    status: next,
    enteredRto,
    deliveredNow,
  };

  // Reverse (return/exchange pickup) shipments never touch the original order's
  // delivery status — the return/exchange state machine consumes the result.
  if (isReverse) {
    // Return/exchange request state machine (matched by the request's own reverse AWB)
    const { syncRequestsFromReverseShipment } = await import('@/lib/services/reverseStatusService');
    await syncRequestsFromReverseShipment(shipment.awb || shipment.trackingNumber, next).catch((err) =>
      console.error('[ShipmentStatus] reverse request sync failed:', err?.message || err)
    );
    return result;
  }
  if (!shipment.order) return result;

  // A stale/cancelled earlier shipment must not rewrite the order once a newer
  // active shipment exists (e.g. after cancel + re-ship on another courier).
  if (next !== 'cancelled') {
    const newerActive = await prisma.shipment.findFirst({
      where: {
        orderId: shipment.orderId,
        id: { not: shipment.id },
        createdAt: { gt: shipment.createdAt },
        status: { notIn: ['cancelled', 'canceled'] },
        NOT: { type: { in: [...REVERSE_SHIPMENT_TYPES] } },
      },
      select: { id: true },
    });
    if (newerActive) return result;
  } else {
    const otherActive = await prisma.shipment.findFirst({
      where: {
        orderId: shipment.orderId,
        id: { not: shipment.id },
        status: { notIn: ['cancelled', 'canceled'] },
        NOT: { type: { in: [...REVERSE_SHIPMENT_TYPES] } },
      },
      select: { id: true },
    });
    if (otherActive) return result;
  }

  const order = shipment.order;
  const deliveryStatus = toOrderDeliveryStatus(next);
  const orderData: Prisma.OrderUpdateInput = {
    tracking_status: update.rawStatus,
  };
  if (deliveryStatus) orderData.deliveryStatus = deliveryStatus;

  if (isRtoCarrierStatus(next)) {
    orderData.tags = addTag(order.tags, 'RTO');
  }

  let settleCod = false;
  if (next === 'delivered') {
    if (!order.deliveredAt) orderData.deliveredAt = new Date();
    const payStatus = String(order.paymentStatus || '').toLowerCase();
    const isCod = isShiprocketCodOrder({
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      tags: order.tags,
      note: order.note,
    });
    if (isCod && !['paid', 'refunded', 'partially_refunded', 'failed', 'payment_failed', 'cancelled'].includes(payStatus)) {
      // Courier collected the balance on delivery → fully settled.
      settleCod = true;
      orderData.paymentStatus = 'paid';
      orderData.paymentCapturedAt = new Date();
    } else if (isCod && payStatus === 'paid') {
      // Order.paymentStatus may already read "paid" for COD-upfront orders; keep.
      settleCod = true;
    }
  }

  await prisma.order.update({ where: { id: order.id }, data: orderData });

  const wsWhere: Array<Record<string, string>> = [];
  if (order.internalOrderNumber) wsWhere.push({ orderNumber: order.internalOrderNumber });
  if (order.razorpayOrderId) wsWhere.push({ razorpayOrderId: order.razorpayOrderId });
  if (order.shopifyOrderId) wsWhere.push({ shopifyOrderId: order.shopifyOrderId });
  if (wsWhere.length > 0 && deliveryStatus) {
    await prisma.webStoreOrder
      .updateMany({
        where: { OR: wsWhere },
        data: {
          deliveryStatus,
          ...(settleCod ? { paymentStatus: 'paid' } : {}),
        },
      })
      .catch((err: unknown) => {
        console.warn('[ShipmentStatus] WebStoreOrder sync skipped:', err instanceof Error ? err.message : err);
      });
  }

  if (enteredRto) {
    try {
      const { restoreOrderSkus } = await import('@/lib/services/skuService');
      const restored = await restoreOrderSkus(order.id, 'RTO_RESTORE', 'System (RTO)');
      if (restored > 0) {
        console.log(`[ShipmentStatus] Restored ${restored} SKU(s) for RTO order ${order.id}`);
      }
      const { reverseReferral } = await import('@/lib/affiliate/earnings');
      await reverseReferral(order.id, 'logistics_rto');
    } catch (err) {
      console.error('[ShipmentStatus] SKU restore / affiliate reversal on RTO failed:', err);
    }
  }

  return result;
}

// ─── Provider resolution & live refresh ─────────────────────────────

export type ShipmentProvider = 'shiprocket';

/**
 * All live bookings go through Shiprocket. Historical rows may still say "Delhivery"
 * as the courier name (Shiprocket last-mile), but tracking is always via Shiprocket.
 */
export async function resolveShipmentProvider(_shipment: {
  rawDelhiveryResponse?: string | null;
  courier?: string | null;
}): Promise<ShipmentProvider> {
  return 'shiprocket';
}

/**
 * Pull the carrier's latest tracking for a shipment and apply it.
 * Never throws — carrier outages leave the stored state untouched.
 */
export async function refreshShipmentFromCarrier(shipmentId: string): Promise<{
  provider: ShipmentProvider | null;
  tracking: TrackingStatus | null;
  result: ShipmentStatusResult | null;
}> {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) return { provider: null, tracking: null, result: null };

  const ref = shipment.awb || shipment.trackingNumber;
  if (!ref) return { provider: null, tracking: null, result: null };

  // A Shiprocket booking without an AWB only has a Shiprocket order id — not trackable.
  if (!shipment.awb && parseShiprocketMeta(shipment.rawDelhiveryResponse)) {
    return { provider: 'shiprocket', tracking: null, result: null };
  }

  try {
    const provider = await resolveShipmentProvider(shipment);
    const tracking = await getTrackingStatus(ref);
    if (!tracking || tracking.status === 'unknown') {
      return { provider, tracking, result: null };
    }

    const result = await applyShipmentStatusUpdate({
      shipmentId: shipment.id,
      rawStatus: tracking.rawStatus || tracking.status,
      location: tracking.location,
      estimatedDelivery: tracking.estimatedDelivery,
      events: tracking.events,
      trackingUrl: tracking.trackingUrl,
    });
    return { provider, tracking, result };
  } catch (err) {
    console.warn(
      `[ShipmentStatus] Carrier refresh failed for shipment ${shipmentId}:`,
      err instanceof Error ? err.message : err
    );
    return { provider: null, tracking: null, result: null };
  }
}
