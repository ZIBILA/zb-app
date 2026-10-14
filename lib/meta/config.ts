/**
 * Meta Pixel / Conversions API configuration — the ONE place the Pixel (dataset)
 * id is resolved for the browser and the server. Mirrors lib/snap/config.ts.
 *
 * Isomorphic (browser + server): no Node-only imports and nothing secret. The
 * Conversions API access token is server-only and is read in lib/metaCapi.ts.
 *
 * Environment variables
 *   NEXT_PUBLIC_META_PIXEL_ID   the Pixel / dataset id (10–20 digits). "off"
 *                               disables Meta tracking for that deployment. When
 *                               unset, a PRODUCTION build of the live site uses the
 *                               store's own pixel (below); development / test
 *                               builds, and a build whose NEXT_PUBLIC_SITE_URL is
 *                               another host (staging / preview), send NOTHING —
 *                               so no other deployment ever feeds the live dataset.
 *   META_PIXEL_ID               server-side override (same rules). When both are
 *                               set they must be the same id, or browser and server
 *                               events land in different datasets and never dedup.
 *   NEXT_PUBLIC_FACEBOOK_PIXEL_ID  legacy alias of NEXT_PUBLIC_META_PIXEL_ID.
 *   NEXT_PUBLIC_SITE_URL        canonical storefront URL (already used app-wide).
 */

/** Zica Bella's Meta Pixel. A pixel id is public (it is in every page's HTML) — not a secret. */
export const META_PRODUCTION_PIXEL_ID = '2049977412558608';

const PIXEL_ID_RE = /^\d{10,20}$/;
const OFF_VALUES = new Set(['off', 'false', 'disabled', 'none', '0']);

/** Hosts that serve the live storefront. */
export const META_PRODUCTION_HOSTS: readonly string[] = ['zicabella.com', 'www.zicabella.com', 'app.zicabella.com'];

/** Trim, and drop one pair of wrapping quotes (a common copy-paste slip in env editors). */
export function cleanMetaEnvValue(v: unknown): string {
  const s = String(v ?? '').trim();
  const m = s.match(/^(['"])([\s\S]*)\1$/);
  return (m ? m[2] : s).trim();
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/**
 * true on the live storefront. An unset or unreadable site URL counts as
 * production (the code's default site), exactly like the Snap resolver.
 */
export function isMetaProductionSite(siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): boolean {
  const v = cleanMetaEnvValue(siteUrl);
  if (!v) return true;
  const host = hostOf(v);
  if (!host) return true;
  return META_PRODUCTION_HOSTS.includes(host);
}

/** The built-in pixel applies to production builds of the live site only. */
function usesBuiltInPixel(nodeEnv: string | undefined, siteUrl: string | undefined): boolean {
  return nodeEnv === 'production' && isMetaProductionSite(siteUrl);
}

/**
 * Resolve one raw env value to a pixel id, or '' (off). Exported for tests.
 * `explicit` = the value of the most specific variable (e.g. META_PIXEL_ID on the
 * server), `fallback` = the public one; the first valid wins, "off" anywhere wins.
 */
export function resolveMetaPixelIdFrom(
  explicit: string | undefined,
  fallback: string | undefined,
  nodeEnv: string | undefined,
  siteUrl: string | undefined,
): string {
  for (const raw of [explicit, fallback]) {
    const v = cleanMetaEnvValue(raw);
    if (!v) continue;
    if (OFF_VALUES.has(v.toLowerCase())) return '';
    if (PIXEL_ID_RE.test(v)) return v;
    // Set but not a pixel id (placeholder, typo): fall through to the next source.
  }
  return usesBuiltInPixel(nodeEnv, siteUrl) ? META_PRODUCTION_PIXEL_ID : '';
}

/**
 * The Pixel id the BROWSER bundle uses, or '' when Meta tracking is off on this
 * deployment. The defaults read `process.env.X` literally so Next.js inlines them
 * in the browser bundle exactly like any other NEXT_PUBLIC_ value.
 */
export function resolveMetaPixelId(
  raw: string | undefined = process.env.NEXT_PUBLIC_META_PIXEL_ID,
  legacy: string | undefined = process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string {
  return resolveMetaPixelIdFrom(raw, legacy, nodeEnv, siteUrl);
}

/**
 * The Pixel id the SERVER (Conversions API) uses. META_PIXEL_ID wins, then the
 * public id, then the built-in id on a production build of the live site.
 */
export function resolveMetaServerPixelId(
  serverRaw: string | undefined = process.env.META_PIXEL_ID,
  publicRaw: string | undefined = process.env.NEXT_PUBLIC_META_PIXEL_ID || process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string {
  return resolveMetaPixelIdFrom(serverRaw, publicRaw, nodeEnv, siteUrl);
}

/**
 * A human-readable configuration problem, or null. Server-only diagnostics
 * (connection test, startup log): catches a browser/server id mismatch, the
 * single most silent way to lose Pixel↔CAPI deduplication.
 */
export function metaPixelIdProblem(
  serverRaw: string | undefined = process.env.META_PIXEL_ID,
  publicRaw: string | undefined = process.env.NEXT_PUBLIC_META_PIXEL_ID || process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string | null {
  const server = resolveMetaPixelIdFrom(serverRaw, publicRaw, nodeEnv, siteUrl);
  const browser = resolveMetaPixelIdFrom(publicRaw, undefined, nodeEnv, siteUrl);
  if (!server && !browser) {
    return nodeEnv === 'production'
      ? `Meta tracking is off on this deployment: no pixel id set and NEXT_PUBLIC_SITE_URL (${cleanMetaEnvValue(siteUrl) || 'unset'}) is not a live storefront host`
      : 'Meta tracking is off outside production builds unless NEXT_PUBLIC_META_PIXEL_ID / META_PIXEL_ID is set';
  }
  if (server && browser && server !== browser) {
    return `META_PIXEL_ID (${server}) and NEXT_PUBLIC_META_PIXEL_ID (${browser}) differ: browser and server events go to different datasets and will not deduplicate`;
  }
  if (server && !browser) return 'Server events are configured (META_PIXEL_ID) but the browser Pixel is off: set NEXT_PUBLIC_META_PIXEL_ID to the same id';
  if (!server && browser) return 'The browser Pixel is configured but server events are off: set META_PIXEL_ID (or NEXT_PUBLIC_META_PIXEL_ID) for the server';
  return null;
}

/** Admin / back-office pages are never tracked. */
export function isMetaExcludedPath(pathname: string | null | undefined): boolean {
  const p = String(pathname || '').toLowerCase();
  return p.startsWith('/dashboard') || p.startsWith('/admin') || p.startsWith('/web-store');
}
