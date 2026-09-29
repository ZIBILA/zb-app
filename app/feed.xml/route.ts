/**
 * /feed.xml — Spec-complete product feed for Meta, Snapchat, TikTok, Google & OpenAI Ads
 *
 * RSS 2.0 with Google Merchant `g:` namespace.
 * Data sourced from Shopify Admin REST API; feed-inclusion flags from Prisma.
 */

import { type ShopifyProduct } from '@/lib/shopify-admin';
import { getGoogleCategory } from '@/lib/google-product-categories';
import {
  getProductSiteUrl,
  loadFeedProducts,
  recordFeedBuildStatus,
} from '@/lib/product-feed';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SITE_URL = getProductSiteUrl();
const BRAND = 'Zica Bella';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cdata(text: string): string {
  const safe = text.replace(/\]\]>/g, ']]]><![CDATA[>');
  return `<![CDATA[${safe}]]>`;
}

function formatPrice(price: string | number): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num) || num <= 0) return '';
  return `${num.toFixed(2)} INR`;
}

function getVariantAttributes(
  product: ShopifyProduct,
  variant: ShopifyProduct['variants'][0]
): { size: string | null; color: string | null } {
  const options = product.options || [];
  let size: string | null = null;
  let color: string | null = null;

  for (let i = 0; i < options.length; i++) {
    const name = options[i].name.toLowerCase();
    const value = i === 0 ? variant.option1 : i === 1 ? variant.option2 : variant.option3;

    if (name === 'size' && value) size = value;
    else if ((name === 'color' || name === 'colour') && value) color = value;
  }

  return { size, color };
}

function generateItemXml(
  product: ShopifyProduct,
  variant: ShopifyProduct['variants'][0]
): string {
  const { size, color } = getVariantAttributes(product, variant);

  const productId = String(product.id);
  const variantId = String(variant.id);
  const itemId = variantId;

  const variantTitle = variant.title && variant.title !== 'Default Title' ? variant.title : '';
  const fullTitle = variantTitle ? `${product.title} - ${variantTitle}` : product.title;

  const description = product.body_html ? stripHtml(product.body_html) : product.title;
  const link = `${SITE_URL}/products/${product.handle}`;

  const primaryImage = product.image?.src || product.images?.[0]?.src || '';
  const additionalImages = (product.images || [])
    .slice(1, 11)
    .map((img) => img.src);

  const inventoryTracked = !!variant.inventory_management;
  const inStock = inventoryTracked ? (variant.inventory_quantity ?? 0) > 0 : true;
  const availability = inStock ? 'in_stock' : 'out_of_stock';

  const variantPrice = parseFloat(variant.price || '0');
  const compareAtPrice = variant.compare_at_price ? parseFloat(variant.compare_at_price) : null;

  let priceTag = '';
  let salePriceTag = '';

  if (compareAtPrice && compareAtPrice > variantPrice && variantPrice > 0) {
    priceTag = formatPrice(compareAtPrice);
    salePriceTag = formatPrice(variantPrice);
  } else if (variantPrice > 0) {
    priceTag = formatPrice(variantPrice);
  }

  const productType = product.product_type || '';
  const googleCategory = getGoogleCategory(product.product_type);

  const lines: string[] = [
    '    <item>',
    `      <g:id>${escapeXml(itemId)}</g:id>`,
    `      <title>${escapeXml(fullTitle)}</title>`,
    `      <description>${cdata(description)}</description>`,
    `      <link>${escapeXml(link)}</link>`,
  ];

  if (primaryImage) {
    lines.push(`      <g:image_link>${escapeXml(primaryImage)}</g:image_link>`);
  }
  for (const img of additionalImages) {
    lines.push(`      <g:additional_image_link>${escapeXml(img)}</g:additional_image_link>`);
  }

  lines.push(`      <g:availability>${availability}</g:availability>`);

  if (priceTag) lines.push(`      <g:price>${escapeXml(priceTag)}</g:price>`);
  if (salePriceTag) lines.push(`      <g:sale_price>${escapeXml(salePriceTag)}</g:sale_price>`);

  lines.push(`      <g:brand>${escapeXml(BRAND)}</g:brand>`);
  lines.push(`      <g:condition>new</g:condition>`);

  if (productType) {
    lines.push(`      <g:product_type>${escapeXml(productType)}</g:product_type>`);
  }
  lines.push(`      <g:google_product_category>${escapeXml(googleCategory)}</g:google_product_category>`);
  lines.push(`      <g:item_group_id>${escapeXml(productId)}</g:item_group_id>`);

  if (size) lines.push(`      <g:size>${escapeXml(size)}</g:size>`);
  if (color) lines.push(`      <g:color>${escapeXml(color)}</g:color>`);

  if (variant.sku) lines.push(`      <g:mpn>${escapeXml(variant.sku)}</g:mpn>`);
  if (variant.barcode) lines.push(`      <g:gtin>${escapeXml(variant.barcode)}</g:gtin>`);

  if (!variant.sku && !variant.barcode) {
    lines.push(`      <g:identifier_exists>false</g:identifier_exists>`);
  }

  lines.push('    </item>');
  return lines.join('\n');
}

export async function GET(): Promise<Response> {
  const startTime = Date.now();
  try {
    console.log('[Feed] Starting feed generation...');

    const loaded = await loadFeedProducts();
    console.log(
      `[Feed] Fetched ${loaded.totalFetched} products; toggle-excluded=${loaded.toggleExcludedCount}, collection-excluded=${loaded.collectionExcludedCount}, included=${loaded.products.length}`
    );

    const items: string[] = [];
    for (const product of loaded.products) {
      if (!product.variants || !Array.isArray(product.variants)) continue;
      for (const variant of product.variants) {
        if (!variant) continue;
        items.push(generateItemXml(product, variant));
      }
    }

    const now = new Date().toUTCString();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(BRAND)} Product Feed</title>
    <link>${escapeXml(SITE_URL)}</link>
    <description>${escapeXml(`${BRAND} — Official Product Catalog Feed`)}</description>
    <lastBuildDate>${escapeXml(now)}</lastBuildDate>
${items.join('\n')}
  </channel>
</rss>`;

    const elapsed = Date.now() - startTime;
    console.log(`[Feed] Generated feed with ${items.length} items in ${elapsed}ms`);

    await recordFeedBuildStatus({
      format: 'xml',
      status: 'success',
      itemCount: items.length,
      productCount: loaded.products.length,
      durationMs: elapsed,
    });

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
        'X-Feed-Items': String(items.length),
        'X-Feed-Generated': now,
      },
    });
  } catch (err) {
    console.error('[Feed] Critical error generating feed:', err);
    await recordFeedBuildStatus({
      format: 'xml',
      status: 'error',
      durationMs: Date.now() - startTime,
      error: err,
    });

    const errorXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(BRAND)} Product Feed</title>
    <link>${escapeXml(SITE_URL)}</link>
    <description>Feed temporarily unavailable</description>
  </channel>
</rss>`;

    return new Response(errorXml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=60',
      },
    });
  }
}
