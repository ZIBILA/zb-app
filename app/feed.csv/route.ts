/**
 * /feed.csv — Google/Meta-format CSV product feed
 *
 * Companion to /feed.xml. Same exclusions + field rules, RFC-4180 CSV.
 * Keep id / item_group_id / availability logic in sync with feed.xml.
 */

import { type ShopifyProduct } from '@/lib/shopify-admin';
import { getGoogleCategory } from '@/lib/google-product-categories';
import {
  csvCell,
  getProductSiteUrl,
  getVariantAttributes,
  loadFeedProducts,
  recordFeedBuildStatus,
  stripHtml,
} from '@/lib/product-feed';

function formatPrice(price: string | number): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num) || num <= 0) return '';
  return `${num.toFixed(2)} INR`;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SITE_URL = getProductSiteUrl();
const BRAND = 'Zica Bella';

const HEADER = [
  'id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'sale_price',
  'link',
  'image_link',
  'additional_image_link',
  'brand',
  'google_product_category',
  'product_type',
  'item_group_id',
  'size',
  'color',
  'mpn',
  'gtin',
  'identifier_exists',
];

function buildRow(product: ShopifyProduct, variant: ShopifyProduct['variants'][0]): string {
  const { size, color } = getVariantAttributes(product, variant);

  const productId = String(product.id);
  const id = String(variant.id);

  const variantTitle = variant.title && variant.title !== 'Default Title' ? variant.title : '';
  const fullTitle = variantTitle ? `${product.title} - ${variantTitle}` : product.title;
  const description = product.body_html ? stripHtml(product.body_html) : product.title;
  const link = `${SITE_URL}/products/${product.handle}`;

  const primaryImage = product.image?.src || product.images?.[0]?.src || '';
  const additionalImages = (product.images || []).slice(1, 11).map((img) => img.src).join(',');

  const inventoryTracked = !!variant.inventory_management;
  const inStock = inventoryTracked ? (variant.inventory_quantity ?? 0) > 0 : true;
  const availability = inStock ? 'in_stock' : 'out_of_stock';

  const variantPrice = parseFloat(variant.price || '0');
  const compareAtPrice = variant.compare_at_price ? parseFloat(variant.compare_at_price) : null;
  let price = '';
  let salePrice = '';
  if (compareAtPrice && compareAtPrice > variantPrice && variantPrice > 0) {
    price = formatPrice(compareAtPrice);
    salePrice = formatPrice(variantPrice);
  } else if (variantPrice > 0) {
    price = formatPrice(variantPrice);
  }

  const productType = product.product_type || '';
  const googleCategory = getGoogleCategory(product.product_type);
  const identifierExists = !variant.sku && !variant.barcode ? 'no' : '';

  const cells = [
    id,
    fullTitle,
    description,
    availability,
    'new',
    price,
    salePrice,
    link,
    primaryImage,
    additionalImages,
    BRAND,
    googleCategory,
    productType,
    productId,
    size || '',
    color || '',
    variant.sku || '',
    variant.barcode || '',
    identifierExists,
  ];

  return cells.map(csvCell).join(',');
}

export async function GET(): Promise<Response> {
  const startTime = Date.now();
  try {
    const loaded = await loadFeedProducts();

    const rows: string[] = [HEADER.join(',')];
    for (const product of loaded.products) {
      if (!product.variants || !Array.isArray(product.variants)) continue;
      for (const variant of product.variants) {
        if (!variant) continue;
        rows.push(buildRow(product, variant));
      }
    }

    const itemCount = rows.length - 1;
    const csv = rows.join('\r\n');
    const elapsed = Date.now() - startTime;

    await recordFeedBuildStatus({
      format: 'csv',
      status: 'success',
      itemCount,
      productCount: loaded.products.length,
      durationMs: elapsed,
    });

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'inline; filename="feed.csv"',
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
        'X-Feed-Items': String(itemCount),
      },
    });
  } catch (err) {
    console.error('[Feed CSV] Critical error generating feed:', err);
    await recordFeedBuildStatus({
      format: 'csv',
      status: 'error',
      durationMs: Date.now() - startTime,
      error: err,
    });
    return new Response(HEADER.join(',') + '\r\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'public, s-maxage=60',
      },
    });
  }
}
