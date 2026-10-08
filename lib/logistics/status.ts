/**
 * Canonical logistics status vocabulary (pure — safe for server and client).
 *
 * Carriers/aggregators (Shiprocket, Delhivery, …) all use different strings.
 * Everything that is persisted on `Shipment.status` / `Order.deliveryStatus`
 * goes through `normalizeCarrierStatus` so the admin filters, customer
 * tracking and webhooks agree on one vocabulary.
 */

export type CarrierStatus =
  | 'confirmed' // AWB assigned / label generated
  | 'pickup_scheduled'
  | 'pickup_failed'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'undelivered' // delivery attempt failed (NDR)
  | 'delivered'
  | 'rto' // RTO initiated / in transit back to seller
  | 'rto_delivered' // RTO shipment received back at origin
  | 'cancellation_requested' // Shiprocket accepted cancel; AWB void in progress
  | 'cancelled'
  | 'lost'
  | 'unknown';

/** Shiprocket numeric shipment_status ids (webhooks send these alongside text). */
const SHIPROCKET_STATUS_IDS: Record<string, CarrierStatus> = {
  '1': 'confirmed', // AWB Assigned
  '2': 'confirmed', // Label Generated
  '3': 'pickup_scheduled', // Pickup Scheduled / Generated
  '4': 'pickup_scheduled', // Pickup Queued
  '5': 'pickup_scheduled', // Manifest Generated
  '6': 'in_transit', // Shipped
  '7': 'delivered',
  '8': 'cancelled',
  '9': 'rto', // RTO Initiated
  '10': 'rto_delivered', // RTO Delivered
  '12': 'lost',
  '13': 'pickup_failed', // Pickup Error
  '14': 'rto_delivered', // RTO Acknowledged
  '15': 'pickup_scheduled', // Pickup Rescheduled
  '17': 'out_for_delivery',
  '18': 'in_transit',
  '19': 'pickup_scheduled', // Out For Pickup
  '20': 'pickup_failed', // Pickup Exception
  '21': 'undelivered',
  '22': 'in_transit', // Delayed
  '23': 'delivered', // Partial Delivered
  '24': 'lost', // Destroyed
  '25': 'lost', // Damaged
  '26': 'delivered', // Fulfilled
  '27': 'rto', // Reached back at seller city
  '38': 'in_transit', // Reached at destination hub
  '39': 'in_transit', // Misrouted
  '40': 'rto', // RTO NDR
  '41': 'rto', // RTO OFD
  '42': 'picked_up',
  '46': 'rto', // RTO In Transit
};

/**
 * Map any carrier status string (or Shiprocket numeric id) to our vocabulary.
 * Returns 'unknown' when the string is not understood so callers can ignore it
 * instead of overwriting a good status with garbage.
 */
export function normalizeCarrierStatus(raw: unknown): CarrierStatus {
  if (raw === null || raw === undefined) return 'unknown';
  const original = String(raw).trim();
  if (!original) return 'unknown';

  if (/^\d+$/.test(original)) {
    return SHIPROCKET_STATUS_IDS[original] ?? 'unknown';
  }

  const s = original.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s === 'unknown' || s === 'null' || s === 'undefined') return 'unknown';

  // Already canonical?
  const canonical = s.replace(/ /g, '_') as CarrierStatus;
  if (CANONICAL_SET.has(canonical)) return canonical;

  // Our own persisted Order.deliveryStatus value for an RTO that reached the warehouse.
  if (s === 'returned to origin') return 'rto_delivered';

  // RTO family first ("RTO Delivered" must not become "delivered").
  if (/\brto\b/.test(s) || s.includes('return to origin') || s.includes('returned to origin') || s.includes('return to seller')) {
    if (/(delivered|acknowledged|received|reached back|completed)/.test(s)) return 'rto_delivered';
    return 'rto';
  }
  if (s === 'returned' || s.includes('reached back at seller')) return 'rto';

  if (s.includes('cancel')) {
    // Shiprocket order status "Cancellation Requested" (filter id 18) vs final "Canceled".
    if (s.includes('request')) return 'cancellation_requested';
    return 'cancelled';
  }
  if (/\b(lost|destroyed|damaged|disposed)\b/.test(s)) return 'lost';

  if (s.includes('undelivered') || /\bndr\b/.test(s) || s.includes('delivery failed') || s.includes('attempt failed') || s.includes('not delivered') || s.includes('delivery attempted')) {
    return 'undelivered';
  }
  if (s.includes('out for delivery') || /\bofd\b/.test(s)) return 'out_for_delivery';
  if (/\bdelivered\b/.test(s) || s === 'fulfilled') return 'delivered';

  if (s.includes('pickup exception') || s.includes('pickup error') || s.includes('not picked') || s.includes('pickup failed')) {
    return 'pickup_failed';
  }
  if (s.includes('picked up') || s.includes('pickup done') || s.includes('pickup completed')) return 'picked_up';
  if (s.includes('out for pickup') || s.includes('pickup scheduled') || s.includes('pickup generated') || s.includes('pickup queued') || s.includes('pickup rescheduled') || s.includes('manifest generated') || s.includes('pickup requested') || s === 'pickup pending' || s === 'manifest required') {
    return 'pickup_scheduled';
  }

  if (s.includes('transit') || s === 'shipped' || s.includes('dispatched') || s.includes('reached') || s.includes('hub') || s.includes('in flight') || s.includes('handover') || s.includes('delayed') || s.includes('misrouted') || s === 'dispatch') {
    return 'in_transit';
  }

  if (s.includes('awb') || s.includes('label') || s === 'confirmed' || s === 'manifested' || s.includes('booked')) return 'confirmed';

  return 'unknown';
}

const CANONICAL_SET = new Set<string>([
  'confirmed',
  'pickup_scheduled',
  'pickup_failed',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'undelivered',
  'delivered',
  'rto',
  'rto_delivered',
  'cancellation_requested',
  'cancelled',
  'lost',
]);

/** Terminal statuses — nothing may overwrite these from a late/stale scan. */
const TERMINAL: ReadonlySet<CarrierStatus> = new Set<CarrierStatus>([
  'delivered',
  'rto_delivered',
  'cancelled',
  'lost',
]);

const RANK: Record<CarrierStatus, number> = {
  unknown: 0,
  confirmed: 1,
  pickup_failed: 1,
  pickup_scheduled: 2,
  picked_up: 3,
  in_transit: 4,
  out_for_delivery: 5,
  undelivered: 5,
  rto: 6,
  rto_delivered: 7,
  delivered: 8,
  lost: 8,
  cancellation_requested: 8,
  cancelled: 9,
};

/**
 * Whether a shipment currently at `current` may move to `next`.
 * Prevents out-of-order webhooks (e.g. a late "In Transit" after "Delivered").
 */
export function canAdvanceCarrierStatus(current: unknown, next: CarrierStatus): boolean {
  if (next === 'unknown') return false;
  const cur = normalizeCarrierStatus(current);
  if (cur === 'unknown') return true;
  if (cur === next) return true;
  // Cancellation Requested may only move to Cancelled (or stay).
  if (cur === 'cancellation_requested') {
    return next === 'cancelled';
  }
  // Allow correcting an overshoot: we used to mark Cancelled while SR was still
  // Cancellation Requested — let sync/webhooks pull the true intermediate state back.
  if (cur === 'cancelled' && next === 'cancellation_requested') {
    return true;
  }
  if (TERMINAL.has(cur)) return false;
  if (next === 'cancelled' || next === 'cancellation_requested' || next === 'lost' || next === 'rto') {
    return true;
  }
  return RANK[next] >= RANK[cur];
}

/** Value written to `Order.deliveryStatus` for a given carrier status. */
export function toOrderDeliveryStatus(status: CarrierStatus): string | null {
  switch (status) {
    case 'confirmed':
    case 'pickup_failed':
      return 'confirmed';
    case 'pickup_scheduled':
      return 'pickup_scheduled';
    case 'picked_up':
    case 'in_transit':
      return 'shipped';
    case 'out_for_delivery':
      return 'out_for_delivery';
    case 'undelivered':
      return 'undelivered';
    case 'delivered':
      return 'delivered';
    case 'rto':
      return 'rto';
    case 'rto_delivered':
      return 'returned_to_origin';
    case 'cancellation_requested':
      return 'cancellation_requested';
    case 'cancelled':
      return 'cancelled';
    case 'lost':
      return 'lost';
    default:
      return null;
  }
}

const CARRIER_STATUS_LABELS: Record<CarrierStatus, string> = {
  confirmed: 'Shipment Booked',
  pickup_scheduled: 'Pickup Scheduled',
  pickup_failed: 'Pickup Failed',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  undelivered: 'Delivery Attempt Failed',
  delivered: 'Delivered',
  rto: 'RTO In Progress',
  rto_delivered: 'RTO Received',
  cancellation_requested: 'Cancellation Requested',
  cancelled: 'Cancelled',
  lost: 'Lost / Damaged',
  unknown: 'Processing',
};

export function carrierStatusLabel(status: unknown): string {
  const s = typeof status === 'string' && CANONICAL_SET.has(status) ? (status as CarrierStatus) : normalizeCarrierStatus(status);
  return CARRIER_STATUS_LABELS[s];
}

/**
 * Delhivery reports the movement state in `Status` and the lane in `StatusType`
 * (DL delivered, RT return-to-origin, UD undelivered, …). Fold both into one
 * string our normalizer understands.
 */
export function delhiveryRawStatus(status: unknown, statusType: unknown): string {
  const st = String(status || '').trim();
  const type = String(statusType || '').trim().toUpperCase();
  if (!st) return '';
  if (/\brto\b/i.test(st)) return type === 'DL' && !/deliver/i.test(st) ? 'RTO Delivered' : st;
  if (type === 'RT') return `RTO ${st}`;
  return st;
}

export function isRtoCarrierStatus(status: unknown): boolean {
  const s = typeof status === 'string' && CANONICAL_SET.has(status) ? (status as CarrierStatus) : normalizeCarrierStatus(status);
  return s === 'rto' || s === 'rto_delivered';
}

// ─── Admin "Logistics" filter buckets ───────────────────────────────

export type LogisticsFilter =
  | 'any'
  | 'pending'
  | 'dispatched'
  | 'delivered'
  | 'rto'
  | 'returned'
  | 'exchanged';

export const LOGISTICS_FILTER_OPTIONS: ReadonlyArray<{ value: LogisticsFilter; label: string }> = [
  { value: 'any', label: 'Logistics: All' },
  { value: 'pending', label: 'Pending' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'rto', label: 'RTO' },
  { value: 'returned', label: 'Returned' },
  { value: 'exchanged', label: 'Exchanged' },
];

/**
 * `Order.deliveryStatus` values per bucket. Includes legacy strings written by
 * older webhook code (raw carrier text lower-cased) so historic rows still match.
 */
export const LOGISTICS_BUCKET_STATUSES: Record<'pending' | 'dispatched' | 'delivered' | 'rto', string[]> = {
  pending: [
    'pending',
    'processing',
    'confirmed',
    'pickup_scheduled',
    'packed',
    'manifested',
    'new',
  ],
  dispatched: [
    'shipped',
    'in_transit',
    'in transit',
    'picked_up',
    'dispatched',
    'out_for_delivery',
    'out for delivery',
    'undelivered',
    'failed',
  ],
  delivered: ['delivered'],
  rto: [
    'rto',
    'rto_initiated',
    'rto_in_transit',
    'rto_delivered',
    'returned_to_origin',
    'rto initiated',
    'rto in transit',
    'rto delivered',
  ],
};

export function isLogisticsFilter(value: unknown): value is LogisticsFilter {
  return LOGISTICS_FILTER_OPTIONS.some((o) => o.value === value);
}

// ─── Tags ───────────────────────────────────────────────────────────

/** Add a tag to a comma-separated tag string (idempotent, case-insensitive). */
export function addTag(tags: string | null | undefined, tag: string): string {
  const list = String(tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (!list.some((t) => t.toLowerCase() === tag.toLowerCase())) list.push(tag);
  return list.join(', ');
}

export function hasTag(tags: string | null | undefined, tag: string): boolean {
  return String(tags || '')
    .split(',')
    .some((t) => t.trim().toLowerCase() === tag.toLowerCase());
}

// ─── Shipment selection ─────────────────────────────────────────────

export const REVERSE_SHIPMENT_TYPES = ['reverse_pickup', 'reverse', 'return', 'exchange_pickup'] as const;

export function isReverseShipmentType(type: string | null | undefined): boolean {
  return (REVERSE_SHIPMENT_TYPES as readonly string[]).includes(String(type || '').toLowerCase());
}

type ShipmentLike = {
  type?: string | null;
  status?: string | null;
  awb?: string | null;
  trackingNumber?: string | null;
  rawDelhiveryResponse?: string | null;
  createdAt?: Date | string | null;
};

function createdMs(s: ShipmentLike): number {
  const t = s.createdAt ? new Date(s.createdAt).getTime() : 0;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * The shipment that represents an order's forward delivery: newest outbound,
 * non-cancelled shipment (preferring one that already has an AWB).
 * Reverse (return/exchange pickup) and cancelled shipments are never chosen.
 */
function isFullyCancelledOutboundStatus(status: unknown): boolean {
  return normalizeCarrierStatus(status) === 'cancelled';
}

export function pickActiveOutboundShipment<T extends ShipmentLike>(shipments: T[] | null | undefined): T | null {
  // Keep Cancellation Requested visible (AWB still exists on Shiprocket).
  // Only drop fully Cancelled rows from the live booking panel.
  const active = (shipments || [])
    .filter((s) => !isReverseShipmentType(s.type) && !isFullyCancelledOutboundStatus(s.status))
    .sort((a, b) => createdMs(b) - createdMs(a));
  // A parcel that already came back (RTO) or was lost is superseded by any newer booking.
  const live = active.filter((s) => {
    const code = normalizeCarrierStatus(s.status);
    return code !== 'rto' && code !== 'rto_delivered' && code !== 'lost';
  });
  const pool = live.length > 0 ? live : active;
  return pool.find((s) => s.awb) || pool[0] || null;
}

/**
 * The real AWB of a shipment. Aggregator (Shiprocket) bookings keep the
 * aggregator's order id in `trackingNumber` until an AWB is assigned, so that
 * value must never be shown as an AWB.
 */
export function shipmentAwb(s: ShipmentLike | null | undefined): string | null {
  if (!s) return null;
  if (s.awb && String(s.awb).trim()) return String(s.awb).trim();
  const raw = s.rawDelhiveryResponse;
  if (raw && /"provider"\s*:\s*"shiprocket"/.test(raw)) return null;
  return s.trackingNumber && String(s.trackingNumber).trim() ? String(s.trackingNumber).trim() : null;
}
