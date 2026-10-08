"use client";

import { useState, useEffect } from "react";
import { Bookmark, ShoppingBag, Trash2 } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useBookmarks } from "@/lib/bookmark-context";
import { useCart } from "@/lib/cart-context";
import { snapTrackAddToCart } from "@/hooks/useSnapEvents";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { useCountry } from "@/lib/country-context";

const QuickAddModal = dynamic(() => import("@/components/QuickAddModal"), { ssr: false });

export default function WishlistPage() {
  const { formatPrice: fmtPrice } = useCountry();
  const { bookmarks, removeBookmark } = useBookmarks();
  const { add: addToCart } = useCart();
  const [isLoaded, setIsLoaded] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  const handleQuickAdd = (product: any) => {
    const variants = product.variants || [];
    
    // If the product in the wishlist already has a selected variant/size, use it directly!
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
        toast.success(`${product.title} added to bag`);
        return;
      }
    }

    if (variants.length <= 1) {
      const variant = variants[0];
      if (!variant) {
        toast.error("This product is currently unavailable");
        return;
      }

      addToCart({
        productId: product.id.toString(),
        handle: product.handle,
        variantId: variant.id.toString(),
        title: product.title,
        size: variant.option1 === "Default Title" ? null : (variant.option1 || null),
        price: variant.price,
        image: product.image?.src || product.images?.[0]?.src || "/zb-logo-220px.png"
      });
      // Snap ADD_CART (one per genuine add; selected variant id = feed.xml g:id)
      snapTrackAddToCart(variant.id.toString(), product.title, parseFloat(variant.price || "0"), 'INR', product.product_type);

      toast.success(`${product.title} added to bag`);
    } else {
      setSelectedProduct(product);
    }
  };

  const handleRemove = (product: any) => {
    removeBookmark(product.id.toString());
    toast.success(`${product.title} removed from bookmarks`);
  };

  if (!isLoaded) {
    return (
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 min-h-[80vh] pb-32">
        {/* Page Header */}
        <div className="mb-12 text-center">
          <p className="text-[8px] font-bold uppercase tracking-[0.5em] text-foreground/40 mb-3">Saved Pieces</p>
          <h1 className="font-heading text-[22px] uppercase tracking-[0.1em] text-foreground/90">Your Bookmarks</h1>
          <div className="w-8 h-[1px] bg-foreground/10 mx-auto mt-4" />
        </div>

        {/* Loading skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {[1, 2, 3].map((n) => (
            <div key={n} className="animate-pulse flex gap-5 p-4 rounded-[2rem] border border-foreground/5 bg-foreground/[0.01]">
              <div className="w-28 h-36 rounded-2xl bg-foreground/[0.04]" />
              <div className="flex-1 flex flex-col justify-between py-1">
                <div>
                  <div className="h-4 bg-foreground/[0.04] w-2/3 rounded-md mb-2" />
                  <div className="h-4 bg-foreground/[0.04] w-1/3 rounded-md" />
                </div>
                <div className="flex gap-2 mt-4">
                  <div className="flex-1 h-10 bg-foreground/[0.04] rounded-xl" />
                  <div className="w-10 h-10 bg-foreground/[0.04] rounded-xl" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 min-h-[80vh] pb-32">
        {/* Page Header */}
        <div className="mb-12 text-center">
          <p className="text-[8px] font-bold uppercase tracking-[0.5em] text-foreground/40 mb-3">Saved Pieces</p>
          <h1 className="font-heading text-[22px] uppercase tracking-[0.1em] text-foreground/90">Your Bookmarks</h1>
          <div className="w-8 h-[1px] bg-foreground/10 mx-auto mt-4" />
        </div>

        {bookmarks.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20">
            <div className="w-16 h-16 rounded-[2rem] bg-foreground/5 flex items-center justify-center mb-6 border border-foreground/5">
              <Bookmark className="w-6 h-6 text-foreground/30" />
            </div>
            <p className="text-[10px] text-foreground/30 uppercase tracking-widest leading-relaxed max-w-[240px] mb-10">
              Your collection of saved luxury pieces is currently empty.
            </p>
            <Link 
              href="/" 
              className="px-10 py-4 bg-foreground text-background text-[9px] uppercase font-bold tracking-[0.3em] rounded-full hover:opacity-90 transition-all shadow-xl active:scale-95 animate-touch"
            >
              Explore Collection
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            <AnimatePresence>
              {bookmarks.map((product) => {
                const imageSrc = product.image?.src || product.images?.[0]?.src || (product as any).featuredImage || "/zb-logo-220px.png";
                const price = parseFloat(product.variants?.[0]?.price || (product as any).price || "0").toLocaleString("en-IN");
                return (
                  <motion.div 
                    key={product.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className="group relative flex gap-5 p-4 rounded-[2rem] glass-panel border-foreground/5 bg-foreground/[0.01] hover:bg-foreground/[0.02] hover:border-foreground/15 shadow-sm hover:shadow-[0_12px_25px_rgba(0,0,0,0.03)] dark:hover:shadow-[0_12px_25px_rgba(0,0,0,0.35)] transition-all duration-500"
                  >
                    <Link href={`/products/${product.handle}`} className="shrink-0">
                      <div className="relative w-28 h-36 rounded-2xl overflow-hidden border border-foreground/5 shadow-md bg-foreground/[0.01]">
                        <Image 
                          src={imageSrc} 
                          alt={product.title} 
                          fill 
                          className="object-cover transition-transform duration-700 group-hover:scale-105" 
                        />
                      </div>
                    </Link>
   
                    <div className="flex-1 flex flex-col justify-between py-1">
                      <div>
                        <h3 className="text-[12px] font-bold uppercase tracking-wider text-foreground/90 mb-1 line-clamp-1">
                          {product.title}
                        </h3>
                        <p className="text-[13px] font-semibold tracking-tight text-foreground/55">
                          {fmtPrice(parseFloat(price) || 0).formatted}
                        </p>
                      </div>
   
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleQuickAdd(product)}
                          className="flex-1 py-3.5 rounded-xl bg-foreground text-background text-[9px] font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-2 shadow-md hover:brightness-95 active:scale-95 transition-all duration-300"
                        >
                          <ShoppingBag className="w-3.5 h-3.5" />
                          Add to Bag
                        </button>
                        <button 
                          onClick={() => handleRemove(product)}
                          className="p-3.5 rounded-xl bg-foreground/5 border border-foreground/5 text-foreground/45 hover:text-foreground hover:bg-foreground/10 transition-all duration-300 active:scale-90"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
      {selectedProduct && (
        <QuickAddModal 
          product={selectedProduct} 
          initialSize={selectedProduct.selectedSize || undefined}
          onClose={() => setSelectedProduct(null)} 
        />
      )}
    </>
  );
}
