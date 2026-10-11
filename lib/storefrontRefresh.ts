import { revalidatePath, revalidateTag } from 'next/cache';
import { clearShopifyCache } from '@/lib/shopify-admin';

/**
 * Makes the live storefront pick up catalogue / CMS changes now instead of whenever caches expire.
 * Used by the Shopify product + collection webhooks and by the CMS "Refresh live site" button.
 */
export function refreshStorefront(): { refreshed: string[] } {
  const refreshed: string[] = [];
  try {
    clearShopifyCache();
    refreshed.push('shopify-cache');
  } catch (e) {
    console.warn('[Storefront Refresh] cache clear failed:', e);
  }

  const paths: Array<[string, ('page' | 'layout')?]> = [
    ['/'],
    ['/collections'],
    ['/collections/[handle]', 'page'],
    ['/products/[id]', 'page'],
    ['/search'],
    ['/sitemap.xml'],
  ];
  for (const [path, type] of paths) {
    try {
      type ? revalidatePath(path, type) : revalidatePath(path);
      refreshed.push(path);
    } catch (e) {
      console.warn(`[Storefront Refresh] revalidate ${path} failed:`, e);
    }
  }
  try {
    revalidateTag('homepage');
    refreshed.push('tag:homepage');
  } catch {
    /* tag may not exist */
  }
  return { refreshed };
}
