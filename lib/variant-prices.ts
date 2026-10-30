import { shopifyGraphqlFetch } from '@/lib/shopify-admin';

/**
 * Current Shopify prices for the given variant ids (numeric or gid), keyed by numeric id.
 * Uses GraphQL nodes() — the REST variants.json endpoint ignores `ids` and returns the store's first page
 * of variants, so most lines would never be found. Throws if a batch fails.
 */
export async function fetchVariantPrices(variantIds: string[]): Promise<Map<string, number>> {
  const ids = Array.from(new Set(variantIds.map((id) => String(id).split('/').pop() || '').filter((id) => /^\d+$/.test(id))));
  const prices = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 50) {
    const data = await shopifyGraphqlFetch<{ nodes: Array<{ id: string; price: string } | null> }>(
      `query VariantPrices($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id price } } }`,
      { ids: ids.slice(i, i + 50).map((id) => `gid://shopify/ProductVariant/${id}`) }
    );
    for (const node of data?.nodes || []) {
      if (node?.id && node.price != null) prices.set(node.id.split('/').pop()!, parseFloat(node.price));
    }
  }
  return prices;
}
