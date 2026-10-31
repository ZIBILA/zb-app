/**
 * Is this POST coming from a page of our own storefront?
 *
 * The browser→Conversions API relays (/api/meta/event, /api/snap/event) are
 * unauthenticated by design: they run on every page view, for guests. They are
 * NOT an authentication boundary, but a request that carries no browser
 * provenance at all (curl, a script) has no business reaching them, and a
 * cross-site page must never be able to feed our datasets.
 *
 * Browsers always send `Origin` on a fetch POST (same-origin included) and
 * `Sec-Fetch-Site` on every request, so a real storefront page passes without
 * exception. Both headers are forgeable by a non-browser client, so this is a
 * bar, not a lock: the rate limit, the schema and the host check still apply.
 */
export type HeaderReader = { get(name: string): string | null | undefined };

export function isStorefrontPageRequest(headers: HeaderReader, allowedHosts: Set<string>): boolean {
  const site = (headers.get('sec-fetch-site') || '').toLowerCase();
  if (site === 'cross-site') return false;
  const origin = headers.get('origin');
  if (origin) {
    try { return allowedHosts.has(new URL(origin).hostname.toLowerCase()); } catch { return false; }
  }
  if (site === 'same-origin' || site === 'same-site') return true;
  const referer = headers.get('referer');
  if (referer) {
    try { return allowedHosts.has(new URL(referer).hostname.toLowerCase()); } catch { return false; }
  }
  return false;
}
