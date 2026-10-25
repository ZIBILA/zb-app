"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Package,
  Save,
  Search,
  Check,
  Loader2,
  PanelTop,
  Layers,
  Menu as MenuIcon,
  Eye,
  EyeOff,
  Filter,
  X,
  CheckSquare,
  Square,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { cachedAdminFetch, invalidateAdminCache } from "@/lib/adminClientCache";

interface ShopifyCollection {
  id: string;
  title: string;
  handle: string;
  image: { src: string } | null;
  products?: { id: number }[];
  productsCount?: number;
  products_count?: number;
}

type VisibilityFilter = "all" | "full" | "partial" | "hidden";

export default function CollectionsAdminPage() {
  const [collections, setCollections] = useState<ShopifyCollection[]>([]);
  const [enabled, setEnabled] = useState<{
    header: string[];
    page: string[];
    menu: string[];
  }>({
    header: [],
    page: [],
    menu: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [success, setSuccess] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Advanced filter state
  const [showFilters, setShowFilters] = useState(true);
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [productCountFilter, setProductCountFilter] = useState<"all" | "0-10" | "10-50" | "50+">("all");

  useEffect(() => {
    fetchData();
  }, []);

  const syncFromShopify = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/collections/sync", { method: "POST" });
      if (res.ok) {
        invalidateAdminCache("/api/admin/collections");
        await fetchData(true);
      }
    } catch (err) {
      console.error("Failed to sync from Shopify:", err);
    } finally {
      setSyncing(false);
    }
  };

  async function fetchData(silent = false) {
    if (!silent && collections.length === 0) setLoading(true);
    try {
      const data = await cachedAdminFetch<any>("/api/admin/collections", {
        skipCache: silent,
        ttlMs: 60_000,
      });
      if (data.allCollections) {
        setCollections(data.allCollections);
        setEnabled(data.enabled);
      }
    } catch (err) {
      console.error("Failed to fetch collections:", err);
    } finally {
      setLoading(false);
    }
  }

  const toggleLocation = (handle: string, location: "header" | "page" | "menu") => {
    setEnabled((prev) => ({
      ...prev,
      [location]: prev[location].includes(handle)
        ? prev[location].filter((h) => h !== handle)
        : [...prev[location], handle],
    }));
  };

  const syncAll = () => {
    const allHandles = collections.map((c) => c.handle);
    setEnabled({
      header: allHandles,
      page: allHandles,
      menu: allHandles,
    });
  };

  const desyncAll = () => {
    setEnabled({
      header: [],
      page: [],
      menu: [],
    });
  };

  // Select/deselect all for a specific column
  const toggleColumnAll = (location: "header" | "page" | "menu") => {
    const visibleHandles = filteredCollections.map((c) => c.handle);
    const allEnabled = visibleHandles.every((h) => enabled[location].includes(h));

    if (allEnabled) {
      // Deselect all visible
      setEnabled((prev) => ({
        ...prev,
        [location]: prev[location].filter((h) => !visibleHandles.includes(h)),
      }));
    } else {
      // Select all visible
      setEnabled((prev) => ({
        ...prev,
        [location]: [...new Set([...prev[location], ...visibleHandles])],
      }));
    }
  };

  const saveChanges = async () => {
    setSaving(true);
    setSuccess(false);
    try {
      const res = await fetch("/api/admin/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enabled),
      });
      if (res.ok) {
        invalidateAdminCache("/api/admin/collections");
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      console.error("Failed to save changes:", err);
    } finally {
      setSaving(false);
    }
  };

  // Get visibility status for a collection
  const getVisibilityStatus = useCallback((handle: string): "full" | "partial" | "hidden" => {
    const inHeader = enabled.header.includes(handle);
    const inPage = enabled.page.includes(handle);
    const inMenu = enabled.menu.includes(handle);
    if (inHeader && inPage && inMenu) return "full";
    if (!inHeader && !inPage && !inMenu) return "hidden";
    return "partial";
  }, [enabled]);

  // Filtered collections with advanced filters
  const filteredCollections = useMemo(() => {
    return collections.filter((c) => {
      // Text search
      if (searchQuery && !c.title.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      // Visibility filter
      if (visibilityFilter !== "all") {
        const status = getVisibilityStatus(c.handle);
        if (visibilityFilter !== status) return false;
      }
      // Product count filter
      if (productCountFilter !== "all") {
        const count = Number(c.productsCount ?? c.products_count ?? c.products?.length ?? 0);
        if (productCountFilter === "0-10" && count > 10) return false;
        if (productCountFilter === "10-50" && (count < 10 || count > 50)) return false;
        if (productCountFilter === "50+" && count < 50) return false;
      }
      return true;
    });
  }, [collections, searchQuery, visibilityFilter, productCountFilter, getVisibilityStatus]);

  // Stats
  const stats = useMemo(() => {
    const full = collections.filter((c) => getVisibilityStatus(c.handle) === "full").length;
    const partial = collections.filter((c) => getVisibilityStatus(c.handle) === "partial").length;
    const hidden = collections.filter((c) => getVisibilityStatus(c.handle) === "hidden").length;
    return { total: collections.length, full, partial, hidden };
  }, [collections, getVisibilityStatus]);

  const hasActiveFilters = visibilityFilter !== "all" || productCountFilter !== "all";

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-5 h-5 text-foreground/40 animate-spin" />
        <span className="text-[11px] font-medium text-foreground/40 tracking-wide">
          Loading Collections…
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
      {/* Success Toast */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className="fixed top-6 left-1/2 z-50 glass-panel px-5 py-2.5 text-[11px] font-medium text-foreground flex items-center gap-2.5 shadow-2xl !rounded-full"
          >
            <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            Collection visibility saved successfully
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            Collections
          </h1>
          <p className="text-[12px] text-foreground/50 mt-0.5">
            Control where each collection appears across platforms
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={syncFromShopify}
            disabled={syncing}
            className="glass-button flex items-center gap-2 px-3.5 py-2 text-[11px] font-medium !rounded-lg disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Sync from Shopify
          </button>
          <button
            onClick={syncAll}
            className="glass-button flex items-center gap-2 px-3.5 py-2 text-[11px] font-medium !rounded-lg"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            Enable All
          </button>
          <button
            onClick={desyncAll}
            className="glass-button flex items-center gap-2 px-3.5 py-2 text-[11px] font-medium !rounded-lg"
          >
            <Square className="w-3.5 h-3.5" />
            Disable All
          </button>
          <button
            onClick={saveChanges}
            disabled={saving}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-[11px] font-medium transition-all disabled:opacity-50 ${
              success
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-foreground text-background hover:opacity-90"
            }`}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : success ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {saving ? "Saving…" : success ? "Saved" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total", value: stats.total, color: "text-foreground" },
          { label: "Fully Visible", value: stats.full, color: "text-emerald-500" },
          { label: "Partial", value: stats.partial, color: "text-amber-500" },
          { label: "Hidden", value: stats.hidden, color: stats.hidden > 0 ? "text-red-500" : "text-foreground" },
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

      {/* Search + Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
          <input
            type="text"
            placeholder="Search collections…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="glass-input w-full pl-10 pr-4 py-2.5 text-[13px] !rounded-xl"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground/60"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`glass-button flex items-center gap-2 px-4 py-2 text-[11px] font-medium !rounded-xl transition-all ${
            hasActiveFilters ? "!border-foreground/20 !text-foreground" : ""
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {hasActiveFilters && (
            <span className="w-1.5 h-1.5 rounded-full bg-foreground" />
          )}
          <ChevronDown
            className={`w-3 h-3 transition-transform duration-200 ${
              showFilters ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      {/* Advanced Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="glass-panel !rounded-xl px-5 py-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-semibold text-foreground">
                  Advanced Filters
                </h3>
                {hasActiveFilters && (
                  <button
                    onClick={() => {
                      setVisibilityFilter("all");
                      setProductCountFilter("all");
                    }}
                    className="text-[10px] font-medium text-foreground/40 hover:text-foreground transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Visibility Status */}
                <div>
                  <label className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider block mb-2">
                    Visibility Status
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { key: "all" as VisibilityFilter, label: "All" },
                      { key: "full" as VisibilityFilter, label: "Fully Visible" },
                      { key: "partial" as VisibilityFilter, label: "Partial" },
                      { key: "hidden" as VisibilityFilter, label: "Hidden" },
                    ]).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setVisibilityFilter(key)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
                          visibilityFilter === key
                            ? "bg-foreground text-background border-foreground"
                            : "border-foreground/[0.08] text-foreground/50 hover:text-foreground/80 hover:border-foreground/15"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Product Count */}
                <div>
                  <label className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider block mb-2">
                    Product Count
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { key: "all" as const, label: "All" },
                      { key: "0-10" as const, label: "0–10" },
                      { key: "10-50" as const, label: "10–50" },
                      { key: "50+" as const, label: "50+" },
                    ]).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setProductCountFilter(key)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
                          productCountFilter === key
                            ? "bg-foreground text-background border-foreground"
                            : "border-foreground/[0.08] text-foreground/50 hover:text-foreground/80 hover:border-foreground/15"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collections Table */}
      <div className="glass-panel !rounded-2xl overflow-hidden !p-0">
        {/* Platform Labels Row */}
        <div className="hidden md:grid grid-cols-[1fr,240px] gap-2 px-5 py-2.5 border-b border-foreground/[0.04] bg-foreground/[0.015]">
          <div />
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col items-center gap-0.5">
              <div className="flex items-center gap-1 text-foreground/30">
                <PanelTop className="w-3 h-3" />
              </div>
              <span className="text-[8px] font-medium text-foreground/30 uppercase tracking-wider">Header</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <div className="flex items-center gap-1 text-foreground/30">
                <Layers className="w-3 h-3" />
              </div>
              <span className="text-[8px] font-medium text-foreground/30 uppercase tracking-wider">Page</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <div className="flex items-center gap-1 text-foreground/30">
                <MenuIcon className="w-3 h-3" />
              </div>
              <span className="text-[8px] font-medium text-foreground/30 uppercase tracking-wider">Menu</span>
            </div>
          </div>
        </div>

        {/* Select All Row */}
        <div className="hidden md:grid grid-cols-[1fr,240px] gap-2 px-5 py-2 border-b border-foreground/[0.06] bg-foreground/[0.02]">
          <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider self-center">
            Collection ({filteredCollections.length})
          </span>
          <div className="grid grid-cols-3 gap-2">
            {(["header", "page", "menu"] as const).map((loc) => {
              const visibleHandles = filteredCollections.map((c) => c.handle);
              const allChecked = visibleHandles.length > 0 && visibleHandles.every((h) => enabled[loc].includes(h));
              return (
                <div key={loc} className="flex justify-center">
                  <button
                    onClick={() => toggleColumnAll(loc)}
                    className={`w-7 h-7 rounded-md flex items-center justify-center transition-all border text-[9px] font-medium ${
                      allChecked
                        ? "bg-foreground text-background border-foreground"
                        : "border-foreground/[0.08] text-foreground/30 hover:border-foreground/15 hover:text-foreground/50"
                    }`}
                    title={`${allChecked ? "Deselect" : "Select"} all for ${loc}`}
                  >
                    {allChecked ? <Check className="w-3 h-3" /> : "All"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Collection Rows */}
        <div className="divide-y divide-foreground/[0.03]">
          <AnimatePresence>
            {filteredCollections.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Package className="w-8 h-8 text-foreground/15 mb-3" />
                <h3 className="text-[13px] font-medium text-foreground/60">
                  No collections found
                </h3>
                <p className="text-[11px] text-foreground/30 mt-1">
                  {searchQuery || hasActiveFilters
                    ? "Try adjusting your filters"
                    : "No collections available"}
                </p>
              </div>
            ) : (
              filteredCollections.map((collection) => {
                const visStatus = getVisibilityStatus(collection.handle);

                return (
                  <motion.div
                    layout
                    key={collection.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="grid grid-cols-1 md:grid-cols-[1fr,240px] gap-3 md:gap-2 px-5 py-3.5 items-center hover:bg-foreground/[0.015] transition-colors"
                  >
                    {/* Collection Info */}
                    <div className="flex items-center gap-3.5">
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden border border-foreground/[0.06] bg-foreground/[0.02] shrink-0">
                        {collection.image?.src ? (
                          <Image
                            src={collection.image.src}
                            alt={collection.title}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package className="w-4 h-4 text-foreground/15" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dashboard/collections/${collection.id}`}
                            className="text-[13px] font-medium text-foreground hover:text-foreground/75 hover:underline truncate flex items-center gap-1.5"
                          >
                            {collection.title}
                            <span className="text-[9px] text-foreground/45 font-normal border border-foreground/[0.08] px-1.5 py-0.5 rounded bg-foreground/[0.02]">
                              Manage
                            </span>
                          </Link>
                          <div
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              visStatus === "full"
                                ? "bg-emerald-500"
                                : visStatus === "partial"
                                  ? "bg-amber-500"
                                  : "bg-foreground/15"
                            }`}
                          />
                        </div>
                        <p className="text-[11px] text-foreground/40 mt-0.5">
                          {Number(collection.productsCount ?? collection.products_count ?? collection.products?.length ?? 0)} products
                        </p>
                      </div>
                    </div>

                    {/* Toggles — Desktop */}
                    <div className="hidden md:grid grid-cols-3 gap-2">
                      <VisibilityToggle
                        active={enabled.header.includes(collection.handle)}
                        onClick={() => toggleLocation(collection.handle, "header")}
                      />
                      <VisibilityToggle
                        active={enabled.page.includes(collection.handle)}
                        onClick={() => toggleLocation(collection.handle, "page")}
                      />
                      <VisibilityToggle
                        active={enabled.menu.includes(collection.handle)}
                        onClick={() => toggleLocation(collection.handle, "menu")}
                      />
                    </div>

                    {/* Toggles — Mobile */}
                    <div className="grid md:hidden grid-cols-3 gap-2">
                      {(["header", "page", "menu"] as const).map((loc) => (
                        <button
                          key={loc}
                          onClick={() => toggleLocation(collection.handle, loc)}
                          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-medium transition-all border ${
                            enabled[loc].includes(collection.handle)
                              ? "bg-foreground text-background border-foreground"
                              : "border-foreground/[0.08] text-foreground/40"
                          }`}
                        >
                          {enabled[loc].includes(collection.handle) ? (
                            <Eye className="w-3 h-3" />
                          ) : (
                            <EyeOff className="w-3 h-3" />
                          )}
                          <span className="capitalize">{loc}</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Results count */}
      {filteredCollections.length > 0 && (
        <p className="text-[11px] text-foreground/30 text-center">
          Showing {filteredCollections.length} of {collections.length} collections
        </p>
      )}
    </motion.div>
  );
}

function VisibilityToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <div className="flex justify-center">
      <button
        onClick={onClick}
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 border ${
          active
            ? "bg-foreground text-background border-foreground shadow-sm"
            : "bg-transparent text-foreground/25 border-foreground/[0.08] hover:border-foreground/15 hover:text-foreground/50"
        }`}
      >
        {active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
