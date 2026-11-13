/**
 * Order lifecycle → Shopify (fulfillment, tracking, delivery, COD payment, cancellation).
 *
 * Orders are created in Shopify at checkout, but everything after that happened only here: AWBs are booked through
 * Shiprocket from the dashboard, carrier statuses arrive by webhook / polling, and nothing was pushed back, so Shopify
 * kept every order "Unfulfilled" and COD orders "Partially paid" forever. This reconciles each recently changed order:
 *
 *  - AWB assigned            → Shopify fulfillment with courier + tracking number + tracking URL (AWB changed → tracking updated;
 *                              shipment cancelled before dispatch → fulfillment cancelled)
 *  - in transit / out for delivery / delivered / failed attempt → the matching fulfillment event (Shopify shows "Delivered")
 *  - COD delivered           → outstanding balance marked paid (Shopify "Paid", not "Partially paid")
 *  - cancelled here          → cancelled in Shopify if an earlier attempt failed (no restock: our cancel already restocked)
 *
 * Refunds are recorded on the Shopify order by lib/services/refundService.ts when they happen.
 * Every step reads Shopify's current state first, so running it again changes nothing.
 */
import prisma from '@/lib/db';
import { normalizeCarrierStatus, pickActiveOutboundShipment, shipmentAwb } from '@/lib/logistics/status';

type Action =
  | 'fulfilled'
  | 'tracking_updated'
  | 'fulfillment_cancelled'
  | 'event_in_transit'
  | 'event_out_for_delivery'
  | 'event_attempted_delivery'
  | 'event_delivered'
  | 'marked_paid'
  | 'cancelled';

export interface LifecycleSyncResult {
  orderId: string;
  actions: Action[];
  skipped?: string;
  error?: string;
}

/** Shopify fulfillment event for our carrier status, and how far along it is (events only move forward). */
const EVENT_FOR_STATUS: Record<string, { event: string; rank: number }> = {
  picked_up: { event: 'in_transit', rank: 1 },
  in_transit: { event: 'in_transit', rank: 1 },
  undelivered: { event: 'attempted_delivery', rank: 2 },
  out_for_delivery: { event: 'out_for_delivery', rank: 3 },
  delivered: { event: 'delivered', rank: 4 },
};
const SHOPIFY_EVENT_RANK: Record<string, number> = {
  in_transit: 1, attempted_delivery: 2, out_for_delivery: 3, delivered: 4,
};
const NOT_SHIPPED = ['cancelled', 'cancellation_requested'];

const isNumericShopifyId = (id: unknown) => /^\d+$/.test(String(id || ''));
const isCodOrder = (o: { paymentMethod?: string | null; tags?: string | null }) =>
  /cod|cash/i.test(String(o.paymentMethod || '')) || String(o.tags || '').split(',').map((t) => t.trim().toUpperCase()).includes('COD');

export async function syncOrderLifecycleToShopify(orderId: string): Promise<LifecycleSyncResult> {
  const result: LifecycleSyncResult = { orderId, actions: [] };
  const order: any = await prisma.order.findUnique({
    where: { id: orderId },
    include: { shipments: { orderBy: { createdAt: 'desc' } } },
  });
  if (!order) return { ...result, skipped: 'not_found' };
  if (!isNumericShopifyId(order.shopifyOrderId)) return { ...result, skipped: 'not_in_shopify' };

  const shopify = await import('@/lib/shopify-admin');
  const { order: so } = await shopify.shopifyFetch<{ order: any }>(`orders/${order.shopifyOrderId}.json`, undefined, { ttlMs: 0 }); // live, never cached
  if (!so) return { ...result, skipped: 'shopify_order_missing' };

  const cancelledHere = String(order.status || '').toLowerCase() === 'cancelled';
  if (cancelledHere) {
    if (!so.cancelled_at && !(so.fulfillments || []).some((f: any) => f.status === 'success')) {
      await shopify.cancelOrder(String(order.shopifyOrderId), 'other', { restock: false });
      result.actions.push('cancelled');
    }
    return result;
  }
  if (so.cancelled_at) return { ...result, skipped: 'cancelled_in_shopify' };

  const fulfillments = (so.fulfillments || []).filter((f: any) => f.status === 'success');
  const shipment: any = pickActiveOutboundShipment(order.shipments || []);
  const awb = shipmentAwb(shipment);
  const carrierStatus = normalizeCarrierStatus(shipment?.status);
  const deliveryStatus = String(order.deliveryStatus || '').toLowerCase();
  const tracking = awb
    ? { number: awb, url: shipment?.trackingUrl || null, company: shipment?.courier || null }
    : null;

  // ── Fulfillment + tracking ──
  if (tracking && !NOT_SHIPPED.includes(carrierStatus)) {
    if (fulfillments.length === 0) {
      const created = await shopify.fulfillShopifyOrder(String(order.shopifyOrderId), tracking);
      if (created.length > 0) {
        fulfillments.push(...created);
        result.actions.push('fulfilled');
      }
    } else {
      for (const f of fulfillments) {
        const numbers: string[] = f.tracking_numbers || (f.tracking_number ? [f.tracking_number] : []);
        if (!numbers.includes(tracking.number)) {
          await shopify.updateShopifyFulfillmentTracking(f.id, tracking);
          f.tracking_number = tracking.number;
          result.actions.push('tracking_updated');
        }
      }
    }
  } else if (!shipment && fulfillments.length > 0 && (order.shipments || []).some((s: any) => normalizeCarrierStatus(s.status) === 'cancelled')) {
    // The only shipment was cancelled before dispatch: the Shopify order is not fulfilled any more.
    const cancelledAwbs = new Set((order.shipments || []).map((s: any) => shipmentAwb(s)).filter(Boolean));
    for (const f of fulfillments) {
      const numbers: string[] = f.tracking_numbers || (f.tracking_number ? [f.tracking_number] : []);
      if (numbers.some((n) => cancelledAwbs.has(n)) && !f.shipment_status) {
        await shopify.cancelShopifyFulfillment(f.id);
        result.actions.push('fulfillment_cancelled');
      }
    }
    return result;
  }

  // ── Shipment progress (in transit → out for delivery → delivered) ──
  const progress = EVENT_FOR_STATUS[deliveryStatus === 'delivered' ? 'delivered' : carrierStatus];
  if (progress && fulfillments.length > 0) {
    for (const f of fulfillments) {
      const current = String(f.shipment_status || '');
      if (current === 'delivered' || current === progress.event) continue;
      // Forward only; a failed delivery attempt may still follow "out for delivery".
      if (progress.rank < (SHOPIFY_EVENT_RANK[current] || 0) && progress.event !== 'attempted_delivery') continue;
      await shopify.createShopifyFulfillmentEvent(String(order.shopifyOrderId), f.id, progress.event);
      result.actions.push(`event_${progress.event}` as Action);
    }
  }

  // ── COD delivered: the courier collected the balance ──
  if (deliveryStatus === 'delivered' && isCodOrder(order) && ['partially_paid', 'pending', 'authorized'].includes(String(so.financial_status))) {
    await shopify.markShopifyOrderAsPaid(String(order.shopifyOrderId));
    result.actions.push('marked_paid');
  }

  return result;
}

/** What was last pushed per order in this process, so unchanged orders are not re-read from Shopify every run. */
const lastSynced = new Map<string, string>();
const signature = (o: any) => {
  const s: any = pickActiveOutboundShipment(o.shipments || []);
  return [o.status, o.deliveryStatus, o.paymentStatus, s ? `${shipmentAwb(s)}:${s.status}` : '-', (o.shipments || []).length].join('|');
};

/**
 * Sync orders changed (order row or any of its shipments) in the last `days` days. Run every 10 minutes by the
 * server (lib/background-jobs.ts); `/api/cron/shopify-lifecycle-sync?days=60` backfills older orders.
 */
export async function syncRecentOrderLifecyclesToShopify(opts: { days?: number; limit?: number; budgetMs?: number } = {}) {
  const since = new Date(Date.now() - (opts.days ?? 3) * 24 * 60 * 60 * 1000);
  const deadline = Date.now() + (opts.budgetMs ?? 90_000);
  const orders: any[] = await prisma.order.findMany({
    where: {
      shopifyOrderId: { not: null },
      OR: [{ updatedAt: { gte: since } }, { shipments: { some: { updatedAt: { gte: since } } } }],
      // Nothing to push for orders that never left checkout.
      paymentStatus: { notIn: ['failed', 'FAILED', 'payment_failed', 'payment_pending', 'voided'] },
    },
    select: { id: true, status: true, deliveryStatus: true, paymentStatus: true, shopifyOrderId: true, shipments: { select: { awb: true, trackingNumber: true, status: true, type: true, createdAt: true, rawDelhiveryResponse: true } } },
    orderBy: { updatedAt: 'desc' },
    take: opts.limit ?? 300,
  });

  const summary = { scanned: 0, changed: 0, failed: 0, actions: {} as Record<string, number>, timedOut: false };
  for (const o of orders) {
    if (!isNumericShopifyId(o.shopifyOrderId)) continue;
    const sig = signature(o);
    if (lastSynced.get(o.id) === sig) continue;
    if (Date.now() > deadline) {
      summary.timedOut = true;
      break;
    }
    summary.scanned += 1;
    try {
      const r = await syncOrderLifecycleToShopify(o.id);
      lastSynced.set(o.id, sig);
      if (r.actions.length > 0) {
        summary.changed += 1;
        for (const a of r.actions) summary.actions[a] = (summary.actions[a] || 0) + 1;
        await prisma.syncLog
          .create({ data: { orderId: o.id, action: 'SHOPIFY_LIFECYCLE_SYNC', status: 'SUCCESS', payload: JSON.stringify(r) } })
          .catch(() => {});
      }
    } catch (err: any) {
      summary.failed += 1;
      const message = String(err?.message || err).slice(0, 500);
      console.warn(`[ShopifyLifecycle] ${o.id}: ${message}`);
      await prisma.syncLog
        .create({ data: { orderId: o.id, action: 'SHOPIFY_LIFECYCLE_SYNC', status: 'FAILED', error: message } })
        .catch(() => {});
    }
    // Stay well under Shopify's REST rate limit (2 requests / second sustained).
    await new Promise((r) => setTimeout(r, 400));
  }
  if (lastSynced.size > 20_000) lastSynced.clear();
  return summary;
}
