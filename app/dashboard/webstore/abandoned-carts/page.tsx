"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  ShoppingCart, Users, Clock, ShoppingBag, 
  RefreshCw, Loader2, Search, User, 
  ExternalLink, Calendar, Trash2, ArrowRight,
  TrendingUp, Activity, Smartphone, Monitor,
  Zap, ChevronRight, Filter, MessageSquare,
  ChevronLeft, ArrowLeftRight, Mail
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import Link from "next/link";

interface CartItem {
  id: string;
  productId: string;
  variantId: string | null;
  handle: string | null;
  title: string | null;
  price: number | null;
  image: string | null;
  quantity: number;
  size: string | null;
  createdAt: string;
}

interface Cart {
  id: string;
  customerId: string | null;
  sessionToken: string | null;
  source: string;
  status: string;
  computedStatus: string;
  phone: string | null;
  email: string | null;
  subtotal: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  abandonedAt: string | null;
  convertedOrderId: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  customer?: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    image: string | null;
  } | null;
  items: CartItem[];
  convertedOrder?: {
    id: string;
    internalOrderNumber: string;
    totalPrice: number;
    createdAt: string;
  } | null;
  previousConversion?: {
    cartId: string;
    orderId: string;
    internalOrderNumber: string | null;
    totalPrice: number;
    convertedAt: string;
  } | null;
  nextFollowup?: {
    stage: number;
    scheduledAt: string;
    label: string;
    isOverdue: boolean;
  } | null;
}

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={`glass-card rounded-[2.5rem] overflow-hidden relative z-10 border border-foreground/5 shadow-xl ${className}`}
    >
      {children}
    </motion.div>
  );
}

export default function AbandonedCartsPage() {
  const [carts, setCarts] = useState<Cart[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "live" | "abandoned" | "converted" | "expired">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "webstore" | "app">("all");
  const [dateRange, setDateRange] = useState<"all" | "today" | "yesterday" | "last7days" | "last30days" | "custom">("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [followupFilter, setFollowupFilter] = useState<"all" | "today" | "tomorrow">("all");
  const [selectedCart, setSelectedCart] = useState<Cart | null>(null);
  const [stats, setStats] = useState<any>(null);
  
  // Marketing / Recovery tab states
  const [activeChannelTab, setActiveChannelTab] = useState<"whatsapp" | "email" | "sms" | "call">("whatsapp");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [smsBody, setSmsBody] = useState("");
  const [sendingRecovery, setSendingRecovery] = useState(false);
  const [approvedTemplates, setApprovedTemplates] = useState<any[]>([]);
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [recoveryModalCart, setRecoveryModalCart] = useState<Cart | null>(null);
  const [selectedTemplateName, setSelectedTemplateName] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCarts, setTotalCarts] = useState(0);

  const fetchCarts = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        source: sourceFilter,
        search: searchQuery,
        dateRange,
        ...(dateRange === "custom" && customStartDate ? { startDate: customStartDate } : {}),
        ...(dateRange === "custom" && customEndDate ? { endDate: customEndDate } : {}),
        followup: followupFilter,
        page: String(page),
        limit: "15"
      });
      const res = await fetch(`/api/admin/abandoned-carts?${params.toString()}`);
      if (res.status === 401) {
        if (typeof window !== "undefined") {
          window.location.href = "/dashboard/login?callbackUrl=" + encodeURIComponent(window.location.pathname);
        }
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch abandoned carts");
      const data = await res.json();
      const freshCarts: Cart[] = data.carts || [];
      setCarts(freshCarts);
      setTotalCarts(data.pagination?.total || 0);
      setTotalPages(data.pagination?.totalPages || 1);
      if (data.stats) {
        setStats(data.stats);
      }
      // Live sync: keep drawer details up to date in real time if open
      setSelectedCart((prev) => {
        if (!prev) return null;
        const matching = freshCarts.find((c) => c.id === prev.id);
        return matching || prev;
      });
    } catch (error) {
      console.error("Failed to fetch abandoned carts:", error);
      if (!isSilent) toast.error("Error connecting to server");
    } finally {
      setLoading(false);
      if (!isSilent) setRefreshing(false);
    }
  }, [statusFilter, sourceFilter, searchQuery, dateRange, customStartDate, customEndDate, followupFilter, page]);

  useEffect(() => {
    fetchCarts(false);

    // Lightweight real-time live polling every 4 seconds (when page is visible)
    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchCarts(true);
      }
    }, 4000);

    return () => clearInterval(intervalId);
  }, [fetchCarts]);

  // Search debounce or clear pagination on filter change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, sourceFilter, searchQuery]);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const res = await fetch("/api/whatsapp/templates");
        const data = await res.json();
        if (res.ok && Array.isArray(data.templates) && data.templates.length > 0) {
          const approved = data.templates.filter(
            (t: any) => t.status === "APPROVED"
          );
          if (approved.length > 0) {
            setApprovedTemplates(approved);
            return;
          }
        }
      } catch (err) {
        console.error("Failed to fetch templates:", err);
      }

      // Default fallback templates if none synced yet
      setApprovedTemplates([
        { name: "abandoned_cart_a1", category: "MARKETING", status: "APPROVED" },
        { name: "abandoned_cart_a2", category: "MARKETING", status: "APPROVED" },
        { name: "abandoned_cart_a3", category: "MARKETING", status: "APPROVED" },
        { name: "zica_cart_recovery_v1", category: "MARKETING", status: "APPROVED" },
        { name: "zb_cart_followup", category: "MARKETING", status: "APPROVED" },
        { name: "zb_cart_final", category: "MARKETING", status: "APPROVED" }
      ]);
    }
    fetchTemplates();
  }, []);

  // Prefill default message templates on cart selection
  useEffect(() => {
    if (selectedCart) {
      const name = selectedCart.customer?.name || "Customer";
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com';
      const checkoutUrl = `${siteUrl}/cart?recover=${selectedCart.id}`;
      
      setEmailSubject("We saved your Zica Bella shopping bag!");
      setEmailBody(`Hi ${name},\n\nWe noticed you left some beautiful pieces in your shopping bag. Complete your checkout now and make them yours!\n\nRestore your cart with a single click here:\n${checkoutUrl}\n\nWarm regards,\nZica Bella Team`);
      setSmsBody(`Hi ${name}, you left items in your Zica Bella bag. Complete your purchase here: ${checkoutUrl}`);
    }
  }, [selectedCart]);

  const handleSendWhatsApp = (cart: Cart) => {
    const phone = cart.phone || cart.customer?.phone;
    if (!phone) {
      toast.error("No phone number captured for this cart.");
      return;
    }
    setRecoveryModalCart(cart);
    setSelectedTemplateName("");
    setIsRecoveryModalOpen(true);
  };

  const triggerManualRecovery = async () => {
    if (!recoveryModalCart) return;
    const phone = recoveryModalCart.phone || recoveryModalCart.customer?.phone;
    if (!phone) return;

    setIsRecoveryModalOpen(false);
    const toastId = toast.loading(`Triggering WhatsApp recovery...`);
    try {
      const res = await fetch("/api/admin/abandoned-carts/send-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cartId: recoveryModalCart.id,
          channel: "whatsapp",
          templateName: selectedTemplateName || undefined
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success("WhatsApp recovery template triggered successfully!", { id: toastId });
        fetchCarts();
      } else {
        toast.error(data.error || "Failed to trigger WhatsApp message.", { id: toastId });
      }
    } catch {
      toast.error("Network error triggering WhatsApp recovery.", { id: toastId });
    }
  };

  const handleSendRecoveryChannel = async (channel: "whatsapp" | "email" | "sms") => {
    if (!selectedCart) return;
    
    const contactVal = channel === "email" 
      ? (selectedCart.email || selectedCart.customer?.email) 
      : (selectedCart.phone || selectedCart.customer?.phone);
      
    if (!contactVal) {
      toast.error(`No ${channel === "email" ? "email" : "phone"} information available for this cart.`);
      return;
    }

    setSendingRecovery(true);
    const toastId = toast.loading(`Sending ${channel.toUpperCase()} recovery...`);
    try {
      const res = await fetch("/api/admin/abandoned-carts/send-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cartId: selectedCart.id,
          channel,
          subject: channel === "email" ? emailSubject : undefined,
          messageBody: channel === "email" ? emailBody : (channel === "sms" ? smsBody : undefined)
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`${channel.toUpperCase()} recovery sent successfully!`, { id: toastId });
        fetchCarts();
      } else {
        toast.error(data.error || `Failed to send ${channel.toUpperCase()} recovery.`, { id: toastId });
      }
    } catch (err) {
      toast.error(`Network error sending ${channel.toUpperCase()} recovery.`, { id: toastId });
    } finally {
      setSendingRecovery(false);
    }
  };

  const getStatusBadge = (computedStatus: string, _lastActivity?: string) => {
    if (computedStatus === "converted") {
      return (
        <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase tracking-widest border border-emerald-500/10 italic">
          Converted
        </span>
      );
    }
    if (computedStatus === "expired") {
      return (
        <span className="px-3 py-1 rounded-full bg-red-500/10 text-red-500 text-[9px] font-black uppercase tracking-widest border border-red-500/10 italic">
          Expired
        </span>
      );
    }
    if (computedStatus === "active") {
      return (
        <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase tracking-widest border border-emerald-500/30 flex items-center gap-1.5 italic">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live Carts
        </span>
      );
    }
    return (
      <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-500 text-[9px] font-black uppercase tracking-widest border border-amber-500/10 italic">
        Abandoned
      </span>
    );
  };

  const getCartAge = (lastActivity: string) => {
    const diff = new Date().getTime() - new Date(lastActivity).getTime();
    if (diff < 60000) return "Active now";
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(lastActivity).toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-12 pb-20 pt-10 px-4 sm:px-6 lg:px-10 animate-in fade-in duration-1000">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-10 mb-16">
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-[2rem] bg-foreground text-background flex items-center justify-center shadow-[0_20px_40px_rgba(0,0,0,0.2)] rotate-3">
              <ShoppingCart className="w-8 h-8 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                 <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                 <span className="text-[10px] font-black uppercase tracking-[0.4em] text-amber-500/80">Abandoned Recovery System</span>
              </div>
              <h1 className="text-6xl md:text-8xl font-black text-foreground uppercase tracking-tighter leading-none italic">
                ABANDONED<span className="text-foreground/20 not-italic">CARTS</span>
              </h1>
            </div>
          </div>
          <p className="text-[12px] text-foreground/40 font-bold uppercase tracking-[0.5em] max-w-xl leading-relaxed">
            Natively tracking and recovering checkout sessions across webstore and app channels.
          </p>
        </div>

        <div className="flex items-center gap-6">
          <button
            onClick={() => fetchCarts(false)}
            disabled={refreshing}
            className="flex items-center justify-center gap-4 px-10 py-5 rounded-[2rem] text-[11px] font-black tracking-[0.3em] uppercase bg-foreground text-background hover:scale-105 transition-all active:scale-95 disabled:opacity-50 shadow-2xl"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Updating sessions..." : "Refresh list"}
          </button>
        </div>
      </div>

      {/* Executive KPI Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <GlassCard className="p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-foreground/40 mb-3">
            <span className="text-[9px] font-black uppercase tracking-widest">Total Tracked</span>
            <ShoppingCart className="w-4 h-4 text-foreground/50" />
          </div>
          <div>
            <div className="text-3xl font-black italic text-foreground tracking-tight">{stats?.totalTracked || 0}</div>
            <span className="text-[9px] font-bold text-foreground/30 uppercase tracking-wider block mt-1">Sessions</span>
          </div>
        </GlassCard>

        <GlassCard className="p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-400 mb-3">
            <span className="text-[9px] font-black uppercase tracking-widest">Live Carts</span>
            <Activity className="w-4 h-4 animate-pulse text-emerald-400" />
          </div>
          <div>
            <div className="text-3xl font-black italic text-emerald-400 tracking-tight">{stats?.liveCount || 0}</div>
            <span className="text-[9px] font-bold text-emerald-500/50 uppercase tracking-wider block mt-1">Active Now</span>
          </div>
        </GlassCard>

        <GlassCard className="p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-amber-500 mb-3">
            <span className="text-[9px] font-black uppercase tracking-widest">Abandoned</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div>
            <div className="text-3xl font-black italic text-amber-500 tracking-tight">{stats?.abandonedCount || 0}</div>
            <span className="text-[9px] font-bold text-amber-500/50 uppercase tracking-wider block mt-1">Need Recovery</span>
          </div>
        </GlassCard>

        <GlassCard className="p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-500 mb-3">
            <span className="text-[9px] font-black uppercase tracking-widest">Converted</span>
            <ShoppingBag className="w-4 h-4 text-emerald-500" />
          </div>
          <div>
            <div className="text-3xl font-black italic text-emerald-500 tracking-tight">{stats?.convertedCount || 0}</div>
            <span className="text-[9px] font-bold text-emerald-500/50 uppercase tracking-wider block mt-1">Orders Placed</span>
          </div>
        </GlassCard>

        <GlassCard className="p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-foreground/40 mb-3">
            <span className="text-[9px] font-black uppercase tracking-widest">Recovered Revenue</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-2xl font-black italic text-foreground tracking-tight">₹{(stats?.convertedRevenue || 0).toLocaleString()}</div>
            <span className="text-[9px] font-bold text-emerald-400/60 uppercase tracking-wider block mt-1">Converted Value</span>
          </div>
        </GlassCard>

        <GlassCard className="p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-foreground/40 mb-3">
            <span className="text-[9px] font-black uppercase tracking-widest">Recovery Rate</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="text-3xl font-black italic text-foreground tracking-tight">{stats?.recoveryRate || 0}%</div>
            <span className="text-[9px] font-bold text-foreground/30 uppercase tracking-wider block mt-1">Conversion %</span>
          </div>
        </GlassCard>
      </div>

      {/* Filter and Search Bar */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-center">
          {/* Search */}
          <div className="lg:col-span-2 relative group">
            <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/20 group-focus-within:text-foreground/50 transition-colors" />
            <input 
              type="text" 
              placeholder="Search by customer phone, email, or name..." 
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full bg-foreground/[0.03] border border-foreground/[0.08] rounded-[2rem] pl-16 pr-6 py-4 text-[13px] font-bold focus:outline-none focus:bg-foreground/[0.05] focus:border-foreground/20 transition-all shadow-sm placeholder:text-foreground/20"
            />
          </div>

          {/* Date Range Filter */}
          <div className="flex items-center gap-3">
            <Calendar className="w-4 h-4 text-foreground/40 shrink-0" />
            <select 
              value={dateRange}
              onChange={(e: any) => { setDateRange(e.target.value); setPage(1); }}
              className="flex-1 bg-foreground/[0.03] border border-foreground/[0.08] rounded-[1.5rem] px-4 py-4 text-[11px] font-black uppercase tracking-widest text-foreground/75 focus:outline-none focus:border-foreground/20 transition-all"
            >
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last7days">Last 7 Days</option>
              <option value="last30days">Last 30 Days</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30">Status</span>
            <select 
              value={statusFilter}
              onChange={(e: any) => { setStatusFilter(e.target.value); setPage(1); }}
              className="flex-1 bg-foreground/[0.03] border border-foreground/[0.08] rounded-[1.5rem] px-4 py-4 text-[11px] font-black uppercase tracking-widest text-foreground/75 focus:outline-none focus:border-foreground/20 transition-all"
            >
              <option value="all">All Carts</option>
              <option value="live">Live Only</option>
              <option value="abandoned">Abandoned Only</option>
              <option value="converted">Converted Only</option>
              <option value="expired">Expired Only</option>
            </select>
          </div>

          {/* Source Filter */}
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30">Source</span>
            <select 
              value={sourceFilter}
              onChange={(e: any) => { setSourceFilter(e.target.value); setPage(1); }}
              className="flex-1 bg-foreground/[0.03] border border-foreground/[0.08] rounded-[1.5rem] px-4 py-4 text-[11px] font-black uppercase tracking-widest text-foreground/75 focus:outline-none focus:border-foreground/20 transition-all"
            >
              <option value="all">All Channels</option>
              <option value="webstore">Web Store</option>
              <option value="app">Mobile App</option>
            </select>
          </div>
        </div>

        {/* Custom Date Range Pickers (rendered when custom is active) */}
        {dateRange === "custom" && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="flex items-center gap-4 bg-foreground/[0.02] border border-foreground/[0.08] px-6 py-4 rounded-[1.5rem] flex-wrap"
          >
            <span className="text-[10px] font-black uppercase tracking-widest text-foreground/50">Custom Range:</span>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">From</span>
              <input 
                type="date" 
                value={customStartDate} 
                onChange={(e) => { setCustomStartDate(e.target.value); setPage(1); }}
                className="bg-foreground/[0.04] border border-foreground/10 rounded-xl px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-foreground/30"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">To</span>
              <input 
                type="date" 
                value={customEndDate} 
                onChange={(e) => { setCustomEndDate(e.target.value); setPage(1); }}
                className="bg-foreground/[0.04] border border-foreground/10 rounded-xl px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-foreground/30"
              />
            </div>
          </motion.div>
        )}

        {/* Upcoming Scheduled Follow-up Activity Tabs */}
        <div className="flex items-center justify-between gap-4 flex-wrap pt-2 border-t border-foreground/[0.05]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-black uppercase tracking-widest text-foreground/40 mr-1 flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-foreground/40" />
              Upcoming Follow-ups:
            </span>
            <button
              onClick={() => { setFollowupFilter("all"); setPage(1); }}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                followupFilter === "all"
                  ? "bg-foreground text-background shadow-md"
                  : "bg-foreground/[0.03] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06]"
              }`}
            >
              All Sessions
            </button>
            <button
              onClick={() => { setFollowupFilter("today"); setPage(1); }}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${
                followupFilter === "today"
                  ? "bg-amber-500 text-white shadow-md shadow-amber-500/20"
                  : "bg-foreground/[0.03] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06]"
              }`}
            >
              <Clock className="w-3 h-3" />
              <span>Today</span>
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                followupFilter === "today" ? "bg-white/20 text-white" : "bg-foreground/10 text-foreground/75"
              }`}>
                {stats?.followupsTodayCount || 0}
              </span>
            </button>
            <button
              onClick={() => { setFollowupFilter("tomorrow"); setPage(1); }}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${
                followupFilter === "tomorrow"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                  : "bg-foreground/[0.03] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06]"
              }`}
            >
              <Calendar className="w-3 h-3" />
              <span>Tomorrow</span>
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                followupFilter === "tomorrow" ? "bg-white/20 text-white" : "bg-foreground/10 text-foreground/75"
              }`}>
                {stats?.followupsTomorrowCount || 0}
              </span>
            </button>
          </div>

          <div className="text-[10px] font-mono text-foreground/40">
            Showing {carts.length} of {totalCarts} results
          </div>
        </div>
      </div>

      {/* Carts Table/List */}
      <div className="space-y-6">
        {loading ? (
          <div className="py-32 flex flex-col items-center gap-6">
            <Loader2 className="w-12 h-12 animate-spin text-foreground/20" />
            <p className="text-[11px] font-black uppercase tracking-[0.5em] text-foreground/20">Loading cart database...</p>
          </div>
        ) : carts.length > 0 ? (
          <div className="grid grid-cols-1 gap-6">
            {carts.map((cart) => {
              const displayName = cart.customer?.name || (cart.email ? cart.email.split('@')[0] : null) || (cart.phone ? `Guest (${cart.phone})` : "Guest Customer");
              const displayContact = cart.phone || cart.customer?.phone || cart.email || cart.customer?.email || "No contact info";
              const isLive = new Date().getTime() - new Date(cart.lastActivityAt).getTime() < 5 * 60 * 1000;

              return (
                <GlassCard key={cart.id} className="group hover:border-foreground/10 transition-all duration-500">
                  <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between p-8 gap-8">
                    {/* Customer Signature & Channel Info */}
                    <div className="flex items-center gap-5 min-w-[280px]">
                      <div className="relative">
                        <div className="w-14 h-14 rounded-2xl bg-foreground/5 flex items-center justify-center border border-foreground/10 overflow-hidden relative">
                          {cart.customer?.image ? (
                            <img src={cart.customer.image} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-6 h-6 text-foreground/20" />
                          )}
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-foreground/5 border-2 border-background flex items-center justify-center">
                          {cart.source === "app" ? (
                            <Smartphone className="w-3 h-3 text-foreground/60" />
                          ) : (
                            <Monitor className="w-3 h-3 text-foreground/60" />
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-xl font-black italic text-foreground tracking-tight leading-none">
                          {displayName}
                        </h3>
                        <p className="text-[10px] text-foreground/40 font-mono">
                          {displayContact}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[8px] font-black uppercase tracking-widest text-foreground/30 px-2 py-0.5 rounded-full bg-foreground/[0.04] border border-foreground/5">
                            {cart.source === "app" ? "Mobile App" : "Web Store"}
                          </span>
                          {cart.nextFollowup && (
                            <span 
                              className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex items-center gap-1 border ${
                                cart.nextFollowup.isOverdue
                                  ? "bg-amber-500/10 border-amber-500/25 text-amber-500"
                                  : "bg-blue-500/10 border-blue-500/25 text-blue-500"
                              }`}
                              title={`Follow-up Scheduled: ${new Date(cart.nextFollowup.scheduledAt).toLocaleString()}`}
                            >
                              <Clock className="w-2.5 h-2.5" />
                              <span>Follow-up: {cart.nextFollowup.label}</span>
                              <span className="opacity-70 font-mono">
                                ({new Date(cart.nextFollowup.scheduledAt).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}{" "}
                                {new Date(cart.nextFollowup.scheduledAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })})
                              </span>
                            </span>
                          )}
                          {cart.previousConversion && (
                            <span 
                              className="text-[8px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1"
                              title={`Previous Order: ${cart.previousConversion.internalOrderNumber || 'Converted'} (₹${(cart.previousConversion.totalPrice || 0).toLocaleString()})`}
                            >
                              <span>✓ Repeat Customer</span>
                              {cart.previousConversion.internalOrderNumber && (
                                <span className="opacity-80">({cart.previousConversion.internalOrderNumber})</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Thumbnail Stack & Items Summary */}
                    <div className="flex items-center gap-4 flex-1">
                      <div className="flex -space-x-4 overflow-hidden py-1">
                        {cart.items.slice(0, 3).map((item) => (
                          <div key={item.id} className="w-12 h-15 rounded-xl border border-background bg-foreground/5 overflow-hidden shadow-md shrink-0">
                            {item.image ? (
                              <img src={item.image} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[10px]">📦</div>
                            )}
                          </div>
                        ))}
                        {cart.items.length > 3 && (
                          <div className="w-12 h-15 rounded-xl border border-background bg-foreground flex items-center justify-center text-[10px] font-bold text-background shrink-0">
                            +{cart.items.length - 3}
                          </div>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 block">Items</span>
                        <span className="text-[12px] font-black text-foreground/75 block">
                          {cart.items.length} {cart.items.length === 1 ? "Product" : "Products"} ({cart.items.reduce((acc, i) => acc + i.quantity, 0)} Units)
                        </span>
                      </div>
                    </div>

                    {/* Financial value */}
                    <div className="min-w-[120px]">
                      <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 block">Subtotal</span>
                      <span className="text-[18px] font-black text-foreground italic leading-tight block">
                        ₹{(cart.subtotal || 0).toLocaleString()}
                      </span>
                    </div>

                    {/* Location Telemetry */}
                    <div className="min-w-[140px]">
                      <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 block">Location</span>
                      <span className="text-[12px] font-black text-foreground/80 block truncate max-w-[160px]" title={[cart.city, cart.state, cart.country].filter(Boolean).join(", ")}>
                        📍 {[cart.city, cart.country || cart.state].filter(Boolean).join(", ") || "IP Location Resolved"}
                      </span>
                      <span className="text-[9.5px] text-foreground/30 block">
                        {cart.latitude && cart.longitude ? "GPS Verified" : "IP Geolocation"}
                      </span>
                    </div>

                    {/* Age / Time telemetry */}
                    <div className="min-w-[130px]">
                      <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 block">
                        {cart.computedStatus === "converted" ? "Converted" : "Activity"}
                      </span>
                      <span className="text-[13px] font-bold text-foreground/70 block">
                        {getCartAge(cart.computedStatus === "converted" ? cart.updatedAt : cart.lastActivityAt)}
                      </span>
                      <span className="text-[9.5px] text-foreground/30 block">
                        {cart.computedStatus === "converted" ? "Converted: " : "Last Active: "}
                        {new Date(cart.computedStatus === "converted" ? cart.updatedAt : cart.lastActivityAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    {/* Status Badge & Actions */}
                    <div className="flex items-center gap-4 min-w-[260px] justify-end">
                      {getStatusBadge(cart.computedStatus, cart.lastActivityAt)}

                      <button
                        onClick={() => setSelectedCart(cart)}
                        className="p-3 rounded-2xl bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 text-foreground/60 transition-all hover:scale-105 active:scale-95"
                        title="View Details"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>

                      {cart.computedStatus === "converted" ? (
                        <Link
                          href={`/web-store/orders?query=${cart.convertedOrder?.internalOrderNumber || cart.convertedOrderId || ''}`}
                          className="flex items-center gap-1.5 px-4 py-3 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white border border-emerald-500/20 transition-all hover:scale-105 active:scale-95 font-bold uppercase tracking-widest text-[9px]"
                        >
                          <ShoppingBag className="w-3.5 h-3.5" />
                          {cart.convertedOrder?.internalOrderNumber || "Order"}
                        </Link>
                      ) : (
                        (cart.phone || cart.customer?.phone) && (
                          <button
                            onClick={() => handleSendWhatsApp(cart)}
                            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white border border-emerald-500/20 transition-all hover:scale-105 active:scale-95 font-bold uppercase tracking-widest text-[9px]"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            Recover
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        ) : (
          <div className="py-48 flex flex-col items-center justify-center gap-8">
            <div className="w-20 h-20 rounded-[2rem] bg-foreground/5 flex items-center justify-center text-foreground/20 border border-foreground/5">
              <ShoppingCart className="w-8 h-8" />
            </div>
            <div className="text-center">
              <h3 className="text-xl font-bold">No Carts Found</h3>
              <p className="text-sm text-foreground/40 mt-1">There are no shopping carts matching your current filter criteria.</p>
            </div>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-6 pt-10">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-4 rounded-2xl bg-foreground/5 border border-foreground/10 text-foreground disabled:opacity-30 hover:bg-foreground/10 transition-all"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-[11px] font-black uppercase tracking-widest text-foreground/50">
            Page {page} of {totalPages} ({totalCarts} Total Carts)
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-4 rounded-2xl bg-foreground/5 border border-foreground/10 text-foreground disabled:opacity-30 hover:bg-foreground/10 transition-all"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Slide-over / Modal for Cart Details */}
      <AnimatePresence>
        {selectedCart && (
          <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedCart(null)}
              className="absolute inset-0 bg-background/80 backdrop-blur-md"
            />

            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative w-full max-w-2xl bg-background border-l border-foreground/10 shadow-2xl h-full flex flex-col overflow-hidden z-10"
            >
              {/* Drawer Header */}
              <div className="p-8 border-b border-foreground/10 flex items-center justify-between bg-foreground/[0.02]">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-black italic tracking-wide">Cart Details</h2>
                    {getStatusBadge(selectedCart.computedStatus, selectedCart.lastActivityAt)}
                  </div>
                  <p className="text-[10px] text-foreground/40 font-black uppercase tracking-widest mt-1">
                    Cart ID: {selectedCart.id}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedCart(null)}
                  className="p-3 rounded-2xl bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 transition-all"
                >
                  <ChevronRight className="w-5 h-5 text-foreground/60" />
                </button>
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Customer / Shopper Info */}
                <div className="p-6 rounded-3xl bg-neutral-50 dark:bg-foreground/[0.02] border border-neutral-200 dark:border-foreground/[0.06] space-y-4">
                  <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 block border-b border-neutral-200 dark:border-foreground/5 pb-2">Shopper Identity</span>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-foreground/5 border border-foreground/10 flex items-center justify-center text-lg font-bold">
                      {selectedCart.customer?.name ? selectedCart.customer.name.slice(0, 1) : "G"}
                    </div>
                    <div>
                      <h4 className="font-bold text-lg leading-tight">
                        {selectedCart.customer?.name || "Guest Shopper"}
                      </h4>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-[12px] text-foreground/60">
                        {(selectedCart.phone || selectedCart.customer?.phone) && (
                          <span>📞 {selectedCart.phone || selectedCart.customer?.phone}</span>
                        )}
                        {(selectedCart.email || selectedCart.customer?.email) && (
                          <span>✉️ {selectedCart.email || selectedCart.customer?.email}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-foreground/40 font-bold uppercase tracking-widest mt-2 flex items-center gap-3">
                        <p>Session ID: {selectedCart.id.slice(0, 16)}...</p>
                        <p>Channel: {selectedCart.source === "app" ? "Mobile App" : "Web Store"}</p>
                      </div>
                    </div>
                  </div>
                  
                  {selectedCart.customer && (
                    <div className="pt-2">
                      <Link
                        href={`/dashboard/customers/${selectedCart.customer.id}`}
                        className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-foreground/50 hover:text-foreground transition-colors border-b border-foreground/10 pb-0.5"
                      >
                        View profile details <ExternalLink className="w-3 h-3" />
                      </Link>
                    </div>
                  )}
                </div>

                {/* Geolocation Details */}
                <div className="p-6 rounded-3xl bg-neutral-50 dark:bg-foreground/[0.02] border border-neutral-200 dark:border-foreground/[0.06] space-y-4">
                  <div className="flex items-center justify-between border-b border-neutral-200 dark:border-foreground/5 pb-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 block">Location Telemetry</span>
                    <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-foreground/5 text-foreground/60 border border-foreground/10">
                      {selectedCart.latitude && selectedCart.longitude ? "GPS Geolocation" : "IP Geolocation (Guest/Opt-out)"}
                    </span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-foreground/[0.04] rounded-xl border border-foreground/5 text-lg">
                        📍
                      </div>
                      <div>
                        <p className="text-[14px] font-black italic text-foreground leading-none">
                          {[selectedCart.city, selectedCart.state].filter(Boolean).join(", ") || "City & Region via IP Geo"}
                        </p>
                        <p className="text-[10px] text-foreground/40 font-bold uppercase tracking-widest mt-1">
                          {[selectedCart.zip, selectedCart.country || "India"].filter(Boolean).join(" • ")}
                        </p>
                      </div>
                    </div>
                    {selectedCart.latitude !== null && selectedCart.latitude !== undefined && selectedCart.longitude !== null && selectedCart.longitude !== undefined ? (
                      <div className="flex items-center justify-between text-[11px] font-mono text-foreground/30 border-t border-foreground/5 pt-2.5">
                        <span>Coordinates: {selectedCart.latitude.toFixed(4)}°, {selectedCart.longitude.toFixed(4)}°</span>
                        <a 
                          href={`https://www.google.com/maps/search/?api=1&query=${selectedCart.latitude},${selectedCart.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-black uppercase tracking-widest text-emerald-500 hover:text-emerald-400 transition-colors"
                        >
                          View Map ↗
                        </a>
                      </div>
                    ) : (
                      <div className="text-[10px] font-mono text-foreground/40 border-t border-foreground/5 pt-2.5 flex items-center justify-between">
                        <span>IP Geolocation tracking active for guest/opt-out shoppers</span>
                        <span className="text-emerald-500 font-bold">Enabled ✓</span>
                      </div>
                    )}
                  </div>
                </div>
              {/* Engage Shopper / Recovery actions */}
              {selectedCart.computedStatus !== "converted" && (
                <div className="p-6 rounded-3xl bg-neutral-50 dark:bg-foreground/[0.02] border border-neutral-200 dark:border-foreground/[0.06] space-y-6">
                  <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 block border-b border-neutral-200 dark:border-foreground/5 pb-2">Engage Shopper</span>
                  
                  {/* Channel Tabs */}
                  <div className="grid grid-cols-4 gap-2 border-b border-neutral-200 dark:border-foreground/5 pb-3">
                    {(["whatsapp", "email", "sms", "call"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveChannelTab(tab)}
                        className={`py-2 px-1 rounded-xl text-[10px] font-black uppercase tracking-wider text-center transition-all ${
                          activeChannelTab === tab
                            ? "bg-foreground text-background shadow-md"
                            : "bg-neutral-100 dark:bg-foreground/5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-foreground/10"
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  {/* WhatsApp Tab */}
                  {activeChannelTab === "whatsapp" && (
                    <div className="space-y-4">
                      <p className="text-[11px] text-neutral-500 dark:text-foreground/60 leading-relaxed">
                        Sends a WhatsApp recovery notification template to the customer with an active recovery URL.
                      </p>
                      {selectedCart.phone || selectedCart.customer?.phone ? (
                        <button
                          onClick={() => handleSendWhatsApp(selectedCart)}
                          disabled={sendingRecovery}
                          className="w-full flex items-center justify-center gap-3 py-4 rounded-[1.5rem] bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all disabled:opacity-50"
                        >
                          <MessageSquare className="w-4 h-4" /> Send WhatsApp Recovery
                        </button>
                      ) : (
                        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] text-center font-bold">
                          Phone number not captured for this session.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Email Tab */}
                  {activeChannelTab === "email" && (
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase tracking-widest text-neutral-400">Email Subject</label>
                        <input
                          type="text"
                          value={emailSubject}
                          onChange={(e) => setEmailSubject(e.target.value)}
                          className="w-full bg-neutral-100 dark:bg-foreground/5 border border-neutral-200 dark:border-foreground/10 rounded-xl px-4 py-3 text-[12px] focus:outline-none focus:border-foreground/30 text-neutral-900 dark:text-neutral-100"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase tracking-widest text-neutral-400">Email Message Note</label>
                        <textarea
                          rows={4}
                          value={emailBody}
                          onChange={(e) => setEmailBody(e.target.value)}
                          className="w-full bg-neutral-100 dark:bg-foreground/5 border border-neutral-200 dark:border-foreground/10 rounded-xl px-4 py-3 text-[12px] focus:outline-none focus:border-foreground/30 text-neutral-900 dark:text-neutral-100 font-sans"
                        />
                      </div>
                      {selectedCart.email || selectedCart.customer?.email ? (
                        <button
                          onClick={() => handleSendRecoveryChannel("email")}
                          disabled={sendingRecovery}
                          className="w-full flex items-center justify-center gap-3 py-4 rounded-[1.5rem] bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all disabled:opacity-50"
                        >
                          <Mail className="w-4 h-4" /> Send Email Recovery
                        </button>
                      ) : (
                        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] text-center font-bold">
                          Email signature not captured for this session.
                        </div>
                      )}
                    </div>
                  )}

                  {/* SMS Tab */}
                  {activeChannelTab === "sms" && (
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase tracking-widest text-neutral-400">SMS Body Message</label>
                        <textarea
                          rows={3}
                          value={smsBody}
                          onChange={(e) => setSmsBody(e.target.value)}
                          className="w-full bg-neutral-100 dark:bg-foreground/5 border border-neutral-200 dark:border-foreground/10 rounded-xl px-4 py-3 text-[12px] focus:outline-none focus:border-foreground/30 text-neutral-900 dark:text-neutral-100 font-sans"
                        />
                      </div>
                      {selectedCart.phone || selectedCart.customer?.phone ? (
                        <button
                          onClick={() => handleSendRecoveryChannel("sms")}
                          disabled={sendingRecovery}
                          className="w-full flex items-center justify-center gap-3 py-4 rounded-[1.5rem] bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-black uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all disabled:opacity-50"
                        >
                          <Smartphone className="w-4 h-4" /> Send SMS Recovery
                        </button>
                      ) : (
                        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] text-center font-bold">
                          Phone number not captured for this session.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Call Tab */}
                  {activeChannelTab === "call" && (
                    <div className="space-y-4 text-center">
                      <p className="text-[12px] text-neutral-500 dark:text-foreground/60">
                        Initiate a direct customer support phone call to resolve sizing, queries, or cart issues.
                      </p>
                      {selectedCart.phone || selectedCart.customer?.phone ? (
                        <div className="space-y-3">
                          <p className="text-[14px] font-mono font-bold text-neutral-800 dark:text-white">
                            Phone: {selectedCart.phone || selectedCart.customer?.phone}
                          </p>
                          <a
                            href={`tel:${selectedCart.phone || selectedCart.customer?.phone}`}
                            className="w-full flex items-center justify-center gap-3 py-4 rounded-[1.5rem] bg-foreground text-background text-[10px] font-black uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all inline-block text-center"
                          >
                            <Smartphone className="w-4 h-4" /> Call Now
                          </a>
                        </div>
                      ) : (
                        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] font-bold">
                          Phone signature not captured for this session.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Conversion order details */}
              {selectedCart.computedStatus === "converted" && (
                <div className="p-6 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 space-y-4 shadow-lg">
                  <div className="flex items-center gap-3 border-b border-emerald-500/20 pb-3">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-black">✓</div>
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500 block">Cart Successfully Converted</span>
                      <h4 className="text-lg font-black text-foreground italic">
                        {selectedCart.convertedOrder?.internalOrderNumber ? `Order #${selectedCart.convertedOrder.internalOrderNumber}` : "Converted to Order"}
                      </h4>
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-1">
                    <div>
                      {selectedCart.convertedOrder?.totalPrice ? (
                        <p className="text-[11px] text-foreground/70 font-mono">Order Amount: ₹{selectedCart.convertedOrder.totalPrice.toLocaleString()}</p>
                      ) : (
                        <p className="text-[11px] text-foreground/70 font-mono">Linked Order ID: {selectedCart.convertedOrderId || 'Verified'}</p>
                      )}
                    </div>
                    <Link
                      href={`/web-store/orders?query=${selectedCart.convertedOrder?.internalOrderNumber || selectedCart.convertedOrderId || ''}`}
                      className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest shadow-xl hover:scale-105 transition-all flex items-center gap-2"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> View Order Details
                    </Link>
                  </div>
                </div>
              )}

              {/* Items List */}
              <div className="space-y-6">
                <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 block border-b border-neutral-200 dark:border-foreground/5 pb-2">Cart Payload</span>
                <div className="space-y-4">
                  {selectedCart.items.map((item) => (
                    <div key={item.id} className="flex gap-5 p-4 rounded-2xl bg-neutral-50 dark:bg-foreground/[0.01] border border-neutral-200 dark:border-foreground/[0.04]">
                      <div className="w-16 h-20 rounded-xl overflow-hidden bg-foreground/5 shrink-0">
                        {item.image ? (
                          <img src={item.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px]">📦</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                        <div>
                          <h4 className="text-[13.5px] font-black text-foreground leading-tight italic truncate">{item.title}</h4>
                          <p className="text-[9px] font-mono text-neutral-500 dark:text-foreground/40 mt-1">ID: {item.productId.slice(-8)}</p>
                        </div>
                        <div className="flex justify-between items-end">
                          <span className="text-[12px] font-black text-neutral-800 dark:text-foreground/75">
                            ₹{(item.price || 0).toLocaleString()} <span className="text-[10px] text-neutral-500 dark:text-foreground/30 font-normal">x{item.quantity}</span>
                          </span>
                          {item.size && (
                            <span className="text-[9px] font-black uppercase tracking-widest text-foreground/50 px-2 py-0.5 rounded bg-foreground/5 border border-foreground/5">
                              Size: {item.size}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

              {/* Value summary and close panel */}
              <div className="p-8 border-t border-neutral-200 dark:border-foreground/10 space-y-6 bg-foreground/[0.02]">
                <div className="flex justify-between items-end">
                  <span className="text-[10px] font-black uppercase tracking-widest text-foreground/30">Total accumulated value</span>
                  <span className="text-3xl font-black text-foreground italic leading-none">₹{(selectedCart.subtotal || 0).toLocaleString()}</span>
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={() => setSelectedCart(null)}
                    className="w-full py-5 rounded-[2rem] bg-foreground/5 border border-neutral-200 dark:border-foreground/10 text-foreground text-[10px] font-black uppercase tracking-[0.2em] hover:bg-foreground/10 active:scale-95 transition-all text-center"
                  >
                    Close panel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Recovery Template Selection Modal */}
      <AnimatePresence>
        {isRecoveryModalOpen && recoveryModalCart && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsRecoveryModalOpen(false)}
              className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-x-4 top-[20%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-md bg-white dark:bg-neutral-900 rounded-[2.5rem] border border-neutral-200 dark:border-foreground/10 p-8 z-[101] shadow-2xl text-neutral-900 dark:text-neutral-100 space-y-6"
            >
              <div className="flex justify-between items-center border-b border-neutral-100 dark:border-foreground/10 pb-4">
                <h3 className="text-2xl font-black italic uppercase tracking-tight text-foreground">Select Recovery Template</h3>
                <button
                  onClick={() => setIsRecoveryModalOpen(false)}
                  className="w-8 h-8 rounded-full border border-neutral-200 dark:border-foreground/10 flex items-center justify-center text-foreground/45 hover:bg-foreground/5 transition-colors"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30">Recipient</span>
                  <p className="text-sm font-bold text-foreground">{recoveryModalCart.customer?.name || "Guest Customer"}</p>
                  <p className="text-xs text-foreground/40 font-mono">{recoveryModalCart.phone || recoveryModalCart.customer?.phone}</p>
                </div>

                <div className="space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30">Select Template</span>
                  <select
                    value={selectedTemplateName}
                    onChange={(e) => setSelectedTemplateName(e.target.value)}
                    className="w-full bg-foreground/[0.03] border border-foreground/[0.08] rounded-xl px-4 py-3 text-[12px] font-bold text-foreground focus:outline-none focus:border-foreground/20 transition-all"
                  >
                    <option value="">Auto (Use mapped template in Automations settings)</option>
                    {approvedTemplates.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name} ({t.category})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-4 pt-2">
                <button
                  onClick={() => setIsRecoveryModalOpen(false)}
                  className="w-1/2 py-4 rounded-2xl bg-foreground/5 border border-neutral-200 dark:border-foreground/10 text-foreground text-[10px] font-black uppercase tracking-wider hover:bg-foreground/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={triggerManualRecovery}
                  className="w-1/2 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black uppercase tracking-wider shadow-lg transition-colors"
                >
                  Send Template
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
