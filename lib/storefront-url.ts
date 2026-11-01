/**
 * The public storefront origin — the host customers shop on and the Meta / Snap
 * ads, pixels and relays are tied to (lib/tracking/host.ts). Every link that is
 * shown or sent to a customer (WhatsApp messages and templates, abandoned-cart
 * recovery, product shares) is built from this, never from the admin host.
 *
 * Isomorphic: reads NEXT_PUBLIC_SITE_URL literally so Next.js inlines it in the
 * browser bundle; falls back to the live site.
 */
const DEFAULT_ORIGIN = 'https://zicabella.com';

function clean(v: unknown): string {
  const s = String(v ?? '').trim();
  const m = s.match(/^(['"])([\s\S]*)\1$/);
  return (m ? m[2] : s).trim().replace(/\/+$/, '');
}

function resolveOrigin(): string {
  const v = clean(process.env.NEXT_PUBLIC_SITE_URL);
  if (!v) return DEFAULT_ORIGIN;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return DEFAULT_ORIGIN;
    if (u.hostname.toLowerCase() === 'app.zicabella.com') return DEFAULT_ORIGIN;
    return u.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

/** e.g. "https://zicabella.com" */
export const STOREFRONT_ORIGIN: string = resolveOrigin();

/** e.g. "zicabella.com" */
export const STOREFRONT_HOST: string = (() => {
  try { return new URL(STOREFRONT_ORIGIN).host; } catch { return 'zicabella.com'; }
})();

/** `${STOREFRONT_ORIGIN}${path}` — `path` must start with "/". */
export function storefrontUrl(path: string): string {
  return `${STOREFRONT_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}
