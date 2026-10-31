/**
 * WhatsApp lifecycle scanner — run by /api/cron/customer-events right after the email scanner.
 *
 * Covers the customer messages that have no inline trigger today:
 *   order cancelled · refund initiated · return accepted · return received · exchange delivered ·
 *   Store Credit earned (prepaid, on payment) · Store Coins earned (COD, only after delivery).
 * (Order confirmed / shipped / out for delivery / delivered, pickups, exchange confirmed/shipped, COD
 * confirmation, account-created and cart recovery are already sent by their own triggers — not repeated here.)
 *
 * Same safety rules as the email scanner (lib/notifications/event-scanner.ts):
 *  - It reads the CURRENT state of each record instead of hooking every code path, so admin edits, carrier
 *    webhooks and the shipment poller all trigger messages the same way.
 *  - Its own start marker: only changes AFTER the first run notify, so deploying never messages customers
 *    about old orders. Afterwards only records changed in the last 3 days are scanned.
 *  - deliverOnce() claims (eventKey, "whatsapp") before sending, so overlapping runs, retried webhooks or a
 *    second server can never send the same message twice. A failed send is retried on later scans (max 3).
 *  - Nothing is sent when required data is missing (no phone, no amount) — never an incomplete message.
 *  - Every automation is OFF until switched on in Dashboard → Marketing → WhatsApp → Automations, because each
 *    needs a Meta-approved template.
 */

import prisma from '@/lib/db';
import { deliverOnce, normalizeOrderRef, type CustomerEventType } from '@/lib/notifications/customer-events';
import type { ScanSummary } from '@/lib/notifications/event-scanner';
import { toggleDefault } from '@/lib/whatsapp/automation-defaults';
import { getWhatsAppSetting } from '@/lib/whatsapp/logger';
import { formatPhone } from '@/lib/whatsapp/client';
import * as templates from '@/lib/whatsapp/templates';

const DAY_MS = 24 * 60 * 60 * 1000;
const SCAN_WINDOW_MS = 3 * DAY_MS;
const ORDER_LOOKBACK_MS = 60 * DAY_MS;
const BATCH = 200;
/** The cron has a 60s limit; stop sending at 45s and let the next run (not yet claimed) pick the rest up. */
const TIME_BUDGET_MS = 45_000;

const INIT_KEY = '__scanner_init_whatsapp__';

/** Payment states that mean the customer never actually placed the order. */
const NEVER_PLACED_PAYMENT = ['failed', 'FAILED', 'payment_failed', 'payment_pending', 'voided'];
const PAID_PAYMENT = ['paid', 'PAID', 'captured', 'success', 'SUCCESS'];
const CANCELLED_STATUS = ['cancelled', 'CANCELLED'];
/** Return refunds paid out as store credit/coins are covered by the Store Credit message, not "refund initiated". */
const NON_CASH_REFUND = /credit|coin|wallet/i;

type Sender = (args: any) => Promise<any>;

export interface WhatsAppSenders {
  orderCancelled: Sender;
  refundInitiated: Sender;
  returnAccepted: Sender;
  returnReceived: Sender;
  exchangeDelivered: Sender;
  storeCreditEarned: Sender;
  storeCoinsEarned: Sender;
}

export interface WhatsAppScanDeps {
  /** Replace the real senders (tests). */
  send?: Partial<WhatsAppSenders>;
  /** Replace the toggle lookup (tests). */
  isEnabled?: (toggleKey: string) => Promise<boolean>;
  budgetMs?: number;
}

const defaultSenders = (): WhatsAppSenders => ({
  orderCancelled: templates.sendOrderCancelled,
  refundInitiated: templates.sendRefundInitiated,
  returnAccepted: templates.sendReturnConfirmed,
  returnReceived: templates.sendReturnReceived,
  exchangeDelivered: templates.sendExchangeDelivered,
  storeCreditEarned: templates.sendStoreCreditEarned,
  storeCoinsEarned: templates.sendStoreCoinsEarned,
});

/** First run: create the marker and return its time. Later runs: the marker's time. */
async function notificationFloor(): Promise<Date> {
  const key = { eventKey_channel: { eventKey: INIT_KEY, channel: 'system' } };
  const existing = await prisma.customerEventDelivery.findUnique({ where: key });
  if (existing) return existing.createdAt;
  try {
    const row = await prisma.customerEventDelivery.create({
      data: { eventKey: INIT_KEY, eventType: 'SCANNER_INIT', channel: 'system', status: 'sent' },
    });
    return row.createdAt;
  } catch {
    const row = await prisma.customerEventDelivery.findUnique({ where: key });
    return row?.createdAt || new Date();
  }
}

const isCod = (order: { paymentMethod?: string | null }) => /cod|cash/i.test(String(order.paymentMethod || ''));

const orderRef = (order: { internalOrderNumber?: string | null; id: string }) =>
  normalizeOrderRef(order.internalOrderNumber || order.id);

/** Customer phone, falling back to the phone on the shipping address. '' when neither is usable. */
function phoneOf(customer: { phone?: string | null } | null | undefined, shippingAddress?: string | null): string {
  if (customer?.phone && formatPhone(customer.phone)) return customer.phone;
  if (shippingAddress) {
    try {
      const a = JSON.parse(shippingAddress);
      const p = String(a?.phone || a?.phoneNumber || a?.mobile || '');
      if (formatPhone(p)) return p;
    } catch {
      /* not JSON — ignore */
    }
  }
  return '';
}

export async function scanWhatsAppEvents(now = new Date(), deps: WhatsAppScanDeps = {}): Promise<ScanSummary> {
  const summary: ScanSummary = { sent: 0, skipped: 0, failed: 0, byEvent: {} };
  const startedAt = Date.now();
  const budget = deps.budgetMs ?? TIME_BUDGET_MS;
  const outOfTime = () => Date.now() - startedAt > budget;

  const senders: WhatsAppSenders = { ...defaultSenders(), ...(deps.send || {}) };
  const enabledCache = new Map<string, boolean>();
  const isOn = async (toggleKey: string) => {
    if (!enabledCache.has(toggleKey)) {
      enabledCache.set(
        toggleKey,
        deps.isEnabled
          ? await deps.isEnabled(toggleKey)
          : (await getWhatsAppSetting(toggleKey, toggleDefault(toggleKey))) === 'true'
      );
    }
    return enabledCache.get(toggleKey)!;
  };

  const floor = await notificationFloor();
  const since = new Date(Math.max(floor.getTime(), now.getTime() - SCAN_WINDOW_MS));
  const createdFrom = new Date(floor.getTime() - ORDER_LOOKBACK_MS);

  const tally = (event: string, result: 'sent' | 'duplicate' | 'failed' | 'skipped') => {
    if (result === 'sent') {
      summary.sent += 1;
      summary.byEvent[event] = (summary.byEvent[event] || 0) + 1;
    } else if (result === 'failed') summary.failed += 1;
    else summary.skipped += 1;
  };

  const emit = async (
    event: CustomerEventType,
    eventKey: string,
    rawPhone: string,
    run: (to: string) => Promise<any>
  ) => {
    const to = formatPhone(rawPhone);
    if (!to || outOfTime()) return tally(event, 'skipped');
    const result = await deliverOnce({
      eventKey,
      eventType: event,
      channel: 'whatsapp',
      recipient: to,
      send: async () => {
        const r = await run(to);
        if (!r || r.success !== true) throw new Error(r?.error || 'WhatsApp send failed');
      },
    });
    tally(event, result);
  };

  // Exchange pickups create an internal return — it must not produce return messages of its own.
  const exchangeMirrors = new Set<string>(
    (
      await prisma.exchangeRequest.findMany({
        where: { returnRequestId: { not: null }, updatedAt: { gte: new Date(since.getTime() - 30 * DAY_MS) } },
        select: { returnRequestId: true },
      })
    ).map((e: { returnRequestId: string | null }) => String(e.returnRequestId))
  );

  // ── 1. Order cancelled (separate from the refund message) ──
  if (await isOn('order_cancelled_enabled')) {
    const orders: any[] = await prisma.order.findMany({
      where: {
        updatedAt: { gte: since },
        createdAt: { gte: createdFrom },
        orderType: { not: 'EXCHANGE' },
        paymentStatus: { notIn: NEVER_PLACED_PAYMENT },
        OR: [{ status: { in: CANCELLED_STATUS } }, { cancelledAt: { not: null } }],
      },
      include: { customer: true },
      take: BATCH,
      orderBy: { updatedAt: 'desc' },
    });
    for (const o of orders) {
      // Cancelled before this scanner existed (and merely edited since) → not news.
      const cancelledAt: Date = o.cancelledAt || o.updatedAt;
      if (cancelledAt < since) continue;
      const ref = orderRef(o);
      await emit('ORDER_CANCELLED', `order:${ref}:ORDER_CANCELLED`, phoneOf(o.customer, o.shippingAddress), (to) =>
        senders.orderCancelled({ phone: to, customerName: o.customer?.name || 'there', orderId: ref })
      );
    }
  }

  // ── 2. Refund initiated — only once the refund has actually been started, never on cancellation alone ──
  if (await isOn('refund_initiated_enabled')) {
    const refunded: any[] = await prisma.order.findMany({
      where: {
        updatedAt: { gte: since },
        createdAt: { gte: createdFrom },
        refundStatus: 'completed',
        refundId: { not: null },
      },
      include: { customer: true },
      take: BATCH,
      orderBy: { updatedAt: 'desc' },
    });
    for (const o of refunded) {
      const payment: any = await prisma.payment.findFirst({
        where: { orderId: o.id, type: 'refund', status: 'completed' },
        orderBy: { createdAt: 'desc' },
      });
      if (!payment || payment.createdAt < since || !(payment.amount > 0)) {
        tally('REFUND_PROCESSED', 'skipped');
        continue;
      }
      const ref = orderRef(o);
      await emit('REFUND_PROCESSED', `order:${ref}:REFUND_INITIATED`, phoneOf(o.customer, o.shippingAddress), (to) =>
        senders.refundInitiated({
          phone: to,
          customerName: o.customer?.name || 'there',
          orderId: ref,
          refundAmount: payment.amount,
        })
      );
    }

    const releasedReturns: any[] = await prisma.returnRequest.findMany({
      where: { refundReleasedAt: { gte: since } },
      include: { order: { include: { customer: true } } },
      take: BATCH,
      orderBy: { updatedAt: 'desc' },
    });
    for (const r of releasedReturns) {
      if (exchangeMirrors.has(r.id)) continue;
      const amount = Number(r.actualRefund ?? r.estimatedRefund ?? 0);
      if (!(amount > 0) || NON_CASH_REFUND.test(String(r.refundType || ''))) {
        tally('REFUND_PROCESSED', 'skipped');
        continue;
      }
      await emit(
        'REFUND_PROCESSED',
        `return:${r.id}:refund`,
        phoneOf(r.order?.customer, r.order?.shippingAddress),
        (to) =>
          senders.refundInitiated({
            phone: to,
            customerName: r.order?.customer?.name || 'there',
            orderId: orderRef(r.order),
            refundAmount: amount,
          })
      );
    }
  }

  // ── 3 + 4. Returns: accepted → received (current stage only; refund has its own message above) ──
  const wantAccepted = await isOn('return_confirmed');
  const wantReceived = await isOn('return_received_enabled');
  if (wantAccepted || wantReceived) {
    const returns: any[] = await prisma.returnRequest.findMany({
      where: { updatedAt: { gte: since }, refundReleasedAt: null },
      include: { order: { include: { customer: true } } },
      take: BATCH,
      orderBy: { updatedAt: 'desc' },
    });
    for (const r of returns) {
      if (exchangeMirrors.has(r.id) || !r.order) continue;
      const status = String(r.status || '').toLowerCase();
      const phone = phoneOf(r.order.customer, r.order.shippingAddress);
      const name = r.order.customer?.name || 'there';
      const ref = orderRef(r.order);

      if (r.receivedAt || status === 'received') {
        if (wantReceived) {
          await emit('RETURN_RECEIVED', `return:${r.id}:received`, phone, (to) =>
            senders.returnReceived({ phone: to, customerName: name, orderId: ref })
          );
        }
      } else if (status === 'approved' && wantAccepted) {
        const amount = Number(r.actualRefund ?? r.estimatedRefund ?? 0);
        if (!(amount > 0)) {
          tally('RETURN_ACCEPTED', 'skipped'); // refund amount unknown yet — don't send a half-filled message
          continue;
        }
        await emit('RETURN_ACCEPTED', `return:${r.id}:accepted`, phone, (to) =>
          senders.returnAccepted({
            phone: to,
            customerName: name,
            orderId: ref,
            refundAmount: `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
          })
        );
      }
    }
  }

  // ── 5. Exchange delivered (the replacement parcel reached the customer) ──
  if (await isOn('exchange_delivered_enabled')) {
    const replacements: any[] = await prisma.order.findMany({
      where: { orderType: 'EXCHANGE', deliveryStatus: 'delivered', updatedAt: { gte: since } },
      select: { id: true, internalOrderNumber: true },
      take: BATCH,
    });
    for (const rep of replacements) {
      const x: any = await prisma.exchangeRequest.findFirst({
        where: { replacementOrderId: rep.id },
        include: { order: { include: { customer: true } } },
      });
      if (!x?.order) continue;
      await emit(
        'REPLACEMENT_DELIVERED',
        `exchange:${x.id}:replacement:delivered`,
        phoneOf(x.order.customer, x.order.shippingAddress),
        (to) =>
          senders.exchangeDelivered({
            phone: to,
            customerName: x.order.customer?.name || 'there',
            orderId: x.replacementDisplayId || orderRef(rep),
          })
      );
    }
  }

  // ── 6. Prepaid: Store Credit earned, sent when the order is paid (amount = the rebate already computed
  //       at checkout: 10% of the final amount paid after discounts) ──
  if (await isOn('store_credit_earned_enabled')) {
    const credits: any[] = await prisma.storeCredit.findMany({
      where: {
        type: { in: ['PENDING_COUPON_REBATE', 'COUPON_REBATE'] },
        amount: { gt: 0 },
        orderId: { not: null },
        createdAt: { gte: since },
      },
      take: BATCH,
      orderBy: { createdAt: 'desc' },
    });
    for (const c of credits) {
      const order: any = await prisma.order.findUnique({ where: { id: c.orderId }, include: { customer: true } });
      if (!order || isCod(order) || !PAID_PAYMENT.includes(order.paymentStatus)) {
        tally('STORE_CREDIT_EARNED', 'skipped');
        continue;
      }
      const ref = orderRef(order);
      await emit('STORE_CREDIT_EARNED', `order:${ref}:STORE_CREDIT_EARNED`, phoneOf(order.customer, order.shippingAddress), (to) =>
        senders.storeCreditEarned({
          phone: to,
          customerName: order.customer?.name || 'there',
          orderId: ref,
          creditAmount: c.amount,
        })
      );
    }
  }

  // ── 7. COD: Store Coins earned — only after the order is delivered AND the rebate was actually released ──
  if (await isOn('store_coins_earned_enabled')) {
    const delivered: any[] = await prisma.order.findMany({
      where: {
        deliveredAt: { gte: since },
        createdAt: { gte: createdFrom },
        orderType: { not: 'EXCHANGE' },
        status: { notIn: CANCELLED_STATUS },
      },
      include: { customer: true },
      take: BATCH,
      orderBy: { deliveredAt: 'desc' },
    });
    for (const o of delivered) {
      if (!isCod(o)) continue;
      const released: any = await prisma.storeCredit.findFirst({
        where: { orderId: o.id, type: 'COUPON_REBATE', amount: { gt: 0 } },
      });
      if (!released) continue; // nothing earned (or not released yet — a later scan will see it)
      const ref = orderRef(o);
      await emit('STORE_COINS_EARNED', `order:${ref}:STORE_COINS_EARNED`, phoneOf(o.customer, o.shippingAddress), (to) =>
        senders.storeCoinsEarned({
          phone: to,
          customerName: o.customer?.name || 'there',
          orderId: ref,
          coinsAmount: released.amount,
        })
      );
    }
  }

  return summary;
}
