"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { 
  Heart, 
  Search, 
  Filter, 
  Download, 
  User, 
  Smartphone, 
  ExternalLink,
  Mail,
  MoreVertical,
  Zap,
  RefreshCw,
  Trash2,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  Package,
  Layers,
  Pause,
  Play,
  IndianRupee,
  MessageCircle,
  Eye
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";

interface WishlistItem {
  id: string;
  createdAt: string;
  size: string | null;
  variantId: string | null;
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    image: string | null;
    ordersCount: number;
    totalSpent: number;
    createdAt: string;
  };
  product: {
    id: string;
    title: string;
    featuredImage: string | null;
    handle: string;
    price: number;
    shopifyProductId: string;
    cleanShopifyId: string;
    inStock: boolean;
  };
}

export default function AdminWishlistPage() {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "inStock" | "outOfStock">("all");
  const [leadFilter, setLeadFilter] = useState<"all" | "phone" | "email">("all");
  const [sizeFilter, setSizeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "priceHigh" | "productName">("newest");
  
  // Real-time sync state
  const [isLiveSync, setIsLiveSync] = useState(true);
  const [lastSynced, setLastSynced] = useState<Date>(new Date());
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Interval timer ref
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchWishlists = async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/wishlist", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch wishlists");
      const data = await res.json();
      if (data.items && Array.isArray(data.items)) {
        setItems(data.items);
        setLastSynced(new Date());
        setSecondsAgo(0);
      }
    } catch (error) {
      console.error("Error fetching wishlists:", error);
      if (!isSilent) toast.error("Failed to sync wishlist data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWishlists();
  }, []);

  // Live sync: poll every 30s when the tab is visible (was 6s)
  useEffect(() => {
    if (isLiveSync) {
      timerRef.current = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        fetchWishlists(true);
      }, 30_000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isLiveSync]);

  // Relative "updated Xs ago" — 15s ticks avoid a 1Hz re-render storm
  useEffect(() => {
    syncTimerRef.current = setInterval(() => {
      setSecondsAgo((prev) => prev + 15);
    }, 15_000);
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, []);

  // Delete wishlist item
  const handleDelete = async (id: string, productTitle: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/wishlist?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete wishlist item");
      
      setItems((prev) => prev.filter((item) => item.id !== id));
      toast.success(`Removed "${productTitle}" from wishlist`);
    } catch (err) {
      console.error("Error deleting item:", err);
      toast.error("Could not remove item");
    } finally {
      setDeletingId(null);
    }
  };

  // Export dataset to CSV
  const handleExportCSV = () => {
    if (items.length === 0) {
      toast.error("No items available to export");
      return;
    }

    const headers = [
      "Wishlist ID",
      "Customer Name",
      "Customer Email",
      "Customer Phone",
      "Product Title",
      "Selected Size",
      "Price (INR)",
      "Shopify Product ID",
      "Stock Status",
      "Added Date"
    ];

    const rows = filteredItems.map(item => [
      `"${item.id}"`,
      `"${item.customer.name.replace(/"/g, '""')}"`,
      `"${item.customer.email || ''}"`,
      `"${item.customer.phone || ''}"`,
      `"${item.product.title.replace(/"/g, '""')}"`,
      `"${item.size || 'N/A'}"`,
      item.product.price,
      `"${item.product.cleanShopifyId}"`,
      `"${item.product.inStock ? 'In Stock' : 'Out of Stock'}"`,
      `"${new Date(item.createdAt).toLocaleString('en-IN')}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `zica_bella_wishlist_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Wishlist CSV report downloaded");
  };

  // Available unique sizes for filter
  const availableSizes = useMemo(() => {
    const sizes = new Set<string>();
    items.forEach((i) => {
      if (i.size) sizes.add(i.size);
    });
    return Array.from(sizes);
  }, [items]);

  // Top wishlisted products computation
  const topProducts = useMemo(() => {
    const counts = new Map<string, { title: string; image: string | null; count: number; price: number }>();
    items.forEach((item) => {
      const key = item.product.id || item.product.title;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, {
          title: item.product.title,
          image: item.product.featuredImage,
          count: 1,
          price: item.product.price,
        });
      }
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 4);
  }, [items]);

  // Filter and sort items
  const filteredItems = useMemo(() => {
    return items
      .filter((item) => {
        // Safe string search
        const custName = (item.customer?.name || "").toLowerCase();
        const custPhone = item.customer?.phone || "";
        const custEmail = (item.customer?.email || "").toLowerCase();
        const prodTitle = (item.product?.title || "").toLowerCase();
        const itemSize = (item.size || "").toLowerCase();
        const q = searchTerm.toLowerCase();

        const matchesSearch =
          custName.includes(q) ||
          custPhone.includes(q) ||
          custEmail.includes(q) ||
          prodTitle.includes(q) ||
          itemSize.includes(q);

        if (!matchesSearch) return false;

        // Stock filter
        if (stockFilter === "inStock" && !item.product.inStock) return false;
        if (stockFilter === "outOfStock" && item.product.inStock) return false;

        // Lead filter
        if (leadFilter === "phone" && !item.customer.phone) return false;
        if (leadFilter === "email" && !item.customer.email) return false;

        // Size filter
        if (sizeFilter !== "all" && item.size !== sizeFilter) return false;

        return true;
      })
      .sort((a, b) => {
        if (sortBy === "newest") {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        if (sortBy === "oldest") {
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
        if (sortBy === "priceHigh") {
          return b.product.price - a.product.price;
        }
        if (sortBy === "productName") {
          return a.product.title.localeCompare(b.product.title);
        }
        return 0;
      });
  }, [items, searchTerm, stockFilter, leadFilter, sizeFilter, sortBy]);

  // Stats calculation
  const totalWishlistValue = useMemo(() => {
    return items.reduce((acc, curr) => acc + (curr.product.price || 0), 0);
  }, [items]);

  const uniqueUsersCount = useMemo(() => {
    return new Set(items.map((i) => i.customer.id)).size;
  }, [items]);

  const activeLeadsCount = useMemo(() => {
    return items.filter((i) => !!i.customer.phone).length;
  }, [items]);

  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    return `${diffDays}d ago`;
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-16">
      {/* Header section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground via-foreground to-foreground/60 bg-clip-text text-transparent">
              Wishlist Intelligence
            </h1>
            
            {/* Live Sync Badge */}
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[11px] font-semibold">
              {isLiveSync ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span>Live Sync</span>
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span className="text-amber-500">Sync Paused</span>
                </>
              )}
            </div>
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">
            Real-time webstore customer bookmarks, conversion intent signals, and retargeting leads.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Pause / Play Live Sync Toggle */}
          <button
            onClick={() => setIsLiveSync(!isLiveSync)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[12px] font-medium transition-all ${
              isLiveSync 
                ? "bg-foreground/5 border-foreground/10 text-foreground hover:bg-foreground/10" 
                : "bg-amber-500/10 border-amber-500/20 text-amber-500 hover:bg-amber-500/20"
            }`}
          >
            {isLiveSync ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isLiveSync ? "Pause Live Sync" : "Resume Live Sync"}
          </button>

          {/* Manual Refresh Button */}
          <button 
            onClick={() => fetchWishlists(false)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-foreground/5 border border-foreground/10 text-[12px] font-medium hover:bg-foreground/10 transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-foreground" : "opacity-60"}`} />
            Refresh
          </button>

          {/* Export CSV Button */}
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-foreground text-background text-[12px] font-bold shadow-md hover:brightness-95 active:scale-95 transition-all"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Sync Status Bar */}
      <div className="flex items-center justify-between px-6 py-2.5 rounded-2xl bg-foreground/[0.02] border border-foreground/5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          Showing {filteredItems.length} of {items.length} total saved items across webstore & app
        </span>
        <span>
          Updated {secondsAgo < 5 ? "just now" : `${secondsAgo}s ago`}
        </span>
      </div>

      {/* Stats cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-6 rounded-[2rem] glass border border-foreground/5 space-y-3 relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <div className="p-3 rounded-2xl bg-rose-500/10 text-rose-500">
              <Heart className="w-5 h-5 fill-rose-500/20" />
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500">
              Wishlisted
            </span>
          </div>
          <div>
            <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-wider">Total Wishlisted Items</p>
            <p className="text-3xl font-extrabold tracking-tight mt-1">{items.length}</p>
          </div>
        </div>

        <div className="p-6 rounded-[2rem] glass border border-foreground/5 space-y-3 relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <div className="p-3 rounded-2xl bg-blue-500/10 text-blue-500">
              <User className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500">
              Customers
            </span>
          </div>
          <div>
            <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-wider">Unique Customer Leads</p>
            <p className="text-3xl font-extrabold tracking-tight mt-1">{uniqueUsersCount}</p>
          </div>
        </div>

        <div className="p-6 rounded-[2rem] glass border border-foreground/5 space-y-3 relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-500">
              <Smartphone className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500">
              WhatsApp Ready
            </span>
          </div>
          <div>
            <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-wider">Phone Leads Captured</p>
            <p className="text-3xl font-extrabold tracking-tight mt-1">{activeLeadsCount}</p>
          </div>
        </div>

        <div className="p-6 rounded-[2rem] glass border border-foreground/5 space-y-3 relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-500">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500">
              Pipeline
            </span>
          </div>
          <div>
            <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-wider">Wishlist Value Potential</p>
            <p className="text-3xl font-extrabold tracking-tight mt-1">₹{totalWishlistValue.toLocaleString('en-IN')}</p>
          </div>
        </div>
      </div>

      {/* Top Wishlisted Products Preview */}
      {topProducts.length > 0 && (
        <div className="p-6 rounded-[2.5rem] glass border border-foreground/5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-bold uppercase tracking-widest text-foreground/70 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
              High-Demand Saved Pieces
            </h2>
            <span className="text-[11px] text-muted-foreground">Most saved items right now</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {topProducts.map((p, idx) => (
              <div key={idx} className="flex items-center gap-3 p-3 rounded-2xl bg-foreground/[0.02] border border-foreground/5">
                <div className="relative w-12 h-14 rounded-xl overflow-hidden bg-foreground/5 shrink-0">
                  {p.image ? (
                    <Image src={p.image} alt={p.title} fill className="object-cover" />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Heart className="w-4 h-4 opacity-20" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-bold truncate">{p.title}</p>
                  <p className="text-[11px] text-muted-foreground font-semibold">₹{p.price.toLocaleString('en-IN')}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
                      {p.count} {p.count === 1 ? 'save' : 'saves'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Table Container */}
      <div className="rounded-[2.5rem] glass border border-foreground/5 overflow-hidden">
        {/* Controls header */}
        <div className="p-6 border-b border-foreground/5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
            <input 
              type="text" 
              placeholder="Search customer, phone, email, product or size..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-2.5 rounded-2xl bg-foreground/5 border border-foreground/10 text-[13px] focus:outline-none focus:ring-2 focus:ring-foreground/20 transition-all placeholder:text-foreground/30"
            />
          </div>

          {/* Filters & Sorting */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Stock Filter */}
            <select
              value={stockFilter}
              onChange={(e: any) => setStockFilter(e.target.value)}
              className="px-3.5 py-2.5 rounded-2xl bg-foreground/5 border border-foreground/10 text-[12px] font-medium focus:outline-none transition-all cursor-pointer"
            >
              <option value="all">All Stock Status</option>
              <option value="inStock">In Stock Only</option>
              <option value="outOfStock">Out of Stock Only</option>
            </select>

            {/* Lead Filter */}
            <select
              value={leadFilter}
              onChange={(e: any) => setLeadFilter(e.target.value)}
              className="px-3.5 py-2.5 rounded-2xl bg-foreground/5 border border-foreground/10 text-[12px] font-medium focus:outline-none transition-all cursor-pointer"
            >
              <option value="all">All Contacts</option>
              <option value="phone">With Phone Leads</option>
              <option value="email">With Email</option>
            </select>

            {/* Size Filter */}
            {availableSizes.length > 0 && (
              <select
                value={sizeFilter}
                onChange={(e) => setSizeFilter(e.target.value)}
                className="px-3.5 py-2.5 rounded-2xl bg-foreground/5 border border-foreground/10 text-[12px] font-medium focus:outline-none transition-all cursor-pointer"
              >
                <option value="all">All Sizes</option>
                {availableSizes.map((sz) => (
                  <option key={sz} value={sz}>Size: {sz}</option>
                ))}
              </select>
            )}

            {/* Sort options */}
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="px-3.5 py-2.5 rounded-2xl bg-foreground/5 border border-foreground/10 text-[12px] font-medium focus:outline-none transition-all cursor-pointer"
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
              <option value="priceHigh">Sort: Highest Price</option>
              <option value="productName">Sort: Product Name A-Z</option>
            </select>
          </div>
        </div>

        {/* Table view */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-foreground/[0.02] border-b border-foreground/5">
                <th className="px-6 py-4 text-[10px] font-bold text-foreground/40 uppercase tracking-widest">Customer Details</th>
                <th className="px-6 py-4 text-[10px] font-bold text-foreground/40 uppercase tracking-widest">Wishlisted Product</th>
                <th className="px-6 py-4 text-[10px] font-bold text-foreground/40 uppercase tracking-widest text-center">Availability</th>
                <th className="px-6 py-4 text-[10px] font-bold text-foreground/40 uppercase tracking-widest">Added Date</th>
                <th className="px-6 py-4 text-[10px] font-bold text-foreground/40 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/5">
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-6 py-6">
                      <div className="h-12 bg-foreground/5 rounded-2xl" />
                    </td>
                  </tr>
                ))
              ) : filteredItems.length > 0 ? (
                filteredItems.map((item) => {
                  const customerName = item.customer?.name || "Guest Customer";
                  const initial = customerName.charAt(0).toUpperCase() || "C";
                  const phoneFormatted = item.customer?.phone ? item.customer.phone.replace('+', '') : '';

                  return (
                    <tr key={item.id} className="group hover:bg-foreground/[0.015] transition-colors">
                      {/* Customer Column */}
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3.5">
                          <div className="relative w-10 h-10 rounded-2xl bg-foreground/5 flex items-center justify-center text-[13px] font-bold border border-foreground/10 shrink-0 overflow-hidden">
                            {item.customer?.image ? (
                              <Image src={item.customer.image} alt={customerName} fill className="object-cover" />
                            ) : (
                              initial
                            )}
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-[13px] font-bold">{customerName}</p>
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                              {item.customer?.email && (
                                <span className="flex items-center gap-1 opacity-80">
                                  <Mail className="w-3 h-3 opacity-60" />
                                  {item.customer.email}
                                </span>
                              )}
                              {item.customer?.ordersCount > 0 && (
                                <span className="text-[9px] px-2 py-0.5 rounded-md bg-foreground/5 border border-foreground/10 text-foreground/60">
                                  {item.customer.ordersCount} orders · ₹{item.customer.totalSpent.toLocaleString('en-IN')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Product Column */}
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-4">
                          <div className="relative w-12 h-16 rounded-xl overflow-hidden bg-foreground/5 border border-foreground/10 shadow-sm shrink-0">
                            {item.product?.featuredImage ? (
                              <Image 
                                src={item.product.featuredImage} 
                                alt={item.product.title} 
                                fill 
                                className="object-cover"
                              />
                            ) : (
                              <div className="flex items-center justify-center h-full">
                                <Heart className="w-4 h-4 opacity-20" />
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Link 
                              href={`/products/${item.product?.handle || ''}`}
                              target="_blank"
                              className="text-[13px] font-bold hover:underline line-clamp-1 flex items-center gap-1.5"
                            >
                              {item.product?.title || "Unknown Product"}
                              <ExternalLink className="w-3 h-3 opacity-40 inline shrink-0" />
                            </Link>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[12px] font-semibold text-foreground/80">
                                ₹{(item.product?.price || 0).toLocaleString('en-IN')}
                              </span>
                              {item.size && (
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-foreground text-background uppercase tracking-wider">
                                  Size: {item.size}
                                </span>
                              )}
                              {item.product?.cleanShopifyId && (
                                <span className="text-[9px] px-2 py-0.5 rounded-full bg-foreground/5 border border-foreground/10 text-foreground/40 font-mono">
                                  ID: {item.product.cleanShopifyId}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Stock Availability */}
                      <td className="px-6 py-5 text-center">
                        {item.product?.inStock ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            In Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[10px] font-bold uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                            Sold Out
                          </span>
                        )}
                      </td>

                      {/* Added Date Column */}
                      <td className="px-6 py-5">
                        <div>
                          <p className="text-[12px] font-medium text-foreground/80">
                            {new Date(item.createdAt).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatRelativeTime(item.createdAt)}
                          </p>
                        </div>
                      </td>

                      {/* Actions Column */}
                      <td className="px-6 py-5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Direct Phone Call */}
                          {item.customer?.phone && (
                            <a 
                              href={`tel:${item.customer.phone}`}
                              className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 active:scale-95 transition-all"
                              title={`Call ${customerName}`}
                            >
                              <Smartphone className="w-4 h-4" />
                            </a>
                          )}

                          {/* WhatsApp Direct offer link */}
                          {item.customer?.phone && (
                            <a 
                              href={`https://wa.me/${phoneFormatted}?text=Hi%20${encodeURIComponent(customerName)},%20we%20noticed%20you%20saved%20the%20${encodeURIComponent(item.product?.title || 'product')}${item.size ? `%20(Size%20${item.size})` : ''}%20to%20your%20Zica%20Bella%20wishlist!%20Would%20you%20like%20a%20special%20exclusive%20offer%20on%20this%20item?`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 active:scale-95 transition-all"
                              title="Send WhatsApp Retargeting Offer"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </a>
                          )}

                          {/* Send Notification Offer */}
                          <Link 
                            href={`/dashboard/notifications?targetType=user&targetValue=${encodeURIComponent(item.customer?.phone || item.customer?.email || '')}&title=Wishlist%20Offer&body=Hi%20${encodeURIComponent(customerName)},%20the%20${encodeURIComponent(item.product?.title || 'item')}%20is%20waiting%20for%20you!`}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-foreground text-background text-[10px] font-bold uppercase tracking-wider hover:brightness-95 active:scale-95 transition-all shadow-sm"
                          >
                            <Zap className="w-3 h-3 fill-amber-400 text-amber-400" />
                            Offer
                          </Link>

                          {/* Delete Item */}
                          <button 
                            onClick={() => handleDelete(item.id, item.product?.title || 'Product')}
                            disabled={deletingId === item.id}
                            className="p-2.5 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 active:scale-95 transition-all disabled:opacity-50"
                            title="Remove from Wishlist"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-24 text-center">
                    <div className="max-w-xs mx-auto space-y-3">
                      <div className="w-16 h-16 rounded-full bg-foreground/5 border border-foreground/10 flex items-center justify-center mx-auto">
                        <Heart className="w-7 h-7 text-foreground/20" />
                      </div>
                      <p className="text-[14px] font-bold">No wishlist records found</p>
                      <p className="text-[12px] text-muted-foreground">
                        {searchTerm || stockFilter !== "all" || leadFilter !== "all" || sizeFilter !== "all"
                          ? "Try clearing your active search or filter constraints."
                          : "When customers save luxury items on the webstore or mobile app, they will automatically appear here in real-time."}
                      </p>
                      {(searchTerm || stockFilter !== "all" || leadFilter !== "all" || sizeFilter !== "all") && (
                        <button
                          onClick={() => {
                            setSearchTerm("");
                            setStockFilter("all");
                            setLeadFilter("all");
                            setSizeFilter("all");
                          }}
                          className="px-4 py-2 rounded-xl bg-foreground/5 text-[12px] font-semibold hover:bg-foreground/10 transition-all"
                        >
                          Clear Filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
