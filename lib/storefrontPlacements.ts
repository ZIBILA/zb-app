import prisma from '@/lib/db';
import {
  fetchCatalogForAdmin,
  fetchCollections,
  fetchStorefrontCatalog,
  type ShopifyProduct,
} from '@/lib/shopify-admin';
import {
  applyProductOrder,
  isStorefrontEligible,
  parseOrderConfig,
  readPlacement,
  serializeOrderConfig,
  writePlacement,
} from '@/lib/storefrontCatalog';

/**
 * Backend of the "Products & Order" CMS screen. One concept for everything the team manages:
 *   homepage        → hand-picked, ordered product list (Shop.homepageProducts)
 *   all             → Shop All page (every live product; reorder + hide)
 *   <collection>    → a Shopify collection page (live members; reorder + hide)
 * Which products BELONG to a collection is decided in Shopify; the CMS decides order and visibility.
 */

export interface ProductRow {
  id: string;
  title: string;
  handle: string;
  image: string | null;
  price: string;
  stock: number;
  status: string;
  /** Visible to customers on the website (active + published). */
  live: boolean;
  /** Why it is not live, when it isn't. */
  reason: string | null;
  createdAt: string;
  /** New in Shopify and not yet positioned by the team — shown first on the site. */
  isNew?: boolean;
}

export function toRow(p: ShopifyProduct): ProductRow {
  const live = isStorefrontEligible(p);
  const status = String(p.status || '').toLowerCase();
  let reason: string | null = null;
  if (!live) {
    reason =
      status === 'draft' ? 'Draft in Shopify'
      : status === 'archived' ? 'Archived in Shopify'
      : 'Not published to the Online Store';
  }
  return {
    id: String(p.id),
    title: p.title,
    handle: p.handle,
    image: p.image?.src || p.images?.[0]?.src || null,
    price: p.variants?.[0]?.price || '0',
    stock: (p.variants || []).reduce((n, v) => n + (Number(v.inventory_quantity) || 0), 0),
    status,
    live,
    reason,
    createdAt: p.published_at || p.created_at,
  };
}

export interface PlacementInfo {
  key: string;
  label: string;
  kind: 'homepage' | 'shop-all' | 'collection';
  liveUrl: string;
  collectionId?: string;
}

export async function listPlacements(): Promise<{
  placements: PlacementInfo[];
  stats: { shopifyTotal: number; shopifyLive: number; notLive: ProductRow[]; shopAllShown: number; shopAllHidden: number };
}> {
  const [catalog, collections, shop] = await Promise.all([
    fetchCatalogForAdmin(),
    fetchCollections(),
    prisma.shop.findFirst({ select: { collectionProductOrders: true } }),
  ]);
  const live = catalog.filter(isStorefrontEligible);
  const cfg = parseOrderConfig(shop?.collectionProductOrders);
  const all = applyProductOrder(live, readPlacement(cfg, { handle: 'all' }));

  const placements: PlacementInfo[] = [
    { key: 'homepage', label: 'Homepage products', kind: 'homepage', liveUrl: '/' },
    { key: 'all', label: 'Shop All', kind: 'shop-all', liveUrl: '/collections/all' },
    ...collections
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((c) => ({
        key: c.handle,
        label: c.title,
        kind: 'collection' as const,
        liveUrl: `/collections/${c.handle}`,
        collectionId: String(c.id),
      })),
  ];

  return {
    placements,
    stats: {
      shopifyTotal: catalog.length,
      shopifyLive: live.length,
      notLive: catalog.filter((p) => !isStorefrontEligible(p)).map(toRow),
      shopAllShown: all.visible.length,
      shopAllHidden: all.hidden.length,
    },
  };
}

export interface PlacementDetail {
  info: PlacementInfo;
  /** Customers see these, in this order. */
  visible: ProductRow[];
  /** Left out on purpose (still live in Shopify). Not used for the homepage. */
  hidden: ProductRow[];
  /** Homepage only: every live product that could be added. */
  available: ProductRow[];
  /** Products in this placement that customers cannot see, with the reason. */
  notLive: ProductRow[];
  /** Homepage only: where the saved list came from. */
  note?: string;
}

export async function loadPlacement(key: string): Promise<PlacementDetail | null> {
  const { placements } = await listPlacements();
  const info = placements.find((p) => p.key === key);
  if (!info) return null;

  const shop = await prisma.shop.findFirst({
    select: { homepageProducts: true, homepageCollection: true, collectionProductOrders: true },
  });
  const cfg = parseOrderConfig(shop?.collectionProductOrders);

  if (info.kind === 'homepage') {
    const catalog = await fetchCatalogForAdmin();
    const byId = new Map<string, ShopifyProduct>(catalog.map((p): [string, ShopifyProduct] => [String(p.id), p]));
    const liveCatalog = catalog.filter(isStorefrontEligible);
    let ids: string[] = (shop?.homepageProducts || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    let note: string | undefined;

    if (ids.length === 0 && shop?.homepageCollection?.trim()) {
      // Old "show a collection" mode: pre-fill with what that collection currently shows.
      const handle = shop.homepageCollection.trim().toLowerCase().replace(/\s+/g, '-');
      const col = (await fetchCollections()).find((c) => c.handle.toLowerCase() === handle);
      if (col) {
        const members = await fetchStorefrontCatalog({ collectionId: col.id });
        const ordered = applyProductOrder(members, readPlacement(cfg, { id: col.id, handle: col.handle })).visible;
        ids = ordered.map((p) => String(p.id));
        note = `The homepage was showing the "${col.title}" collection. Saving turns this into a hand-picked list.`;
      }
    }
    const chosen: ShopifyProduct[] = [];
    for (const id of ids) {
      const found = byId.get(id);
      if (found) chosen.push(found);
    }
    const chosenSet = new Set(chosen.map((p: ShopifyProduct) => String(p.id)));
    return {
      info,
      visible: chosen.filter(isStorefrontEligible).map(toRow),
      hidden: [],
      available: liveCatalog.filter((p: ShopifyProduct) => !chosenSet.has(String(p.id))).map(toRow),
      notLive: chosen.filter((p) => !isStorefrontEligible(p)).map(toRow),
      note,
    };
  }

  // Shop All / a collection
  let members: ShopifyProduct[];
  let placementRef: { id?: string; handle: string };
  if (info.kind === 'shop-all') {
    members = await fetchStorefrontCatalog();
    placementRef = { handle: 'all' };
  } else {
    members = await fetchStorefrontCatalog({ collectionId: info.collectionId });
    placementRef = { id: info.collectionId, handle: info.key };
  }
  const { visible, hidden, unplacedIds } = applyProductOrder(members, readPlacement(cfg, placementRef));
  const newSet = new Set(unplacedIds);

  // Collection members that exist in Shopify but are not live (draft/unpublished) — explain, never hide silently.
  let notLive: ProductRow[] = [];
  if (info.kind === 'shop-all') {
    const all = await fetchCatalogForAdmin();
    notLive = all.filter((p) => !isStorefrontEligible(p)).map(toRow);
  }

  return {
    info,
    visible: visible.map((p) => ({ ...toRow(p), isNew: newSet.has(String(p.id)) })),
    hidden: hidden.map(toRow),
    available: [],
    notLive,
  };
}

export async function savePlacement(
  key: string,
  order: string[],
  hidden: string[]
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const shop = await prisma.shop.findFirst();
  if (!shop) return { ok: false, error: 'Shop not found', status: 404 };

  if (key === 'homepage') {
    const ids = Array.from(new Set(order.map(String)));
    if (ids.length === 0) return { ok: false, error: 'Add at least one product to the homepage.', status: 400 };
    await prisma.shop.update({
      where: { id: shop.id },
      data: { homepageProducts: ids.join(','), homepageCollection: '' },
    });
    return { ok: true };
  }

  const { placements } = await listPlacements();
  const info = placements.find((p) => p.key === key);
  if (!info) return { ok: false, error: `Unknown placement "${key}"`, status: 404 };

  const cleanHidden = Array.from(new Set(hidden.map(String)));
  const hiddenSet = new Set(cleanHidden);
  const cleanOrder = Array.from(new Set(order.map(String))).filter((id) => !hiddenSet.has(id));

  const cfg = parseOrderConfig(shop.collectionProductOrders);
  const next = writePlacement(
    cfg,
    info.kind === 'shop-all' ? { handle: 'all' } : { id: info.collectionId, handle: info.key },
    cleanOrder,
    cleanHidden
  );
  await prisma.shop.update({
    where: { id: shop.id },
    data: { collectionProductOrders: serializeOrderConfig(next) },
  });
  return { ok: true };
}
