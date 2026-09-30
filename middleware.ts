import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { isPrivateIP } from "@/lib/ip-geo";

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
    "/web-store",
    "/web-store/orders",
    "/web-store/customers",
    "/web-store/abandoned-carts",
    "/web-store/storefront",
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
    "/dashboard/global-store",
  ],
  AI_SERVICES: [
    "/dashboard/ai",
    "/dashboard/ai/admin",
    "/dashboard/ai/user",
    "/dashboard/ai/training",
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

    // Allow webhook routes through without auth (Meta WhatsApp, Shopify, etc.)
    if (pathname.startsWith('/api/webhooks')) {
      return NextResponse.next();
    }

    // For storefront (non-admin) requests: extract client IP and set zb_client_ip cookie
    const isStorefront = !pathname.startsWith('/dashboard') &&
                         !pathname.startsWith('/web-store') &&
                         !pathname.startsWith('/api/admin') &&
                         !pathname.startsWith('/api/webhooks');

    const clientIp = req.headers.get('do-connecting-ip') ||
                     req.headers.get('cf-connecting-ip') ||
                     req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
                     req.headers.get('x-real-ip') ||
                     req.ip;

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

    const attachStorefrontCookies = (res: NextResponse) => {
      attachClientIpCookie(res);
      if (refParam) {
        try {
          const { signAffiliateCookie, getAffiliateCookieOptions } = require('@/lib/affiliate/cookie');
          const token = signAffiliateCookie({
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
      return attachStorefrontCookies(NextResponse.next());
    }

    // CSRF protection for mutation routes (POST, PUT, DELETE) on admin APIs
    if (["POST", "PUT", "DELETE"].includes(req.method)) {
      const origin = req.headers.get("origin");
      const referer = req.headers.get("referer");
      const currentHost = req.headers.get("host") || "";

      if (process.env.NODE_ENV === "production") {
        if (origin) {
          try {
            const originHost = new URL(origin).host;
            if (originHost !== currentHost) {
              return new NextResponse(JSON.stringify({ error: "CSRF validation failed: Origin mismatch" }), {
                status: 403,
                headers: { "Content-Type": "application/json" }
              });
            }
          } catch {
            return new NextResponse(JSON.stringify({ error: "CSRF validation failed: Invalid Origin" }), {
              status: 403,
              headers: { "Content-Type": "application/json" }
            });
          }
        } else if (referer) {
          try {
            const refererHost = new URL(referer).host;
            if (refererHost !== currentHost) {
              return new NextResponse(JSON.stringify({ error: "CSRF validation failed: Referer mismatch" }), {
                status: 403,
                headers: { "Content-Type": "application/json" }
              });
            }
          } catch {
            return new NextResponse(JSON.stringify({ error: "CSRF validation failed: Invalid Referer" }), {
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
      "/dashboard/analytics": "ANALYTICS",
      "/api/admin/analytics": "ANALYTICS",
      "/dashboard/settings": "SETTINGS",
      "/dashboard/admin-users": "ADMIN_USERS",
      "/dashboard/audit-log": "AUDIT_LOG",
      
      // Web Store CMS mappings
      "/web-store": "STOREFRONT",
      "/api/web-store": "STOREFRONT",
      "/dashboard/webstore-settings": "STOREFRONT",
      "/api/webstore-settings": "STOREFRONT",
      "/api/admin/abandoned-carts": "STOREFRONT",
      "/api/admin/mood-board": "STOREFRONT",
      
      // Admin API mappings for middleware double-guard
      "/api/admin/users": "ADMIN_USERS",
      "/api/admin/audit-logs": "ADMIN_USERS",
      "/dashboard/global-store": "INTEGRATIONS",
      "/api/admin/global-store": "INTEGRATIONS",
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

    return attachStorefrontCookies(NextResponse.next());
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
        const isAdminRoute =
          pathname.startsWith('/dashboard') ||
          pathname.startsWith('/web-store') ||
          pathname.startsWith('/api/admin') ||
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
