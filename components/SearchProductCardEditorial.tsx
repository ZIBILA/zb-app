"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { ShoppingBag, Check, X, Plus } from "lucide-react";
import { useCart } from "@/lib/cart-context";
import { ShopifyProduct } from "@/lib/shopify-admin";
import { handleImageError } from "./ImagePlaceholder";
import { toast } from "sonner";
import ProductCardImage from "./ProductCardImage";
import dynamic from "next/dynamic";
import { useMetaEvents } from "@/hooks/useMetaEvents";
import { useSnapEvents } from "@/hooks/useSnapEvents";
import { useOpenAiEvents } from "@/hooks/useOpenAiEvents";
import { useCountry } from "@/lib/country-context";

const QuickAddModal = dynamic(() => import("./QuickAddModal"), { ssr: false });

interface EditorialProductMediaProps {
  images: { id: number; src: string }[];
  title: string;
  isSoldOut: boolean;
  productSlug: string | number;
  priority?: boolean;
}

function EditorialProductMedia({
  images,
  title,
  isSoldOut,
  productSlug,
  priority = false,
}: EditorialProductMediaProps) {
  return (
    <ProductCardImage
      images={images}
      title={title}
      isSoldOut={isSoldOut}
      productSlug={productSlug}
      priority={priority}
    />
  );
}

interface Props {
  chunk: ShopifyProduct[];
  index: number;
  priority?: boolean;
}

export default function SearchProductCardEditorial({ chunk, index, priority = false }: Props) {
  const { formatPrice: fmtPrice } = useCountry();
  const { add } = useCart();
  const { trackAddToCart } = useMetaEvents();
  const { trackAddToCart: trackSnapAddToCart } = useSnapEvents();
  const { trackItemsAdded: trackOaiItemsAdded } = useOpenAiEvents();
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [sizeError, setSizeError] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [activeModalProduct, setActiveModalProduct] = useState<ShopifyProduct | null>(null);

  // Identify products in the lookbook group (up to 4)
  const p1 = chunk[0];
  const p2 = chunk[1] || null;
  const p3 = chunk[2] || null;
  const p4 = chunk[3] || null;

  if (!p1) return null;

  // Helper to extract details cleanly
  const getProductDetails = (p: ShopifyProduct) => {
    const variant = p.variants?.[0];
    const price = variant?.price || "0";
    const compareAtPrice = variant?.compare_at_price;
    const isOnSale = compareAtPrice && parseFloat(compareAtPrice) > parseFloat(price);
    const isSoldOut = p.variants ? !p.variants.some(v => (v.inventory_quantity || 0) > 0) : true;
    const slug = p.handle || p.id;
    const img = p.images?.[0]?.src || "/zb-logo-220px.png";

    // Strip HTML from description
    const rawDesc = p.body_html ? p.body_html.replace(/<[^>]*>/g, "").trim() : "";
    const description = rawDesc || "A statement piece characterized by exquisite details, seamless cuts, and a modern aesthetic designed to refine your everyday look.";

    return { variant, price, compareAtPrice, isOnSale, isSoldOut, slug, img, description };
  };

  const p1Details = getProductDetails(p1);

  // Extract unique sizes for p1 (Featured Big Product)
  const p1Sizes = p1.variants
    ?.map((v) => ({
      size: v.option1 ?? "One Size",
      variantId: String(v.id),
      inventory: v.inventory_quantity || 0
    }))
    .filter((v, i, a) => a.findIndex((x) => x.size === v.size) === i) || [];

  const handleAddFeatured = () => {
    if (p1Sizes.length > 1 && !selectedSize) {
      setSizeError(true);
      toast.error("Please select a size first");
      setTimeout(() => setSizeError(false), 1500);
      return;
    }

    const chosenSize = selectedSize ?? (p1Sizes.length === 1 ? p1Sizes[0].size : null);
    const matchedSizeObj = p1Sizes.find(s => s.size === chosenSize);
    const productVariant = p1.variants?.find(v => String(v.id) === matchedSizeObj?.variantId);

    if (!productVariant && p1Sizes.length > 0) {
      toast.error("This variant is currently unavailable");
      return;
    }

    setIsAdding(true);

    const variantId = matchedSizeObj?.variantId ?? String(p1.variants?.[0]?.id);
    const itemPrice = parseFloat(productVariant?.price || p1Details.price || "0");

    setTimeout(() => {
      add({
        productId: String(p1.id),
        variantId,
        title: p1.title,
        size: chosenSize,
        handle: p1.handle,
        price: p1Details.price,
        image: p1Details.img,
        category: p1.product_type,
      });

      trackAddToCart(variantId, p1.title, itemPrice, 'INR', p1.product_type);
      trackSnapAddToCart(variantId, p1.title, itemPrice, 'INR', p1.product_type);
      trackOaiItemsAdded(variantId, p1.title, itemPrice, 'INR', p1.product_type);

      setIsAdding(false);
      setAdded(true);
      toast.success(`${p1.title} added to bag`);
      setTimeout(() => setAdded(false), 1200);
    }, 450);
  };

  // Alternating layout columns on desktop
  const isEven = index % 2 === 0;

  return (
    <>
      <div 
        className="w-full flex flex-col lg:grid lg:grid-cols-12 gap-8 lg:gap-12 py-12 border-b border-foreground/5 last:border-b-0"
      >
        {/* ──────────── MAIN AREA (p4 above p1) ──────────── */}
        <div 
          className={`w-full lg:col-span-9 flex flex-col ${
            isEven ? "lg:order-1" : "lg:order-2"
          }`}
        >
          {/* A. PRODUCT ABOVE (p4) - Small Horizontal Card with Description */}
          {p4 && (() => {
            const d = getProductDetails(p4);
            return (
              <div 
                className={`flex gap-5 items-center border-b border-foreground/[0.04] pb-6 mb-6 text-left w-full hover:bg-foreground/[0.01] rounded-2xl transition-all ${
                  d.isSoldOut ? "opacity-60" : ""
                }`}
              >
                {/* Small Image (Left) */}
                <div className="w-[88px] sm:w-[100px] aspect-[3/5] rounded-xl overflow-hidden relative bg-foreground/[0.02] flex-shrink-0 border border-foreground/[0.03] shadow-sm group">
                  <EditorialProductMedia
                    images={p4.images || []}
                    title={p4.title}
                    isSoldOut={d.isSoldOut}
                    productSlug={d.slug}
                  />
                </div>
                {/* Details (Right) */}
                <div className="flex-1 min-w-0 flex flex-col justify-between py-1 pr-2">
                  <div>
                    <h3 
                      className="text-xs sm:text-[13px] uppercase tracking-[0.14em] text-foreground/85 font-light"
                      style={{ fontFamily: "var(--font-poppins), -apple-system, sans-serif" }}
                    >
                      {p4.title}
                    </h3>
                    <span className="text-[9px] text-foreground/45 mt-0.5 block">
                      {fmtPrice(parseFloat(d.price)).formatted}
                    </span>
                    <p className="text-[9.5px] text-foreground/35 leading-relaxed font-light mt-2 line-clamp-2">
                      {d.description}
                    </p>
                  </div>

                  <div className="mt-3 flex gap-2">
                    {!d.isSoldOut ? (
                      <button
                        onClick={() => setActiveModalProduct(p4)}
                        className="py-1 px-3 rounded-lg border border-foreground/[0.08] text-[8px] uppercase tracking-widest text-foreground/60 hover:bg-foreground hover:text-background transition-all active:scale-95 flex items-center gap-1 font-medium bg-background/50"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        <span>Add</span>
                      </button>
                    ) : (
                      <span className="py-1 px-3 rounded-lg bg-foreground/5 text-foreground/25 text-[8px] uppercase tracking-widest font-mono">
                        Sold Out
                      </span>
                    )}
                    <Link
                      href={`/products/${d.slug}`}
                      className="py-1 px-3 rounded-lg border border-foreground/[0.08] text-[8px] uppercase tracking-widest text-foreground/50 hover:text-foreground/80 hover:border-foreground/20 text-center transition-all active:scale-95 font-medium"
                    >
                      Details
                    </Link>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* B. BIG FEATURED PRODUCT (p1) - Grid Column details */}
          <div 
            className={`w-full flex flex-col md:grid md:grid-cols-12 gap-6 items-stretch ${
              p1Details.isSoldOut ? "opacity-60" : ""
            }`}
          >
            {/* Left side Image carousel (md:col-span-6) */}
            <div className="md:col-span-6 relative rounded-2xl overflow-hidden border border-foreground/[0.03] shadow-sm aspect-[3/5] bg-foreground/[0.02] group">
              {/* Badges */}
              <div className="absolute top-4 left-4 z-20 pointer-events-none">
                {p1Details.isSoldOut ? (
                  <div className="bg-black/50 border border-white/10 px-2.5 py-0.5 rounded-[4px] backdrop-blur-md">
                    <span className="text-[7.5px] font-bold uppercase tracking-widest text-white/95">Sold Out</span>
                  </div>
                ) : p1Details.isOnSale && (
                  <div className="bg-black/95 px-2.5 py-0.5 rounded-[4px] border border-white/5 shadow-md">
                    <span className="text-[7.5px] font-bold uppercase tracking-widest text-white">Sale</span>
                  </div>
                )}
              </div>

              <EditorialProductMedia
                images={p1.images || []}
                title={p1.title}
                isSoldOut={p1Details.isSoldOut}
                productSlug={p1Details.slug}
                priority={priority}
              />
            </div>

            {/* Right side Info Column (md:col-span-6) */}
            <div className="md:col-span-6 flex flex-col justify-between text-left py-1">
              <div>
                <p className="text-[7.5px] font-mono tracking-[0.35em] text-foreground/40 uppercase mb-2">
                  {p1.product_type || "FEATURED ITEM"}
                </p>

                {/* Title */}
                <Link href={`/products/${p1Details.slug}`} className="block group">
                  <h2 
                    className="text-lg md:text-2xl font-sans uppercase tracking-[0.14em] text-foreground/90 group-hover:text-foreground transition-colors leading-tight mb-2.5 font-light"
                    style={{ fontFamily: "var(--font-poppins), -apple-system, sans-serif" }}
                  >
                    {p1.title}
                  </h2>
                </Link>

                {/* Price */}
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-[11px] md:text-xs tracking-widest text-foreground/75 font-light">
                    {fmtPrice(parseFloat(p1Details.price)).formatted}
                  </span>
                  {p1Details.isOnSale && p1Details.compareAtPrice && (
                    <span className="text-[9px] md:text-[10px] tracking-widest text-foreground/25 line-through decoration-foreground/10">
                      {fmtPrice(parseFloat(p1Details.compareAtPrice)).formatted}
                    </span>
                  )}
                </div>

                {/* Description & Portrait Video Side-by-Side */}
                <div className="flex gap-4 items-start mb-6">
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-[10px] sm:text-xs text-foreground/50 font-light leading-relaxed tracking-wide mb-4">
                      {p1Details.description}
                    </p>

                    {/* Inline Size selection */}
                    {p1Sizes.length > 1 && !p1Details.isSoldOut && (
                      <div className="mb-1">
                        <span className={`text-[7.5px] font-mono tracking-[0.3em] text-foreground/35 uppercase block mb-2 ${
                          sizeError ? "text-red-500 font-semibold animate-pulse" : ""
                        }`}>
                          Select Size
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {p1Sizes.map((s) => {
                            const isOutOfStock = s.inventory <= 0;
                            return (
                              <button
                                key={s.size}
                                disabled={isOutOfStock}
                                onClick={() => setSelectedSize(s.size)}
                                className={`px-2.5 py-1.5 rounded-lg text-[8px] tracking-widest uppercase transition-all duration-200 ${
                                  selectedSize === s.size
                                    ? "bg-foreground text-background font-medium shadow-sm"
                                    : isOutOfStock
                                    ? "opacity-25 cursor-not-allowed border border-dashed border-foreground/10 text-foreground/25"
                                    : "border border-foreground/8 text-foreground/50 hover:border-foreground/20 hover:text-foreground/80"
                                }`}
                              >
                                {s.size}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Product Video box */}
                  {p1.video && (
                    <div 
                      className="relative w-20 sm:w-24 aspect-[9/16] rounded-xl overflow-hidden bg-foreground/[0.02] border border-foreground/[0.05] shadow-md flex-shrink-0 cursor-pointer"
                      onClick={() => setIsMuted(!isMuted)}
                    >
                      <video
                        src={p1.video}
                        autoPlay
                        loop
                        muted={isMuted}
                        playsInline
                        className="w-full h-full object-cover pointer-events-none"
                      />
                      {/* Audio indicator */}
                      <div className="absolute bottom-2.5 right-2.5 z-10 p-1.5 rounded-full bg-black/45 backdrop-blur-[2px]">
                        {isMuted ? (
                          <X className="w-2 h-2 text-white/50" />
                        ) : (
                          <div className="flex items-center gap-0.5 opacity-80">
                            <div className="w-[1.2px] h-1.5 bg-white animate-pulse" />
                            <div className="w-[1.2px] h-2.5 bg-white animate-pulse" style={{ animationDelay: '0.1s' }} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Add to Bag and Details links */}
              <div className="flex flex-col sm:flex-row gap-2.5 items-stretch w-full">
                {p1Details.isSoldOut ? (
                  <button
                    disabled
                    className="flex-1 py-2.5 px-4 rounded-xl bg-foreground/10 text-foreground/30 text-[9px] font-medium uppercase tracking-[0.25em] cursor-not-allowed text-center"
                  >
                    Sold Out
                  </button>
                ) : (
                  <button
                    onClick={handleAddFeatured}
                    disabled={isAdding || added}
                    className={`flex-1 py-2.5 px-4 rounded-xl text-[9px] uppercase tracking-[0.25em] transition-all duration-300 active:scale-[0.98] flex items-center justify-center gap-2 font-medium ${
                      added
                        ? "bg-black text-white dark:bg-white dark:text-black shadow-md"
                        : "bg-foreground text-background hover:opacity-90 shadow-sm"
                    }`}
                  >
                    {isAdding ? (
                      <div className="w-2.5 h-2.5 rounded-full border border-background/30 border-t-background/95 animate-spin" />
                    ) : added ? (
                      <><Check className="w-3.5 h-3.5" /> Added</>
                    ) : (
                      <><ShoppingBag className="w-3.5 h-3.5" /> Add to Bag</>
                    )}
                  </button>
                )}
                <Link
                  href={`/products/${p1Details.slug}`}
                  className="py-2.5 px-4 rounded-xl border border-foreground/[0.08] hover:border-foreground/20 text-[9px] uppercase tracking-[0.25em] text-foreground/50 hover:text-foreground/80 text-center transition-all duration-300 active:scale-[0.98] flex-1"
                >
                  Details
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* ──────────── SIDE COLUMN (p2 & p3 to the side) ──────────── */}
        {(p2 || p3) && (
          <div 
            className={`w-full lg:col-span-3 flex flex-col gap-6 ${
              isEven ? "lg:order-2" : "lg:order-1"
            }`}
          >
            {/* Desktop Side Listings Stack */}
            <div className="hidden lg:flex flex-col gap-6 justify-center h-full border-l border-foreground/[0.04] pl-6">
              <span className="text-[7.5px] font-mono tracking-[0.3em] text-foreground/35 uppercase text-left mb-1 block">Related Looks</span>
              {[p2, p3].map((prod) => {
                if (!prod) return null;
                const d = getProductDetails(prod);
                return (
                  <div 
                    key={prod.id} 
                    className={`group relative flex flex-col rounded-2xl overflow-hidden bg-foreground/[0.01] border border-foreground/[0.04] p-2 hover:bg-foreground/[0.02] hover:border-foreground/[0.08] transition-all hover:shadow-md ${
                      d.isSoldOut ? "opacity-60" : ""
                    }`}
                  >
                    {/* Small image container */}
                    <div className="relative aspect-[3/5] w-full rounded-xl overflow-hidden bg-foreground/[0.02] group">
                      <EditorialProductMedia
                        images={prod.images || []}
                        title={prod.title}
                        isSoldOut={d.isSoldOut}
                        productSlug={d.slug}
                      />
                      
                      {/* Floating quick add plus */}
                      {!d.isSoldOut && (
                        <button
                          onClick={() => setActiveModalProduct(prod)}
                          className="absolute bottom-2.5 right-2.5 w-6 h-6 rounded-lg bg-background/90 text-foreground flex items-center justify-center shadow-md active:scale-90 transition-all border border-foreground/5 opacity-0 group-hover:opacity-100 z-20"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {/* Minimal details */}
                    <div className="flex flex-col pt-2 pb-0.5 text-left leading-tight">
                      <p 
                        className="text-[8.5px] uppercase tracking-[0.15em] text-foreground/80 truncate group-hover:text-foreground font-light"
                        style={{ fontFamily: "var(--font-poppins), -apple-system, sans-serif" }}
                      >
                        {prod.title}
                      </p>
                      <span className="text-[8px] text-foreground/45 mt-0.5 font-light">
                        {fmtPrice(parseFloat(d.price)).formatted}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mobile Horizontal Layout stack */}
            <div className="lg:hidden grid grid-cols-2 gap-3 w-full">
              {[p2, p3].map((prod) => {
                if (!prod) return null;
                const d = getProductDetails(prod);
                return (
                  <div 
                    key={`mobile-sub-${prod.id}`}
                    className={`group relative flex flex-col rounded-xl overflow-hidden bg-foreground/[0.01] border border-foreground/[0.04] p-2 hover:bg-foreground/[0.02] transition-all hover:shadow-md ${
                      d.isSoldOut ? "opacity-60" : ""
                    }`}
                  >
                    <div className="relative aspect-[3/5] w-full rounded-lg overflow-hidden bg-foreground/[0.02] group">
                      <EditorialProductMedia
                        images={prod.images || []}
                        title={prod.title}
                        isSoldOut={d.isSoldOut}
                        productSlug={d.slug}
                      />
                      
                      {!d.isSoldOut && (
                        <button
                          onClick={() => setActiveModalProduct(prod)}
                          className="absolute bottom-2 right-2 w-5 h-5 rounded-md bg-background/90 text-foreground flex items-center justify-center shadow-md border border-foreground/5 z-20"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col pt-1.5 text-left leading-tight">
                      <p 
                        className="text-[8.5px] uppercase tracking-[0.14em] text-foreground/80 truncate font-light"
                        style={{ fontFamily: "var(--font-poppins), -apple-system, sans-serif" }}
                      >
                        {prod.title}
                      </p>
                      <span className="text-[7.5px] text-foreground/45 mt-0.5">
                        {fmtPrice(parseFloat(d.price)).formatted}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* ── Quick Add Modal for p2, p3, p4 ── */}
      {activeModalProduct && (
        <QuickAddModal 
          product={activeModalProduct} 
          onClose={() => setActiveModalProduct(null)} 
        />
      )}
    </>
  );
}
