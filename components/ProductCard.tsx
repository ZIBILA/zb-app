"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { ShopifyProduct } from "@/lib/shopify-admin";
import ProductCardImage from "./ProductCardImage";
import { useCountry } from "@/lib/country-context";

// Lazy-load modal to avoid SSR issues
const QuickAddModal = dynamic(() => import("./QuickAddModal"), { ssr: false });

interface Props {
  product: ShopifyProduct;
  priority?: boolean;
  selectedSize?: string;
}

export default function ProductCard({ product, priority = false, selectedSize }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const variant = product.variants?.[0];
  const price = variant?.price || "0";
  const compareAtPrice = variant?.compare_at_price;
  const isOnSale = compareAtPrice && parseFloat(compareAtPrice) > parseFloat(price);
  const { formatPrice } = useCountry();
  const displayPrice = formatPrice(parseFloat(price));
  const displayComparePrice = compareAtPrice ? formatPrice(parseFloat(compareAtPrice)) : null;

  // Use handle for SEO-friendly URLs — falls back to id if handle unavailable
  const productSlug = product.handle || product.id;

  const handleOpenModal = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsAdding(true);
    setTimeout(() => {
      setShowModal(true);
      setIsAdding(false);
    }, 300);
  };

  const totalStock = product.variants?.reduce((acc, v) => acc + (v.inventory_quantity || 0), 0) || 0;
  // Sold out ONLY if all variants are out of stock
  const isSoldOut = product.variants ? !product.variants.some(v => (v.inventory_quantity || 0) > 0) : true;

  return (
    <>
      <div className={`group relative w-full ${isSoldOut ? "opacity-60" : ""}`}>
        {/* Badges */}
        <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
          {isSoldOut ? (
            <div className="bg-black/40 border border-white/10 px-1.5 py-0.5 rounded-[2px] backdrop-blur-sm">
              <span className="text-[6px] font-bold uppercase tracking-widest text-white">Sold Out</span>
            </div>
          ) : isOnSale && (
            <div className="bg-black/85 px-1.5 py-0.5 rounded-[2px]">
              <span className="text-[6px] font-bold uppercase tracking-widest text-white">Sale</span>
            </div>
          )}
        </div>

        {/* Image — carousel, hover reveal, progressive loading */}
        <ProductCardImage
          images={product.images || []}
          title={product.title}
          priority={priority}
          isSoldOut={isSoldOut}
          productSlug={productSlug}
        />

        {/* Info row with "+" button */}
        <div className="flex justify-between items-center leading-tight px-1.5 py-2">
          <Link href={`/products/${productSlug}`} className="flex-1 min-w-0 pr-2 flex flex-col gap-0.5 block">
            <p className="text-[8px] sm:text-[9px] font-sans font-medium uppercase tracking-[0.2em] text-foreground/80 leading-none truncate pt-0.5">
              {product.title}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p className="text-[10px] sm:text-[11px] font-sans font-semibold leading-none tracking-tight text-foreground uppercase">
                {displayPrice.formatted}
              </p>
              {isOnSale && displayComparePrice && (
                <p className="text-[9px] sm:text-[10px] font-sans font-normal leading-none tracking-tight text-foreground/70 uppercase line-through">
                  {displayComparePrice.formatted}
                </p>
              )}
            </div>
          </Link>

          {!isSoldOut && (
            <button
              onClick={handleOpenModal}
              aria-label="Quick add to cart"
              className="w-5 h-5 rounded-md flex items-center justify-center transition-all duration-300 active:scale-95 flex-shrink-0 bg-transparent hover:bg-foreground/5"
            >
              {isAdding ? (
                <div className="w-2.5 h-2.5 rounded-full border border-foreground/30 border-t-foreground/80 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5 text-foreground/40 transition-colors group-hover:text-foreground/80" strokeWidth={1.5} />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Quick-Add Modal */}
      {showModal && (
        <QuickAddModal product={product} initialSize={selectedSize} onClose={() => setShowModal(false)} />
      )}
    </>
  );
}
