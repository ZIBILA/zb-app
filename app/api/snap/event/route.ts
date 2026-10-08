import { NextRequest, NextResponse } from 'next/server';
import { sendSnapEvent } from '@/lib/snap-capi';
import { getClientIP, lookupIpGeo, isPrivateIP } from '@/lib/ip-geo';

const ALLOWED_EVENTS = new Set([
  'PAGE_VIEW', 'VIEW_CONTENT', 'ADD_CART', 'ADD_TO_WISHLIST', 'SEARCH', 'START_CHECKOUT',
  'ADD_BILLING', 'PURCHASE', 'SIGN_UP', 'LOGIN', 'SUBSCRIBE', 'LIST_VIEW', 'SAVE', 'SHARE',
]);

const str = (v: unknown, max = 512): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventName = str(body.eventName, 40);
    const eventId = str(body.eventId, 200);
    const eventSourceUrl = str(body.eventSourceUrl, 2048);

    if (!eventName || !eventId || !eventSourceUrl) {
      return NextResponse.json({ error: 'Missing required event parameters' }, { status: 400 });
    }
    if (!ALLOWED_EVENTS.has(eventName)) {
      return NextResponse.json({ error: 'Unsupported event' }, { status: 400 });
    }

    const urlLower = eventSourceUrl.toLowerCase();
    if (urlLower.includes('/dashboard') || urlLower.includes('/admin') || urlLower.includes('/web-store')) {
      return NextResponse.json({ success: false, skipped: true }, { status: 200 });
    }

    // Snap identifiers: request cookies are authoritative; body is the fallback
    // (cookies set on a parent domain may not reach every sub-path in edge cases).
    const scClickId = req.cookies.get('ScCid')?.value || req.cookies.get('_sccid')?.value || str(body.scClickId);
    const scCookie1 = req.cookies.get('_scid')?.value || str(body.scCookie1);
    const externalId = req.cookies.get('zb_external_id')?.value || str(body.externalId);

    // Same precedence as /api/meta/event (middleware-captured IP, then headers).
    // Never send loopback/private addresses — they poison IP matching.
    const ipCandidate = req.cookies.get('zb_client_ip')?.value || getClientIP(req);
    const ip = ipCandidate && !isPrivateIP(ipCandidate) ? ipCandidate : undefined;

    const u = (body.userData && typeof body.userData === 'object') ? body.userData : {};
    const c = (k: string) => req.cookies.get(k)?.value;
    const userData = {
      em: str(u.em) || c('zb_guest_email'),
      ph: str(u.ph) || c('zb_guest_phone'),
      fn: str(u.fn) || c('zb_guest_fn'),
      ln: str(u.ln) || c('zb_guest_ln'),
      ct: str(u.ct) || c('zb_guest_ct'),
      st: str(u.st) || c('zb_guest_st'),
      zp: str(u.zp) || c('zb_guest_zp'),
      country: str(u.country) || c('zb_guest_country'),
    };

    // Respect the client's anonymity decision for non-checkout events:
    // if the client didn't send em/ph, don't re-add them from cookies here.
    const isCheckoutEvent = ['START_CHECKOUT', 'ADD_BILLING', 'PURCHASE'].includes(eventName);
    const isLoggedIn = c('zb_user_logged_in') === 'true';
    if (!isCheckoutEvent && !isLoggedIn && eventName !== 'SUBSCRIBE') {
      if (!str(u.em)) userData.em = undefined;
      if (!str(u.ph)) userData.ph = undefined;
      if (!str(u.fn)) userData.fn = undefined;
      if (!str(u.ln)) userData.ln = undefined;
    }

    // IP geolocation fallback when we have no location at all.
    if (!userData.country && !userData.st && !userData.ct && !userData.zp) {
      const ipGeo = await lookupIpGeo(getClientIP(req), req).catch(() => null);
      if (ipGeo && !ipGeo.isDevFallback) {
        userData.country = ipGeo.countryCode || undefined;
        userData.st = ipGeo.region || undefined;
        userData.ct = ipGeo.city || undefined;
        userData.zp = ipGeo.zip || undefined;
      }
    }

    const result = await sendSnapEvent({
      eventName,
      eventId,
      eventTime: typeof body.eventTime === 'number' ? body.eventTime : undefined,
      eventSourceUrl,
      userAgent: str(body.userAgent, 1024) || req.headers.get('user-agent') || '',
      ipAddress: ip,
      scClickId,
      scCookie1,
      externalId,
      userData,
      customData: body.customData && typeof body.customData === 'object' ? body.customData : undefined,
    });

    return NextResponse.json({ success: result.success, skipped: result.skipped });
  } catch (err: any) {
    console.error('[Snap CAPI Route Error]', err?.message || err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
