"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ShopifyProduct } from "@/lib/shopify-admin";
import CollectionFilters from "@/components/CollectionFilters";
import CollectionProductGrid from "@/components/CollectionProductGrid";

/**
 * Client-side sort/filter so the collection page can stay ISR
 * (server must not read searchParams).
 */
export default function CollectionBrowseClient({
  products: rawProducts,
  allSizes,
}: {
  products: ShopifyProduct[];
  allSizes: string[];
}) {
  const searchParams = useSearchParams();
  const sortBy = searchParams.get("sort") || "featured";
  const minPrice = parseFloat(searchParams.get("min") || "0");
  const maxPrice = parseFloat(searchParams.get("max") || "999999");
  const selectedSize = searchParams.get("size") || undefined;
  const viewMode = searchParams.get("view") || "current";

  const products = useMemo(() => {
    let list = rawProducts.filter((p) => {
      const price = parseFloat(p.variants?.[0]?.price || "0");
      return price >= minPrice && price <= maxPrice;
    });

    list = [...list].sort((a, b) => {
      if (selectedSize) {
        const aHas = a.variants?.some(
          (v) => v.option1 === selectedSize && (v.inventory_quantity || 0) > 0
        )
          ? 1
          : 0;
        const bHas = b.variants?.some(
          (v) => v.option1 === selectedSize && (v.inventory_quantity || 0) > 0
        )
          ? 1
          : 0;
        if (aHas !== bHas) return bHas - aHas;
      }

      if (sortBy === "price-asc") {
        return (
          parseFloat(a.variants?.[0]?.price || "0") -
          parseFloat(b.variants?.[0]?.price || "0")
        );
      }
      if (sortBy === "price-desc") {
        return (
          parseFloat(b.variants?.[0]?.price || "0") -
          parseFloat(a.variants?.[0]?.price || "0")
        );
      }
      if (sortBy === "newest") {
        return (
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
        );
      }
      return 0;
    });

    return list;
  }, [rawProducts, sortBy, minPrice, maxPrice, selectedSize]);

  return (
    <>
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <CollectionFilters allSizes={allSizes} />
      </div>
      <div className="relative z-10 w-full pb-16">
        <CollectionProductGrid
          products={products}
          viewMode={viewMode}
          selectedSize={selectedSize}
        />
      </div>
    </>
  );
}
