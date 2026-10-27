import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { isPrivateIP } from "@/lib/ip-geo";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { isIdentityCookieRequest, identityCookieDomain, planMetaIdentityCookies, IDENTITY_REFRESH_MARKER, IDENTITY_REFRESH_INTERVAL_S } from "@/lib/meta/identity-cookies";

// ── Unknown collection handles → a real 404 ─────────────────────────────────
// The app streams every page behind app/loading.tsx, so a notFound() thrown in a
// collection page, its metadata or its layout only yields a "soft 404" (200 +
// not-found UI). Rewriting an unknown handle to an unmatched path makes Next answer
// with the branded not-found page and a 404 status. Handles come from
// /api/collections/handles (ISR 120 s) and are cached here per instance for 5 min;
// any failure fails open (no rewrite).
const COLLECTION_HANDLES_TTL_MS = 5 * 60_000;
const COLLECTION_HANDLES_RETRY_MS = 60_000;
let collectionHandlesCache: { set: Set<string> | null; validUntil: number; status: string } = { set: null, validUntil: 0, status: 'init' };
let collectionHandlesInflight: Promise<Set<string> | null> | null = null;

/** The app's own listener first (no Cloudflare / WAF in the way), then the public origin. */
function collectionHandleSources(nextUrl: URL): string[] {
  const port = (typeof process !== 'undefined' && process.env?.PORT) || nextUrl.port || '3000';
  const sources = [`http://127.0.0.1:${port}`];
  if (!/^(127\.0\.0\.1|localhost)$/.test(nextUrl.hostname)) sources.push(nextUrl.origin);
  return sources;
}

async function knownCollectionHandles(nextUrl: URL): Promise<Set<string> | null> {
  const now = Date.now();
  if (now < collectionHandlesCache.validUntil) return collectionHandlesCache.set;
  if (!collectionHandlesInflight) {
    collectionHandlesInflight = (async () => {
      const failures: string[] = [];
      for (const base of collectionHandleSources(nextUrl)) {
        try {
          const res = await fetch(`${base}/api/collections/handles`, { signal: AbortSignal.timeout(2500), cache: 'no-store', headers: { accept: 'application/json' } });
          const data = res.ok ? await res.json().catch(() => null) : null;
          const handles: unknown = data?.handles;
          if (Array.isArray(handles) && handles.length) {
            collectionHandlesCache = { set: new Set(handles.map(h => String(h).toLowerCase())), validUntil: Date.now() + COLLECTION_HANDLES_TTL_MS, status: 'ok' };
            collectionHandlesInflight = null;
            return collectionHandlesCache.set;
          }
          failures.push(`${res.status}`);
        } catch (e: any) {
          failures.push(String(e?.name || e?.message || 'error').slice(0, 24));
        }
      }
      collectionHandlesCache = { set: null, validUntil: Date.now() + COLLECTION_HANDLES_RETRY_MS, status: `unavailable:${failures.join(',')}` };
      collectionHandlesInflight = null;
      return null;
    })();
  }
  return collectionHandlesInflight;
}

const ALL_KNOWN_MODULE_PAGES: Record<string, string[]> = {
  DASHBOARD_HOME: ["/dashboard"],
  SUPPORT: ["/dashboard/support"],
  ORDERS: ["/dashboard/orders"],
  MOBILE_ORDERS: ["/dashboard/mobile-orders"],
  CUSTOMERS: ["/dashboard/customers"],
  PRODUCTS: [
    "/dashboard/products",
    "/dashboard/collections"
  ],
  INVENTORY: [
    "/dashboard/inventory",
    "/dashboard/inventory/scanner",
    "/dashboard/scanner-records",
    "/dashboard/price-tags",
  ],
  LOGISTICS: ["/dashboard/logistics"],
  RETURNS_EXCHANGES: [
    "/dashboard/returns",
    "/dashboard/exchanges",
    "/dashboard/refunds"
  ],
  STOREFRONT: [
    "/dashboard/webstore",
    "/dashboard/webstore/orders",
    "/dashboard/webstore/customers",
    "/dashboard/webstore/abandoned-carts",
    "/dashboard/webstore/storefront",
    "/dashboard/webstore/merchandising",
    "/dashboard/webstore/homepage",
    "/dashboard/webstore/products",
    "/dashboard/webstore/banners",
    "/dashboard/webstore/gallery",
    "/dashboard/webstore/coupons",
    "/dashboard/webstore/logins",
    "/web-store",
    "/web-store/orders",
    "/web-store/customers",
    "/web-store/abandoned-carts",
    "/web-store/storefront",
    "/web-store/merchandising",
    "/web-store/homepage",
    "/web-store/products",
    "/web-store/banners",
    "/web-store/gallery",
    "/web-store/coupons",
    "/web-store/logins",
    "/dashboard/webstore-settings/preferences",
    "/dashboard/global-store",
  ],
  COMMUNITY: [
    "/dashboard/community/chat",
    "/dashboard/community",
    "/dashboard/blogs",
  ],
  MARKETING: [
    "/dashboard/marketing/seo",
    "/dashboard/marketing/catalogue-feeds",
    "/dashboard/marketing/analytics",
    "/dashboard/marketing/meta-pixel",
    "/dashboard/wishlist",
    "/dashboard/notifications",
    "/dashboard/marketing/discounts",
    "/dashboard/marketing/whatsapp",
    "/dashboard/marketing/email",
    "/dashboard/marketing/sms",
    "/dashboard/whatsapp-events/overview",
    "/dashboard/whatsapp-events/events",
    "/dashboard/whatsapp-events/campaign-analytics",
    "/dashboard/whatsapp-events/templates",
    "/dashboard/whatsapp-events/customer-journeys",
    "/dashboard/whatsapp-events/meta-review",
  ],
  FINANCIAL: [
    "/dashboard/payments",
    "/dashboard/payments/store-credits",
    "/dashboard/payments/refunds",
    "/dashboard/refunds",
  ],
  INTEGRATIONS: [
    "/dashboard/app-integration",
    "/dashboard/live-carts",
    "/dashboard/app-logins",
    "/dashboard/payments/razorpay",
  ],
  SETTINGS: ["/dashboard/settings"],
  ADMIN_USERS: ["/dashboard/admin-users"],
  AUDIT_LOG: ["/dashboard/audit-log"],
  ANALYTICS: ["/dashboard/analytics"],
  AFFILIATES: [
    "/dashboard/affiliates",
    "/dashboard/affiliates/withdrawals",
  ],
};

export default withAuth(
  async function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Defense-in-depth: www -> apex 308 redirect
    const host = req.headers.get("x-forwarded-host")?.split(":")[0] || req.headers.get("host")?.split(":")[0] || req.nextUrl.hostname;
    if (host === "www.zicabella.com" || req.nextUrl.hostname === "www.zicabella.com") {
      const url = req.nextUrl.clone();
      url.hostname = "zicabella.com";
      url.protocol = "https";
      return NextResponse.redirect(url, 308);
    }

    // Allow login page to load without checks to avoid redirect loop
    if (pathname === '/dashboard/login') {
      return NextResponse.next();
    }

    // Developer Brief #26: admin-dashboard AI UI removed (customer-facing Zica AI stays)
    if (pathname === '/dashboard/ai' || pathname.startsWith('/dashboard/ai/')) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }

    // Allow webhook / payment-provider callbacks through without auth or CSRF.
    // These are authenticated by signature headers, not browser Origin.
    // Razorpay: only public create/verify — refund & capture require admin auth.
    if (
      pathname.startsWith('/api/webhooks') ||
      pathname.startsWith('/api/shopify/webhooks') ||
      pathname.startsWith('/api/whatsapp/webhook') ||
      pathname.startsWith('/api/payments/webhook') ||
      pathname === '/api/razorpay/create-order' ||
      pathname === '/api/razorpay/verify-payment'
    ) {
      return NextResponse.next();
    }

    // Razorpay callback_url: often POSTs payment fields (Origin = razorpay).
    // Convert to GET so the success page can read searchParams and finish checkout.
    if (pathname === '/checkout/success') {
      if (req.method === 'POST') {
        try {
          const contentType = req.headers.get('content-type') || '';
          const url = req.nextUrl.clone();
          if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
            const formData = await req.formData();
            for (const key of ['razorpay_payment_id', 'razorpay_order_id', 'razorpay_signature']) {
              const val = formData.get(key);
              if (typeof val === 'string' && val) url.searchParams.set(key, val);
            }
          } else {
            // Some gateways POST JSON; also accept already-present query params
            try {
              const body = await req.json();
              for (const key of ['razorpay_payment_id', 'razorpay_order_id', 'razorpay_signature']) {
                if (body?.[key]) url.searchParams.set(key, String(body[key]));
              }
            } catch {
              /* keep any existing query */
            }
          }
          return NextResponse.redirect(url, 303);
        } catch (e: any) {
          console.warn('[Middleware] Razorpay callback POST parse failed:', e?.message);
          return NextResponse.redirect(new URL('/checkout/success', req.url), 303);
        }
      }
      return NextResponse.next();
    }

    // For storefront (non-admin) requests: extract client IP and set zb_client_ip cookie
    const isStorefront = !pathname.startsWith('/dashboard') &&
                         !pathname.startsWith('/web-store') &&
                         !pathname.startsWith('/api/admin') &&
                         !pathname.startsWith('/api/webhooks');

    // /collections/<unknown-handle> → 404 (see knownCollectionHandles above). 'all' is virtual.
    // x-zb-handles on collection pages says whether the handle list was available (post-deploy check).
    let collectionCheckHeader = '';
    const collectionMatch = isStorefront && req.method === 'GET' ? pathname.match(/^\/collections\/([^/]+)\/?$/) : null;
    if (collectionMatch) {
      let handle = '';
      try { handle = decodeURIComponent(collectionMatch[1]).trim().toLowerCase(); } catch { handle = collectionMatch[1].toLowerCase(); }
      if (handle && handle !== 'all') {
        const known = await knownCollectionHandles(req.nextUrl);
        if (known && !known.has(handle)) {
          return NextResponse.rewrite(new URL('/__collection-not-found', req.url));
        }
        collectionCheckHeader = known ? 'ok' : collectionHandlesCache.status;
      }
    }

    const clientIp = clientIpFromHeaders(req.headers) || req.ip;

    const shouldSetClientIp = isStorefront &&
                              clientIp &&
                              !isPrivateIP(clientIp) &&
                              req.cookies.get('zb_client_ip')?.value !== clientIp;

    const attachClientIpCookie = (res: NextResponse) => {
      if (shouldSetClientIp && clientIp) {
        res.cookies.set('zb_client_ip', clientIp, {
          path: '/',
          httpOnly: false,
          maxAge: 60 * 60 * 24 * 7, // 7 days
          sameSite: 'lax',
        });
      }
      return res;
    };

    // Query-param capture for Affiliate referral (?ref=CODE or ?aff=CODE)
    const refParam = isStorefront
      ? (req.nextUrl.searchParams.get('ref') || req.nextUrl.searchParams.get('aff'))?.trim()
      : null;

    // Meta identity cookies (_fbp, _fbc from ?fbclid, zb_external_id) and Snap's
    // ScCid (?ScCid) / _scid are minted and refreshed here as HTTP cookies on
    // storefront page loads: Safari caps
    // script-written cookies at 7 days (24 h after an fbclid landing), HTTP cookies
    // it does not. Same names, domain and values the client code writes, so the
    // Pixel SDK and the client simply find them present. See lib/meta/identity-cookies.ts.
    const wantsIdentityCookies = isStorefront && isIdentityCookieRequest({
      method: req.method,
      pathname,
      secFetchDest: req.headers.get('sec-fetch-dest'),
      accept: req.headers.get('accept'),
    });

    const attachMetaIdentityCookies = (res: NextResponse) => {
      if (!wantsIdentityCookies) return res;
      try {
        const host = req.headers.get('x-forwarded-host')?.split(',')[0].split(':')[0].trim() || req.headers.get('host')?.split(':')[0] || req.nextUrl.hostname;
        const proto = (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')).split(',')[0].trim();
        const domain = identityCookieDomain(host);
        const plan = planMetaIdentityCookies({
          fbp: req.cookies.get('_fbp')?.value,
          fbc: req.cookies.get('_fbc')?.value,
          externalId: req.cookies.get('zb_external_id')?.value,
          fbclid: req.nextUrl.searchParams.get('fbclid'),
          scCid: req.cookies.get('ScCid')?.value,
          scClickParam: req.nextUrl.searchParams.get('ScCid') || req.nextUrl.searchParams.get('sccid'),
          scid: req.cookies.get('_scid')?.value,
          nowMs: Date.now(),
          uuid: () => crypto.randomUUID(),
        });
        // Set-Cookie on an HTML response can stop a CDN caching it, so unchanged
        // values are refreshed at most once per 12 h (marker cookie zb_idc); a new
        // or changed value (first visit, new click id) is always written.
        const refreshDue = !req.cookies.get(IDENTITY_REFRESH_MARKER)?.value;
        const toSet = plan.filter(c => c.changed || refreshDue);
        if (toSet.length === 0) return res;
        const opts = { path: '/', sameSite: 'lax' as const, secure: proto === 'https', ...(domain ? { domain } : {}) };
        for (const c of toSet) {
          // Not HttpOnly: the Pixel SDK and the storefront code read these.
          res.cookies.set(c.name, c.value, { ...opts, maxAge: c.maxAge, httpOnly: false });
        }
        if (refreshDue) res.cookies.set(IDENTITY_REFRESH_MARKER, '1', { ...opts, maxAge: IDENTITY_REFRESH_INTERVAL_S, httpOnly: true });
      } catch (e: any) {
        console.warn('[Middleware] Meta identity cookies skipped:', e?.message);
      }
      return res;
    };

    const attachStorefrontCookies = async (res: NextResponse) => {
      if (collectionCheckHeader) res.headers.set('x-zb-handles', collectionCheckHeader);
      attachClientIpCookie(res);
      attachMetaIdentityCookies(res);
      if (refParam) {
        try {
          const { signAffiliateCookie, getAffiliateCookieOptions } = await import('@/lib/affiliate/cookie');
          const token = await signAffiliateCookie({
            code: refParam.toUpperCase(),
            ts: Date.now(),
          });
          const opts = getAffiliateCookieOptions();
          res.cookies.set(opts.name, token, opts);
        } catch (e: any) {
          console.warn('[Middleware] Failed to sign affiliate cookie:', e.message);
        }
      }
      return res;
    };

    // Allow public API routes for the React Native app and Zica AI
    if (pathname.startsWith('/api/app/') || pathname.startsWith('/api/zica-ai')) {
      return await attachStorefrontCookies(NextResponse.next());
    }

    // CSRF for admin mutations only — never storefront checkout/cart/orders.
    // Broad CSRF was blocking Razorpay callback POSTs and payment webhooks
    // ("CSRF validation failed: Origin mismatch" → success.json download).
    const isAdminMutationPath =
      pathname.startsWith('/dashboard') ||
      pathname.startsWith('/web-store') ||
      pathname.startsWith('/api/admin') ||
      pathname.startsWith('/api/web-store') ||
      pathname.startsWith('/api/email') ||
      pathname.startsWith('/api/mail') ||
      pathname.startsWith('/api/marketing') ||
      pathname.startsWith('/api/notifications/send-manual') ||
      pathname === '/api/send-notification' ||
      (pathname.startsWith('/api/whatsapp') && !pathname.startsWith('/api/whatsapp/webhook')) ||
      (pathname.startsWith('/api/shopify') && !pathname.startsWith('/api/shopify/webhooks') && !pathname.startsWith('/api/shopify/auth')) ||
      pathname === '/api/razorpay/refund' ||
      pathname === '/api/razorpay/capture-payment' ||
      pathname === '/api/payments/refund';

    if (isAdminMutationPath && ["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
      const origin = req.headers.get("origin");
      const referer = req.headers.get("referer");
      const currentHost = (
        req.headers.get("x-forwarded-host") ||
        req.headers.get("host") ||
        ""
      ).split(",")[0].trim().split(":")[0];

      const allowedHosts = new Set([
        currentHost,
        "zicabella.com",
        "www.zicabella.com",
        "app.zicabella.com",
      ].filter(Boolean));

      const hostAllowed = (raw: string) => {
        try {
          return allowedHosts.has(new URL(raw).host.split(":")[0]);
        } catch {
          return false;
        }
      };

      if (process.env.NODE_ENV === "production") {
        if (origin) {
          if (!hostAllowed(origin)) {
            return new NextResponse(JSON.stringify({ error: "CSRF validation failed: Origin mismatch" }), {
              status: 403,
              headers: { "Content-Type": "application/json" }
            });
          }
        } else if (referer) {
          if (!hostAllowed(referer)) {
            return new NextResponse(JSON.stringify({ error: "CSRF validation failed: Referer mismatch" }), {
              status: 403,
              headers: { "Content-Type": "application/json" }
            });
          }
        } else {
          return new NextResponse(JSON.stringify({ error: "CSRF validation failed: Missing origin/referer headers" }), {
            status: 403,
            headers: { "Content-Type": "application/json" }
          });
        }
      }
    }

    // Super Admin bypasses all checks
    if (token?.role === "SUPER_ADMIN") return NextResponse.next();

    // Map pathnames to modules for RBAC
    const moduleMap: Record<string, string> = {
      "/dashboard/orders": "ORDERS",
      "/api/admin/orders": "ORDERS",
      "/dashboard/products": "PRODUCTS",
      "/dashboard/inventory": "INVENTORY",
      "/dashboard/customers": "CUSTOMERS",
      "/dashboard/production": "PRODUCTION_TRACKER",
      "/dashboard/financial": "FINANCIAL",
      "/dashboard/marketing": "MARKETING",
      "/api/discounts": "MARKETING",
      "/dashboard/vendors": "VENDORS",
      "/dashboard/returns": "RETURNS_EXCHANGES",
      "/dashboard/exchanges": "RETURNS_EXCHANGES",
      "/api/admin/returns": "RETURNS_EXCHANGES",
      "/api/admin/exchanges": "RETURNS_EXCHANGES",
      "/dashboard/analytics": "ANALYTICS",
      "/api/admin/analytics": "ANALYTICS",
      "/dashboard/settings": "SETTINGS",
      "/dashboard/admin-users": "ADMIN_USERS",
      "/dashboard/audit-log": "AUDIT_LOG",
      
      // Web Store CMS mappings
      "/dashboard/webstore": "STOREFRONT",
      "/web-store": "STOREFRONT",
      "/api/web-store": "STOREFRONT",
      "/dashboard/webstore-settings": "STOREFRONT",
      "/api/webstore-settings": "STOREFRONT",
      "/api/admin/abandoned-carts": "STOREFRONT",
      "/api/admin/mood-board": "STOREFRONT",
      "/api/admin/storefront": "STOREFRONT",
      
      // Admin API mappings for middleware double-guard
      "/api/admin/users": "ADMIN_USERS",
      "/api/admin/audit-logs": "ADMIN_USERS",
      "/dashboard/global-store": "STOREFRONT",
      "/api/admin/global-store": "STOREFRONT",
      "/dashboard/affiliates": "AFFILIATES",
      "/api/admin/affiliates": "AFFILIATES",
    };

    // Check module-specific page/API access
    const apiPageMap: Record<string, string> = {
      "/api/admin/orders": "/dashboard/orders",
      "/api/admin/affiliates": "/dashboard/affiliates",
      "/api/web-store/stats": "/web-store",
      "/api/web-store/orders": "/web-store/orders",
      "/api/web-store/customers": "/web-store/customers",
      "/api/web-store/banners": "/web-store/banners",
      "/api/web-store/gallery": "/web-store/gallery",
      "/api/web-store/coupons": "/web-store/coupons",
      "/api/web-store/logins": "/web-store/logins",
      "/api/webstore-settings": "/dashboard/webstore-settings/preferences",
      "/api/admin/users": "/dashboard/admin-users",
      "/api/admin/audit-logs": "/dashboard/audit-log",
      "/api/admin/abandoned-carts": "/web-store/abandoned-carts",
      "/api/admin/mood-board": "/web-store/products",
      "/api/admin/storefront": "/web-store/merchandising",
      "/api/admin/analytics": "/dashboard/analytics",
    };

    // Sort routes by length descending so that longest match runs first (e.g. /dashboard/admin-users before /dashboard)
    const sortedRoutes = Object.keys(moduleMap).sort((a, b) => b.length - a.length);

    for (const route of sortedRoutes) {
      if (pathname.startsWith(route)) {
        // Allow public GET requests on banners API
        if (pathname === "/api/web-store/banners" && req.method === "GET") {
          continue;
        }

        const permissions = (token?.permissions as any[]) || [];
        const permission = permissions.find(p => p.module === moduleMap[route]);
        
        const isApi = pathname.startsWith('/api/');
        let hasAccess = false;
        
        // 1. Run real-time check using secure internal API
        try {
          const checkUrl = new URL(`/api/admin/users/check-permissions`, req.url);
          checkUrl.searchParams.set("userId", token?.id as string);
          checkUrl.searchParams.set("module", moduleMap[route]);
          checkUrl.searchParams.set("path", pathname);
          checkUrl.searchParams.set("method", req.method);
          
          const res = await fetch(checkUrl.toString(), {
            headers: {
              "x-internal-secret": process.env.INTERNAL_API_SECRET || ""
            }
          });
          if (res.ok) {
            const data = await res.json();
            hasAccess = data.hasAccess;
          } else {
            throw new Error(`Response status: ${res.status}`);
          }
        } catch (err) {
          console.warn("Middleware real-time permissions check failed, falling back to token validation:", err);
          
          // Fallback to token permissions
          if (permission) {
            if (isApi) {
              const isWrite = ["POST", "PUT", "DELETE", "PATCH"].includes(req.method);
              if (isWrite) {
                hasAccess = req.method === "DELETE" ? permission.canDelete || permission.canEdit : permission.canEdit;
              } else {
                hasAccess = permission.canView;
              }
            } else {
              hasAccess = permission.canView;
            }

            // Enforce granular page-level check with crossing prevention
            if (hasAccess && permission.pages) {
              const allowedPages = (permission.pages as string).split(',');
              // Admins who could manage the old Homepage Products / All Products pages keep access to the merged "Products & Order" page.
              if (allowedPages.includes('/web-store/homepage') || allowedPages.includes('/web-store/products')) {
                allowedPages.push('/web-store/merchandising');
              }
              const knownPagesForModule = ALL_KNOWN_MODULE_PAGES[moduleMap[route]] || [];
              if (isApi) {
                let targetPage: string | null = null;
                for (const [apiPrefix, pageRoute] of Object.entries(apiPageMap)) {
                  if (pathname.startsWith(apiPrefix)) {
                    targetPage = pageRoute;
                    break;
                  }
                }
                if (targetPage && !allowedPages.includes(targetPage)) {
                  hasAccess = false;
                }
              } else {
                let isAllowed = false;
                for (const allowedPage of allowedPages) {
                  if (pathname === allowedPage || pathname.startsWith(allowedPage + "/")) {
                    const isCrossingIntoOtherRestrictedPage = knownPagesForModule.some(kp => 
                      kp !== allowedPage && 
                      !allowedPages.includes(kp) && 
                      (pathname === kp || pathname.startsWith(kp + "/"))
                    );
                    if (!isCrossingIntoOtherRestrictedPage) {
                      isAllowed = true;
                      break;
                    }
                  }
                }
                hasAccess = isAllowed;
              }
            }
          }
        }
        
        if (!hasAccess) {
          if (isApi) {
            return new NextResponse(
              JSON.stringify({ error: `Forbidden: Insufficient permissions for module ${moduleMap[route]}` }), 
              {
                status: 403,
                headers: { "Content-Type": "application/json" }
              }
            );
          } else {
            return NextResponse.redirect(new URL("/unauthorized", req.url));
          }
        }
        
        // Match found and verified, skip other routes
        break;
      }
    }

    return await attachStorefrontCookies(NextResponse.next());
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;
        const host = req.headers.get("x-forwarded-host")?.split(":")[0] || req.headers.get("host")?.split(":")[0] || req.nextUrl.hostname;

        // www -> apex redirect backstop: bypass auth check so middleware function handles 308 redirect
        if (host === "www.zicabella.com" || req.nextUrl.hostname === "www.zicabella.com") {
          return true;
        }

        // Determine if route requires NextAuth admin validation
        const shopifyPublicGet =
          req.method === 'GET' &&
          (pathname.startsWith('/api/shopify/products') ||
            pathname.startsWith('/api/shopify/collections'));

        const isAdminRoute =
          pathname.startsWith('/dashboard') ||
          pathname.startsWith('/web-store') ||
          pathname.startsWith('/api/admin') ||
          pathname.startsWith('/api/email') ||
          pathname.startsWith('/api/mail') ||
          pathname.startsWith('/api/marketing') ||
          pathname.startsWith('/api/notifications/send-manual') ||
          pathname.startsWith('/api/notifications/history') ||
          pathname.startsWith('/api/notifications/stats') ||
          pathname === '/api/send-notification' ||
          // Covers /api/whatsapp/* and admin /api/whatsapp-events/*; the storefront tracker is public.
          (pathname.startsWith('/api/whatsapp') &&
            !pathname.startsWith('/api/whatsapp/webhook') &&
            pathname !== '/api/whatsapp-events/track') ||
          (pathname.startsWith('/api/shopify') &&
            !pathname.startsWith('/api/shopify/webhooks') &&
            !pathname.startsWith('/api/shopify/auth') &&
            !shopifyPublicGet) ||
          pathname === '/api/razorpay/refund' ||
          pathname === '/api/razorpay/capture-payment' ||
          (pathname.startsWith('/api/web-store') && !(pathname === '/api/web-store/banners' || pathname === '/api/web-store/gallery')) ||
          pathname === '/api/payments/refund';

        if (!isAdminRoute) return true;
        
        // Skip auth for login page to avoid redirect loop
        if (pathname === '/dashboard/login') return true;
        
        // Allow public app APIs
        if (pathname.startsWith('/api/app/')) return true;

        // Allow public banners and gallery API GET request
        if ((pathname === '/api/web-store/banners' || pathname === '/api/web-store/gallery') && req.method === 'GET') return true;

        const role = token?.role as string;
        const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

        return !!token && isAdmin;
      },
    },
    pages: {
      signIn: "/dashboard/login",
    },
  }
);

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
