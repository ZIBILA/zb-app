/**
 * Sale Management — percentage sales on hand-picked products.
 *
 * Starting a sale writes, per Shopify variant:   price = discounted,  compare_at_price = pre-sale price.
 * The storefront, mobile app and product feeds already render compare_at_price as the struck-through
 * original, and checkout re-verifies totals against Shopify variant prices, so every surface agrees.
 *
 * Each variant's pre-sale price + compare-at price is stored in SaleItem; ending the sale writes them back.
 * A variant whose price was changed by hand during the sale is left alone on end (status "kept").
 */

import prisma from '@/lib/db';
import type { SaleItem } from '@prisma/client';
import { fetchProductById, shopifyGraphqlFetch, clearShopifyCache, type ShopifyProduct } from '@/lib/shopify-admin';
import { computeSalePrice, samePrice } from '@/lib/sale-pricing';

export { validateSaleInput } from '@/lib/sale-pricing';

const VARIANTS_BULK_UPDATE = `
  mutation SaleVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price compareAtPrice }
      userErrors { field message }
    }
  }
`;

export async function writeVariantPrices(
  productId: string,
  variants: Array<{ variantId: string; price: string; compareAtPrice: string | null }>
) {
  const data = await shopifyGraphqlFetch<any>(VARIANTS_BULK_UPDATE, {
    productId: `gid://shopify/Product/${productId}`,
    variants: variants.map((v) => ({
      id: `gid://shopify/ProductVariant/${v.variantId}`,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
    })),
  });
  const errors = data?.productVariantsBulkUpdate?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((e: any) => e.message).join('; '));
  }
}

/** Live storefront caches (catalog TTL cache + ISR pages) so new prices show immediately. */
async function refreshStorefront() {
  clearShopifyCache();
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/', 'layout');
  } catch (err) {
    console.warn('[Sale] Storefront revalidation failed:', (err as Error).message);
  }
}

export interface SaleResultSummary {
  saleId: string;
  applied: number;
  failed: Array<{ productId: string; title?: string; error: string }>;
  skipped: Array<{ productId: string; title?: string; reason: string }>;
}

export async function startSale(
  input: { name: string; percent: number; productIds: string[] },
  createdBy?: string | null
): Promise<SaleResultSummary> {
  // A product already in a running sale is skipped — discounts never stack on an already-discounted price.
  const busy = await prisma.saleItem.findMany({
    where: { shopifyProductId: { in: input.productIds }, status: 'applied', sale: { status: 'active' } },
    select: { shopifyProductId: true, sale: { select: { name: true } } },
  });
  const busyMap = new Map<string, string>(
    busy.map((b: { shopifyProductId: string; sale: { name: string } }) => [b.shopifyProductId, b.sale.name])
  );

  clearShopifyCache(); // base the discount on live prices, not the catalog cache
  const sale = await prisma.sale.create({
    data: { name: input.name, percent: input.percent, createdBy: createdBy || null },
  });

  const summary: SaleResultSummary = { saleId: sale.id, applied: 0, failed: [], skipped: [] };

  for (const productId of input.productIds) {
    if (busyMap.has(productId)) {
      summary.skipped.push({ productId, reason: `Already in the running sale "${busyMap.get(productId)}"` });
      continue;
    }

    let product: ShopifyProduct | null = null;
    try {
      product = await fetchProductById(productId);
    } catch (err) {
      summary.failed.push({ productId, error: `Could not load product from Shopify: ${(err as Error).message}` });
      continue;
    }

    let rows: Array<{
      variantId: string;
      variantTitle: string;
      originalPrice: string;
      originalCompareAtPrice: string | null;
      salePrice: string;
    }>;
    try {
      rows = (product.variants || []).map((v) => ({
        variantId: String(v.id),
        variantTitle: v.title,
        originalPrice: String(v.price),
        originalCompareAtPrice: v.compare_at_price ? String(v.compare_at_price) : null,
        salePrice: computeSalePrice(v.price, input.percent),
      }));
    } catch (err) {
      summary.skipped.push({ productId, title: product.title, reason: (err as Error).message });
      continue;
    }
    if (rows.length === 0) {
      summary.skipped.push({ productId, title: product.title, reason: 'Product has no variants' });
      continue;
    }

    let error: string | null = null;
    try {
      await writeVariantPrices(
        productId,
        rows.map((r) => ({ variantId: r.variantId, price: r.salePrice, compareAtPrice: r.originalPrice }))
      );
    } catch (err) {
      error = (err as Error).message;
    }

    await prisma.saleItem.createMany({
      data: rows.map((r) => ({
        saleId: sale.id,
        shopifyProductId: productId,
        shopifyVariantId: r.variantId,
        productTitle: product!.title,
        variantTitle: r.variantTitle,
        originalPrice: r.originalPrice,
        originalCompareAtPrice: r.originalCompareAtPrice,
        salePrice: r.salePrice,
        status: error ? 'failed' : 'applied',
        error,
      })),
    });

    if (error) summary.failed.push({ productId, title: product.title, error });
    else summary.applied += 1;
  }

  if (summary.applied === 0) {
    // Nothing went live — don't leave an "active" sale behind.
    await prisma.sale.update({ where: { id: sale.id }, data: { status: 'ended', endedAt: new Date() } });
  }
  await refreshStorefront();
  return summary;
}

export interface EndSaleSummary {
  restored: number;
  kept: Array<{ title?: string | null; variant?: string | null; reason: string }>;
  failed: Array<{ title?: string | null; error: string }>;
}

export async function endSale(saleId: string): Promise<EndSaleSummary> {
  const sale: ({ items: SaleItem[] } & Record<string, any>) | null = await prisma.sale.findUnique({
    where: { id: saleId },
    include: { items: true },
  });
  if (!sale) throw new Error('Sale not found');
  // Compare against live Shopify prices, never the storefront's catalog cache.
  clearShopifyCache();

  const summary: EndSaleSummary = { restored: 0, kept: [], failed: [] };
  const byProduct = new Map<string, SaleItem[]>();
  for (const item of sale.items) {
    if (item.status !== 'applied') continue;
    const list = byProduct.get(item.shopifyProductId) || [];
    list.push(item);
    byProduct.set(item.shopifyProductId, list);
  }

  for (const [productId, items] of byProduct) {
    const title = items[0]?.productTitle;
    let product: ShopifyProduct;
    try {
      product = await fetchProductById(productId);
    } catch (err) {
      summary.failed.push({ title, error: `Could not load product from Shopify: ${(err as Error).message}` });
      continue;
    }
    const current = new Map((product.variants || []).map((v) => [String(v.id), v]));

    const toRestore: SaleItem[] = [];
    const kept: SaleItem[] = [];
    for (const item of items) {
      const live = current.get(item.shopifyVariantId);
      if (!live) {
        kept.push(item); // variant deleted in Shopify — nothing to restore
        summary.kept.push({ title, variant: item.variantTitle, reason: 'Variant no longer exists in Shopify' });
      } else if (!samePrice(live.price, item.salePrice)) {
        kept.push(item); // someone re-priced it by hand during the sale — respect that
        summary.kept.push({
          title,
          variant: item.variantTitle,
          reason: `Price was changed to ₹${Number(live.price)} during the sale; left unchanged`,
        });
      } else {
        toRestore.push(item);
      }
    }

    if (toRestore.length > 0) {
      try {
        await writeVariantPrices(
          productId,
          toRestore.map((i) => ({
            variantId: i.shopifyVariantId,
            price: i.originalPrice,
            compareAtPrice: i.originalCompareAtPrice,
          }))
        );
        await prisma.saleItem.updateMany({
          where: { id: { in: toRestore.map((i) => i.id) } },
          data: { status: 'restored', error: null },
        });
        summary.restored += toRestore.length;
      } catch (err) {
        const message = (err as Error).message;
        await prisma.saleItem.updateMany({
          where: { id: { in: toRestore.map((i) => i.id) } },
          data: { error: message },
        });
        summary.failed.push({ title, error: message });
      }
    }
    if (kept.length > 0) {
      await prisma.saleItem.updateMany({ where: { id: { in: kept.map((i) => i.id) } }, data: { status: 'kept' } });
    }
  }

  // Stay "active" while some variants still carry sale prices, so ending can be retried.
  if (summary.failed.length === 0) {
    await prisma.sale.update({ where: { id: saleId }, data: { status: 'ended', endedAt: new Date() } });
  }
  await refreshStorefront();
  return summary;
}
