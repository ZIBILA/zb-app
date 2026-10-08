/**
 * The ONE authoritative server-side Snap CAPI PURCHASE for WEB orders.
 *
 *  - Everything (value, currency, items, quantities, variant IDs, status) is
 *    read from the database. Nothing a browser submits is trusted.
 *  - Delivery is idempotent across processes via the AdConversionDelivery
 *    ledger: one row per (snap, PURCHASE, orderId), claimed with a lease.
 *    sentAt is written only after Snap confirmed the event.
 *  - Native-app orders (orderType MOBILE / MOBILE_APP / APP) are never sent
 *    here: they need a MOBILE_APP event against a Snap App ID (see
 *    docs in app/api/app/payment/verify/route.ts).
 *
 * This module has no database import: deps are injected (see
 * lib/snap/purchase-server.ts for the production binding) so the delivery
 * logic can be tested against an in-memory ledger.
 *
 * Callers:
 *  - app/api/checkout/complete/route.ts  (browser request → carries ScCid/_scid)
 *  - app/api/webhooks/razorpay/route.ts  (payment.captured safety net)
 *  - app/api/checkout/razorpay/route.ts  (records click context before payment)
 */
import { isEventTimeSendable, type SnapCapiEventPayload } from '@/lib/snap-capi';
import { snapCatalogIdFromOrderItem } from '@/lib/snap/catalog-id';
import { isPrivateIP } from '@/lib/ip-geo';

const PLATFORM = 'snap';
const EVENT = 'PURCHASE';
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;

/** Payment states that represent a completed conversion. */
export const SNAP_PURCHASE_PAYMENT_STATUSES = new Set(['paid', 'cod_upfront_paid']);
/** Order types created by the native iOS / Android apps. */
export const NATIVE_APP_ORDER_TYPES = new Set(['MOBILE', 'MOBILE_APP', 'APP']);

export interface SnapClickContext {
  scClickId?: string;
  scCookie1?: string;
  externalId?: string;
  ipAddress?: string;
  userAgent?: string;
}

type DeliveryResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

function readCookie(header: string, name: string): string | undefined {
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!m) return undefined;
  try { return decodeURIComponent(m[1]) || undefined; } catch { return m[1] || undefined; }
}

/** Snap identifiers from the shopper's own browser request (never from the body). */
export function snapContextFromRequest(req: Request): SnapClickContext {
  const cookie = req.headers.get('cookie') || '';
  const ip = req.headers.get('do-connecting-ip')
    || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || readCookie(cookie, 'zb_client_ip')
    || undefined;
  return {
    scClickId: readCookie(cookie, 'ScCid') || readCookie(cookie, '_sccid'),
    scCookie1: readCookie(cookie, '_scid'),
    externalId: readCookie(cookie, 'zb_external_id'),
    ipAddress: ip && !isPrivateIP(ip) ? ip : undefined,
    userAgent: req.headers.get('user-agent') || undefined,
  };
}

function clean(ctx: SnapClickContext | undefined): SnapClickContext {
  const out: SnapClickContext = {};
  if (!ctx) return out;
  for (const [k, v] of Object.entries(ctx)) {
    if (typeof v === 'string' && v.trim()) (out as any)[k] = v.trim().slice(0, 1024);
  }
  return out;
}

/** Existing values win; new request fills only the gaps. */
function mergeContext(existing: unknown, incoming: SnapClickContext): SnapClickContext {
  const base = (existing && typeof existing === 'object' ? existing : {}) as SnapClickContext;
  return { ...incoming, ...clean(base) };
}

function isMissingTable(err: any): boolean {
  const msg = String(err?.message || '');
  return err?.code === 'P2021' || /ad_conversion_deliveries/.test(msg) && /does not exist/i.test(msg);
}

function parseAddress(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, any>;
  try { return JSON.parse(String(raw)) || {}; } catch { return {}; }
}

/** Build the CAPI PURCHASE from the stored order. Exported for tests. */
export function buildPurchaseFromOrder(order: any, ctx: SnapClickContext, eventTimeMs: number) {
  const addr = parseAddress(order.shippingAddress);
  const name = String(order.customer?.name || addr.name || '').trim().split(/\s+/).filter(Boolean);

  const contents: Array<{ id: string; quantity: number; item_price?: number }> = [];
  let numItems = 0;
  for (const it of order.items || []) {
    const qty = Math.max(1, Number(it.quantity) || 1);
    numItems += qty;
    const id = snapCatalogIdFromOrderItem(it);
    if (!id) continue; // unknown catalog id → leave it out rather than send a wrong one
    const price = Number(it.price);
    contents.push({ id, quantity: qty, ...(Number.isFinite(price) && price > 0 ? { item_price: price } : {}) });
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com';
  return {
    eventName: EVENT,
    eventId: order.id,
    eventTime: eventTimeMs,
    eventSourceUrl: `${site}/orders/${order.id}/confirmation`,
    userAgent: ctx.userAgent || '',
    ipAddress: ctx.ipAddress,
    scClickId: ctx.scClickId,
    scCookie1: ctx.scCookie1,
    externalId: ctx.externalId || order.customerId || undefined,
    userData: {
      em: order.customer?.email || addr.email,
      ph: order.customer?.phone || addr.phone,
      fn: name[0],
      ln: name.slice(1).join(' ') || undefined,
      ct: addr.city,
      st: addr.state || addr.province,
      zp: addr.zip || addr.pincode,
      country: addr.countryCode || addr.country_code || addr.country,
    },
    customData: {
      value: Number(order.totalPrice),
      currency: String(order.currency || 'INR').toUpperCase(),
      content_ids: Array.from(new Set(contents.map(c => c.id))),
      contents,
      num_items: numItems || undefined,
      order_id: order.id,
    },
  };
}

export interface SnapPurchaseDeps {
  /** Prisma client (or a compatible fake in tests). */
  db: any;
  send: (payload: SnapCapiEventPayload) => Promise<{ success: boolean; error?: any; skipped?: boolean }>;
}

export function createSnapPurchaseDelivery({ db: prisma, send: sendSnapEvent }: SnapPurchaseDeps) {
  /**
   * Store the shopper's Snap click context against an order BEFORE payment
   * (called from the Razorpay pre-create request), so a webhook-only completion
   * still carries ScCid/_scid. Never throws.
   */
  async function recordSnapPurchaseContext(orderId: string, ctx: SnapClickContext): Promise<void> {
    try {
      const incoming = clean(ctx);
      if (!orderId || Object.keys(incoming).length === 0) return;
      const key = { platform_eventName_orderId: { platform: PLATFORM, eventName: EVENT, orderId } };
      const existing = await prisma.adConversionDelivery.findUnique({ where: key, select: { context: true } });
      if (existing) {
        await prisma.adConversionDelivery.update({
          where: key,
          data: { context: mergeContext(existing.context, incoming) as any },
        });
      } else {
        await prisma.adConversionDelivery.create({
          data: { platform: PLATFORM, eventName: EVENT, orderId, eventId: orderId, context: incoming as any },
        }).catch((e: any) => { if (e?.code !== 'P2002') throw e; });
      }
    } catch (err: any) {
      console.warn('[Snap Purchase] could not record click context:', isMissingTable(err) ? 'ledger table missing' : err?.message);
    }
  }

  /**
   * Send the Snap PURCHASE for a web order exactly once. Safe to call from
   * several paths concurrently and repeatedly; never throws.
   */
  /**
   * @param opts.paymentConfirmed must be true only when the caller has proof the
   *   payment was CAPTURED (Razorpay payment.captured / order.paid, a verified
   *   captured fetch, or a full store-credit order). Without it nothing is sent;
   *   the click context is still stored for the confirming path to use.
   */
  async function emitSnapPurchase(
    orderId: string,
    ctx?: SnapClickContext,
    opts: { paymentConfirmed?: boolean } = {},
  ): Promise<DeliveryResult> {
    if (!orderId) return { status: 'skipped', reason: 'no order id' };
    if (!opts.paymentConfirmed) {
      if (ctx) await recordSnapPurchaseContext(orderId, ctx);
      return { status: 'skipped', reason: 'payment capture not confirmed' };
    }
    const key = { platform_eventName_orderId: { platform: PLATFORM, eventName: EVENT, orderId } };
    try {
      const order: any = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: { select: { email: true, phone: true, name: true } }, items: true },
      });
      if (!order) return { status: 'skipped', reason: 'order not found' };
      if (NATIVE_APP_ORDER_TYPES.has(String(order.orderType || '').toUpperCase())) {
        return { status: 'skipped', reason: 'native app order (MOBILE_APP not configured)' };
      }
      const payStatus = String(order.paymentStatus || '').toLowerCase();
      if (!SNAP_PURCHASE_PAYMENT_STATUSES.has(payStatus)) {
        return { status: 'skipped', reason: `paymentStatus=${payStatus || 'empty'}` };
      }
      const value = Number(order.totalPrice);
      if (!Number.isFinite(value) || value <= 0) {
        return { status: 'skipped', reason: 'non-positive order value' };
      }

      // 1) Ensure the ledger row exists (unique key makes concurrent creates safe).
      const incoming = clean(ctx);
      let row = await prisma.adConversionDelivery.findUnique({ where: key });
      if (!row) {
        try {
          row = await prisma.adConversionDelivery.create({
            data: { platform: PLATFORM, eventName: EVENT, orderId, eventId: orderId, context: incoming as any },
          });
        } catch (e: any) {
          if (e?.code !== 'P2002') throw e;
          row = await prisma.adConversionDelivery.findUnique({ where: key });
        }
      } else if (Object.keys(incoming).length) {
        await prisma.adConversionDelivery.update({
          where: key, data: { context: mergeContext(row.context, incoming) as any },
        });
      }
      if (!row) return { status: 'failed', reason: 'ledger row missing' };
      if (row.status === 'sent' || row.status === 'skipped') {
        return { status: 'skipped', reason: `already ${row.status}` };
      }

      // 2) Atomic claim: only one process can move the row into "sending".
      const now = new Date();
      const claimed = await prisma.adConversionDelivery.updateMany({
        where: {
          id: row.id,
          attempts: { lt: MAX_ATTEMPTS },
          OR: [
            { status: { in: ['pending', 'failed'] } },
            { status: 'sending', leaseUntil: { lt: now } },
          ],
        },
        data: { status: 'sending', leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
      });
      if (claimed.count !== 1) return { status: 'skipped', reason: 'claimed by another process or max attempts' };

      const fresh = await prisma.adConversionDelivery.findUnique({ where: key });
      const context = mergeContext(fresh?.context, incoming);

      // 3) Conversion time is fixed once and reused on every retry.
      const eventTime: Date = fresh?.eventTime || order.paymentCapturedAt || order.createdAt || now;
      if (!fresh?.eventTime) {
        await prisma.adConversionDelivery.update({ where: key, data: { eventTime } });
      }
      if (!isEventTimeSendable(eventTime.getTime())) {
        await prisma.adConversionDelivery.update({
          where: key,
          data: { status: 'skipped', leaseUntil: null, lastError: 'event older than Snap 7-day window' },
        });
        console.warn(`[Snap Purchase] ${orderId} skipped: event older than 7 days`);
        return { status: 'skipped', reason: 'event too old' };
      }

      // 4) Send.
      const payload = buildPurchaseFromOrder(order, context, eventTime.getTime());
      const res = await sendSnapEvent(payload);

      if (res.success) {
        await prisma.adConversionDelivery.update({
          where: key,
          data: { status: 'sent', sentAt: new Date(), leaseUntil: null, lastError: null },
        });
        return { status: 'sent' };
      }
      const reason = typeof res.error === 'string' ? res.error : JSON.stringify(res.error ?? 'unknown').slice(0, 500);
      await prisma.adConversionDelivery.update({
        where: key,
        data: { status: res.skipped ? 'skipped' : 'failed', leaseUntil: null, lastError: reason },
      });
      return res.skipped ? { status: 'skipped', reason } : { status: 'failed', reason };
    } catch (err: any) {
      console.error('[Snap Purchase] delivery error:', isMissingTable(err) ? 'ledger table missing — run prisma db push' : err?.message);
      return { status: 'failed', reason: err?.message || 'error' };
    }
  }

  /** Retry failed / stale-leased web purchases (used by the cron route). */
  async function retryPendingSnapPurchases(limit = 25): Promise<Record<string, number>> {
    const now = new Date();
    const rows = await prisma.adConversionDelivery.findMany({
      where: {
        platform: PLATFORM,
        eventName: EVENT,
        attempts: { lt: MAX_ATTEMPTS },
        OR: [
          // "pending" rows are only made sendable by the payment paths themselves.
          { status: 'failed' },
          { status: 'sending', leaseUntil: { lt: now } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { orderId: true },
    });
    const tally: Record<string, number> = {};
    for (const r of rows) {
      // Rows only reach failed / sending after a payment-confirmed attempt.
      const out = await emitSnapPurchase(r.orderId, undefined, { paymentConfirmed: true });
      tally[out.status] = (tally[out.status] || 0) + 1;
    }
    return tally;
  }

  return { recordSnapPurchaseContext, emitSnapPurchase, retryPendingSnapPurchases };
}
