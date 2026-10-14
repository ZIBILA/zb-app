/**
 * Snap Pixel / Conversions API configuration — the ONE place the pixel id and the
 * storefront hosts are defined. Every other Snap module reads them from here.
 *
 * Isomorphic (browser + server): no Node-only imports and nothing secret. The
 * Conversions API access token is server-only and is read in lib/snap-capi.ts.
 *
 * Environment variables
 *   NEXT_PUBLIC_SNAP_PIXEL_ID   optional. The pixel id (a UUID). "off" disables
 *                               Snap tracking for that deployment. When unset, a
 *                               PRODUCTION build of the live site uses the
 *                               store's own pixel (below); development / test
 *                               builds, and a build whose NEXT_PUBLIC_SITE_URL
 *                               is another host (staging), stay silent, so no
 *                               other deployment ever feeds the live pixel.
 *   NEXT_PUBLIC_SITE_URL        canonical storefront URL (already used app-wide).
 */

/** Zica Bella's Snap Pixel. A pixel id is public (it is in every page's HTML) — not a secret. */
export const SNAP_PRODUCTION_PIXEL_ID = '7d2481be-4ccf-42b2-b9ea-958c6c7bbdcd';

const PIXEL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_PIXEL_ID = '00000000-0000-0000-0000-000000000000';
const OFF_VALUES = new Set(['off', 'false', 'disabled', 'none', '0']);

/** Trim, and drop one pair of wrapping quotes (a common copy-paste slip in env editors). */
export function cleanEnvValue(v: unknown): string {
  const s = String(v ?? '').trim();
  const m = s.match(/^(['"])([\s\S]*)\1$/);
  return (m ? m[2] : s).trim();
}

/**
 * The Snap Pixel id this deployment uses, or '' when Snap tracking is off.
 * The defaults read `process.env.X` literally so Next.js inlines them in the
 * browser bundle exactly like any other NEXT_PUBLIC_ value.
 */
export function resolveSnapPixelId(
  raw: string | undefined = process.env.NEXT_PUBLIC_SNAP_PIXEL_ID,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string {
  const v = cleanEnvValue(raw);
  if (OFF_VALUES.has(v.toLowerCase())) return '';
  if (PIXEL_ID_RE.test(v) && v !== PLACEHOLDER_PIXEL_ID) return v.toLowerCase();
  // Not set, or not a pixel id (e.g. the all-zero placeholder): a production
  // build of the live site keeps tracking with the store's pixel; every other
  // environment (dev, test, a staging host) sends nothing.
  return usesBuiltInPixel(nodeEnv, siteUrl) ? SNAP_PRODUCTION_PIXEL_ID : '';
}

/** A human-readable problem with NEXT_PUBLIC_SNAP_PIXEL_ID, or null. For diagnostics only. */
export function snapPixelIdProblem(
  raw: string | undefined = process.env.NEXT_PUBLIC_SNAP_PIXEL_ID,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string | null {
  const v = cleanEnvValue(raw);
  const builtIn = usesBuiltInPixel(nodeEnv, siteUrl);
  if (!v) {
    return builtIn ? null : nodeEnv === 'production'
      ? `NEXT_PUBLIC_SNAP_PIXEL_ID is not set and NEXT_PUBLIC_SITE_URL (${cleanEnvValue(siteUrl)}) is not a live storefront host — Snap tracking is off on this deployment`
      : 'NEXT_PUBLIC_SNAP_PIXEL_ID is not set (Snap tracking is off outside production builds)';
  }
  if (OFF_VALUES.has(v.toLowerCase())) return 'Snap tracking is switched off (NEXT_PUBLIC_SNAP_PIXEL_ID=off)';
  if (!PIXEL_ID_RE.test(v) || v === PLACEHOLDER_PIXEL_ID) {
    return builtIn
      ? 'NEXT_PUBLIC_SNAP_PIXEL_ID is not a valid pixel id — the built-in store pixel is used instead'
      : 'NEXT_PUBLIC_SNAP_PIXEL_ID is not a valid pixel id';
  }
  return null;
}

/** The built-in pixel applies to production builds of the live site only. */
function usesBuiltInPixel(nodeEnv: string | undefined, siteUrl: string | undefined): boolean {
  return nodeEnv === 'production' && isSnapProductionSite(siteUrl);
}

// ── Storefront hosts ────────────────────────────────────────────────────────

/** Hosts that serve the live storefront. */
export const SNAP_PRODUCTION_HOSTS: readonly string[] = ['zicabella.com', 'www.zicabella.com', 'app.zicabella.com'];

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/** Hosts whose pages may appear as an event_source_url. */
export function snapStorefrontHosts(
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Set<string> {
  const hosts = new Set<string>(SNAP_PRODUCTION_HOSTS);
  const own = hostOf(cleanEnvValue(siteUrl));
  if (own) hosts.add(own);
  if (nodeEnv !== 'production') hosts.add('localhost');
  return hosts;
}

/**
 * `https://host` when `candidate` (an Origin / Referer / page URL) is on one of
 * the storefront hosts, else null. https only, except http://localhost in dev.
 */
export function snapStorefrontOrigin(
  candidate: string | null | undefined,
  hosts: Set<string> = snapStorefrontHosts(),
): string | null {
  if (!candidate) return null;
  try {
    const u = new URL(candidate);
    const host = u.hostname.toLowerCase();
    if (!hosts.has(host)) return null;
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && host === 'localhost')) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Site origin used when the shopper's own origin is unknown (webhook / retry paths). */
export function snapDefaultSiteOrigin(siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string {
  try {
    const v = cleanEnvValue(siteUrl);
    if (v) return new URL(v).origin;
  } catch { /* fall through */ }
  return 'https://zicabella.com';
}

/**
 * true on the live storefront. Validation-only mode (SNAP_CAPI_VALIDATE=1) is
 * never honoured there: it would silently stop real conversions being recorded.
 * An unset or unreadable site URL counts as production (the code's default site).
 */
export function isSnapProductionSite(siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): boolean {
  const v = cleanEnvValue(siteUrl);
  if (!v) return true;
  const host = hostOf(v);
  if (!host) return true;
  return SNAP_PRODUCTION_HOSTS.includes(host);
}

/** Admin / back-office pages are never tracked. */
export function isSnapExcludedPath(pathname: string | null | undefined): boolean {
  const p = String(pathname || '').toLowerCase();
  return p.startsWith('/dashboard') || p.startsWith('/admin') || p.startsWith('/web-store');
}
