'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  snapPixelId,
  captureSnapClickId,
  getSnapIdentityCookies,
  getClientCookie,
  setClientCookie,
  trackSnapClientEvent,
  initSnapPixel,
  releaseSnapPixel,
} from '@/lib/snapPixel';
import { isDemoValue } from '@/lib/metaPixel';
import { isExcludedBrowser } from '@/lib/tracking/automation';
import { isEventPage } from '@/lib/tracking/host';
import { whenMetaConsentAllows, onMetaConsentChange, readMetaConsentState } from '@/lib/meta/consent-client';

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function SnapPixelRouteTracker() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const lastTrackedPath = useRef<string | null>(null);
  const [sessionWaitExpired, setSessionWaitExpired] = useState(false);

  // Persist ScCid immediately on landing, before anything else can navigate away.
  useEffect(() => {
    if (snapPixelId()) captureSnapClickId();
  }, [pathname]);

  // Consent regions (lib/meta/consent.ts): app/layout.tsx holds the Snap SDK while the
  // visitor's consent is pending; release it once consent is granted or the visitor
  // turns out to be outside the regions. No-op when no region is configured.
  useEffect(() => {
    const release = (state: { gated: boolean; status?: string }) => {
      if (!state.gated || state.status === 'granted') releaseSnapPixel();
    };
    release(readMetaConsentState());
    return onMetaConsentChange(release);
  }, []);

  // Don't let a stuck session request block PAGE_VIEW forever.
  useEffect(() => {
    if (status !== 'loading') return;
    const t = setTimeout(() => setSessionWaitExpired(true), 2000);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    // Exclude admin dashboard and admin routes from tracking
    if (!pathname || pathname.startsWith('/dashboard') || pathname.startsWith('/admin') || pathname.startsWith('/web-store')) {
      return;
    }

    // Exactly one PAGE_VIEW per pathname change. Session changes (hydration,
    // login, logout) never fire an extra one because lastTrackedPath is unchanged.
    if (pathname === lastTrackedPath.current) {
      return;
    }

    // Wait (briefly) for NextAuth so a logged-in shopper's first PAGE_VIEW
    // carries their first-party match keys.
    if (status === 'loading' && !sessionWaitExpired) {
      return;
    }
    lastTrackedPath.current = pathname;

    // Snap off on this deployment, or a host that never sends events (app.zicabella.com;
    // lib/tracking/host.ts): no pixel, no relay.
    if (!snapPixelId() || !isEventPage()) {
      return;
    }

    // 1. ScCid (already captured above; re-read is idempotent)
    captureSnapClickId();

    // 2. Ensure visitor UUID (external_id) exists
    let extId = getClientCookie('zb_external_id');
    if (!extId) {
      extId = 'zb.' + uuidv4();
      setClientCookie('zb_external_id', extId, 365);
    }

    // 3. (Re)init pixel with advanced matching (only re-inits when identity changed).
    //    Logged in: the session's own raw email / phone / name — the pixel hashes raw
    //    values itself (cookie hashes can only feed email / phone), so the pixel half
    //    matches on the same keys as the CAPI half. Guests: the bound cookie hashes.
    const su = session?.user as any;
    const sessionName = String(su?.name || '').trim();
    const nameParts = sessionName && !isDemoValue('name', sessionName) ? sessionName.split(/\s+/) : [];
    const sessionPhone = su?.phone || (session as any)?.customer?.phone;
    const sessionIdentity = su ? {
      em: su.email && !isDemoValue('email', su.email) ? su.email : undefined,
      ph: sessionPhone && !isDemoValue('phone', sessionPhone) ? sessionPhone : undefined,
      fn: nameParts[0] || undefined,
      ln: nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined,
    } : undefined;
    initSnapPixel(sessionIdentity);

    // 4. Shared id: browser client_dedup_id === CAPI event_id
    const eventId = 'pv_snap_' + uuidv4();
    const eventTime = Date.now();

    // 5 + 6. Browser PAGE_VIEW and its server copy, fired together so both halves carry
    //    the same catalogue id. getSnapIdentityCookies() only returns hashes bound to this
    //    visitor's external_id, and the pixel half sends the same hashes, so the server
    //    half carries them too (same identity on both halves of the pair).
    const sourceUrl = window.location.href;
    const firePageView = (pageItemIds?: string[]) => {
      // Consent regions: held while the visitor's consent is pending (the same gate as
      // the Meta Pixel and both relays, lib/meta/consent-client.ts); pass-through elsewhere.
      whenMetaConsentAllows(() => {
        trackSnapClientEvent('PAGE_VIEW', pageItemIds ? { item_ids: pageItemIds } : {}, eventId);
        const ids = getSnapIdentityCookies();
        if (isExcludedBrowser()) return;
        fetch('/api/snap/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({
            eventName: 'PAGE_VIEW',
            eventId,
            eventTime,
            eventSourceUrl: sourceUrl,
            userAgent: navigator.userAgent,
            ...(pageItemIds ? { customData: { content_ids: pageItemIds, content_type: 'product' } } : {}),
            scClickId: ids.sc_click_id,
            scCookie1: ids.sc_cookie1,
            externalId: ids.external_id || extId,
            // Bound cookie hashes, else the session's raw values (the relay hashes them): on
            // the first page of a fresh login the hashed cookies are still being written, and
            // without this the pixel half carried identity while the server half had none.
            userData: {
              em: ids.em || sessionIdentity?.em, ph: ids.ph || sessionIdentity?.ph,
              fn: ids.fn || sessionIdentity?.fn, ln: ids.ln || sessionIdentity?.ln,
              ct: ids.ct, st: ids.st, zp: ids.zp, country: ids.country,
            },
          }),
        }).catch(err => console.warn('[Snap Tracker Client] PAGE_VIEW CAPI failed:', err));
      });
    };

    // Product pages: the catalogue item id (feed g:id = variant id) on PAGE_VIEW, which
    // Snap's Dynamic Ads requirements list alongside VIEW_CONTENT / ADD_CART / PURCHASE.
    // The product segment streams in after its loading UI, so on a client-side navigation
    // the id is not in the DOM yet when the path changes: wait for it briefly (<= 2.5 s)
    // and fire with whatever is there by then. Other pages fire at once.
    const readPageItemId = () => (document.querySelector('[data-zb-variant-id]')?.getAttribute('data-zb-variant-id') || '').trim();
    const toItemIds = (id: string) => (/^\d+$/.test(id) ? [id] : undefined);
    if (!pathname.startsWith('/products/')) { firePageView(undefined); return; }
    const firstId = readPageItemId();
    if (/^\d+$/.test(firstId)) { firePageView([firstId]); return; }
    const startedAt = Date.now();
    const poll = () => {
      const samePage = lastTrackedPath.current === pathname;
      const id = samePage ? readPageItemId() : '';
      // Fire as soon as the id is there, when the wait is up, or when the shopper has
      // already moved on (the next path gets its own PAGE_VIEW; this one goes without ids).
      if (!samePage || /^\d+$/.test(id) || Date.now() - startedAt > 2500) {
        firePageView(toItemIds(id));
        return;
      }
      setTimeout(poll, 100);
    };
    setTimeout(poll, 100);

  }, [pathname, status, sessionWaitExpired, session]);

  return null;
}

export default SnapPixelRouteTracker;
