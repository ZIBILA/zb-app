import prisma from '@/lib/db';
import { allocateLinkedId } from '@/lib/linkedIds';
import {
  bookShiprocketReversePickup,
  cancelReversePickupsForRequest,
  getActiveLogisticsProvider,
  getShiprocketReturnCouriers,
  type CourierOption,
  type ReverseItem,
  type ReverseParty,
} from '@/lib/services/logistics';
import { normalizeCarrierStatus } from '@/lib/logistics/status';

/**
 * Orchestrates the "accept → choose logistics partner → AWB → pickup" leg for both
 * returns and exchanges. Provider API details live in lib/services/logistics.ts.
 */

export type ReverseKind = 'return' | 'exchange';
export type ReverseProvider = 'shiprocket';

export interface Parcel {
  weight: number;
  length: number;
  breadth: number;
  height: number;
}

export const DEFAULT_REVERSE_PARCEL: Parcel = { weight: 0.5, length: 30, breadth: 20, height: 5 };

export function normalizeParcel(input: Partial<Parcel> | null | undefined): Parcel {
  const pick = (v: unknown, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    weight: pick(input?.weight, DEFAULT_REVERSE_PARCEL.weight),
    length: pick(input?.length, DEFAULT_REVERSE_PARCEL.length),
    breadth: pick(input?.breadth, DEFAULT_REVERSE_PARCEL.breadth),
    height: pick(input?.height, DEFAULT_REVERSE_PARCEL.height),
  };
}

function parseAddress(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, any>;
  try {
    return JSON.parse(String(raw));
  } catch {
    return { address1: String(raw) };
  }
}

interface ReverseContext {
  kind: ReverseKind;
  requestId: string;
  displayId: string;
  status: string;
  reverseAwb: string | null;
  orderId: string;
  customer: ReverseParty;
  items: ReverseItem[];
}

async function loadContext(kind: ReverseKind, id: string): Promise<ReverseContext | null> {
  if (kind === 'return') {
    const rr = await prisma.returnRequest.findUnique({
      where: { id },
      include: {
        returns: { include: { product: true } },
        order: { include: { customer: true, items: true } },
      },
    });
    if (!rr) return null;
    if ((rr.reason || '').includes('EXCHANGE_RETURN')) {
      throw new Error('This return was created automatically for an exchange — manage the pickup from the exchange request.');
    }
    let displayId = rr.displayId;
    if (!displayId) {
      displayId = await allocateLinkedId(prisma as any, 'return', rr.order);
      await prisma.returnRequest.update({ where: { id }, data: { displayId } });
    }
    const items: ReverseItem[] = rr.returns.map((r: any) => {
      const oi = rr.order.items.find((i: any) => (r.sku && i.sku === r.sku) || i.productId === r.productId);
      const units = r.quantity || 1;
      return {
        name: r.title || r.product?.title || oi?.title || 'Item',
        sku: r.sku || oi?.sku || `SKU-${r.id.slice(-6)}`,
        units,
        selling_price: Math.max(1, Math.round(Number(oi?.price ?? (r.refundAmount || 0) / units) || 1)),
      };
    });
    return {
      kind,
      requestId: rr.id,
      displayId,
      status: rr.status,
      reverseAwb: rr.reverseAwb,
      orderId: rr.orderId,
      customer: buildParty(rr.order),
      items: dedupeSkus(items),
    };
  }

  const er = await prisma.exchangeRequest.findUnique({
    where: { id },
    include: {
      exchanges: { include: { originalProduct: true } },
      order: { include: { customer: true, items: true } },
    },
  });
  if (!er) return null;
  let displayId = er.displayId;
  if (!displayId) {
    displayId = await allocateLinkedId(prisma as any, 'exchange', er.order);
    await prisma.exchangeRequest.update({ where: { id }, data: { displayId } });
  }
  const items: ReverseItem[] = er.exchanges.map((ex: any) => {
    const oi = er.order.items.find((i: any) => i.productId === ex.originalProductId);
    return {
      name: ex.originalProduct?.title || oi?.title || 'Item',
      sku: oi?.sku || ex.originalProduct?.sku || `SKU-${ex.id.slice(-6)}`,
      units: 1,
      selling_price: Math.max(1, Math.round(Number(oi?.price || 1))),
    };
  });
  return {
    kind,
    requestId: er.id,
    displayId,
    status: er.status,
    reverseAwb: er.reverseAwb,
    orderId: er.orderId,
    customer: buildParty(er.order),
    items: dedupeSkus(items),
  };
}

/** Shiprocket rejects repeated SKUs on one order. */
function dedupeSkus(items: ReverseItem[]): ReverseItem[] {
  const seen = new Map<string, number>();
  return items.map((i) => {
    const n = (seen.get(i.sku) || 0) + 1;
    seen.set(i.sku, n);
    return n === 1 ? i : { ...i, sku: `${i.sku}-${n}` };
  });
}

function buildParty(order: { shippingAddress: string | null; customer?: { name?: string | null; phone?: string | null; email?: string | null } | null }): ReverseParty {
  const a = parseAddress(order.shippingAddress);
  const fullName =
    a.name || [a.first_name, a.last_name].filter(Boolean).join(' ') || order.customer?.name || 'Customer';
  return {
    name: String(fullName).trim() || 'Customer',
    address1: String(a.street || a.address1 || a.add || a.fullAddress || a.line1 || '').trim(),
    city: String(a.city || '').trim(),
    state: String(a.state || a.province || '').trim(),
    zip: String(a.zip || a.pincode || a.pin || a.postalCode || '').trim(),
    phone: String(a.phone || order.customer?.phone || '').trim(),
    email: String(a.email || order.customer?.email || '').trim() || undefined,
  };
}

export interface ReversePickupOptions {
  activeProvider: string;
  displayId: string;
  customerPincode: string;
  /** Shiprocket couriers able to do the reverse leg (empty when Shiprocket is not active). */
  couriers: CourierOption[];
  recommendedCourierId: number | null;
  message: string | null;
}

export async function getReversePickupOptions(
  kind: ReverseKind,
  id: string,
  parcelInput?: Partial<Parcel>
): Promise<ReversePickupOptions> {
  const ctx = await loadContext(kind, id);
  if (!ctx) throw new Error(`${kind === 'return' ? 'Return' : 'Exchange'} request not found`);
  const activeProvider = await getActiveLogisticsProvider();
  let couriers: CourierOption[] = [];
  let recommended: number | null = null;
  let message: string | null = null;
  if (activeProvider === 'shiprocket') {
    try {
      const res = await getShiprocketReturnCouriers(ctx.customer.zip, normalizeParcel(parcelInput));
      couriers = res.available_courier_companies;
      recommended = res.shiprocket_recommended_courier_id;
      message = res.message || null;
    } catch (err: any) {
      message = err?.message || 'Could not load courier options';
    }
  }
  return {
    activeProvider,
    displayId: ctx.displayId,
    customerPincode: ctx.customer.zip,
    couriers,
    recommendedCourierId: recommended,
    message,
  };
}

export interface BookReversePickupInput {
  provider: ReverseProvider;
  courierId?: number;
  courierName?: string;
  parcel?: Partial<Parcel>;
}

export interface BookReversePickupResult {
  awb: string;
  courier: string;
  provider: ReverseProvider;
  displayId: string;
  pickupScheduled: boolean;
}

/** Statuses from which ops may (re)select a logistics partner. */
const BOOKABLE_STATUSES = ['approved', 'approved_pickup_failed'];

export async function bookReversePickupForRequest(
  kind: ReverseKind,
  id: string,
  input: BookReversePickupInput
): Promise<BookReversePickupResult> {
  const ctx = await loadContext(kind, id);
  if (!ctx) throw new Error(`${kind === 'return' ? 'Return' : 'Exchange'} request not found`);
  if (!BOOKABLE_STATUSES.includes(ctx.status)) {
    throw new Error(
      ctx.status === 'pending_approval'
        ? 'Accept the request first, then select the logistics partner.'
        : `Cannot book a pickup while the request is "${ctx.status}".`
    );
  }

  const parcel = normalizeParcel(input.parcel);
  let result: { awb: string; courier: string; pickupScheduled: boolean };

  if (input.provider !== 'shiprocket') {
    throw new Error('Only Shiprocket reverse pickups are supported.');
  }
  const courierId = Number(input.courierId);
  if (!Number.isFinite(courierId) || courierId <= 0) {
    throw new Error('Select a courier for the Shiprocket pickup.');
  }
  const booking = await bookShiprocketReversePickup({
    localOrderId: ctx.orderId,
    requestKind: kind,
    requestId: ctx.requestId,
    channelOrderId: ctx.displayId,
    customer: ctx.customer,
    items: ctx.items,
    parcel,
    courierId,
    courierName: input.courierName || 'Shiprocket',
  });
  result = { awb: booking.awb, courier: booking.courier, pickupScheduled: booking.pickupScheduled };

  const data = { reverseAwb: result.awb, logisticsPartner: result.courier, status: 'approved' };
  if (kind === 'return') {
    await prisma.returnRequest.update({ where: { id }, data });
  } else {
    await prisma.exchangeRequest.update({ where: { id }, data });
  }

  await notifyPickupScheduled(kind, id, ctx, result.awb).catch((err) =>
    console.error('[ReversePickup] customer notification failed:', err?.message || err)
  );

  return {
    awb: result.awb,
    courier: result.courier,
    provider: input.provider,
    displayId: ctx.displayId,
    pickupScheduled: result.pickupScheduled,
  };
}

/** Statuses where ops may still void a booked reverse pickup and pick another partner. */
const CANCELLABLE_PICKUP_STATUSES = ['approved', 'approved_pickup_failed'];

/**
 * Cancel a booked reverse pickup at Shiprocket and clear the request's AWB so ops can
 * re-select a logistics partner. Refuses once the courier has collected the parcel.
 */
export async function cancelReversePickupForRequest(
  kind: ReverseKind,
  id: string
): Promise<{ voidedAwbs: string[]; displayId: string }> {
  const ctx = await loadContext(kind, id);
  if (!ctx) throw new Error(`${kind === 'return' ? 'Return' : 'Exchange'} request not found`);

  const status = String(ctx.status || '').toLowerCase();
  if (!CANCELLABLE_PICKUP_STATUSES.includes(status)) {
    throw new Error(
      status === 'in_transit' || status === 'delivered_to_warehouse' || status === 'received'
        ? 'Pickup is already complete — this request can no longer be reassigned.'
        : `Cannot cancel pickup while the request is "${ctx.status}".`
    );
  }
  if (!ctx.reverseAwb) {
    throw new Error('No reverse pickup is booked for this request.');
  }

  const ship = await prisma.shipment.findFirst({
    where: {
      orderId: ctx.orderId,
      OR: [{ awb: ctx.reverseAwb }, { trackingNumber: ctx.reverseAwb }],
    },
    orderBy: { createdAt: 'desc' },
  });
  const carrier = ship ? normalizeCarrierStatus(ship.status) : null;
  if (carrier && ['picked_up', 'in_transit', 'out_for_delivery', 'delivered'].includes(carrier)) {
    throw new Error(`Cannot cancel pickup — carrier reports "${carrier.replace(/_/g, ' ')}".`);
  }

  const voided = await cancelReversePickupsForRequest({ orderId: ctx.orderId, requestId: ctx.requestId });
  if (!voided.ok) {
    throw new Error(voided.message || 'The courier could not cancel this pickup.');
  }

  const data = {
    reverseAwb: null as string | null,
    logisticsPartner: null as string | null,
    status: 'approved_pickup_failed',
  };
  if (kind === 'return') {
    await prisma.returnRequest.update({ where: { id }, data });
  } else {
    await prisma.exchangeRequest.update({ where: { id }, data });
    // Keep the internal exchange-return mirror in step so its AWB cannot revive this pickup.
    const er = await prisma.exchangeRequest.findUnique({
      where: { id },
      select: { returnRequestId: true },
    });
    if (er?.returnRequestId) {
      await prisma.returnRequest
        .update({
          where: { id: er.returnRequestId },
          data: { reverseAwb: null, logisticsPartner: null, status: 'approved_pickup_failed' },
        })
        .catch(() => {});
    }
  }

  return { voidedAwbs: voided.voidedAwbs, displayId: ctx.displayId };
}

async function notifyPickupScheduled(kind: ReverseKind, id: string, ctx: ReverseContext, awb: string) {
  const order = await prisma.order.findUnique({
    where: { id: ctx.orderId },
    include: { customer: true },
  });
  const phone = order?.customer?.phone || ctx.customer.phone;
  if (!phone) return;
  const templates = await import('@/lib/whatsapp/templates');
  const args = {
    phone,
    customerName: order?.customer?.name || ctx.customer.name || 'Valued Customer',
    orderId: order?.internalOrderNumber || order?.shopifyOrderId || ctx.orderId,
    pickupDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    awbNumber: awb,
  };
  if (kind === 'return') await templates.sendReturnPickupScheduled(args);
  else await templates.sendExchangePickupScheduled(args);
}
