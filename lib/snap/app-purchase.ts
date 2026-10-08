/**
 * The ONE authoritative Snap PURCHASE for NATIVE APP orders (iOS / Android),
 * sent as action_source = MOBILE_APP to the Snap App ID endpoint.
 *
 *  - Device context (platform, OS/app version, ATT, IDFV/AAID) is captured by the
 *    app at payment start (/api/app/payment/create-order) and stored in the
 *    delivery ledger, so the webhook can send even if the app never returns.
 *  - Order value, currency, variant ids and quantities come from the database.
 *  - Sent only after a CAPTURED payment (verify route with status "captured",
 *    or the payment.captured / order.paid webhook).
 *  - Idempotent via the same ledger as web (platform "snap_app").
 *  - If the device context or Snap app config is missing, nothing is sent —
 *    there is never a fallback to the web pixel.
 */
import { createDeliveryLedger, type DeliveryResult } from '@/lib/snap/ledger';
import { snapCatalogIdFromOrderItem } from '@/lib/snap/catalog-id';
import {
  parseSnapDeviceContext, snapAppConfig,
  type SnapAppEventInput, type SnapDeviceContext,
} from '@/lib/snap/app-capi';
import { NATIVE_APP_ORDER_TYPES, SNAP_PURCHASE_PAYMENT_STATUSES, snapPurchaseValue } from '@/lib/snap/purchase';

const PLATFORM = 'snap_app';
const EVENT = 'PURCHASE';

export interface AppRequestContext {
  ipAddress?: string;
  userAgent?: string;
  externalId?: string;
}

export interface SnapAppPurchaseDeps {
  db: any;
  send: (input: SnapAppEventInput, cfg: { snapAppId: string; token: string }) => Promise<{ success: boolean; error?: any; skipped?: boolean }>;
  env?: NodeJS.ProcessEnv;
  /** Independent capture proof (Razorpay captured, not refunded) for stranded pending rows. */
  verifyCapture?: (order: { id: string; paymentMethod?: string | null; razorpayPaymentId?: string | null }) => Promise<boolean>;
}

function parseAddress(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, any>;
  try { return JSON.parse(String(raw)) || {}; } catch { return {}; }
}

/** Stored ledger context → device + request context. */
function splitContext(ctx: Record<string, any>): { device: SnapDeviceContext | null; req: AppRequestContext } {
  const device = parseSnapDeviceContext({
    platform: ctx.platform, appPackage: ctx.appPackage, appVersion: ctx.appVersion, buildNumber: ctx.buildNumber,
    osVersion: ctx.osVersion, deviceModel: ctx.deviceModel, locale: ctx.locale, timezoneAbbr: ctx.timezoneAbbr,
    timezone: ctx.timezone, screenWidth: ctx.screenWidth, screenHeight: ctx.screenHeight,
    screenDensity: ctx.screenDensity, cpuCores: ctx.cpuCores, attStatus: ctx.attStatus, idfv: ctx.idfv, madid: ctx.madid,
  });
  return { device, req: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, externalId: ctx.externalId } };
}

export function buildAppPurchaseInput(order: any, device: SnapDeviceContext, req: AppRequestContext, appId: string, eventTimeMs: number): SnapAppEventInput {
  const addr = parseAddress(order.shippingAddress);
  const name = String(order.customer?.name || addr.name || '').trim().split(/\s+/).filter(Boolean);
  const contents: Array<{ id: string; quantity: number; item_price?: number }> = [];
  let numItems = 0;
  for (const it of order.items || []) {
    const qty = Math.max(1, Number(it.quantity) || 1);
    numItems += qty;
    const id = snapCatalogIdFromOrderItem(it);
    if (!id) continue;
    const price = Number(it.price);
    contents.push({ id, quantity: qty, ...(Number.isFinite(price) && price > 0 ? { item_price: price } : {}) });
  }
  return {
    eventName: EVENT,
    eventId: order.id,
    eventTime: eventTimeMs,
    device,
    appId,
    externalId: req.externalId || order.customerId || undefined,
    ipAddress: req.ipAddress,
    userAgent: req.userAgent,
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
      value: snapPurchaseValue(order) ?? 0,
      currency: String(order.currency || 'INR').toUpperCase(),
      content_ids: Array.from(new Set(contents.map(c => c.id))),
      content_type: 'product',
      contents,
      num_items: String(numItems || 1),
      order_id: order.id,
    },
  };
}

export function createSnapAppPurchaseDelivery({ db, send, env = process.env, verifyCapture }: SnapAppPurchaseDeps) {
  const ledger = createDeliveryLedger(db, '[Snap App Purchase]');

  /** Called at payment start with the app's device context. Never throws. */
  async function recordSnapAppContext(orderId: string, device: unknown, req: AppRequestContext): Promise<void> {
    const parsed = parseSnapDeviceContext(device);
    if (!parsed) return;
    await ledger.recordContext(PLATFORM, EVENT, orderId, { ...parsed, ...req });
  }

  async function emitSnapAppPurchase(
    orderId: string,
    opts: { paymentConfirmed?: boolean; device?: unknown; req?: AppRequestContext } = {},
  ): Promise<DeliveryResult> {
    if (!orderId) return { status: 'skipped', reason: 'no order id' };
    if (opts.device) await recordSnapAppContext(orderId, opts.device, opts.req || {});
    if (!opts.paymentConfirmed) return { status: 'skipped', reason: 'payment capture not confirmed' };

    let order: any;
    let stored: any;
    try {
      order = await db.order.findUnique({
        where: { id: orderId },
        include: { customer: { select: { email: true, phone: true, name: true } }, items: true },
      });
      stored = await db.adConversionDelivery.findUnique({
        where: { platform_eventName_orderId: { platform: PLATFORM, eventName: EVENT, orderId } },
      });
    } catch (err: any) {
      return { status: 'failed', reason: err?.message || 'lookup failed' };
    }
    if (!order) return { status: 'skipped', reason: 'order not found' };
    if (!NATIVE_APP_ORDER_TYPES.has(String(order.orderType || '').toUpperCase())) {
      return { status: 'skipped', reason: 'not a native app order' };
    }
    const payStatus = String(order.paymentStatus || '').toLowerCase();
    if (!SNAP_PURCHASE_PAYMENT_STATUSES.has(payStatus)) return { status: 'skipped', reason: `paymentStatus=${payStatus || 'empty'}` };
    if (snapPurchaseValue(order) === null) return { status: 'skipped', reason: 'order value missing or negative' };

    const { device } = splitContext(stored?.context || {});
    if (!device) return { status: 'skipped', reason: 'no device context from the app (older app version)' };
    const cfg = snapAppConfig(device.platform, env);
    if (!cfg) return { status: 'skipped', reason: `Snap app not configured for ${device.platform}` };

    return ledger.deliver({
      platform: PLATFORM,
      eventName: EVENT,
      orderId,
      defaultEventTime: order.paymentCapturedAt || order.createdAt || new Date(),
      build: (context, eventTimeMs) => {
        const sp = splitContext(context);
        return buildAppPurchaseInput(order, sp.device || device, sp.req, cfg.appId, eventTimeMs);
      },
      send: (input) => send(input, cfg),
    });
  }

  /**
   * Retry job: expire pending rows past Snap's window, resend failed / lease-expired
   * rows, and recover PENDING rows (>15 min) only when the DB order is paid /
   * cod_upfront_paid AND the capture is independently verified.
   */
  async function retryPendingSnapAppPurchases(limit = 25): Promise<Record<string, number>> {
    const tally: Record<string, number> = {};
    const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };
    const expired = await ledger.expireStalePending(PLATFORM, EVENT);
    if (expired) tally.expired = expired;
    for (const orderId of await ledger.retryable(PLATFORM, EVENT, limit)) {
      const out = await emitSnapAppPurchase(orderId, { paymentConfirmed: true });
      bump(`retry_${out.status}`);
    }
    if (!verifyCapture) return tally;
    for (const orderId of await ledger.recoverablePending(PLATFORM, EVENT, limit)) {
      const order: any = await db.order.findUnique({
        where: { id: orderId },
        select: { id: true, paymentStatus: true, paymentMethod: true, razorpayPaymentId: true, orderType: true },
      }).catch(() => null);
      if (!order) { bump('pending_no_order'); continue; }
      if (!NATIVE_APP_ORDER_TYPES.has(String(order.orderType || '').toUpperCase())) { bump('pending_not_app'); continue; }
      if (!SNAP_PURCHASE_PAYMENT_STATUSES.has(String(order.paymentStatus || '').toLowerCase())) { bump('pending_unpaid'); continue; }
      if (!(await verifyCapture(order).catch(() => false))) { bump('pending_capture_unverified'); continue; }
      const out = await emitSnapAppPurchase(orderId, { paymentConfirmed: true });
      bump(`recovered_${out.status}`);
    }
    return tally;
  }

  return { recordSnapAppContext, emitSnapAppPurchase, retryPendingSnapAppPurchases };
}
