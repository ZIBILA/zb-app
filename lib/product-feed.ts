/**
 * Shared product-catalogue feed helpers used by /feed.xml and /feed.csv.
 * Handles product/collection exclusions and last-build status for the dashboard.
 */

import prisma from '@/lib/db';
import {
  fetchAllProducts,
  fetchCollections,
  fetchProductsByCollectionId,
  type ShopifyProduct,
} from '@/lib/shopify-admin';

export type FeedFormat = 'xml' | 'csv';

export interface FeedBuildStatus {
  format: FeedFormat;
  status: 'success' | 'error';
  itemCount: number;
  productCount: number;
  durationMs: number;
  error: string | null;
  createdAt: string;
}

const FEED_SYNC_ORDER_ID: Record<FeedFormat, string> = {
  xml: '__catalogue_feed_xml__',
  csv: '__catalogue_feed_csv__',
};

/** Host that serves /feed.xml and /feed.csv (Next app — not the Shopify apex). */
export function getFeedBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://app.zicabella.com'
  ).replace(/\/+$/, '');
}

/** Public product PDP host used inside feed item links. */
export function getProductSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com').replace(/\/+$/, '');
}

async function getToggleExcludedProductIds(): Promise<Set<string>> {
  try {
    const excluded = await prisma.product.findMany({
      where: { includeInFeed: false },
      select: { shopifyProductId: true },
    });
    return new Set(excluded.map((p: { shopifyProductId: string }) => p.shopifyProductId));
  } catch (err) {
    console.error('[Feed] Error fetching includeInFeed exclusions:', err);
    return new Set();
  }
}

/**
 * Resolve Shop.feedExcludedCollections (handles) → Shopify product IDs
 * belonging to those collections.
 */
async function getCollectionExcludedProductIds(): Promise<Set<string>> {
  try {
    const shop = await prisma.shop.findFirst({
      select: { feedExcludedCollections: true },
    });

    let handles: string[] = [];
    if (shop?.feedExcludedCollections) {
      try {
        const parsed = JSON.parse(shop.feedExcludedCollections);
        if (Array.isArray(parsed)) {
          handles = parsed.map((h) => String(h).trim().toLowerCase()).filter(Boolean);
        }
      } catch {
        handles = [];
      }
    }

    if (handles.length === 0) return new Set();

    const collections = await fetchCollections(250);
    const wanted = new Set(handles);
    const matched = collections.filter((c) => wanted.has(String(c.handle || '').toLowerCase()));

    const ids = new Set<string>();
    await Promise.all(
      matched.map(async (col) => {
        try {
          const products = await fetchProductsByCollectionId(col.id, 250);
          for (const p of products) ids.add(String(p.id));
        } catch (err) {
          console.error(`[Feed] Failed loading products for excluded collection ${col.handle}:`, err);
        }
      })
    );

    return ids;
  } catch (err) {
    console.error('[Feed] Error resolving feedExcludedCollections:', err);
    return new Set();
  }
}

export async function getAllExcludedProductIds(): Promise<{
  toggleExcluded: Set<string>;
  collectionExcluded: Set<string>;
  all: Set<string>;
}> {
  const [toggleExcluded, collectionExcluded] = await Promise.all([
    getToggleExcludedProductIds(),
    getCollectionExcludedProductIds(),
  ]);
  const all = new Set<string>([...toggleExcluded, ...collectionExcluded]);
  return { toggleExcluded, collectionExcluded, all };
}

export interface LoadedFeedProducts {
  products: ShopifyProduct[];
  totalFetched: number;
  toggleExcludedCount: number;
  collectionExcludedCount: number;
  variantCount: number;
}

/** Active Shopify products minus toggle + collection exclusions. */
export async function loadFeedProducts(): Promise<LoadedFeedProducts> {
  const [allProducts, exclusions] = await Promise.all([
    fetchAllProducts(250, { allowFallback: false }),
    getAllExcludedProductIds(),
  ]);

  const products = allProducts.filter((product) => {
    if (product.status !== 'active') return false;
    if (exclusions.all.has(String(product.id))) return false;
    return true;
  });

  let variantCount = 0;
  for (const product of products) {
    if (!product.variants || !Array.isArray(product.variants)) continue;
    variantCount += product.variants.filter(Boolean).length;
  }

  return {
    products,
    totalFetched: allProducts.length,
    toggleExcludedCount: exclusions.toggleExcluded.size,
    collectionExcludedCount: exclusions.collectionExcluded.size,
    variantCount,
  };
}

export async function recordFeedBuildStatus(opts: {
  format: FeedFormat;
  status: 'success' | 'error';
  itemCount?: number;
  productCount?: number;
  durationMs?: number;
  error?: unknown;
  /** Skip success throttle (dashboard Refresh status). */
  force?: boolean;
}): Promise<void> {
  const errorMessage =
    opts.error == null
      ? null
      : opts.error instanceof Error
        ? opts.error.message
        : String(opts.error);

  const payload = JSON.stringify({
    itemCount: opts.itemCount ?? 0,
    productCount: opts.productCount ?? 0,
    durationMs: opts.durationMs ?? 0,
  });

  try {
    // Avoid flooding SyncLog on every public feed poll: only write successes
    // at most once per 10 minutes unless forced or item count changed.
    if (opts.status === 'success' && !opts.force) {
      const latest = await getLatestFeedBuildStatus(opts.format);
      if (
        latest?.status === 'success' &&
        latest.itemCount === (opts.itemCount ?? 0) &&
        Date.now() - new Date(latest.createdAt).getTime() < 10 * 60 * 1000
      ) {
        return;
      }
    }

    await prisma.syncLog.create({
      data: {
        orderId: FEED_SYNC_ORDER_ID[opts.format],
        action: `catalogue_feed_${opts.format}`,
        status: opts.status,
        error: errorMessage ? errorMessage.slice(0, 2000) : null,
        payload,
      },
    });
  } catch (err) {
    console.error('[Feed] Failed to persist feed build status:', err);
  }
}

export async function getLatestFeedBuildStatus(
  format: FeedFormat
): Promise<FeedBuildStatus | null> {
  try {
    const row = await prisma.syncLog.findFirst({
      where: {
        orderId: FEED_SYNC_ORDER_ID[format],
        action: `catalogue_feed_${format}`,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;

    let itemCount = 0;
    let productCount = 0;
    let durationMs = 0;
    if (row.payload) {
      try {
        const parsed = JSON.parse(row.payload);
        itemCount = Number(parsed.itemCount) || 0;
        productCount = Number(parsed.productCount) || 0;
        durationMs = Number(parsed.durationMs) || 0;
      } catch {
        /* ignore */
      }
    }

    return {
      format,
      status: row.status === 'success' ? 'success' : 'error',
      itemCount,
      productCount,
      durationMs,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
    };
  } catch (err) {
    console.error('[Feed] Failed to read feed build status:', err);
    return null;
  }
}

export async function getCatalogueFeedDashboardData() {
  const base = getFeedBaseUrl();
  const [xml, csv, shop] = await Promise.all([
    getLatestFeedBuildStatus('xml'),
    getLatestFeedBuildStatus('csv'),
    prisma.shop.findFirst({ select: { feedExcludedCollections: true } }),
  ]);

  let excludedCollections: string[] = [];
  if (shop?.feedExcludedCollections) {
    try {
      const parsed = JSON.parse(shop.feedExcludedCollections);
      if (Array.isArray(parsed)) excludedCollections = parsed.map(String);
    } catch {
      excludedCollections = [];
    }
  }

  return {
    urls: {
      xml: `${base}/feed.xml`,
      csv: `${base}/feed.csv`,
    },
    platforms: [
      { name: 'Meta Commerce / Ads', format: 'XML or CSV', preferredUrl: `${base}/feed.xml` },
      { name: 'Google Merchant Center', format: 'XML or CSV', preferredUrl: `${base}/feed.xml` },
      { name: 'Snapchat Catalog', format: 'XML or CSV', preferredUrl: `${base}/feed.csv` },
      { name: 'ChatGPT / OpenAI Ads', format: 'XML or CSV (Google-compatible)', preferredUrl: `${base}/feed.xml` },
    ],
    excludedCollections,
    builds: { xml, csv },
  };
}
