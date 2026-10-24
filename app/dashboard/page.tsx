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
  Globe,
  Smartphone,
  Layers,
  CreditCard,
  PackageCheck,
  Calendar,
  Sparkles,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cachedAdminFetch, invalidateAdminCache } from "@/lib/adminClientCache";

interface DashboardStats {
  totalRevenue: number;
  totalOrders: number;
  totalCustomers: number;
  lowStockItems: number;
  recentOrders: {
    id: string | number;
    name: string;
    total_price: string;
    financial_status: string;
    fulfillment_status: string | null;
    customer: { first_name: string; last_name: string } | null;
    created_at: string;
    orderType?: string;
  }[];
  lowStockProducts: {
    title: string;
    sku: string | null;
    stock: number;
    variant: string;
    channel?: string;
  }[];
}

interface ServiceSummary {
  pendingReturns: number;
  totalReturns: number;
  receivedReturns: number;
  pendingExchanges: number;
  totalExchanges: number;
  pendingRefunds: number;
  totalPendingRefundAmount: number;
  recentActivity: {
    id: string;
    displayId?: string;
    type: "return" | "exchange";
    status: string;
    statusLabel?: string;
    isReceived?: boolean;
    receivedAt?: string | null;
    productTitle: string;
    customerName: string;
    date: string;
    orderId: string;
    refundAmount?: number;
    inspectUrl?: string;
  }[];
  receivedAwaitingInspection: {
    id: string;
    displayId?: string;
    type: "return" | "exchange";
    status: string;
    statusLabel?: string;
    isReceived?: boolean;
    receivedAt?: string | null;
    productTitle: string;
    customerName: string;
    date: string;
    orderId: string;
    refundAmount?: number;
    inspectUrl?: string;
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
  "/dashboard/webstore": "Storefront Analytics",
  "/dashboard/webstore/orders": "Storefront Orders",
  "/dashboard/webstore/customers": "Storefront Customers",
  "/dashboard/webstore/abandoned-carts": "Abandoned Carts",
  "/dashboard/webstore/storefront": "Web Builder Pages",
  "/dashboard/webstore/merchandising": "Products & Merchandising",
  "/dashboard/webstore/products": "Store Products",
  "/dashboard/webstore/banners": "Homepage Banners",
  "/dashboard/webstore/gallery": "Public Gallery CMS",
  "/dashboard/webstore/coupons": "Promo Coupons",
  "/dashboard/webstore/logins": "Customer Logins Feed",
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

// Date Presets Calculation Helper
function getDateRangeForPreset(preset: string): { from?: string; to?: string } {
  const now = new Date();
  if (preset === "today") {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: from.toISOString(), to: now.toISOString() };
  }
  if (preset === "yesterday") {
    const yestStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const yestEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    return { from: yestStart.toISOString(), to: yestEnd.toISOString() };
  }
  if (preset === "this_week") {
    const d = new Date(now);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return { from: monday.toISOString(), to: now.toISOString() };
  }
  if (preset === "this_month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: from.toISOString(), to: now.toISOString() };
  }
  return {};
}

export default function DashboardOverview() {
  const router = useRouter();
  const { data: session, status } = useSession();

  // ─── Filter States (Requirement A) ───
  const [platform, setPlatform] = useState<"all" | "web" | "app">("all");
  const [datePreset, setDatePreset] = useState<"today" | "yesterday" | "this_week" | "this_month" | "all" | "custom">("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [showCustomRangeInput, setShowCustomRangeInput] = useState<boolean>(false);

  // ─── Service Activity Tab Filter (Requirement E) ───
  const [serviceTab, setServiceTab] = useState<"all" | "received" | "returns" | "exchanges">("all");

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [serviceSummary, setServiceSummary] = useState<ServiceSummary | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [serviceLoading, setServiceLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/dashboard/login");
    }
  }, [status, router]);

  const user = session?.user as any;
  const permissions = user?.permissions || [];
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const hasDashboardHome = isSuperAdmin || permissions.some((p: any) => p.module === "DASHBOARD_HOME" && p.canView);

  const refreshInFlight = useRef(false);
  const lastRefreshAt = useRef(0);

  // ─── Unified Data Fetching ───
  const fetchOverview = async (silent = false) => {
    if (!silent) {
      if (!stats) {
        setStatsLoading(true);
        setServiceLoading(true);
      } else {
        setIsUpdating(true);
      }
    }

    try {
      let dateBounds = getDateRangeForPreset(datePreset);
      if (datePreset === "custom") {
        dateBounds = {
          from: customFrom ? new Date(customFrom).toISOString() : undefined,
          to: customTo ? new Date(customTo + "T23:59:59.999Z").toISOString() : undefined,
        };
      }

      const params = new URLSearchParams();
      if (platform !== "all") params.set("platform", platform);
      if (dateBounds.from) params.set("from", dateBounds.from);
      if (dateBounds.to) params.set("to", dateBounds.to);

      const data = await cachedAdminFetch<any>(
        `/api/admin/dashboard/overview?${params.toString()}`,
        { skipCache: silent }
      );

      if (data && data.stats) {
        setStats(data.stats);
        setServiceSummary(data.serviceSummary);
      }
    } catch (err) {
      console.error("Dashboard overview fetch error", err);
    } finally {
      setStatsLoading(false);
      setServiceLoading(false);
      setIsUpdating(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/shopify/sync", { method: "POST" });
      const data = await res.json();
      console.log("Sync result:", data);
      invalidateAdminCache();
      await fetchOverview(true);
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setSyncing(false);
    }
  };

  // Re-fetch when platform or preset or custom dates change
  useEffect(() => {
    if (!session || !hasDashboardHome) return;
    fetchOverview();
  }, [session, hasDashboardHome, platform, datePreset]);

  // Realtime background sync listener
  useEffect(() => {
    if (!hasDashboardHome) return;
    const handleSyncEvent = async () => {
      const now = Date.now();
      if (refreshInFlight.current || now - lastRefreshAt.current < 45_000) return;
      refreshInFlight.current = true;
      lastRefreshAt.current = now;
      try {
        await fetchOverview(true);
      } finally {
        refreshInFlight.current = false;
      }
    };
    window.addEventListener("realtime-sync", handleSyncEvent);
    return () => window.removeEventListener("realtime-sync", handleSyncEvent);
  }, [hasDashboardHome, platform, datePreset]);

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-4 h-4 text-foreground/40 animate-spin" />
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/40">
          Authenticating session...
        </span>
      </div>
    );
  }

  // Fallback for staff members with restricted page permissions
  if (!hasDashboardHome) {
    const allowedModules = permissions.filter((p: any) => p.canView);

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="pb-20 space-y-8"
      >
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
              <span className="text-[10px] font-bold text-foreground/60 uppercase tracking-widest">
                Secure session active
              </span>
            </div>
          </div>
          <div className="absolute right-0 top-0 w-80 h-80 bg-violet-500/5 blur-3xl rounded-full -z-10" />
        </div>

        <div className="space-y-4">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.3em] text-foreground/50 px-2">
            Assigned Modules
          </h2>
          {allowedModules.length === 0 ? (
            <div className="glass-card p-12 text-center rounded-[2rem]">
              <Lock className="w-8 h-8 text-foreground/20 mx-auto mb-4" />
              <p className="text-[12px] font-bold text-foreground/60 uppercase tracking-[0.2em]">
                No Modules Allocated
              </p>
              <p className="text-[10px] text-foreground/30 uppercase tracking-wider mt-1">
                Please contact your System Administrator to receive page privileges.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {allowedModules.map((perm: any, idx: number) => {
                const modulePages = perm.pages ? perm.pages.split(",").filter(Boolean) : [];
                return (
                  <motion.div
                    key={perm.module ? `${perm.module}-${idx}` : `mod-${idx}`}
                    whileHover={{ scale: 1.01 }}
                    className="glass-card p-6 rounded-[2rem] border border-foreground/5 flex flex-col justify-between"
                  >
                    <div>
                      <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-2">
                        {perm.module}
                      </h3>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {modulePages.map((page: string) => (
                          <Link
                            key={page}
                            href={page}
                            className="px-2 py-1 rounded-lg bg-foreground/5 hover:bg-foreground/10 text-[9px] font-medium text-foreground/70 transition-all flex items-center gap-1"
                          >
                            <span>{PAGE_NAMES[page] || page}</span>
                            <ArrowRight className="w-2.5 h-2.5 opacity-40" />
                          </Link>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // ─── Stat KPI Cards (Requirements A & B) ───
  const statCards = [
    {
      name: "Revenue",
      value: `₹${(stats?.totalRevenue || 0).toLocaleString("en-IN")}`,
      subtext: `${platform === "all" ? "Omnichannel" : platform === "web" ? "Web Store" : "Mobile App"} • Paid & COD upfront`,
      icon: Activity,
    },
    {
      name: "Orders",
      value: String(stats?.totalOrders || 0),
      subtext: `${platform === "all" ? "All" : platform === "web" ? "Web" : "App"} realized orders`,
      icon: ShoppingCart,
    },
    {
      name: "Customers",
      value: String(stats?.totalCustomers || 0),
      subtext: platform === "all" ? "Total store accounts" : `${platform.toUpperCase()} customers`,
      icon: Users,
    },
    {
      name: "Low Stock",
      value: String(stats?.lowStockItems || 0),
      subtext: "Global warehouse items < 10 units",
      icon: PackageSearch,
    },
  ];

  // ─── Service Summary Cards (Requirements C & D) ───
  const serviceCards = [
    {
      name: "Pending Returns",
      value: String(serviceSummary?.pendingReturns || 0),
      total: `${serviceSummary?.totalReturns || 0} ${platform !== "all" ? platform.toUpperCase() + " " : ""}total`,
      badge: (serviceSummary?.receivedReturns || 0) > 0 ? `${serviceSummary?.receivedReturns} received` : null,
      icon: Undo2,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      href: "/dashboard/returns",
    },
    {
      name: "Pending Exchanges",
      value: String(serviceSummary?.pendingExchanges || 0),
      total: `${serviceSummary?.totalExchanges || 0} ${platform !== "all" ? platform.toUpperCase() + " " : ""}total`,
      badge: null,
      icon: ArrowLeftRight,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      href: "/dashboard/exchanges",
    },
    {
      name: "Pending Refunds",
      value: String(serviceSummary?.pendingRefunds || 0),
      total: `₹${Math.round(serviceSummary?.totalPendingRefundAmount || 0).toLocaleString("en-IN")}`,
      isCurrency: true,
      badge: null,
      icon: CreditCard,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
      href: "/dashboard/refunds",
    },
  ];

  const statusBadges: Record<string, { label: string; color: string; bg: string; border: string }> = {
    received: { label: "PARCEL RECEIVED", color: "text-teal-400", bg: "bg-teal-500/15", border: "border-teal-500/30" },
    approved: { label: "APPROVED", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
    pending_approval: { label: "PENDING APPROVAL", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
    requested: { label: "REQUESTED", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
    pickup_scheduled: { label: "PICKUP SCHEDULED", color: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
    in_transit: { label: "IN TRANSIT", color: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
    new_order_created: { label: "EXCHANGE DISPATCHED", color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
    refunded: { label: "REFUNDED", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    completed: { label: "COMPLETED", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    rejected: { label: "REJECTED", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20" },
  };

  // Filter service activity feed based on tab
  const filteredActivity = (serviceSummary?.recentActivity || []).filter((item) => {
    if (serviceTab === "received") return item.isReceived;
    if (serviceTab === "returns") return item.type === "return";
    if (serviceTab === "exchanges") return item.type === "exchange";
    return true;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="pb-20 space-y-6 lg:space-y-8"
    >
      {/* ─── Header & Top Actions ─── */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 lg:gap-6 mb-4 relative z-10">
        <div className="space-y-1 lg:space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl lg:text-3xl font-bold text-foreground uppercase tracking-tighter leading-none">
              Dashboard
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider bg-foreground/5 text-foreground/50 border border-foreground/10">
              {platform === "all" ? "Omnichannel" : platform === "web" ? "Web Store" : "Mobile App"}
            </span>
          </div>
          <p className="text-[9px] lg:text-[10px] text-foreground/40 font-bold uppercase tracking-[0.3em] max-w-xl">
            Store performance and live reverse operations.
          </p>
        </div>

        <div className="flex items-center gap-2 lg:gap-3">
          <button
            onClick={() => fetchOverview(false)}
            disabled={statsLoading || serviceLoading || isUpdating}
            className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 lg:px-5 py-2 lg:py-2.5 bg-background dark:bg-foreground/[0.03] border border-foreground/[0.08] rounded-xl text-[9px] lg:text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/60 hover:bg-foreground/[0.02] hover:text-foreground transition-all disabled:opacity-50 active:scale-95 shadow-sm"
          >
            <RefreshCw
              className={`w-3 h-3 lg:w-3.5 lg:h-3.5 ${statsLoading || serviceLoading || isUpdating ? "animate-spin" : ""}`}
              strokeWidth={2}
            />
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

      {/* ─── Requirement A: Web / App / All & Date Filters ─── */}
      <div className="glass-card p-4 lg:p-5 rounded-[2rem] border border-foreground/5 flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10 shadow-sm overflow-hidden">
        {/* Subtle glowing loading bar on top when updating */}
        {isUpdating && (
          <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden z-20">
            <div className="w-full h-full bg-gradient-to-r from-transparent via-foreground to-transparent animate-pulse" />
          </div>
        )}

        {/* Left: Platform Toggle */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold text-foreground/40 uppercase tracking-widest mr-1 hidden sm:inline">
            Channel:
          </span>
          <div className="flex items-center bg-foreground/[0.04] p-1 rounded-2xl border border-foreground/[0.08]">
            {[
              { key: "all", label: "All", icon: Layers },
              { key: "web", label: "Web", icon: Globe },
              { key: "app", label: "App", icon: Smartphone },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = platform === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setPlatform(item.key as any)}
                  disabled={isUpdating}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all duration-300 disabled:opacity-70 ${
                    isActive
                      ? "bg-foreground text-background shadow-md shadow-foreground/10"
                      : "text-foreground/50 hover:text-foreground hover:bg-foreground/5"
                  }`}
                >
                  {isActive && isUpdating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Central updating indicator badge */}
          <AnimatePresence>
            {isUpdating && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 bg-foreground/5 border border-foreground/10 text-foreground/60 rounded-full text-[8px] font-bold uppercase tracking-widest shadow-sm ml-2"
              >
                <Loader2 className="w-3 h-3 animate-spin text-foreground" />
                <span>Updating...</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right: Date Range Presets */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex flex-wrap items-center bg-foreground/[0.04] p-1 rounded-2xl border border-foreground/[0.08]">
            {[
              { key: "all", label: "All Time" },
              { key: "today", label: "Today" },
              { key: "yesterday", label: "Yesterday" },
              { key: "this_week", label: "This Week" },
              { key: "this_month", label: "This Month" },
              { key: "custom", label: "Custom" },
            ].map((item) => {
              const isActive = datePreset === item.key;
              return (
                <button
                  key={item.key}
                  disabled={isUpdating}
                  onClick={() => {
                    setDatePreset(item.key as any);
                    if (item.key === "custom") {
                      setShowCustomRangeInput(true);
                    } else {
                      setShowCustomRangeInput(false);
                    }
                  }}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider transition-all duration-300 disabled:opacity-70 ${
                    isActive
                      ? "bg-foreground text-background shadow-md shadow-foreground/10"
                      : "text-foreground/50 hover:text-foreground hover:bg-foreground/5"
                  }`}
                >
                  {isActive && isUpdating && <Loader2 className="w-2.5 h-2.5 animate-spin mr-0.5" />}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Custom Date Pickers Modal/Input inline */}
          {showCustomRangeInput && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 bg-foreground/[0.03] p-1.5 px-3 rounded-2xl border border-foreground/10 mt-2 sm:mt-0"
            >
              <Calendar className="w-3 h-3 text-foreground/40" />
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-transparent text-[10px] text-foreground font-semibold focus:outline-none"
              />
              <span className="text-[9px] text-foreground/40 uppercase font-bold">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-transparent text-[10px] text-foreground font-semibold focus:outline-none"
              />
              <button
                onClick={() => fetchOverview(false)}
                disabled={!customFrom || !customTo || isUpdating}
                className="px-2.5 py-1 bg-foreground text-background rounded-lg text-[8px] font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
              >
                {isUpdating ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : null}
                <span>Apply</span>
              </button>
            </motion.div>
          )}
        </div>
      </div>

      {/* ─── Requirement E: High-Priority Received Returns Alert Banner ─── */}
      {(serviceSummary?.receivedReturns || 0) > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-5 lg:p-6 rounded-[2rem] border border-teal-500/30 bg-teal-500/5 flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden shadow-lg shadow-teal-500/5"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-2xl bg-teal-500/10 border border-teal-500/20 text-teal-400 flex items-center justify-center shrink-0">
              <PackageCheck className="w-5 h-5 lg:w-6 lg:h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                <h3 className="text-xs lg:text-sm font-bold text-foreground uppercase tracking-wider">
                  {serviceSummary?.receivedReturns} Returned Item{serviceSummary?.receivedReturns === 1 ? "" : "s"} Received & Awaiting Inspection
                </h3>
              </div>
              <p className="text-[9px] lg:text-[10px] text-foreground/50 font-medium uppercase tracking-widest mt-0.5">
                Packages have arrived at the warehouse. Perform quick QC to approve returns and release refunds immediately.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setServiceTab("received")}
              className="px-4 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground text-[9px] font-bold uppercase tracking-wider transition-all border border-foreground/10"
            >
              Filter Activity Feed
            </button>
            <Link
              href="/dashboard/returns?stage=received"
              className="px-4 py-2 rounded-xl bg-teal-500 text-teal-950 hover:bg-teal-400 text-[9px] font-bold uppercase tracking-wider transition-all shadow-md shadow-teal-500/20 flex items-center gap-1.5"
            >
              Inspect & Approve Queue <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </motion.div>
      )}

      {/* ─── Row 1: KPI Stat Cards (Requirements A & B) ─── */}
      <div
        className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 relative z-10 transition-all duration-300 ${
          isUpdating ? "opacity-70" : "opacity-100"
        }`}
      >
        {statsLoading && !stats
          ? [...Array(4)].map((_, i) => (
              <div
                key={`stat-skel-${i}`}
                className="glass-card p-6 lg:p-10 relative overflow-hidden rounded-[2rem] lg:rounded-[3rem] animate-pulse"
              >
                <div className="flex justify-between items-start mb-4 lg:mb-6">
                  <div className="h-3 w-16 bg-foreground/10 rounded" />
                  <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-foreground/5" />
                </div>
                <div className="h-8 lg:h-10 w-28 bg-foreground/10 rounded-lg mb-2" />
                <div className="h-2.5 w-20 bg-foreground/5 rounded" />
              </div>
            ))
          : statCards.map((stat, i) => {
              const Icon = stat.icon;
              return (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  key={stat.name}
                  className="glass-card p-6 lg:p-10 relative overflow-hidden group rounded-[2rem] lg:rounded-[3rem]"
                >
                  <div className="flex justify-between items-start mb-4 lg:mb-6">
                    <p className="text-[10px] lg:text-[11px] font-bold text-foreground/30 uppercase tracking-[0.4em]">
                      {stat.name}
                    </p>
                    <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl lg:rounded-[1.2rem] bg-foreground/5 text-foreground/40 flex items-center justify-center group-hover:bg-foreground group-hover:text-background transition-all duration-700 border border-foreground/5 shadow-inner">
                      {isUpdating ? (
                        <Loader2 className="w-3.5 h-3.5 lg:w-4 lg:h-4 animate-spin text-foreground/60" />
                      ) : (
                        <Icon className="w-3.5 h-3.5 lg:w-4 lg:h-4" strokeWidth={1.5} />
                      )}
                    </div>
                  </div>
                  <div className="relative z-10">
                    <p className="text-2xl lg:text-4xl font-bold text-foreground tracking-tighter mb-1">
                      {stat.value}
                    </p>
                    <div className="flex items-center gap-1.5 mt-2">
                      {isUpdating ? (
                        <>
                          <Loader2 className="w-2.5 h-2.5 animate-spin text-foreground/40" />
                          <span className="text-[8px] lg:text-[9px] font-bold text-foreground/40 uppercase tracking-widest">
                            Updating...
                          </span>
                        </>
                      ) : (
                        <>
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-[8px] lg:text-[9px] font-bold text-foreground/30 uppercase tracking-widest">
                            {stat.subtext}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="absolute -right-8 -bottom-8 w-24 lg:w-32 h-24 lg:h-32 bg-foreground/5 blur-3xl rounded-full group-hover:bg-foreground/10 transition-all duration-1000" />
                </motion.div>
              );
            })}
      </div>

      {/* ─── Row 2: Service Cards: Returns, Exchanges & Refunds (Requirements C & D) ─── */}
      <div className="space-y-3 relative z-10">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[10px] lg:text-[11px] font-bold text-foreground/50 uppercase tracking-[0.3em]">
              Reverse Operations & Backlog
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider bg-foreground/5 text-foreground/50 border border-foreground/10">
              Live Queue • {platform === "all" ? "All Channels" : platform === "web" ? "Web Store" : "Mobile App"}
            </span>
          </div>
          <span className="text-[8px] font-semibold text-foreground/30 uppercase tracking-widest hidden sm:inline">
            Unfinished action items
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
          {serviceLoading && !serviceSummary
            ? [...Array(3)].map((_, i) => (
                <div
                  key={`srv-skel-${i}`}
                  className="glass-card p-6 lg:p-8 rounded-[2rem] lg:rounded-[3rem] animate-pulse flex items-center justify-between"
                >
                  <div className="flex items-center gap-4 lg:gap-6">
                    <div className="w-12 h-12 lg:w-14 lg:h-14 rounded-2xl bg-foreground/5" />
                    <div className="space-y-2">
                      <div className="h-3 w-24 bg-foreground/10 rounded" />
                      <div className="h-6 w-16 bg-foreground/10 rounded-lg" />
                    </div>
                  </div>
                </div>
              ))
            : serviceCards.map((card, i) => {
                const Icon = card.icon;
                return (
                  <motion.div
                    key={card.name}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <Link
                      href={card.href}
                      className="glass-card p-6 lg:p-8 rounded-[2rem] lg:rounded-[3rem] flex items-center justify-between group hover:scale-[1.01] transition-all duration-300 relative overflow-hidden block"
                    >
                      <div className="flex items-center gap-4 lg:gap-6">
                        <div
                          className={`w-12 h-12 lg:w-14 lg:h-14 rounded-2xl ${card.bg} flex items-center justify-center group-hover:scale-110 transition-transform duration-500`}
                        >
                          <Icon className={`w-5 h-5 lg:w-6 lg:h-6 ${card.color}`} strokeWidth={1.5} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] lg:text-[11px] font-bold text-foreground/40 uppercase tracking-[0.3em]">
                              {card.name}
                            </p>
                            {card.badge && (
                              <span className="px-1.5 py-0.5 rounded-full text-[7px] font-bold uppercase tracking-wider bg-teal-500/10 text-teal-400 border border-teal-500/20">
                                {card.badge}
                              </span>
                            )}
                          </div>
                          <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-2xl lg:text-3xl font-bold text-foreground tracking-tighter">
                              {card.value}
                            </span>
                            <span className="text-[9px] text-foreground/30 font-bold uppercase tracking-widest">
                              {card.isCurrency ? `${card.total} pending` : `of ${card.total}`}
                            </span>
                          </div>
                        </div>
                      </div>
                      <ArrowUpRight className="w-5 h-5 text-foreground/20 group-hover:text-foreground/60 transition-colors" />
                      <div
                        className={`absolute -right-6 -bottom-6 w-24 h-24 ${card.bg} blur-3xl rounded-full opacity-30 group-hover:opacity-60 transition-opacity duration-500`}
                      />
                    </Link>
                  </motion.div>
                );
              })}
        </div>
      </div>

      {/* ─── Row 3: Recent Orders & Service Activity Feed (Requirement E) ─── */}
      <div className="grid lg:grid-cols-2 gap-4 lg:gap-6 relative z-10">
        {/* Recent Orders */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="glass-card rounded-[2rem] lg:rounded-[3rem] overflow-hidden flex flex-col"
        >
          <div className="px-6 lg:px-8 py-4 lg:py-6 border-b border-foreground/5 flex items-center justify-between bg-foreground/[0.01]">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[10px] lg:text-[12px] font-bold text-foreground/80 uppercase tracking-[0.3em]">
                  Recent Orders
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[7px] font-bold uppercase tracking-wider bg-foreground/5 text-foreground/50 border border-foreground/10">
                  {platform === "all" ? "All Channels" : platform === "web" ? "Web Store" : "Mobile App"}
                </span>
              </div>
              <p className="text-[8px] text-foreground/30 font-bold uppercase tracking-wider mt-0.5">
                Paid & COD Upfront Orders • {datePreset.replace(/_/g, " ")}
              </p>
            </div>
            <Link
              href="/dashboard/orders"
              className="px-3 lg:px-4 py-1.5 lg:py-2 glass rounded-full text-[8px] lg:text-[9px] font-bold text-foreground/40 hover:text-foreground hover:bg-foreground/5 uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 border border-foreground/5"
            >
              View All <ArrowUpRight className="w-3 h-3 lg:w-3.5 lg:h-3.5" />
            </Link>
          </div>

          <div className="flex-1 overflow-x-auto custom-scrollbar">
            <div className="min-w-[600px] lg:min-w-0">
              {statsLoading && !stats ? (
                <div className="p-6 space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={`ord-skel-${i}`} className="flex items-center justify-between animate-pulse">
                      <div className="space-y-1.5">
                        <div className="h-3.5 w-24 bg-foreground/10 rounded" />
                        <div className="h-2.5 w-32 bg-foreground/5 rounded" />
                      </div>
                      <div className="h-4 w-16 bg-foreground/10 rounded" />
                    </div>
                  ))}
                </div>
              ) : (stats?.recentOrders || []).length === 0 ? (
                <div className="py-16 lg:py-20 flex flex-col items-center justify-center text-center">
                  <p className="text-[10px] lg:text-[12px] font-bold text-foreground/20 uppercase tracking-[0.3em]">
                    No qualifying orders in this range
                  </p>
                </div>
              ) : (
                <table className="w-full text-left whitespace-nowrap">
                  <tbody className="divide-y divide-foreground/[0.03]">
                    {stats?.recentOrders.map((order, idx) => {
                      const customerName = order.customer
                        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
                        : "Customer";

                      const isPaid = order.financial_status?.toLowerCase().includes("paid");

                      return (
                        <tr
                          key={order.id ? String(order.id) : `ord-row-${idx}`}
                          className="hover:bg-foreground/[0.01] transition-all group duration-500"
                        >
                          <td className="px-6 lg:px-8 py-3 lg:py-4">
                            <p className="text-[12px] lg:text-[13px] font-bold text-foreground tracking-tight leading-none uppercase">
                              {order.name}
                            </p>
                            <span className="text-[8px] font-bold uppercase tracking-wider text-foreground/30 mt-0.5 block">
                              {new Date(order.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          </td>
                          <td className="px-6 lg:px-8 py-3 lg:py-4">
                            <p className="text-[9px] lg:text-[10px] font-bold text-foreground/50 uppercase tracking-[0.2em]">
                              {customerName}
                            </p>
                          </td>
                          <td className="px-6 lg:px-8 py-3 lg:py-4 text-right">
                            <span
                              className={`text-[8px] font-bold px-3 py-1 rounded-full uppercase tracking-widest backdrop-blur-3xl shadow-2xl border ${
                                isPaid
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                  : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                              }`}
                            >
                              {order.financial_status?.replace(/_/g, " ")}
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

        {/* ─── Service Activity Feed (Requirement E: Faster Return Processing) ─── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="glass-card rounded-[2rem] lg:rounded-[3rem] overflow-hidden flex flex-col"
        >
          <div className="px-6 lg:px-8 py-4 lg:py-6 border-b border-foreground/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-foreground/[0.01]">
            <div>
              <h3 className="text-[10px] lg:text-[12px] font-bold text-foreground/90 uppercase tracking-[0.3em]">
                Service Activity
              </h3>
              <p className="text-[8px] text-foreground/30 font-bold uppercase tracking-wider mt-0.5">
                Real-time returns & exchanges queue
              </p>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 bg-foreground/[0.03] p-1 rounded-xl border border-foreground/5">
              {[
                { key: "all", label: "All" },
                { key: "received", label: `Received (${serviceSummary?.receivedReturns || 0})` },
                { key: "returns", label: "Returns" },
                { key: "exchanges", label: "Exchanges" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setServiceTab(tab.key as any)}
                  className={`px-2.5 py-1 rounded-lg text-[8px] font-bold uppercase tracking-wider transition-all ${
                    serviceTab === tab.key
                      ? "bg-foreground text-background shadow-sm"
                      : "text-foreground/40 hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar max-h-[380px]">
            {serviceLoading && !serviceSummary ? (
              <div className="p-6 space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={`srv-act-skel-${i}`} className="flex items-center gap-4 animate-pulse">
                    <div className="w-8 h-8 rounded-xl bg-foreground/5 shrink-0" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-3 w-36 bg-foreground/10 rounded" />
                      <div className="h-2.5 w-24 bg-foreground/5 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredActivity.length === 0 ? (
              <div className="py-16 lg:py-20 flex flex-col items-center justify-center text-center">
                <Undo2 className="w-8 h-8 text-foreground/5 mx-auto mb-3" />
                <p className="text-[10px] lg:text-[12px] font-bold text-foreground/20 uppercase tracking-[0.3em]">
                  No items in this service view
                </p>
              </div>
            ) : (
              <div className="divide-y divide-foreground/[0.03]">
                {filteredActivity.map((item, idx) => {
                  const badge = statusBadges[item.status] || {
                    label: item.status?.toUpperCase() || "PENDING",
                    color: "text-foreground/50",
                    bg: "bg-foreground/5",
                    border: "border-foreground/10",
                  };

                  return (
                    <div
                      key={item.id ? `${item.type}-${item.id}` : `act-row-${idx}`}
                      className={`px-6 lg:px-8 py-3.5 lg:py-4.5 hover:bg-foreground/[0.015] transition-all group flex items-center justify-between gap-3 ${
                        item.isReceived ? "bg-teal-500/[0.02]" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                            item.isReceived
                              ? "bg-teal-500/15 text-teal-400"
                              : item.type === "return"
                              ? "bg-amber-500/10 text-amber-500"
                              : "bg-blue-500/10 text-blue-500"
                          }`}
                        >
                          {item.isReceived ? (
                            <PackageCheck className="w-4 h-4" />
                          ) : item.type === "return" ? (
                            <Undo2 className="w-3.5 h-3.5" />
                          ) : (
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[11px] font-bold text-foreground truncate max-w-[200px] lg:max-w-[240px]">
                              {item.productTitle}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[7px] font-bold uppercase tracking-wider border ${badge.bg} ${badge.color} ${badge.border} flex items-center gap-1 shrink-0`}
                            >
                              {item.isReceived && <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />}
                              {badge.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[9px] text-foreground/40 font-medium">
                            <span>{item.customerName}</span>
                            <span className="w-1 h-1 rounded-full bg-foreground/10" />
                            <span className="font-bold text-foreground/60">{item.displayId || item.orderId}</span>
                            <span className="w-1 h-1 rounded-full bg-foreground/10" />
                            <span>
                              {new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Direct Action Link (Requirement E) */}
                      <div className="shrink-0">
                        {item.isReceived ? (
                          <Link
                            href={item.inspectUrl || `/dashboard/returns/${item.id}`}
                            className="px-3 py-1.5 rounded-xl bg-teal-500/15 text-teal-400 hover:bg-teal-500 hover:text-teal-950 border border-teal-500/30 text-[8px] font-bold uppercase tracking-wider transition-all flex items-center gap-1 active:scale-95 shadow-sm"
                          >
                            <span>Inspect & Approve</span>
                            <ArrowRight className="w-3 h-3" />
                          </Link>
                        ) : (
                          <Link
                            href={item.type === "return" ? `/dashboard/returns` : `/dashboard/exchanges`}
                            className="px-2.5 py-1 rounded-lg bg-foreground/5 hover:bg-foreground/10 text-foreground/40 hover:text-foreground text-[8px] font-bold uppercase tracking-wider transition-all"
                          >
                            View
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ─── Row 4: Critical Inventory ─── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="glass-card rounded-[2rem] lg:rounded-[3rem] overflow-hidden flex flex-col relative z-10"
      >
        <div className="px-6 lg:px-10 py-5 lg:py-8 border-b border-foreground/5 flex items-center justify-between bg-foreground/[0.01]">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[11px] lg:text-[13px] font-bold text-foreground/90 uppercase tracking-[0.3em]">
                Critical Inventory
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider bg-violet-500/10 text-violet-400 border border-violet-500/20">
                Global Warehouse
              </span>
            </div>
            <p className="text-[8px] text-foreground/30 font-bold uppercase tracking-wider mt-0.5">
              Low-stock alerts (under 10 units left) • Unified live inventory across all channels
            </p>
          </div>
          <Link
            href="/dashboard/inventory"
            className="px-4 lg:px-5 py-1.5 lg:py-2 glass rounded-full text-[8px] lg:text-[10px] font-bold text-foreground/40 hover:text-foreground hover:bg-foreground/5 uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 border border-foreground/5"
          >
            Manage <ArrowUpRight className="w-3 h-3 lg:w-4 lg:h-4" />
          </Link>
        </div>

        <div className="flex-1 overflow-x-auto custom-scrollbar">
          <div className="min-w-[500px] lg:min-w-0">
            {statsLoading && !stats ? (
              <div className="p-6 space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={`inv-skel-${i}`} className="flex items-center justify-between animate-pulse">
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-36 bg-foreground/10 rounded" />
                      <div className="h-2.5 w-20 bg-foreground/5 rounded" />
                    </div>
                    <div className="h-4 w-24 bg-foreground/10 rounded" />
                  </div>
                ))}
              </div>
            ) : (stats?.lowStockProducts || []).length === 0 ? (
              <div className="py-16 lg:py-20 flex flex-col items-center justify-center text-center">
                <p className="text-[10px] lg:text-[12px] font-bold text-foreground/20 uppercase tracking-[0.3em]">
                  No low-stock items in global warehouse
                </p>
              </div>
            ) : (
              <table className="w-full text-left whitespace-nowrap">
                <tbody className="divide-y divide-foreground/[0.03]">
                  {stats?.lowStockProducts.map((item, i) => (
                    <tr
                      key={item.sku ? `${item.sku}-${i}` : `stock-${i}`}
                      className="hover:bg-foreground/[0.01] transition-all group duration-500"
                    >
                      <td className="px-6 lg:px-10 py-4 lg:py-6 max-w-[200px] lg:max-w-[250px] truncate">
                        <p className="text-[13px] lg:text-[15px] font-bold text-foreground truncate leading-none uppercase">
                          {item.title}
                        </p>
                        <p className="text-[9px] text-foreground/30 font-bold uppercase tracking-[0.2em] mt-1.5 italic transition-colors group-hover:text-foreground/50">
                          {item.variant || "Standard"}
                        </p>
                      </td>
                      <td className="px-6 lg:px-10 py-4 lg:py-6 max-w-[120px] lg:max-w-[150px] truncate">
                        <div className="flex items-center gap-2 px-2.5 lg:px-3 py-1 lg:py-1.5 bg-foreground/5 border border-foreground/10 rounded-lg w-fit">
                          <PackageSearch className="w-2.5 h-2.5 lg:w-3 lg:h-3 text-foreground/30" />
                          <p className="text-[9px] text-foreground/50 font-bold uppercase tracking-[0.2em] truncate">
                            {item.sku || "UNASSIGNED"}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 lg:px-10 py-4 lg:py-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="px-1.5 py-0.5 rounded text-[7px] font-bold uppercase tracking-wider bg-foreground/5 text-foreground/40 hidden md:inline-block">
                            Global
                          </span>
                          <span
                            className={`text-[9px] lg:text-[11px] font-bold uppercase tracking-[0.3em] ${
                              item.stock <= 0
                                ? "text-rose-500"
                                : "text-amber-500 dark:text-amber-400"
                            }`}
                          >
                            {item.stock} <span className="hidden sm:inline">UNITS REMAINING</span>
                            <span className="sm:hidden">LEFT</span>
                          </span>
                        </div>
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
