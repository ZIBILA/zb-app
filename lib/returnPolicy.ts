/**
 * Return / refund policy rules shared by the customer APIs, admin APIs and UIs.
 * Pure — safe to import from client components.
 */

export const COD_STORE_CREDIT_MESSAGE =
  'This was a COD order. As per our return policy, the refund for COD orders will be issued as Store Credit.';

export const REFUND_POLICY_HANDLE = 'refund-policy';
export const REFUND_POLICY_PATH = `/policies/${REFUND_POLICY_HANDLE}`;

type OrderPaymentLike = {
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  tags?: string | null;
  note?: string | null;
};

/**
 * Same COD detection used for courier booking (kept in lib/services/logistics.ts as
 * isShiprocketCodOrder). Duplicated here because that module is server-only.
 */
export function isCodOrder(order: OrderPaymentLike | null | undefined): boolean {
  if (!order) return false;
  const method = String(order.paymentMethod || '').toLowerCase().trim();
  const status = String(order.paymentStatus || '').toLowerCase().trim();
  const tags = String(order.tags || '').toLowerCase();
  const note = String(order.note || '').toLowerCase();
  return (
    method === 'cod' ||
    status === 'partially_paid' ||
    status === 'cod_upfront_paid' ||
    tags.includes('cod') ||
    note.includes('cod order') ||
    note.includes('upfront fee paid')
  );
}

/** COD orders can only be refunded as store credit; prepaid may choose either. */
export function allowedRefundMethods(order: OrderPaymentLike | null | undefined): Array<'store_credit' | 'original_method'> {
  return isCodOrder(order) ? ['store_credit'] : ['original_method', 'store_credit'];
}

/** Coerce whatever the client sent into a method permitted for this order. */
export function resolveRefundMethod(
  order: OrderPaymentLike | null | undefined,
  requested: string | null | undefined
): 'store_credit' | 'original_method' {
  if (isCodOrder(order)) return 'store_credit';
  const r = String(requested || '').toLowerCase();
  return r === 'store_credit' || r === 'storecredit' || r === 'store-credit' ? 'store_credit' : 'original_method';
}

// ─── Reverse (return / exchange pickup) stages ─────────────────────────────

export type ReverseStage =
  | 'awaiting_acceptance'
  | 'awaiting_partner'
  | 'pickup_scheduled'
  | 'in_transit'
  | 'awaiting_receipt'
  | 'pickup_failed'
  | 'received'
  | 'rejected'
  | 'cancelled';

export const REVERSE_STAGE_LABEL: Record<ReverseStage, string> = {
  awaiting_acceptance: 'Pending',
  awaiting_partner: 'Accepted – Pickup Pending',
  pickup_scheduled: 'Pickup Scheduled',
  in_transit: 'In Transit',
  awaiting_receipt: 'Delivered – Awaiting Warehouse Check',
  pickup_failed: 'Pickup Failed',
  received: 'Received',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/**
 * Derive the customer/admin visible pickup stage from the request row plus the
 * canonical carrier status of its reverse shipment (if any).
 */
export function deriveReverseStage(input: {
  requestStatus: string | null | undefined;
  receivedAt?: Date | string | null;
  hasAwb: boolean;
  carrierStatus?: string | null;
}): ReverseStage {
  const s = String(input.requestStatus || '').toLowerCase();
  if (s === 'rejected') return 'rejected';
  if (s === 'cancelled') return 'cancelled';
  if (input.receivedAt || ['received', 'qc_passed', 'refunded', 'new_order_created', 'completed', 'refund_pending'].includes(s)) {
    return 'received';
  }
  if (['pending_approval', 'submitted', 'pending'].includes(s)) return 'awaiting_acceptance';

  const c = String(input.carrierStatus || '').toLowerCase();
  if (['pickup_failed', 'undelivered', 'rto', 'rto_delivered', 'lost', 'cancelled'].includes(c)) return 'pickup_failed';
  if (c === 'delivered' || s === 'delivered_to_warehouse') return 'awaiting_receipt';
  if (['picked_up', 'in_transit', 'out_for_delivery'].includes(c)) return 'in_transit';
  if (s === 'in_transit') return 'in_transit';
  if (s === 'approved_pickup_failed') return 'pickup_failed';
  if (input.hasAwb) return 'pickup_scheduled';
  return 'awaiting_partner';
}

/** Admin list filter keys for live reverse logistics (Returns / Exchanges). */
export type ReverseStageFilter =
  | 'all'
  | 'pending'
  | 'pickup_scheduled'
  | 'in_transit'
  | 'failed'
  | 'received'
  | 'refunded'
  | 'rejected'
  | 'cancelled'
  | 'completed';

export const REVERSE_STAGE_FILTER_OPTIONS: ReadonlyArray<{ value: ReverseStageFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'pickup_scheduled', label: 'Pickup Scheduled' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'failed', label: 'Failed' },
  { value: 'received', label: 'Received' },
];

/** Stages that belong to each admin list filter chip. */
export const REVERSE_STAGE_FILTER_MAP: Record<
  Exclude<ReverseStageFilter, 'all' | 'refunded' | 'rejected' | 'cancelled' | 'completed'>,
  ReverseStage[]
> = {
  pending: ['awaiting_acceptance', 'awaiting_partner'],
  pickup_scheduled: ['pickup_scheduled'],
  in_transit: ['in_transit', 'awaiting_receipt'],
  failed: ['pickup_failed'],
  received: ['received'],
};

export function matchesReverseStageFilter(
  stage: ReverseStage,
  filter: string | null | undefined
): boolean {
  const f = String(filter || 'all').toLowerCase() as ReverseStageFilter;
  if (!f || f === 'all') return true;
  const mapped = REVERSE_STAGE_FILTER_MAP[f as keyof typeof REVERSE_STAGE_FILTER_MAP];
  if (mapped) return mapped.includes(stage);
  // Legacy DB-status filters still used for terminal outcomes.
  if (f === 'rejected') return stage === 'rejected';
  if (f === 'cancelled') return stage === 'cancelled';
  if (f === 'received') return stage === 'received';
  return true;
}

export function countByReverseStageFilter(
  stages: ReverseStage[]
): Record<'pending' | 'pickup_scheduled' | 'in_transit' | 'failed' | 'received', number> {
  const out = {
    pending: 0,
    pickup_scheduled: 0,
    in_transit: 0,
    failed: 0,
    received: 0,
  };
  for (const stage of stages) {
    if (REVERSE_STAGE_FILTER_MAP.pending.includes(stage)) out.pending += 1;
    else if (REVERSE_STAGE_FILTER_MAP.pickup_scheduled.includes(stage)) out.pickup_scheduled += 1;
    else if (REVERSE_STAGE_FILTER_MAP.in_transit.includes(stage)) out.in_transit += 1;
    else if (REVERSE_STAGE_FILTER_MAP.failed.includes(stage)) out.failed += 1;
    else if (REVERSE_STAGE_FILTER_MAP.received.includes(stage)) out.received += 1;
  }
  return out;
}

/** Find the reverse shipment row for a return/exchange AWB. */
export function findReverseShipment<
  T extends { awb?: string | null; trackingNumber?: string | null; status?: string | null }
>(shipments: T[] | null | undefined, reverseAwb: string | null | undefined): T | null {
  const awb = String(reverseAwb || '').trim();
  if (!awb || !shipments?.length) return null;
  return (
    shipments.find(
      (s) => String(s.awb || '').trim() === awb || String(s.trackingNumber || '').trim() === awb
    ) || null
  );
}
