"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { ShopifyProduct } from "./shopify-admin";

interface RecentlyViewedContextType {
  recentlyViewed: ShopifyProduct[];
  addProduct: (product: ShopifyProduct) => void;
}

const RecentlyViewedContext = createContext<RecentlyViewedContextType | null>(null);

const STORAGE_KEY = "zb_recently_viewed_v1";
const MAX_ITEMS = 4;

export function RecentlyViewedProvider({ children }: { children: React.ReactNode }) {
  const [recentlyViewed, setRecentlyViewed] = useState<ShopifyProduct[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setRecentlyViewed(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse recently viewed", e);
      }
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recentlyViewed));
  }, [recentlyViewed, isLoaded]);

  const addProduct = useCallback((product: ShopifyProduct) => {
    setRecentlyViewed((prev) => {
      // Remove if already exists to move to top
      const filtered = prev.filter((p) => p.id !== product.id);
      const updated = [product, ...filtered];
      return updated.slice(0, MAX_ITEMS);
    });
  }, []);

  const value = useMemo(
    () => ({ recentlyViewed, addProduct }),
    [recentlyViewed, addProduct]
  );

  return (
    <RecentlyViewedContext.Provider value={value}>
      {children}
    </RecentlyViewedContext.Provider>
  );
}

export function useRecentlyViewed() {
  const context = useContext(RecentlyViewedContext);
  if (!context) {
    throw new Error("useRecentlyViewed must be used within a RecentlyViewedProvider");
  }
  return context;
}
