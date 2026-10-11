/**
 * Pure helpers that decide WHICH Shopify products the live storefront shows and in WHAT ORDER.
 * Kept free of I/O so the rules can be unit-tested and shared by the storefront, the mobile APIs and the CMS.
 *
 * Rules
 *  - Eligible  = Shopify status "active" AND published (published_at set). Drafts, archived and
 *    unpublished products never reach customers, and never fill a slot.
 *  - Ordering  = the CMS saves an ordered list of product ids per placement ("pinned" order).
 *    Products the CMS has not placed yet (new Shopify products) appear FIRST, newest first, so a
 *    new drop is visible immediately and ops can then drag it where they want it.
 *  - Hiding    = a per-placement list of product ids to leave out (e.g. hide one product from Shop All).
 *
 * Storage (Shop.collectionProductOrders, JSON text, no schema change):
 *   { "all": ["1","2"], "<collectionId>": [...], "<handle>": [...], "__hidden": { "all": ["9"], "<handle>": [] } }
 * Plain arrays stay exactly as before, so older readers keep working; "__hidden" never collides with a
 * collection key because it is not a valid Shopify handle or numeric id.
 */

export interface CatalogProductLike {
  id: number | string;
  status?: string | null;
  published_at?: string | null;
  created_at?: string | null;
}

export type PlacementKey = string; // "all" | collection handle | collection id

export interface OrderConfig {
  orders: Record<string, string[]>;
  hidden: Record<string, string[]>;
}

const HIDDEN_KEY = '__hidden';

export function isStorefrontEligible(p: CatalogProductLike | null | undefined): boolean {
  if (!p) return false;
  if (String(p.status || '').toLowerCase() !== 'active') return false;
  // Products fetched through the published_status filter always carry published_at; a null value means
  // the product is not published to the Online Store channel.
  if (p.published_at === null || p.published_at === '') return false;
  return true;
}

export function parseOrderConfig(raw: string | null | undefined): OrderConfig {
  const out: OrderConfig = { orders: {}, hidden: {} };
  if (!raw) return out;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object') return out;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === HIDDEN_KEY) {
      if (value && typeof value === 'object') {
        for (const [hk, hv] of Object.entries(value as Record<string, unknown>)) {
          if (Array.isArray(hv)) out.hidden[hk.toLowerCase()] = hv.map(String);
        }
      }
      continue;
    }
    if (Array.isArray(value)) out.orders[key.toLowerCase()] = value.map(String);
  }
  return out;
}

export function serializeOrderConfig(cfg: OrderConfig): string {
  const body: Record<string, unknown> = { ...cfg.orders };
  const hidden: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(cfg.hidden)) {
    if (v.length > 0) hidden[k] = v;
  }
  if (Object.keys(hidden).length > 0) body[HIDDEN_KEY] = hidden;
  return JSON.stringify(body);
}

/** Keys under which a placement's order may be stored, most specific first. "all" also honours the legacy "0". */
export function placementKeys(placement: { id?: number | string | null; handle?: string | null }): string[] {
  const handle = String(placement.handle || '').toLowerCase();
  if (handle === 'all') return ['all', '0'];
  const keys: string[] = [];
  if (placement.id !== undefined && placement.id !== null && String(placement.id) !== '' && String(placement.id) !== '0') {
    keys.push(String(placement.id).toLowerCase());
  }
  if (handle) keys.push(handle);
  return keys;
}

export function readPlacement(
  cfg: OrderConfig,
  placement: { id?: number | string | null; handle?: string | null }
): { order: string[]; hidden: string[] } {
  const keys = placementKeys(placement);
  let order: string[] = [];
  for (const k of keys) {
    if (cfg.orders[k]?.length) {
      order = cfg.orders[k];
      break;
    }
  }
  const hidden = new Set<string>();
  for (const k of keys) for (const id of cfg.hidden[k] || []) hidden.add(id);
  return { order, hidden: Array.from(hidden) };
}

/** Writes a placement under every key a reader may use, so id- and handle-based readers agree. */
export function writePlacement(
  cfg: OrderConfig,
  placement: { id?: number | string | null; handle?: string | null },
  order: string[],
  hidden: string[]
): OrderConfig {
  const next: OrderConfig = { orders: { ...cfg.orders }, hidden: { ...cfg.hidden } };
  const keys = placementKeys(placement);
  for (const k of keys) {
    next.orders[k] = order.map(String);
    next.hidden[k] = hidden.map(String);
  }
  return next;
}

function recency(p: CatalogProductLike): number {
  const t = Date.parse(String(p.published_at || p.created_at || ''));
  return Number.isFinite(t) ? t : 0;
}

export interface OrderedResult<T> {
  /** What customers see, in order. */
  visible: T[];
  /** Products the CMS hid (still eligible in Shopify). */
  hidden: T[];
  /** Ids of visible products the CMS has not placed yet (shown first). */
  unplacedIds: string[];
}

/**
 * Applies CMS order + hiding to a list of ELIGIBLE products. Never drops a product silently:
 * everything not hidden is returned.
 */
export function applyProductOrder<T extends CatalogProductLike>(
  products: T[],
  placement: { order: string[]; hidden: string[] }
): OrderedResult<T> {
  const hiddenSet = new Set(placement.hidden.map(String));
  const index = new Map<string, number>();
  placement.order.forEach((id, i) => {
    if (!index.has(String(id))) index.set(String(id), i);
  });

  const hidden: T[] = [];
  const unplaced: T[] = [];
  const placed: T[] = [];
  for (const p of products) {
    const id = String(p.id);
    if (hiddenSet.has(id)) hidden.push(p);
    else if (index.has(id)) placed.push(p);
    else unplaced.push(p);
  }

  placed.sort((a, b) => index.get(String(a.id))! - index.get(String(b.id))!);
  // Newest first; ties keep a deterministic order by id (higher = newer).
  unplaced.sort((a, b) => recency(b) - recency(a) || Number(b.id) - Number(a.id));

  // With no saved order at all, plain newest-first is the sensible default.
  return {
    visible: [...unplaced, ...placed],
    hidden,
    unplacedIds: unplaced.map((p) => String(p.id)),
  };
}
