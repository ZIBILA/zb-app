/**
 * The ONE authoritative server-side Meta CAPI Purchase.
 *
 *  - Value, currency, items, quantities, variant IDs and payment status are read
 *    from the stored order. Nothing a browser submits is trusted for them.
 *  - Delivery is idempotent across processes via the shared AdConversionDelivery
 *    ledger (lib/snap/ledger.ts): one row per (meta, Purchase, orderId), claimed
 *    with a lease, so checkout-complete, the Razorpay webhook and the retry cron
 *    can all call this and only ONE of them sends. The browser never triggers it.
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
import { createDeliveryLedger, isMissingTable, MAX_ATTEMPTS, type DeliveryResult } from '@/lib/snap/ledger';
import { isEventTimeSendable } from '@/lib/snap-capi';
import { metaPurchaseValue as sharedValue, metaPurchaseCurrency, isWebsiteOrder } from '@/lib/meta/order-value';
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
 * COD upfront is not deducted). Shared with the browser Pixel via lib/meta/order-value.
 */
export const metaPurchaseValue = sharedValue;

/**
 * Orders created by the webhook recovery path when no order existed: items are an
 * unknown placeholder and the amount is only what Razorpay captured (for COD, just
 * the upfront). Not a reportable sale until staff fill in the real items.
 */
function isUnresolvedRecoveryOrder(order: any): boolean {
  const tags = String(order?.tags || '').toLowerCase();
  if (!tags.includes('webhook-recovered')) return false;
  return !(order.items || []).some((it: any) => snapCatalogIdFromOrderItem(it));
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
      currency: metaPurchaseCurrency(order),
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
  /** Why CAPI cannot send right now (token / pixel id missing or malformed), else null. */
  configError?: () => string | null;
  /** Operational alert sink. Defaults to a structured console.error line. */
  alert?: (code: MetaPurchaseAlert, detail: Record<string, unknown>) => void;
}

export type MetaPurchaseAlert =
  | 'meta_config_missing'
  | 'ledger_table_missing'
  | 'ledger_error'
  | 'attempts_exhausted'
  | 'expired_unsent';

const defaultAlert = (code: MetaPurchaseAlert, detail: Record<string, unknown>) => {
  console.error(`[Meta Purchase][ALERT] ${code}`, JSON.stringify(detail));
};

/** A paid order is eligible for missed-purchase recovery after this grace period. */
const RECOVERY_MIN_AGE_MS = 20 * 60_000;
/** Meta accepts server events up to 7 days old; nothing older is ever re-dated. */
const META_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function createMetaPurchaseDelivery({ db: prisma, send, configError, alert = defaultAlert }: MetaPurchaseDeps) {
  const ledger = createDeliveryLedger(prisma, '[Meta Purchase]');
  const key = (orderId: string) => ({ platform_eventName_orderId: { platform: PLATFORM, eventName: EVENT, orderId } });

  /**
   * A sender "skip" (e.g. configuration rejected at send time) is never a reason to
   * drop a paid conversion: the ledger must record it as FAILED (retryable), not as
   * a permanent skip. Only the ledger itself decides "skipped" (already sent, or
   * older than Meta's 7-day window).
   */
  const sendRetryable: MetaPurchaseDeps['send'] = async (payload) => {
    const res = await send(payload);
    if (res.success || !res.skipped) return res;
    return { success: false, error: `sender_skipped: ${typeof res.error === 'string' ? res.error : JSON.stringify(res.error ?? '')}` };
  };

  /** Store the shopper's Meta context against an order BEFORE payment. Never throws. */
  async function recordMetaPurchaseContext(orderId: string, ctx: MetaClickContext): Promise<void> {
    await ledger.recordContext(PLATFORM, EVENT, orderId, clean(ctx));
  }

  /**
   * Meta CAPI is not configured: keep the conversion as a FAILED, retryable ledger
   * row WITHOUT consuming a send attempt, pinned to the original conversion time
   * (paymentCapturedAt / createdAt — never "now"). Rows that pass Meta's 7-day
   * window while the configuration is broken are marked skipped and alerted.
   */
  async function deferForConfig(order: any, ctx: MetaClickContext, reason: string, conversionTime: Date): Promise<DeliveryResult> {
    const orderId = order.id;
    const lastError = `meta_config_missing: ${reason}`.slice(0, 500);
    try {
      let row = await prisma.adConversionDelivery.findUnique({ where: key(orderId) });
      if (row && (row.status === 'sent' || row.status === 'skipped' || row.status === 'sending')) {
        return { status: 'skipped', reason: `already ${row.status}` };
      }
      const eventTime: Date = row?.eventTime ? new Date(row.eventTime) : conversionTime;
      const expired = !isEventTimeSendable(eventTime.getTime());
      const status = expired ? 'skipped' : 'failed';
      const error = expired ? `${lastError} (event passed Meta 7-day window unsent)`.slice(0, 500) : lastError;
      if (!row) {
        try {
          row = await prisma.adConversionDelivery.create({
            data: { platform: PLATFORM, eventName: EVENT, orderId, eventId: orderId, status, eventTime, lastError: error, context: ctx as any },
          });
        } catch (e: any) {
          if (e?.code !== 'P2002') throw e;
          return { status: 'failed', reason: lastError }; // another path created it concurrently
        }
      } else {
        await prisma.adConversionDelivery.updateMany({
          where: { id: row.id, status: { in: ['pending', 'failed'] } },
          data: { status, eventTime, lastError: error },
        });
      }
      if (expired) {
        alert('expired_unsent', { orderId, reason: lastError });
        return { status: 'skipped', reason: 'event too old' };
      }
      alert('meta_config_missing', { orderId, reason });
      return { status: 'failed', reason: lastError };
    } catch (err: any) {
      const code: MetaPurchaseAlert = isMissingTable(err) ? 'ledger_table_missing' : 'ledger_error';
      alert(code, { orderId, error: err?.message });
      return { status: 'failed', reason: code };
    }
  }

  /**
   * Send the Meta Purchase for an order exactly once. Safe to call from several
   * paths concurrently and repeatedly; never throws.
   *
   * Delivery ALWAYS goes through the AdConversionDelivery ledger (single
   * conditional-UPDATE claim), so concurrent checkout / webhook / cron calls can
   * never both send. If the ledger is unavailable nothing is sent: the failure is
   * alerted, and once the ledger is back the cron's missed-purchase scan
   * (recoverMissedMetaPurchases) sends every paid website order that has no
   * delivery yet, with its original conversion time.
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
    // Website Purchase only. Native iOS/Android app orders must never be reported as
    // website conversions; exchange and Shopify-synced orders are not new web sales.
    if (!isWebsiteOrder(order)) {
      return { status: 'skipped', reason: `not a website order (orderType=${order.orderType})` };
    }
    if (isUnresolvedRecoveryOrder(order)) {
      return { status: 'skipped', reason: 'webhook-recovered order with unknown items' };
    }
    const payStatus = String(order.paymentStatus || '').toLowerCase();
    if (!META_PURCHASE_PAYMENT_STATUSES.has(payStatus)) {
      if (ctx) await recordMetaPurchaseContext(orderId, ctx);
      return { status: 'skipped', reason: `paymentStatus=${payStatus || 'empty'}` };
    }
    if (metaPurchaseValue(order) === null) return { status: 'skipped', reason: 'order value missing or negative' };

    // Original conversion time: when the payment was captured (or the order was
    // placed). Stored on the ledger row the first time and reused on every retry.
    const conversionTime = new Date(order.paymentCapturedAt || order.createdAt || Date.now());

    const cfgErr = configError?.() || null;
    if (cfgErr) return deferForConfig(order, clean(ctx), cfgErr, conversionTime);

    const result = await ledger.deliver({
      platform: PLATFORM,
      eventName: EVENT,
      orderId,
      ctx: clean(ctx),
      defaultEventTime: conversionTime,
      build: (context, eventTimeMs) => buildMetaPurchaseFromOrder(order, context as MetaClickContext, eventTimeMs),
      send: sendRetryable,
    });
    if (result.status === 'failed') {
      if (/ad_conversion_deliveries|P2021|does not exist/i.test(result.reason)) {
        alert('ledger_table_missing', { orderId, reason: 'apply migration 20261009010000_snap_delivery_and_newsletter' });
      } else {
        console.warn('[Meta Purchase] delivery failed (will retry)', JSON.stringify({ orderId, reason: result.reason }));
      }
    }
    return result;
  }

  /**
   * Paid website orders inside Meta's 7-day window that no path has delivered:
   * no ledger row at all (ledger was down, or every live path crashed), or a row
   * still "pending" (capture unconfirmed at checkout AND the captured webhook was
   * missed). emitMetaPurchase re-verifies the stored order before sending.
   */
  async function recoverMissedMetaPurchases(limit = 25, scan = 200): Promise<string[]> {
    const now = Date.now();
    const orders = await prisma.order.findMany({
      where: {
        orderType: 'WEB_STORE',
        paymentStatus: { in: Array.from(META_PURCHASE_PAYMENT_STATUSES) },
        createdAt: { gt: new Date(now - META_WINDOW_MS), lt: new Date(now - RECOVERY_MIN_AGE_MS) },
      },
      orderBy: { createdAt: 'desc' },
      take: scan,
      select: { id: true, tags: true, totalPrice: true, orderType: true, items: true },
    });
    // Orders that can never be reported (unknown recovery items, no value) are left
    // out here so they cannot crowd genuine misses out of the per-run limit.
    const ids: string[] = orders
      .filter((o: any) => isWebsiteOrder(o) && !isUnresolvedRecoveryOrder(o) && metaPurchaseValue(o) !== null)
      .map((o: any) => o.id);
    if (!ids.length) return [];
    const rows = await prisma.adConversionDelivery.findMany({
      where: { platform: PLATFORM, eventName: EVENT, orderId: { in: ids } },
      select: { orderId: true, status: true },
    });
    const handled = new Set(rows.filter((r: any) => r.status !== 'pending').map((r: any) => r.orderId));
    return ids.filter(id => !handled.has(id)).slice(0, limit);
  }

  /**
   * Retry job (cron):
   *   1. expire pending rows older than the 7-day window,
   *   2. resend rows that failed or whose sending lease expired,
   *   3. recover paid website orders that have no delivery at all,
   *   4. report conditions that need a human (alerts): Meta config missing,
   *      ledger table missing / erroring, rows that exhausted MAX_ATTEMPTS.
   * Returns `healthy: false` when any alert condition exists so the caller can
   * fail loudly (the cron route answers 503 → the scheduled workflow fails).
   */
  async function retryFailedMetaPurchases(limit = 25): Promise<{ healthy: boolean; tally: Record<string, number>; alerts: string[] }> {
    const tally: Record<string, number> = {};
    const alerts = new Set<string>();
    const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };
    const cfgErr = configError?.() || null;
    if (cfgErr) { alerts.add('meta_config_missing'); alert('meta_config_missing', { reason: cfgErr }); }

    try {
      const expired = await ledger.expireStalePending(PLATFORM, EVENT);
      if (expired) tally.expired = expired;
      const handled = new Set<string>();
      for (const orderId of await ledger.retryable(PLATFORM, EVENT, limit)) {
        handled.add(orderId);
        const out = await emitMetaPurchase(orderId, undefined, { paymentConfirmed: true });
        bump(`retry_${out.status}`);
      }
      for (const orderId of await recoverMissedMetaPurchases(limit)) {
        if (handled.has(orderId)) continue;
        const out = await emitMetaPurchase(orderId, undefined, { paymentConfirmed: true });
        bump(`recovered_${out.status}`);
      }
      const exhausted = await prisma.adConversionDelivery.count({
        where: { platform: PLATFORM, eventName: EVENT, status: 'failed', attempts: { gte: MAX_ATTEMPTS } },
      });
      if (exhausted) {
        tally.exhausted = exhausted;
        alerts.add('attempts_exhausted');
        alert('attempts_exhausted', { count: exhausted, hint: 'inspect lastError on ad_conversion_deliveries (platform=meta, eventName=Purchase)' });
      }
    } catch (err: any) {
      const code: MetaPurchaseAlert = isMissingTable(err) ? 'ledger_table_missing' : 'ledger_error';
      alerts.add(code);
      alert(code, { error: err?.message });
    }
    return { healthy: alerts.size === 0, tally, alerts: Array.from(alerts) };
  }

  return { recordMetaPurchaseContext, emitMetaPurchase, retryFailedMetaPurchases, recoverMissedMetaPurchases };
}
