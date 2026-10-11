import { fetchCollectionByHandle, fetchEnabledCollections } from "@/lib/shopify-admin";
import { ShopifyProduct } from "@/lib/shopify-admin";
import { notFound } from "next/navigation";
import { Metadata } from "next";

import CollectionHeaderClient from "@/components/CollectionHeaderClient";
import CollectionFilters from "@/components/CollectionFilters";
import CollectionProductGrid from "@/components/CollectionProductGrid";
import { CollectionJsonLd } from "@/components/seo/CollectionJsonLd";
import { Breadcrumb } from "@/components/seo/Breadcrumb";
import { CategorySEOContent } from "@/components/seo/CategorySEOContent";

export const revalidate = 120; // ISR: re-render at most every 2 minutes (also refreshed instantly by Shopify webhooks / CMS)

export async function generateMetadata({
  params,
}: {
  params: { handle: string }
}): Promise<Metadata> {
  const { collection } = await fetchCollectionByHandle(params.handle).catch(() => ({ collection: null }));

  const titleMap: Record<string, string> = {
    'graphic-tees': 'Heavyweight Graphic Tees',
    'tshirts-under-5000': 'Streetwear Tees Under ₹5000',
    'oversized-tees': 'Oversized Drop-Shoulder T-Shirts',
    'tshirts': 'Acid Wash T-Shirts',
    'authentic-streetwear': 'Heavyweight 240 GSM Cotton T-Shirts',
    'jeans': 'Baggy Jeans & Wide Leg Denim',
    'shorts': 'Denim Jorts & Baggy Shorts',
    'shirts': 'Oversized Streetwear Shirts',
    'jackets': 'Streetwear Jackets',
    'jersey': 'Oversized Streetwear Jerseys',
    'new-arrivals': 'New Streetwear Arrivals',
    'best-sellers': 'Best Selling Streetwear',
  };

  const descMap: Record<string, string> = {
    'graphic-tees':
      'Explore India\'s finest heavyweight graphic tees for men. Crafted with custom-engineered oversized drop-shoulder patterns, premium double-yarn cotton, and high-density vintage prints. Wear with intent.',
    'tshirts-under-5000':
      'Discover premium graphic tees and oversized street fits under ₹5000. Luxury fabric architecture, hand-finished washes, and bold graphics without the luxury markup.',
    'oversized-tees':
      'Boxy drop-shoulder oversized t-shirts for men engineered from custom heavyweight cotton blanks. The ultimate subculture streetwear essential.',
    'tshirts':
      'Shop acid wash t-shirts for men at Zica Bella. Each tee features unique vintage acid-wash finishes on heavyweight 240+ GSM cotton, with relaxed drop-shoulder silhouettes and pre-shrunk construction that holds its form.',
    'authentic-streetwear':
      'Discover heavyweight 240 GSM cotton t-shirts built for substance over trend. Zica Bella\'s premium blanks use double-yarn combed cotton, delivering structured boxy drape and lasting shape retention from XS to 3XL.',
    'jeans':
      'Shop baggy jeans and wide leg denim for men at Zica Bella. Raw-edge finishing, vintage washes, and carpenter-style constructions in relaxed streetwear silhouettes. Premium heavyweight denim designed for bold everyday style.',
    'shorts':
      'Shop denim jorts and baggy shorts for men at Zica Bella. Oversized fits with raw-edge hems, acid-wash options, laser-printed graphics, and utility detailing — engineered for summer streetwear.',
    'shirts':
      'Discover oversized streetwear shirts for men at Zica Bella. Featuring panelled construction, corduroy accents, utility zip detailing, and relaxed boxy fits in premium fabrics.',
    'jackets':
      'Shop streetwear jackets for men at Zica Bella — leather jackets with crocodile textures, premium denim jackets with vintage washes, and layered outerwear designed for street style impact.',
    'jersey':
      'Oversized streetwear jerseys with bold graphic prints, mesh panels, and motorsport-inspired designs. Engineered for high-impact street style.',
    'new-arrivals':
      'Discover the latest streetwear drops at Zica Bella. New arrivals featuring heavyweight oversized tees, acid-wash denim, graphic jerseys, and premium streetwear designed and crafted in India.',
    'best-sellers':
      'Shop Zica Bella\'s best-selling streetwear — the pieces our community reaches for most. Heavyweight graphic tees, baggy denim, acid-wash favourites, and streetwear essentials.',
  };

  const collectionTitle = collection?.title || params.handle.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const title = titleMap[params.handle] ?? collectionTitle;
  const description =
    descMap[params.handle] ??
    `Shop the ${collectionTitle} capsule collection at Zica Bella®. Featuring custom relaxed silhouettes, heavyweight premium blanks, and original subculture graphics. Designed in Italy, crafted in India.`;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com';

  return {
    title,
    description,
    alternates: {
      canonical: `${siteUrl}/collections/${params.handle}`,
    },
    openGraph: {
      title,
      description,
      url: `${siteUrl}/collections/${params.handle}`,
      type: 'website',
      images: collection?.image?.src
        ? [{ url: collection.image.src, width: 800, height: 800, alt: collection.title }]
        : [{ url: `${siteUrl}/og-image.jpg`, width: 1200, height: 630, alt: 'Zica Bella®' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: collection?.image?.src ? [collection.image.src] : [`${siteUrl}/og-image.jpg`],
    },
  };
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: { handle: string };
  searchParams: { sort?: string; min?: string; max?: string; size?: string; view?: string };
}) {
  // No limit: every eligible product, all Shopify pages, in the CMS order.
  const { collection, products: rawProducts } = await fetchCollectionByHandle(params.handle);
  
  const allCollections = await fetchEnabledCollections('page');

  if (!collection) notFound();
 
  const sortBy = searchParams.sort || "featured";
  const minPrice = parseFloat(searchParams.min || "0");
  const maxPrice = parseFloat(searchParams.max || "999999");
  const selectedSize = searchParams.size;
  const viewMode = searchParams.view || "current";

  // Extract all unique sizes from products
  const allSizes = Array.from(new Set(
    rawProducts.flatMap(p => 
      p.variants?.map(v => v.option1) || []
    )
  )).filter((s): s is string => typeof s === "string" && s !== "Default Title" && !s.includes(" / ")); // Simple size extraction

  // Apply filtering
  let products = rawProducts.filter((p) => {
    const price = parseFloat(p.variants?.[0]?.price || "0");
    const matchesPrice = price >= minPrice && price <= maxPrice;
    
    if (!matchesPrice) return false;
    
    return true;
  });

  // Apply sorting
  products = [...products].sort((a, b) => {
    // Primary Sort: selected size availability
    if (selectedSize) {
      const aHasVariant = a.variants?.some(v => v.option1 === selectedSize && (v.inventory_quantity || 0) > 0) ? 1 : 0;
      const bHasVariant = b.variants?.some(v => v.option1 === selectedSize && (v.inventory_quantity || 0) > 0) ? 1 : 0;
      if (aHasVariant !== bHasVariant) {
        return bHasVariant - aHasVariant;
      }
    }
    
    // Secondary Sort: user choice
    if (sortBy === "price-asc") {
      return parseFloat(a.variants?.[0]?.price || "0") - parseFloat(b.variants?.[0]?.price || "0");
    } else if (sortBy === "price-desc") {
      return parseFloat(b.variants?.[0]?.price || "0") - parseFloat(a.variants?.[0]?.price || "0");
    } else if (sortBy === "newest") {
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    }
    
    return 0;
  });

  const collectionLdData = {
    title: collection.title,
    slug: collection.handle,
    description: collection.body_html ? collection.body_html.replace(/<[^>]*>/g, '') : undefined,
    products: products.map(p => ({
      name: p.title,
      slug: p.handle,
      price: parseFloat(p.variants?.[0]?.price || "0"),
      image: p.images?.[0]?.src || p.image?.src || undefined
    }))
  };

  return (
    <>
      <CollectionJsonLd collection={collectionLdData} />
      <div className="min-h-screen pt-12">
        {/* Header & Filters — contained width */}
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-header">
          {/* Visual Breadcrumb */}
          <div className="mb-4">
            <Breadcrumb
              items={[
                { name: 'Home', url: '/' },
                { name: 'Collections', url: '/collections' },
                { name: collection.title, url: `/collections/${collection.handle}` },
              ]}
            />
          </div>

          {/* Collection selector */}
          <div className="mb-4">
            <CollectionHeaderClient 
              currentHandle={params.handle}
              currentTitle={collection.title}
              allCollections={allCollections}
              currentImage={collection.image?.src}
            />
          </div>

          {/* Minimalist Filter Bar */}
          <CollectionFilters allSizes={allSizes} />
        </div>

        {/* Product Grid — edge-to-edge, minimal gaps */}
        <div className="relative z-10 w-full pb-16">
          <CollectionProductGrid
            products={products}
            viewMode={viewMode}
            selectedSize={selectedSize}
          />
        </div>

        {/* GEO/SEO content block */}
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-32 text-foreground">
          <CategorySEOContent slug={params.handle as any} />
        </div>
      </div>
    </>
  );
}
