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
 * These stay on the app host: the admin dashboard and APIs, Next internals,
 * machine-read files (feeds, sitemap, robots, manifest, BIMI, .well-known) and
 * anything that looks like a static file. Every shopper page (cart, checkout, orders,
 * login, profile, portal, returns, affiliate links) goes to zicabella.com.
 */
const APP_HOST_KEEP = /^\/(?:dashboard|admin|web-store|api|_next|unauthorized|uploads|bimi|\.well-known)(?:\/|$)|^\/(?:feed\.(?:xml|csv)|sitemap[^/]*\.xml|robots\.txt|manifest\.(?:json|webmanifest)|favicon\.ico)$/;
const LOOKS_LIKE_FILE = /\.[a-z0-9]{2,5}$/i;

/** true when a GET for `pathname` on app.zicabella.com should be sent to zicabella.com. */
export function isAppHostPathToRedirect(pathname: string): boolean {
  const path = String(pathname ?? '').replace(/[?#][\s\S]*$/, '');
  if (!path.startsWith('/')) return false;
  if (APP_HOST_KEEP.test(path)) return false;
  if (LOOKS_LIKE_FILE.test(path)) return false;
  return true;
}

// ── zicabella.com → app.zicabella.com/dashboard (middleware) ─────────────────

/** The one host the admin dashboard lives on. */
export const ADMIN_HOST = 'app.zicabella.com';

const ADMIN_PAGE_PREFIX = /^\/(?:dashboard|admin|web-store)(?:\/|$)/;

/**
 * true for admin dashboard pages. zicabella.com (and www) 301 these to
 * app.zicabella.com, so the shop host never serves the dashboard. APIs are not pages
 * and are not moved (the storefront and the payment webhooks call them on zicabella.com).
 */
export function isAdminPagePath(pathname: string): boolean {
  return ADMIN_PAGE_PREFIX.test(String(pathname ?? '').replace(/[?#][\s\S]*$/, ''));
}
