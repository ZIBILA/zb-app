"use client";

import { useEffect, useState, useMemo } from "react";
import {
  PackageSearch,
  Loader2,
  RefreshCw,
  Plus,
  Minus,
  Check,
  Zap,
  Search,
  ChevronDown,
  AlertTriangle,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cachedAdminFetch, invalidateAdminCache } from "@/lib/adminClientCache";

interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  sku: string | null;
  barcode: string | null;
  inventory_quantity: number;
  inventory_item_id: number;
  option1: string | null;
  option2: string | null;
  option3: string | null;
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  status: string;
  product_type: string;
  vendor: string;
  image: { src: string } | null;
  variants: ShopifyVariant[];
}

type StockFilter = "all" | "low" | "out";

export default function InventoryPage() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<Record<number, number>>({});
  const [deltas, setDeltas] = useState<Record<number, number>>({});
  const [locationId, setLocationId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // New UI state
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [expandedProducts, setExpandedProducts] = useState<Set<number>>(new Set());

  // Custom printed SKUs tracking
  const [customSkus, setCustomSkus] = useState<Record<number, any[]>>({});
  const [loadingSkus, setLoadingSkus] = useState<Record<number, boolean>>({});

  const fetchCustomSkus = async (productId: number) => {
    setLoadingSkus(prev => ({ ...prev, [productId]: true }));
    try {
      const res = await fetch(`/api/admin/inventory/skus?productId=${productId}`);
      const data = await res.json();
      setCustomSkus(prev => ({ ...prev, [productId]: data.skus || [] }));
    } catch (err) {
      console.error('Error fetching custom SKUs:', err);
    } finally {
      setLoadingSkus(prev => {
        const n = { ...prev };
        delete n[productId];
        return n;
      });
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const fetchProducts = async (silent = false) => {
    if (!silent && products.length === 0) setLoading(true);
    setError(null);
    try {
      const data = await cachedAdminFetch<any>("/api/shopify/products?limit=250", {
        skipCache: silent,
        ttlMs: 60_000,
      });
      setProducts(data.products || []);
      if (data.error) setError(`Shopify API: ${data.error}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleDelta = (variantId: number, change: number) => {
    setDeltas((prev) => ({
      ...prev,
      [variantId]: (prev[variantId] || 0) + change,
    }));
  };

  const applyAdjustment = async (
    variant: ShopifyVariant,
    productTitle: string
  ) => {
    const delta = deltas[variant.id] || 0;
    if (delta === 0) return;

    setAdjusting((prev) => ({ ...prev, [variant.id]: 1 }));
    try {
      const res = await fetch("/api/shopify/inventory/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventoryItemId: variant.inventory_item_id,
          locationId: 0,
          delta,
        }),
      });

      if (!res.ok) {
        await fetch("/api/shopify/sync", { method: "POST" });
      }

      if (res.ok) {
        const data = await res.json();
        const newQty = data.inventoryLevel?.available ?? (variant.inventory_quantity + delta);
        setProducts((prev) =>
          prev.map((p) => ({
            ...p,
            variants: p.variants.map((v) =>
              v.id === variant.id
                ? { ...v, inventory_quantity: newQty }
                : v
            ),
          }))
        );
        setDeltas((prev) => ({ ...prev, [variant.id]: 0 }));
        showToast(
          `${productTitle} (${variant.option1 || variant.title}): ${delta > 0 ? "+" : ""}${delta} → ${newQty}`
        );
      } else {
        const errData = await res.json();
        showToast(`Error: ${errData.error}`);
      }
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "An unknown error occurred"}`);
    } finally {
      setAdjusting((prev) => {
        const n = { ...prev };
        delete n[variant.id];
        return n;
      });
    }
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/shopify/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const s = data.synced;
        showToast(`Sync complete: ${s.products} products, ${s.orders} orders, ${s.customers} customers`);
        await fetchProducts();
      } else {
        showToast(`Sync error: ${data.error}`);
      }
    } catch (err) {
      showToast(`Sync failed: ${err instanceof Error ? err.message : "An unknown error occurred"}`);
    } finally {
      setSyncing(false);
    }
  };

  const [editingSku, setEditingSku] = useState<Record<number, string>>({});
  const [savingSku, setSavingSku] = useState<Record<number, boolean>>({});
  const [expandedVariantSkus, setExpandedVariantSkus] = useState<Record<number, boolean>>({});

  const toggleVariantSkus = (variantId: number) => {
    setExpandedVariantSkus(prev => ({ ...prev, [variantId]: !prev[variantId] }));
  };

  const getVariantCustomSkus = (variant: ShopifyVariant, productId: number) => {
    const allSkus = customSkus[productId] || [];
    const variantSize = (variant.option1 || variant.title || "").trim().toUpperCase();
    
    return allSkus.filter((skuItem: any) => {
      const skuSize = (skuItem.size || "").trim().toUpperCase();
      return skuSize === variantSize || 
             `SIZE ${skuSize}` === variantSize || 
             variantSize === `SIZE ${skuSize}` ||
             (variantSize === 'DEFAULT TITLE' && skuSize === 'DEFAULT') ||
             (variantSize === 'STANDARD' && skuSize === 'STANDARD');
    });
  };

  const handleSkuChange = (variantId: number, value: string) => {
    setEditingSku(prev => ({ ...prev, [variantId]: value }));
  };

  const saveSku = async (variantId: number, currentSku: string) => {
    const newSku = editingSku[variantId];
    if (newSku === undefined || newSku === currentSku) {
      setEditingSku(prev => {
        const n = { ...prev };
        delete n[variantId];
        return n;
      });
      return;
    }

    setSavingSku(prev => ({ ...prev, [variantId]: true }));
    try {
      const res = await fetch(`/api/shopify/variants/${variantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: newSku }),
      });

      if (res.ok) {
        setProducts(prev => prev.map(p => ({
          ...p,
          variants: p.variants.map(v => v.id === variantId ? { ...v, sku: newSku } : v)
        })));
        showToast(`SKU updated to ${newSku}`);
        setEditingSku(prev => {
          const n = { ...prev };
          delete n[variantId];
          return n;
        });
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
      }
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "An unknown error occurred"}`);
    } finally {
      setSavingSku(prev => ({ ...prev, [variantId]: false }));
    }
  };

  // Toggle product expansion
  const toggleExpand = (productId: number) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else {
        next.add(productId);
        // Fetch custom SKUs for this product
        if (!customSkus[productId]) {
          fetchCustomSkus(productId);
        }
      }
      return next;
    });
  };

  // Filtered products
  const filtered = useMemo(() => {
    return products.filter((p) => {
      // Search filter
      if (search) {
        const q = search.toLowerCase();
        const matchesName = p.title.toLowerCase().includes(q);
        const matchesSku = p.variants.some((v) =>
          (v.sku || "").toLowerCase().includes(q)
        );
        const matchesBarcode = p.variants.some((v) =>
          (v.barcode || "").toLowerCase().includes(q)
        );
        if (!matchesName && !matchesSku && !matchesBarcode) return false;
      }
      // Stock filter
      if (stockFilter !== "all") {
        const totalStock = p.variants.reduce(
          (acc, v) => acc + (v.inventory_quantity || 0),
          0
        );
        if (stockFilter === "out" && totalStock > 0) return false;
        if (stockFilter === "low" && (totalStock >= 5 || totalStock === 0))
          return false;
      }
      return true;
    });
  }, [products, search, stockFilter]);

  // Stats
  const stats = useMemo(() => {
    const totalProducts = products.length;
    const totalVariants = products.reduce((a, p) => a + p.variants.length, 0);
    const totalStock = products.reduce(
      (a, p) => a + p.variants.reduce((b, v) => b + (v.inventory_quantity || 0), 0),
      0
    );
    const lowStock = products.filter((p) => {
      const s = p.variants.reduce((a, v) => a + (v.inventory_quantity || 0), 0);
      return s > 0 && s < 5;
    }).length;
    const outOfStock = products.filter((p) => {
      const s = p.variants.reduce((a, v) => a + (v.inventory_quantity || 0), 0);
      return s === 0;
    }).length;
    return { totalProducts, totalVariants, totalStock, lowStock, outOfStock };
  }, [products]);

  if (loading && products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-5 h-5 text-foreground/40 animate-spin" />
        <span className="text-[11px] font-medium text-foreground/40 tracking-wide">
          Loading Inventory…
        </span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="pb-12 space-y-5 relative z-10"
    >
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className="fixed top-6 left-1/2 z-50 glass-panel px-5 py-2.5 text-[11px] font-medium text-foreground flex items-center gap-2.5 shadow-2xl !rounded-full"
          >
            <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            Inventory
          </h1>
          <p className="text-[12px] text-foreground/50 mt-0.5">
            Manage stock levels across {stats.totalProducts} products · {stats.totalVariants} variants
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchProducts(true)}
            disabled={loading}
            className="glass-button flex items-center gap-2 px-4 py-2 text-[11px] font-medium !rounded-lg disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={runSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-[11px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {syncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            Force Sync
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Units", value: stats.totalStock.toLocaleString("en-IN"), color: "text-foreground" },
          { label: "Products", value: stats.totalProducts, color: "text-foreground" },
          { label: "Low Stock", value: stats.lowStock, color: stats.lowStock > 0 ? "text-amber-500" : "text-foreground" },
          { label: "Out of Stock", value: stats.outOfStock, color: stats.outOfStock > 0 ? "text-red-500" : "text-foreground" },
        ].map((stat) => (
          <div key={stat.label} className="glass-panel !rounded-xl px-4 py-3">
            <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-1">
              {stat.label}
            </p>
            <p className={`text-lg font-semibold ${stat.color}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
          <input
            className="glass-input w-full pl-10 pr-4 py-2.5 text-[13px] !rounded-xl"
            placeholder="Search by name, SKU, or barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground/60"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 p-1 glass-panel !rounded-xl">
          {([
            { key: "all" as StockFilter, label: "All" },
            { key: "low" as StockFilter, label: "Low Stock" },
            { key: "out" as StockFilter, label: "Out of Stock" },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStockFilter(key)}
              className={`px-3.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                stockFilter === key
                  ? "bg-foreground text-background shadow-sm"
                  : "text-foreground/50 hover:text-foreground/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 glass-panel !rounded-xl px-4 py-3 !border-red-500/20">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-[12px] font-medium text-red-500">{error}</p>
        </div>
      )}

      {/* Product List */}
      <div className="glass-panel !rounded-2xl overflow-hidden !p-0">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <PackageSearch className="w-8 h-8 text-foreground/15 mb-3" />
            <h3 className="text-[13px] font-medium text-foreground/60">
              {search ? "No matching products" : "No products found"}
            </h3>
            <p className="text-[11px] text-foreground/30 mt-1">
              {search ? "Try a different search term" : "Connect your Shopify store to see products"}
            </p>
          </div>
        ) : (
          <>
            {/* Table Header — desktop only */}
            <div className="hidden md:grid grid-cols-[1fr,100px,100px,80px] gap-4 px-5 py-3 border-b border-foreground/[0.06] bg-foreground/[0.02]">
              <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider">Product</span>
              <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider text-center">Variants</span>
              <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider text-center">Stock</span>
              <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider text-center">Status</span>
            </div>

            <div className="divide-y divide-foreground/[0.04]">
              {filtered.map((product) => {
                const totalStock = product.variants.reduce(
                  (acc, v) => acc + (v.inventory_quantity || 0),
                  0
                );
                const isExpanded = expandedProducts.has(product.id);
                const isLowStock = totalStock > 0 && totalStock < 5;
                const isOutOfStock = totalStock === 0;

                return (
                  <div key={product.id}>
                    {/* Product Row */}
                    <button
                      onClick={() => toggleExpand(product.id)}
                      className="w-full grid grid-cols-[1fr,auto] md:grid-cols-[1fr,100px,100px,80px] gap-4 items-center px-5 py-3.5 hover:bg-foreground/[0.02] transition-colors text-left"
                    >
                      {/* Product Info */}
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-10 h-10 rounded-lg border border-foreground/[0.06] flex items-center justify-center shrink-0 overflow-hidden bg-foreground/[0.02]">
                          {product.image ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={product.image.src}
                              alt={product.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <PackageSearch className="w-4 h-4 text-foreground/20" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-[13px] font-medium text-foreground truncate">
                            {product.title}
                          </h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            {product.vendor && (
                              <span className="text-[10px] text-foreground/40">
                                {product.vendor}
                              </span>
                            )}
                            {product.product_type && (
                              <>
                                <span className="text-foreground/15">·</span>
                                <span className="text-[10px] text-foreground/40">
                                  {product.product_type}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Variants count — desktop */}
                      <div className="hidden md:flex justify-center">
                        <span className="glass-badge">
                          {product.variants.length} SKU{product.variants.length !== 1 ? "s" : ""}
                        </span>
                      </div>

                      {/* Stock — desktop */}
                      <div className="hidden md:flex justify-center">
                        <span
                          className={`text-[14px] font-semibold tabular-nums ${
                            isOutOfStock
                              ? "text-red-500"
                              : isLowStock
                                ? "text-amber-500"
                                : "text-foreground"
                          }`}
                        >
                          {totalStock}
                        </span>
                      </div>

                      {/* Status indicator — desktop */}
                      <div className="hidden md:flex justify-center">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            isOutOfStock
                              ? "bg-red-500"
                              : isLowStock
                                ? "bg-amber-500 animate-pulse"
                                : "bg-emerald-500"
                          }`}
                        />
                      </div>

                      {/* Mobile: stock + chevron */}
                      <div className="flex md:hidden items-center gap-3">
                        <div className="text-right">
                          <span
                            className={`text-[14px] font-semibold tabular-nums ${
                              isOutOfStock
                                ? "text-red-500"
                                : isLowStock
                                  ? "text-amber-500"
                                  : "text-foreground"
                            }`}
                          >
                            {totalStock}
                          </span>
                          <p className="text-[9px] text-foreground/35 mt-0.5">
                            {product.variants.length} SKU{product.variants.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                        <ChevronDown
                          className={`w-4 h-4 text-foreground/30 transition-transform duration-300 ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </div>

                      {/* Desktop chevron */}
                      <ChevronDown
                        className={`hidden md:block w-4 h-4 text-foreground/30 transition-transform duration-300 absolute right-5 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                        style={{ position: "relative", right: "auto" }}
                      />
                    </button>

                    {/* Expanded Variant Sub-table */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="bg-foreground/[0.015] border-t border-foreground/[0.04]">
                            {/* Variant header — desktop */}
                            <div className="hidden md:grid grid-cols-[1fr,140px,120px,160px,56px] gap-3 px-5 pl-[72px] py-2 border-b border-foreground/[0.04]">
                              <span className="text-[9px] font-semibold text-foreground/30 uppercase tracking-wider">Variant</span>
                              <span className="text-[9px] font-semibold text-foreground/30 uppercase tracking-wider">SKU</span>
                              <span className="text-[9px] font-semibold text-foreground/30 uppercase tracking-wider text-center">Price</span>
                              <span className="text-[9px] font-semibold text-foreground/30 uppercase tracking-wider text-center">Quantity</span>
                              <span />
                            </div>

                            {product.variants.map((variant) => {
                              const pendingDelta = deltas[variant.id] || 0;
                              const isLoading = !!adjusting[variant.id];
                              const isSavingSku = !!savingSku[variant.id];
                              const displayQty = (variant.inventory_quantity || 0) + pendingDelta;
                              const isVariantLow = displayQty < 5 && displayQty > 0;
                              const isVariantOut = displayQty <= 0;
                              const currentEditingSku = editingSku[variant.id];
                              const vCustomSkus = getVariantCustomSkus(variant, product.id);
                              const isSkuExpanded = !!expandedVariantSkus[variant.id];

                              return (
                                <div key={variant.id} className="border-b border-foreground/[0.03] last:border-b-0 py-3">
                                  <div className="grid grid-cols-1 md:grid-cols-[1fr,140px,120px,160px,56px] gap-3 px-5 pl-6 md:pl-[72px] items-center">
                                    {/* Variant name */}
                                    <div className="flex items-center gap-2.5">
                                      <div
                                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                          isVariantOut
                                            ? "bg-red-500"
                                            : isVariantLow
                                              ? "bg-amber-500"
                                              : "bg-emerald-500"
                                        }`}
                                      />
                                      <div className="flex flex-col min-w-0">
                                        <span className="text-[12px] font-medium text-foreground truncate">
                                          {variant.title === "Default Title" ? "Standard" : variant.title}
                                        </span>
                                        {vCustomSkus.length > 0 && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); toggleVariantSkus(variant.id); }}
                                            className="text-[9px] font-bold text-[#007AFF] hover:opacity-80 flex items-center gap-0.5 mt-0.5 text-left bg-transparent border-none p-0 cursor-pointer"
                                          >
                                            <span>{vCustomSkus.length} tag SKU{vCustomSkus.length > 1 ? 's' : ''}</span>
                                            <ChevronDown className={`w-2.5 h-2.5 transition-transform ${isSkuExpanded ? 'rotate-180' : ''}`} />
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {/* SKU — editable */}
                                    <div className="flex items-center">
                                      {currentEditingSku !== undefined ? (
                                        <div className="flex items-center gap-1 w-full">
                                          <input
                                            autoFocus
                                            type="text"
                                            value={currentEditingSku}
                                            onChange={(e) => handleSkuChange(variant.id, e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") saveSku(variant.id, variant.sku || "");
                                              if (e.key === "Escape") setEditingSku((prev) => {
                                                const n = { ...prev };
                                                delete n[variant.id];
                                                return n;
                                              });
                                            }}
                                            className="glass-input text-[11px] w-full px-2 py-1 font-mono !rounded-md"
                                          />
                                          <button
                                            onClick={() => saveSku(variant.id, variant.sku || "")}
                                            disabled={isSavingSku}
                                            className="text-foreground/50 hover:text-foreground shrink-0"
                                          >
                                            {isSavingSku ? (
                                              <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                              <Check className="w-3 h-3" />
                                            )}
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => handleSkuChange(variant.id, variant.sku || "")}
                                          className="text-[11px] text-foreground/40 font-mono hover:text-foreground transition-colors truncate text-left"
                                        >
                                          {variant.sku || "—"}
                                        </button>
                                      )}
                                    </div>

                                    {/* Price */}
                                    <div className="hidden md:flex justify-center">
                                      <span className="text-[12px] text-foreground/60 tabular-nums">
                                        ₹{parseFloat(variant.price || "0").toLocaleString("en-IN")}
                                      </span>
                                    </div>

                                    {/* Quantity stepper */}
                                    <div className="flex items-center justify-center gap-2">
                                      <div className="flex items-center gap-0 border border-foreground/[0.08] rounded-lg overflow-hidden bg-background">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleDelta(variant.id, -1); }}
                                          disabled={isLoading}
                                          className="w-8 h-8 flex items-center justify-center text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-40 transition-colors"
                                        >
                                          <Minus className="w-3 h-3" />
                                        </button>
                                        <div className="w-12 h-8 flex items-center justify-center border-x border-foreground/[0.08]">
                                          <span
                                            className={`text-[13px] font-semibold tabular-nums ${
                                              isVariantOut
                                                ? "text-red-500"
                                                : isVariantLow
                                                  ? "text-amber-500"
                                                  : "text-foreground"
                                            }`}
                                          >
                                            {displayQty}
                                          </span>
                                        </div>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleDelta(variant.id, 1); }}
                                          disabled={isLoading}
                                          className="w-8 h-8 flex items-center justify-center text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-40 transition-colors"
                                        >
                                          <Plus className="w-3 h-3" />
                                        </button>
                                      </div>

                                      {/* Pending delta badge */}
                                      {pendingDelta !== 0 && (
                                        <span
                                          className={`text-[10px] font-semibold tabular-nums ${
                                            pendingDelta > 0 ? "text-emerald-500" : "text-red-500"
                                          }`}
                                        >
                                          {pendingDelta > 0 ? "+" : ""}{pendingDelta}
                                        </span>
                                      )}
                                    </div>

                                    {/* Apply button */}
                                    <div className="flex justify-center">
                                      <AnimatePresence>
                                        {pendingDelta !== 0 && (
                                          <motion.button
                                            initial={{ opacity: 0, scale: 0.8 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.8 }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              applyAdjustment(variant, product.title);
                                            }}
                                            disabled={isLoading}
                                            className="w-8 h-8 bg-foreground text-background rounded-lg flex items-center justify-center disabled:opacity-50 hover:opacity-90 transition-opacity"
                                          >
                                            {isLoading ? (
                                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                              <Check className="w-3.5 h-3.5" />
                                            )}
                                          </motion.button>
                                        )}
                                      </AnimatePresence>
                                    </div>
                                  </div>

                                  {/* Collapsible tags block */}
                                  <AnimatePresence>
                                    {isSkuExpanded && vCustomSkus.length > 0 && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                                        className="overflow-hidden px-5 pl-12 md:pl-[96px] pr-8 mt-3"
                                      >
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-foreground/[0.03]">
                                          {vCustomSkus.map((skuItem: any) => (
                                            <div 
                                              key={skuItem.id} 
                                              className="flex items-center justify-between p-2.5 rounded-xl border border-foreground/[0.04] bg-foreground/[0.015] hover:bg-foreground/[0.03] transition-colors"
                                            >
                                              <div className="min-w-0">
                                                <p className="text-[10px] font-mono font-bold text-foreground select-all truncate">{skuItem.sku}</p>
                                                <p className="text-[8px] text-foreground/30 font-bold uppercase tracking-wider">Created: {new Date(skuItem.created_at).toLocaleDateString()}</p>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <div className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border ${
                                                  skuItem.status === 'IN_STOCK'
                                                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                                                    : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
                                                }`}>
                                                  {skuItem.status.replace('_', ' ')}
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              );
                            })}

                            {/* Printed SKUs section */}
                            <div className="border-t border-foreground/[0.04] p-5 pl-6 md:pl-[72px] space-y-4">
                              <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                  <h4 className="text-[10px] font-bold text-foreground/45 uppercase tracking-[0.2em]">
                                    Printed Price Tag SKUs
                                  </h4>
                                  <p className="text-[8px] text-foreground/30 uppercase tracking-widest">
                                    Individually generated stock tags mapped to this product
                                  </p>
                                </div>
                                <button
                                  onClick={() => fetchCustomSkus(product.id)}
                                  className="text-[9px] font-bold uppercase tracking-widest text-[#007AFF] hover:opacity-80 flex items-center gap-1.5"
                                >
                                  <RefreshCw className={`w-3 h-3 ${loadingSkus[product.id] ? 'animate-spin' : ''}`} />
                                  Sync SKUs
                                </button>
                              </div>

                              {loadingSkus[product.id] && !customSkus[product.id] ? (
                                <div className="flex items-center gap-2 py-4">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-foreground/20" />
                                  <span className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">Decrypting registry...</span>
                                </div>
                              ) : customSkus[product.id] && customSkus[product.id].length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2 hide-scrollbar">
                                  {customSkus[product.id].map((skuItem: any) => (
                                    <div
                                      key={skuItem.id}
                                      className="flex items-center justify-between p-3.5 rounded-xl border border-foreground/5 bg-foreground/[0.01] hover:bg-foreground/[0.02] transition-colors"
                                    >
                                      <div className="space-y-1">
                                        <p className="text-[11px] font-mono font-bold text-foreground select-all">
                                          {skuItem.sku}
                                        </p>
                                        <p className="text-[8px] font-black text-foreground/30 uppercase tracking-[0.15em] flex items-center gap-1.5">
                                          Size: {skuItem.size} | Created: {new Date(skuItem.created_at).toLocaleDateString()}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <div className={`px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest ${
                                          skuItem.status === 'IN_STOCK'
                                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                                            : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
                                        }`}>
                                          {skuItem.status.replace('_', ' ')}
                                        </div>
                                        <span className="text-[11px] font-black text-foreground/40 font-mono">
                                          QTY: {skuItem.quantity}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest italic py-4">
                                  No printed price tag SKUs found for this product. Use the Price Tags generator to create tags.
                                </p>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Results count */}
      {filtered.length > 0 && (
        <p className="text-[11px] text-foreground/30 text-center">
          Showing {filtered.length} of {products.length} products
        </p>
      )}
    </motion.div>
  );
}
