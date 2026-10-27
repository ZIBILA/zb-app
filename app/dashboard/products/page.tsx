"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  PackageSearch,
  ExternalLink,
  RefreshCw,
  Loader2,
  Eye,
  EyeOff,
  Search,
  Check,
  X,
  ArrowUpDown,
  Rss,
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
  option1: string | null;
  option2: string | null;
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  status: string;
  product_type: string;
  vendor: string;
  tags: string;
  image: { src: string } | null;
  variants: ShopifyVariant[];
}

type SortKey = "title" | "stock" | "price" | "status";
type SortDir = "asc" | "desc";

const SHOPIFY_DOMAIN =
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || "8tiahf-bk.myshopify.com";

export default function ProductsPage() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "draft">("all");
  const [updating, setUpdating] = useState<number | null>(null);
  const [updatingFeed, setUpdatingFeed] = useState<number | null>(null);
  const [feedMap, setFeedMap] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const loadProducts = async (silent = false) => {
    if (!silent && products.length === 0) setLoading(true);
    setError(null);
    try {
      const [data, feedData] = await Promise.all([
        cachedAdminFetch<any>("/api/shopify/products?limit=250", { skipCache: silent, ttlMs: 60_000 }),
        cachedAdminFetch<any>("/api/admin/products-list/feed-toggle", { skipCache: silent, ttlMs: 60_000 }).catch(() => null),
      ]);
      setProducts(data?.products || []);
      if (data?.error) setError(`Shopify API: ${data.error}`);

      if (feedData && feedData.feedMap) {
        setFeedMap(feedData.feedMap);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const toggleFeed = async (product: ShopifyProduct) => {
    const currentInFeed = feedMap[String(product.id)] ?? true;
    const nextInFeed = !currentInFeed;
    setUpdatingFeed(product.id);
    try {
      const res = await fetch("/api/admin/products-list/feed-toggle", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopifyProductId: String(product.id), includeInFeed: nextInFeed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      invalidateAdminCache('/api/admin/products-list/feed-toggle');
      setFeedMap((prev) => ({ ...prev, [String(product.id)]: nextInFeed }));
      showToast(`"${product.title}" ${nextInFeed ? "included in" : "excluded from"} feed`);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Update failed"}`);
    } finally {
      setUpdatingFeed(null);
    }
  };

  const toggleStatus = async (product: ShopifyProduct) => {
    const newStatus = product.status === "active" ? "draft" : "active";
    setUpdating(product.id);
    try {
      const res = await fetch(`/api/shopify/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      invalidateAdminCache('/api/shopify/products');
      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id ? { ...p, status: newStatus } : p
        )
      );
      showToast(`"${product.title}" set to ${newStatus}`);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "An unknown error occurred"}`);
    } finally {
      setUpdating(null);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    const result = products
      .filter((p) => statusFilter === "all" || p.status === statusFilter)
      .filter(
        (p) =>
          !search ||
          p.title.toLowerCase().includes(search.toLowerCase()) ||
          p.vendor.toLowerCase().includes(search.toLowerCase()) ||
          p.variants.some((v) =>
            (v.sku || "").toLowerCase().includes(search.toLowerCase())
          )
      );

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "stock":
          cmp =
            a.variants.reduce((s, v) => s + (v.inventory_quantity || 0), 0) -
            b.variants.reduce((s, v) => s + (v.inventory_quantity || 0), 0);
          break;
        case "price":
          cmp =
            parseFloat(a.variants[0]?.price || "0") -
            parseFloat(b.variants[0]?.price || "0");
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [products, search, statusFilter, sortKey, sortDir]);

  const stats = useMemo(() => ({
    total: products.length,
    active: products.filter((p) => p.status === "active").length,
    draft: products.filter((p) => p.status === "draft").length,
  }), [products]);

  const SortHeader = ({ label, sortId }: { label: string; sortId: SortKey }) => (
    <button
      onClick={() => handleSort(sortId)}
      className="flex items-center gap-1 text-[10px] font-semibold text-foreground/40 uppercase tracking-wider hover:text-foreground/60 transition-colors"
    >
      {label}
      <ArrowUpDown
        className={`w-3 h-3 transition-colors ${
          sortKey === sortId ? "text-foreground/60" : "text-foreground/20"
        }`}
      />
    </button>
  );

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
            Products
          </h1>
          <p className="text-[12px] text-foreground/50 mt-0.5">
            {stats.active} active · {stats.draft} draft · {stats.total} total
          </p>
        </div>
        <button
          onClick={() => loadProducts(true)}
          disabled={loading}
          className="glass-button flex items-center gap-2 px-4 py-2 text-[11px] font-medium !rounded-lg disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
          <input
            className="glass-input w-full pl-10 pr-4 py-2.5 text-[13px] !rounded-xl"
            placeholder="Search products, vendors, SKUs…"
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
          {(["all", "active", "draft"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3.5 py-1.5 rounded-lg text-[11px] font-medium transition-all capitalize ${
                statusFilter === s
                  ? "bg-foreground text-background shadow-sm"
                  : "text-foreground/50 hover:text-foreground/80"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="glass-panel !rounded-xl px-4 py-3 !border-red-500/20">
          <p className="text-[12px] font-medium text-red-500">{error}</p>
        </div>
      )}

      {/* Products Table */}
      <div className="glass-panel !rounded-2xl overflow-hidden !p-0">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-foreground/20" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <PackageSearch className="w-8 h-8 text-foreground/15 mb-3" />
            <h3 className="text-[13px] font-medium text-foreground/60">
              No products found
            </h3>
            <p className="text-[11px] text-foreground/30 mt-1">
              {search ? "Try a different search term" : "No products match the current filter"}
            </p>
          </div>
        ) : (
          <>
            {/* Table Header — desktop */}
            <div className="hidden md:grid grid-cols-[1fr,100px,80px,100px,100px,60px,44px] gap-4 px-5 py-3 border-b border-foreground/[0.06] bg-foreground/[0.02] items-center">
              <SortHeader label="Product" sortId="title" />
              <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider text-center">Type</span>
              <SortHeader label="Stock" sortId="stock" />
              <SortHeader label="Price" sortId="price" />
              <SortHeader label="Status" sortId="status" />
              <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider text-center">Feed</span>
              <span />
            </div>

            <div className="divide-y divide-foreground/[0.04]">
              {filtered.map((product) => {
                const totalStock = product.variants.reduce(
                  (acc, v) => acc + (v.inventory_quantity || 0),
                  0
                );
                const isUpdating = updating === product.id;
                const isLowStock = totalStock > 0 && totalStock < 10;
                const inFeed = feedMap[String(product.id)] ?? true;

                return (
                  <motion.div
                    key={product.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="grid grid-cols-1 md:grid-cols-[1fr,100px,80px,100px,100px,60px,44px] gap-3 md:gap-4 px-5 py-3.5 items-center hover:bg-foreground/[0.015] transition-colors"
                  >
                    {/* Product Info */}
                    <Link
                      href={`/dashboard/products/${product.id}`}
                      className="flex items-center gap-3.5 min-w-0 hover:opacity-80 transition-all cursor-pointer"
                    >
                      <div className="w-11 h-11 rounded-lg border border-foreground/[0.06] flex items-center justify-center shrink-0 overflow-hidden bg-foreground/[0.02]">
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
                        <h3 className="text-[13px] font-medium text-foreground truncate hover:text-foreground/80 transition-colors">
                          {product.title}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          {product.vendor && (
                            <span className="text-[10px] text-foreground/40">
                              {product.vendor}
                            </span>
                          )}
                          <span className="text-[10px] text-foreground/30">
                            {product.variants.length} SKU{product.variants.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                    </Link>

                    {/* Mobile meta row */}
                    <div className="flex md:hidden items-center justify-between gap-3 -mt-1">
                      <div className="flex items-center gap-3">
                        {product.product_type && (
                          <span className="glass-badge text-[9px]">
                            {product.product_type}
                          </span>
                        )}
                        <span className={`text-[13px] font-semibold tabular-nums ${
                          totalStock < 10 ? "text-amber-500" : "text-foreground"
                        }`}>
                          {totalStock} units
                        </span>
                        <span className="text-[12px] text-foreground/50 tabular-nums">
                          ₹{parseFloat(product.variants[0]?.price || "0").toLocaleString("en-IN")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleFeed(product)}
                          disabled={updatingFeed === product.id}
                          className={`p-1.5 rounded-full text-[10px] font-medium transition-all ${
                            inFeed
                              ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                              : "bg-foreground/[0.05] text-foreground/30"
                          }`}
                          title={inFeed ? "Included in product feed" : "Excluded from feed"}
                        >
                          <Rss className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => toggleStatus(product)}
                          disabled={isUpdating}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-medium transition-all disabled:opacity-50 ${
                            product.status === "active"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-foreground/[0.05] text-foreground/50"
                          }`}
                        >
                          {isUpdating ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : product.status === "active" ? (
                            <Eye className="w-3 h-3" />
                          ) : (
                            <EyeOff className="w-3 h-3" />
                          )}
                          {product.status}
                        </button>
                        <a
                          href={`https://${SHOPIFY_DOMAIN}/admin/products/${product.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-foreground/25 hover:text-foreground/60 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>

                    {/* Type — desktop */}
                    <div className="hidden md:flex justify-center">
                      {product.product_type ? (
                        <span className="glass-badge text-[9px]">
                          {product.product_type}
                        </span>
                      ) : (
                        <span className="text-foreground/20">—</span>
                      )}
                    </div>

                    {/* Stock — desktop */}
                    <div className="hidden md:flex justify-center">
                      <span
                        className={`text-[13px] font-semibold tabular-nums ${
                          totalStock === 0
                            ? "text-red-500"
                            : isLowStock
                              ? "text-amber-500"
                              : "text-foreground"
                        }`}
                      >
                        {totalStock}
                      </span>
                    </div>

                    {/* Price — desktop */}
                    <div className="hidden md:flex justify-center">
                      <span className="text-[13px] text-foreground/70 tabular-nums">
                        ₹{parseFloat(product.variants[0]?.price || "0").toLocaleString("en-IN")}
                      </span>
                    </div>

                    {/* Status toggle — desktop */}
                    <div className="hidden md:flex justify-center">
                      <button
                        onClick={() => toggleStatus(product)}
                        disabled={isUpdating}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-medium transition-all disabled:opacity-50 ${
                          product.status === "active"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-foreground/[0.05] text-foreground/50"
                        }`}
                      >
                        {isUpdating ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : product.status === "active" ? (
                          <Eye className="w-3 h-3" />
                        ) : (
                          <EyeOff className="w-3 h-3" />
                        )}
                        {product.status}
                      </button>
                    </div>

                    {/* Feed toggle — desktop */}
                    <div className="hidden md:flex justify-center">
                      <button
                        onClick={() => toggleFeed(product)}
                        disabled={updatingFeed === product.id}
                        className={`p-2 rounded-lg transition-all disabled:opacity-50 ${
                          inFeed
                            ? "text-sky-500 hover:bg-sky-500/10"
                            : "text-foreground/20 hover:text-foreground/40 hover:bg-foreground/[0.05]"
                        }`}
                        title={inFeed ? "Included in /feed.xml (Click to exclude)" : "Excluded from /feed.xml (Click to include)"}
                      >
                        {updatingFeed === product.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Rss className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {/* Shopify link — desktop */}
                    <div className="hidden md:flex justify-center">
                      <a
                        href={`https://${SHOPIFY_DOMAIN}/admin/products/${product.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg text-foreground/25 hover:text-foreground/60 hover:bg-foreground/[0.03] transition-all"
                        title="Open in Shopify Admin"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Results count */}
      {!loading && filtered.length > 0 && (
        <p className="text-[11px] text-foreground/30 text-center">
          Showing {filtered.length} of {products.length} products
        </p>
      )}
    </motion.div>
  );
}
