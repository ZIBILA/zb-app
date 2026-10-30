import { searchProducts, fetchCollections, fetchCollectionByHandle } from "@/lib/shopify-admin";
import { ShopifyProduct } from "@/lib/shopify-admin";
import SearchResultsClient from "@/components/SearchResultsClient";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: { q?: string };
}): Promise<Metadata> {
  const query = (searchParams.q || "").trim();
  const title = query ? `Archives Search: "${query}" | Zica Bella®` : "Search Streetwear & Graphic Tees | Zica Bella®";
  const description = query
    ? `Search results for "${query}" in Zica Bella\'s streetwear archives. Browse heavyweight oversized blanks, vintage graphic t-shirts, and limited edition drops.`
    : "Search the Zica Bella streetwear catalog. Explore boxy drop-shoulder oversized graphic tees, heavyweight hoodies, and premium basics.";
  
  return {
    title,
    description,
    keywords: query 
      ? [query, 'zica bella search', 'streetwear search', 'oversized graphic tees', 'vintage blanks']
      : ['zica bella catalog', 'streetwear search', 'oversized t-shirts online', 'heavyweight hoodies', 'graphic tees india'],
    alternates: {
      canonical: query
        ? `https://zicabella.com/search?q=${encodeURIComponent(query)}`
        : "https://zicabella.com/search",
    },
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string; sort?: string; min?: string; max?: string };
}) {
  const query = (searchParams.q || "").trim();
  const sortBy = searchParams.sort || "relevance";
  const minPrice = parseFloat(searchParams.min || "0");
  const maxPrice = parseFloat(searchParams.max || "999999");

  // Fetch collections and trending products unconditionally to support empty states and editorial fallback
  const [productsRaw, collections, trendingProducts] = await Promise.all([
    query ? searchProducts(query, 48).catch(() => [] as ShopifyProduct[]) : Promise.resolve([] as ShopifyProduct[]),
    fetchCollections().catch(() => [] as any[]),
    fetchCollectionByHandle('all', 24).then((r) => r.products).catch(() => [] as ShopifyProduct[]),
  ]);

  // Filter raw products by price range if specified
  const products = productsRaw.filter((p) => {
    const price = parseFloat(p.variants?.[0]?.price || "0");
    return price >= minPrice && price <= maxPrice;
  });

  return (
    <div className="min-h-screen">
      <div className="relative z-10 max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 pb-32 pt-28">
        <SearchResultsClient
          initialProducts={products}
          query={query}
          collections={collections}
          trendingProducts={trendingProducts}
          initialSortBy={sortBy}
        />
      </div>
    </div>
  );
}
