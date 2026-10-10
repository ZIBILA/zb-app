import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sendSnapEvent } from '@/lib/snap-capi';
import { getClientIP, lookupIpGeo, isPrivateIP } from '@/lib/ip-geo';

/**
 * Public, browser-facing Snap CAPI relay for NON-monetary-authoritative web events.
 *
 * PURCHASE is deliberately NOT accepted here: anyone can call this route, so a
 * Purchase built from a request body could be forged. The only Snap CAPI
 * PURCHASE comes from lib/snap/purchase.ts, which rebuilds it from the database.
 *
 * Defence in depth: strict schema, event allowlist, storefront-host check on
 * event_source_url, value/quantity bounds, per-IP rate limit, opaque responses.
 * (Origin/Referer are spoofable and are not used as authentication.)
 */

const RELAYED_EVENTS = [
  'PAGE_VIEW', 'VIEW_CONTENT', 'ADD_CART', 'ADD_TO_WISHLIST', 'SEARCH',
  'START_CHECKOUT', 'ADD_BILLING', 'SIGN_UP', 'LOGIN', 'SUBSCRIBE',
] as const;

const MAX_VALUE = 1_000_000;   // per event, in the event currency
const MAX_QTY = 100;
const MAX_IDS = 50;

const id = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_\-:./]+$/);
const shortStr = z.string().trim().max(256);
const money = z.number().finite().min(0).max(MAX_VALUE);

const customDataSchema = z.strictObject({
  value: money.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  content_ids: z.array(id).max(MAX_IDS).optional(),
  content_category: shortStr.optional(),
  content_name: shortStr.optional(),
  content_type: z.enum(['product', 'product_group']).optional(),
  contents: z.array(z.strictObject({
    id,
    quantity: z.number().int().min(1).max(MAX_QTY).optional(),
    item_price: money.optional(),
  })).max(MAX_IDS).optional(),
  num_items: z.union([z.number().int().min(0).max(MAX_QTY * MAX_IDS), z.string().regex(/^\d{1,4}$/)]).optional(),
  search_string: z.string().trim().max(200).optional(),
});

const userDataSchema = z.strictObject({
  em: shortStr.optional(), ph: shortStr.optional(), fn: shortStr.optional(), ln: shortStr.optional(),
  ct: shortStr.optional(), st: shortStr.optional(), zp: shortStr.optional(), country: shortStr.optional(),
});

const bodySchema = z.strictObject({
  eventName: z.enum(RELAYED_EVENTS),
  eventId: z.string().regex(/^[A-Za-z0-9_.:\-]{6,128}$/),
  eventTime: z.number().finite().optional(),
  eventSourceUrl: z.string().max(2048).url(),
  userAgent: z.string().max(1024).optional(),
  scClickId: z.string().max(512).optional(),
  scCookie1: z.string().max(512).optional(),
  externalId: z.string().max(256).optional(),
  userData: userDataSchema.optional(),
  customData: customDataSchema.optional(),
});

// ── Storefront host allowlist for event_source_url ──
function allowedHosts(): Set<string> {
  const hosts = new Set(['zicabella.com', 'www.zicabella.com', 'app.zicabella.com']);
  try {
    if (process.env.NEXT_PUBLIC_SITE_URL) hosts.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).hostname);
  } catch { /* ignore */ }
  if (process.env.NODE_ENV !== 'production') hosts.add('localhost');
  return hosts;
}
const HOSTS = allowedHosts();

// ── Per-IP sliding-window rate limit (in-memory on purpose: this route is hit on
//    every page view, and a DB-backed limiter would add a write per event to an
//    already connection-constrained Postgres). ──
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
const hits = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 20_000) {
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
  }
  return arr.length > MAX_PER_WINDOW;
}

const reject = (status: number, error: string) => NextResponse.json({ success: false, error }, { status });

export async function POST(req: NextRequest) {
  try {
    // Rate-limit identity = the IP our hosting proxy reports for THIS connection
    // (do-connecting-ip on DigitalOcean, then standard forwarding headers).
    // Never a cookie: zb_client_ip is client-controlled and could be rotated
    // per request to dodge the limit.
    const trustedIp = getClientIP(req);
    if (rateLimited(trustedIp || 'unknown')) return reject(429, 'rate_limited');

    let raw: unknown;
    try { raw = await req.json(); } catch { return reject(400, 'invalid_json'); }

    if (raw && typeof raw === 'object' && (raw as any).eventName === 'PURCHASE') {
      return reject(400, 'purchase_is_server_authoritative');
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return reject(400, 'invalid_event');
    const body = parsed.data;

    let url: URL;
    try { url = new URL(body.eventSourceUrl); } catch { return reject(400, 'invalid_event'); }
    if (!HOSTS.has(url.hostname) || !/^https?:$/.test(url.protocol)) return reject(400, 'invalid_source');
    const path = url.pathname.toLowerCase();
    if (path.startsWith('/dashboard') || path.startsWith('/admin') || path.startsWith('/web-store')) {
      return NextResponse.json({ success: false, skipped: true });
    }

    // Snap identifiers: the shopper's own cookies first, body only as fallback.
    const c = (k: string) => req.cookies.get(k)?.value;
    const scClickId = c('ScCid') || c('_sccid') || body.scClickId;
    const scCookie1 = c('_scid') || body.scCookie1;
    const externalId = c('zb_external_id') || body.externalId;
    // client_ip_address for matching: the same trusted request IP. The middleware
    // cookie is used only when no public IP is available (e.g. local dev).
    const cookieIp = req.cookies.get('zb_client_ip')?.value;
    const ip = trustedIp && !isPrivateIP(trustedIp)
      ? trustedIp
      : (cookieIp && !isPrivateIP(cookieIp) ? cookieIp : undefined);

    const u = body.userData || {};
    const userData = {
      em: u.em || c('zb_guest_email'),
      ph: u.ph || c('zb_guest_phone'),
      fn: u.fn || c('zb_guest_fn'),
      ln: u.ln || c('zb_guest_ln'),
      ct: u.ct || c('zb_guest_ct'),
      st: u.st || c('zb_guest_st'),
      zp: u.zp || c('zb_guest_zp'),
      country: u.country || c('zb_guest_country'),
    };

    // Anonymous, non-checkout events: never re-attach identity cookies the
    // client chose not to send (shared-device privacy).
    const isCheckoutEvent = body.eventName === 'START_CHECKOUT' || body.eventName === 'ADD_BILLING';
    const isLoggedIn = c('zb_user_logged_in') === 'true';
    if (!isCheckoutEvent && !isLoggedIn && body.eventName !== 'SUBSCRIBE') {
      if (!u.em) userData.em = undefined;
      if (!u.ph) userData.ph = undefined;
      if (!u.fn) userData.fn = undefined;
      if (!u.ln) userData.ln = undefined;
    }

    if (!userData.country && !userData.st && !userData.ct && !userData.zp && ip) {
      const ipGeo = await lookupIpGeo(ip, req).catch(() => null);
      if (ipGeo && !ipGeo.isDevFallback) {
        userData.country = ipGeo.countryCode || undefined;
        userData.st = ipGeo.region || undefined;
        userData.ct = ipGeo.city || undefined;
        userData.zp = ipGeo.zip || undefined;
      }
    }

    const result = await sendSnapEvent({
      eventName: body.eventName,
      eventId: body.eventId,
      eventTime: body.eventTime,
      eventSourceUrl: body.eventSourceUrl,
      userAgent: body.userAgent || req.headers.get('user-agent') || '',
      ipAddress: ip,
      scClickId,
      scCookie1,
      externalId,
      userData,
      customData: body.customData,
    });

    // Opaque: never echo Snap's response, tokens or internal errors.
    return NextResponse.json({ success: result.success, ...(result.skipped ? { skipped: true } : {}) });
  } catch (err: any) {
    console.error('[Snap CAPI Route Error]', err?.message || err);
    return reject(500, 'internal_error');
  }
}
