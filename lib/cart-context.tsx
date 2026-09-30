"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useSession } from "next-auth/react";
import { trackStorefrontEvent } from "@/lib/track-client";
import { trackAddToCart as zbTrackAddToCart, trackRemoveFromCart as zbTrackRemoveFromCart } from "@/lib/analytics-tracker";
import { enrichSessionWithGeolocation } from "@/lib/geolocation-enrichment";

// ─── Types ────────────────────────────────────────────────

export interface CartItem {
  id: string;             // "productId_variantId_size"
  productId: string;
  handle: string;         // SEO-friendly URL slug
  variantId: string;
  title: string;
  size: string | null;
  price: string;
  image: string;
  quantity: number;
  category?: string;
}

interface CartContextType {
  items: CartItem[];
  count: number;
  subtotal: number;
  add: (item: Omit<CartItem, "id" | "quantity">) => void;
  remove: (id: string) => void;
  update: (id: string, quantity: number) => void;
  clear: () => void;
  loadFromDB: (dbItems: CartItem[]) => void;
  isLoaded: boolean;
}

const CartContext = createContext<CartContextType | null>(null);

import { getClientCookie, setClientCookie } from "@/lib/metaPixel";

const STORAGE_KEY = "zb_cart_v1";

// ─── Provider ────────────────────────────────────────────

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [items, setItems] = useState<CartItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const [isLoaded, setIsLoaded] = useState(false);
  const restoredRef = useRef(false);

  // Ensure items are synced on client mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setItems(parsed);
        }
      }
    } catch {}
    setIsLoaded(true);
  }, []);

  // Persist to localStorage on change (only after client mount)
  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, [items, isLoaded]);

  // ── Login restore: one-time merge from DB when user authenticates ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (status !== "authenticated" || restoredRef.current) return;
    restoredRef.current = true;

    const restoreFromDB = async () => {
      try {
        const res = await fetch("/api/cart/me");
        if (!res.ok) return;
        const data = await res.json();
        if (data && Array.isArray(data.items) && data.items.length > 0) {
          const dbItems: CartItem[] = data.items;
          // Merge DB items with local items — keep higher quantity (Math.max),
          // never sum, to prevent inflation on repeated logins
          setItems((prev) => {
            const map = new Map(prev.map((i) => [i.id, { ...i }]));
            for (const di of dbItems) {
              const ex = map.get(di.id);
              if (ex) {
                ex.quantity = Math.max(ex.quantity, di.quantity);
              } else {
                map.set(di.id, di);
              }
            }
            return Array.from(map.values());
          });
        }
      } catch (err) {
        console.error("Cart login restore failed:", err);
      }
    };

    restoreFromDB();
  }, [status]);

  // Synchronize cart with backend on updates (debounced)
  useEffect(() => {
    if (typeof window === "undefined") return;

    let deviceId = getClientCookie("zb_device_id");
    if (!deviceId) {
      deviceId = `guest_web_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36)}`;
      setClientCookie("zb_device_id", deviceId, 365);
    }

    const syncCartWithBackend = async () => {
      try {
        let geoDetails = {};
        try {
          const cachedGeo = sessionStorage.getItem('zb_geo_data');
          if (cachedGeo) {
            const parsedGeo = JSON.parse(cachedGeo);
            geoDetails = {
              city: parsedGeo.city || undefined,
              state: parsedGeo.state || undefined,
              zip: parsedGeo.zip || undefined,
              country: parsedGeo.country || undefined,
              latitude: parsedGeo.latitude || undefined,
              longitude: parsedGeo.longitude || undefined,
            };
          }
        } catch (e) {
          // Ignore parse errors
        }

        // Include guest contact info from sessionStorage so the admin dashboard
        // can identify cart owners immediately (e.g. from checkout form autosave)
        let guestContact: Record<string, string> = {};
        try {
          const guestPhone = sessionStorage.getItem('zb_guest_phone') || localStorage.getItem('zb_guest_phone');
          const guestEmail = sessionStorage.getItem('zb_guest_email') || localStorage.getItem('zb_guest_email');
          if (guestPhone) guestContact.phone = guestPhone;
          if (guestEmail) guestContact.email = guestEmail;
        } catch (e) {
          // Ignore storage errors
        }

        const { getTrafficSource } = await import("@/lib/traffic-source");
        const trafficSource = getTrafficSource();

        await fetch("/api/cart/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items,
            guestId: deviceId,
            source: trafficSource,
            ...geoDetails,
            ...guestContact
          })
        });
      } catch (err) {
        console.error("Cart background sync failed:", err);
      }
    };

    // Hold sync until login restore has completed — prevents overwriting
    // the DB cart with stale local-only data before merge finishes
    if (status === "authenticated" && !restoredRef.current) return;

    // Fast 300ms debounce for near-instant real-time cart tracking in admin dashboard
    const timer = setTimeout(syncCartWithBackend, 300);
    return () => clearTimeout(timer);
  }, [items, status]);

  const add = useCallback((item: Omit<CartItem, "id" | "quantity">) => {
    const id = `${item.productId}_${item.variantId}_${item.size || "one-size"}`;
    
    // Track Add To Cart event
    trackStorefrontEvent('Add To Cart', {
      productId: item.productId,
      metadata: {
        title: item.title,
        price: item.price,
        size: item.size
      }
    });

    // ZB First-Party Analytics
    zbTrackAddToCart(item.productId, item.variantId, parseFloat(item.price) || 0, 1, { title: item.title, size: item.size });

    // One-shot geolocation enrichment for EMQ address fields (ct/st/zp/country).
    // The sessionStorage guard inside ensures it fires at most once per session,
    // even across multiple add-to-cart actions. Fully fire-and-forget.
    enrichSessionWithGeolocation().catch(() => {});

    setItems((prev) => {
      const existing = prev.find((i) => i.id === id);
      if (existing) {
        return prev.map((i) =>
          i.id === id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { ...item, id, quantity: 1 }];
    });
  }, []);

  const remove = useCallback((id: string) => {
    // Find item details first to track Removal
    setItems((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item) {
        trackStorefrontEvent('Remove From Cart', {
          productId: item.productId,
          metadata: {
            title: item.title,
            price: item.price,
            size: item.size
          }
        });

        // ZB First-Party Analytics
        zbTrackRemoveFromCart(item.productId, item.variantId, { title: item.title, size: item.size });
      }
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const update = useCallback((id: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((i) => i.id !== id));
    } else {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, quantity } : i))
      );
    }
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    // Clear guest PII from both storage types on checkout/clear
    clearGuestPII();
  }, []);

  // Replace local cart state with items fetched from the database (merges with existing)
  const loadFromDB = useCallback((dbItems: CartItem[]) => {
    setItems((prev) => {
      if (prev.length === 0) return dbItems;
      const map = new Map(prev.map((i) => [i.id, { ...i }]));
      for (const di of dbItems) {
        const ex = map.get(di.id);
        if (ex) {
          ex.quantity = Math.max(ex.quantity, di.quantity);
        } else {
          map.set(di.id, di);
        }
      }
      return Array.from(map.values());
    });
  }, []);

  const count = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);
  const subtotal = useMemo(
    () => items.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0),
    [items]
  );

  return (
    <CartContext.Provider value={{ items, count, subtotal, add, remove, update, clear, loadFromDB, isLoaded }}>
      {children}
    </CartContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

/**
 * Clears guest PII (phone/email) from both sessionStorage and localStorage.
 * Call on login, logout, and checkout completion to prevent stale PII exposure.
 */
export function clearGuestPII() {
  try {
    ['zb_guest_phone', 'zb_guest_email'].forEach((k) => {
      sessionStorage.removeItem(k);
      localStorage.removeItem(k);
    });
  } catch (_e) {
    // Storage may be unavailable (SSR, privacy mode)
  }
}
