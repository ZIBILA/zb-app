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
} from '@/lib/snapPixel';
import { isDemoValue } from '@/lib/metaPixel';

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

    if (!snapPixelId()) {
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
    initSnapPixel(su ? {
      em: su.email && !isDemoValue('email', su.email) ? su.email : undefined,
      ph: sessionPhone && !isDemoValue('phone', sessionPhone) ? sessionPhone : undefined,
      fn: nameParts[0] || undefined,
      ln: nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined,
    } : undefined);

    // 4. Shared id: browser client_dedup_id === CAPI event_id
    const eventId = 'pv_snap_' + uuidv4();
    const eventTime = Date.now();

    // 5. Browser PAGE_VIEW
    trackSnapClientEvent('PAGE_VIEW', {}, eventId);

    // 6. Server PAGE_VIEW. getSnapIdentityCookies() only returns hashes bound to this
    //    visitor's external_id, and the pixel half (step 5) sends the same hashes, so
    //    the server half carries them too (same identity on both halves of the pair).
    const ids = getSnapIdentityCookies();
    fetch('/api/snap/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        eventName: 'PAGE_VIEW',
        eventId,
        eventTime,
        eventSourceUrl: window.location.href,
        userAgent: navigator.userAgent,
        scClickId: ids.sc_click_id,
        scCookie1: ids.sc_cookie1,
        externalId: ids.external_id || extId,
        userData: {
          em: ids.em, ph: ids.ph, fn: ids.fn, ln: ids.ln,
          ct: ids.ct, st: ids.st, zp: ids.zp, country: ids.country,
        },
      }),
    }).catch(err => console.warn('[Snap Tracker Client] PAGE_VIEW CAPI failed:', err));

  }, [pathname, status, sessionWaitExpired, session]);

  return null;
}

export default SnapPixelRouteTracker;
