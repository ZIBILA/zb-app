/**
 * Browser Meta Pixel Purchase on the order confirmation page — decision + once-only
 * dispatch. Isomorphic and dependency-injected so it can be unit-tested in Node
 * (scripts/verify-meta-purchase.ts).
 *
 * Rules
 *  - Fire only for a confirmed payment (paid / cod_upfront_paid), website orders
 *    only, value from the stored order (lib/meta/order-value), eventID = order id
 *    (the same event_id as the server CAPI Purchase → Meta dedups the pair).
 *  - The "sent" marker is written only AFTER the Pixel call has been dispatched.
 *    A visit while the payment is still pending writes nothing, so the page (or a
 *    later refresh / another tab) can still fire once the order becomes paid.
 *  - Several tabs: dispatch runs inside a Web Lock named after the order (when the
 *    browser supports navigator.locks), re-checking the marker inside the lock, so
 *    only one tab fires. Without Web Locks the check→dispatch→mark sequence is
 *    synchronous, leaving only a sub-millisecond window, and the shared event_id
 *    still lets Meta deduplicate.
 */
import { metaPurchaseValue, metaPurchaseCurrency, isWebsiteOrder } from './order-value';
import { snapCatalogIdFromOrderItem } from '@/lib/snap/catalog-id';
import { isPlaceholderEmail, pickRealName, pickRealPhone } from '@/lib/tracking/placeholder-identity';

export const META_BROWSER_PURCHASE_KEY_PREFIX = 'zb_meta_pixel_purchase_sent_';
export const metaBrowserPurchaseKey = (orderId: string) => `${META_BROWSER_PURCHASE_KEY_PREFIX}${orderId}`;

/** Orders older than this never fire a browser Purchase (stale receipt revisits). */
export const META_BROWSER_PURCHASE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Payment states that can still turn into paid (webhook capture pending). */
export const META_AWAITING_PAYMENT_STATUSES = new Set(['payment_pending', 'pending', 'authorized']);
const PAID = new Set(['paid', 'cod_upfront_paid']);

/** While awaiting capture the confirmation page re-checks the order this often, this many times. */
export const META_PENDING_POLL_INTERVAL_MS = 10_000;
export const META_PENDING_POLL_MAX = 36; // ≈ 6 minutes

export type MetaBrowserPurchaseDecision =
  | { action: 'fire' }
  | { action: 'wait'; reason: string }
  | { action: 'done'; reason: string };

// ── Server-verified order facts ─────────────────────────────────────────────

/**
 * What the browser Purchase needs to know about an order, as the SERVER stores it:
 * payment state, order type, the charged total and its currency, and the items.
 *
 * The confirmation page first paints an optimistic copy of the order built in the
 * checkout (so the shopper sees it instantly). That copy has no payment status —
 * with it alone the decision below is always "done / paymentStatus=empty" and no
 * browser Purchase ever fires. These facts are fetched from
 * /api/orders/[id]/confirmation?view=tracking once the order is registered and
 * kept NEXT TO the optimistic copy (order.serverFacts): what the shopper sees is
 * unchanged, while tracking reads the stored order.
 */
export interface OrderServerFacts {
  paymentStatus: string;
  orderType?: string;
  /** true = staff / QA / demo order: never a Meta or Snap Purchase (lib/meta/internal-orders.ts). */
  internal?: boolean;
  totalPrice?: number;
  currency?: string;
  items?: Array<{ variantId?: string | null; sku?: string | null; quantity?: number; price?: number; title?: string | null }>;
}

/**
 * Facts from a server order payload, or null when the payload carries no payment
 * state (unknown order, a standalone web-store record) or is for another order.
 */
export function pickOrderServerFacts(serverOrder: any, expectedOrderId?: string): OrderServerFacts | null {
  if (!serverOrder || typeof serverOrder !== 'object' || !serverOrder.id) return null;
  if (expectedOrderId && String(serverOrder.id) !== String(expectedOrderId)) return null;
  if (typeof serverOrder.paymentStatus !== 'string' || !serverOrder.paymentStatus.trim()) return null;
  const facts: OrderServerFacts = { paymentStatus: serverOrder.paymentStatus };
  if (typeof serverOrder.orderType === 'string') facts.orderType = serverOrder.orderType;
  if (serverOrder.internal === true) facts.internal = true;
  const total = Number(serverOrder.totalPrice);
  if (serverOrder.totalPrice !== null && serverOrder.totalPrice !== undefined && Number.isFinite(total)) facts.totalPrice = total;
  if (typeof serverOrder.currency === 'string' && serverOrder.currency.trim()) facts.currency = serverOrder.currency;
  if (Array.isArray(serverOrder.items)) {
    facts.items = serverOrder.items.map((i: any) => ({
      variantId: i?.variantId ?? null,
      sku: i?.sku ?? null,
      quantity: Number(i?.quantity) || 1,
      price: Number(i?.price) || 0,
      title: i?.title ?? null,
    }));
  }
  return facts;
}

/** The order as tracking must see it: the displayed copy with the server facts on top. */
export function orderForTracking<T extends Record<string, any> | null | undefined>(order: T): T {
  const facts = order && typeof order === 'object' ? (order as any).serverFacts : null;
  if (!facts || typeof facts !== 'object' || typeof facts.paymentStatus !== 'string') return order;
  return { ...(order as any), ...facts };
}

/** true when the order (as tracking sees it) already carries a payment state. */
export function hasPaymentFacts(order: any): boolean {
  const o = orderForTracking(order);
  return !!o && typeof o.paymentStatus === 'string' && o.paymentStatus.trim() !== '';
}

/**
 * Fetch the server facts for an order. Never throws: null on any failure (the
 * server-side Purchase is the authoritative one and does not depend on this).
 */
export async function fetchOrderServerFacts(
  orderId: string,
  deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<OrderServerFacts | null> {
  const doFetch = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!orderId || !doFetch) return null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), deps.timeoutMs ?? 4000) : null;
  try {
    const res = await doFetch(
      `/api/orders/${encodeURIComponent(orderId)}/confirmation?bypass_auth=true&view=tracking`,
      { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) },
    );
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    return pickOrderServerFacts(data?.order || data, orderId);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Generic decision shared by the Meta and Snap browser Purchase (eligibility differs). */
export function decideBrowserPurchase(
  order: any,
  opts: { alreadySent: boolean; nowMs?: number; isEligible: (order: any) => boolean },
): MetaBrowserPurchaseDecision {
  if (!order?.id) return { action: 'done', reason: 'no order' };
  if (opts.alreadySent) return { action: 'done', reason: 'already sent' };
  if (order.internal === true) return { action: 'done', reason: 'internal order' };
  if (!opts.isEligible(order)) return { action: 'done', reason: 'not eligible for this platform' };
  const created = order.createdAt ? new Date(order.createdAt).getTime() : NaN;
  if (Number.isFinite(created) && (opts.nowMs ?? Date.now()) - created >= META_BROWSER_PURCHASE_MAX_AGE_MS) {
    return { action: 'done', reason: 'stale order' };
  }
  const status = String(order.paymentStatus || '').toLowerCase();
  if (PAID.has(status)) {
    return metaPurchaseValue(order) === null ? { action: 'done', reason: 'no value' } : { action: 'fire' };
  }
  if (META_AWAITING_PAYMENT_STATUSES.has(status)) return { action: 'wait', reason: `paymentStatus=${status}` };
  return { action: 'done', reason: `paymentStatus=${status || 'empty'}` };
}

export function decideMetaBrowserPurchase(
  order: any,
  opts: { alreadySent: boolean; nowMs?: number },
): MetaBrowserPurchaseDecision {
  return decideBrowserPurchase(order, { ...opts, isEligible: isWebsiteOrder });
}

/** Snap web pixel: every order except native-app ones (same rule as lib/snap/purchase.ts). */
const SNAP_NATIVE_APP_TYPES = new Set(['MOBILE', 'MOBILE_APP', 'APP']);
export const SNAP_BROWSER_PURCHASE_KEY_PREFIX = 'zb_snap_pixel_purchase_sent_';
export const snapBrowserPurchaseKey = (orderId: string) => `${SNAP_BROWSER_PURCHASE_KEY_PREFIX}${orderId}`;

export function decideSnapBrowserPurchase(
  order: any,
  opts: { alreadySent: boolean; nowMs?: number },
): MetaBrowserPurchaseDecision {
  return decideBrowserPurchase(order, {
    ...opts,
    isEligible: (o) => !SNAP_NATIVE_APP_TYPES.has(String(o?.orderType || '').trim().toUpperCase()),
  });
}

export interface MetaBrowserPurchaseArgs {
  orderId: string;
  value: number;
  currency: string;
  contentIds: string[];
  contents: Array<{ id: string; quantity: number; item_price?: number; title?: string }>;
  userData?: Record<string, string | undefined>;
}

function parseAddress(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, any>;
  try { return JSON.parse(String(raw)) || null; } catch { return null; }
}

/** Pixel arguments from the stored order — the same value/currency/ids the server CAPI event uses. */
export function buildMetaBrowserPurchaseArgs(order: any): MetaBrowserPurchaseArgs | null {
  const value = metaPurchaseValue(order);
  if (!order?.id || value === null) return null;
  const contents = (order.items || [])
    .map((item: any) => ({
      id: snapCatalogIdFromOrderItem(item) || '',
      quantity: Number(item.quantity) || 1,
      item_price: parseFloat(item.price || '0') || undefined,
      title: item.title,
    }))
    .filter((c: any) => c.id);

  const addr = parseAddress(order.shippingAddress);
  const cust = order.customer || {};
  // Same order as the server event: checkout address first; placeholders skipped.
  const nameParts = String(pickRealName(addr?.name, cust.name) || '').trim().split(/\s+/).filter(Boolean);
  // Checkout address first (freshest); synthetic placeholder emails are never sent.
  const email = [addr?.email, cust.email].find((e: any) => typeof e === 'string' && e.trim() && !isPlaceholderEmail(e));
  const userData = addr || cust.email || cust.phone || nameParts.length
    ? {
        country: addr?.countryCode || addr?.country_code || addr?.country || undefined,
        st: addr?.state || undefined,
        ct: addr?.city || undefined,
        zp: addr?.zip || undefined,
        fn: nameParts[0] || undefined,
        ln: nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined,
        em: email || undefined,
        ph: pickRealPhone(addr?.phone, cust.phone),
      }
    : undefined;

  return {
    orderId: order.id,
    value,
    currency: metaPurchaseCurrency(order),
    // De-duplicated, exactly like the server CAPI event's content_ids.
    contentIds: Array.from(new Set<string>(contents.map((c: any) => c.id))),
    contents,
    userData,
  };
}

export interface MarkerStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** localStorage + sessionStorage (either one marks the order as sent). Storage errors are ignored. */
export function browserMarkerStore(): MarkerStore {
  const stores = (): Storage[] => {
    const out: Storage[] = [];
    try { if (typeof localStorage !== 'undefined') out.push(localStorage); } catch {}
    try { if (typeof sessionStorage !== 'undefined') out.push(sessionStorage); } catch {}
    return out;
  };
  return {
    get: (key) => {
      for (const s of stores()) { try { const v = s.getItem(key); if (v) return v; } catch {} }
      return null;
    },
    set: (key, value) => { for (const s of stores()) { try { s.setItem(key, value); } catch {} } },
  };
}

export const hasMetaBrowserPurchaseBeenSent = (orderId: string, store: MarkerStore = browserMarkerStore()) =>
  store.get(metaBrowserPurchaseKey(orderId)) !== null;
export const hasSnapBrowserPurchaseBeenSent = (orderId: string, store: MarkerStore = browserMarkerStore()) =>
  store.get(snapBrowserPurchaseKey(orderId)) !== null;

type LockRunner = (name: string, fn: () => Promise<void> | void) => Promise<void>;

const defaultLock: LockRunner = async (name, fn) => {
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  if (locks?.request) {
    try { await locks.request(name, async () => { await fn(); }); return; } catch {}
  }
  await fn();
};

/**
 * Dispatch the Pixel Purchase at most once per order across refreshes and tabs.
 * `dispatch` returns true when the Pixel call was made; only then is the marker set.
 * Resolves to true if THIS call dispatched.
 */
export async function dispatchBrowserPurchaseOnce(
  key: string,
  dispatch: () => boolean | Promise<boolean>,
  deps: { store?: MarkerStore; lock?: LockRunner; nowMs?: () => number } = {},
): Promise<boolean> {
  const store = deps.store ?? browserMarkerStore();
  const lock = deps.lock ?? defaultLock;
  let fired = false;
  await lock(key, async () => {
    if (store.get(key) !== null) return;
    let ok = false;
    try { ok = await dispatch(); } catch { ok = false; }
    if (ok) {
      store.set(key, String(deps.nowMs ? deps.nowMs() : Date.now()));
      fired = true;
    }
  });
  return fired;
}

export const dispatchMetaBrowserPurchaseOnce = (
  orderId: string,
  dispatch: () => boolean | Promise<boolean>,
  deps: { store?: MarkerStore; lock?: LockRunner; nowMs?: () => number } = {},
) => dispatchBrowserPurchaseOnce(metaBrowserPurchaseKey(orderId), dispatch, deps);

export const dispatchSnapBrowserPurchaseOnce = (
  orderId: string,
  dispatch: () => boolean | Promise<boolean>,
  deps: { store?: MarkerStore; lock?: LockRunner; nowMs?: () => number } = {},
) => dispatchBrowserPurchaseOnce(snapBrowserPurchaseKey(orderId), dispatch, deps);

/**
 * Resolve true once the Meta Pixel function (`window.fbq`) exists, false after
 * `timeoutMs` (blocked by an extension / failed to load). Same 3 s budget as
 * withFbq in lib/metaPixel.ts, so "false" means the Pixel call would be dropped.
 */
export function waitForFbq(timeoutMs = 3000, stepMs = 100): Promise<boolean> {
  return waitForGlobalFn('fbq', timeoutMs, stepMs);
}

/** Same for Snapchat's `window.snaptr` (withSnaptr in lib/snapPixel.ts also gives up after ~3 s). */
export function waitForSnaptr(timeoutMs = 3000, stepMs = 100): Promise<boolean> {
  return waitForGlobalFn('snaptr', timeoutMs, stepMs);
}

function waitForGlobalFn(name: string, timeoutMs: number, stepMs: number): Promise<boolean> {
  const has = () => typeof window !== 'undefined' && typeof (window as any)[name] === 'function';
  if (has()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const t = setInterval(() => {
      if (has()) { clearInterval(t); resolve(true); }
      else if (Date.now() - started >= timeoutMs) { clearInterval(t); resolve(false); }
    }, stepMs);
  });
}
