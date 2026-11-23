/**
 * Shopify CDN image resizing for plain <img> tags (the product-page mood board).
 *
 * Shopify's CDN resizes on the fly through the `width` query parameter, so instead of the
 * original upload (mood-board files are ~3473×2160 PNGs, ~900 KB each, displayed at ≤600 px)
 * the browser can pick a sized copy from a srcSet. next/image already does this for product
 * images through lib/shopify-image-loader.js; this helper is for images rendered without
 * next/image. Anything that is not a Shopify CDN URL (Supabase, relative paths, data URIs,
 * unparsable strings) is returned exactly as given, with no srcSet.
 */

/** Widths requested from the CDN. 1200 covers a 600 px slot on a 2× screen and a 400 px phone at 3×. */
export const SHOPIFY_SRCSET_WIDTHS: readonly number[] = [640, 828, 1080, 1200];

export function isShopifyCdnHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "cdn.shopify.com" ||
    host.endsWith(".shopifycdn.com") ||
    host.endsWith(".shopifycdn.net") ||
    host.endsWith(".myshopify.com")
  );
}

/** `src` with `width=<n>` set (an existing `width` is replaced), or null when it is not a Shopify CDN image URL. */
export function shopifyResizedUrl(src: string, width: number): string | null {
  if (typeof src !== "string" || !src || !Number.isFinite(width) || width <= 0) return null;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null; // relative path or not a URL at all
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null; // data:, blob:, …
  if (!isShopifyCdnHost(url.hostname)) return null;
  url.searchParams.set("width", String(Math.round(width)));
  return url.toString();
}

export interface ResponsiveImageAttrs {
  src: string;
  srcSet?: string;
  sizes?: string;
}

/**
 * Attributes for `<img {...shopifyResponsiveImage(src, sizes)} />`.
 * Shopify CDN URL → resized `src` (largest width) + `srcSet` + `sizes`; anything else → `{ src }` unchanged.
 */
export function shopifyResponsiveImage(
  src: string,
  sizes: string,
  widths: readonly number[] = SHOPIFY_SRCSET_WIDTHS,
): ResponsiveImageAttrs {
  const candidates: string[] = [];
  for (const w of widths) {
    const u = shopifyResizedUrl(src, w);
    if (!u) return { src };
    candidates.push(`${u} ${w}w`);
  }
  if (!candidates.length) return { src };
  const largest = shopifyResizedUrl(src, Math.max(...widths));
  return { src: largest ?? src, srcSet: candidates.join(", "), sizes };
}
