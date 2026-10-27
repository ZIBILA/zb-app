/**
 * The ONE authoritative server-side Snap CAPI PURCHASE for WEB orders.
 *
 *  - Everything (value, currency, items, quantities, variant IDs, status) is
 *    read from the database. Nothing a browser submits is trusted.
 *  - Value and currency are the order's own: Order.totalPrice in Order.currency,
 *    the amount and currency the shopper was charged (INR, USD, GBP, …). Nothing
 *    is converted and no market is assumed.
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
 *  - app/api/payments/webhook/route.ts   (second Razorpay webhook endpoint)
 *  - app/api/checkout/razorpay/route.ts  (records click context before payment)
 *  - app/api/cron/snap-conversions       (retry + recovery job below)
 */
import { pickRealEmail, pickRealName } from '@/lib/tracking/placeholder-identity';
import { isUnresolvedRecoveryOrder } from '@/lib/tracking/order-guards';
import { snapPurchasePhone } from '@/lib/snap/identity';
import type { SnapCapiEventPayload } from '@/lib/snap-capi';
import { createDeliveryLedger, isMissingTable, MAX_ATTEMPTS, type DeliveryResult, type LedgerRowSummary } from '@/lib/snap/ledger';
import { findRecoveryCandidates } from '@/lib/snap/recovery';
import { snapCatalogIdFromOrderItem } from '@/lib/snap/catalog-id';
import { snapDefaultSiteOrigin, snapStorefrontOrigin } from '@/lib/snap/config';
import { isSnapSupportedCurrency, snapPurchaseCurrency } from '@/lib/snap/currency';
import { isPrivateIP } from '@/lib/ip-geo';
import { clientIpFromHeaders } from '@/lib/client-ip';

const PLATFORM = 'snap';
const EVENT = 'PURCHASE';

/** Payment states that represent a completed conversion. */
export const SNAP_PURCHASE_PAYMENT_STATUSES = new Set(['paid', 'cod_upfront_paid']);
/** Order types created by the native iOS / Android apps. */
export const NATIVE_APP_ORDER_TYPES = new Set(['MOBILE', 'MOBILE_APP', 'APP']);
/** Order type every website checkout writes (checkout, Razorpay pre-create, recovery). */
const WEBSITE_ORDER_TYPE = 'WEB_STORE';

export interface SnapClickContext {
  scClickId?: string;
  scCookie1?: string;
  externalId?: string;
  ipAddress?: string;
  userAgent?: string;
  /** Origin of the storefront page the shopper paid on (https://zicabella.com …). */
  pageOrigin?: string;
}


function readCookie(header: string, name: string): string | undefined {
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!m) return undefined;
  try { return decodeURIComponent(m[1]) || undefined; } catch { return m[1] || undefined; }
}

/** Snap identifiers from the shopper's own browser request (never from the body). */
export function snapContextFromRequest(req: Request): SnapClickContext {
  const cookie = req.headers.get('cookie') || '';
  const ip = clientIpFromHeaders(req.headers)
    || readCookie(cookie, 'zb_client_ip')
    || undefined;
  return {
    scClickId: readCookie(cookie, 'ScCid') || readCookie(cookie, '_sccid'),
    scCookie1: readCookie(cookie, '_scid'),
    externalId: readCookie(cookie, 'zb_external_id'),
    ipAddress: ip && !isPrivateIP(ip) ? ip : undefined,
    userAgent: req.headers.get('user-agent') || undefined,
    // The storefront host the shopper is really on (apex / app subdomain), taken
    // from the browser's own Origin / Referer and accepted only for our hosts.
    pageOrigin: snapStorefrontOrigin(req.headers.get('origin'))
      || snapStorefrontOrigin(req.headers.get('referer'))
      || undefined,
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
 * The amount is in the order's own currency (see lib/snap/currency.ts).
 * A 100% store-credit order is a real purchase with value 0.
 * Returns null when the stored value is unusable.
 */
export function snapPurchaseValue(order: { totalPrice?: unknown }): number | null {
  const v = Number(order?.totalPrice);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
}

/** Page the conversion happened on: the confirmation page on the shopper's own storefront host. */
export function snapPurchaseSourceUrl(orderId: string, ctx: SnapClickContext | undefined): string {
  // The stored origin is re-checked here: it is read back from the database.
  const origin = snapStorefrontOrigin(ctx?.pageOrigin) || snapDefaultSiteOrigin();
  return `${origin}/orders/${orderId}/confirmation`;
}

/** Build the CAPI PURCHASE from the stored order. Exported for tests. */
export function buildPurchaseFromOrder(order: any, ctx: SnapClickContext, eventTimeMs: number) {
  const addr = parseAddress(order.shippingAddress);
  const name = String(pickRealName(order.customer?.name, addr.name) || '').trim().split(/\s+/).filter(Boolean);

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

  return {
    eventName: EVENT,
    eventId: order.id,
    eventTime: eventTimeMs,
    eventSourceUrl: snapPurchaseSourceUrl(order.id, ctx),
    userAgent: ctx.userAgent || '',
    ipAddress: ctx.ipAddress,
    scClickId: ctx.scClickId,
    scCookie1: ctx.scCookie1,
    externalId: ctx.externalId || order.customerId || undefined,
    userData: {
      // Placeholder emails (guest@zicabella.com, guest_<ts>@…), dummy phones and
      // names are skipped for the next real value; never sent.
      em: pickRealEmail(order.customer?.email, addr.email),
      // A number is only ever read in the country it was written for (lib/snap/identity.ts).
      ph: snapPurchasePhone(order.customer?.phone, addr.phone),
      fn: name[0],
      ln: name.slice(1).join(' ') || undefined,
      ct: addr.city,
      st: addr.state || addr.province,
      zp: addr.zip || addr.pincode,
      // The customer's own country (ISO code first): it also decides how a
      // national-format phone number and the postcode are normalized.
      country: addr.countryCode || addr.country_code || addr.country,
    },
    customData: {
      value: snapPurchaseValue(order) ?? undefined,
      // The currency the order was charged in — never a fixed one.
      currency: snapPurchaseCurrency(order),
      content_ids: Array.from(new Set(contents.map(c => c.id))),
      contents,
      num_items: numItems || undefined,
      order_id: order.id,
    },
  };
}

/** What the sender reports back (lib/snap-capi.ts SnapSendResult, kept structural for tests). */
type SnapSendOutcome = { success: boolean; error?: any; skipped?: boolean; blocked?: string; validateOnly?: boolean };

export interface SnapPurchaseDeps {
  /** Prisma client (or a compatible fake in tests). */
  db: any;
  send: (payload: SnapCapiEventPayload) => Promise<SnapSendOutcome>;
  /**
   * Independent proof the order's money was captured (used ONLY to recover
   * stranded pending rows). Production: Razorpay payment fetch must report
   * status=captured, captured=true, nothing refunded; full store-credit orders
   * have no gateway payment. Absent → pending rows are never recovered.
   */
  verifyCapture?: (order: { id: string; paymentMethod?: string | null; razorpayPaymentId?: string | null }) => Promise<boolean>;
  /** Why the sender cannot send right now (pixel id / access token missing), else null. */
  configError?: () => string | null;
}

/** Skip reasons that mean a failed delivery can never be sent: close the row. */
const SNAP_TERMINAL_RETRY_SKIP = /^(order not found|not a native app order|native app order|webhook-recovered order|paymentStatus=|order value missing|no device context)/;

/**
 * Minimum wait before the retry job tries a failed row again, by attempts already
 * made. The 5 attempts are spread over ~8 hours instead of being used up in the
 * first hour of a Snap outage.
 */
export const SNAP_RETRY_BACKOFF_MS = [0, 0, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000];
export function isSnapRetryDue(row: { attempts: number; updatedAt: Date | string }, now = Date.now()): boolean {
  const wait = SNAP_RETRY_BACKOFF_MS[Math.max(0, Math.min(Number(row.attempts) || 0, SNAP_RETRY_BACKOFF_MS.length - 1))];
  return now - new Date(row.updatedAt).getTime() >= wait;
}

/**
 * Oldest conversion first: the one closest to Snap's 7-day limit is sent before
 * the others (matters when many are waiting, e.g. after the token was missing).
 */
export function bySnapEventAge(a: { eventTime?: Date | string | null; createdAt: Date | string }, b: { eventTime?: Date | string | null; createdAt: Date | string }): number {
  return new Date(a.eventTime || a.createdAt).getTime() - new Date(b.eventTime || b.createdAt).getTime();
}

/**
 * One retry run must answer well inside the caller's 60 s HTTP timeout (the
 * workflow would otherwise re-run it): no new send is started after this long.
 * Whatever is left is picked up by the next run. The cron route passes one
 * shared deadline for the website and app jobs (see `RetryRunOptions`).
 */
export const SNAP_RETRY_RUN_BUDGET_MS = 25_000;

/** How long a retry run may go on; `deadlineMs` (absolute, Date.now() based) wins over `budgetMs`. */
export interface RetryRunOptions {
  budgetMs?: number;
  deadlineMs?: number;
}

/**
 * Text the pre-fix website sender stored when the access token was missing on the
 * server ("Snap Pixel ID or CAPI Access Token not configured"); the current
 * sender's blocked message starts with "snap_config_missing". Rows whose last
 * error is one of these were never sent.
 */
export const SNAP_LEGACY_CONFIG_ERROR = 'Access Token not configured';
export const SNAP_NEVER_SENT_RE = /Access Token not configured|^snap_config_missing/i;
/** What the retry job writes when it gives such a row its attempts back (must not match the pattern above). */
export const SNAP_REQUEUED_NOTE = 'requeued: the Snap access token is set now; earlier attempts had none';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Close the rows that used up MAX_ATTEMPTS. Rows that were never really tried —
 * every attempt failed for lack of an access token, and they are now past Snap's
 * 7-day window (younger ones were re-queued first) — are closed as expired, not
 * reported as delivery failures. Returns what was closed.
 */
export async function closeExhaustedRows(
  ledger: { exhaustedRows: (platform: string, eventName: string, limit: number) => Promise<LedgerRowSummary[]>; closeRow: (id: string, lastError: string) => Promise<boolean> },
  platform: string,
  eventName: string,
  logTag: string,
): Promise<{ exhausted: LedgerRowSummary[]; expiredUnsent: number }> {
  const rows = await ledger.exhaustedRows(platform, eventName, 100);
  const exhausted: LedgerRowSummary[] = [];
  let expiredUnsent = 0;
  for (const r of rows) {
    const neverSent = SNAP_NEVER_SENT_RE.test(String(r.lastError || ''));
    if (neverSent) {
      if (await ledger.closeRow(r.id, 'expired: never sent (no Snap access token on the server at the time) and now older than Snap\'s 7-day window')) expiredUnsent++;
      continue;
    }
    if (await ledger.closeRow(r.id, `exhausted after ${MAX_ATTEMPTS} attempts: ${r.lastError || ''}`)) exhausted.push(r);
  }
  if (expiredUnsent) {
    console.warn(`${logTag} ${expiredUnsent} Purchase(s) were never sent while the access token was missing and are now too old for Snapchat — closed`);
  }
  if (exhausted.length) {
    console.error(`${logTag}[ALERT] attempts_exhausted`, JSON.stringify({
      count: exhausted.length,
      orderIds: exhausted.slice(0, 20).map(r => r.orderId),
      lastError: String(exhausted[0]?.lastError || '').slice(0, 300),
      hint: `closed as skipped; to resend set status='failed', attempts=0 on ad_conversion_deliveries (platform=${platform}, eventName=${eventName})`,
    }));
  }
  return { exhausted, expiredUnsent };
}

/** Absolute deadline of a retry run. */
export function retryDeadline(opts: RetryRunOptions, defaultBudgetMs: number): number {
  if (Number.isFinite(opts.deadlineMs)) return Number(opts.deadlineMs);
  return Date.now() + (opts.budgetMs ?? defaultBudgetMs);
}

export function createSnapPurchaseDelivery({ db: prisma, send, verifyCapture, configError }: SnapPurchaseDeps) {
  const ledger = createDeliveryLedger(prisma, '[Snap Purchase]');
  const cutoverMemo: { value?: number | null } = {};
  const warnedCurrencies = new Set<string>();

  /**
   * A validation-only answer (SNAP_CAPI_VALIDATE=1 on a staging deploy) means
   * Snap checked the payload and recorded NOTHING, so it must never mark a
   * Purchase as delivered — e.g. when a staging deploy shares the database.
   */
  const sendSnapEvent: SnapPurchaseDeps['send'] = async (payload) => {
    const res = await send(payload);
    if (res.success && res.validateOnly) {
      return { success: false, blocked: 'validate', error: 'snap_validate_only: payload accepted by /events/validate, nothing recorded' };
    }
    return res;
  };

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
    if (isUnresolvedRecoveryOrder(order)) {
      return { status: 'skipped', reason: 'webhook-recovered order with unknown items' };
    }
    const payStatus = String(order.paymentStatus || '').toLowerCase();
    if (!SNAP_PURCHASE_PAYMENT_STATUSES.has(payStatus)) {
      return { status: 'skipped', reason: `paymentStatus=${payStatus || 'empty'}` };
    }
    if (snapPurchaseValue(order) === null) return { status: 'skipped', reason: 'order value missing or negative' };

    const currency = snapPurchaseCurrency(order);
    if (!isSnapSupportedCurrency(currency) && !warnedCurrencies.has(currency)) {
      warnedCurrencies.add(currency);
      console.warn(`[Snap Purchase] order ${orderId} was charged in ${currency}, which Snapchat does not list as a supported currency — sent exactly as charged`);
    }

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
   * Retry + recovery job (cron, every 15 min). Returns a flat tally of what happened:
   *
   *   expired                pending rows past Snap's 7-day window, closed
   *   blocked_config         the access token / pixel id is missing — nothing was tried
   *   requeued               purchases that ran out of attempts WHILE the token was
   *                          missing and are still inside Snap's window: tried again
   *   retry_sent / _failed / _skipped / retry_closed   failed rows retried (with backoff)
   *   blocked_auth           Snap refused the token — the job stops, attempts are kept
   *   exhausted              rows closed after MAX_ATTEMPTS real failures (alerted once)
   *   expired_unsent         rows that only ever failed for lack of a token and are
   *                          now past Snap's window: closed, not alerted
   *   recovered_sent / …     paid orders no live path delivered (see lib/snap/recovery.ts)
   *   pending_<why>          paid orders looked at but not sendable yet
   *   time_budget_reached    the run stopped early to stay inside its time budget
   *   scan_truncated, ledger_error, ledger_table_missing
   */
  async function retryPendingSnapPurchases(limit = 25, opts: RetryRunOptions = {}): Promise<Record<string, number>> {
    const tally: Record<string, number> = {};
    const bump = (k: string, n = 1) => { tally[k] = (tally[k] || 0) + n; };
    const deadline = retryDeadline(opts, SNAP_RETRY_RUN_BUDGET_MS);
    const outOfTime = () => { if (Date.now() < deadline) return false; tally.time_budget_reached = 1; return true; };
    try {
      const expired = await ledger.expireStalePending(PLATFORM, EVENT);
      if (expired) tally.expired = expired;

      // Nothing can be sent without the token: do no work and burn no attempts.
      if (configError?.()) {
        tally.blocked_config = 1;
        return tally;
      }

      // Purchases that used up their attempts while the token was missing are
      // not lost as long as Snap still accepts their (unchanged) event time.
      const windowStart = new Date(Date.now() - SEVEN_DAYS_MS);
      const requeued = await prisma.adConversionDelivery.updateMany({
        where: {
          platform: PLATFORM, eventName: EVENT, status: 'failed', attempts: { gte: MAX_ATTEMPTS },
          lastError: { contains: SNAP_LEGACY_CONFIG_ERROR },
          OR: [{ eventTime: { gt: windowStart } }, { eventTime: null, createdAt: { gt: windowStart } }],
        },
        data: { attempts: 0, lastError: SNAP_REQUEUED_NOTE },
      });
      if (requeued?.count) tally.requeued = requeued.count;

      let blocked: string | null = null;
      const now = Date.now();
      const due = (await ledger.retryableRows(PLATFORM, EVENT, Math.max(limit * 20, 500)))
        .filter((r: LedgerRowSummary) => isSnapRetryDue(r, now))
        .sort(bySnapEventAge)
        .slice(0, limit);
      for (const row of due) {
        if (outOfTime()) break;
        const orderId = row.orderId;
        // Rows only reach failed / sending after a payment-confirmed attempt.
        const out = await emitSnapPurchase(orderId, undefined, { paymentConfirmed: true });
        if (out.status === 'failed' && out.blocked) {
          // Token refused (or validation-only mode): every further send would
          // fail the same way. Stop here; the row keeps its attempts.
          blocked = out.blocked;
          bump(`blocked_${out.blocked}`);
          break;
        }
        bump(`retry_${out.status}`);
        // A retry that can never succeed (order refunded / deleted / not reportable)
        // is closed, so it cannot sit at the head of the retry queue forever. Other
        // skips (e.g. app not configured) stay retryable but move to the back of the
        // queue (updatedAt), so they cannot starve the rest.
        if (out.status === 'skipped' && !/^(already |claimed by another)/.test(out.reason)) {
          const terminal = SNAP_TERMINAL_RETRY_SKIP.test(out.reason);
          await prisma.adConversionDelivery.updateMany({
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

      // Rows that really failed MAX_ATTEMPTS times: close them (lastError kept) and
      // report them once. To resend one: status='failed', attempts=0.
      const closed = await closeExhaustedRows(ledger, PLATFORM, EVENT, '[Snap Purchase]');
      if (closed.exhausted.length) tally.exhausted = closed.exhausted.length;
      if (closed.expiredUnsent) tally.expired_unsent = closed.expiredUnsent;

      if (!verifyCapture || blocked || outOfTime()) return tally;

      // Paid orders no live path delivered: a row still "pending" (capture was
      // unconfirmed at checkout and no captured webhook sent it), or — for
      // website orders — no row at all (the ledger write failed at the time).
      const { candidates, truncated } = await findRecoveryCandidates(prisma, ledger, {
        platform: PLATFORM,
        eventName: EVENT,
        paidStatuses: Array.from(SNAP_PURCHASE_PAYMENT_STATUSES),
        acceptsOrderType: (t) => !NATIVE_APP_ORDER_TYPES.has(t),
        acceptsMissingRow: (t) => t === WEBSITE_ORDER_TYPE,
        cutoverMemo,
      });
      if (truncated) tally.scan_truncated = 1;
      const batch = candidates.slice(0, limit * 4);
      if (!batch.length) return tally;

      const details = new Map<string, any>((await prisma.order.findMany({
        where: { id: { in: batch.map(c => c.orderId) } },
        select: {
          id: true, paymentStatus: true, paymentMethod: true, razorpayPaymentId: true, orderType: true,
          tags: true, totalPrice: true, items: { select: { variantId: true, sku: true } },
        },
      })).map((o: any) => [o.id, o]));

      let sends = 0;
      for (const cand of batch) {
        if (sends >= limit || outOfTime()) break;
        const order = details.get(cand.orderId);
        let hold: string | null = null;
        if (!order) hold = 'no_order';
        else if (NATIVE_APP_ORDER_TYPES.has(String(order.orderType || '').toUpperCase())) hold = 'not_web';
        else if (!SNAP_PURCHASE_PAYMENT_STATUSES.has(String(order.paymentStatus || '').toLowerCase())) hold = 'unpaid';
        else if (isUnresolvedRecoveryOrder(order)) hold = 'unresolved_items';
        else if (snapPurchaseValue(order) === null) hold = 'no_value';
        else if (!(await verifyCapture(order).catch(() => false))) hold = 'capture_unverified';
        if (hold) {
          bump(`pending_${hold}`);
          await ledger.noteRecoveryCheck(PLATFORM, EVENT, cand.orderId, cand.rowId, `recovery: ${hold}`);
          continue;
        }
        const out = await emitSnapPurchase(cand.orderId, undefined, { paymentConfirmed: true });
        sends++;
        if (out.status === 'failed' && out.blocked) {
          bump(`blocked_${out.blocked}`);
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
      console.error(`[Snap Purchase][ALERT] ${code}`, JSON.stringify({ error: String(err?.message || err).slice(0, 300) }));
    }
    return tally;
  }

  return { recordSnapPurchaseContext, emitSnapPurchase, retryPendingSnapPurchases };
}
