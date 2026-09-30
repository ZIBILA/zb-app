import { trackEvent, initPixel, getMetaIdentityCookies, getClientCookie, sha256 } from '@/lib/metaPixel';
import { event as trackGAEvent } from '@/lib/gtag';
import { buildClientUserData } from '@/lib/buildMetaUserData';

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
          if (!builtIdentity.ct && geoData.city) builtIdentity.ct = geoData.city.toLowerCase();
          if (!builtIdentity.zp && geoData.zip) builtIdentity.zp = geoData.zip;
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

    // Make sure an explicitly-passed userData.em on a Subscribe call survives the guest-PII-strip.
    // The strip should only apply to identity pulled from cookies/session, not to a value
    // the caller just explicitly handed in for this specific event.
    // Don't loosen the strip for any other event type.
    if (!isLoggedIn && !isCheckoutEvent) {
      if (payload.eventName === 'Subscribe' && payload.userData?.em) {
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

  const trackAddToCart = (contentId: string, contentName: string, value: number, currency = 'INR', contentCategory?: string) => {
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
    trackGAEvent('add_to_cart', {
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

  const trackRemoveFromCart = (contentId: string, contentName: string, value?: number, currency = 'INR', contentCategory?: string) => {
    const base = getBasePayload('RemoveFromCart');
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
    // fbq does not natively support RemoveFromCart as standard, send as custom or fbq track
    trackEvent('RemoveFromCart' as any, customData, base.eventId);
    sendToCapiRoute({ ...base, customData });
  };

  const trackAddToWishlist = (contentId: string, contentName: string, contentCategory?: string, value?: number, currency = 'INR') => {
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
    trackGAEvent('add_to_wishlist', {
      items: [{
        item_id: contentId,
        item_name: contentName,
        item_category: contentCategory,
        quantity: 1
      }]
    });
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
    contents?: { id: string; quantity: number; item_price?: number }[]
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
    trackGAEvent('add_payment_info', {
      value,
      currency,
      items: finalContents.map((item: any) => ({
        item_id: item.id,
        quantity: item.quantity,
        price: item.item_price !== undefined ? item.item_price : (value ? value / (finalContents.length || 1) : undefined)
      }))
    });
  };

  const trackInitiateCheckout = (
    value: number,
    numItems: number,
    currency = 'INR',
    contentCategory?: string,
    contentIds?: string[],
    userData?: any,
    contents?: { id: string; quantity: number; item_price?: number; title?: string; category?: string }[]
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

    let fired = false;
    const firePixel = (reportedVal?: number, repCurrency?: string, adjustedContents?: any[]) => {
      if (fired) return;
      fired = true;
      
      // Cache adjusted value and contents in sessionStorage for fallback on subsequent events
      if (reportedVal !== undefined) {
        try {
          sessionStorage.setItem('zb_meta_rv_v2', JSON.stringify({
            v: reportedVal,
            c: repCurrency || currency,
            contents: adjustedContents
          }));
          if (value > 0) {
            sessionStorage.setItem('zb_meta_ratio_v2', (reportedVal / value).toString());
          }
        } catch {}
      }

      // Determine final contents with scaled prices
      let finalFbqContents = adjustedContents;
      if (!finalFbqContents) {
        try {
          const cachedRatioStr = sessionStorage.getItem('zb_meta_ratio_v2');
          if (cachedRatioStr) {
            const ratio = parseFloat(cachedRatioStr);
            finalFbqContents = mappedContents.map(item => ({
              ...item,
              price: Math.round(item.price * ratio * 100) / 100,
              item_price: Math.round(item.item_price * ratio * 100) / 100
            }));
          }
        } catch {}
      }
      if (!finalFbqContents) {
        finalFbqContents = mappedContents;
      }

      const fbqCustomData = cleanCustomData({
        value: reportedVal,
        currency: repCurrency || currency,
        num_items: numItems,
        content_category: contentCategory,
        content_ids: contentIds,
        content_type: 'product',
        contents: finalFbqContents
      });
      trackEvent('InitiateCheckout', fbqCustomData, base.eventId);
    };

    const attemptCapi = () => sendToCapiRoute({
      ...base,
      customData: capiCustomData,
      userData: { client_user_agent: navigator.userAgent, ...userData }
    });
    const timeout = (ms: number) => new Promise<null>(r => setTimeout(() => r(null), ms));

    // Retry flow with sessionStorage fallback — pixel always fires
    (async () => {
      // First attempt: 2500ms timeout
      let res = await Promise.race([attemptCapi(), timeout(2500)]);
      if (res && res.reportedValue !== undefined) {
        firePixel(res.reportedValue, res.currency, res.contents);
        return;
      }

      // Retry: 1500ms timeout
      res = await Promise.race([attemptCapi(), timeout(1500)]);
      if (res && res.reportedValue !== undefined) {
        firePixel(res.reportedValue, res.currency, res.contents);
        return;
      }

      // Both failed — try sessionStorage fallback or ratio scaling
      try {
        const cached = sessionStorage.getItem('zb_meta_rv_v2');
        const cachedRatioStr = sessionStorage.getItem('zb_meta_ratio_v2');
        if (cached) {
          const { v, c, contents: cachedContents } = JSON.parse(cached);
          if (v !== undefined) {
            console.warn('[Meta Pixel] InitiateCheckout fired using cached adjusted value — CAPI round-trip failed twice');
            firePixel(v, c, cachedContents);
            return;
          }
        }
        if (cachedRatioStr) {
          const ratio = parseFloat(cachedRatioStr);
          const scaledValue = Math.round(value * ratio * 100) / 100;
          const scaledContents = mappedContents.map(item => ({
            ...item,
            price: Math.round(item.price * ratio * 100) / 100,
            item_price: Math.round(item.item_price * ratio * 100) / 100
          }));
          console.warn('[Meta Pixel] InitiateCheckout fired using scaled cached ratio — CAPI round-trip failed twice');
          firePixel(scaledValue, currency, scaledContents);
          return;
        }
      } catch {}

      // Absolute last resort — fire without value and log
      console.error('[Meta Pixel] InitiateCheckout fired without value — CAPI round-trip failed twice, no sessionStorage fallback');
      firePixel();
    })();
    
    // GA4 equivalent: begin_checkout (uses full original value)
    trackGAEvent('begin_checkout', {
      value,
      currency,
      items: mappedContents.map(item => ({
        item_id: item.id,
        item_name: item.title || 'Product',
        price: item.item_price || item.price,
        quantity: item.quantity,
        item_category: item.category || contentCategory || undefined
      }))
    });
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
    contents?: { id: string; quantity: number; item_price?: number; title?: string; category?: string }[]
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

    // Server CAPI receives the real value and mapped contents — adjustment happens server-side
    const capiCustomData = cleanCustomData({
      value,
      currency,
      content_ids: contentIds,
      order_id: orderId,
      content_category: contentCategory,
      content_type: 'product',
      contents: mappedContents,
      num_items: mappedContents.reduce((sum, item) => sum + item.quantity, 0)
    });

    let fired = false;
    const firePixel = (reportedVal?: number, repCurrency?: string, adjustedContents?: any[]) => {
      if (fired) return;
      fired = true;
      
      // Cache adjusted value and contents in sessionStorage for fallback on subsequent events
      if (reportedVal !== undefined) {
        try {
          sessionStorage.setItem('zb_meta_rv_v2', JSON.stringify({
            v: reportedVal,
            c: repCurrency || currency,
            contents: adjustedContents
          }));
          if (value > 0) {
            sessionStorage.setItem('zb_meta_ratio_v2', (reportedVal / value).toString());
          }
        } catch {}
      }

      // Determine final contents with scaled prices
      let finalFbqContents = adjustedContents;
      if (!finalFbqContents) {
        try {
          const cachedRatioStr = sessionStorage.getItem('zb_meta_ratio_v2');
          if (cachedRatioStr) {
            const ratio = parseFloat(cachedRatioStr);
            finalFbqContents = mappedContents.map(item => ({
              ...item,
              price: Math.round(item.price * ratio * 100) / 100,
              item_price: Math.round(item.item_price * ratio * 100) / 100
            }));
          }
        } catch {}
      }
      if (!finalFbqContents) {
        finalFbqContents = mappedContents;
      }

      const fbqCustomData = cleanCustomData({
        value: reportedVal,
        currency: repCurrency || currency,
        content_ids: contentIds,
        order_id: orderId,
        content_category: contentCategory,
        content_type: 'product',
        contents: finalFbqContents,
        num_items: finalFbqContents.reduce((sum, item) => sum + item.quantity, 0)
      });
      trackEvent('Purchase', fbqCustomData, base.eventId);
    };

    const attemptCapi = () => sendToCapiRoute({
      ...base,
      customData: capiCustomData,
      userData: { client_user_agent: navigator.userAgent, ...userData },
    });
    const timeout = (ms: number) => new Promise<null>(r => setTimeout(() => r(null), ms));

    // Retry flow with sessionStorage fallback — pixel always fires
    (async () => {
      // First attempt: 2500ms timeout
      let res = await Promise.race([attemptCapi(), timeout(2500)]);
      if (res && res.reportedValue !== undefined) {
        firePixel(res.reportedValue, res.currency, res.contents);
        return;
      }

      // Retry: 1500ms timeout
      res = await Promise.race([attemptCapi(), timeout(1500)]);
      if (res && res.reportedValue !== undefined) {
        firePixel(res.reportedValue, res.currency, res.contents);
        return;
      }

      // Both failed — try sessionStorage fallback or ratio scaling
      try {
        const cached = sessionStorage.getItem('zb_meta_rv_v2');
        const cachedRatioStr = sessionStorage.getItem('zb_meta_ratio_v2');
        if (cached) {
          const { v, c, contents: cachedContents } = JSON.parse(cached);
          if (v !== undefined) {
            console.warn('[Meta Pixel] Purchase fired using cached adjusted value — CAPI round-trip failed twice');
            firePixel(v, c, cachedContents);
            return;
          }
        }
        if (cachedRatioStr) {
          const ratio = parseFloat(cachedRatioStr);
          const scaledValue = Math.round(value * ratio * 100) / 100;
          const scaledContents = mappedContents.map(item => ({
            ...item,
            price: Math.round(item.price * ratio * 100) / 100,
            item_price: Math.round(item.item_price * ratio * 100) / 100
          }));
          console.warn('[Meta Pixel] Purchase fired using scaled cached ratio — CAPI round-trip failed twice');
          firePixel(scaledValue, currency, scaledContents);
          return;
        }
      } catch {}

      // Absolute last resort — fire without value and log
      console.error('[Meta Pixel] Purchase fired without value — CAPI round-trip failed twice, no sessionStorage fallback');
      firePixel();
    })();
    
    // GA4 equivalent: purchase (uses full original value)
    trackGAEvent('purchase', {
      transaction_id: orderId,
      value,
      currency,
      items: mappedContents.map(item => ({
        item_id: item.id,
        item_name: item.title || 'Product',
        price: item.item_price || item.price,
        quantity: item.quantity,
        item_category: item.category || contentCategory || undefined
      }))
    });
  };

  const trackCompleteRegistration = () => {
    const base = getBasePayload('CompleteRegistration');
    const customData = {
      status: 'completed',
      content_name: 'registration'
    };
    trackEvent('CompleteRegistration', customData, base.eventId);
    sendToCapiRoute({ ...base, customData });
    
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

  const trackSubscribe = async (email?: string, contentName = 'Newsletter Signup') => {
    const base = getBasePayload('Subscribe');
    
    let hashedEmail: string | undefined = undefined;
    if (email) {
      hashedEmail = await sha256(email);
    }

    const customData = cleanCustomData({
      content_name: contentName,
      content_type: 'lead'
    });

    const userData = hashedEmail ? { em: hashedEmail } : undefined;

    if (userData) {
      initPixel(userData);
    }

    trackEvent('Subscribe', customData, base.eventId);
    sendToCapiRoute({ ...base, customData, userData });
    
    // GA4 equivalent: subscribe
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
    trackRemoveFromCart,
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
    trackSubscribe,
    trackLead,
  };
}
