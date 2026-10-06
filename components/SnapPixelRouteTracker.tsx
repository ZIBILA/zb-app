'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import {
  SNAP_PIXEL_ID,
  captureSnapClickId,
  getSnapIdentityCookies,
  getClientCookie,
  setClientCookie,
  trackSnapClientEvent,
  initSnapPixel,
} from '@/lib/snapPixel';

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function SnapPixelRouteTracker() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    // Exclude admin dashboard and admin routes from tracking
    if (!pathname || pathname.startsWith('/dashboard') || pathname.startsWith('/admin') || pathname.startsWith('/web-store')) {
      return;
    }

    if (pathname === lastTrackedPath.current) {
      return;
    }
    lastTrackedPath.current = pathname;

    if (!SNAP_PIXEL_ID) {
      return;
    }

    // 1. Capture and persist ScCid (Snap Click ID)
    captureSnapClickId();

    // 2. Ensure visitor UUID (external_id) exists
    let extId = getClientCookie('zb_external_id');
    if (!extId) {
      extId = 'zb.' + uuidv4();
      setClientCookie('zb_external_id', extId, 365);
    }

    // 3. Re-init pixel with current identity cookies for advanced matching.
    //    No-args call defaults to buildBrowserIdentity() which maps cookies
    //    to Snap's expected field names (user_email, firstname, geo_city, etc.)
    initSnapPixel();

    // 4. Generate shared eventId for PageView
    const eventId = 'pv_snap_' + uuidv4();
    const eventTime = Math.floor(Date.now() / 1000);

    // 5. Client-side snaptr PageView
    trackSnapClientEvent('PAGE_VIEW', {}, eventId);

    // 6. Server-side CAPI PageView
    const snapIdentity = getSnapIdentityCookies();
    const builtIdentity: Record<string, any> = { ...snapIdentity };

    // Strip PII fields for anonymous page views unless logged in
    if (!session?.user) {
      delete builtIdentity.em;
      delete builtIdentity.ph;
      delete builtIdentity.fn;
      delete builtIdentity.ln;
    }

    fetch('/api/snap/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName: 'PAGE_VIEW',
        eventId,
        eventTime,
        eventSourceUrl: window.location.href,
        userAgent: navigator.userAgent,
        userData: builtIdentity,
      }),
    }).catch(err => console.warn('[Snap Tracker Client] PAGE_VIEW CAPI failed:', err));

  }, [pathname]);

  return null;
}

export default SnapPixelRouteTracker;
