"use client";

import { X, Bookmark, Trash2, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useBookmarks } from "@/lib/bookmark-context";
import { useCart } from "@/lib/cart-context";
import { snapTrackAddToCart } from "@/hooks/useSnapEvents";
import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { handleImageError } from "./ImagePlaceholder";
import { useCountry } from "@/lib/country-context";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";

const QuickAddModal = dynamic(() => import("./QuickAddModal"), { ssr: false });

interface BookmarkDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BookmarkDrawer({ isOpen, onClose }: BookmarkDrawerProps) {
  const { formatPrice: fmtPrice } = useCountry();
  const { bookmarks, removeBookmark } = useBookmarks();
  const { add: addToCart } = useCart();
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  useEffect(() => {
    if (isOpen) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isOpen]);

  const handleQuickAdd = (product: any) => {
    const variants = product.variants || [];
    
    if (product.selectedVariantId) {
      const variant = variants.find((v: any) => v.id.toString() === product.selectedVariantId.toString());
      if (variant) {
        addToCart({
          productId: product.id.toString(),
          handle: product.handle,
          variantId: variant.id.toString(),
          title: product.title,
          size: product.selectedSize || (variant.option1 === "Default Title" ? null : (variant.option1 || null)),
          price: variant.price,
          image: product.image?.src || product.images?.[0]?.src || "/zb-logo-220px.png"
        });
        // Snap ADD_CART (one per genuine add; selected variant id = feed.xml g:id)
        snapTrackAddToCart(variant.id.toString(), product.title, parseFloat(variant.price || "0"), 'INR', product.product_type);
        return;
      }
    }
    setSelectedProduct(product);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm"
          />

          {/* Drawer - Top to Bottom */}
          <motion.div
            initial={{ y: "-100%" }}
            animate={{ y: 0 }}
            exit={{ y: "-100%" }}
            transition={{ 
              type: "spring", 
              damping: 32, 
              stiffness: 280,
              mass: 1,
              restDelta: 0.001
            }}
            className="fixed top-0 left-0 right-0 z-[120] max-h-[85vh] flex flex-col rounded-b-[1.5rem] overflow-hidden border-b border-foreground/[0.06] font-sans"
            style={{ background: "hsla(var(--glass-bg), 0.75)", backdropFilter: "blur(40px) saturate(180%)", WebkitBackdropFilter: "blur(40px) saturate(180%)", boxShadow: "0 20px 60px -12px rgba(0,0,0,0.15)" }}
          >
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-foreground/5">
              <div className="flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-primary" />
                <h2 className="text-[11px] font-rocaston uppercase tracking-[0.15em] mt-0.5">ZICA BOOKMARKS</h2>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-foreground/10 text-foreground/50 font-medium ml-1">
                  {bookmarks.length}
                </span>
              </div>
              <button 
                onClick={onClose}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-foreground/5 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-foreground/60" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 pt-4 hide-scrollbar">
              {bookmarks.length === 0 ? (
                <div className="py-20 flex flex-col items-center justify-center text-center">
                  <Bookmark className="w-12 h-12 text-foreground/5 mb-4" />
                  <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/30">No bookmarks yet</p>
                  <button onClick={onClose} className="mt-6 text-[8px] uppercase tracking-widest text-foreground/50 hover:text-foreground border-b border-foreground/10 pb-1">
                    Keep Browsing
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {bookmarks.map((product) => (
                    <div
                      key={product.id}
                      className="flex gap-4 p-3 rounded-2xl group relative"
                      style={{ background: "hsla(var(--glass-bg), 0.45)", border: "1px solid hsla(var(--glass-border), 0.08)" }}
                    >
                      <Link href={`/products/${product.handle}`} onClick={onClose} className="shrink-0">
                        <div className="relative w-20 h-24 rounded-xl overflow-hidden shadow-sm">
                          <Image 
                            src={product.image?.src || product.images?.[0]?.src || "/zb-logo-220px.png"} 
                            alt={product.title} 
                            fill 
                            className="object-cover group-hover:scale-105 transition-transform duration-500" 
                            onError={handleImageError}
                          />
                        </div>
                      </Link>
                      <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-tight text-foreground/80 line-clamp-1 mb-1">
                            {product.title}
                          </p>
                          <p className="text-[11px] font-normal tracking-tight text-foreground/60">
                            {fmtPrice(parseFloat(product.variants[0].price)).formatted}
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-2 mt-2">
                          <button 
                            onClick={() => handleQuickAdd(product)}
                            className="flex-1 py-2 rounded-lg bg-foreground/[0.05] hover:bg-foreground/10 text-[8px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
                          >
                            <ShoppingBag className="w-3 h-3" />
                            Add
                          </button>
                          <button 
                            onClick={() => removeBookmark(product.id.toString())}
                            className="p-2 rounded-lg text-foreground/20 hover:text-rose-400 hover:bg-rose-400/5 transition-all"
                            aria-label="Remove"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {bookmarks.length > 0 && (
              <div className="p-6 pt-2 border-t border-foreground/5 bg-foreground/[0.01]">
                <Link 
                  href="/wishlist" 
                  onClick={onClose}
                  className="w-full py-4 rounded-xl border border-foreground/10 text-foreground/60 text-[9px] font-bold uppercase tracking-[0.2em] flex items-center justify-center hover:bg-foreground/5 transition-all"
                >
                  View All Bookmarks
                </Link>
              </div>
            )}
          </motion.div>
        </>
      )}
      
      {selectedProduct && (
        <QuickAddModal 
          product={selectedProduct} 
          initialSize={selectedProduct.selectedSize || undefined}
          onClose={() => setSelectedProduct(null)} 
        />
      )}
    </AnimatePresence>
  );
}
