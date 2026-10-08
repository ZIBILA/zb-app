"use client";

import ProductCard from "@/components/ProductCard";
import { ShopifyProduct } from "@/lib/shopify-admin";
import Link from "next/link";
import Image from "next/image";
import { handleImageError } from "@/components/ImagePlaceholder";
import { useCountry } from "@/lib/country-context";

interface CollectionProductGridProps {
  products: ShopifyProduct[];
  viewMode: string;
  selectedSize?: string;
}

export default function CollectionProductGrid({ products, viewMode, selectedSize }: CollectionProductGridProps) {
  const { formatPrice: fmtPrice } = useCountry();
  if (products.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="font-heading text-[10px] uppercase tracking-widest text-foreground/25">
          No products found
        </p>
      </div>
    );
  }

  // For thumbnail and full view modes, use simple grid
  if (viewMode === "thumbnail") {
    return (
      <div className="w-full px-[2px] md:px-1">
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-[2px] md:gap-1">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} selectedSize={selectedSize} />
          ))}
        </div>
      </div>
    );
  }

  if (viewMode === "full") {
    return (
      <div className="w-full px-[2px] md:px-1">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-[2px] md:gap-1">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} selectedSize={selectedSize} />
          ))}
        </div>
      </div>
    );
  }

  // Default "current" view: 4 products grid → 1 full-width featured → repeat
  const chunks: { type: "grid" | "featured"; products: ShopifyProduct[] }[] = [];
  let i = 0;

  while (i < products.length) {
    // Take 4 products for grid
    const gridProducts = products.slice(i, i + 4);
    if (gridProducts.length > 0) {
      chunks.push({ type: "grid", products: gridProducts });
      i += 4;
    }

    // Take 1 product for featured full-width card
    if (i < products.length) {
      chunks.push({ type: "featured", products: [products[i]] });
      i += 1;
    }
  }

  return (
    <div className="w-full">
      {chunks.map((chunk, chunkIdx) => {
        if (chunk.type === "grid") {
          return (
            <div
              key={`grid-${chunkIdx}`}
              className="grid grid-cols-2 md:grid-cols-4 gap-[2px] md:gap-[3px] px-[2px] md:px-1"
            >
              {chunk.products.map((product, pIdx) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  selectedSize={selectedSize}
                  priority={chunkIdx === 0 && pIdx < 4}
                />
              ))}
            </div>
          );
        }

        // Featured full-width product card
        const product = chunk.products[0];
        const image = product.images?.[0]?.src || "/zb-logo-220px.png";
        const variant = product.variants?.[0];
        const price = variant?.price || "0";
        const compareAtPrice = variant?.compare_at_price;
        const isOnSale = compareAtPrice && parseFloat(compareAtPrice) > parseFloat(price);
        const isSoldOut = product.variants ? !product.variants.some(v => (v.inventory_quantity || 0) > 0) : true;
        const productSlug = product.handle || product.id;

        return (
          <div key={`feat-${chunkIdx}`} className="w-full my-[2px] md:my-[3px] px-[2px] md:px-1">
            <Link
              href={`/products/${productSlug}`}
              className={`group block relative w-full overflow-hidden ${isSoldOut ? "opacity-60" : ""}`}
            >
              {/* Full-width featured image */}
              <div
                className="relative w-full overflow-hidden bg-foreground/[0.02]"
                style={{ aspectRatio: "4 / 5" }}
              >
                <Image
                  src={image}
                  alt={product.title}
                  fill
                  sizes="100vw"
                  className={`object-cover transition-transform duration-800 ease-out ${!isSoldOut ? "group-hover:scale-[1.02]" : ""}`}
                  style={isSoldOut ? { filter: "grayscale(0.4)" } : image === "/zb-logo-220px.png" ? { objectFit: "contain", padding: "25%", opacity: 0.3 } : {}}
                  onError={handleImageError}
                />

                {/* Badges */}
                <div className="absolute top-3 left-3 z-10 flex flex-col gap-1">
                  {isSoldOut ? (
                    <div className="bg-black/40 border border-white/10 px-2 py-0.5 rounded-[3px] backdrop-blur-sm">
                      <span className="text-[7px] font-bold uppercase tracking-widest text-white">Sold Out</span>
                    </div>
                  ) : isOnSale && (
                    <div className="bg-black/85 px-2 py-0.5 rounded-[3px]">
                      <span className="text-[7px] font-bold uppercase tracking-widest text-white">Sale</span>
                    </div>
                  )}
                </div>

                {/* Bottom gradient */}
                <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 via-black/15 to-transparent pointer-events-none" />

                {/* Title and Price overlay */}
                <div className="absolute inset-x-0 bottom-0 p-4 md:p-6 z-10">
                  <p className="text-[10px] md:text-[12px] font-medium uppercase tracking-[0.2em] text-white/90 leading-tight mb-1.5">
                    {product.title}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] md:text-[11px] font-normal tracking-tight text-white/60">
                      {fmtPrice(parseFloat(price)).formatted}
                    </span>
                    {isOnSale && compareAtPrice && (
                      <span className="text-[8px] md:text-[10px] font-normal tracking-tight text-white/30 line-through">
                        {fmtPrice(parseFloat(compareAtPrice)).formatted}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
