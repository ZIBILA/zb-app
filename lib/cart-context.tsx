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
import { decideCartRestore, EMPTY_META, type CartMeta } from "@/lib/cart-restore";

const STORAGE_KEY = "zb_cart_v1";
/** Bookkeeping (see CartMeta) that tells which copy is newer — this browser's or the account's DB cart. */
const META_KEY = "zb_cart_meta_v1";

function readMeta(): CartMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) return { ...EMPTY_META, ...JSON.parse(raw) };
  } catch {}
  return { ...EMPTY_META };
}

function writeMeta(meta: CartMeta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {}
}

/** Ignore accidental double-taps of the same line within this window. */
const ADD_DEBOUNCE_MS = 500;
const recentAdds = new Map<string, number>();

function cartLineId(productId: string, variantId: string, size: string | null | undefined): string {
  const sizeKey = (size || "").trim() || "one-size";
  return `${productId}_${variantId}_${sizeKey}`;
}

function acceptAdd(lineId: string): boolean {
  const now = Date.now();
  const last = recentAdds.get(lineId) || 0;
  if (now - last < ADD_DEBOUNCE_MS) return false;
  recentAdds.set(lineId, now);
  // Bound map growth
  if (recentAdds.size > 200) {
    const cutoff = now - ADD_DEBOUNCE_MS * 4;
    for (const [k, t] of recentAdds) {
      if (t < cutoff) recentAdds.delete(k);
    }
  }
  return true;
}

// ─── Provider ────────────────────────────────────────────

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const userKey: string | null =
    (session?.user as any)?.id || session?.user?.email || null;
  // Start empty on both server and first client paint to avoid hydration mismatch.
  // Hydrate once from localStorage in the effect below — do not re-read after that,
  // or a concurrent add can be overwritten / appear to "double".
  const [items, setItems] = useState<CartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const restoredRef = useRef(false);
  const hydratedRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const metaRef = useRef<CartMeta>({ ...EMPTY_META });
  const lastSyncedJsonRef = useRef<string | null>(null);
  const syncDirtyRef = useRef(false);
  const syncFailuresRef = useRef(0);
  // Bumped to re-run the sync effect when something other than `items` changes (restore done, retry).
  const [syncTick, setSyncTick] = useState(0);
  const [restoreDone, setRestoreDone] = useState(false);

  /** Record a user change to the cart (add / remove / quantity / clear). */
  const touch = useCallback(() => {
    metaRef.current = { ...metaRef.current, updatedAt: Date.now() };
    writeMeta(metaRef.current);
  }, []);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    metaRef.current = readMeta();
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

  // Keep tabs consistent: a cart changed in another tab replaces this tab's copy, so a stale tab
  // can't write removed items back on its next change.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === META_KEY) {
        metaRef.current = readMeta();
        return;
      }
      if (e.key !== STORAGE_KEY || e.newValue == null) return;
      try {
        const parsed = JSON.parse(e.newValue);
        if (Array.isArray(parsed)) setItems(parsed);
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Keep line prices current. A line keeps the price it was added at; when a sale starts or ends that
  // price is stale and checkout (which re-verifies against Shopify) would reject the order.
  const itemsRef = useRef<CartItem[]>([]);
  itemsRef.current = items;
  useEffect(() => {
    if (!isLoaded) return;
    let lastRun = 0;
    const refreshPrices = async () => {
      const variantIds = Array.from(
        new Set(itemsRef.current.map((i) => String(i.variantId || "").split("/").pop() || "").filter(Boolean))
      );
      if (variantIds.length === 0 || Date.now() - lastRun < 30_000) return;
      lastRun = Date.now();
      try {
        const res = await fetch(`/api/cart/prices?variants=${variantIds.join(",")}`);
        if (!res.ok) return;
        const { prices } = (await res.json()) as { prices: Record<string, string> };
        setItems((prev) => {
          let changed = false;
          const next = prev.map((i) => {
            const live = prices[String(i.variantId || "").split("/").pop() || ""];
            if (live && Math.abs(parseFloat(live) - parseFloat(i.price)) >= 0.005) {
              changed = true;
              return { ...i, price: live };
            }
            return i;
          });
          return changed ? next : prev;
        });
      } catch {}
    };
    refreshPrices();
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshPrices();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // Re-runs once after the account restore, which may swap in DB lines carrying older prices.
  }, [isLoaded, restoreDone]);

  // Remember that this browser's cart was built while logged out, so the next login merges it in.
  useEffect(() => {
    if (!isLoaded || status !== "unauthenticated") return;
    if (metaRef.current.owner !== "guest") {
      metaRef.current = { ...metaRef.current, owner: "guest" };
      writeMeta(metaRef.current);
    }
  }, [status, isLoaded]);

  // Persist to localStorage on change (only after client mount)
  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, [items, isLoaded]);

  // ── Account cart restore (once per page load when authenticated) ──
  // The DB cart is only UNION-merged on an actual login (guest cart + account cart). On every other
  // load the newer copy wins outright, so items removed on this device are never merged back in.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isLoaded || status !== "authenticated" || restoredRef.current) return;
    // Mark in-progress so sync waits; finalize in finally so a failed restore
    // still unblocks sync (and a success path doesn't race ahead of the merge).
    let cancelled = false;

    const startedAt = Date.now();

    const restoreFromDB = async () => {
      try {
        const res = await fetch("/api/cart/me");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const decision = decideCartRestore<CartItem>({
          meta: metaRef.current,
          localItems: itemsRef.current,
          dbItems: Array.isArray(data?.items) ? data.items : [],
          dbUpdatedAt: data?.updatedAt || null,
          userKey,
          requestStartedAt: startedAt,
        });
        if (decision.action === "replace") {
          setItems(decision.items);
          if (decision.adoptedServerAt !== undefined) {
            // Took the account cart as-is: it is already what the DB holds.
            lastSyncedJsonRef.current = JSON.stringify(decision.items);
            metaRef.current = {
              ...metaRef.current,
              syncedLocalAt: metaRef.current.updatedAt,
              syncedServerAt: decision.adoptedServerAt,
            };
          }
        }
        if (decision.push) touch();
        metaRef.current = { ...metaRef.current, owner: userKey };
        writeMeta(metaRef.current);
      } catch (err) {
        console.error("Cart restore failed:", err);
      } finally {
        if (!cancelled) {
          restoredRef.current = true;
          setRestoreDone(true);
          setSyncTick((t) => t + 1);
        }
      }
    };

    restoreFromDB();
    return () => {
      cancelled = true;
    };
  }, [status, isLoaded, userKey, touch]);

  // Synchronize cart with backend on updates (debounced)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isLoaded) return;
    // Checkout owns contact-enriched sync — avoid duplicate /api/cart/sync there
    if (window.location.pathname.startsWith("/checkout")) return;

    const payloadJson = JSON.stringify(items);
    // Skip unchanged carts (including empty carts on every page load)
    if (lastSyncedJsonRef.current === payloadJson) return;

    let deviceId = getClientCookie("zb_device_id");
    if (!deviceId) {
      deviceId = `guest_web_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36)}`;
      setClientCookie("zb_device_id", deviceId, 365);
    }

    const syncCartWithBackend = async () => {
      if (syncInFlightRef.current) {
        syncDirtyRef.current = true;
        return;
      }
      syncInFlightRef.current = true;
      syncDirtyRef.current = false;
      const sentUpdatedAt = metaRef.current.updatedAt;
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

        const res = await fetch("/api/cart/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            items,
            guestId: deviceId,
            source: trafficSource,
            ...geoDetails,
            ...guestContact
          })
        });
        // fetch() doesn't throw on 429/500 — only a 2xx means the DB really holds this cart.
        if (!res.ok) throw new Error(`cart sync HTTP ${res.status}`);
        const data = await res.json().catch(() => null);
        lastSyncedJsonRef.current = payloadJson;
        syncFailuresRef.current = 0;
        metaRef.current = {
          ...metaRef.current,
          syncedLocalAt: Math.max(metaRef.current.syncedLocalAt, sentUpdatedAt),
          syncedServerAt: data?.updatedAt || metaRef.current.syncedServerAt,
        };
        writeMeta(metaRef.current);
      } catch (err) {
        console.error("Cart background sync failed:", err);
        // Unsynced edits stay flagged (updatedAt > syncedLocalAt), so a reload keeps this device's
        // cart instead of the stale DB copy. Retry a few times meanwhile.
        if (syncFailuresRef.current < 3) {
          syncFailuresRef.current += 1;
          setTimeout(() => setSyncTick((t) => t + 1), 5000 * syncFailuresRef.current);
        }
      } finally {
        syncInFlightRef.current = false;
        if (syncDirtyRef.current) {
          syncDirtyRef.current = false;
          // Items changed while the request was in flight — sync again with the latest cart.
          setSyncTick((t) => t + 1);
        }
      }
    };

    // Hold sync until we know who the user is and the account restore has completed — prevents
    // overwriting a newer DB cart (edited on another device) with this device's older copy.
    if (status === "loading") return;
    if (status === "authenticated" && !restoredRef.current) return;

    // 1s debounce + single-flight avoids session_token unique races under rapid UI updates
    const timer = setTimeout(syncCartWithBackend, 1000);
    return () => clearTimeout(timer);
  }, [items, status, isLoaded, syncTick]);

  const add = useCallback((item: Omit<CartItem, "id" | "quantity">) => {
    const id = cartLineId(item.productId, item.variantId, item.size);
    // Synchronous debounce: blocks double-tap / duplicate handler fires before React re-renders
    if (!acceptAdd(id)) return;

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

    touch();
    setItems((prev) => {
      const existing = prev.find((i) => i.id === id);
      if (existing) {
        return prev.map((i) =>
          i.id === id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { ...item, id, quantity: 1 }];
    });
  }, [touch]);

  const remove = useCallback((id: string) => {
    touch();
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
  }, [touch]);

  const update = useCallback((id: string, quantity: number) => {
    touch();
    if (quantity <= 0) {
      setItems((prev) => prev.filter((i) => i.id !== id));
    } else {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, quantity } : i))
      );
    }
  }, [touch]);

  const clear = useCallback(() => {
    touch();
    setItems([]);
    // Clear guest PII from both storage types on checkout/clear
    clearGuestPII();
  }, [touch]);

  // Replace local cart state with items fetched from the database (merges with existing)
  const loadFromDB = useCallback((dbItems: CartItem[]) => {
    touch();
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
  }, [touch]);

  const count = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);
  const subtotal = useMemo(
    () => items.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0),
    [items]
  );

  const value = useMemo(
    () => ({ items, count, subtotal, add, remove, update, clear, loadFromDB, isLoaded }),
    [items, count, subtotal, add, remove, update, clear, loadFromDB, isLoaded]
  );

  return (
    <CartContext.Provider value={value}>
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
