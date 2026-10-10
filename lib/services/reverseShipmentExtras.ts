/**
 * Attach live reverse-shipment fields (stage, location, ETA) onto admin list/detail rows.
 */
import {
  deriveReverseStage,
  findReverseShipment,
  matchesReverseStageFilter,
  REVERSE_STAGE_LABEL,
  type ReverseStage,
} from '@/lib/returnPolicy';
import { normalizeCarrierStatus, carrierStatusLabel } from '@/lib/logistics/status';

export type ShipmentLike = {
  awb?: string | null;
  trackingNumber?: string | null;
  status?: string | null;
  currentLocation?: string | null;
  estimatedDelivery?: Date | string | null;
  courier?: string | null;
  trackingUrl?: string | null;
  events?: string | null;
};

export function liveReverseFields(input: {
  requestStatus: string | null | undefined;
  receivedAt?: Date | string | null;
  reverseAwb?: string | null;
  shipments?: ShipmentLike[] | null;
}) {
  const ship = findReverseShipment(input.shipments, input.reverseAwb);
  const carrierStatus = ship?.status ? normalizeCarrierStatus(ship.status) : null;
  const liveStage: ReverseStage = deriveReverseStage({
    requestStatus: input.requestStatus,
    receivedAt: input.receivedAt,
    hasAwb: Boolean(input.reverseAwb),
    carrierStatus,
  });
  const pickupDone = ['picked_up', 'in_transit', 'out_for_delivery', 'delivered'].includes(
    String(carrierStatus || '')
  );
  return {
    liveStage,
    liveStageLabel: REVERSE_STAGE_LABEL[liveStage],
    carrierStatus,
    carrierStatusLabel: carrierStatus ? carrierStatusLabel(carrierStatus) : null,
    currentLocation: ship?.currentLocation || null,
    estimatedDelivery: ship?.estimatedDelivery
      ? ship.estimatedDelivery instanceof Date
        ? ship.estimatedDelivery.toISOString()
        : String(ship.estimatedDelivery)
      : null,
    pickupDone,
    trackingUrl:
      ship?.trackingUrl ||
      (input.reverseAwb ? `https://shiprocket.co/tracking/${input.reverseAwb}` : null),
    courier: ship?.courier || null,
  };
}

export function filterByLiveStage<T extends { liveStage?: ReverseStage; status?: string }>(
  rows: T[],
  filter: string | null | undefined
): T[] {
  const f = String(filter || 'all').toLowerCase();
  if (!f || f === 'all') return rows;
  // Terminal DB outcomes that aren't reverse stages
  if (f === 'refunded') return rows.filter((r) => String(r.status || '').toLowerCase() === 'refunded');
  if (f === 'rejected') {
    return rows.filter(
      (r) =>
        String(r.status || '').toLowerCase() === 'rejected' || r.liveStage === 'rejected'
    );
  }
  if (f === 'completed' || f === 'new_order_created') {
    return rows.filter((r) =>
      ['completed', 'new_order_created', 'refunded'].includes(String(r.status || '').toLowerCase())
    );
  }
  // Working-queue filters should not include terminal outcomes (those have their own chips).
  if (f === 'received') {
    return rows.filter(
      (r) =>
        r.liveStage &&
        matchesReverseStageFilter(r.liveStage, f) &&
        !['refunded', 'completed', 'new_order_created', 'rejected', 'cancelled'].includes(
          String(r.status || '').toLowerCase()
        )
    );
  }
  return rows.filter((r) => r.liveStage && matchesReverseStageFilter(r.liveStage, f));
}
