import { trackEvent, initPixel, getMetaIdentityCookies, getClientCookie, sha256 } from '@/lib/metaPixel';
import { event as trackGAEvent } from '@/lib/gtag';
import { buildClientUserData } from '@/lib/buildMetaUserData';
import { normalizeVariantId } from '@/lib/snap/catalog-id';
import { normalizePhone, normalizeName } from '@/lib/tracking/identity-normalize';

/**
 * Cart → Meta catalog payload. Catalog item id = feed.xml <g:id> = Shopify VARIANT id
 * (g:item_group_id is the product id and is never used with content_type "product").
 * Lines without a provable variant id are left out rather than sent with a wrong id.
 * numItems = total units (sum of quantities), not cart lines.
 */
export function metaCartPayload(
  items: Array<{ variantId?: string; quantity?: number; price?: string | number; title?: string; category?: string }>
): {
  ids: string[];
  contents: { id: string; quantity: number; item_price?: number; title?: string; category?: string }[];
  numItems: number;
} {
  const contents = items
    .map(it => {
      const price = typeof it.price === 'number' ? it.price : parseFloat(String(it.price ?? ''));
      return {
        id: normalizeVariantId(it.variantId) || '',
        quantity: Math.max(1, Number(it.quantity) || 1),
        item_price: Number.isFinite(price) ? price : undefined,
        title: it.title || undefined,
        category: it.category || undefined,
      };
    })
    .filter(c => c.id);
  return {
    ids: contents.map(c => c.id),
    contents,
    numItems: contents.reduce((s, c) => s + c.quantity, 0),
  };
}

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function sendToCapiRoute(payload: Record<string, any>): Promise<any> {
  try {
    // Build identity data via the shared builder — ensures demo values are filtered,
    // empty fields are omitted, and all events get consistent identity enrichment.
    const rawIdentity = getMetaIdentityCookies();
    const builtIdentity = buildClientUserData(rawIdentity);

    // Inject sessionStorage geo data fallback if cookies are absent
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const geoStr = sessionStorage.getItem('zb_geo_data');
        if (geoStr) {
          const geoData = JSON.parse(geoStr);
          if (!builtIdentity.country && geoData.countryCode) builtIdentity.country = geoData.countryCode.toLowerCase();
          if (!builtIdentity.st && geoData.state) builtIdentity.st = geoData.state.toLowerCase();
          // IP-geolocated city / zip are the ISP's, not the shopper's — only a GPS or typed
          // address may fill ct / zp (Meta already geo-matches on the client IP).
          if (geoData.source !== 'ip') {
            if (!builtIdentity.ct && geoData.city) builtIdentity.ct = geoData.city.toLowerCase();
            if (!builtIdentity.zp && geoData.zip) builtIdentity.zp = geoData.zip;
          }
        }
      }
    } catch {}
    
    // Check user logged in status
    const isLoggedIn = getClientCookie('zb_user_logged_in') === 'true';
    const isCheckoutEvent = ['InitiateCheckout', 'AddPaymentInfo', 'Purchase'].includes(payload.eventName);
    
    // For guests/non-logged-in users on non-checkout events, strip identity PII parameters (em, ph, name, DOB, fb_login_id).
    // Address parameters (country, st, ct, zp) are preserved for Meta EMQ score.
    const identityData: Record<string, any> = { ...builtIdentity };
    if (!isLoggedIn && !isCheckoutEvent) {
      delete identityData.em;
      delete identityData.ph;
      delete identityData.fn;
      delete identityData.ln;
      delete identityData.db;
      delete identityData.fb_login_id;
    }

    const callerUserData = cleanCustomData(payload.userData || {});
    const mergedUserData = cleanCustomData({
      ...identityData,
      ...callerUserData,
      // Forward PII owner cookie so the server can verify identity binding
      piiOwner: getClientCookie('zb_pii_owner') || undefined,
    });

    // Make sure an explicitly-passed userData.em survives the guest-PII-strip for events
    // where the shopper just typed it for THIS event (newsletter Lead/Subscribe,
    // registration). The strip should only apply to identity pulled from cookies/session.
    // Don't loosen the strip for any other event type.
    if (!isLoggedIn && !isCheckoutEvent) {
      if (EXPLICIT_IDENTITY_EVENTS.has(payload.eventName) && payload.userData?.em) {
        mergedUserData.em = payload.userData.em;
      } else {
        delete mergedUserData.em;
      }
    }

    const enrichedPayload = {
      ...payload,
      userData: mergedUserData,
    };
    const res = await fetch('/api/meta/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enrichedPayload),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error('[CAPI send error]', err);
  }
  return null;
}

/** Events whose caller-supplied identity (typed/verified for that event) is kept for guests. */
const EXPLICIT_IDENTITY_EVENTS = new Set(['Subscribe', 'Lead', 'CompleteRegistration']);

function getBasePayload(eventName: string) {
  return {
    eventId: uuidv4(),
    eventName,
    eventSourceUrl: window.location.href,
    userAgent: navigator.userAgent,
    actionSource: 'website' as const,
    eventTime: Math.floor(Date.now() / 1000), // Sync event_time between client and server
  };
}

function cleanCustomData(data: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined && val !== null && val !== '') {
      cleaned[key] = val;
    }
  }
  return cleaned;
}

const firedEventsCache = new Map<string, number>();

function shouldFireEvent(key: string): boolean {
  const now = Date.now();
  const lastFired = firedEventsCache.get(key);
  if (lastFired && now - lastFired < 1000) {
    return false; // Deduplicate rapid multiple fires (e.g. from React Strict Mode in development)
  }
  firedEventsCache.set(key, now);
  return true;
}


/**
 * GA4 ecommerce events, kept exactly as on main (same payloads, same inputs from the
 * same call sites). They used to be fired only from inside the Meta hooks; they are
 * standalone so Meta changes (variant ids, payment-step AddPaymentInfo, confirmed-
 * payment Purchase, Pixel-loaded check) never change what GA4 receives.
 */
type GaContent = { id: string; quantity?: number; item_price?: number; title?: string; category?: string };
const gaMapContents = (value: number, raw: GaContent[]) => raw.map((item: any) => {
  const priceVal = item.item_price !== undefined ? item.item_price : (value / (raw.length || 1));
  return { id: item.id, quantity: item.quantity || 1, price: priceVal, item_price: priceVal, title: item.title || undefined, category: item.category || undefined };
});

export function ga4AddToWishlist(contentId: string, contentName: string, contentCategory?: string) {
  trackGAEvent('add_to_wishlist', {
    items: [{ item_id: contentId, item_name: contentName, item_category: contentCategory, quantity: 1 }]
  });
}

export function ga4AddPaymentInfo(value?: number, currency = 'INR', contentIds?: string[], contents?: GaContent[]) {
  const finalContents = contents || (contentIds ? contentIds.map(id => ({ id, quantity: 1 })) : []);
  trackGAEvent('add_payment_info', {
    value,
    currency,
    items: finalContents.map((item: any) => ({
      item_id: item.id,
      quantity: item.quantity,
      price: item.item_price !== undefined ? item.item_price : (value ? value / (finalContents.length || 1) : undefined)
    }))
  });
}

export function ga4BeginCheckout(value: number, currency = 'INR', contentCategory?: string, contentIds?: string[], contents?: GaContent[]) {
  const mapped = gaMapContents(value, contents || (contentIds ? contentIds.map(id => ({ id, quantity: 1 })) : []));
  trackGAEvent('begin_checkout', {
    value,
    currency,
    items: mapped.map(item => ({
      item_id: item.id,
      item_name: item.title || 'Product',
      price: item.item_price || item.price,
      quantity: item.quantity,
      item_category: item.category || contentCategory || undefined
    }))
  });
}

export function ga4Purchase(orderId: string, value: number, currency = 'INR', contentIds: string[], contentCategory?: string, contents?: GaContent[]) {
  const mapped = gaMapContents(value, contents || contentIds.map(id => ({ id, quantity: 1, item_price: value / (contentIds.length || 1) })));
  trackGAEvent('purchase', {
    transaction_id: orderId,
    value,
    currency,
    items: mapped.map(item => ({
      item_id: item.id,
      item_name: item.title || 'Product',
      price: item.item_price || item.price,
      quantity: item.quantity,
      item_category: item.category || contentCategory || undefined
    }))
  });
}

/** `ga: false` = the caller fires the main-identical GA4 event itself (see ga4* above). */
export type MetaGaOptions = { ga?: boolean };

export function useMetaEvents() {
  const trackViewContent = (
    contentId: string,
    contentName: string,
    value?: number,
    currency = 'INR',
    contentCategory?: string,
    userData?: Record<string, any>
  ) => {
    const cacheKey = `ViewContent-${contentId}`;
    if (!shouldFireEvent(cacheKey)) return;

    if (userData) {
      initPixel(userData);
    }

    const base = getBasePayload('ViewContent');
    const contents = value !== undefined ? [{ id: contentId, quantity: 1, item_price: value }] : [{ id: contentId, quantity: 1 }];
    const customData = cleanCustomData({
      content_ids: [contentId],
      content_name: contentName,
      currency,
      value,
      content_category: contentCategory,
      content_type: 'product',
      contents
    });
    trackEvent('ViewContent', customData, base.eventId);
    sendToCapiRoute({ ...base, customData, userData });
    
    // GA4 equivalent: view_item
    trackGAEvent('view_item', {
      currency,
      value,
      items: [{
        item_id: contentId,
        item_name: contentName,
        price: value,
        item_category: contentCategory,
        quantity: 1
      }]
    });
  };

  const trackAddToCart = (contentId: string, contentName: string, value: number, currency = 'INR', contentCategory?: string, opts: MetaGaOptions = {}) => {
    const cacheKey = `AddToCart-${contentId}`;
    if (!shouldFireEvent(cacheKey)) return;

    const base = getBasePayload('AddToCart');
    const customData = cleanCustomData({
      content_ids: [contentId],
      content_name: contentName,
      value,
      currency,
      content_category: contentCategory,
      content_type: 'product',
      contents: [{ id: contentId, quantity: 1, item_price: value }]
    });
    trackEvent('AddToCart', customData, base.eventId);
    sendToCapiRoute({ ...base, customData });
    
    // GA4 equivalent: add_to_cart
    if (opts.ga !== false) trackGAEvent('add_to_cart', {
      currency,
      value,
      items: [{
        item_id: contentId,
        item_name: contentName,
        price: value,
        item_category: contentCategory,
        quantity: 1
      }]
    });
  };

  const trackAddToWishlist = (contentId: string, contentName: string, contentCategory?: string, value?: number, currency = 'INR', opts: MetaGaOptions = {}) => {
    const base = getBasePayload('AddToWishlist');
    const customData = cleanCustomData({
      content_ids: [contentId],
      content_name: contentName,
      content_category: contentCategory,
      content_type: 'product',
      contents: [{ id: contentId, quantity: 1, item_price: value }],
      value,
      currency
    });
    trackEvent('AddToWishlist', customData, base.eventId);
    sendToCapiRoute({ ...base, customData });
    
    // GA4 equivalent: add_to_wishlist
    if (opts.ga !== false) ga4AddToWishlist(contentId, contentName, contentCategory);
  };

  const trackAddPaymentInfo = (
    userData?: {
      country?: string;
      st?: string;
      ge?: string;
      ct?: string;
      zp?: string;
      fn?: string;
      ln?: string;
      em?: string;
      ph?: string;
      external_id?: string;
      fb_login_id?: string;
    },
    value?: number,
    currency = 'INR',
    contentIds?: string[],
    contents?: { id: string; quantity: number; item_price?: number }[],
    opts: MetaGaOptions = {}
  ) => {
    const base = getBasePayload('AddPaymentInfo');
    if (userData) {
      initPixel(userData);
    }
    const finalContents = contents || (contentIds ? contentIds.map(id => ({ id, quantity: 1 })) : []);
    const customData = cleanCustomData({
      value,
      currency,
      content_ids: contentIds,
      content_type: 'product',
      contents: finalContents
    });
    trackEvent('AddPaymentInfo', customData, base.eventId);
    sendToCapiRoute({ 
      ...base, 
      customData, 
      userData: { client_user_agent: navigator.userAgent, ...userData } 
    });

    // GA4 equivalent: add_payment_info
    if (opts.ga !== false) ga4AddPaymentInfo(value, currency, contentIds, finalContents);
  };

  const trackInitiateCheckout = (
    value: number,
    numItems: number,
    currency = 'INR',
    contentCategory?: string,
    contentIds?: string[],
    userData?: any,
    contents?: { id: string; quantity: number; item_price?: number; title?: string; category?: string }[],
    opts: MetaGaOptions = {}
  ) => {
    const cacheKey = `InitiateCheckout-${value}-${numItems}`;
    if (!shouldFireEvent(cacheKey)) return;

    const base = getBasePayload('InitiateCheckout');
    if (userData) {
      initPixel(userData);
    }
    
    // Map contents to include title, category, and standard price parameters
    const rawContents = contents || (contentIds ? contentIds.map(id => ({ id, quantity: 1 })) : []);
    const mappedContents = rawContents.map((item: any) => {
      const priceVal = item.item_price !== undefined ? item.item_price : (value / (rawContents.length || 1));
      return {
        id: item.id,
        quantity: item.quantity || 1,
        price: priceVal,
        item_price: priceVal,
        title: (item as any).title || undefined,
        category: (item as any).category || undefined
      };
    });
    
    // Server CAPI receives the real value and mapped contents — adjustment happens server-side
    const capiCustomData = cleanCustomData({
      value,
      num_items: numItems,
      currency,
      content_category: contentCategory,
      content_ids: contentIds,
      content_type: 'product',
      contents: mappedContents
    });

    // Pixel fires immediately with the known value (no wait on the CAPI round-trip:
    // the server no longer transforms the value). Same eventID → Meta dedups the pair.
    const fbqCustomData = cleanCustomData({
      value,
      currency,
      num_items: numItems,
      content_category: contentCategory,
      content_ids: contentIds,
      content_type: 'product',
      contents: mappedContents
    });
    trackEvent('InitiateCheckout', fbqCustomData, base.eventId);
    sendToCapiRoute({
      ...base,
      customData: capiCustomData,
      userData: { client_user_agent: navigator.userAgent, ...userData }
    });
    
    // GA4 equivalent: begin_checkout (uses full original value)
    if (opts.ga !== false) ga4BeginCheckout(value, currency, contentCategory, contentIds, rawContents);
  };

  const trackPurchase = (
    orderId: string,
    value: number,
    currency = 'INR',
    contentIds: string[],
    userData?: {
      country?: string;
      st?: string;
      ge?: string;
      ct?: string;
      zp?: string;
      fn?: string;
      ln?: string;
      em?: string;
      ph?: string;
      external_id?: string;
      fb_login_id?: string;
    },
    contentCategory?: string,
    contents?: { id: string; quantity: number; item_price?: number; title?: string; category?: string }[],
    opts: MetaGaOptions = {}
  ) => {
    const cacheKey = `Purchase-${orderId}`;
    if (!shouldFireEvent(cacheKey)) return;

    const base = { ...getBasePayload('Purchase'), eventId: orderId }; // use order ID as event ID for dedup
    if (userData) {
      initPixel(userData);
    }
    
    // Map contents to include title, category, and standard price parameters
    const rawContents = contents || contentIds.map(id => ({ id, quantity: 1, item_price: value / (contentIds.length || 1) }));
    const mappedContents = rawContents.map((item: any) => {
      const priceVal = item.item_price !== undefined ? item.item_price : (value / (rawContents.length || 1));
      return {
        id: item.id,
        quantity: item.quantity || 1,
        price: priceVal,
        item_price: priceVal,
        title: (item as any).title || undefined,
        category: (item as any).category || undefined
      };
    });

    // Pixel fires immediately with the CONFIRMED ORDER's value/currency/contents —
    // never a value cached by an earlier checkout step. eventID = order id, the same
    // event_id the authoritative server Purchase uses, so Meta dedups the pair.
    const fbqCustomData = cleanCustomData({
      value,
      currency,
      content_ids: contentIds,
      order_id: orderId,
      content_category: contentCategory,
      content_type: 'product',
      contents: mappedContents,
      num_items: mappedContents.reduce((sum, item) => sum + item.quantity, 0)
    });
    trackEvent('Purchase', fbqCustomData, base.eventId);
    // No browser→CAPI request for Purchase: the server sends the CAPI Purchase from
    // the stored order (once, via the delivery ledger) from the payment-verified
    // paths, with the click context captured during checkout.
    
    // GA4 equivalent: purchase (uses full original value)
    if (opts.ga !== false) ga4Purchase(orderId, value, currency, contentIds, contentCategory, contents);
  };

  /**
   * @param identity first-party data just verified at sign-up: the OTP phone (with its
   *   dial code) and the name typed. Nothing is invented; absent fields are omitted.
   */
  const trackCompleteRegistration = (identity?: { ph?: string; fn?: string; ln?: string; country?: string }) => {
    const base = getBasePayload('CompleteRegistration');
    const customData = {
      status: 'completed',
      content_name: 'registration'
    };
    // Phone as "+<digits>" so the server parses it by its own calling code.
    const phDigits = identity?.ph ? normalizePhone(identity.ph, identity.country) : '';
    const fn = normalizeName(identity?.fn);
    const ln = normalizeName(identity?.ln);
    const userData = cleanCustomData({
      ph: phDigits ? `+${phDigits}` : undefined,
      fn: fn || undefined,
      ln: ln || undefined,
    });
    if (Object.keys(userData).length > 0) {
      // '+digits': the dial code is parsed from the number itself (never an assumed country).
      initPixel({ ...(phDigits ? { ph: `+${phDigits}` } : {}), ...(fn ? { fn } : {}), ...(ln ? { ln } : {}) });
    }
    trackEvent('CompleteRegistration', customData, base.eventId);
    sendToCapiRoute({ ...base, customData, userData: Object.keys(userData).length ? userData : undefined });
    
    // GA4 equivalent: sign_up
    trackGAEvent('sign_up');
  };

  const trackSearch = (searchString: string) => {
    const base = getBasePayload('Search');
    const customData = {
      search_string: searchString,
      content_type: 'product'
    };
    trackEvent('Search', customData, base.eventId);
    sendToCapiRoute({ ...base, customData });
    
    // GA4 equivalent: search
    trackGAEvent('search', {
      search_term: searchString
    });
  };

  const trackContact = () => {
    const base = getBasePayload('Contact');
    trackEvent('Contact', {}, base.eventId);
    sendToCapiRoute({ ...base });
    
    // GA4 equivalent: contact
    trackGAEvent('contact');
  };

  const trackFindLocation = () => {
    const base = getBasePayload('FindLocation');
    trackEvent('FindLocation', {}, base.eventId);
    sendToCapiRoute({ ...base });
    
    // GA4 equivalent: find_location
    trackGAEvent('find_location');
  };

  const trackSchedule = () => {
    const base = getBasePayload('Schedule');
    trackEvent('Schedule', {}, base.eventId);
    sendToCapiRoute({ ...base });
    
    // GA4 equivalent: schedule
    trackGAEvent('schedule');
  };

  const trackStartTrial = () => {
    const base = getBasePayload('StartTrial');
    trackEvent('StartTrial', {}, base.eventId);
    sendToCapiRoute({ ...base });
    
    // GA4 equivalent: start_trial
    trackGAEvent('start_trial');
  };

  /**
   * Free newsletter sign-up → Meta Lead (non-monetary; no invented value). Call only
   * after the backend confirmed the subscription was saved.
   */
  const trackNewsletterLead = async (email?: string) => {
    const base = getBasePayload('Lead');
    const hashedEmail = email ? await sha256(email) : undefined;
    const customData = cleanCustomData({ content_name: 'Newsletter Signup' });
    const userData = hashedEmail ? { em: hashedEmail } : undefined;
    if (userData) {
      initPixel(userData);
    }
    trackEvent('Lead', customData, base.eventId);
    sendToCapiRoute({ ...base, customData, userData });
    // GA4 unchanged: same 'subscribe' event as before
    trackGAEvent('subscribe');
  };

  const trackLead = (value?: number, currency = 'INR', contentCategory?: string, contentName?: string) => {
    const base = getBasePayload('Lead');
    const customData = cleanCustomData({
      value,
      currency,
      content_category: contentCategory,
      content_name: contentName
    });
    trackEvent('Lead', customData, base.eventId);
    sendToCapiRoute({ ...base, customData });
  };

  return {
    trackViewContent,
    trackAddToCart,
    trackAddToWishlist,
    trackAddPaymentInfo,
    trackInitiateCheckout,
    trackPurchase,
    trackCompleteRegistration,
    trackSearch,
    trackContact,
    trackFindLocation,
    trackSchedule,
    trackStartTrial,
    trackNewsletterLead,
    trackLead,
  };
}
