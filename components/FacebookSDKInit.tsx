'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { setClientCookie, getClientCookie } from '@/lib/metaPixel';

/**
 * FacebookSDKInit — loads the Facebook JS SDK and captures fb_login_id.
 *
 * Opt-in: renders only when NEXT_PUBLIC_META_FB_LOGIN=1 AND NEXT_PUBLIC_META_APP_ID
 * is set. FB.getLoginStatus() reports "connected" only for people who have
 * authorized THIS app through Facebook Login; the storefront offers Google, Apple
 * and OTP sign-in, so without a Facebook Login button the SDK can never produce an
 * fb_login_id and would only add a third-party script to every page. Turn it on
 * when (and only when) Facebook Login is added to the site.
 *
 * Skips admin/dashboard routes. When connected, stores the numeric userID as the
 * `zb_fb_login_id` cookie (unhashed, as Meta expects for the fb_login_id parameter).
 */
export default function FacebookSDKInit() {
  const pathname = usePathname();
  const initRef = useRef(false);

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const enabled = process.env.NEXT_PUBLIC_META_FB_LOGIN === '1';

  useEffect(() => {
    // Guard: opt-in flag off, or no app ID configured
    if (!enabled || !appId) return;

    // Guard: don't load on admin/dashboard routes
    if (
      pathname.startsWith('/dashboard') ||
      pathname.startsWith('/admin') ||
      pathname.startsWith('/web-store')
    ) {
      return;
    }

    // Guard: only init once per page lifecycle
    if (initRef.current) return;
    initRef.current = true;

    // Guard: don't re-load if SDK is already present
    if ((window as any).FB) {
      checkLoginStatus();
      return;
    }

    // Load the Facebook JS SDK asynchronously
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;

    // FB SDK calls fbAsyncInit when ready
    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({
        appId: appId,
        cookie: true,
        xfbml: false,
        version: 'v25.0',
      });

      checkLoginStatus();
    };

    // Only insert if not already present
    if (!document.getElementById('facebook-jssdk')) {
      const firstScript = document.getElementsByTagName('script')[0];
      if (firstScript?.parentNode) {
        firstScript.parentNode.insertBefore(script, firstScript);
      } else {
        document.head.appendChild(script);
      }
    }

    function checkLoginStatus() {
      try {
        const FB = (window as any).FB;
        if (!FB?.getLoginStatus) return;

        FB.getLoginStatus((response: any) => {
          if (response?.status === 'connected' && response?.authResponse?.userID) {
            const userId = response.authResponse.userID;
            // Only write if we don't already have this value
            const existing = getClientCookie('zb_fb_login_id');
            if (existing !== userId) {
              // Store raw numeric FB user ID — Meta expects fb_login_id unhashed
              setClientCookie('zb_fb_login_id', userId, 365);
            }
          }
        });
      } catch (err) {
        // Fail silently — FB SDK issues should never crash the page
        console.warn('[FacebookSDKInit] Error checking login status:', err);
      }
    }
  }, [appId, enabled, pathname]);

  return null;
}
