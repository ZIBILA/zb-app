/**
 * Stock check for checkout: a size with no stock must not be sellable.
 *
 * Until now only the product page's buttons knew about stock (and that page is cached for 60s);
 * the payment routes only priced the cart, so a sold-out size could still be paid for.
 *
 * One Admin GraphQL `nodes` call per cart (1-5 variants), called when the shopper starts paying,
 * never while browsing. Results are kept for 10s and concurrent checkouts for the same variants
 * share one in-flight request, so a sale spike costs a few calls a minute, far under Shopify's
 * rate limit. If Shopify cannot be reached in time the check does NOT block the sale
 * (`verified: false`): the oversold fallback in shopifyOrderSyncService + the admin email cover it.
 */
import { shopifyGraphqlFetch } from '@/lib/shopify-admin';
import { variantNumericId } from '@/lib/variant-prices';

const TTL_MS = 10_000;

export interface VariantStock {
  /** Total sellable quantity across locations; null when Shopify does not track this variant. */
  available: number | null;
  label: string;
}

export interface StockShortage {
  variantId: string;
  label: string;
  requested: number;
  available: number;
}

export interface StockCheckResult {
  /** false = Shopify could not be asked in time (the caller lets the sale through). */
  verified: boolean;
  shortages: StockShortage[];
}

const cache = new Map<string, { stock: VariantStock; ts: number }>();
const inflight = new Map<string, Promise<void>>();

const STOCK_QUERY = `
  query ZbVariantStock($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        inventoryQuantity
        inventoryItem { tracked }
        product { title }
      }
    }
  }
`;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`stock lookup timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function loadBatch(ids: string[], timeoutMs: number): Promise<void> {
  const data = await withTimeout(
    shopifyGraphqlFetch<{ nodes: Array<any | null> }>(STOCK_QUERY, {
      ids: ids.map((id) => `gid://shopify/ProductVariant/${id}`),
    }),
    timeoutMs,
  );
  for (const node of data?.nodes || []) {
    const id = variantNumericId(node?.id);
    if (!id) continue;
    const tracked = node?.inventoryItem?.tracked !== false;
    const qty = Number(node?.inventoryQuantity);
    const size = node?.title && node.title !== 'Default Title' ? ` (${node.title})` : '';
    cache.set(id, {
      ts: Date.now(),
      stock: {
        available: tracked && Number.isFinite(qty) ? qty : null,
        label: `${node?.product?.title || 'This item'}${size}`,
      },
    });
  }
}

/** Fresh-enough stock for the variants; ids Shopify did not answer for are absent. */
export async function fetchVariantStock(
  variantIds: string[],
  opts: { timeoutMs?: number } = {},
): Promise<Map<string, VariantStock>> {
  const out = new Map<string, VariantStock>();
  const ids = Array.from(new Set(variantIds.map(variantNumericId).filter(Boolean)));
  const now = Date.now();
  const missing = ids.filter((id) => {
    const hit = cache.get(id);
    if (hit && now - hit.ts < TTL_MS) { out.set(id, hit.stock); return false; }
    return true;
  });
  if (missing.length) {
    const key = [...missing].sort().join(',');
    let run = inflight.get(key);
    if (!run) {
      run = loadBatch(missing, opts.timeoutMs ?? 4000).finally(() => inflight.delete(key));
      inflight.set(key, run);
    }
    try {
      await run;
    } catch (err: any) {
      console.warn('[Stock] lookup failed:', err?.message || err);
    }
    for (const id of missing) {
      const hit = cache.get(id);
      if (hit) out.set(id, hit.stock);
    }
  }
  return out;
}

/**
 * Which cart lines ask for more than Shopify has. Quantities of the same variant are summed
 * first (two lines of one size). Untracked variants and variants Shopify did not answer for
 * are never reported as short.
 */
export async function checkCartStock(
  items: Array<{ variantId?: unknown; variant_id?: unknown; quantity?: unknown }>,
  opts: { timeoutMs?: number } = {},
): Promise<StockCheckResult> {
  const wanted = new Map<string, number>();
  for (const it of items || []) {
    const id = variantNumericId(it?.variantId ?? it?.variant_id);
    if (!id) continue;
    wanted.set(id, (wanted.get(id) || 0) + Math.max(1, Math.floor(Number(it?.quantity) || 1)));
  }
  if (wanted.size === 0) return { verified: true, shortages: [] };

  const stock = await fetchVariantStock([...wanted.keys()], opts);
  const shortages: StockShortage[] = [];
  let verified = true;
  for (const [variantId, requested] of wanted) {
    const s = stock.get(variantId);
    if (!s) { verified = false; continue; }
    if (s.available !== null && s.available < requested) {
      shortages.push({ variantId, label: s.label, requested, available: Math.max(0, s.available) });
    }
  }
  return { verified, shortages };
}

/** Shopper-facing sentence for the shortages ("X is sold out" / "only 1 left"). */
export function stockShortageMessage(shortages: StockShortage[]): string {
  const parts = shortages.map((s) =>
    s.available <= 0 ? `${s.label} is sold out` : `only ${s.available} of ${s.label} left`);
  return `${parts.join('; ')}. Please update your bag and try again.`.replace(/^./, (c) => c.toUpperCase());
}

/** Test hook. */
export function clearStockCache() {
  cache.clear();
  inflight.clear();
}
