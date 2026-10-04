"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  PackageSearch,
  ShoppingCart,
  Users,
  Loader2,
  RefreshCw,
  Activity,
  ArrowUpRight,
  Undo2,
  ArrowLeftRight,
  Clock,
  CheckCircle2,
  Shield,
  Lock,
  Eye,
  ArrowRight,
} from "lucide-react";
import { motion } from "framer-motion";

interface DashboardStats {
  totalRevenue: number;
  totalOrders: number;
  totalCustomers: number;
  totalProducts: number;
  lowStockItems: number;
  recentOrders: {
    id: number;
    name: string;
    total_price: string;
    financial_status: string;
    fulfillment_status: string | null;
    customer: { first_name: string; last_name: string } | null;
    created_at: string;
  }[];
  lowStockProducts: {
    title: string;
    sku: string | null;
    stock: number;
    variant: string;
  }[];
}

interface ServiceSummary {
  pendingReturns: number;
  pendingExchanges: number;
  totalReturns: number;
  totalExchanges: number;
  recentActivity: {
    id: string;
    type: "return" | "exchange";
    status: string;
    productTitle: string;
    customerName: string;
    date: string;
    orderId: string;
  }[];
}

const PAGE_NAMES: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/support": "Support Center",
  "/dashboard/orders": "Orders Management",
  "/dashboard/mobile-orders": "Mobile App Orders",
  "/dashboard/customers": "Customer Accounts",
  "/dashboard/products": "Products Catalog",
  "/dashboard/collections": "Collections Manager",
  "/dashboard/inventory": "Inventory Controls",
  "/dashboard/inventory/scanner": "Barcode Scanner",
  "/dashboard/scanner-records": "Scanner Scan History",
  "/dashboard/price-tags": "Price Tags Generator",
  "/dashboard/returns": "Returns Processing",
  "/dashboard/exchanges": "Exchanges Processing",
  "/dashboard/logistics": "Logistics Dispatch",
  "/web-store": "Storefront Analytics",
  "/web-store/orders": "Storefront Orders",
  "/web-store/customers": "Storefront Customers",
  "/web-store/storefront": "Web Builder Pages",
  "/web-store/banners": "Homepage Banners",
  "/web-store/gallery": "Public Gallery CMS",
  "/web-store/coupons": "Promo Coupons",
  "/web-store/logins": "Customer Logins Feed",
  "/dashboard/webstore-settings/preferences": "Store Preferences",
  "/dashboard/community/chat": "Chat Console",
  "/dashboard/community": "Community Feed",
  "/dashboard/blogs": "Blog Editor",
  "/dashboard/marketing/seo": "SEO Optimization",
  "/dashboard/analytics": "Dashboard Analytics",
  "/dashboard/marketing/analytics": "Omnichannel Tracking",
  "/dashboard/marketing/meta-pixel": "Meta Pixel Tracker",
  "/dashboard/wishlist": "Wishlist Analytics",
  "/dashboard/notifications": "Push Notifications",
  "/dashboard/marketing/discounts": "Discount Engine",
  "/dashboard/marketing/whatsapp": "WhatsApp Campaigns",
  "/dashboard/marketing/email": "Email Campaigns",
  "/dashboard/marketing/sms": "SMS Campaigns",
  "/dashboard/whatsapp-events/overview": "WA Events overview",
  "/dashboard/whatsapp-events/events": "WA Events Feed",
  "/dashboard/whatsapp-events/campaign-analytics": "WA Campaign Analytics",
  "/dashboard/whatsapp-events/templates": "WA Templates Manager",
  "/dashboard/whatsapp-events/customer-journeys": "WA Journeys Feed",
  "/dashboard/whatsapp-events/meta-review": "WA Meta Review",
  "/dashboard/payments": "Payments Board",
  "/dashboard/payments/store-credits": "Store Credits Wallet",
  "/dashboard/payments/refunds": "Refunds Queue",
  "/dashboard/refunds": "Refunds Queue",
  "/dashboard/manufacturing": "Manufacturing Hub",
  "/dashboard/manufacturing/designs": "Design Assignments",
  "/dashboard/manufacturing/samples": "Sample Room",
  "/dashboard/manufacturing/tasks": "Work Order Tasks",
  "/dashboard/manufacturing/production": "Production Tracker",
  "/dashboard/manufacturing/fabric": "Fabric Ledger",
  "/dashboard/manufacturing/movement": "Fabric Dispatch",
  "/dashboard/manufacturing/vendors": "Vendor Contacts",
  "/dashboard/manufacturing/costs": "Cost Sheets",
  "/dashboard/manufacturing/knowledge-base": "SOP Manuals",
  "/dashboard/manufacturing/employees": "Staff Logs",
  "/dashboard/manufacturing/reports": "Factory Audits",
  "/dashboard/app-integration": "App Keys Config",
  "/dashboard/live-carts": "Live Shoppers",
  "/dashboard/app-logins": "App Sessions",
  "/dashboard/payments/razorpay": "Razorpay Settings",
  "/dashboard/settings": "General Settings",
  "/dashboard/admin-users": "Administrators Panel",
  "/dashboard/audit-log": "System Audit Trail",
};

export default function DashboardOverview() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [serviceSummary, setServiceSummary] = useState<ServiceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/dashboard/login');
    }
  }, [status, router]);

  const user = session?.user as any;
  const permissions = user?.permissions || [];
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const hasDashboardHome = isSuperAdmin || permissions.some((p: any) => p.module === "DASHBOARD_HOME" && p.canView);

  const refreshInFlight = useRef(false);
  const lastRefreshAt = useRef(0);

  const fetchStats = async (silent = false) => {
    if (!silent && !stats) setLoading(true);
    try {
      // Sequential fetches avoid DB/Shopify connection stampedes on poll
      const orderLimit = silent ? 10 : 50;
      const productLimit = silent ? 50 : 100;
      const customerLimit = silent ? 20 : 50;

      const ordersRes = await fetch(`/api/shopify/orders?limit=${orderLimit}`);
      const ordersData = await ordersRes.json();
      const orders = ordersData.orders || [];

      const productsRes = await fetch(`/api/shopify/products?limit=${productLimit}`);
      const productsData = await productsRes.json();
      const products = productsData.products || [];

      const customersRes = await fetch(`/api/shopify/customers?limit=${customerLimit}`);
      const customersData = await customersRes.json();
      const customers = customersData.customers || [];

      const totalRevenue = orders.reduce(
        (sum: number, o: any) => sum + parseFloat(o.total_price || "0"),
        0
      );

      const lowStockProducts: DashboardStats["lowStockProducts"] = [];
      for (const p of products) {
        for (const v of p.variants || []) {
          if (v.inventory_quantity !== null && v.inventory_quantity < 10) {
            lowStockProducts.push({
              title: p.title,
              sku: v.sku,
              stock: v.inventory_quantity,
              variant: v.title !== "Default Title" ? v.title : "",
            });
          }
        }
      }
      lowStockProducts.sort((a, b) => a.stock - b.stock);

      setStats({
        totalRevenue,
        totalOrders: orders.length,
        totalCustomers: customers.length,
        totalProducts: products.length,
        lowStockItems: lowStockProducts.length,
        recentOrders: orders.slice(0, 5),
        lowStockProducts: lowStockProducts.slice(0, 6),
      });
    } catch (err) {
      console.error("Dashboard fetch error");
    } finally {
      setLoading(false);
    }
  };

  const fetchStatsOnly = async () => {
    try {
      const ordersRes = await fetch("/api/shopify/orders?limit=5");
      const ordersData = await ordersRes.json();
      const orders = ordersData.orders || [];
      setStats(prev => ({
        totalRevenue: 0,
        totalOrders: 0,
        totalCustomers: 0,
        totalProducts: 0,
        lowStockItems: 0,
        recentOrders: orders.slice(0, 5),
        lowStockProducts: prev?.lowStockProducts || [],
      }));
    } catch (err) {
      console.error("Failed to fetch orders only:", err);
    }
  };

  const fetchLowStockOnly = async () => {
    try {
      const productsRes = await fetch("/api/shopify/products?limit=250");
      const productsData = await productsRes.json();
      const products = productsData.products || [];
      const lowStockProducts: DashboardStats["lowStockProducts"] = [];
      for (const p of products) {
        for (const v of p.variants || []) {
          if (v.inventory_quantity !== null && v.inventory_quantity < 10) {
            lowStockProducts.push({
              title: p.title,
              sku: v.sku,
              stock: v.inventory_quantity,
              variant: v.title !== "Default Title" ? v.title : "",
            });
          }
        }
      }
      lowStockProducts.sort((a, b) => a.stock - b.stock);
      setStats(prev => ({
        totalRevenue: prev?.totalRevenue || 0,
        totalOrders: prev?.totalOrders || 0,
        totalCustomers: prev?.totalCustomers || 0,
        totalProducts: prev?.totalProducts || 0,
        lowStockItems: lowStockProducts.length,
        recentOrders: prev?.recentOrders || [],
        lowStockProducts: lowStockProducts.slice(0, 6),
      }));
    } catch (err) {
      console.error("Failed to fetch low stock products only:", err);
    }
  };

  const fetchServiceSummary = async () => {
    try {
      // Small page size — counts come from statusCounts; avoid loading full history
      const returnsRes = await fetch("/api/admin/returns?status=all&limit=10");
      const returnsData = await returnsRes.json();
      const exchangesRes = await fetch("/api/admin/exchanges?status=all&limit=10");
      const exchangesData = await exchangesRes.json();

      const returns = returnsData.returns || [];
      const exchanges = exchangesData.exchanges || [];
      const returnsSummary = returnsData.statusCounts || returnsData.summary || {};
      const exchangesSummary = exchangesData.statusCounts || exchangesData.summary || {};

      // Build recent activity feed (last 10)
      const activity: ServiceSummary["recentActivity"] = [];

      for (const r of returns.slice(0, 5)) {
        const orderNum = r.order?.internalOrderNumber || r.order?.shopifyOrderName || (r.order?.id ? `#${r.order.id.slice(-6).toUpperCase()}` : "Order");
        activity.push({
          id: r.id,
          type: "return",
          status: r.status || "requested",
          productTitle: r.product?.title || r.orderItem?.title || "Return Item",
          customerName: r.customer?.name || r.order?.customer?.name || "Customer",
          date: r.requestedAt || r.createdAt || r.updatedAt || new Date().toISOString(),
          orderId: orderNum,
        });
      }

      for (const e of exchanges.slice(0, 5)) {
        const orderNum = e.order?.internalOrderNumber || e.order?.shopifyOrderName || (e.order?.id ? `#${e.order.id.slice(-6).toUpperCase()}` : "Order");
        activity.push({
          id: e.id,
          type: "exchange",
          status: e.status || "requested",
          productTitle: `${e.originalProduct?.title || "Item"} → ${e.newProduct?.title || "Exchange Item"}`,
          customerName: e.order?.customer?.name || e.customer?.name || "Customer",
          date: e.createdAt || e.updatedAt || new Date().toISOString(),
          orderId: orderNum,
        });
      }

      activity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setServiceSummary({
        pendingReturns: returnsSummary.requested || 0,
        pendingExchanges: exchangesSummary.requested || 0,
        totalReturns: returns.length,
        totalExchanges: exchanges.length,
        recentActivity: activity.slice(0, 8),
      });
    } catch (err) {
      console.error("Service summary fetch error:", err);
      setServiceSummary({ pendingReturns: 0, pendingExchanges: 0, totalReturns: 0, totalExchanges: 0, recentActivity: [] });
    }
  };

  const fetchServiceSummaryOnly = async () => {
    try {
      await fetchServiceSummary();
    } catch {
      // fetchServiceSummary already handles errors
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/shopify/sync", { method: "POST" });
      const data = await res.json();
      console.log("Sync result:", data);
      await fetchStats();
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!session) return;

    if (hasDashboardHome) {
      fetchStats();
      fetchServiceSummary();
    } else {
      const allowedModules = permissions.filter((p: any) => p.canView).map((p: any) => p.module);
      const fetches = [];
      if (allowedModules.includes("ORDERS")) {
        fetches.push(fetchStatsOnly());
      }
      if (allowedModules.includes("RETURNS_EXCHANGES")) {
        fetches.push(fetchServiceSummaryOnly());
      }
      if (allowedModules.includes("INVENTORY") || allowedModules.includes("PRODUCTS")) {
        fetches.push(fetchLowStockOnly());
      }
      
      Promise.all(fetches).finally(() => {
        setLoading(false);
      });
    }
  }, [session, hasDashboardHome]);

  useEffect(() => {
    if (!hasDashboardHome) return;
    const handleSyncEvent = async () => {
      const now = Date.now();
      // Throttle: skip if a refresh is running or last refresh was < 45s ago
      if (refreshInFlight.current || now - lastRefreshAt.current < 45_000) return;
      refreshInFlight.current = true;
      lastRefreshAt.current = now;
      try {
        await fetchStats(true);
        await fetchServiceSummary();
      } finally {
        refreshInFlight.current = false;
      }
    };
    window.addEventListener("realtime-sync", handleSyncEvent);
    return () => window.removeEventListener("realtime-sync", handleSyncEvent);
  }, [hasDashboardHome]);

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-4 h-4 text-foreground/40 animate-spin" />
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/40">Authenticating session...</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-4 h-4 text-foreground/40 animate-spin" />
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/40">Loading workspace...</span>
      </div>
    );
  }

  if (!hasDashboardHome) {
    const allowedModules = permissions.filter((p: any) => p.canView);
    
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="pb-20 space-y-8"
      >
        {/* Personalized Workspace Header */}
        <div className="glass-card p-8 lg:p-12 rounded-[2rem] lg:rounded-[3rem] relative overflow-hidden mb-8">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full text-[9px] font-bold uppercase tracking-widest">
                <Shield className="w-3 h-3" /> Staff Workspace
              </div>
              <h1 className="text-3xl lg:text-4xl font-bold text-foreground tracking-tight leading-none uppercase">
                Welcome back, {user?.name || "Team Member"}!
              </h1>
              <p className="text-[10px] lg:text-[11px] text-foreground/40 font-semibold uppercase tracking-[0.25em]">
                Your personal operations console and active page permissions
              </p>
            </div>
            
            <div className="flex items-center gap-2 bg-foreground/5 px-4 py-3 rounded-2xl border border-foreground/10">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold text-foreground/60 uppercase tracking-widest">Secure session active</span>
            </div>
          </div>
          <div className="absolute right-0 top-0 w-80 h-80 bg-violet-500/5 blur-3xl rounded-full -z-10" />
        </div>

        {/* Assigned Modules Grid */}
        <div className="space-y-4">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.3em] text-foreground/50 px-2">Assigned Modules</h2>
          {allowedModules.length === 0 ? (
            <div className="glass-card p-12 text-center rounded-[2rem]">
              <Lock className="w-8 h-8 text-foreground/20 mx-auto mb-4" />
              <p className="text-[12px] font-bold text-foreground/60 uppercase tracking-[0.2em]">No Modules Allocated</p>
              <p className="text-[10px] text-foreground/30 uppercase tracking-wider mt-1">Please contact your System Administrator to receive page privileges.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {allowedModules.map((perm: any) => {
                const modulePages = perm.pages ? perm.pages.split(',') : [];
                return (
                  <motion.div
                    key={perm.module}
                    whileHover={{ scale: 1.01 }}
                    className="glass-card p-6 lg:p-8 rounded-[2rem] border border-foreground/5 relative overflow-hidden flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest">Module</span>
                          <h3 className="text-lg font-bold text-foreground uppercase tracking-tight mt-0.5">
                            {perm.module.replace(/_/g, ' ')}
                          </h3>
                        </div>
                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-foreground/5 rounded-lg border border-foreground/10">
                          <Eye className="w-3.5 h-3.5 text-foreground/50" />
                          <span className="text-[8px] font-bold text-foreground/60 uppercase tracking-widest">Active</span>
                        </div>
                      </div>

                      {/* Display Allowed Pages under this Module */}
                      <div className="space-y-2 mt-4">
                        <span className="text-[9px] font-bold text-foreground/20 uppercase tracking-[0.2em] block">Authorized Pages</span>
                        {modulePages.length === 0 ? (
                          <span className="text-[10px] font-medium italic text-foreground/30">No specific pages mapped.</span>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {modulePages.map((pg: string) => (
                              <Link
                                key={pg}
                                href={pg}
                                className="flex items-center justify-between text-[11px] font-medium text-foreground/60 hover:text-foreground bg-foreground/[0.02] hover:bg-foreground/5 px-3 py-2 rounded-xl transition-all duration-300 border border-foreground/5"
                              >
                                <span className="truncate">{PAGE_NAMES[pg] || pg}</span>
                                <ArrowRight className="w-3 h-3 text-foreground/20 group-hover:text-foreground/60 transition-colors" />
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 mt-6 pt-4 border-t border-foreground/[0.04]">
                      <span className={`text-[8px] font-bold px-2 py-0.5 rounded uppercase tracking-widest ${perm.canView ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-foreground/5 text-foreground/20"}`}>View</span>
                      <span className={`text-[8px] font-bold px-2 py-0.5 rounded uppercase tracking-widest ${perm.canEdit ? "bg-blue-500/10 text-blue-500 border border-blue-500/20" : "bg-foreground/5 text-foreground/20"}`}>Edit</span>
                      <span className={`text-[8px] font-bold px-2 py-0.5 rounded uppercase tracking-widest ${perm.canDelete ? "bg-rose-500/10 text-rose-500 border border-rose-500/20" : "bg-foreground/5 text-foreground/20"}`}>Delete</span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Dynamic Activity / Updates Section */}
        {allowedModules.some((p: any) => ["ORDERS", "RETURNS_EXCHANGES", "INVENTORY", "PRODUCTS"].includes(p.module)) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
            {allowedModules.some((p: any) => p.module === "ORDERS") && stats?.recentOrders && (
              <div className="glass-card rounded-[2rem] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-foreground/5 flex items-center justify-between bg-foreground/[0.01]">
                   <h3 className="text-[10px] font-bold text-foreground/80 uppercase tracking-[0.3em]">Recent Orders Update</h3>
                   <Link href="/dashboard/orders" className="px-3 py-1 glass rounded-full text-[8px] font-bold text-foreground/40 hover:text-foreground uppercase tracking-widest flex items-center gap-1 transition-all border border-foreground/5">
                     Open <ArrowRight className="w-3 h-3" />
                   </Link>
                </div>
                <div className="divide-y divide-foreground/[0.03] overflow-x-auto">
                  {stats.recentOrders.length === 0 ? (
                    <p className="py-8 text-center text-[10px] text-foreground/30 uppercase tracking-widest">No recent orders</p>
                  ) : (
                    stats.recentOrders.slice(0, 3).map((order) => (
                      <div key={order.id} className="px-6 py-4 flex items-center justify-between text-[11px]">
                        <div>
                          <p className="font-bold text-foreground uppercase">{order.name}</p>
                          <p className="text-[9px] text-foreground/40 mt-0.5">
                            {order.customer ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}` : "Guest"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-foreground">₹{parseFloat(order.total_price).toLocaleString("en-IN")}</p>
                          <span className={`inline-block text-[7px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-widest mt-0.5 ${order.financial_status === "paid" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>
                            {order.financial_status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {allowedModules.some((p: any) => p.module === "RETURNS_EXCHANGES") && serviceSummary?.recentActivity && (
              <div className="glass-card rounded-[2rem] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-foreground/5 flex items-center justify-between bg-foreground/[0.01]">
                   <h3 className="text-[10px] font-bold text-foreground/80 uppercase tracking-[0.3em]">Returns & Exchanges Feed</h3>
                   <Link href="/dashboard/returns" className="px-3 py-1 glass rounded-full text-[8px] font-bold text-foreground/40 hover:text-foreground uppercase tracking-widest flex items-center gap-1 transition-all border border-foreground/5">
                     Open <ArrowRight className="w-3 h-3" />
                   </Link>
                </div>
                <div className="divide-y divide-foreground/[0.03]">
                  {serviceSummary.recentActivity.length === 0 ? (
                    <p className="py-8 text-center text-[10px] text-foreground/30 uppercase tracking-widest">No service activity</p>
                  ) : (
                    serviceSummary.recentActivity.slice(0, 3).map((item) => (
                      <div key={item.id} className="px-6 py-4 flex items-center justify-between text-[11px]">
                        <div>
                          <p className="font-bold text-foreground truncate max-w-[180px]">{item.productTitle}</p>
                          <p className="text-[9px] text-foreground/40 mt-0.5">{item.customerName} • #{item.orderId}</p>
                        </div>
                        <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-widest ${item.type === "return" ? "bg-amber-500/10 text-amber-500" : "bg-blue-500/10 text-blue-500"}`}>
                          {item.type}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    );
  }

  const statCards = [
    {
      name: "Revenue",
      value: `₹${(stats?.totalRevenue || 0).toLocaleString("en-IN")}`,
      icon: Activity,
    },
    {
      name: "Orders",
      value: String(stats?.totalOrders || 0),
      icon: ShoppingCart,
    },
    {
      name: "Customers",
      value: String(stats?.totalCustomers || 0),
      icon: Users,
    },
    {
      name: "Low Stock",
      value: String(stats?.lowStockItems || 0),
      icon: PackageSearch,
    },
  ];

  const serviceCards = [
    {
      name: "Pending Returns",
      value: String(serviceSummary?.pendingReturns || 0),
      total: serviceSummary?.totalReturns || 0,
      icon: Undo2,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      href: "/dashboard/returns",
    },
    {
      name: "Pending Exchanges",
      value: String(serviceSummary?.pendingExchanges || 0),
      total: serviceSummary?.totalExchanges || 0,
      icon: ArrowLeftRight,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      href: "/dashboard/exchanges",
    },
  ];

  const statusColors: Record<string, string> = {
    REQUESTED: "text-amber-500 bg-amber-500/10",
    APPROVED: "text-blue-500 bg-blue-500/10",
    RECEIVED: "text-purple-500 bg-purple-500/10",
    REFUNDED: "text-emerald-500 bg-emerald-500/10",
    REJECTED: "text-rose-500 bg-rose-500/10",
    SHIPPED: "text-purple-500 bg-purple-500/10",
    DELIVERED: "text-emerald-500 bg-emerald-500/10",
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="pb-20 space-y-6 lg:space-y-8"
    >
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 lg:gap-6 mb-8 lg:mb-12 relative z-10">
        <div className="space-y-1 lg:space-y-2">
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground uppercase tracking-tighter leading-none">
            Dashboard
          </h1>
          <p className="text-[9px] lg:text-[10px] text-foreground/40 font-bold uppercase tracking-[0.3em] max-w-xl">
            Overview of store performance and active operations.
          </p>
        </div>
        <div className="flex items-center gap-2 lg:gap-3">
          <button
            onClick={() => fetchStats()}
            disabled={loading}
            className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 lg:px-5 py-2 lg:py-2.5 bg-background dark:bg-foreground/[0.03] border border-foreground/[0.08] rounded-xl text-[9px] lg:text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/60 hover:bg-foreground/[0.02] hover:text-foreground transition-all disabled:opacity-50 active:scale-95 shadow-sm"
          >
            <RefreshCw className={`w-3 h-3 lg:w-3.5 lg:h-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={2} />
            Refresh
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 lg:px-5 py-2 lg:py-2.5 bg-foreground text-background rounded-xl text-[9px] lg:text-[10px] font-bold uppercase tracking-[0.2em] hover:opacity-90 transition-all disabled:opacity-50 active:scale-95 shadow-lg shadow-foreground/10"
          >
            <RefreshCw className={`w-3 h-3 lg:w-3.5 lg:h-3.5 ${syncing ? "animate-spin" : ""}`} strokeWidth={2} />
            {syncing ? "Syncing..." : "Sync Node"}
          </button>
        </div>
      </div>

       <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 relative z-10">
        {statCards.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              key={stat.name}
              className="glass-card p-6 lg:p-10 relative overflow-hidden group rounded-[2rem] lg:rounded-[3rem]"
            >
              <div className="flex justify-between items-start mb-4 lg:mb-6">
                <p className="text-[10px] lg:text-[11px] font-bold text-foreground/20 uppercase tracking-[0.4em]">{stat.name}</p>
                <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl lg:rounded-[1.2rem] bg-foreground/5 text-foreground/40 flex items-center justify-center group-hover:bg-foreground group-hover:text-background transition-all duration-700 border border-foreground/5 shadow-inner">
                  <Icon className="w-3.5 h-3.5 lg:w-4 lg:h-4" strokeWidth={1.5} />
                </div>
              </div>
              <div className="relative z-10">
                <p className="text-2xl lg:text-4xl font-bold text-foreground tracking-tighter mb-1">{stat.value}</p>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[8px] lg:text-[9px] font-bold text-foreground/20 uppercase tracking-widest">Real-time sync</span>
                </div>
              </div>
              
              {/* Vibrant Orb Effect */}
              <div className="absolute -right-8 -bottom-8 w-24 lg:w-32 h-24 lg:h-32 bg-foreground/5 blur-3xl rounded-full group-hover:bg-foreground/10 transition-all duration-1000" />
            </motion.div>
          );
        })}
      </div>

      {/* Service Summary Cards — Returns & Exchanges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6 relative z-10">
        {serviceCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.1, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              <Link
                href={card.href}
                className="glass-card p-6 lg:p-8 rounded-[2rem] lg:rounded-[3rem] flex items-center justify-between group hover:scale-[1.01] transition-all duration-300 relative overflow-hidden block"
              >
                <div className="flex items-center gap-4 lg:gap-6">
                  <div className={`w-12 h-12 lg:w-14 lg:h-14 rounded-2xl ${card.bg} flex items-center justify-center group-hover:scale-110 transition-transform duration-500`}>
                    <Icon className={`w-5 h-5 lg:w-6 lg:h-6 ${card.color}`} strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-[10px] lg:text-[11px] font-bold text-foreground/40 uppercase tracking-[0.3em]">{card.name}</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-2xl lg:text-3xl font-bold text-foreground tracking-tighter">{card.value}</span>
                      <span className="text-[9px] text-foreground/30 font-bold uppercase tracking-widest">of {card.total} total</span>
                    </div>
                  </div>
                </div>
                <ArrowUpRight className="w-5 h-5 text-foreground/20 group-hover:text-foreground/60 transition-colors" />
                <div className={`absolute -right-6 -bottom-6 w-24 h-24 ${card.bg} blur-3xl rounded-full opacity-30 group-hover:opacity-60 transition-opacity duration-500`} />
              </Link>
            </motion.div>
          );
        })}
      </div>

       <div className="grid lg:grid-cols-2 gap-4 lg:gap-6 relative z-10">
        {/* Recent Orders */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="glass-card rounded-[2rem] lg:rounded-[3rem] overflow-hidden flex flex-col"
        >
          <div className="px-6 lg:px-8 py-4 lg:py-6 border-b border-foreground/5 flex items-center justify-between bg-foreground/[0.01]">
             <h3 className="text-[10px] lg:text-[12px] font-bold text-foreground/80 uppercase tracking-[0.3em]">Recent Orders</h3>
             <Link href="/dashboard/orders" className="px-3 lg:px-4 py-1.5 lg:py-2 glass rounded-full text-[8px] lg:text-[9px] font-bold text-foreground/40 hover:text-foreground hover:bg-foreground/5 uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 border border-foreground/5">
               View All <ArrowUpRight className="w-3 h-3 lg:w-3.5 lg:h-3.5" />
             </Link>
          </div>

          <div className="flex-1 overflow-x-auto custom-scrollbar">
            <div className="min-w-[600px] lg:min-w-0">
              {(stats?.recentOrders || []).length === 0 ? (
                <div className="py-16 lg:py-20 flex flex-col items-center justify-center text-center">
                   <p className="text-[10px] lg:text-[12px] font-bold text-foreground/20 uppercase tracking-[0.3em]">No recent orders</p>
                </div>
              ) : (
                <table className="w-full text-left whitespace-nowrap">
                   <tbody className="divide-y divide-foreground/[0.03]">
                    {stats?.recentOrders.map((order) => {
                      const customerName = order.customer
                          ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
                          : "Guest";
  
                      return (
                        <tr key={order.id} className="hover:bg-foreground/[0.01] transition-all group duration-500">
                          <td className="px-6 lg:px-8 py-3 lg:py-4">
                            <p className="text-[12px] lg:text-[13px] font-bold text-foreground tracking-tight leading-none uppercase">{order.name}</p>
                          </td>
                          <td className="px-6 lg:px-8 py-3 lg:py-4">
                             <p className="text-[9px] lg:text-[10px] font-bold text-foreground/40 uppercase tracking-[0.2em]">{customerName}</p>
                          </td>
                           <td className="px-6 lg:px-8 py-3 lg:py-4 text-right">
                            <span
                              className={`text-[8px] font-bold px-3 py-1 rounded-full uppercase tracking-widest backdrop-blur-3xl shadow-2xl border ${
                                order.financial_status === "paid"
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                              }`}
                            >
                              {order.financial_status}
                            </span>
                          </td>
                          <td className="px-6 lg:px-8 py-3 lg:py-4 text-right">
                            <p className="text-[14px] lg:text-[15px] font-bold text-foreground tracking-tighter">
                              ₹{parseFloat(order.total_price).toLocaleString("en-IN")}
                            </p>
                          </td>
                        </tr>
                      );
                    })}
                   </tbody>
                </table>
              )}
            </div>
          </div>
        </motion.div>

        {/* Service Activity Feed */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="glass-card rounded-[2rem] lg:rounded-[3rem] overflow-hidden flex flex-col"
        >
          <div className="px-6 lg:px-10 py-5 lg:py-8 border-b border-foreground/5 flex items-center justify-between bg-foreground/[0.01]">
             <h3 className="text-[11px] lg:text-[13px] font-bold text-foreground/90 uppercase tracking-[0.3em]">Service Activity</h3>
             <div className="flex items-center gap-2">
               <Link href="/dashboard/returns" className="px-3 py-1.5 glass rounded-full text-[8px] font-bold text-foreground/40 hover:text-foreground uppercase tracking-widest flex items-center gap-1 transition-all border border-foreground/5">
                 Returns <ArrowUpRight className="w-3 h-3" />
               </Link>
               <Link href="/dashboard/exchanges" className="px-3 py-1.5 glass rounded-full text-[8px] font-bold text-foreground/40 hover:text-foreground uppercase tracking-widest flex items-center gap-1 transition-all border border-foreground/5">
                 Exchanges <ArrowUpRight className="w-3 h-3" />
               </Link>
             </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {(serviceSummary?.recentActivity || []).length === 0 ? (
               <div className="py-16 lg:py-20 flex flex-col items-center justify-center text-center">
                 <Undo2 className="w-8 h-8 text-foreground/5 mx-auto mb-3" />
                 <p className="text-[10px] lg:text-[12px] font-bold text-foreground/20 uppercase tracking-[0.3em]">No service activity</p>
                 <p className="text-[8px] text-foreground/10 uppercase tracking-widest mt-1">Returns and exchanges will appear here</p>
              </div>
            ) : (
              <div className="divide-y divide-foreground/[0.03]">
                {serviceSummary?.recentActivity.map((item) => (
                  <div key={item.id} className="px-6 lg:px-10 py-4 lg:py-5 hover:bg-foreground/[0.01] transition-all group flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${item.type === "return" ? "bg-amber-500/10" : "bg-blue-500/10"}`}>
                      {item.type === "return" ? (
                        <Undo2 className="w-3.5 h-3.5 text-amber-500" />
                      ) : (
                        <ArrowLeftRight className="w-3.5 h-3.5 text-blue-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-semibold text-foreground truncate">{item.productTitle}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[7px] font-bold uppercase tracking-widest ${statusColors[item.status] || "text-foreground/40 bg-foreground/5"}`}>
                          {item.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[9px] text-foreground/40">
                        <span>{item.customerName}</span>
                        <span className="w-1 h-1 rounded-full bg-foreground/10" />
                        <span>#{item.orderId}</span>
                        <span className="w-1 h-1 rounded-full bg-foreground/10" />
                        <span>{new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Critical Inventory */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="glass-card rounded-[2rem] lg:rounded-[3rem] overflow-hidden flex flex-col relative z-10"
      >
        <div className="px-6 lg:px-10 py-5 lg:py-8 border-b border-foreground/5 flex items-center justify-between bg-foreground/[0.01]">
           <h3 className="text-[11px] lg:text-[13px] font-bold text-foreground/90 uppercase tracking-[0.3em]">Critical Inventory</h3>
           <Link href="/dashboard/inventory" className="px-4 lg:px-5 py-1.5 lg:py-2 glass rounded-full text-[8px] lg:text-[10px] font-bold text-foreground/40 hover:text-foreground hover:bg-foreground/5 uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 border border-foreground/5">
             Manage <ArrowUpRight className="w-3 h-3 lg:w-4 lg:h-4" />
           </Link>
        </div>

        <div className="flex-1 overflow-x-auto custom-scrollbar">
          <div className="min-w-[500px] lg:min-w-0">
            {(stats?.lowStockProducts || []).length === 0 ? (
               <div className="py-16 lg:py-20 flex flex-col items-center justify-center text-center">
                 <p className="text-[10px] lg:text-[12px] font-bold text-foreground/20 uppercase tracking-[0.3em]">Inventory optimal</p>
              </div>
            ) : (
              <table className="w-full text-left whitespace-nowrap">
                 <tbody className="divide-y divide-foreground/[0.03]">
                  {stats?.lowStockProducts.map((item, i) => (
                    <tr key={i} className="hover:bg-foreground/[0.01] transition-all group duration-500">
                      <td className="px-6 lg:px-10 py-4 lg:py-6 max-w-[200px] lg:max-w-[250px] truncate">
                         <p className="text-[13px] lg:text-[15px] font-bold text-foreground truncate leading-none uppercase">{item.title}</p>
                         <p className="text-[9px] text-foreground/20 font-bold uppercase tracking-[0.2em] mt-1.5 italic transition-colors group-hover:text-foreground/40">{item.variant || "Standard"}</p>
                      </td>
                      <td className="px-6 lg:px-10 py-4 lg:py-6 max-w-[120px] lg:max-w-[150px] truncate">
                         <div className="flex items-center gap-2 px-2.5 lg:px-3 py-1 lg:py-1.5 bg-foreground/5 border border-foreground/10 rounded-lg w-fit">
                            <PackageSearch className="w-2.5 h-2.5 lg:w-3 lg:h-3 text-foreground/30" />
                            <p className="text-[9px] text-foreground/50 font-bold uppercase tracking-[0.2em] truncate">{item.sku || "UNASSIGNED"}</p>
                         </div>
                      </td>
                      <td className="px-6 lg:px-10 py-4 lg:py-6 text-right">
                        <span
                          className={`text-[9px] lg:text-[11px] font-bold uppercase tracking-[0.3em] ${
                            item.stock <= 0 
                              ? "text-rose-500" 
                              : "text-amber-500 dark:text-amber-400"
                          }`}
                        >
                          {item.stock} <span className="hidden sm:inline">UNITS REMAINING</span><span className="sm:hidden">LEFT</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                 </tbody>
              </table>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
