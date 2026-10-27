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
import { pickRealEmail, pickRealName } from '@/lib/tracking/placeholder-identity';
import { snapPurchasePhone } from '@/lib/snap/identity';
import { isUnresolvedRecoveryOrder } from '@/lib/tracking/order-guards';
import { internalOrderReason } from '@/lib/meta/internal-orders';
import { createDeliveryLedger, isMissingTable, type DeliveryResult, type LedgerRowSummary } from '@/lib/snap/ledger';
import { findRecoveryCandidates } from '@/lib/snap/recovery';
import { snapCatalogIdFromOrderItem } from '@/lib/snap/catalog-id';
import { snapPurchaseCurrency } from '@/lib/snap/currency';
import {
  parseSnapDeviceContext, snapAppConfig,
  type SnapAppEventInput, type SnapDeviceContext,
} from '@/lib/snap/app-capi';
import {
  NATIVE_APP_ORDER_TYPES, SNAP_PURCHASE_PAYMENT_STATUSES, bySnapEventAge, closeExhaustedRows, isSnapRetryDue, retryDeadline,
  snapPurchaseValue, type RetryRunOptions,
} from '@/lib/snap/purchase';

/** Default share of the cron request for the app job (it runs after the website job). */
export const SNAP_APP_RETRY_RUN_BUDGET_MS = 12_000;

const PLATFORM = 'snap_app';
const EVENT = 'PURCHASE';

export interface AppRequestContext {
  ipAddress?: string;
  userAgent?: string;
  externalId?: string;
}

export interface SnapAppPurchaseDeps {
  db: any;
  send: (input: SnapAppEventInput, cfg: { snapAppId: string; token: string }) => Promise<{ success: boolean; error?: any; skipped?: boolean; blocked?: string; validateOnly?: boolean }>;
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
  const name = String(pickRealName(order.customer?.name, addr.name) || '').trim().split(/\s+/).filter(Boolean);
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
      // Placeholder emails (guest@zicabella.com, guest_<ts>@…), dummy phones and
      // names are skipped for the next real value; never sent.
      em: pickRealEmail(order.customer?.email, addr.email),
      ph: snapPurchasePhone(order.customer?.phone, addr.phone),
      fn: name[0],
      ln: name.slice(1).join(' ') || undefined,
      ct: addr.city,
      st: addr.state || addr.province,
      zp: addr.zip || addr.pincode,
      country: addr.countryCode || addr.country_code || addr.country,
    },
    customData: {
      value: snapPurchaseValue(order) ?? 0,
      // The currency the order was charged in (lib/snap/currency.ts) — never a fixed one.
      currency: snapPurchaseCurrency(order),
      content_ids: Array.from(new Set(contents.map(c => c.id))),
      content_type: 'product',
      contents,
      num_items: String(numItems || 1),
      order_id: order.id,
    },
  };
}

/** Skip reasons that mean a failed delivery can never be sent: close the row. */
const SNAP_TERMINAL_RETRY_SKIP = /^(order not found|not a native app order|native app order|webhook-recovered order|paymentStatus=|order value missing|no device context)/;

export function createSnapAppPurchaseDelivery({ db, send: rawSend, env = process.env, verifyCapture }: SnapAppPurchaseDeps) {
  const ledger = createDeliveryLedger(db, '[Snap App Purchase]');

  /**
   * Staff / QA / demo-account orders are never a conversion (lib/meta/internal-orders.ts,
   * the same rule the browser pixel and the Meta server Purchase apply). The ledger row
   * is closed so the retry cron and the recovery scan do not re-examine it every run.
   */
  async function closeAsInternal(orderId: string, why: string): Promise<void> {
    const lastError = `internal order (${why}): not reported to Snap`.slice(0, 500);
    const key = { platform_eventName_orderId: { platform: PLATFORM, eventName: EVENT, orderId } };
    try {
      const row = await db.adConversionDelivery.findUnique({ where: key });
      if (!row) {
        await db.adConversionDelivery.create({
          data: { platform: PLATFORM, eventName: EVENT, orderId, eventId: orderId, status: 'skipped', lastError },
        });
      } else if (row.status === 'pending' || row.status === 'failed') {
        await db.adConversionDelivery.updateMany({
          where: { id: row.id, status: { in: ['pending', 'failed'] } },
          data: { status: 'skipped', leaseUntil: null, lastError },
        });
      }
    } catch (err: any) {
      console.warn(`[Snap App Purchase] could not close internal order ${orderId}:`, isMissingTable(err) ? 'ledger table missing' : err?.message);
    }
  }

  /** A validation-only answer recorded nothing at Snap: never mark the Purchase as delivered. */
  const send: SnapAppPurchaseDeps['send'] = async (input, cfg) => {
    const res = await rawSend(input, cfg);
    if (res.success && res.validateOnly) {
      return { success: false, blocked: 'validate', error: 'snap_validate_only: payload accepted by /events/validate, nothing recorded' };
    }
    return res;
  };

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
    if (isUnresolvedRecoveryOrder(order)) return { status: 'skipped', reason: 'webhook-recovered order with unknown items' };
    const internal = internalOrderReason(order);
    if (internal) {
      await closeAsInternal(orderId, internal);
      return { status: 'skipped', reason: `internal order (${internal})` };
    }
    const payStatus = String(order.paymentStatus || '').toLowerCase();
    if (!SNAP_PURCHASE_PAYMENT_STATUSES.has(payStatus)) return { status: 'skipped', reason: `paymentStatus=${payStatus || 'empty'}` };
    if (snapPurchaseValue(order) === null) return { status: 'skipped', reason: 'order value missing or negative' };

    const { device } = splitContext(stored?.context || {});
    if (!device) return { status: 'skipped', reason: 'no device context from the app (older app version)' };
    const cfg = snapAppConfig(device.platform, env);
    if (!cfg) return { status: 'skipped', reason: `Snap app not configured for ${device.platform}` };

    const out = await ledger.deliver({
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
    // A refused token can be specific to one Snap App ID (iOS vs Android): name it,
    // so the retry job can keep sending the other app's Purchases.
    return out.status === 'failed' && out.blocked ? { ...out, asset: cfg.snapAppId } : out;
  }

  /** The Snap App ID an order's Purchase goes to (from the device context the app stored), or null. */
  async function snapAssetOfOrder(orderId: string): Promise<string | null> {
    try {
      const row = await db.adConversionDelivery.findUnique({
        where: { platform_eventName_orderId: { platform: PLATFORM, eventName: EVENT, orderId } },
        select: { context: true },
      });
      const { device } = splitContext(row?.context || {});
      return device ? snapAppConfig(device.platform, env)?.snapAppId || null : null;
    } catch {
      return null;
    }
  }

  /**
   * Retry + recovery job (cron). Same steps and tally keys as the website job
   * (lib/snap/purchase.ts retryPendingSnapPurchases):
   *  - expire pending rows past Snap's 7-day window;
   *  - resend failed / lease-expired rows, with backoff; when Snap refuses the
   *    token for one Snap App ID, only that app's rows wait (attempts kept) and
   *    the other app's Purchases are still sent;
   *  - close rows that really failed MAX_ATTEMPTS times and report them once;
   *  - recover paid app orders whose row is still PENDING (> 15 min) once the
   *    capture is independently verified. Found from the orders side, so abandoned
   *    checkouts can no longer keep a paid order waiting.
   */
  async function retryPendingSnapAppPurchases(limit = 25, opts: RetryRunOptions = {}): Promise<Record<string, number>> {
    const tally: Record<string, number> = {};
    const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };
    // Runs after the website job in the same request: a smaller share of the 60 s.
    const deadline = retryDeadline(opts, SNAP_APP_RETRY_RUN_BUDGET_MS);
    const outOfTime = () => { if (Date.now() < deadline) return false; tally.time_budget_reached = 1; return true; };
    // Snap App IDs whose token was refused in this run: their rows are left alone.
    const blockedAssets = new Set<string>();
    const assetBlocked = async (orderId: string) =>
      blockedAssets.size > 0 && blockedAssets.has((await snapAssetOfOrder(orderId)) || '');
    try {
      const expired = await ledger.expireStalePending(PLATFORM, EVENT);
      if (expired) tally.expired = expired;

      let blocked: string | null = null;
      const now = Date.now();
      const due = (await ledger.retryableRows(PLATFORM, EVENT, Math.max(limit * 20, 500)))
        .filter((r: LedgerRowSummary) => isSnapRetryDue(r, now))
        .sort(bySnapEventAge)
        .slice(0, limit);
      for (const row of due) {
        if (outOfTime()) break;
        const orderId = row.orderId;
        if (await assetBlocked(orderId)) { bump('retry_waiting_auth'); continue; }
        const out = await emitSnapAppPurchase(orderId, { paymentConfirmed: true });
        if (out.status === 'failed' && out.blocked) {
          bump(`blocked_${out.blocked}`);
          if (out.blocked === 'auth' && out.asset) { blockedAssets.add(out.asset); continue; }
          blocked = out.blocked; // validation-only mode: nothing can be recorded in this run
          break;
        }
        bump(`retry_${out.status}`);
        // A retry that can never succeed (order refunded / deleted / not reportable)
        // is closed, so it cannot sit at the head of the retry queue forever. Other
        // skips (e.g. app not configured) stay retryable but move to the back of the
        // queue (updatedAt), so they cannot starve the rest.
        if (out.status === 'skipped' && !/^(already |claimed by another)/.test(out.reason)) {
          const terminal = SNAP_TERMINAL_RETRY_SKIP.test(out.reason);
          await db.adConversionDelivery.updateMany({
            where: {
              platform: PLATFORM, eventName: EVENT, orderId,
              OR: [{ status: 'failed' }, { status: 'sending', leaseUntil: { lt: new Date() } }],
            },
            data: terminal
              ? { status: 'skipped', leaseUntil: null, lastError: `closed on retry: ${out.reason}`.slice(0, 500) }
              : { lastError: `retry skipped: ${out.reason}`.slice(0, 500) },
          }).catch(() => null);
          if (terminal) bump('retry_closed');
        }
      }

      const closed = await closeExhaustedRows(ledger, PLATFORM, EVENT, '[Snap App Purchase]');
      if (closed.exhausted.length) tally.exhausted = closed.exhausted.length;
      if (closed.expiredUnsent) tally.expired_unsent = closed.expiredUnsent;

      if (!verifyCapture || blocked || outOfTime()) return tally;

      // Only orders that already have a (pending) row: the row holds the device
      // context the app sent, without which no MOBILE_APP event can be built.
      const { candidates, truncated } = await findRecoveryCandidates(db, ledger, {
        platform: PLATFORM,
        eventName: EVENT,
        paidStatuses: Array.from(SNAP_PURCHASE_PAYMENT_STATUSES),
        acceptsOrderType: (t) => NATIVE_APP_ORDER_TYPES.has(t),
      });
      if (truncated) tally.scan_truncated = 1;
      const batch = candidates.slice(0, limit * 4);
      if (!batch.length) return tally;

      const details = new Map<string, any>((await db.order.findMany({
        where: { id: { in: batch.map(c => c.orderId) } },
        select: { id: true, paymentStatus: true, paymentMethod: true, razorpayPaymentId: true, orderType: true },
      })).map((o: any) => [o.id, o]));

      let sends = 0;
      for (const cand of batch) {
        if (sends >= limit || outOfTime()) break;
        // Rows of an app whose token was refused in this run wait (no Razorpay call for them).
        if (await assetBlocked(cand.orderId)) { bump('pending_waiting_auth'); continue; }
        const order = details.get(cand.orderId);
        let hold: string | null = null;
        if (!order) hold = 'no_order';
        else if (!NATIVE_APP_ORDER_TYPES.has(String(order.orderType || '').toUpperCase())) hold = 'not_app';
        else if (!SNAP_PURCHASE_PAYMENT_STATUSES.has(String(order.paymentStatus || '').toLowerCase())) hold = 'unpaid';
        else if (!(await verifyCapture(order).catch(() => false))) hold = 'capture_unverified';
        if (hold) {
          bump(`pending_${hold}`);
          await ledger.noteRecoveryCheck(PLATFORM, EVENT, cand.orderId, cand.rowId, `recovery: ${hold}`);
          continue;
        }
        const out = await emitSnapAppPurchase(cand.orderId, { paymentConfirmed: true });
        sends++;
        if (out.status === 'failed' && out.blocked) {
          bump(`blocked_${out.blocked}`);
          if (out.blocked === 'auth' && out.asset) { blockedAssets.add(out.asset); continue; }
          break;
        }
        bump(`recovered_${out.status}`);
        if (out.status === 'skipped' && !/^already /.test(out.reason)) {
          await ledger.noteRecoveryCheck(PLATFORM, EVENT, cand.orderId, cand.rowId, `recovery skipped: ${out.reason}`);
        }
      }
    } catch (err: any) {
      const code = isMissingTable(err) ? 'ledger_table_missing' : 'ledger_error';
      tally[code] = 1;
      console.error(`[Snap App Purchase][ALERT] ${code}`, JSON.stringify({ error: String(err?.message || err).slice(0, 300) }));
    }
    return tally;
  }

  return { recordSnapAppContext, emitSnapAppPurchase, retryPendingSnapAppPurchases };
}
