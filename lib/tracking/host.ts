/**
 * The ONE rule for where Meta / Snap events may come from.
 *
 * The ads run on zicabella.com, so the pixels, the browser → Conversions API relays
 * and the server Purchase events are tied to that host. Any other host this app
 * happens to answer on sends nothing: app.zicabella.com is the admin / API host and
 * it also serves storefront paths, so on it there is no pixel init, no browser
 * event, no relay post, and the relays refuse an event_source_url that names it.
 * www.zicabella.com is listed because it is the same site (the middleware 308s it
 * to the apex before any page renders).
 *
 * Isomorphic (browser + server), nothing secret. `process.env.NEXT_PUBLIC_SITE_URL`
 * and `process.env.NODE_ENV` are read literally so Next.js inlines them in the
 * browser bundle like any other NEXT_PUBLIC_ value.
 */

/** Hosts whose pages may send events. */
export const EVENT_HOSTS: readonly string[] = ['zicabella.com', 'www.zicabella.com'];

/** Hosts this app serves that must never send events, whatever the env says. */
export const NON_EVENT_HOSTS: readonly string[] = ['app.zicabella.com'];

/** Lowercase hostname without port or trailing dot ('' when unusable). */
export function normalizeHost(h: unknown): string {
  const s = String(h ?? '').trim().toLowerCase();
  if (!s) return '';
  // keep IPv6 literals ([::1]) intact; strip :port from everything else
  const noPort = s.startsWith('[') ? s.replace(/\](?::\d+)?$/, ']') : s.replace(/:\d+$/, '');
  return noPort.replace(/\.$/, '');
}

function hostOfUrl(url: unknown): string {
  const s = String(url ?? '').trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
  if (!s) return '';
  try { return normalizeHost(new URL(s).hostname); } catch { return ''; }
}

/**
 * The hosts whose pages may send events for this deployment: zicabella.com and
 * www, plus the host of NEXT_PUBLIC_SITE_URL (a staging deployment tracks its own
 * host; its pixel ids resolve separately), never app.zicabella.com. Outside
 * production builds localhost / 127.0.0.1 are added so local checks keep working.
 */
export function eventHosts(
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Set<string> {
  const hosts = new Set<string>(EVENT_HOSTS);
  const own = hostOfUrl(siteUrl);
  if (own && !NON_EVENT_HOSTS.includes(own)) hosts.add(own);
  if (nodeEnv !== 'production') {
    hosts.add('localhost');
    hosts.add('127.0.0.1');
    hosts.add('[::1]');
  }
  return hosts;
}

/** May a page on `hostname` send events? */
export function isEventHost(
  hostname: unknown,
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  const h = normalizeHost(hostname);
  if (!h || NON_EVENT_HOSTS.includes(h)) return false;
  return eventHosts(siteUrl, nodeEnv).has(h);
}

/** Browser only: may the current page send events? (false during SSR) */
export function isEventPage(): boolean {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return false;
  return isEventHost(window.location.hostname);
}

// ── platform default hosts → zicabella.com (middleware) ─────────────────────

/** Hostname suffixes the hosting platforms give this same build (never the shop's own name). */
const PLATFORM_HOST_SUFFIXES: readonly string[] = ['.ondigitalocean.app', '.onrender.com'];

/**
 * true for a platform default hostname (DigitalOcean's *.ondigitalocean.app, the old
 * Render *.onrender.com): storefront pages there are sent to zicabella.com by the
 * middleware, so no copy of the shop stays reachable on a host that sends no events.
 */
export function isNonCanonicalStorefrontHost(hostname: unknown): boolean {
  const h = normalizeHost(hostname);
  return !!h && PLATFORM_HOST_SUFFIXES.some(suffix => h.endsWith(suffix));
}

// ── app.zicabella.com → zicabella.com (middleware) ───────────────────────────

/**
 * Storefront pages on app.zicabella.com are 301'd to zicabella.com by the middleware.
 * These stay on the app host: the admin dashboard and APIs, Next internals, pages a
 * shopper may already be in the middle of on that host (cart, checkout, orders,
 * login, profile, portal, returns), machine-read files (feeds, sitemap, robots,
 * manifest, BIMI, .well-known) and anything that looks like a static file.
 */
const APP_HOST_KEEP = /^\/(?:dashboard|admin|web-store|api|_next|cart|checkout|orders|login|profile|portal|returns|unauthorized|uploads|r|bimi|\.well-known)(?:\/|$)|^\/(?:feed\.(?:xml|csv)|sitemap[^/]*\.xml|robots\.txt|manifest\.(?:json|webmanifest)|favicon\.ico)$/;
const LOOKS_LIKE_FILE = /\.[a-z0-9]{2,5}$/i;

/** true when a GET for `pathname` on app.zicabella.com should be sent to zicabella.com. */
export function isAppHostPathToRedirect(pathname: string): boolean {
  const path = String(pathname ?? '').replace(/[?#][\s\S]*$/, '');
  if (!path.startsWith('/')) return false;
  if (APP_HOST_KEEP.test(path)) return false;
  if (LOOKS_LIKE_FILE.test(path)) return false;
  return true;
}

// ── the dashboard lives on app.zicabella.com only (middleware + admin sign-in) ──

/** The admin dashboard host: the only host the dashboard is served on and admins may sign in from. */
export const DASHBOARD_HOST = 'app.zicabella.com';

/** The storefront hosts (zicabella.com and www): a dashboard path asked for here is sent to DASHBOARD_HOST. */
export const STOREFRONT_HOSTS: readonly string[] = EVENT_HOSTS;

/**
 * Paths that belong to the dashboard: the admin pages, the admin login page, the legacy
 * /web-store pages (next.config 307s them to /dashboard/webstore) and the APIs only
 * dashboard pages call (/api/admin, /api/web-store, /api/webstore-settings).
 */
const DASHBOARD_PATH = /^\/(?:dashboard|web-store|api\/admin|api\/web-store|api\/webstore-settings)(?:\/|$)/;
/**
 * …except what the storefront host needs itself: the middleware's own permission lookup
 * (INTERNAL_API_SECRET, built from the request's host) and the public banner / gallery
 * reads (app/gallery). Every other /api/admin and /api/web-store route is admin-only.
 */
const DASHBOARD_PATH_EXCEPT = /^\/api\/(?:admin\/users\/check-permissions|web-store\/(?:banners|gallery))(?:\/|$)/;

/** true when `pathname` is a dashboard page, the admin login page or a dashboard-only API. */
export function isDashboardPath(pathname: string): boolean {
  const path = String(pathname ?? '').replace(/[?#][\s\S]*$/, '');
  if (!path.startsWith('/')) return false;
  return DASHBOARD_PATH.test(path) && !DASHBOARD_PATH_EXCEPT.test(path);
}

/** Dev hosts admins may also sign in from. */
const DEV_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/**
 * May the dashboard be used — and an admin sign in — on `hostname`? app.zicabella.com,
 * the local dev hosts, and any host listed in ADMIN_LOGIN_HOSTS (comma-separated; a
 * staging deployment that serves its own dashboard). Never the storefront hosts.
 */
export function isDashboardHost(hostname: unknown, extra: string | undefined = process.env.ADMIN_LOGIN_HOSTS): boolean {
  const h = normalizeHost(hostname);
  if (!h || STOREFRONT_HOSTS.includes(h)) return false;
  if (h === DASHBOARD_HOST || DEV_HOSTS.includes(h)) return true;
  return String(extra ?? '').split(',').map(normalizeHost).filter(Boolean).includes(h);
}

/**
 * Where a request for `pathname` on a storefront host belongs: `https://app.zicabella.com`
 * + the same pathname + the same query string when it is a dashboard path, else null
 * (not a storefront host, or a storefront page / API). The middleware answers a GET / HEAD
 * with a 301 there and anything else with a 404.
 */
export function dashboardRedirectTarget(hostname: unknown, pathname: string, search: string = ''): string | null {
  const h = normalizeHost(hostname);
  if (!h || !STOREFRONT_HOSTS.includes(h)) return null;
  const path = String(pathname ?? '').replace(/[?#][\s\S]*$/, '');
  if (!isDashboardPath(path)) return null;
  const qs = String(search ?? '');
  return `https://${DASHBOARD_HOST}${path}${qs && !qs.startsWith('?') ? `?${qs}` : qs}`;
}

/**
 * The request host (x-forwarded-host first, then host; first value of a comma list),
 * normalized — from a Headers object or the plain header record NextAuth hands
 * authorize(). '' when there is none.
 */
export function requestHost(headers: { get(name: string): string | null } | Record<string, unknown> | null | undefined): string {
  if (!headers) return '';
  const get = (name: string): string => {
    let raw: unknown;
    if (typeof (headers as any).get === 'function') raw = (headers as any).get(name);
    else {
      const key = Object.keys(headers as object).find(k => k.toLowerCase() === name);
      raw = key ? (headers as any)[key] : undefined;
    }
    return String(raw ?? '').split(',')[0].trim();
  };
  return normalizeHost(get('x-forwarded-host') || get('host'));
}
