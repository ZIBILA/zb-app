"use client";

import { useState } from "react";
import { ShoppingBag, Loader2, Check, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCart } from "@/lib/cart-context";
import { snapTrackAddToCart } from "@/hooks/useSnapEvents";
import { useMetaEvents } from "@/hooks/useMetaEvents";
import { ShopifyProduct } from "@/lib/shopify-admin";

interface Props {
  products: ShopifyProduct[];
  collectionName: string;
}

export default function CompleteCollectionButton({ products, collectionName }: Props) {
  const { add: addToCart } = useCart();
  const { trackAddToCart: trackMetaAddToCart } = useMetaEvents();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "partial">("idle");
  const [progress, setProgress] = useState(0);

  const handleCompleteCollection = async () => {
    if (status !== "idle") return;
    
    // Filter products that have at least one variant in stock
    const availableProducts = products.filter(p => 
      p.variants?.some(v => (v.inventory_quantity || 0) > 0)
    );

    if (availableProducts.length === 0) {
      alert("All items in this collection are currently sold out.");
      return;
    }

    setStatus("loading");
    setProgress(0);

    // Sequence the additions for a premium feel
    for (let i = 0; i < availableProducts.length; i++) {
      const product = availableProducts[i];
      const variant = product.variants?.find(v => (v.inventory_quantity || 0) > 0) || product.variants?.[0];
      
      if (variant) {
        addToCart({
          productId: product.id.toString(),
          handle: product.handle,
          variantId: variant.id.toString(),
          title: product.title,
          size: variant.option1 === "Default Title" ? null : variant.option1,
          price: variant.price,
          image: product.image?.src || product.images?.[0]?.src || "/zb-logo-220px.png",
          category: product.product_type
        });
        // Snap ADD_CART (one per genuine add; selected variant id = feed.xml g:id)
        snapTrackAddToCart(variant.id.toString(), product.title, parseFloat(variant.price || "0"), 'INR', product.product_type);
        // Meta AddToCart (same genuine add; selected variant id = feed.xml g:id)
        trackMetaAddToCart(variant.id.toString(), product.title, parseFloat(variant.price || "0"), 'INR', product.product_type);
      }
      
      // Update progress
      setProgress(((i + 1) / availableProducts.length) * 100);
      
      // Tiny delay for visual effect
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    setStatus(availableProducts.length < products.length ? "partial" : "success");
    
    // Reset after success
    setTimeout(() => {
      setStatus("idle");
      setProgress(0);
    }, 3000);
  };

  return (
    <div className="w-full mb-8">
      <button
        onClick={handleCompleteCollection}
        disabled={status !== "idle"}
        className="relative w-full py-4 rounded-[1.2rem] overflow-hidden group transition-all active:scale-[0.98] shadow-lg"
        style={{
          background: "hsl(var(--foreground))",
          boxShadow: "0 12px 40px -12px hsl(var(--foreground) / 0.4)"
        }}
      >
        {/* Progress Fill Overlay */}
        <motion.div 
          className="absolute inset-0 bg-white/10 z-0 origin-left"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: progress / 100 }}
          transition={{ duration: 0.3 }}
        />

        <div className="relative z-10 flex items-center justify-center gap-3">
          <AnimatePresence mode="wait">
            {status === "loading" ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-2"
              >
                <Loader2 className="w-4 h-4 animate-spin text-background" />
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-background">
                  Assembling {Math.round(progress)}%
                </span>
              </motion.div>
            ) : status === "success" || status === "partial" ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-2"
              >
                <Check className="w-4 h-4 text-background" />
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-background">
                  {status === "success" ? "Collection Added" : "Items Added"}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-3"
              >
                <div className="relative">
                  <ShoppingBag className="w-4 h-4 text-background" />
                  <Plus className="absolute -top-1 -right-1 w-2.5 h-2.5 text-background" strokeWidth={3} />
                </div>
                <div className="flex flex-col items-start leading-none">
                  <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-background">
                    Complete Collection
                  </span>
                  <span className="text-[7px] font-medium uppercase tracking-[0.1em] text-background/40 mt-1">
                    Add all available pieces to bag
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Gloss edge effect */}
        <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent pointer-events-none" />
      </button>
      
      {/* Disclaimer for partial stock */}
      {status === "partial" && (
        <motion.p 
          initial={{ opacity: 0, y: -5 }} 
          animate={{ opacity: 1, y: 0 }}
          className="text-[8px] text-center text-foreground/30 uppercase tracking-widest mt-2"
        >
          Some pieces were out of stock and skipped
        </motion.p>
      )}
    </div>
  );
}
