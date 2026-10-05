"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import NextImage from "next/image";
import { Bookmark, ShoppingBag, ChevronLeft, ChevronDown, Search, User, Menu, Sun, Moon } from "lucide-react";
import { useCart } from "@/lib/cart-context";
import MenuDrawer from "./MenuDrawer";
import CartDrawer from "./CartDrawer";
import BookmarkDrawer from "./BookmarkDrawer";
import { useBookmarks } from "@/lib/bookmark-context";
import { useRouter, usePathname } from "next/navigation";
import { useShakeToCart } from "@/lib/hooks/useShakeToCart";
import { useTheme } from "next-themes";
import { fetchHeaderCollections } from "@/lib/storefront-fetch";

export default function StorefrontHeader({ collections: initialCollections = [] }: { collections?: any[] }) {
  const router = useRouter();
  const pathname = usePathname();

  // Track in-app navigation depth so the back button can reliably go
  // to the previous page instead of always falling through to "/".
  // document.referrer does NOT update on client-side (SPA) navigations,
  // so we count pathname changes instead.
  const navCountRef = useRef(0);
  const prevPathnameRef = useRef(pathname);

  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      navCountRef.current += 1;
      prevPathnameRef.current = pathname;
    }
  }, [pathname]);

  const handleBack = useCallback(() => {
    if (navCountRef.current > 0) {
      navCountRef.current -= 1;
      router.back();
    } else {
      router.push("/");
    }
  }, [router]);
  const { count } = useCart();
  const { bookmarks, isOpen: isBookmarkOpen, setIsOpen: setIsBookmarkOpen } = useBookmarks();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [collections, setCollections] = useState(initialCollections);
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleCart = useCallback(() => {
    setIsCartOpen(prev => !prev);
  }, []);
  useShakeToCart(toggleCart);

  useEffect(() => {
    if (initialCollections.length > 0) {
      setCollections(initialCollections);
      return;
    }
    fetchHeaderCollections()
      .then((data) => {
        if (Array.isArray(data)) setCollections(data);
      })
      .catch(() => {});
  }, [initialCollections]);

  const [orderNumberOverride, setOrderNumberOverride] = useState<string | null>(null);

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setOrderNumberOverride(customEvent.detail);
      }
    };
    window.addEventListener("update-header-order-number", handleUpdate);
    return () => {
      window.removeEventListener("update-header-order-number", handleUpdate);
    };
  }, []);

  useEffect(() => {
    setOrderNumberOverride(null);
  }, [pathname]);

  const isHome = pathname === "/";
  const getPageTitle = () => {
    if (!pathname) return "ZICABELLA";
    if (isHome) return "ZICABELLA";
    if (pathname.startsWith("/products/")) return "ZICABELLA";
    if (pathname.startsWith("/orders/") && orderNumberOverride) {
      return orderNumberOverride;
    }
    const segments = pathname?.split("/").filter(Boolean) || [];
    if (segments.length === 0) return "ZICABELLA";
    let title = segments[segments.length - 1];
    title = title.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
    return title;
  };



  return (
    <>
      {/* Skip to Content Landmark */}
      <a 
        href="#main-content" 
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-black focus:text-white dark:focus:bg-white dark:focus:text-black focus:rounded-lg focus:shadow-2xl text-xs uppercase tracking-wider font-semibold"
      >
        Skip to content
      </a>

      {/* ── Desktop Header Pill (md and up) ── */}
      <header className="hidden md:flex fixed top-4 left-1/2 -translate-x-1/2 w-[calc(100%-3rem)] max-w-5xl z-50 px-5 h-11 items-center justify-between pointer-events-auto bg-white/75 dark:bg-white/[0.04] backdrop-blur-2xl border border-black/5 dark:border-white/10 shadow-[0_10px_35px_rgba(0,0,0,0.05)] dark:shadow-[0_15px_40px_rgba(0,0,0,0.4)] rounded-full transition-[background-color,border-color,box-shadow,opacity] duration-300">
        {/* Left: Brand */}
        <Link href="/" className="flex items-center gap-2 active:scale-95 transition-all z-10 py-1 px-2.5 rounded-full hover:bg-foreground/5 dark:hover:bg-white/5">
          <div className="relative w-5 h-5 dark:invert">
            <NextImage src="/zb-logo-220px.png" alt="Zica Bella" fill className="object-contain" />
          </div>
          <span className="font-rocaston text-[9.5px] font-bold tracking-[0.22em] text-foreground/80 uppercase pt-0.5">ZICABELLA</span>
        </Link>

        {/* Center: Nav Links */}
        <div className="flex items-center gap-1.5 z-10">
          {collections.slice(0, 5).map((col) => {
            const active = pathname === `/collections/${col.handle}`;
            return (
              <Link
                key={col.id}
                href={`/collections/${col.handle}`}
                className={`text-[7.5px] font-bold tracking-[0.22em] uppercase transition-all duration-300 py-1 px-3 rounded-full ${
                  active
                    ? "bg-foreground text-background dark:bg-white dark:text-black font-extrabold shadow-sm"
                    : "text-foreground/50 hover:text-foreground hover:bg-foreground/5 dark:hover:bg-white/5"
                }`}
              >
                {col.title}
              </Link>
            );
          })}
          <Link
            href="/blogs"
            className={`text-[7.5px] font-bold tracking-[0.22em] uppercase transition-all duration-300 py-1 px-3 rounded-full ${
              pathname === "/blogs"
                ? "bg-foreground text-background dark:bg-white dark:text-black font-extrabold shadow-sm"
                : "text-foreground/50 hover:text-foreground hover:bg-foreground/5 dark:hover:bg-white/5"
            }`}
          >
            Blogs
          </Link>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 z-10">
          {mounted && (
            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="h-[30px] w-[30px] flex items-center justify-center rounded-full text-foreground/50 dark:text-white/45 hover:text-foreground dark:hover:text-white hover:bg-foreground/[0.04] dark:hover:bg-white/[0.05] border border-transparent transition-all duration-300 active:scale-90"
              aria-label="Toggle Theme"
            >
              {isDark ? (
                <Sun className="w-3.5 h-3.5 transition-transform duration-300 hover:scale-105" strokeWidth={1.25} />
              ) : (
                <Moon className="w-3.5 h-3.5 transition-transform duration-300 hover:scale-105" strokeWidth={1.25} />
              )}
            </button>
          )}
          
          <Link
            href="/search"
            aria-label="Search"
            className={`h-[30px] w-[30px] flex items-center justify-center rounded-full transition-all duration-300 active:scale-90 ${
              pathname === "/search"
                ? "text-foreground dark:text-white bg-foreground/[0.06] dark:bg-white/[0.08] border border-foreground/[0.08] dark:border-white/10 shadow-[inset_0_1.5px_2px_rgba(0,0,0,0.02)]"
                : "text-foreground/50 dark:text-white/45 hover:text-foreground dark:hover:text-white hover:bg-foreground/[0.04] dark:hover:bg-white/[0.05] border border-transparent"
            }`}
          >
            <Search className="w-3.5 h-3.5 transition-transform duration-300 hover:scale-105" strokeWidth={1.25} />
          </Link>
          
          <button
            onClick={() => setIsBookmarkOpen(true)}
            aria-label="Bookmarks"
            className={`relative h-[30px] w-[30px] flex items-center justify-center rounded-full transition-all duration-300 active:scale-90 ${
              isBookmarkOpen
                ? "text-foreground dark:text-white bg-foreground/[0.06] dark:bg-white/[0.08] border border-foreground/[0.08] dark:border-white/10 shadow-[inset_0_1.5px_2px_rgba(0,0,0,0.02)]"
                : "text-foreground/50 dark:text-white/45 hover:text-foreground dark:hover:text-white hover:bg-foreground/[0.04] dark:hover:bg-white/[0.05] border border-transparent"
            }`}
          >
            <Bookmark className="w-3.5 h-3.5 transition-transform duration-300 hover:scale-105" strokeWidth={1.25} />
            {bookmarks.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-foreground dark:bg-white rounded-full animate-pulse" />
            )}
          </button>
          
          <button
            onClick={() => setIsCartOpen(true)}
            aria-label="Cart"
            className={`relative h-[30px] w-[30px] flex items-center justify-center rounded-full transition-all duration-300 active:scale-90 ${
              isCartOpen
                ? "text-foreground dark:text-white bg-foreground/[0.06] dark:bg-white/[0.08] border border-foreground/[0.08] dark:border-white/10 shadow-[inset_0_1.5px_2px_rgba(0,0,0,0.02)]"
                : "text-foreground/50 dark:text-white/45 hover:text-foreground dark:hover:text-white hover:bg-foreground/[0.04] dark:hover:bg-white/[0.05] border border-transparent"
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5 transition-transform duration-300 hover:scale-105" strokeWidth={1.25} />
            {count > 0 && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-foreground dark:bg-white rounded-full animate-pulse" />
            )}
          </button>
          
          <Link
            href="/profile"
            aria-label="Profile"
            className={`h-[30px] w-[30px] flex items-center justify-center rounded-full transition-all duration-300 active:scale-90 ${
              pathname === "/profile"
                ? "text-foreground dark:text-white bg-foreground/[0.06] dark:bg-white/[0.08] border border-foreground/[0.08] dark:border-white/10 shadow-[inset_0_1.5px_2px_rgba(0,0,0,0.02)]"
                : "text-foreground/50 dark:text-white/45 hover:text-foreground dark:hover:text-white hover:bg-foreground/[0.04] dark:hover:bg-white/[0.05] border border-transparent"
            }`}
          >
            <User className="w-3.5 h-3.5 transition-transform duration-300 hover:scale-105" strokeWidth={1.25} />
          </Link>
        </div>
      </header>

      {/* ── Mobile Header (Floating Minimal Split Design) ── */}
      <div className="flex md:hidden fixed top-4 left-4 right-4 z-50 items-center justify-between pointer-events-none">
        
        {/* Left: Glass Pill with Menu & Title */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/60 dark:bg-black/60 backdrop-blur-xl border border-black/5 dark:border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_15px_40px_rgba(0,0,0,0.3)] pointer-events-auto active:scale-[0.98] transition-all">
          {!isHome && (
            <button 
              onClick={handleBack}
              className="w-7 h-7 flex items-center justify-center rounded-full text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 active:scale-90 transition-all"
              aria-label="Back"
            >
              <ChevronLeft strokeWidth={1.75} className="w-3.5 h-3.5" />
            </button>
          )}
          <button 
            onClick={() => setIsMenuOpen(true)}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-black/5 dark:bg-white/10 text-foreground hover:bg-black/10 dark:hover:bg-white/15 transition-all"
            aria-label="Menu"
          >
            <ChevronDown strokeWidth={1.75} className="w-3.5 h-3.5" />
          </button>
          
          <Link href="/" className="flex items-center pr-2 pl-1">
            <span className="text-[9px] font-rocaston tracking-[0.22em] text-foreground font-semibold uppercase pt-0.5">
              {getPageTitle()}
            </span>
          </Link>
        </div>

        {/* Right: Floating Theme & Cart */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {mounted && (
            <button 
              onClick={() => setTheme(isDark ? "light" : "dark")}
              aria-label="Toggle Theme"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/60 dark:bg-black/60 backdrop-blur-xl border border-black/5 dark:border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_15px_40px_rgba(0,0,0,0.3)] text-foreground/70 hover:text-foreground active:scale-90 transition-all"
            >
              {isDark ? <Sun strokeWidth={1.5} className="w-4 h-4" /> : <Moon strokeWidth={1.5} className="w-4 h-4" />}
            </button>
          )}
          <button 
            onClick={() => setIsCartOpen(true)}
            aria-label="Cart"
            className="relative w-9 h-9 flex items-center justify-center rounded-full bg-white/60 dark:bg-black/60 backdrop-blur-xl border border-black/5 dark:border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_15px_40px_rgba(0,0,0,0.3)] text-foreground/70 hover:text-foreground active:scale-90 transition-all"
          >
            <ShoppingBag strokeWidth={1.5} className="w-4 h-4" />
            {count > 0 && (
              <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 bg-foreground rounded-full animate-pulse" />
            )}
          </button>
        </div>

      </div>

      {/* Drawers */}
      <MenuDrawer isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
      <CartDrawer isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
      <BookmarkDrawer isOpen={isBookmarkOpen} onClose={() => setIsBookmarkOpen(false)} />
    </>
  );
}
