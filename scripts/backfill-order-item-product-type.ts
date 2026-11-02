/**
 * Backfill OrderItem.productType (the Shopify product_type of each order line, sent as
 * content_category on the server Meta / Snap Purchase) for orders placed before the
 * column existed.
 *
 *   Count only (reads the database and Shopify, writes NOTHING):
 *     npx tsx scripts/backfill-order-item-product-type.ts --dry-run
 *
 *   Apply (updates OrderItem.productType, in batches of 200):
 *     npx tsx scripts/backfill-order-item-product-type.ts
 *
 *   Options:  --limit=<n>   stop after scanning n rows (e.g. a first run of --limit=400)
 *
 * Run it only AFTER the migration prisma/migrations/20261102090000_order_item_product_type
 * has been applied (the column must exist) and with the production DATABASE_URL and the
 * Shopify Admin credentials in the environment (.env.production / .env.local are loaded).
 *
 * How a type is found for a row whose productType is NULL, first hit wins:
 *   1. another OrderItem of the same product (or, without a product link, the same
 *      variant) that already has a productType            — local, no API call;
 *   2. Shopify Admin: the product linked through OrderItem.productId → Product.shopifyProductId
 *      (lib/shopify-admin.ts fetchProductById, cached per product id);
 *   3. Shopify Admin: the row's variant id (OrderItem.variantId, or a "variant:<id>" sku)
 *      → its product (GraphQL via shopifyGraphqlFetch, cached per variant id) when the row
 *      has no Product link.
 * The local Product table has no product-type column, so it only supplies the Shopify
 * product id. Rows nothing resolves (deleted products, placeholders) stay NULL.
 *
 * Safe to re-run: only rows with productType IS NULL are read, and every update is
 * guarded with `productType IS NULL`, so a value written meanwhile is never replaced.
 * Only the productType column is ever written.
 */
import './load-env';
import { normalizeProductType } from '../lib/tracking/product-type';
import { snapCatalogIdFromOrderItem } from '../lib/snap/catalog-id';

const BATCH_SIZE = 200;
/** Pause between uncached Shopify calls (Admin API rate limit). */
const SHOPIFY_PAUSE_MS = 250;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Row {
  id: string;
  productId: string | null;
  variantId: string | null;
  sku: string | null;
  product: { shopifyProductId: string } | null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 0) : Infinity;

  console.log('=== OrderItem.productType backfill ===');
  console.log(`Mode: ${dryRun ? 'DRY-RUN (nothing is written)' : 'APPLY (writing OrderItem.productType)'}${Number.isFinite(limit) ? `, limit ${limit} rows` : ''}`);

  // Loaded after the environment is set (lib/db reads DATABASE_URL at import time).
  const { default: prisma } = await import('../lib/db');
  const { fetchProductById, shopifyGraphqlFetch } = await import('../lib/shopify-admin');
  if ((prisma as any)._isMock) {
    console.error(`No usable database connection (${(prisma as any)._mockReason}). Set DATABASE_URL and retry.`);
    process.exit(1);
  }

  const totalNull: number = await prisma.orderItem.count({ where: { productType: null } });
  console.log(`OrderItem rows with productType NULL: ${totalNull}`);

  // key → resolved type (null = looked up, nothing found). Keys: p:<shopify product id>, v:<variant id>.
  const resolved = new Map<string, string | null>();
  const stats = {
    scanned: 0,
    noKey: 0,
    fromLocalPeer: 0,
    fromShopifyProduct: 0,
    fromShopifyVariant: 0,
    unresolved: 0,
    updated: 0,
    shopifyCalls: 0,
    shopifyErrors: 0,
  };

  async function fromLocalPeer(key: string): Promise<string | null> {
    const where = key.startsWith('p:')
      ? { productType: { not: null }, product: { shopifyProductId: key.slice(2) } }
      : { productType: { not: null }, variantId: key.slice(2) };
    const peer = await prisma.orderItem.findFirst({ where, select: { productType: true } });
    return normalizeProductType(peer?.productType);
  }

  async function fromShopifyProduct(shopifyProductId: string): Promise<string | null> {
    stats.shopifyCalls++;
    try {
      const p = await fetchProductById(shopifyProductId);
      return normalizeProductType(p?.product_type);
    } catch (err: any) {
      stats.shopifyErrors++;
      console.warn(`  Shopify product ${shopifyProductId}: ${String(err?.message || err).slice(0, 160)}`);
      return null;
    } finally {
      await sleep(SHOPIFY_PAUSE_MS);
    }
  }

  async function fromShopifyVariant(variantId: string): Promise<{ productType: string | null; shopifyProductId: string | null }> {
    stats.shopifyCalls++;
    try {
      const data = await shopifyGraphqlFetch<{ node: { product?: { id?: string; productType?: string } } | null }>(
        `query ZbVariantProductType($id: ID!) { node(id: $id) { ... on ProductVariant { product { id productType } } } }`,
        { id: `gid://shopify/ProductVariant/${variantId}` },
      );
      const prod = data?.node?.product;
      const gid = String(prod?.id || '').split('/').pop() || '';
      return { productType: normalizeProductType(prod?.productType), shopifyProductId: /^\d+$/.test(gid) ? gid : null };
    } catch (err: any) {
      stats.shopifyErrors++;
      console.warn(`  Shopify variant ${variantId}: ${String(err?.message || err).slice(0, 160)}`);
      return { productType: null, shopifyProductId: null };
    } finally {
      await sleep(SHOPIFY_PAUSE_MS);
    }
  }

  async function resolveKey(key: string): Promise<string | null> {
    if (resolved.has(key)) return resolved.get(key)!;
    let type = await fromLocalPeer(key);
    if (type) {
      stats.fromLocalPeer++;
    } else if (key.startsWith('p:')) {
      type = await fromShopifyProduct(key.slice(2));
      if (type) stats.fromShopifyProduct++;
    } else {
      const v = await fromShopifyVariant(key.slice(2));
      type = v.productType;
      if (type) {
        stats.fromShopifyVariant++;
        if (v.shopifyProductId) resolved.set(`p:${v.shopifyProductId}`, type);
      }
    }
    resolved.set(key, type);
    return type;
  }

  let cursor = '';
  let batchNo = 0;
  while (stats.scanned < limit) {
    const take = Math.min(BATCH_SIZE, limit - stats.scanned);
    const rows: Row[] = await prisma.orderItem.findMany({
      where: { productType: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, productId: true, variantId: true, sku: true, product: { select: { shopifyProductId: true } } },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    stats.scanned += rows.length;
    batchNo++;

    // type → row ids to update in this batch
    const byType = new Map<string, string[]>();
    let batchUnresolved = 0;
    for (const row of rows) {
      const shopifyProductId = row.product?.shopifyProductId && /^\d+$/.test(row.product.shopifyProductId)
        ? row.product.shopifyProductId
        : null;
      const variantId = snapCatalogIdFromOrderItem({ variantId: row.variantId, sku: row.sku });
      const key = shopifyProductId ? `p:${shopifyProductId}` : variantId ? `v:${variantId}` : null;
      if (!key) {
        stats.noKey++;
        batchUnresolved++;
        continue;
      }
      let type = await resolveKey(key);
      // A product link that Shopify no longer knows can still be answered through its variant.
      if (!type && key.startsWith('p:') && variantId) type = await resolveKey(`v:${variantId}`);
      if (!type) {
        batchUnresolved++;
        continue;
      }
      const ids = byType.get(type) || [];
      ids.push(row.id);
      byType.set(type, ids);
    }
    stats.unresolved += batchUnresolved;
    const resolvable = rows.length - batchUnresolved;

    let batchUpdated = 0;
    if (!dryRun) {
      for (const [type, ids] of Array.from(byType.entries())) {
        const res = await prisma.orderItem.updateMany({
          where: { id: { in: ids }, productType: null },
          data: { productType: type },
        });
        batchUpdated += res.count;
      }
      stats.updated += batchUpdated;
    }
    console.log(
      `[batch ${batchNo}] rows=${rows.length} resolvable=${resolvable} unresolved=${batchUnresolved}` +
        (dryRun ? ' (dry-run: not written)' : ` updated=${batchUpdated}`),
    );
  }

  console.log('\n=== Totals ===');
  console.log(`Scanned (productType NULL):   ${stats.scanned} of ${totalNull}`);
  console.log(`Resolved from another row:    ${stats.fromLocalPeer} product/variant lookups`);
  console.log(`Resolved from Shopify:        ${stats.fromShopifyProduct} products, ${stats.fromShopifyVariant} variants (${stats.shopifyCalls} calls, ${stats.shopifyErrors} errors)`);
  console.log(`Rows with no product/variant: ${stats.noKey}`);
  console.log(`Rows left NULL (unresolved):  ${stats.unresolved}`);
  console.log(dryRun ? `Rows that WOULD be updated:   ${stats.scanned - stats.unresolved} (dry-run: nothing written)` : `Rows updated:                 ${stats.updated}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
