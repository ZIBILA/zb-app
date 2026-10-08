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
import type { SnapCapiEventPayload } from '@/lib/snap-capi';
import { createDeliveryLedger, type DeliveryResult } from '@/lib/snap/ledger';
import { snapCatalogIdFromOrderItem } from '@/lib/snap/catalog-id';
import { isPrivateIP } from '@/lib/ip-geo';

const PLATFORM = 'snap';
const EVENT = 'PURCHASE';

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

function parseAddress(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, any>;
  try { return JSON.parse(String(raw)) || {}; } catch { return {}; }
}

/**
 * Snap PURCHASE value (web, iOS, Android) = net sale value of the order:
 *   products − coupon/discount − store credit used.
 * COD upfront is NOT deducted (it only splits how the same sale is paid).
 * Order.totalPrice is stored as exactly this net value by every order writer:
 *   web  app/api/checkout/complete (subtotal − coupon − store credit; COD upfront
 *        is a deposit deducted from the balance, not from the total)
 *   app  /api/app/payment/create-order + /api/app/orders/create (netOrderTotal).
 * A 100% store-credit order is a real purchase with value 0.
 * Returns null when the stored value is unusable.
 */
export function snapPurchaseValue(order: { totalPrice?: unknown }): number | null {
  const v = Number(order?.totalPrice);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
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
      value: snapPurchaseValue(order) ?? undefined,
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
  /**
   * Independent proof the order's money was captured (used ONLY to recover
   * stranded pending rows). Production: Razorpay payment fetch must report
   * status=captured, captured=true, nothing refunded; full store-credit orders
   * have no gateway payment. Absent → pending rows are never recovered.
   */
  verifyCapture?: (order: { id: string; paymentMethod?: string | null; razorpayPaymentId?: string | null }) => Promise<boolean>;
}

export function createSnapPurchaseDelivery({ db: prisma, send: sendSnapEvent, verifyCapture }: SnapPurchaseDeps) {
  const ledger = createDeliveryLedger(prisma, '[Snap Purchase]');

  /**
   * Store the shopper's Snap click context against an order BEFORE payment
   * (called from the Razorpay pre-create request), so a webhook-only completion
   * still carries ScCid/_scid. Never throws.
   */
  async function recordSnapPurchaseContext(orderId: string, ctx: SnapClickContext): Promise<void> {
    await ledger.recordContext(PLATFORM, EVENT, orderId, clean(ctx));
  }

  /**
   * Send the Snap PURCHASE for a WEB order exactly once. Safe to call from
   * several paths concurrently and repeatedly; never throws.
   *
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
    let order: any;
    try {
      order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: { select: { email: true, phone: true, name: true } }, items: true },
      });
    } catch (err: any) {
      return { status: 'failed', reason: err?.message || 'order lookup failed' };
    }
    if (!order) return { status: 'skipped', reason: 'order not found' };
    if (NATIVE_APP_ORDER_TYPES.has(String(order.orderType || '').toUpperCase())) {
      return { status: 'skipped', reason: 'native app order — never sent as a WEB conversion' };
    }
    const payStatus = String(order.paymentStatus || '').toLowerCase();
    if (!SNAP_PURCHASE_PAYMENT_STATUSES.has(payStatus)) {
      return { status: 'skipped', reason: `paymentStatus=${payStatus || 'empty'}` };
    }
    if (snapPurchaseValue(order) === null) return { status: 'skipped', reason: 'order value missing or negative' };

    return ledger.deliver({
      platform: PLATFORM,
      eventName: EVENT,
      orderId,
      ctx: clean(ctx),
      defaultEventTime: order.paymentCapturedAt || order.createdAt || new Date(),
      build: (context, eventTimeMs) => buildPurchaseFromOrder(order, context as SnapClickContext, eventTimeMs),
      send: sendSnapEvent,
    });
  }

  /**
   * Retry job (cron):
   *  1. expire pending rows older than Snap's 7-day window (never sendable);
   *  2. resend failed rows / rows whose sending lease expired;
   *  3. recover PENDING rows (> 15 min old) whose order is paid / cod_upfront_paid
   *     in the DB AND whose capture is independently verified (verifyCapture).
   */
  async function retryPendingSnapPurchases(limit = 25): Promise<Record<string, number>> {
    const tally: Record<string, number> = {};
    const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };
    const expired = await ledger.expireStalePending(PLATFORM, EVENT);
    if (expired) tally.expired = expired;

    for (const orderId of await ledger.retryable(PLATFORM, EVENT, limit)) {
      // Rows only reach failed / sending after a payment-confirmed attempt.
      const out = await emitSnapPurchase(orderId, undefined, { paymentConfirmed: true });
      bump(`retry_${out.status}`);
    }

    if (!verifyCapture) return tally;
    for (const orderId of await ledger.recoverablePending(PLATFORM, EVENT, limit)) {
      const order: any = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, paymentStatus: true, paymentMethod: true, razorpayPaymentId: true, orderType: true },
      }).catch(() => null);
      if (!order) { bump('pending_no_order'); continue; }
      if (NATIVE_APP_ORDER_TYPES.has(String(order.orderType || '').toUpperCase())) { bump('pending_not_web'); continue; }
      if (!SNAP_PURCHASE_PAYMENT_STATUSES.has(String(order.paymentStatus || '').toLowerCase())) { bump('pending_unpaid'); continue; }
      const captured = await verifyCapture(order).catch(() => false);
      if (!captured) { bump('pending_capture_unverified'); continue; }
      const out = await emitSnapPurchase(orderId, undefined, { paymentConfirmed: true });
      bump(`recovered_${out.status}`);
    }
    return tally;
  }

  return { recordSnapPurchaseContext, emitSnapPurchase, retryPendingSnapPurchases };
}
