/**
 * The ONE authoritative server-side Meta CAPI Purchase.
 *
 *  - Value, currency, items, quantities, variant IDs and payment status are read
 *    from the stored order. Nothing a browser submits is trusted for them.
 *  - Delivery is idempotent across processes via the shared AdConversionDelivery
 *    ledger (lib/snap/ledger.ts): one row per (meta, Purchase, orderId), claimed
 *    with a lease, so checkout-complete, the Razorpay webhook and the browser→CAPI
 *    route can all call this and only ONE of them sends.
 *  - event_id = order.id, identical to the browser Pixel's eventID → Meta dedup.
 *  - Purchase is sent only for paymentStatus paid / cod_upfront_paid (prepaid
 *    captured, or COD with the upfront amount captured). Authorized-only,
 *    pending, failed and partially_paid orders never count as a Purchase.
 *
 * Browser signals (UA, IP, _fbp, _fbc, external_id) come from the shopper's own
 * request. If a path has none (webhook), the context recorded at Razorpay
 * pre-create is used; a missing signal is omitted, never invented.
 *
 * No database import: deps are injected (lib/meta/purchase-server.ts binds them).
 */
import type { CapiEventPayload } from '@/lib/metaCapi';
import { createDeliveryLedger, type DeliveryResult } from '@/lib/snap/ledger';
import { snapCatalogIdFromOrderItem } from '@/lib/snap/catalog-id';
import { isPrivateIP } from '@/lib/ip-geo';
import { isPlaceholderEmail } from '@/lib/tracking/placeholder-identity';

const PLATFORM = 'meta';
const EVENT = 'Purchase';

/** Payment states that represent a completed conversion. */
export const META_PURCHASE_PAYMENT_STATUSES = new Set(['paid', 'cod_upfront_paid']);

export interface MetaClickContext {
  fbp?: string;
  fbc?: string;
  externalId?: string;
  ipAddress?: string;
  userAgent?: string;
}

function readCookie(header: string, name: string): string | undefined {
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!m) return undefined;
  try { return decodeURIComponent(m[1]) || undefined; } catch { return m[1] || undefined; }
}

const FBP_RE = /^fb\.\d\.\d{10,13}\.\d+$/;
const FBC_RE = /^fb\.\d\.\d{10,13}\..+$/;

/**
 * Meta identifiers from the shopper's own browser request.
 * Cookies first; `fallback` (e.g. the checkout body, sent by the same browser)
 * only fills gaps. The live request IP wins over the zb_client_ip cookie.
 */
export function metaContextFromRequest(
  req: Request,
  fallback: { fbp?: unknown; fbc?: unknown; externalId?: unknown } = {},
): MetaClickContext {
  const cookie = req.headers.get('cookie') || '';
  const liveIp = req.headers.get('do-connecting-ip')
    || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || undefined;
  const ip = liveIp && !isPrivateIP(liveIp) ? liveIp : readCookie(cookie, 'zb_client_ip');
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const fbp = readCookie(cookie, '_fbp') || str(fallback.fbp);
  const fbc = readCookie(cookie, '_fbc') || str(fallback.fbc);
  return {
    fbp: fbp && FBP_RE.test(fbp) ? fbp : undefined,
    fbc: fbc && FBC_RE.test(fbc) ? fbc : undefined,
    externalId: readCookie(cookie, 'zb_external_id') || str(fallback.externalId),
    ipAddress: ip && !isPrivateIP(ip) ? ip : undefined,
    userAgent: req.headers.get('user-agent') || undefined,
  };
}

function clean(ctx: MetaClickContext | undefined): MetaClickContext {
  const out: MetaClickContext = {};
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
 * Purchase value = Order.totalPrice (net sale: products − coupon − store credit;
 * COD upfront is not deducted). Same value the browser Pixel sends from the order.
 */
export function metaPurchaseValue(order: { totalPrice?: unknown }): number | null {
  const v = Number(order?.totalPrice);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
}

/** Build the CAPI Purchase from the stored order. Exported for tests. */
export function buildMetaPurchaseFromOrder(order: any, ctx: MetaClickContext, eventTimeMs: number): CapiEventPayload {
  const addr = parseAddress(order.shippingAddress);
  // The address typed at checkout is the freshest customer data; the Customer row is the fallback.
  const name = String(addr.name || order.customer?.name || '').trim().split(/\s+/).filter(Boolean);

  const contents: Array<{ id: string; quantity: number; item_price?: number }> = [];
  let numItems = 0;
  for (const it of order.items || []) {
    const qty = Math.max(1, Number(it.quantity) || 1);
    numItems += qty;
    // feed.xml g:id = variant id. Unproven ids (e.g. recovery placeholders) are left out.
    const id = snapCatalogIdFromOrderItem(it);
    if (!id) continue;
    const price = Number(it.price);
    contents.push({ id, quantity: qty, ...(Number.isFinite(price) && price > 0 ? { item_price: price } : {}) });
  }

  const emailCandidates = [addr.email, order.customer?.email].filter(
    (e): e is string => typeof e === 'string' && !!e.trim() && !isPlaceholderEmail(e),
  );
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com';
  const value = metaPurchaseValue(order);

  return {
    eventName: EVENT,
    eventId: order.id,
    eventTime: Math.floor(eventTimeMs / 1000),
    eventSourceUrl: `${site}/orders/${order.id}/confirmation`,
    userAgent: ctx.userAgent || '',
    actionSource: 'website',
    userData: {
      client_ip_address: ctx.ipAddress,
      client_user_agent: ctx.userAgent,
      fbp: ctx.fbp,
      fbc: ctx.fbc,
      external_id: ctx.externalId || order.customerId || undefined,
      em: emailCandidates[0],
      ph: addr.phone || order.customer?.phone || undefined,
      fn: name[0],
      ln: name.slice(1).join(' ') || undefined,
      ct: addr.city || undefined,
      st: addr.state || addr.province || undefined,
      zp: addr.zip || addr.pincode || undefined,
      country: addr.countryCode || addr.country_code || addr.country || undefined,
    },
    customData: {
      value: value ?? undefined,
      currency: String(order.currency || 'INR').toUpperCase(),
      order_id: order.id,
      content_type: 'product',
      content_ids: Array.from(new Set(contents.map(c => c.id))),
      contents,
      num_items: numItems || undefined,
    },
  };
}

export interface MetaPurchaseDeps {
  db: any;
  send: (payload: CapiEventPayload) => Promise<{ success: boolean; error?: any; skipped?: boolean }>;
}

export function createMetaPurchaseDelivery({ db: prisma, send }: MetaPurchaseDeps) {
  const ledger = createDeliveryLedger(prisma, '[Meta Purchase]');

  /** Store the shopper's Meta context against an order BEFORE payment. Never throws. */
  async function recordMetaPurchaseContext(orderId: string, ctx: MetaClickContext): Promise<void> {
    await ledger.recordContext(PLATFORM, EVENT, orderId, clean(ctx));
  }

  /**
   * Send the Meta Purchase for an order exactly once. Safe to call from several
   * paths concurrently and repeatedly; never throws.
   *
   * @param opts.paymentConfirmed true only when the caller knows the payment was
   *   captured (or the order is 100% store credit). Without it nothing is sent;
   *   the context is still stored for the confirming path. The stored order's
   *   paymentStatus is re-checked either way.
   */
  async function emitMetaPurchase(
    orderId: string,
    ctx?: MetaClickContext,
    opts: { paymentConfirmed?: boolean } = {},
  ): Promise<DeliveryResult> {
    if (!orderId) return { status: 'skipped', reason: 'no order id' };
    if (!opts.paymentConfirmed) {
      if (ctx) await recordMetaPurchaseContext(orderId, ctx);
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
    const payStatus = String(order.paymentStatus || '').toLowerCase();
    if (!META_PURCHASE_PAYMENT_STATUSES.has(payStatus)) {
      if (ctx) await recordMetaPurchaseContext(orderId, ctx);
      return { status: 'skipped', reason: `paymentStatus=${payStatus || 'empty'}` };
    }
    if (metaPurchaseValue(order) === null) return { status: 'skipped', reason: 'order value missing or negative' };

    return ledger.deliver({
      platform: PLATFORM,
      eventName: EVENT,
      orderId,
      ctx: clean(ctx),
      defaultEventTime: order.paymentCapturedAt || order.createdAt || new Date(),
      build: (context, eventTimeMs) => buildMetaPurchaseFromOrder(order, context as MetaClickContext, eventTimeMs),
      send,
    });
  }

  /**
   * Retry job (cron): expire pending rows older than the 7-day window, then
   * resend rows that failed or whose sending lease expired. Rows only reach
   * failed / sending after a payment-confirmed attempt, and emitMetaPurchase
   * re-checks the stored payment status before sending.
   */
  async function retryFailedMetaPurchases(limit = 25): Promise<Record<string, number>> {
    const tally: Record<string, number> = {};
    const expired = await ledger.expireStalePending(PLATFORM, EVENT);
    if (expired) tally.expired = expired;
    for (const orderId of await ledger.retryable(PLATFORM, EVENT, limit)) {
      const out = await emitMetaPurchase(orderId, undefined, { paymentConfirmed: true });
      tally[`retry_${out.status}`] = (tally[`retry_${out.status}`] || 0) + 1;
    }
    return tally;
  }

  return { recordMetaPurchaseContext, emitMetaPurchase, retryFailedMetaPurchases };
}
