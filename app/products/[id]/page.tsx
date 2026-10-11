import { fetchProductByHandle, fetchProducts, resolveShopifyGid, ShopifyProduct } from "@/lib/shopify-admin";
import Link from "next/link";
import { getShopSettings } from "@/lib/db";
import ProductDetailsClient from "./ProductDetailsClient";
import { Metadata } from "next";
import { ProductJsonLd } from "@/components/seo/ProductJsonLd";
import { Breadcrumb } from "@/components/seo/Breadcrumb";
import { getProductAggregateRating, getProductReviews } from "@/lib/reviews/getProductAggregateRating";
import { ProductReviews } from "@/components/reviews/ProductReviews";

export const revalidate = 60; // ISR: revalidate every 60 seconds

export async function generateMetadata({
  params,
}: {
  params: { id: string }
}): Promise<Metadata> {
  let product: ShopifyProduct | null = null;
  try {
    product = await fetchProductByHandle(params.id);
  } catch {
    // Silently fall through to "not found" metadata
  }

  if (!product) {
    return {
      title: 'Product Not Found | Zica Bella®',
      robots: { index: false, follow: false },
    }
  }

  const price = product.variants?.[0]?.price || "0";
  const priceFormatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(price))

  const productType = product.product_type?.toLowerCase() || 'streetwear';
  let categoryTag = 'Heavyweight Oversized Tee';
  
  if (productType.includes('hoodie')) {
    categoryTag = 'Heavyweight Fleece Hoodie';
  } else if (productType.includes('pant') || productType.includes('jean') || productType.includes('denim') || productType.includes('trouser')) {
    categoryTag = 'Luxury Streetwear Denim';
  } else if (productType.includes('accessory') || productType.includes('cap') || productType.includes('hat') || productType.includes('socks')) {
    categoryTag = 'Subculture Accessory';
  } else if (productType.includes('jacket') || productType.includes('outerwear') || productType.includes('zip')) {
    categoryTag = 'Streetwear Outerwear';
  } else if (productType.includes('t-shirt') || productType.includes('tee')) {
    categoryTag = 'Heavyweight Oversized Tee';
  }

  // Use product title so root template appends single brand suffix (~50-60 chars total)
  const title = product.title;

  // Process tags & title to extract specifications
  const tagsList = product.tags ? product.tags.split(',').map((t: string) => t.trim().toLowerCase()) : [];
  const hasAcidWash = tagsList.some(t => t.includes('acid') || t.includes('wash') || t.includes('vintage') || t.includes('fade'));
  const isHeavy = tagsList.some(t => t.includes('heavy') || t.includes('gsm') || t.includes('300') || t.includes('240') || t.includes('400'));
  const isLoopback = tagsList.some(t => t.includes('loopback') || t.includes('french') || t.includes('terry'));
  
  let specText = '';
  if (hasAcidWash) specText += 'vintage acid-wash finish, ';
  if (isLoopback) specText += 'double-yarn loopback cotton, ';
  else if (isHeavy) specText += 'heavyweight premium cotton, ';
  specText += 'relaxed drop-shoulder silhouette, and premium high-definition graphic prints.';

  const cleanBodyHtml = product.body_html
    ? product.body_html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    : '';

  const shortDesc = cleanBodyHtml.length > 120 ? `${cleanBodyHtml.slice(0, 117)}...` : cleanBodyHtml;
  
  // Construct dynamic description using Shopify product data and tags
  const description = `Shop ${product.title} at Zica Bella® for ${priceFormatted}. Premium ${categoryTag.toLowerCase()} featuring ${specText} ${shortDesc ? `Details: ${shortDesc}` : ''} Crafted in India, worn with intent. Free shipping above ₹999.`.slice(0, 290);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com';

  return {
    title,
    description,
    alternates: {
      canonical: `${siteUrl}/products/${product.handle}`,
    },
    openGraph: {
      title,
      description,
      url: `${siteUrl}/products/${product.handle}`,
      type: 'website',
      images: product.images?.[0]?.src
        ? [
            {
              url: product.images[0].src,
              width: 800,
              height: 800,
              alt: product.title,
            },
          ]
        : [{ url: `${siteUrl}/og-image.jpg`, width: 1200, height: 630, alt: 'Zica Bella®' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: product.images?.[0]?.src ? [product.images[0].src] : [`${siteUrl}/og-image.jpg`],
    },
  }
}

export default async function ProductPage({ params }: { params: { id: string } }) {
  let product: ShopifyProduct | null = null;
  let shop: any = null;
  let allProducts: ShopifyProduct[] = [];

  try {
    [product, shop, allProducts] = await Promise.all([
      fetchProductByHandle(params.id).catch(() => null),
      getShopSettings().catch(() => null),
      fetchProducts(12).catch(() => [] as ShopifyProduct[])
    ]);
  } catch (err) {
    console.error('[ProductPage] Fatal error fetching product data:', err);
    // Fall through — product will be null and "not found" UI renders
  }

  const recommendedProducts = (allProducts || []).filter((p: ShopifyProduct) => p.id?.toString() !== params.id);

  // Resolve metafield GIDs to URLs — wrapped in try/catch to prevent page crash
  try {
    if (product?.metafields && Array.isArray(product.metafields)) {
      await Promise.all(
        product.metafields.map(async (meta) => {
          try {
            if (meta.value && typeof meta.value === 'string' && meta.value.startsWith('gid://shopify/')) {
              const resolvedUrl = await resolveShopifyGid(meta.value);
              if (resolvedUrl) {
                meta.value = resolvedUrl;
              }
            }
          } catch {
            // Individual metafield resolution failure is non-critical
          }
        })
      );
    }
  } catch (err) {
    console.error('[ProductPage] Error resolving metafield GIDs:', err);
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Product Not Found</h1>
          <Link href="/" className="px-6 py-3 bg-foreground text-background font-bold rounded-xl">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  const images = product.images?.length > 0 ? product.images : [{ src: "/zb-logo-220px.png" }];
  const initialPrice = product.variants?.[0]?.price || "0.00";
  const comparePrice = product.variants?.[0]?.compare_at_price;

  // Fetch real aggregate rating & reviews from verified buyers — for SEO & AI bots
  let aggregateRating: { value: number; count: number } | undefined;
  let visibleReviewsList: any[] = [];
  try {
    [aggregateRating, visibleReviewsList] = await Promise.all([
      getProductAggregateRating(product.id.toString()),
      getProductReviews(product.id.toString(), { limit: 10 }),
    ]);
  } catch (err) {
    console.error('[ProductPage] Error fetching review data:', err);
    // Non-critical — JSON-LD simply omits rating/reviews
  }

  const productLdData = {
    id: product.id.toString(),
    name: product.title,
    description: product.body_html ? product.body_html.replace(/<[^>]*>/g, '') : product.title,
    price: parseFloat(initialPrice),
    compareAtPrice: comparePrice ? parseFloat(comparePrice) : undefined,
    currency: "INR",
    images: product.images?.map(img => ({ url: img.src, alt: product.title })) || [{ url: "/zb-logo-220px.png", alt: product.title }],
    slug: product.handle,
    sku: product.variants?.[0]?.sku || undefined,
    inStock: product.variants?.some(v => (v.inventory_quantity || 0) > 0) || false,
    brand: "Zica Bella",
    category: product.product_type || "Apparel > Tops > T-Shirts",
    rating: aggregateRating,
    reviews: visibleReviewsList.map(r => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      authorName: "Verified Buyer",
      createdAt: r.createdAt,
    })),
  };

  return (
    <>
      <ProductJsonLd product={productLdData} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-0 md:pt-28 pb-0 md:pb-2 relative z-20 text-foreground">
        <Breadcrumb
          items={[
            { name: 'Home', url: '/' },
            { name: product.product_type || 'Apparel', url: `/collections` },
            { name: product.title, url: `/products/${product.handle}` },
          ]}
        />
      </div>
      <ProductDetailsClient
        product={product}
        shopSettings={
          shop
            ? {
                showProductVideo: Boolean((shop as any).showProductVideo ?? true),
                showSizeChart: Boolean((shop as any).showSizeChart ?? true),
                showBrand: Boolean((shop as any).showBrand ?? true),
                showShippingReturn: Boolean((shop as any).showShippingReturn ?? true),
                showCare: Boolean((shop as any).showCare ?? true),
                showSizeFit: Boolean((shop as any).showSizeFit ?? true),
                showDetails: Boolean((shop as any).showDetails ?? true),
                pdpBackground: (shop as any).pdpBackground || undefined,
              }
            : null
        }
        recommendedProducts={recommendedProducts}
        allImages={images}
      />
      {/* Verified customer reviews section — on-page content matches JSON-LD */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8 text-foreground">
        <ProductReviews productId={product.id.toString()} />
      </div>
    </>
  );
}

