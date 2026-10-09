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
import { isPlaceholderEmail } from '@/lib/tracking/placeholder-identity';

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

export function decideMetaBrowserPurchase(
  order: any,
  opts: { alreadySent: boolean; nowMs?: number },
): MetaBrowserPurchaseDecision {
  if (!order?.id) return { action: 'done', reason: 'no order' };
  if (opts.alreadySent) return { action: 'done', reason: 'already sent' };
  if (!isWebsiteOrder(order)) return { action: 'done', reason: 'not a website order' };
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
  const nameParts = String(cust.name || addr?.name || '').trim().split(/\s+/).filter(Boolean);
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
        ph: addr?.phone || cust.phone || undefined,
      }
    : undefined;

  return {
    orderId: order.id,
    value,
    currency: metaPurchaseCurrency(order),
    contentIds: contents.map((c: any) => c.id),
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
export async function dispatchMetaBrowserPurchaseOnce(
  orderId: string,
  dispatch: () => boolean | Promise<boolean>,
  deps: { store?: MarkerStore; lock?: LockRunner; nowMs?: () => number } = {},
): Promise<boolean> {
  const store = deps.store ?? browserMarkerStore();
  const lock = deps.lock ?? defaultLock;
  const key = metaBrowserPurchaseKey(orderId);
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

/**
 * Resolve true once the Meta Pixel function (`window.fbq`) exists, false after
 * `timeoutMs` (blocked by an extension / failed to load). Same 3 s budget as
 * withFbq in lib/metaPixel.ts, so "false" means the Pixel call would be dropped.
 */
export function waitForFbq(timeoutMs = 3000, stepMs = 100): Promise<boolean> {
  const has = () => typeof window !== 'undefined' && typeof (window as any).fbq === 'function';
  if (has()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const t = setInterval(() => {
      if (has()) { clearInterval(t); resolve(true); }
      else if (Date.now() - started >= timeoutMs) { clearInterval(t); resolve(false); }
    }, stepMs);
  });
}
