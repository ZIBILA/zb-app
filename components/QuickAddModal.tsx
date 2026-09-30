"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { X, ShoppingBag, Check } from "lucide-react";
import { useCart } from "@/lib/cart-context";
import { ShopifyProduct } from "@/lib/shopify-admin";
import { createPortal } from "react-dom";
import { handleImageError } from "./ImagePlaceholder";
import { toast } from "sonner";
import { useMetaEvents } from "@/hooks/useMetaEvents";
import { useSnapEvents } from "@/hooks/useSnapEvents";
import { useOpenAiEvents } from "@/hooks/useOpenAiEvents";
import { useCountry } from "@/lib/country-context";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";

interface Props {
  product: ShopifyProduct;
  initialSize?: string;
  onClose: () => void;
}

export default function QuickAddModal({ product, initialSize, onClose }: Props) {
  const { formatPrice: fmtPrice } = useCountry();
  const { add } = useCart();
  const { trackAddToCart } = useMetaEvents();
  const { trackAddToCart: trackSnapAddToCart } = useSnapEvents();
  const { trackItemsAdded: trackOaiItemsAdded } = useOpenAiEvents();
  const [selectedSize, setSelectedSize] = useState<string | null>(initialSize || null);
  const [added, setAdded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sizeError, setSizeError] = useState(false);

  // Mount guard — ensures createPortal only runs client-side
  useEffect(() => { setMounted(true); }, []);

  const sizes = product.variants
    ?.map((v) => ({ size: v.option1 ?? "One Size", variantId: String(v.id) }))
    .filter((v, i, a) => a.findIndex((x) => x.size === v.size) === i) || [];

  const price = product.variants?.[0]?.price || "0";
  const image = product.images?.[0]?.src || "/zb-logo-220px.png";

  // Auto-select if single size
  useEffect(() => {
    if (sizes.length === 1) setSelectedSize(sizes[0].size);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes.length]);

  // Hide bottom toolbar when modal is open
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("quickadd:open"));
    return () => {
      window.dispatchEvent(new CustomEvent("quickadd:close"));
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    lockScroll();
    return () => { unlockScroll(); };
  }, []);

  const handleAdd = () => {
    if (sizes.length > 1 && !selectedSize) {
      setSizeError(true);
      toast.error("Please select a size first");
      setTimeout(() => setSizeError(false), 1500);
      return;
    }
    const variant = sizes.find((s) => s.size === (selectedSize ?? sizes[0]?.size));
    const productVariant = product.variants?.find(v => String(v.id) === variant?.variantId);
    
    if (!productVariant) {
      toast.error("This product is currently unavailable");
      return;
    }

    if ((productVariant.inventory_quantity || 0) <= 0) {
      toast.error("This size is currently sold out");
      return;
    }

    const variantId = variant?.variantId ?? String(product.variants?.[0]?.id);
    const itemPrice = parseFloat(productVariant.price || price || "0");

    add({
      productId: String(product.id),
      variantId,
      title: product.title,
      size: selectedSize,
      handle: product.handle,
      price,
      image,
      category: product.product_type,
    });
    
    trackAddToCart(variantId, product.title, itemPrice, 'INR', product.product_type);
    trackSnapAddToCart(variantId, product.title, itemPrice, 'INR', product.product_type);
    trackOaiItemsAdded(variantId, product.title, itemPrice, 'INR', product.product_type);

    setAdded(true);
    toast.success(`${product.title} added to bag`);
    setTimeout(() => { setAdded(false); onClose(); }, 900);
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 flex items-end justify-center"
      style={{
        zIndex: 9999,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
      onClick={handleBackdrop}
    >
      <div
        className="w-full max-w-md rounded-t-[1.75rem] overflow-hidden flex flex-col font-sans"
        style={{
          background: "hsla(var(--glass-bg), 0.80)",
          backdropFilter: "blur(48px) saturate(200%)",
          WebkitBackdropFilter: "blur(48px) saturate(200%)",
          border: "1px solid hsla(var(--glass-border), 0.10)",
          borderBottom: "none",
          boxShadow: "0 -24px 80px -12px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-8 h-1 rounded-full bg-foreground/15" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-2 pb-4">
          <div className="relative w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0 bg-foreground/[0.03]">
            <Image src={image} alt={product.title} fill sizes="80px" onError={handleImageError} className="object-cover" style={image === "/zb-logo-220px.png" ? { objectFit: "contain", padding: "25%", opacity: 0.3 } : {}}/>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-extralight uppercase tracking-[0.22em] text-foreground/80 line-clamp-2 leading-relaxed">
              {product.title}
            </p>
            <p className="text-[9px] font-normal text-foreground/50 tracking-widest mt-0.5">
              {fmtPrice(parseFloat(price)).formatted}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-foreground/30 hover:text-foreground transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Size Selection */}
        {sizes.length > 1 && (
          <div className="px-5 mb-4">
            <p className="text-[7px] font-light uppercase tracking-[0.45em] text-foreground/35 mb-3">
              Select Size
            </p>
            {/* 6 equal-width columns */}
            <div className={`grid grid-cols-6 gap-1.5 ${sizeError ? "animate-[shake_0.3s_ease-in-out]" : ""}`}>
              {sizes.map(({ size, variantId }) => {
                const variant = product.variants?.find(v => String(v.id) === variantId);
                const isOutOfStock = (variant?.inventory_quantity || 0) <= 0;
                
                return (
                  <button
                    key={size}
                    onClick={() => setSelectedSize(size)}
                    className={`h-9 w-full flex items-center justify-center rounded-lg text-[8px] font-light uppercase tracking-wider transition-all relative overflow-hidden ${
                      selectedSize === size
                        ? "bg-foreground text-background"
                        : isOutOfStock
                        ? "bg-foreground/[0.01] border border-foreground/[0.04] text-foreground/15 cursor-not-allowed"
                        : "border border-foreground/[0.08] text-foreground/40 hover:border-foreground/20 hover:text-foreground/70"
                    }`}
                  >
                    {size}
                    {isOutOfStock && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-[120%] h-[1px] bg-foreground/10 rotate-[35deg] transform-gpu" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Add Button */}
        <div className="px-5 pb-10">
          {(() => {
            const isAllVariantsSoldOut = product.variants ? !product.variants.some(v => (v.inventory_quantity || 0) > 0) : true;
            
            return (
              <button
                onClick={handleAdd}
                disabled={added || isAllVariantsSoldOut}
                className={`w-full py-3.5 rounded-2xl text-[9px] font-light uppercase tracking-[0.4em] transition-all duration-300 active:scale-[0.98] flex items-center justify-center gap-2 ${
                  added
                    ? "bg-foreground text-background border border-foreground/20"
                    : isAllVariantsSoldOut
                      ? "bg-foreground/10 text-foreground/30 cursor-not-allowed"
                      : "bg-foreground text-background hover:opacity-90"
                }`}
              >
                {added ? (
                  <><Check className="w-3.5 h-3.5" /> Added</>
                ) : isAllVariantsSoldOut ? (
                  "Sold Out"
                ) : (
                  <><ShoppingBag className="w-3.5 h-3.5" /> Add to Bag</>
                )}
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
