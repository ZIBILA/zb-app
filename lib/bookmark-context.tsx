"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { ShopifyProduct } from "./shopify-admin";
import { useSession } from "next-auth/react";
import { trackStorefrontEvent } from "@/lib/track-client";
import { trackSnapClientEvent } from "@/lib/snapPixel";

interface BookmarkContextType {
  bookmarks: (ShopifyProduct & { selectedVariantId?: string | null; selectedSize?: string | null })[];
  addBookmark: (product: ShopifyProduct, variantId?: string, size?: string) => void;
  removeBookmark: (productId: string, variantId?: string) => void;
  isBookmarked: (productId: string, variantId?: string) => boolean;
  toggleBookmark: (product: ShopifyProduct, variantId?: string, size?: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const BookmarkContext = createContext<BookmarkContextType | null>(null);

const STORAGE_KEY = "zb_bookmarks_v1";

export function BookmarkProvider({ children }: { children: React.ReactNode }) {
  const [bookmarks, setBookmarks] = useState<(ShopifyProduct & { selectedVariantId?: string | null; selectedSize?: string | null })[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const { data: session, status } = useSession();
  const wishlistSyncedRef = useRef<string | null>(null);
  const sessionUserId = (session?.user as any)?.id || session?.user?.email || null;

  // 1. Initial load from local storage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setBookmarks(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse bookmarks", e);
      }
    }
  }, []);

  // 2. Persist to local storage whenever bookmarks change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  }, [bookmarks]);

  // 3. Load and merge bookmarks from database once per authenticated user
  useEffect(() => {
    if (status !== "authenticated" || !sessionUserId) return;
    if (wishlistSyncedRef.current === sessionUserId) return;
    wishlistSyncedRef.current = sessionUserId;

    const fetchDbBookmarks = async () => {
      try {
        const res = await fetch("/api/wishlist");
        if (res.ok) {
          const data = await res.json();
          if (data.items && Array.isArray(data.items)) {
            const dbProducts = data.items.map((item: any) => ({
              ...item.product,
              selectedVariantId: item.variantId || null,
              selectedSize: item.size || null
            }));
            
            setBookmarks((prev) => {
              const merged = [...prev];
              
              // Add DB items to local state if missing
              for (const p of dbProducts) {
                const exists = merged.some((m) => 
                  m.id.toString() === p.id.toString() && 
                  (m.selectedVariantId === p.selectedVariantId || (!m.selectedVariantId && !p.selectedVariantId))
                );
                if (!exists) {
                  merged.push(p);
                }
              }

              // Add local-only items to the database (cap burst — max 10 parallel)
              const localOnly = prev.filter(p => !dbProducts.some((db: any) => 
                db.id.toString() === p.id.toString() && 
                (db.selectedVariantId === p.selectedVariantId || (!db.selectedVariantId && !p.selectedVariantId))
              ));
              const toSync = localOnly.slice(0, 20);
              for (const p of toSync) {
                fetch("/api/wishlist", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ 
                    productId: p.id.toString(),
                    variantId: p.selectedVariantId || undefined,
                    size: p.selectedSize || undefined
                  })
                }).catch(() => {});
              }

              return merged;
            });
          }
        }
      } catch (e) {
        console.error("Error syncing wishlist from DB:", e);
        wishlistSyncedRef.current = null;
      }
    };
    fetchDbBookmarks();
  }, [status, sessionUserId]);

  const addBookmark = useCallback((product: ShopifyProduct, variantId?: string, size?: string) => {
    // Track Add To Wishlist event
    trackStorefrontEvent('Add To Wishlist', {
      productId: product.id.toString(),
      metadata: {
        title: product.title,
        price: product.variants?.[0]?.price,
        variantId,
        size
      }
    });

    const productWithSelection = {
      ...product,
      selectedVariantId: variantId || null,
      selectedSize: size || null
    };

    setBookmarks((prev) => {
      const exists = prev.some((p) => 
        p.id.toString() === product.id.toString() && 
        (p.selectedVariantId === (variantId || null))
      );
      if (exists) return prev;
      return [...prev, productWithSelection];
    });

    if (status === "authenticated") {
      fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          productId: product.id.toString(),
          variantId: variantId || undefined,
          size: size || undefined
        })
      }).catch(err => console.error("Failed to add bookmark to DB:", err));
    }
  }, [status]);

  const removeBookmark = useCallback((productId: string, variantId?: string) => {
    setBookmarks((prev) => prev.filter((p) => 
      !(p.id.toString() === productId.toString() && (variantId === undefined || p.selectedVariantId === variantId))
    ));

    if (status === "authenticated") {
      fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          productId: productId.toString(), 
          variantId: variantId || undefined,
          action: "remove" 
        })
      }).catch(err => console.error("Failed to remove bookmark from DB:", err));
    }
  }, [status]);

  const isBookmarked = useCallback((productId: string, variantId?: string) => {
    return bookmarks.some((p) => 
      p.id.toString() === productId.toString() && 
      (variantId === undefined || p.selectedVariantId === variantId)
    );
  }, [bookmarks]);

  const toggleBookmark = useCallback((product: ShopifyProduct, variantId?: string, size?: string) => {
    const isCurrentlyBookmarked = bookmarks.some((p) => 
      p.id.toString() === product.id.toString() && 
      (variantId === undefined || p.selectedVariantId === (variantId || null))
    );
    const action = isCurrentlyBookmarked ? "remove" : "add";

    // Track Toggle (AddToWishlist if currently not bookmarked)
    if (!isCurrentlyBookmarked) {
      trackStorefrontEvent('Add To Wishlist', {
        productId: product.id.toString(),
        metadata: {
          title: product.title,
          price: product.variants?.[0]?.price,
          variantId,
          size
        }
      });
      trackSnapClientEvent('ADD_TO_WISHLIST', {
        item_ids: [product.id.toString()],
        item_category: product.product_type,
        description: product.title,
      });
    }

    setBookmarks((prev) => {
      if (isCurrentlyBookmarked) {
        return prev.filter((p) => 
          !(p.id.toString() === product.id.toString() && (variantId === undefined || p.selectedVariantId === (variantId || null)))
        );
      }
      const productWithSelection = {
        ...product,
        selectedVariantId: variantId || null,
        selectedSize: size || null
      };
      return [...prev, productWithSelection];
    });

    if (status === "authenticated") {
      fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          productId: product.id.toString(), 
          variantId: variantId || undefined,
          size: size || undefined,
          action: action
        })
      }).catch(err => console.error("Failed to toggle bookmark in DB:", err));
    }
  }, [bookmarks, status]);

  return (
    <BookmarkContext.Provider value={{ bookmarks, addBookmark, removeBookmark, isBookmarked, toggleBookmark, isOpen, setIsOpen }}>
      {children}
    </BookmarkContext.Provider>
  );
}

export function useBookmarks() {
  const context = useContext(BookmarkContext);
  if (!context) {
    throw new Error("useBookmarks must be used within a BookmarkProvider");
  }
  return context;
}
