import {
  COD_STORE_CREDIT_MESSAGE,
  deriveReverseStage,
  isCodOrder,
  REVERSE_STAGE_LABEL,
  type ReverseStage,
} from '@/lib/returnPolicy';
import { carrierStatusLabel, normalizeCarrierStatus } from '@/lib/logistics/status';

/**
 * One customer-facing description of a return / exchange request, shared by the website
 * and the mobile app so both always show the same id, status, pickup and refund state.
 */

type ShipmentRow = {
  awb?: string | null;
  trackingNumber?: string | null;
  courier?: string | null;
  status: string;
  trackingUrl?: string | null;
  currentLocation?: string | null;
  estimatedDelivery?: Date | string | null;
  events?: string | null;
};

type ReplacementOrderRow = {
  id: string;
  internalOrderNumber?: string | null;
  status?: string | null;
  deliveryStatus?: string | null;
  shipments?: ShipmentRow[];
};

export interface PickupSummary {
  stage: ReverseStage;
  stageLabel: string;
  awb: string | null;
  courier: string | null;
  trackingUrl: string | null;
  carrierStatus: string | null;
  carrierStatusLabel: string | null;
  location: string | null;
  expectedDate: string | null;
  timeline: Array<{ status: string; location: string; dateTime: string | null }>;
}

export interface RefundSummary {
  method: 'store_credit' | 'original_source';
  methodLabel: string;
  amount: number;
  /** awaiting_receipt → processing (received, being released) → released */
  state: 'awaiting_receipt' | 'processing' | 'released';
  stateLabel: string;
  releasedAt: string | null;
}

export interface RequestSummary {
  kind: 'return' | 'exchange';
  id: string;
  displayId: string | null;
  status: string;
  stage: ReverseStage;
  stageLabel: string;
  createdAt: string | null;
  isCod: boolean;
  codMessage: string | null;
  pickup: PickupSummary;
  received: boolean;
  receivedAt: string | null;
  refund: RefundSummary | null;
  replacement: null | {
    displayId: string | null;
    orderId: string | null;
    status: string | null;
    awb: string | null;
    courier: string | null;
    trackingUrl: string | null;
    paymentLabel: string | null;
  };
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseEvents(raw: string | null | undefined): PickupSummary['timeline'] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((e: any) => ({
        status: String(e.status || e.description || ''),
        location: String(e.location || ''),
        dateTime: iso(e.timestamp || e.dateTime || e.date) ,
      }))
      .filter((e) => e.status)
      .sort((a, b) => new Date(b.dateTime || 0).getTime() - new Date(a.dateTime || 0).getTime());
  } catch {
    return [];
  }
}

export function summarizeRequest(args: {
  kind: 'return' | 'exchange';
  request: any;
  order: { paymentMethod?: string | null; paymentStatus?: string | null; tags?: string | null; note?: string | null };
  shipments: ShipmentRow[];
  replacementOrder?: ReplacementOrderRow | null;
}): RequestSummary {
  const { kind, request, order, shipments } = args;
  const awb: string | null = request.reverseAwb || null;
  const ship = awb ? shipments.find((s) => s.awb === awb || s.trackingNumber === awb) || null : null;
  const carrier = ship ? normalizeCarrierStatus(ship.status) : null;

  const stage = deriveReverseStage({
    requestStatus: request.status,
    receivedAt: request.receivedAt,
    hasAwb: !!awb,
    carrierStatus: carrier,
  });
  const cod = isCodOrder(order);
  const received = !!request.receivedAt || ['received', 'qc_passed', 'refund_pending', 'refunded'].includes(String(request.status).toLowerCase());

  let refund: RefundSummary | null = null;
  if (kind === 'return') {
    const method: RefundSummary['method'] =
      cod || request.refundType === 'store_credit' || request.returns?.[0]?.refundMethod === 'store_credit'
        ? 'store_credit'
        : 'original_source';
    const status = String(request.status).toLowerCase();
    const released = status === 'refunded' || !!request.refundReleasedAt;
    const state: RefundSummary['state'] = released ? 'released' : received ? 'processing' : 'awaiting_receipt';
    refund = {
      method,
      methodLabel: method === 'store_credit' ? 'Store Credit' : 'Original Payment Method',
      amount: Number(request.actualRefund ?? request.estimatedRefund ?? 0),
      state,
      stateLabel:
        state === 'released'
          ? method === 'store_credit'
            ? 'Store Credit Issued'
            : 'Refund Issued'
          : state === 'processing'
            ? method === 'store_credit'
              ? 'Store Credit Processing'
              : 'Refund Processing'
            : 'Awaiting Return Pickup / Receipt',
      releasedAt: iso(request.refundReleasedAt),
    };
  }

  let replacement: RequestSummary['replacement'] = null;
  if (kind === 'exchange' && (request.replacementDisplayId || request.replacementOrderId)) {
    const ro = args.replacementOrder || null;
    const rShip = ro?.shipments?.find((s) => s.awb) || null;
    const diff = Number(request.priceDifference || 0);
    replacement = {
      displayId: request.replacementDisplayId || ro?.internalOrderNumber || null,
      orderId: request.replacementOrderId || ro?.id || null,
      status: ro ? carrierStatusLabel(normalizeCarrierStatus(rShip?.status || ro.deliveryStatus || 'confirmed')) : 'Replacement Created',
      awb: rShip?.awb || null,
      courier: rShip?.courier || null,
      trackingUrl: rShip?.trackingUrl || null,
      paymentLabel:
        diff > 0
          ? request.settlementPreference === 'COD_ON_DELIVERY'
            ? `Pay ₹${diff} on delivery`
            : 'Price difference paid'
          : diff < 0
            ? 'Difference issued as store credit'
            : 'No payment due',
    };
  }

  return {
    kind,
    id: request.id,
    displayId: request.displayId || null,
    status: request.status,
    stage,
    stageLabel: REVERSE_STAGE_LABEL[stage],
    createdAt: iso(request.createdAt),
    isCod: cod,
    codMessage: kind === 'return' && cod ? COD_STORE_CREDIT_MESSAGE : null,
    pickup: {
      stage,
      stageLabel: REVERSE_STAGE_LABEL[stage],
      awb,
      courier: request.logisticsPartner || ship?.courier || null,
      trackingUrl: ship?.trackingUrl || (awb ? `https://shiprocket.co/tracking/${awb}` : null),
      carrierStatus: carrier,
      carrierStatusLabel: carrier ? carrierStatusLabel(carrier) : null,
      location: ship?.currentLocation || null,
      expectedDate: iso(ship?.estimatedDelivery),
      timeline: ship ? parseEvents(ship.events) : [],
    },
    received,
    receivedAt: iso(request.receivedAt),
    refund,
    replacement,
  };
}
