"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Package,
  ShoppingCart,
  Loader2,
  Save,
  Check,
  GripVertical,
  DollarSign,
  ArrowUpDown,
  Search,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence, Reorder } from "framer-motion";

interface Product {
  id: number;
  title: string;
  handle: string;
  image: { src: string } | null;
  variants: { price: string; inventory_quantity?: number }[];
  created_at: string;
}

interface Order {
  id: string;
  shopifyOrderName: string | null;
  createdAt: string;
  totalPrice: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  customer: {
    name: string | null;
    email: string | null;
  } | null;
  items: {
    id: string;
    title: string;
    quantity: number;
    price: number;
  }[];
}

interface Collection {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  image: { src: string } | null;
}

export default function CollectionDetailsPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadedRef = useRef(false);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  
  const [activeTab, setActiveTab] = useState<"products" | "orders">("products");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<string>("custom");
  const [datePreset, setDatePreset] = useState<"today" | "yesterday" | "last7" | "month" | "custom">("last7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [stats, setStats] = useState({ totalProducts: 0, totalOrders: 0, totalSales: 0 });

  const fetchData = useCallback(async () => {
    fetchAbortRef.current?.abort();
    const ac = new AbortController();
    fetchAbortRef.current = ac;

    if (loadedRef.current) setRefreshing(true);
    else setLoading(true);

    try {
      const qs = new URLSearchParams({ range: datePreset });
      if (datePreset === "custom") {
        if (customFrom) qs.set("from", customFrom);
        if (customTo) qs.set("to", customTo);
      }
      const res = await fetch(`/api/admin/collections/${params.id}?${qs.toString()}`, {
        signal: ac.signal,
      });
      const data = await res.json();
      if (res.ok) {
        loadedRef.current = true;
        setCollection(data.collection);

        const sortedProducts = [...(data.products || [])];
        const customOrder: string[] = data.customOrder || [];
        if (customOrder.length > 0) {
          const orderMap = new Map<string, number>();
          customOrder.forEach((id, idx) => orderMap.set(String(id), idx));
          sortedProducts.sort((a, b) => {
            const aIdx = orderMap.has(String(a.id)) ? orderMap.get(String(a.id))! : 999999;
            const bIdx = orderMap.has(String(b.id)) ? orderMap.get(String(b.id))! : 999999;
            return aIdx - bIdx;
          });
        }

        setProducts(sortedProducts);
        setOrders(data.orders || []);
        if (data.stats) {
          setStats({
            totalProducts: data.stats.totalProducts ?? sortedProducts.length,
            totalOrders: data.stats.totalOrders ?? (data.orders || []).length,
            totalSales: data.stats.totalSales ?? 0,
          });
        }
      } else {
        console.error("Failed to load collection details:", data.error);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      console.error("Fetch collection details error:", err);
    } finally {
      if (fetchAbortRef.current === ac) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [params.id, datePreset, customFrom, customTo]);

  useEffect(() => {
    if (datePreset === "custom" && (!customFrom || !customTo)) return;
    fetchData();
  }, [fetchData, datePreset, customFrom, customTo]);

  const handleSortChange = (type: string) => {
    setSortBy(type);
    if (type === "custom") return;

    const sorted = [...products].sort((a, b) => {
      if (type === "title-asc") return a.title.localeCompare(b.title);
      if (type === "title-desc") return b.title.localeCompare(a.title);
      if (type === "price-asc") {
        const aPrice = parseFloat(a.variants?.[0]?.price || "0");
        const bPrice = parseFloat(b.variants?.[0]?.price || "0");
        return aPrice - bPrice;
      }
      if (type === "price-desc") {
        const aPrice = parseFloat(a.variants?.[0]?.price || "0");
        const bPrice = parseFloat(b.variants?.[0]?.price || "0");
        return bPrice - aPrice;
      }
      if (type === "stock-desc") {
        const aStock = a.variants?.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0) || 0;
        const bStock = b.variants?.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0) || 0;
        return bStock - aStock;
      }
      if (type === "newest") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return 0;
    });
    setProducts(sorted);
  };

  const saveOrder = async () => {
    setSaving(true);
    setSuccess(false);
    try {
      const res = await fetch(`/api/admin/collections/${params.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: products.map(p => p.id) }),
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      console.error("Save product order error:", err);
    } finally {
      setSaving(false);
    }
  };

  const filteredProducts = useMemo(() => {
    if (!searchQuery) return products;
    return products.filter(
      p =>
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.handle.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [products, searchQuery]);

  const filteredOrders = useMemo(() => {
    if (!searchQuery) return orders;
    const query = searchQuery.toLowerCase();
    return orders.filter(
      o =>
        (o.shopifyOrderName && o.shopifyOrderName.toLowerCase().includes(query)) ||
        (o.customer &&
          ((o.customer.name && o.customer.name.toLowerCase().includes(query)) ||
            (o.customer.email && o.customer.email.toLowerCase().includes(query))))
    );
  }, [orders, searchQuery]);

  if (loading && !collection) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-5 h-5 text-foreground/40 animate-spin" />
        <span className="text-[11px] font-medium text-foreground/40 tracking-wide">
          Loading Collection details…
        </span>
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <Package className="w-8 h-8 text-foreground/15" />
        <h3 className="text-[13px] font-medium text-foreground/60">Collection not found</h3>
        <button onClick={() => router.back()} className="glass-button text-[11px] px-4 py-2 mt-2">
          Go Back
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="pb-12 space-y-6 relative z-10 font-sans"
    >
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className="fixed top-6 left-1/2 z-50 glass-panel px-5 py-2.5 text-[11px] font-medium text-foreground flex items-center gap-2.5 shadow-2xl !rounded-full"
          >
            <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            Collection product order saved successfully
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push("/dashboard/collections")}
          className="flex items-center gap-2 text-[11px] font-medium text-foreground/50 hover:text-foreground transition-colors group"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to Collections
        </button>

        {activeTab === "products" && (
          <button
            onClick={saveOrder}
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
            {saving ? "Saving Order…" : success ? "Order Saved" : "Save Product Order"}
          </button>
        )}
      </div>

      <div className="glass-panel !rounded-2xl p-5 md:p-6 flex flex-col md:flex-row gap-5 items-start md:items-center">
        <div className="relative w-16 h-16 md:w-20 md:h-20 rounded-xl overflow-hidden border border-foreground/[0.06] bg-foreground/[0.02] shrink-0">
          {collection.image?.src ? (
            <Image src={collection.image.src} alt={collection.title} fill className="object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package className="w-6 h-6 text-foreground/15" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-xl md:text-2xl font-semibold text-foreground tracking-tight">
            {collection.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-foreground/45">
            <span className="font-mono bg-foreground/[0.04] px-1.5 py-0.5 rounded">
              Handle: {collection.handle}
            </span>
            <span className="font-mono bg-foreground/[0.04] px-1.5 py-0.5 rounded">
              ID: {collection.id}
            </span>
          </div>
          {collection.body_html && (
            <p className="text-[12px] text-foreground/60 leading-relaxed pt-1.5 max-w-2xl" 
               dangerouslySetInnerHTML={{ __html: collection.body_html }} />
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { id: "today" as const, label: "Today" },
            { id: "yesterday" as const, label: "Yesterday" },
            { id: "last7" as const, label: "Last 7 Days" },
            { id: "month" as const, label: "This Month" },
            { id: "custom" as const, label: "Custom Range" },
          ]).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setDatePreset(opt.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                datePreset === opt.id
                  ? "bg-foreground text-background border-foreground"
                  : "border-foreground/[0.08] text-foreground/50 hover:text-foreground/80"
              }`}
            >
              {refreshing && datePreset === opt.id && (
                <Loader2 className="w-3 h-3 animate-spin" />
              )}
              {opt.label}
            </button>
          ))}
        </div>
        {datePreset === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="glass-input text-[11px] py-1.5 px-2 !rounded-lg"
            />
            <span className="text-[11px] text-foreground/40">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="glass-input text-[11px] py-1.5 px-2 !rounded-lg"
            />
          </div>
        )}
      </div>
      <p className="text-[10px] text-foreground/40 -mt-3">
        Revenue and order count include only successful prepaid and COD-upfront payments for this period. Failed, pending, and unpaid orders are excluded.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: "Total Products", value: stats.totalProducts, icon: Package, color: "text-foreground" },
          { label: "Successful Orders", value: stats.totalOrders, icon: ShoppingCart, color: "text-amber-500" },
          {
            label: "Collection Revenue",
            value: new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(stats.totalSales),
            icon: DollarSign,
            color: "text-emerald-500",
          },
        ].map((stat) => (
          <div key={stat.label} className="glass-panel !rounded-xl px-5 py-4 flex items-center justify-between relative overflow-hidden">
            {refreshing && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/55 backdrop-blur-[1px]">
                <Loader2 className="w-4 h-4 text-foreground/50 animate-spin" />
              </div>
            )}
            <div className={refreshing ? "opacity-40" : ""}>
              <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-1">
                {stat.label}
              </p>
              <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
            <div className={`w-10 h-10 rounded-lg bg-foreground/[0.02] border border-foreground/[0.04] flex items-center justify-center ${refreshing ? "opacity-40" : ""}`}>
              <stat.icon className="w-4 h-4 text-foreground/40" />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-foreground/[0.05] pb-2">
        <div className="flex gap-4">
          {[
            { id: "products", label: `Products (${products.length})` },
            { id: "orders", label: `Orders (${stats.totalOrders})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as any);
                setSearchQuery("");
              }}
              className={`text-[12px] font-semibold tracking-wider uppercase pb-2.5 transition-all relative ${
                activeTab === tab.id
                  ? "text-foreground"
                  : "text-foreground/40 hover:text-foreground/70"
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="activeTabUnderline"
                  className="absolute bottom-0 inset-x-0 h-[2px] bg-foreground"
                />
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
            <input
              type="text"
              placeholder={activeTab === "products" ? "Search products…" : "Search orders…"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="glass-input pl-9 pr-7 py-1.5 text-[11px] font-medium !rounded-lg w-full sm:w-[180px] focus:sm:w-[240px] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground/35 hover:text-foreground/60"
              >
                &times;
              </button>
            )}
          </div>

          {activeTab === "products" && (
            <div className="flex items-center gap-1.5 bg-foreground/[0.02] border border-foreground/[0.05] px-2.5 py-1.5 rounded-lg">
              <ArrowUpDown className="w-3.5 h-3.5 text-foreground/40" />
              <select
                value={sortBy}
                onChange={(e) => handleSortChange(e.target.value)}
                className="bg-transparent text-[11px] font-semibold text-foreground/70 outline-none cursor-pointer"
              >
                <option value="custom">Custom Order (Drag)</option>
                <option value="title-asc">Title: A-Z</option>
                <option value="title-desc">Title: Z-A</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="stock-desc">Stock: High to Low</option>
                <option value="newest">Created: Newest</option>
              </select>
            </div>
          )}
        </div>
      </div>

      <div>
        {activeTab === "products" ? (
          <div className="glass-panel !rounded-2xl overflow-hidden !p-0">
            <div className="grid grid-cols-[40px,50px,1fr,100px,100px] gap-4 px-5 py-3 border-b border-foreground/[0.05] bg-foreground/[0.02] text-[10px] font-bold text-foreground/40 uppercase tracking-wider">
              <div className="text-center">Sort</div>
              <div>Image</div>
              <div>Product Title</div>
              <div className="text-right">Price</div>
              <div className="text-right">Stock</div>
            </div>

            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Package className="w-8 h-8 text-foreground/15 mb-2" />
                <p className="text-[12px] font-medium text-foreground/40">No products found</p>
              </div>
            ) : sortBy === "custom" && !searchQuery ? (
              <Reorder.Group axis="y" values={products} onReorder={setProducts} className="divide-y divide-foreground/[0.03]">
                {filteredProducts.map((product) => {
                  const stock = product.variants?.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0) || 0;
                  const price = parseFloat(product.variants?.[0]?.price || "0");
                  
                  return (
                    <Reorder.Item
                      key={product.id}
                      value={product}
                      className="grid grid-cols-[40px,50px,1fr,100px,100px] gap-4 px-5 py-3 items-center hover:bg-foreground/[0.015] bg-background/50 transition-colors"
                    >
                      <div className="cursor-grab active:cursor-grabbing text-foreground/30 hover:text-foreground/60 transition-colors py-1.5 flex items-center justify-center">
                        <GripVertical className="w-3.5 h-3.5" />
                      </div>
                      <div className="relative w-9 h-9 rounded border border-foreground/[0.06] overflow-hidden bg-foreground/[0.02]">
                        {product.image?.src ? (
                          <Image src={product.image.src} alt={product.title} fill className="object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package className="w-3 h-3 text-foreground/15" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-[12px] font-medium text-foreground truncate">{product.title}</h4>
                        <p className="text-[10px] text-foreground/40 truncate font-mono">handle: {product.handle}</p>
                      </div>
                      <div className="text-right text-[11px] font-semibold font-mono text-foreground/75">
                        {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(price)}
                      </div>
                      <div className="text-right text-[11px] font-medium font-mono text-foreground/60">
                        {stock} units
                      </div>
                    </Reorder.Item>
                  );
                })}
              </Reorder.Group>
            ) : (
              <div className="divide-y divide-foreground/[0.03]">
                {filteredProducts.map((product) => {
                  const stock = product.variants?.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0) || 0;
                  const price = parseFloat(product.variants?.[0]?.price || "0");
                  
                  return (
                    <div
                      key={product.id}
                      className="grid grid-cols-[40px,50px,1fr,100px,100px] gap-4 px-5 py-3 items-center hover:bg-foreground/[0.015] transition-colors"
                    >
                      <div className="text-foreground/15 text-[10px] font-mono flex items-center justify-center">-</div>
                      <div className="relative w-9 h-9 rounded border border-foreground/[0.06] overflow-hidden bg-foreground/[0.02]">
                        {product.image?.src ? (
                          <Image src={product.image.src} alt={product.title} fill className="object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package className="w-3 h-3 text-foreground/15" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-[12px] font-medium text-foreground truncate">{product.title}</h4>
                        <p className="text-[10px] text-foreground/40 truncate font-mono">handle: {product.handle}</p>
                      </div>
                      <div className="text-right text-[11px] font-semibold font-mono text-foreground/75">
                        {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(price)}
                      </div>
                      <div className="text-right text-[11px] font-medium font-mono text-foreground/60">
                        {stock} units
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="glass-panel !rounded-2xl overflow-hidden !p-0">
            <div className="grid grid-cols-[100px,1fr,120px,100px,120px,120px] gap-4 px-5 py-3 border-b border-foreground/[0.05] bg-foreground/[0.02] text-[10px] font-bold text-foreground/40 uppercase tracking-wider">
              <div>Order</div>
              <div>Customer</div>
              <div>Date</div>
              <div className="text-right">Total</div>
              <div className="text-center">Fulfillment</div>
              <div className="text-center">Payment</div>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <ShoppingCart className="w-8 h-8 text-foreground/15 mb-2" />
                <p className="text-[12px] font-medium text-foreground/40">No orders found containing products from this collection</p>
              </div>
            ) : (
              <div className="divide-y divide-foreground/[0.03]">
                {filteredOrders.map((order) => {
                  const customerName = order.customer?.name?.trim() || "Walk-in Customer";
                  
                  return (
                    <div
                      key={order.id}
                      className="grid grid-cols-[100px,1fr,120px,100px,120px,120px] gap-4 px-5 py-3.5 items-center hover:bg-foreground/[0.015] transition-colors"
                    >
                      <div>
                        <Link
                          href={`/dashboard/orders`}
                          className="text-[11px] font-semibold text-foreground hover:underline"
                        >
                          {order.shopifyOrderName || `#${order.id.slice(-5)}`}
                        </Link>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-foreground truncate">{customerName}</p>
                        {order.customer?.email && (
                          <p className="text-[9px] text-foreground/45 truncate font-mono">{order.customer.email}</p>
                        )}
                      </div>
                      <div className="text-[11px] text-foreground/50 font-medium">
                        {new Date(order.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                      <div className="text-right text-[11px] font-bold font-mono text-foreground/75">
                        {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(order.totalPrice)}
                      </div>
                      <div className="flex justify-center">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide border ${
                          order.fulfillmentStatus?.toLowerCase() === "fulfilled"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                        }`}>
                          {order.fulfillmentStatus || "unfulfilled"}
                        </span>
                      </div>
                      <div className="flex justify-center">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide border ${
                          ["paid", "cod_upfront_paid", "success", "captured"].includes(String(order.paymentStatus || "").toLowerCase())
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                        }`}>
                          {order.paymentStatus || "pending"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
