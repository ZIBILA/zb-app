import { trackSnapClientEvent, getSnapIdentityCookies, getClientCookie } from '@/lib/snapPixel';
import type { RawIdentity } from '@/lib/tracking/identity-normalize';
import { normalizeVariantId } from '@/lib/snap/catalog-id';

/**
 * Snap Pixel + Conversions API dual tracking.
 *
 * Every event is fired twice with ONE shared id:
 *   browser:  snaptr('track', EVENT, { …pixel params, client_dedup_id: id })
 *   server:   POST /api/snap/event → CAPI v3 { event_id: id, custom_data: {…v3 params} }
 * Snap deduplicates on client_dedup_id ⇄ event_id (and, for PURCHASE,
 * transaction_id ⇄ order_id). The two sides use DIFFERENT parameter names:
 *
 *   pixel            CAPI v3
 *   price         →  value
 *   item_ids      →  content_ids
 *   item_category →  content_category
 *   number_items  →  num_items
 *   transaction_id→  order_id
 *   description   →  content_name
 */

export interface SnapContent {
  id: string;
  quantity?: number;
  item_price?: number;
}

function uuidv4() {
  if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
    return (crypto as any).randomUUID() as string;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const firedEventsCache = new Map<string, number>();
function shouldFireEvent(key: string, windowMs = 1000): boolean {
  const now = Date.now();
  const lastFired = firedEventsCache.get(key);
  if (lastFired && now - lastFired < windowMs) return false;
  firedEventsCache.set(key, now);
  return true;
}

const CHECKOUT_EVENTS = ['START_CHECKOUT', 'ADD_BILLING'];

function sendToSnapCapiRoute(payload: {
  eventName: string;
  eventId: string;
  eventSourceUrl: string;
  userAgent: string;
  eventTime: number;
  customData?: Record<string, any>;
  userData?: RawIdentity;
}): void {
  try {
    const cookies = getSnapIdentityCookies();
    const isLoggedIn = getClientCookie('zb_user_logged_in') === 'true';
    const isCheckoutEvent = CHECKOUT_EVENTS.includes(payload.eventName);

    // Hashed PII cookies are only attached for logged-in users or checkout events
    // (privacy decision: avoids attributing a shared device to a previous guest).
    const cookiePii: RawIdentity = (isLoggedIn || isCheckoutEvent)
      ? { em: cookies.em, ph: cookies.ph, fn: cookies.fn, ln: cookies.ln,
          ct: cookies.ct, st: cookies.st, zp: cookies.zp, country: cookies.country }
      : { ct: cookies.ct, st: cookies.st, zp: cookies.zp, country: cookies.country };

    // Explicit raw data (checkout form / order) wins over cookies field-by-field.
    const userData: Record<string, any> = { ...cookiePii };
    for (const [k, v] of Object.entries(payload.userData || {})) {
      if (v) userData[k] = v;
    }

    const body = JSON.stringify({
      ...payload,
      userData,
      scClickId: cookies.sc_click_id,
      scCookie1: cookies.sc_cookie1,
      externalId: cookies.external_id,
    });

    // keepalive lets PURCHASE / ADD_BILLING survive an immediate navigation
    // (e.g. redirect to Razorpay or to the confirmation page).
    fetch('/api/snap/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: body.length < 60000,
    }).catch(err => console.warn('[Snap CAPI send error]', err));
  } catch (err) {
    console.warn('[Snap CAPI send error]', err);
  }
}

function base(eventName: string, fixedId?: string) {
  return {
    eventId: fixedId || `${eventName.toLowerCase()}_snap_${uuidv4()}`,
    eventName,
    eventSourceUrl: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    eventTime: Date.now(),
  };
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : undefined;
};
const ids = (list?: Array<string | number | null | undefined>) =>
  (list || []).map(i => String(i ?? '').trim()).filter(Boolean);

// ─── Plain functions (usable outside React, e.g. contexts) ────────────────────

export function snapTrackViewContent(
  contentId: string,
  contentName: string,
  value?: number,
  currency = 'INR',
  contentCategory?: string,
  userData?: RawIdentity
) {
  if (!contentId || !shouldFireEvent(`Snap-ViewContent-${contentId}`)) return;
  const cid = toSnapItemId(contentId);
  const cidList = cid ? [cid] : undefined;
  const b = base('VIEW_CONTENT');
  const price = num(value);
  trackSnapClientEvent('VIEW_CONTENT', {
    price, currency, item_ids: cidList, item_category: contentCategory, description: contentName,
  }, b.eventId, userData);
  sendToSnapCapiRoute({ ...b, userData, customData: {
    value: price, currency, content_ids: cidList, content_category: contentCategory, content_name: contentName,
    contents: cid ? [{ id: cid, quantity: 1, item_price: price }] : undefined,
  } });
}

export function snapTrackAddToCart(
  contentId: string,
  contentName: string,
  value: number,
  currency = 'INR',
  contentCategory?: string,
  numberItems = 1
) {
  if (!contentId || !shouldFireEvent(`Snap-AddToCart-${contentId}`)) return;
  const cid = toSnapItemId(contentId);
  const cidList = cid ? [cid] : undefined;
  const b = base('ADD_CART');
  const unit = num(value);
  const total = unit !== undefined ? unit * numberItems : undefined;
  trackSnapClientEvent('ADD_CART', {
    price: total, currency, item_ids: cidList, item_category: contentCategory,
    number_items: numberItems, description: contentName,
  }, b.eventId);
  sendToSnapCapiRoute({ ...b, customData: {
    value: total, currency, content_ids: cidList, content_category: contentCategory,
    content_name: contentName, num_items: numberItems,
    contents: cid ? [{ id: cid, quantity: numberItems, item_price: unit }] : undefined,
  } });
}

export function snapTrackAddToWishlist(
  contentId: string,
  contentName: string,
  contentCategory?: string,
  value?: number,
  currency = 'INR'
) {
  if (!contentId || !shouldFireEvent(`Snap-Wishlist-${contentId}`)) return;
  const cid = toSnapItemId(contentId);
  const cidList = cid ? [cid] : undefined;
  const b = base('ADD_TO_WISHLIST');
  const price = num(value);
  trackSnapClientEvent('ADD_TO_WISHLIST', {
    price, currency: price !== undefined ? currency : undefined,
    item_ids: cidList, item_category: contentCategory, description: contentName,
  }, b.eventId);
  sendToSnapCapiRoute({ ...b, customData: {
    value: price, currency: price !== undefined ? currency : undefined,
    content_ids: cidList, content_category: contentCategory, content_name: contentName,
  } });
}

export function snapTrackSearch(searchString: string, contentIds?: string[], contentCategory?: string) {
  const q = (searchString || '').trim();
  if (!q || !shouldFireEvent(`Snap-Search-${q.toLowerCase()}`, 3000)) return;
  const b = base('SEARCH');
  const idList = ids(contentIds);
  trackSnapClientEvent('SEARCH', {
    search_string: q, item_ids: idList, item_category: contentCategory,
  }, b.eventId);
  sendToSnapCapiRoute({ ...b, customData: {
    search_string: q, content_ids: idList, content_category: contentCategory,
  } });
}

export function snapTrackStartCheckout(
  value: number,
  numberItems: number,
  currency = 'INR',
  contentCategory?: string,
  contentIds?: string[],
  userData?: RawIdentity,
  contents?: SnapContent[]
) {
  if (!shouldFireEvent(`Snap-StartCheckout-${value}-${numberItems}`)) return;
  const b = base('START_CHECKOUT');
  const idList = ids(contentIds);
  trackSnapClientEvent('START_CHECKOUT', {
    price: num(value), currency, number_items: numberItems, item_category: contentCategory, item_ids: idList,
  }, b.eventId, userData);
  sendToSnapCapiRoute({ ...b, userData, customData: {
    value: num(value), currency, num_items: numberItems, content_category: contentCategory,
    content_ids: idList, contents,
  } });
}

export function snapTrackAddBilling(
  value: number,
  currency = 'INR',
  userData?: RawIdentity,
  contentIds?: string[],
  numberItems?: number,
  contents?: SnapContent[]
) {
  if (!shouldFireEvent(`Snap-AddBilling-${value}`, 3000)) return;
  const b = base('ADD_BILLING');
  const idList = ids(contentIds);
  trackSnapClientEvent('ADD_BILLING', {
    price: num(value), currency, item_ids: idList, number_items: numberItems,
  }, b.eventId, userData);
  sendToSnapCapiRoute({ ...b, userData, customData: {
    value: num(value), currency, content_ids: idList, num_items: numberItems, contents,
  } });
}

/**
 * PURCHASE (browser side) — Snap PIXEL ONLY.
 *
 * The server-side CAPI PURCHASE is owned exclusively by lib/snap/purchase.ts,
 * which rebuilds it from the database. The browser must not send a CAPI
 * Purchase: /api/snap/event refuses it, and a second server send would rely on
 * Snap dedup instead of being correct by construction.
 *
 * client_dedup_id = transaction_id = order id = server event_id = order_id.
 * Call this only for orders whose payment is confirmed.
 */
export function snapTrackPurchase(
  orderId: string,
  value: number,
  currency = 'INR',
  contentIds: string[] = [],
  userData?: RawIdentity,
  contentCategory?: string,
  contents?: SnapContent[] | number
) {
  if (!orderId || !shouldFireEvent(`Snap-Purchase-${orderId}`, 60_000)) return;
  const idList = ids(contentIds);
  const contentList = Array.isArray(contents) ? contents : undefined;
  const numItems = contentList
    ? contentList.reduce((s, c) => s + (c.quantity || 1), 0)
    : (typeof contents === 'number' ? contents : idList.length) || 1;

  trackSnapClientEvent('PURCHASE', {
    price: num(value), currency, item_ids: idList, item_category: contentCategory,
    number_items: numItems, transaction_id: orderId,
  }, orderId, userData);
}

export function snapTrackSignUp(userData?: RawIdentity) {
  const b = base('SIGN_UP');
  trackSnapClientEvent('SIGN_UP', {}, b.eventId, userData);
  sendToSnapCapiRoute({ ...b, userData });
}

export function snapTrackLogin(userData?: RawIdentity) {
  const b = base('LOGIN');
  trackSnapClientEvent('LOGIN', {}, b.eventId, userData);
  sendToSnapCapiRoute({ ...b, userData });
}

export function snapTrackSubscribe(email?: string) {
  const b = base('SUBSCRIBE');
  const userData = email ? { em: email } : undefined;
  trackSnapClientEvent('SUBSCRIBE', {}, b.eventId, userData);
  sendToSnapCapiRoute({ ...b, userData });
}

export function useSnapEvents() {
  return {
    trackViewContent: snapTrackViewContent,
    trackAddToCart: snapTrackAddToCart,
    trackAddToWishlist: snapTrackAddToWishlist,
    trackSearch: snapTrackSearch,
    trackStartCheckout: snapTrackStartCheckout,
    trackAddBilling: snapTrackAddBilling,
    trackPurchase: snapTrackPurchase,
    trackSignUp: snapTrackSignUp,
    trackLogin: snapTrackLogin,
    trackSubscribe: snapTrackSubscribe,
  };
}

/**
 * Catalog id used across Snap events: the numeric Shopify VARIANT id, exactly
 * as published in <g:id> of https://zicabella.com/feed.xml. Returns '' when the
 * input is not a provable variant id (never falls back to product id or SKU).
 */
export function toSnapItemId(raw: string | number | null | undefined): string {
  return normalizeVariantId(raw) || '';
}

/** Cart items → { ids, contents, numItems } for Snap events. */
export function snapCartPayload(
  items: Array<{ variantId?: string; productId?: string; quantity?: number; price?: string | number }>
): { ids: string[]; contents: SnapContent[]; numItems: number } {
  const contents = items.map(it => ({
    id: toSnapItemId(it.variantId),
    quantity: Number(it.quantity) || 1,
    item_price: num(it.price),
  })).filter(c => c.id);
  return {
    ids: contents.map(c => c.id),
    contents,
    numItems: contents.reduce((s, c) => s + c.quantity, 0),
  };
}
