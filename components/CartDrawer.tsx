"use client";

import { useState, useEffect } from "react";
import { X, Minus, Plus, ShoppingBag, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useCart } from "@/lib/cart-context";
import { expandCartUnits } from "@/lib/cart-units";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useCountry } from "@/lib/country-context";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";

const CheckoutWebView = dynamic(() => import("./CheckoutWebView"), { ssr: false });
const OrderSuccess = dynamic(() => import("./OrderSuccess"), { ssr: false });

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CartDrawer({ isOpen, onClose }: CartDrawerProps) {
  const { formatPrice: fmtPrice } = useCountry();
  const router = useRouter();
  const { items, count, subtotal, update, clear } = useCart();
  // One row per unit: the same product + size added twice shows as two rows, never "QTY: 2".
  const unitRows = expandCartUnits(items);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isOpen]);

  const handleCheckout = () => {
    if (items.length === 0) return;
    onClose();
    router.push("/checkout");
  };

  const handleOrderSuccess = () => {
    setCheckoutUrl(null);
    setShowSuccess(true);
  };

  const handleSuccessContinue = () => {
    setShowSuccess(false);
    clear();
    onClose();
  };

  const handleWebViewClose = () => {
    // Cart remains intact — user just dismissed checkout
    setCheckoutUrl(null);
  };

  return (
    <>
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

            {/* Drawer */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-3 right-3 bottom-3 z-[120] w-[90%] max-w-sm flex flex-col rounded-[1.5rem] overflow-hidden font-sans bg-white/70 dark:bg-black/75 backdrop-blur-3xl border border-black/5 dark:border-white/10 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)] transition-colors duration-500"
            >
              {/* Header */}
              <div className="flex justify-between items-center px-6 py-5 border-b border-foreground/[0.06]">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-foreground/60" />
                  <h2 className="text-[11px] font-rocaston uppercase tracking-[0.05em] mt-0.5 whitespace-nowrap text-foreground/80">
                    ZICA BELLA
                  </h2>
                  {count > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground/50 font-medium ml-1">
                      {count}
                    </span>
                  )}
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close cart drawer"
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-foreground/[0.06] transition-colors active:scale-90"
                >
                  <X className="w-4 h-4 text-foreground/50" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-6 py-4 hide-scrollbar">
                {items.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center py-16">
                    <ShoppingBag className="w-10 h-10 text-foreground/[0.08] mb-4" />
                    <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-foreground/25 mb-6">
                      Your bag is empty
                    </p>
                    <button
                      onClick={onClose}
                      className="text-[9px] uppercase tracking-widest text-foreground/35 hover:text-foreground/70 transition-colors border-b border-foreground/10 pb-[1px]"
                    >
                      Start Shopping
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <AnimatePresence>
                      {unitRows.map((item) => (
                        <motion.div
                          key={item.unitKey}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -20, scale: 0.95 }}
                          transition={{ duration: 0.22 }}
                          className="flex gap-3.5 p-3 rounded-2xl bg-black/[0.02] dark:bg-white/[0.04] border border-black/5 dark:border-white/5 transition-colors duration-500"
                        >
                          <Link href={`/products/${item.handle}`} onClick={onClose} className="shrink-0">
                            <div className="relative w-[68px] h-[84px] rounded-xl overflow-hidden shadow-sm">
                              <Image src={item.image} alt={item.title} fill sizes="80px" className="object-cover" />
                            </div>
                          </Link>
                          <div className="flex-1 min-w-0 flex flex-col py-0.5">
                            <p className="text-[9.5px] font-semibold uppercase tracking-tight text-foreground/80 line-clamp-2 leading-snug mb-1">
                              {item.title}
                            </p>
                            {item.size && (
                              <p className="text-[8px] font-medium text-foreground/35 mb-1.5 uppercase tracking-wide">
                                Size: {item.size}
                              </p>
                            )}
                            <div className="mt-auto flex justify-between items-center">
                              <p className="text-[11px] font-normal tracking-tight text-foreground/70">
                                {fmtPrice(parseFloat(item.price)).formatted}
                              </p>
                              <div
                                className="flex items-center gap-1 rounded-lg px-1.5 py-1 bg-black/[0.03] dark:bg-white/[0.05] border border-black/5 dark:border-white/10 transition-colors duration-500"
                              >
                                <button
                                  onClick={() => update(item.lineId, item.lineQuantity - 1)}
                                  aria-label="Remove this item"
                                  className="w-5 h-5 flex items-center justify-center text-foreground/40 hover:text-foreground transition-colors active:scale-90"
                                >
                                  <Minus className="w-2.5 h-2.5" />
                                </button>
                                <span className="text-[10px] font-bold min-w-[18px] text-center text-foreground/70">
                                  1
                                </span>
                                <button
                                  onClick={() => update(item.lineId, item.lineQuantity + 1)}
                                  aria-label="Add another"
                                  className="w-5 h-5 flex items-center justify-center text-foreground/40 hover:text-foreground transition-colors active:scale-90"
                                >
                                  <Plus className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>

              {/* Footer */}
              {items.length > 0 && (
                <div
                  className="px-6 py-5 border-t border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/40 backdrop-blur-xl transition-colors duration-500"
                >
                  {/* Subtotal */}
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-[9px] font-medium uppercase tracking-[0.25em] text-foreground/35">
                      Estimated Total
                    </span>
                    <span className="text-[15px] font-normal tracking-tight text-foreground/80">
                      {fmtPrice(subtotal).formatted}
                    </span>
                  </div>

                  {/* Error */}
                  {checkoutError && (
                    <div className="mb-3 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
                      <p className="text-[8px] text-red-400/80 text-center leading-relaxed">{checkoutError}</p>
                    </div>
                  )}

                  {/* Checkout Button */}
                  <button
                    onClick={handleCheckout}
                    disabled={isCheckingOut}
                    className="w-full py-4 rounded-2xl text-[9px] font-bold uppercase tracking-[0.4em] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                    style={{
                      background: "hsl(var(--foreground))",
                      color: "hsl(var(--background))",
                      boxShadow: "0 8px 32px -8px hsl(var(--foreground) / 0.35)",
                    }}
                  >
                    {isCheckingOut ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Preparing…
                      </>
                    ) : (
                      "Checkout"
                    )}
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* In-App Checkout WebView */}
      {checkoutUrl && (
        <CheckoutWebView
          checkoutUrl={checkoutUrl}
          onSuccess={handleOrderSuccess}
          onClose={handleWebViewClose}
        />
      )}

      {/* Order Success Screen */}
      <AnimatePresence>
        {showSuccess && <OrderSuccess onContinue={handleSuccessContinue} />}
      </AnimatePresence>
    </>
  );
}
