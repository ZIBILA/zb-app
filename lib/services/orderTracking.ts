/**
 * Provider-aware tracking for a single order.
 *
 * The AWB of an order can live on `Shipment.awb` (Shiprocket / any aggregator),
 * `Shipment.trackingNumber` (direct Delhivery) or the legacy `Order.delhivery_awb`.
 * This module resolves the right one and returns one tracking payload shape for
 * the customer web app, the mobile app and the admin UI.
 */

import prisma from '@/lib/db';
import type { Shipment } from '@prisma/client';
import {
  carrierStatusLabel,
  isReverseShipmentType,
  normalizeCarrierStatus,
  pickActiveOutboundShipment,
  REVERSE_SHIPMENT_TYPES,
} from '@/lib/logistics/status';
import { parseShiprocketMeta } from '@/lib/services/logistics';
import {
  refreshShipmentFromCarrier,
  resolveShipmentProvider,
  type ShipmentProvider,
  type ShipmentScanEvent,
} from '@/lib/services/shipmentStatusService';

/** Do not hit the carrier more often than this for the same shipment. */
const LIVE_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const TERMINAL_STATUSES = new Set(['delivered', 'rto_delivered', 'cancelled', 'lost']);

export interface ResolvedOutboundShipment {
  shipmentId: string | null;
  awb: string | null;
  courier: string | null;
  provider: ShipmentProvider | null;
  status: string;
  trackingUrl: string | null;
  labelUrl: string | null;
  /** Booked with the aggregator but AWB not yet assigned. */
  awbPending: boolean;
  source: 'shipment' | 'order' | 'none';
}

export interface OrderTrackingEvent {
  status: string;
  dateTime: string;
  location: string;
  instructions: string;
}

export interface OrderTrackingResult {
  awb: string | null;
  courier: string | null;
  provider: ShipmentProvider | null;
  awbPending: boolean;
  /** Human label (e.g. "In Transit"). */
  currentStatus: string | null;
  /** Canonical code (e.g. in_transit). */
  statusCode: string | null;
  statusDateTime: string | null;
  location: string | null;
  estimatedDelivery: string | null;
  trackingUrl: string | null;
  timeline: OrderTrackingEvent[];
}

function emptyTracking(extra: Partial<OrderTrackingResult> = {}): OrderTrackingResult {
  return {
    awb: null,
    courier: null,
    provider: null,
    awbPending: false,
    currentStatus: null,
    statusCode: null,
    statusDateTime: null,
    location: null,
    estimatedDelivery: null,
    trackingUrl: null,
    timeline: [],
    ...extra,
  };
}

/**
 * The shipment that currently represents the order's forward delivery:
 * newest non-cancelled outbound shipment, preferring one that already has an AWB.
 */
export async function resolveOutboundShipment(
  orderId: string,
  legacyAwb?: string | null
): Promise<ResolvedOutboundShipment> {
  const rows: Shipment[] = await prisma.shipment.findMany({
    where: { orderId, NOT: { type: { in: [...REVERSE_SHIPMENT_TYPES] } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const chosen = pickActiveOutboundShipment(rows);

  if (chosen) {
    const isAggregatorBooking = Boolean(parseShiprocketMeta(chosen.rawDelhiveryResponse));
    // For aggregator bookings trackingNumber may just be the aggregator's order id.
    const awb = chosen.awb || (isAggregatorBooking ? null : chosen.trackingNumber) || null;
    const provider = await resolveShipmentProvider(chosen);
    return {
      shipmentId: chosen.id,
      awb,
      courier: chosen.courier || null,
      provider,
      status: chosen.status,
      trackingUrl: chosen.trackingUrl || null,
      labelUrl: chosen.labelUrl || null,
      awbPending: !awb,
      source: 'shipment',
    };
  }

  // Every shipment was cancelled → no active AWB (do not fall back to a voided one).
  if (rows.length > 0) {
    return {
      shipmentId: null,
      awb: null,
      courier: null,
      provider: null,
      status: 'cancelled',
      trackingUrl: null,
      labelUrl: null,
      awbPending: false,
      source: 'none',
    };
  }

  const awb = legacyAwb ? String(legacyAwb).trim() : '';
  if (awb) {
    return {
      shipmentId: null,
      awb,
      courier: 'Delhivery',
      provider: 'delhivery',
      status: 'confirmed',
      trackingUrl: `https://www.delhivery.com/track/package/${awb}`,
      labelUrl: null,
      awbPending: false,
      source: 'order',
    };
  }

  return {
    shipmentId: null,
    awb: null,
    courier: null,
    provider: null,
    status: 'pending',
    trackingUrl: null,
    labelUrl: null,
    awbPending: false,
    source: 'none',
  };
}

function parseEvents(raw: string | null | undefined): ShipmentScanEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function eventTime(e: OrderTrackingEvent): number {
  const t = new Date(e.dateTime).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function buildTimeline(events: ShipmentScanEvent[]): OrderTrackingEvent[] {
  return events
    .map((e, idx) => ({
      idx,
      item: {
        status: String(e.status || ''),
        dateTime: String(e.timestamp || ''),
        location: String(e.location || ''),
        instructions: String(e.description || ''),
      } as OrderTrackingEvent,
    }))
    .sort((a, b) => {
      const diff = eventTime(b.item) - eventTime(a.item);
      // Equal/unknown timestamps keep newest-appended first.
      return diff !== 0 ? diff : b.idx - a.idx;
    })
    .map((x) => x.item);
}

/** Full tracking for an order (customer / app / admin). */
export async function getOrderTracking(order: {
  id: string;
  delhivery_awb?: string | null;
  tracking_status?: string | null;
  createdAt?: Date;
}): Promise<OrderTrackingResult> {
  const resolved = await resolveOutboundShipment(order.id, order.delhivery_awb);

  if (!resolved.awb) {
    return emptyTracking({
      courier: resolved.courier,
      provider: resolved.provider,
      awbPending: resolved.awbPending,
      currentStatus: resolved.awbPending ? 'Shipment Booked – AWB being assigned' : null,
      statusCode: resolved.awbPending ? 'confirmed' : resolved.status === 'cancelled' ? 'cancelled' : null,
    });
  }

  // Legacy Delhivery-only order with no Shipment row: query Delhivery directly.
  if (!resolved.shipmentId) {
    const { trackShipment } = await import('@/lib/delhivery/api');
    const data = await trackShipment(resolved.awb);
    const pkg = data?.ShipmentData?.[0]?.Shipment;
    if (!pkg) {
      return emptyTracking({
        awb: resolved.awb,
        courier: resolved.courier,
        provider: 'delhivery',
        currentStatus: order.tracking_status || 'Manifested',
        statusCode: 'confirmed',
        statusDateTime: order.createdAt ? order.createdAt.toISOString() : null,
        location: 'Warehouse',
        trackingUrl: resolved.trackingUrl,
      });
    }
    const timeline = buildTimeline(
      (pkg.Scans || []).map((sc: any) => ({
        status: sc.ScanDetail?.Scan || '',
        location: sc.ScanDetail?.ScannedLocation || '',
        timestamp: sc.ScanDetail?.ScanDateTime || '',
        description: sc.ScanDetail?.Instructions || '',
      }))
    );
    const raw = pkg.Status?.Status || 'Manifested';
    return emptyTracking({
      awb: resolved.awb,
      courier: resolved.courier,
      provider: 'delhivery',
      currentStatus: raw,
      statusCode: normalizeCarrierStatus(raw),
      statusDateTime: pkg.Status?.StatusDateTime || null,
      location: pkg.Status?.StatusLocation || null,
      estimatedDelivery: pkg.ExpectedDeliveryDate || null,
      trackingUrl: resolved.trackingUrl,
      timeline,
    });
  }

  // Shipment-backed order: refresh from the carrier (throttled), then read our DB.
  let shipment = await prisma.shipment.findUnique({ where: { id: resolved.shipmentId } });
  if (shipment) {
    const stale = Date.now() - shipment.updatedAt.getTime() > LIVE_REFRESH_INTERVAL_MS;
    if (stale && !TERMINAL_STATUSES.has(normalizeCarrierStatus(shipment.status))) {
      await refreshShipmentFromCarrier(shipment.id);
      shipment = (await prisma.shipment.findUnique({ where: { id: resolved.shipmentId } })) || shipment;
    }
  }
  if (!shipment || isReverseShipmentType(shipment.type)) {
    return emptyTracking({ awb: resolved.awb, courier: resolved.courier, provider: resolved.provider });
  }

  const timeline = buildTimeline(parseEvents(shipment.events));
  const code = normalizeCarrierStatus(shipment.status);
  const latest = timeline[0];

  return emptyTracking({
    awb: resolved.awb,
    courier: shipment.courier || resolved.courier,
    provider: resolved.provider,
    currentStatus: code === 'unknown' ? latest?.status || order.tracking_status || 'Processing' : carrierStatusLabel(code),
    statusCode: code === 'unknown' ? null : code,
    statusDateTime: latest?.dateTime || shipment.updatedAt.toISOString(),
    location: shipment.currentLocation || latest?.location || null,
    estimatedDelivery: shipment.estimatedDelivery ? shipment.estimatedDelivery.toISOString() : null,
    trackingUrl:
      shipment.trackingUrl ||
      (resolved.provider === 'delhivery'
        ? `https://www.delhivery.com/track/package/${resolved.awb}`
        : `https://shiprocket.co/tracking/${resolved.awb}`),
    timeline,
  });
}
