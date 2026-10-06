"use client";

import { X, User, Package, Info, Users, BookOpen, Handshake, ChevronRight, Search, RotateCcw, Globe, ChevronDown, ChevronUp, Check } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useCountry } from "@/lib/country-context";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";
import { fetchMenuCollections } from "@/lib/storefront-fetch";

interface MenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShopifyCollection {
  id: string | number;
  title: string;
  handle: string;
}

const FALLBACK_COLLECTIONS: ShopifyCollection[] = [
  { id: "accessories",  title: "Accessories",  handle: "accessories" },
  { id: "acid-tees",    title: "Acid Tees",    handle: "acid-tees" },
  { id: "leather-room", title: "Leather Room", handle: "leather-room" },
  { id: "rogue-winter", title: "Rogue Winter", handle: "rogue-winter" },
  { id: "drip-denim",   title: "Drip Denim",   handle: "drip-denim" },
  { id: "jortsy",       title: "Jortsy",        handle: "jortsy" },
  { id: "vexee-shirts", title: "Vexee Shirts", handle: "vexee-shirts" },
  { id: "all-drips",    title: "All Drips",    handle: "all-drips" },
];

const PRIMARY_NAV = [
  { title: "Search Store",   url: "/search",      icon: Search },
  { title: "Collaborations", url: "/collaborations", icon: Handshake },
  { title: "Blogs",          url: "/blogs",       icon: BookOpen },
  { title: "FAQ",            url: "/faq",         icon: Info },
  { title: "Community",      url: "/community",   icon: Users },
];

const SHOP_TERMS = ["T-shirt", "Jeans", "Pants", "Trousers", "Jorts", "Shirts"];

export default function MenuDrawer({ isOpen, onClose }: MenuDrawerProps) {
  const { countryCode, setCountry, activeCountries, globalStoreEnabled } = useCountry();
  const [countryOpen, setCountryOpen] = useState(false);
  const [collections, setCollections] = useState<ShopifyCollection[]>(FALLBACK_COLLECTIONS);
  const [loading, setLoading] = useState(true);
  const { data: session } = useSession();
  const profileImage = session?.user?.image || (session as any)?.customer?.image;

  const menuFetchedRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || menuFetchedRef.current) return;
    menuFetchedRef.current = true;
    setLoading(true);
    fetchMenuCollections()
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setCollections(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen]);

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm"
          />

          {/* Minimalist Full Height Edge Drawer */}
          <motion.div
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "-100%", opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 240, mass: 0.8 }}
            className="fixed inset-y-0 left-0 w-[290px] h-[100dvh] z-[100] flex flex-col rounded-r-[1.5rem] bg-background/95 dark:bg-black/95 backdrop-blur-3xl border-r border-foreground/10 shadow-2xl overflow-hidden pointer-events-auto"
          >
            {/* Top Close Bar */}
            <div className="flex items-center justify-between px-6 pt-8 pb-3 flex-shrink-0 z-10">
              <span className="text-[9px] tracking-[0.4em] uppercase text-foreground/40 font-bold font-rocaston">
                ZICA BELLA
              </span>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-foreground/[0.04] hover:bg-foreground/[0.08] transition-all active:scale-90"
                aria-label="Close menu"
              >
                <X className="w-4 h-4 text-foreground/45" strokeWidth={1.5} />
              </button>
            </div>

            {/* Scrollable Container (Everything fits here) */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 custom-scrollbar z-10 min-h-0">
              <div className="space-y-6">
                
                {/* ─── Collections ─── */}
                <div className="flex flex-col">
                  <p className="text-[7px] tracking-[0.3em] uppercase text-foreground/30 mb-3.5 font-bold">Collections</p>
                  <div className="flex flex-col gap-3">
                    {loading
                      ? [1, 2, 3, 4].map(i => (
                          <div key={i} className="h-3 w-4/5 bg-foreground/[0.04] rounded-md animate-pulse" />
                        ))
                      : collections.slice(0, 8).map((c) => (
                          <Link
                            key={c.id}
                            href={`/collections/${c.handle}`}
                            onClick={onClose}
                            className="group flex items-center justify-between transition-transform duration-300 hover:translate-x-1"
                          >
                            <span className="text-[11px] text-foreground/60 group-hover:text-foreground font-semibold uppercase tracking-[0.1em]">
                              {c.title}
                            </span>
                            <ChevronRight className="w-3 h-3 text-foreground/0 group-hover:text-foreground/40 transition-all duration-300" strokeWidth={1.5} />
                          </Link>
                        ))}
                  </div>
                </div>

                {/* ─── Shop Items (Tags) ─── */}
                <div className="flex flex-col">
                  <p className="text-[7px] tracking-[0.3em] uppercase text-foreground/30 mb-3.5 font-bold">Shop</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SHOP_TERMS.map((term) => (
                      <Link 
                        key={term} 
                        href={`/search?q=${term}`} 
                        onClick={onClose} 
                        className="px-2.5 py-1.5 rounded-lg border border-foreground/5 hover:border-foreground/15 bg-foreground/[0.02] text-[9.5px] text-foreground/50 hover:text-foreground font-bold tracking-[0.05em] uppercase transition-all"
                      >
                        {term}
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="h-[1px] bg-foreground/5" />

                {/* ─── Secondary Nav ─── */}
                <nav className="flex flex-col gap-2.5">
                  {PRIMARY_NAV.map(({ title, url, icon: Icon }) => (
                    <Link
                      key={title}
                      href={url}
                      onClick={onClose}
                      className="group flex items-center justify-between py-1 transition-transform duration-300 hover:translate-x-1"
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="w-3.5 h-3.5 text-foreground/30 group-hover:text-foreground/60 transition-colors" strokeWidth={1.5} />
                        <span className="text-[11px] font-bold text-foreground/50 group-hover:text-foreground transition-colors uppercase tracking-[0.08em]">
                          {title}
                        </span>
                      </div>
                      <ChevronRight className="w-3 h-3 text-foreground/0 group-hover:text-foreground/40 transition-all duration-300" strokeWidth={1.5} />
                    </Link>
                  ))}
                </nav>

                {/* ─── Country Selector (Ship To) ─── */}
                {globalStoreEnabled && activeCountries.length > 0 && (
                  <div className="pt-1">
                    <div className="h-[1px] bg-foreground/5 mb-3.5" />
                    
                    {/* Compact Collapsible Header */}
                    <button
                      type="button"
                      onClick={() => setCountryOpen(!countryOpen)}
                      className="w-full group flex items-center justify-between py-2 px-3 rounded-2xl bg-foreground/[0.03] dark:bg-white/[0.04] border border-foreground/[0.06] dark:border-white/[0.08] hover:border-foreground/15 transition-all text-left"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Globe className="w-3.5 h-3.5 text-foreground/40 shrink-0" strokeWidth={1.5} />
                        <span className="text-[10px] font-bold text-foreground/50 group-hover:text-foreground transition-colors uppercase tracking-[0.08em] shrink-0">
                          SHIP TO
                        </span>
                        {(() => {
                          const active = activeCountries.find((c) => c.code === countryCode);
                          return active ? (
                            <span className="text-[8.5px] font-medium tracking-wider text-foreground/70 bg-background/80 dark:bg-black/60 px-2 py-0.5 rounded-full border border-foreground/5 truncate">
                              {active.name} · {active.currencySymbol}
                            </span>
                          ) : null;
                        })()}
                      </div>
                      {countryOpen ? (
                        <ChevronUp className="w-3.5 h-3.5 text-foreground/40 shrink-0" strokeWidth={1.5} />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-foreground/40 shrink-0" strokeWidth={1.5} />
                      )}
                    </button>

                    {/* Compact Expandable Country Options */}
                    <AnimatePresence initial={false}>
                      {countryOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden pt-2 space-y-1"
                        >
                          {activeCountries.map((c) => {
                            const isSelected = c.code === countryCode;
                            return (
                              <button
                                key={c.code}
                                type="button"
                                onClick={() => setCountry(c.code)}
                                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-all ${
                                  isSelected
                                    ? "bg-foreground/10 dark:bg-white/10 text-foreground font-semibold"
                                    : "hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04] text-foreground/60 hover:text-foreground"
                                }`}
                              >
                                <div className="flex items-center gap-2 text-[10px] tracking-wide">
                                  <span>{c.name}</span>
                                  <span className="text-[8.5px] font-mono text-foreground/40">
                                    ({c.currencySymbol} {c.currencyCode})
                                  </span>
                                </div>
                                {isSelected && (
                                  <Check className="w-3.5 h-3.5 text-foreground dark:text-white shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

              </div>
            </div>

            {/* ─── Profile & Orders Dock (Fixed at bottom) ─── */}
            <div className="px-6 py-4 border-t border-foreground/10 flex items-center justify-between gap-2 flex-shrink-0 bg-background/95 dark:bg-black/95 backdrop-blur-md z-20">
              <Link 
                href={session ? "/profile" : "/login"} 
                onClick={onClose} 
                className="group flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-foreground/[0.03] active:scale-95 transition-all flex-1 border border-foreground/5"
              >
                {profileImage ? (
                  <div className="w-5 h-5 rounded-full overflow-hidden border border-foreground/10">
                    <img src={profileImage} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <User className="w-4 h-4 text-foreground/40" strokeWidth={1.5} />
                )}
                <span className="text-[8px] font-bold tracking-[0.1em] uppercase text-foreground/60 group-hover:text-foreground">Profile</span>
              </Link>
              
              <Link 
                href="/orders" 
                onClick={onClose} 
                className="group flex items-center gap-2 px-2.5 py-2 hover:bg-foreground/[0.03] active:scale-95 rounded-2xl transition-all flex-1 border border-foreground/5"
              >
                <Package className="w-3.5 h-3.5 text-foreground/40" strokeWidth={1.5} />
                <span className="text-[7.5px] font-bold tracking-[0.05em] uppercase text-foreground/60 group-hover:text-foreground">Orders</span>
              </Link>

              <Link 
                href="/returns" 
                onClick={onClose} 
                className="group flex items-center gap-2 px-2.5 py-2 hover:bg-foreground/[0.03] active:scale-95 rounded-2xl transition-all flex-1 border border-foreground/5"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-500/80" strokeWidth={1.5} />
                <span className="text-[7.5px] font-bold tracking-[0.05em] uppercase text-foreground/60 group-hover:text-foreground">Returns</span>
              </Link>
            </div>

          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
