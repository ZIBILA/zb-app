/**
 * Customer event scanner (Developer Brief #23/#24) — run by /api/cron/customer-events every 15 min.
 *
 * Reads the CURRENT state of orders, returns, exchanges, replacements and store credit, works out which
 * lifecycle event each record has reached, and emits it once (deliverOnce dedupes per event + channel).
 * Scanning state instead of hooking every code path means admin edits, carrier webhooks, the shipment
 * poller and manual fixes all trigger messages the same way. WhatsApp plugs in later as another channel.
 *
 * Safety:
 *  - The first run records a start marker; only changes AFTER it notify, so deploying this never emails
 *    customers about old orders. Afterwards only records changed in the last 3 days are scanned.
 *  - Only the stage a record is at now is sent — earlier stages are never backfilled.
 */

import prisma from '@/lib/db';
import { sendEmail } from '@/lib/mailer';
import { lifecycleEmail, type LifecycleEmailData } from '@/lib/email-templates/lifecycle';
import {
  deliverOnce,
  isDeliverableEmail,
  normalizeOrderRef,
  type CustomerEventType,
} from '@/lib/notifications/customer-events';
import {
  sendOrderCancelledEmail,
  sendOrderDeliveredEmail,
  sendOrderShippedEmail,
  type OrderData,
} from '@/lib/services/orderEmailService';

const SCAN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FEEDBACK_AFTER_DAYS = 3;
const FEEDBACK_UNTIL_DAYS = 10;
const EXPIRY_THRESHOLDS = [0, 3, 10, 15];
const BATCH = 200;

// Orders a customer actually committed to (paid / COD confirmed) — never abandoned checkouts.
const COMMITTED_PAYMENT = ['paid', 'cod_upfront_paid', 'partially_paid', 'refunded', 'partially_refunded'];
// Store credit rows that are money given to the customer (not debits, voids or not-yet-released rebates).
const EARNED_CREDIT_TYPES = ['COUPON_REBATE', 'refund', 'exchange_adjustment', 'custom', 'goodwill', 'manual'];

const INIT_KEY = '__scanner_init__';

export interface ScanSummary {
  sent: number;
  skipped: number;
  failed: number;
  byEvent: Record<string, number>;
}

const STATUS_LABELS: Record<string, string> = {
  approved: 'Pickup scheduled',
  in_transit: 'Picked up — on its way to us',
  delivered_to_warehouse: 'Delivered to our warehouse',
  shipped: 'Shipped',
  in_transit_forward: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

/** First run: create the marker and return its time. Later runs: the marker's time. */
async function notificationFloor(): Promise<Date> {
  const existing = await prisma.customerEventDelivery.findUnique({
    where: { eventKey_channel: { eventKey: INIT_KEY, channel: 'system' } },
  });
  if (existing) return existing.createdAt;
  try {
    const row = await prisma.customerEventDelivery.create({
      data: { eventKey: INIT_KEY, eventType: 'SCANNER_INIT', channel: 'system', status: 'sent' },
    });
    return row.createdAt;
  } catch {
    const row = await prisma.customerEventDelivery.findUnique({
      where: { eventKey_channel: { eventKey: INIT_KEY, channel: 'system' } },
    });
    return row?.createdAt || new Date();
  }
}

function orderRef(order: { internalOrderNumber?: string | null; shopifyOrderId?: string | null; id: string }) {
  return normalizeOrderRef(order.internalOrderNumber || order.id);
}

export async function scanCustomerEvents(now = new Date()): Promise<ScanSummary> {
  const summary: ScanSummary = { sent: 0, skipped: 0, failed: 0, byEvent: {} };
  const floor = await notificationFloor();
  const since = new Date(Math.max(floor.getTime(), now.getTime() - SCAN_WINDOW_MS));

  const tally = (event: string, result: 'sent' | 'duplicate' | 'failed' | 'skipped') => {
    if (result === 'sent') {
      summary.sent += 1;
      summary.byEvent[event] = (summary.byEvent[event] || 0) + 1;
    } else if (result === 'failed') summary.failed += 1;
    else summary.skipped += 1;
  };

  const emitLifecycle = async (
    event: CustomerEventType,
    eventKey: string,
    to: string | null | undefined,
    data: LifecycleEmailData
  ) => {
    if (!isDeliverableEmail(to)) return tally(event, 'skipped');
    const { subject, html, text } = lifecycleEmail(event, data);
    const result = await deliverOnce({
      eventKey,
      eventType: event,
      channel: 'email',
      recipient: to,
      send: () => sendEmail({ to, subject, html, text }),
    });
    tally(event, result);
  };

  /** Existing order templates dedupe internally (same key scheme), so a manual send never repeats. */
  const emitOrderTemplate = async (event: CustomerEventType, fn: () => Promise<void>) => {
    try {
      await fn();
      tally(event, 'sent');
    } catch {
      tally(event, 'failed');
    }
  };

  // ── 1. Regular orders: shipped → out for delivery → delivered, and cancellations ──
  const orders = await prisma.order.findMany({
    where: {
      updatedAt: { gte: since },
      createdAt: { gte: new Date(floor.getTime() - 60 * DAY_MS) },
      orderType: { not: 'EXCHANGE' },
      paymentStatus: { in: COMMITTED_PAYMENT },
    },
    include: { customer: true, items: true, shipments: { where: { type: 'outbound' }, orderBy: { createdAt: 'desc' }, take: 1 } },
    take: BATCH,
    orderBy: { updatedAt: 'desc' },
  });

  for (const order of orders as any[]) {
    const to = order.customer?.email;
    const ref = orderRef(order);
    const shipment = order.shipments?.[0];
    const delivery = String(order.deliveryStatus || '').toLowerCase();
    const status = String(order.status || '').toLowerCase();
    const orderData: OrderData = {
      customerName: order.customer?.name || 'there',
      customerEmail: to || '',
      orderId: ref,
      items: (order.items || []).map((i: any) => ({
        name: i.title,
        size: i.size || undefined,
        variant_title: i.variantTitle || null,
        quantity: i.quantity,
        price: i.price,
        image: i.image || undefined,
      })),
      total: order.totalPrice,
      currency: order.currency,
      paymentMethod: order.paymentMethod || undefined,
    };
    if (!isDeliverableEmail(to)) continue;

    if (status === 'cancelled' || delivery.includes('cancel')) {
      await emitOrderTemplate('ORDER_CANCELLED', () => sendOrderCancelledEmail(orderData));
    } else if (delivery === 'delivered') {
      await emitOrderTemplate('ORDER_DELIVERED', () => sendOrderDeliveredEmail(orderData));
    } else if (delivery === 'out_for_delivery') {
      await emitLifecycle('ORDER_OUT_FOR_DELIVERY', `order:${ref}:ORDER_OUT_FOR_DELIVERY`, to, {
        customerName: order.customer?.name,
        orderRef: ref,
        awb: shipment?.awb || shipment?.trackingNumber,
        courier: shipment?.courier,
      });
    } else if (['shipped', 'in_transit', 'picked_up', 'dispatched'].includes(delivery)) {
      await emitOrderTemplate('ORDER_SHIPPED', () =>
        sendOrderShippedEmail({
          ...orderData,
          trackingNumber: shipment?.awb || shipment?.trackingNumber || undefined,
          courier: shipment?.courier || undefined,
        } as any)
      );
    }
  }

  // ── 2. Returns (excluding the internal returns that mirror an exchange pickup) ──
  const exchangeMirrors = new Set(
    (
      await prisma.exchangeRequest.findMany({
        where: { returnRequestId: { not: null }, updatedAt: { gte: new Date(since.getTime() - 30 * DAY_MS) } },
        select: { returnRequestId: true },
      })
    ).map((e: { returnRequestId: string | null }) => e.returnRequestId)
  );
  const returns = await prisma.returnRequest.findMany({
    where: { updatedAt: { gte: since } },
    include: { order: { include: { customer: true } } },
    take: BATCH,
    orderBy: { updatedAt: 'desc' },
  });
  for (const r of returns as any[]) {
    if (exchangeMirrors.has(r.id)) continue;
    const to = r.order?.customer?.email;
    const base = { customerName: r.order?.customer?.name, orderRef: orderRef(r.order) };
    const status = String(r.status || '').toLowerCase();

    if (r.refundReleasedAt) {
      await emitLifecycle('REFUND_PROCESSED', `return:${r.id}:refund`, to, {
        ...base,
        amount: r.actualRefund ?? r.estimatedRefund,
        refundMethod: r.refundType,
      });
    } else if (r.receivedAt || status === 'received') {
      await emitLifecycle('RETURN_RECEIVED', `return:${r.id}:received`, to, base);
    } else if (['in_transit', 'delivered_to_warehouse'].includes(status) || (status === 'approved' && r.reverseAwb)) {
      await emitLifecycle('RETURN_PICKUP_UPDATE', `return:${r.id}:pickup:${status}`, to, {
        ...base,
        awb: r.reverseAwb,
        courier: r.logisticsPartner,
        statusLabel: STATUS_LABELS[status] || status,
      });
    } else if (status === 'approved') {
      await emitLifecycle('RETURN_ACCEPTED', `return:${r.id}:accepted`, to, base);
    }
  }

  // ── 3. Exchanges and their replacement orders ──
  const exchanges = await prisma.exchangeRequest.findMany({
    where: { updatedAt: { gte: since } },
    include: { order: { include: { customer: true } } },
    take: BATCH,
    orderBy: { updatedAt: 'desc' },
  });
  // Replacement orders move (ship / deliver) without their exchange request changing.
  const movingReplacements = await prisma.order.findMany({
    where: { orderType: 'EXCHANGE', updatedAt: { gte: since } },
    select: { id: true },
    take: BATCH,
  });
  const extra = await prisma.exchangeRequest.findMany({
    where: {
      replacementOrderId: { in: movingReplacements.map((o: { id: string }) => o.id) },
      id: { notIn: exchanges.map((e: { id: string }) => e.id) },
    },
    include: { order: { include: { customer: true } } },
  });

  for (const x of [...exchanges, ...extra] as any[]) {
    const to = x.order?.customer?.email;
    const base = { customerName: x.order?.customer?.name, orderRef: orderRef(x.order) };
    const status = String(x.status || '').toLowerCase();

    if (x.replacementOrderId) {
      const replacement: any = await prisma.order.findUnique({
        where: { id: x.replacementOrderId },
        include: { shipments: { where: { type: 'outbound' }, orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      const delivery = String(replacement?.deliveryStatus || '').toLowerCase();
      const shipment = replacement?.shipments?.[0];
      const rData = {
        ...base,
        replacementRef: x.replacementDisplayId || (replacement ? orderRef(replacement) : null),
        awb: shipment?.awb || shipment?.trackingNumber,
        courier: shipment?.courier,
      };
      if (delivery === 'delivered') {
        await emitLifecycle('REPLACEMENT_DELIVERED', `exchange:${x.id}:replacement:delivered`, to, rData);
      } else if (delivery === 'out_for_delivery') {
        await emitLifecycle('REPLACEMENT_OUT_FOR_DELIVERY', `exchange:${x.id}:replacement:ofd`, to, rData);
      } else if (['shipped', 'in_transit', 'picked_up', 'dispatched'].includes(delivery)) {
        await emitLifecycle('REPLACEMENT_SHIPPED', `exchange:${x.id}:replacement:shipped`, to, rData);
      } else {
        await emitLifecycle('REPLACEMENT_CREATED', `exchange:${x.id}:replacement:created`, to, rData);
      }
    } else if (['qc_passed', 'creating_order'].includes(status)) {
      await emitLifecycle('EXCHANGE_QC_PASSED', `exchange:${x.id}:qc_passed`, to, base);
    } else if (['in_transit', 'delivered_to_warehouse'].includes(status) || (['approved', 'exchange_approved'].includes(status) && x.reverseAwb)) {
      await emitLifecycle('EXCHANGE_PICKUP_UPDATE', `exchange:${x.id}:pickup:${status}`, to, {
        ...base,
        awb: x.reverseAwb,
        courier: x.logisticsPartner,
        statusLabel: STATUS_LABELS[status] || status,
      });
    } else if (['approved', 'exchange_approved', 'confirmed'].includes(status)) {
      await emitLifecycle('EXCHANGE_CONFIRMED', `exchange:${x.id}:confirmed`, to, base);
    }
  }

  // ── 4. Feedback request a few days after delivery (once per order, skipped if already reviewed) ──
  const feedbackFrom = new Date(Math.max(floor.getTime(), now.getTime() - FEEDBACK_UNTIL_DAYS * DAY_MS));
  const delivered = await prisma.order.findMany({
    where: {
      deliveredAt: { gte: feedbackFrom, lte: new Date(now.getTime() - FEEDBACK_AFTER_DAYS * DAY_MS) },
      orderType: { not: 'EXCHANGE' },
      status: { not: 'cancelled' },
    },
    include: { customer: true },
    take: BATCH,
  });
  const reviewed = new Set(
    (
      await prisma.productReview.findMany({
        where: { orderId: { in: delivered.map((o: { id: string }) => o.id) } },
        select: { orderId: true },
      })
    ).map((r: { orderId: string }) => r.orderId)
  );
  const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com';
  for (const o of delivered as any[]) {
    if (reviewed.has(o.id)) continue;
    const ref = orderRef(o);
    await emitLifecycle('FEEDBACK_REQUEST', `order:${ref}:FEEDBACK_REQUEST`, o.customer?.email, {
      customerName: o.customer?.name,
      orderRef: ref,
      reviewUrl: `${SITE}/reviews/new?orderId=${encodeURIComponent(o.id)}`,
    });
  }

  // ── 5. Store coins earned ──
  const credits = await prisma.storeCredit.findMany({
    where: { createdAt: { gte: since }, amount: { gt: 0 }, type: { in: EARNED_CREDIT_TYPES } },
    include: { customer: true },
    take: BATCH,
  });
  for (const c of credits as any[]) {
    await emitLifecycle('STORE_CREDIT_EARNED', `credit:${c.id}:earned`, c.customer?.email, {
      customerName: c.customer?.name,
      amount: c.amount,
      balance: c.customer?.storeCredits ?? null,
      expiresOn: c.expiresAt ? fmtDate(c.expiresAt) : null,
    });
  }

  // ── 6. Store coins expiring: 15 / 10 / 3 days before, and on the day (grouped per customer + date) ──
  const expiring = await prisma.storeCredit.findMany({
    where: {
      amount: { gt: 0 },
      remainingAmount: { gt: 0 },
      expiresAt: { gt: now, lte: new Date(now.getTime() + 16 * DAY_MS) },
    },
    include: { customer: true },
  });
  const groups = new Map<string, { customer: any; amount: number; expiresAt: Date }>();
  for (const c of expiring as any[]) {
    const key = `${c.customerId}:${istDate(c.expiresAt)}`;
    const g = groups.get(key) || { customer: c.customer, amount: 0, expiresAt: c.expiresAt };
    g.amount += c.remainingAmount;
    groups.set(key, g);
  }
  for (const [key, g] of groups) {
    const daysLeft = calendarDaysBetween(now, g.expiresAt);
    const threshold = EXPIRY_THRESHOLDS.find((t) => daysLeft <= t);
    if (threshold === undefined) continue;
    await emitLifecycle('STORE_CREDIT_EXPIRING', `credit:${key}:expiry:${threshold}`, g.customer?.email, {
      customerName: g.customer?.name,
      amount: g.amount,
      daysLeft,
      expiresOn: fmtDate(g.expiresAt),
    });
  }

  return summary;
}

const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** Whole calendar days (India time) from `from` until `to`; 0 = same day. */
export function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((Date.parse(istDate(to)) - Date.parse(istDate(from))) / DAY_MS);
}
