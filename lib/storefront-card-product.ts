import type { ShopifyCollection, ShopifyProduct } from "@/lib/shopify-admin";

/**
 * Trim a Shopify product down to what the storefront card components use
 * (ProductCard, ProductCardImage, QuickAddModal, CollectionProductGrid,
 * CollectionBrowseClient / CollectionFilters sorting).
 *
 * Why: every product handed to a client component is serialised twice into the
 * HTML (RSC payload) — with `body_html`, full image objects, options and
 * metafields a 40-product collection page carried ~520 KB of product JSON and
 * the home page ~225 KB. Cards never read those fields. Dropping them cuts the
 * document the phone has to download and parse before it can hydrate.
 *
 * The result keeps the `ShopifyProduct` shape so no consumer changes; the
 * heavy fields are emptied, not removed.
 */
export function toCardProduct(p: ShopifyProduct): ShopifyProduct {
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    body_html: null,
    status: p.status,
    created_at: p.created_at,
    updated_at: p.updated_at,
    published_at: p.published_at,
    product_type: p.product_type,
    vendor: "",
    // Kept: the product page scores "curated for you" picks by shared tags.
    tags: p.tags || "",
    image: p.image?.src ? { src: p.image.src } : null,
    images: (p.images || []).map((img) => ({ id: img.id, src: img.src })),
    variants: (p.variants || []).map((v) => ({
      id: v.id,
      title: v.title,
      price: v.price,
      compare_at_price: v.compare_at_price ?? null,
      sku: null,
      barcode: null,
      inventory_item_id: v.inventory_item_id,
      inventory_quantity: v.inventory_quantity,
      inventory_management: v.inventory_management ?? null,
      option1: v.option1 ?? null,
      option2: v.option2 ?? null,
      option3: v.option3 ?? null,
    })),
  };
}

export function toCardProducts(products: ShopifyProduct[]): ShopifyProduct[] {
  return (products || []).map(toCardProduct);
}

/** Same idea for collection tiles (carousel / collection header): no description HTML. */
export function toCardCollection(c: ShopifyCollection): ShopifyCollection {
  return {
    id: c.id,
    title: c.title,
    handle: c.handle,
    updated_at: c.updated_at,
    body_html: null,
    image: c.image?.src ? { src: c.image.src } : null,
    ...(c.products_count !== undefined ? { products_count: c.products_count } : {}),
    ...(c.productsCount !== undefined ? { productsCount: c.productsCount } : {}),
  };
}

export function toCardCollections(collections: ShopifyCollection[]): ShopifyCollection[] {
  return (collections || []).map(toCardCollection);
}
