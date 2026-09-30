"use client";

import { Suspense, useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Search,
  CheckCircle,
  Truck,
  Clock,
  AlertCircle,
  ChevronRight,
  Sparkles,
  Calendar,
  X,
  ShoppingBag,
  CreditCard,
  Banknote,
  TrendingUp,
  DollarSign,
  Package,
  RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  fulfillmentStatus: string;
  deliveryStatus?: string | null;
  deliveredAt?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  shopifyOrderId?: string | null;
  shopifyOrderName?: string | null;
  createdAt: string;
  codUpfrontPaid?: number;
  codUpfrontPaymentId?: string;
  subtotal?: number;
  discountAmount?: number;
  paymentFailureReason?: string | null;
}

function WebStoreOrdersContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams?.get("query") || searchParams?.get("search") || "";

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingPayments, setSyncingPayments] = useState(false);
  const [view, setView] = useState<"processed" | "all">("processed");
  const [search, setSearch] = useState(initialQuery);
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [fulfillmentStatus, setFulfillmentStatus] = useState("all");
  const [paymentMethod, setPaymentMethod] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    const viewParam = searchParams?.get("view");
    if (viewParam === "all") {
      setView("all");
    } else {
      setView("processed");
    }
  }, [searchParams]);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const LIMIT = 20;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("limit", LIMIT.toString());
      params.append("offset", ((page - 1) * LIMIT).toString());
      params.append("view", view);
      if (search) params.append("query", search);
      if (paymentStatus !== "all") params.append("payment_status", paymentStatus);
      if (fulfillmentStatus !== "all") params.append("fulfillment_status", fulfillmentStatus);
      if (paymentMethod !== "all") params.append("payment_method", paymentMethod);
      if (startDate) params.append("start_date", startDate);
      if (endDate) params.append("end_date", endDate);

      const res = await fetch(`/api/web-store/orders?${params.toString()}`);
      if (res.status === 401) {
        if (typeof window !== "undefined") {
          window.location.href = "/dashboard/login?callbackUrl=" + encodeURIComponent(window.location.pathname);
        }
        return;
      }
      if (!res.ok) throw new Error("Failed to load orders");
      const data = await res.json();
      setOrders(data.orders || []);
      setTotal(data.total || 0);
      setHasMore(Boolean(data.hasMore));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error fetching orders";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [LIMIT, page, view, search, paymentStatus, fulfillmentStatus, paymentMethod, startDate, endDate]);

  const handleSyncPayments = async () => {
    setSyncingPayments(true);
    try {
      const res = await fetch("/api/web-store/orders/sync-razorpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to sync Razorpay payments");
      const data = await res.json();
      if (data.updatedCount > 0) {
        toast.success(`Synced payment status for ${data.updatedCount} orders!`);
      } else {
        toast.info("All order payment statuses are up to date.");
      }
      fetchOrders();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error syncing payments";
      toast.error(msg);
    } finally {
      setSyncingPayments(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [view, search, paymentStatus, fulfillmentStatus, paymentMethod, startDate, endDate]);

  useEffect(() => {
    const timeout = setTimeout(() => fetchOrders(false), 300);
    return () => clearTimeout(timeout);
  }, [fetchOrders]);

  useEffect(() => {
    const handleSync = () => {
      fetchOrders(true);
    };
    window.addEventListener("realtime-sync", handleSync);
    return () => window.removeEventListener("realtime-sync", handleSync);
  }, [fetchOrders]);

  const getCollectedAmount = (order: Order) => {
    const isCOD = (order.paymentMethod || "").toLowerCase().trim() === "cod";
    const status = (order.paymentStatus || "").toLowerCase().trim();
    if (isCOD) {
      if (status === "paid") {
        return Number(order.totalAmount || 0);
      }
      return Number(order.codUpfrontPaid || 0);
    }
    // PREPAID: Only return total amount if payment is marked as PAID
    if (status === "paid") {
      return Number(order.totalAmount || 0);
    }
    if (status === "cod_upfront_paid" || status === "partially_paid") {
      return Number(order.codUpfrontPaid || 0);
    }
    return 0;
  };

  /* ═══ Summary Stats ═══ */
  const stats = useMemo(() => {
    const totalOrders = total;
    const totalRevenue = orders.reduce((sum, o) => {
      const status = (o.paymentStatus || "").toLowerCase().trim();
      if (status === "paid" || status === "cod_upfront_paid" || status === "partially_paid") {
        return sum + Number(o.totalAmount || 0);
      }
      return sum;
    }, 0);
    const codOrders = orders.filter(o => (o.paymentMethod || "").toLowerCase().trim() === "cod");
    const prepaidOrders = orders.filter(o => (o.paymentMethod || "").toLowerCase().trim() !== "cod");
    const totalCollected = orders.reduce((sum, o) => {
      return sum + getCollectedAmount(o);
    }, 0);
    return { totalOrders, totalRevenue, codOrders: codOrders.length, prepaidOrders: prepaidOrders.length, totalCollected };
  }, [orders, total]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(orders.map((o) => o.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => [...prev, id]);
    } else {
      setSelectedIds((prev) => prev.filter((item) => item !== id));
    }
  };

  const handleBulkUpdate = async (statusField: "paymentStatus" | "fulfillmentStatus", value: string) => {
    if (selectedIds.length === 0) return;
    setBulkActionLoading(true);
    try {
      const res = await fetch("/api/web-store/orders/bulk", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ids: selectedIds,
          [statusField]: value,
        }),
      });

      if (!res.ok) throw new Error("Failed to perform bulk update");
      const result = await res.json();
      toast.success(`Successfully updated ${result.updatedCount} orders`);
      setSelectedIds([]);
      fetchOrders();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error performing bulk action";
      toast.error(msg);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const getFulfillmentBadge = (status: string) => {
    switch (status) {
      case "delivered":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle className="w-3 h-3" /> Delivered</span>;
      case "out_for_delivery":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20"><Truck className="w-3 h-3" /> Out for Delivery</span>;
      case "shipped":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20"><Truck className="w-3 h-3" /> Shipped</span>;
      case "processing":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"><Clock className="w-3 h-3" /> Processing</span>;
      case "cancelled":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20"><X className="w-3 h-3" /> Cancelled</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20"><AlertCircle className="w-3 h-3" /> Unfulfilled</span>;
    }
  };

  const formatReasonText = (reason?: string | null) => {
    if (!reason) return null;
    if (reason === "payment_cancelled_by_user") return "Cancelled by customer";
    if (reason === "awaiting_confirmation") return "Awaiting confirmation";
    if (reason === "payment_timed_out") return "Payment timed out";
    return reason.replace(/_/g, " ");
  };

  const getPaymentBadge = (status: string, method?: string, codUpfront?: number, failureReason?: string | null) => {
    const isCOD = (method || "").toLowerCase().trim() === "cod";
    if (status === "cod_upfront_paid" || status === "partially_paid" || (isCOD && Number(codUpfront || 0) > 0)) {
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Banknote className="w-3 h-3" /> COD
          </span>
          <span className="text-[9px] font-bold text-emerald-400 pl-1">₹{codUpfront || 99} paid ✓</span>
        </div>
      );
    }

    const reasonLabel = formatReasonText(failureReason);

    switch (status) {
      case "paid":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Paid</span>;
      case "failed":
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">Failed</span>
            {reasonLabel && <span className="text-[9px] font-medium text-rose-400/80 truncate max-w-[140px]" title={reasonLabel}>{reasonLabel}</span>}
          </div>
        );
      case "cancelled":
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">Cancelled</span>
            {reasonLabel && <span className="text-[9px] font-medium text-rose-400/80 truncate max-w-[140px]" title={reasonLabel}>{reasonLabel}</span>}
          </div>
        );
      case "refunded":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">Refunded</span>;
      default:
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Pending</span>
            {reasonLabel && <span className="text-[9px] font-medium text-amber-400/80 truncate max-w-[140px]" title={reasonLabel}>{reasonLabel}</span>}
          </div>
        );
    }
  };

  const clearFilters = () => {
    setSearch("");
    setPaymentStatus("all");
    setFulfillmentStatus("all");
    setPaymentMethod("all");
    setStartDate("");
    setEndDate("");
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-inter flex items-center gap-2 text-foreground">
            Web Store Orders <Sparkles className="w-5 h-5 text-indigo-400" />
          </h1>
          <p className="text-[12px] text-foreground/50 mt-1">
            Review, ship, and update customer orders made on the zicabella.com storefront.
          </p>
        </div>

        <button
          onClick={handleSyncPayments}
          disabled={syncingPayments}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-xs font-bold text-indigo-400 hover:bg-indigo-500/20 transition-all disabled:opacity-50 shrink-0 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncingPayments ? "animate-spin" : ""}`} />
          {syncingPayments ? "Syncing..." : "Sync Razorpay Payments"}
        </button>
      </div>

      {/* ═══ Tab Switcher ═══ */}
      <div className="flex items-center gap-2 border-b border-foreground/10 pb-3">
        <button
          onClick={() => setView("processed")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            view === "processed"
              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
              : "bg-foreground/5 text-foreground/60 hover:bg-foreground/10 hover:text-foreground"
          }`}
        >
          <CheckCircle className="w-3.5 h-3.5" />
          Processed Orders
        </button>
        <button
          onClick={() => setView("all")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            view === "all"
              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
              : "bg-foreground/5 text-foreground/60 hover:bg-foreground/10 hover:text-foreground"
          }`}
        >
          <Package className="w-3.5 h-3.5" />
          All Orders
        </button>
      </div>

      {/* ═══ Summary Stats ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Orders", value: stats.totalOrders, icon: Package, color: "text-foreground" },
          { label: "Total Revenue", value: formatCurrency(stats.totalRevenue), icon: TrendingUp, color: "text-emerald-400" },
          { label: "Collected", value: formatCurrency(stats.totalCollected), icon: DollarSign, color: "text-sky-400" },
          { label: "COD Orders", value: stats.codOrders, icon: Banknote, color: "text-indigo-400" },
          { label: "Prepaid", value: stats.prepaidOrders, icon: CreditCard, color: "text-purple-400" },
        ].map((stat) => (
          <div key={stat.label} className="glass rounded-2xl border border-foreground/5 p-4 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <stat.icon className={`w-3.5 h-3.5 ${stat.color}`} />
              <span className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">{stat.label}</span>
            </div>
            <span className={`text-lg font-extrabold ${stat.color}`}>{stat.value}</span>
          </div>
        ))}
      </div>

      {/* Filters bar */}
      <div className="glass rounded-[2rem] border border-foreground/5 p-5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/35" />
            <input
              type="text"
              placeholder="Search order #, customer, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-2xl pl-11 pr-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-indigo-500/30 transition-all font-medium"
            />
          </div>

          {/* Payment status filter */}
          <select
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value)}
            className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-2xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-indigo-500/30 transition-all font-medium appearance-none"
          >
            <option value="all" className="bg-[#0e0e0e]">All Payment Statuses</option>
            <option value="pending" className="bg-[#0e0e0e]">Pending</option>
            <option value="paid" className="bg-[#0e0e0e]">Paid</option>
            <option value="cod_upfront_paid" className="bg-[#0e0e0e]">COD Upfront Paid</option>
            <option value="partially_paid" className="bg-[#0e0e0e]">Partially Paid</option>
            <option value="failed" className="bg-[#0e0e0e]">Failed</option>
            <option value="refunded" className="bg-[#0e0e0e]">Refunded</option>
            <option value="cancelled" className="bg-[#0e0e0e]">Cancelled</option>
          </select>

          {/* Fulfillment filter */}
          <select
            value={fulfillmentStatus}
            onChange={(e) => setFulfillmentStatus(e.target.value)}
            className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-2xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-indigo-500/30 transition-all font-medium appearance-none"
          >
            <option value="all" className="bg-[#0e0e0e]">All Fulfillment</option>
            <option value="unfulfilled" className="bg-[#0e0e0e]">Unfulfilled</option>
            <option value="processing" className="bg-[#0e0e0e]">Processing</option>
            <option value="shipped" className="bg-[#0e0e0e]">Shipped</option>
            <option value="delivered" className="bg-[#0e0e0e]">Delivered</option>
            <option value="returned" className="bg-[#0e0e0e]">Returned</option>
            <option value="cancelled" className="bg-[#0e0e0e]">Cancelled</option>
          </select>

          {/* Payment Method filter */}
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-2xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-indigo-500/30 transition-all font-medium appearance-none"
          >
            <option value="all" className="bg-[#0e0e0e]">All Methods</option>
            <option value="razorpay" className="bg-[#0e0e0e]">Razorpay (Prepaid)</option>
            <option value="cod" className="bg-[#0e0e0e]">Cash On Delivery</option>
          </select>
        </div>

        {/* Date range + clear */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-foreground/[0.03]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-foreground/40 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Date Range
            </span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-foreground/[0.03] border border-foreground/5 rounded-xl px-3 py-1.5 text-[11px] text-foreground focus:outline-none focus:border-indigo-500/30 transition-all"
            />
            <span className="text-xs text-foreground/30 font-medium">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-foreground/[0.03] border border-foreground/5 rounded-xl px-3 py-1.5 text-[11px] text-foreground focus:outline-none focus:border-indigo-500/30 transition-all"
            />
          </div>

          {(search || paymentStatus !== "all" || fulfillmentStatus !== "all" || paymentMethod !== "all" || startDate || endDate) && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-4 py-2 rounded-xl text-[11px] font-bold text-rose-500 hover:bg-rose-500/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Orders Table Container */}
      <div className="glass rounded-[2rem] border border-foreground/5 overflow-hidden">
        {loading ? (
          <div className="p-12 space-y-4 animate-pulse">
            {[...Array(6)].map((_, idx) => (
              <div key={idx} className="h-10 bg-foreground/5 rounded-xl w-full" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="py-20 text-center flex flex-col items-center">
            <ShoppingBag className="w-16 h-16 text-foreground/15 mb-4" />
            <h3 className="text-sm font-bold text-foreground mb-1">No Orders Found</h3>
            <p className="text-xs text-foreground/45 max-w-xs">No web orders matched your filter conditions. Try loosening filters or search queries.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-foreground/5 text-[10px] font-bold text-foreground/40 uppercase tracking-wider">
                  <th className="py-4 px-5 w-12">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === orders.length && orders.length > 0}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="rounded border-foreground/15 bg-transparent text-indigo-500 focus:ring-0 focus:ring-offset-0 w-4 h-4"
                    />
                  </th>
                  <th className="py-4 px-3">Order</th>
                  <th className="py-4 px-3">Date</th>
                  <th className="py-4 px-3">Customer</th>
                  <th className="py-4 px-3">Payment</th>
                  <th className="py-4 px-3">Fulfillment</th>
                  <th className="py-4 px-3">Method</th>
                  <th className="py-4 px-3 text-right">Total</th>
                  <th className="py-4 px-3 text-right">Collected</th>
                  <th className="py-4 px-5 w-12 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/5">
                {orders.map((order) => {
                  const isChecked = selectedIds.includes(order.id);
                  const collected = getCollectedAmount(order);
                  return (
                    <tr
                      key={order.id}
                      className={`group hover:bg-foreground/[0.01] transition-colors ${isChecked ? "bg-indigo-500/[0.02]" : ""}`}
                    >
                      <td className="py-4 px-5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => handleSelectRow(order.id, e.target.checked)}
                          className="rounded border-foreground/15 bg-transparent text-indigo-500 focus:ring-0 focus:ring-offset-0 w-4 h-4"
                        />
                      </td>
                      <td className="py-4 px-3">
                        <Link href={`/web-store/orders/${order.id}`} className="group flex flex-col gap-0.5">
                          <span className="font-mono text-[12px] font-bold text-foreground group-hover:text-indigo-400 transition-colors">
                            {order.orderNumber}
                          </span>
                          {view === "processed" && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 w-max">
                              ID: {order.orderNumber}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="py-4 px-3 text-[11px] text-foreground/60">{formatDate(order.createdAt)}</td>
                      <td className="py-4 px-3">
                        <div className="flex flex-col min-w-0">
                          <span className="text-[12px] font-semibold text-foreground truncate">{order.customerName}</span>
                          <span className="text-[9px] text-foreground/40 mt-0.5 truncate">{order.customerEmail}</span>
                        </div>
                      </td>
                      <td className="py-4 px-3">{getPaymentBadge(order.paymentStatus, order.paymentMethod, order.codUpfrontPaid, order.paymentFailureReason)}</td>
                      <td className="py-4 px-3">
                        <div className="flex flex-col gap-1 items-start">
                          {getFulfillmentBadge(order.deliveryStatus || order.fulfillmentStatus)}
                          {order.trackingNumber && (
                            order.trackingUrl ? (
                              <a
                                href={order.trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-[9px] font-mono text-indigo-400 hover:underline flex items-center gap-1"
                                title="Track Shipment"
                              >
                                {order.trackingNumber}
                              </a>
                            ) : (
                              <span className="text-[9px] font-mono text-foreground/40">{order.trackingNumber}</span>
                            )
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-3">
                        {(() => {
                          const isRowCOD = (order.paymentMethod || "").toLowerCase().trim() === "cod";
                          return (
                            <span className={`text-[10px] font-bold uppercase tracking-wider font-mono px-2 py-0.5 rounded border ${
                              isRowCOD
                                ? "text-indigo-400 bg-indigo-500/5 border-indigo-500/15"
                                : "text-foreground/60 bg-foreground/5 border-foreground/5"
                            }`}>
                              {isRowCOD ? "COD" : "PREPAID"}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-4 px-3 text-right text-[12px] font-bold text-foreground">
                        {formatCurrency(Number(order.totalAmount))}
                      </td>
                      <td className="py-4 px-3 text-right">
                        {(() => {
                          const isRowCOD = (order.paymentMethod || "").toLowerCase().trim() === "cod";
                          const status = (order.paymentStatus || "").toLowerCase().trim();
                          const isPaid = status === "paid";
                          return (
                            <>
                              <span className={`text-[12px] font-bold ${
                                collected === 0
                                  ? "text-foreground/40"
                                  : isRowCOD && !isPaid
                                  ? "text-indigo-400"
                                  : "text-emerald-400"
                              }`}>
                                {formatCurrency(collected)}
                              </span>
                              {isRowCOD && collected > 0 && !isPaid && (
                                <span className="block text-[8px] text-emerald-400/70 font-semibold">upfront ✓</span>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="py-4 px-5 text-center">
                        <Link
                          href={`/web-store/orders/${order.id}`}
                          className="w-8 h-8 rounded-xl flex items-center justify-center bg-foreground/5 text-foreground/50 hover:bg-foreground/10 hover:text-foreground transition-all"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 text-xs text-foreground/60">
          <p className="text-[11px] font-medium text-foreground/50">
            Showing <span className="font-bold text-foreground">{(page - 1) * LIMIT + 1}</span> to{" "}
            <span className="font-bold text-foreground">{Math.min(page * LIMIT, total)}</span> of{" "}
            <span className="font-bold text-foreground">{total}</span> orders
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="px-4 py-2 bg-foreground/5 hover:bg-foreground/10 disabled:opacity-30 border border-foreground/10 rounded-xl text-xs font-bold transition-all text-foreground"
            >
              Previous
            </button>
            <span className="px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/5 text-xs font-bold text-foreground">
              {page}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore && page * LIMIT >= total}
              className="px-4 py-2 bg-foreground/5 hover:bg-foreground/10 disabled:opacity-30 border border-foreground/10 rounded-xl text-xs font-bold transition-all text-foreground"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 max-w-2xl w-full px-4"
          >
            <div className="glass rounded-[2rem] border border-indigo-500/20 shadow-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 backdrop-blur-2xl">
              <div className="flex items-center gap-3">
                <div className="h-6 w-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold">
                  {selectedIds.length}
                </div>
                <span className="text-[11px] font-semibold text-foreground/80 font-inter">Orders Selected</span>
                <button
                  onClick={() => setSelectedIds([])}
                  className="text-[10px] text-foreground/40 hover:text-foreground underline transition-colors"
                >
                  Deselect all
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Bulk Payment status */}
                <select
                  disabled={bulkActionLoading}
                  onChange={(e) => {
                    if (e.target.value) {
                      handleBulkUpdate("paymentStatus", e.target.value);
                      e.target.value = "";
                    }
                  }}
                  className="bg-foreground/5 border border-foreground/5 rounded-xl px-3 py-1.5 text-[10px] font-bold text-foreground focus:outline-none focus:border-indigo-500/30 transition-all appearance-none cursor-pointer"
                >
                  <option value="">Mark Payment...</option>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                  <option value="cod_upfront_paid">COD Upfront Paid</option>
                  <option value="failed">Failed</option>
                  <option value="refunded">Refunded</option>
                </select>

                {/* Bulk Fulfillment status */}
                <select
                  disabled={bulkActionLoading}
                  onChange={(e) => {
                    if (e.target.value) {
                      handleBulkUpdate("fulfillmentStatus", e.target.value);
                      e.target.value = "";
                    }
                  }}
                  className="bg-foreground/5 border border-foreground/5 rounded-xl px-3 py-1.5 text-[10px] font-bold text-foreground focus:outline-none focus:border-indigo-500/30 transition-all appearance-none cursor-pointer"
                >
                  <option value="">Mark Fulfillment...</option>
                  <option value="unfulfilled">Unfulfilled</option>
                  <option value="processing">Processing</option>
                  <option value="shipped">Shipped</option>
                  <option value="delivered">Delivered</option>
                  <option value="returned">Returned</option>
                </select>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function WebStoreOrdersList() {
  return (
    <Suspense fallback={
      <div className="p-12 space-y-4 animate-pulse">
        <div className="h-10 bg-foreground/5 rounded-xl w-full" />
        <div className="h-10 bg-foreground/5 rounded-xl w-full" />
        <div className="h-10 bg-foreground/5 rounded-xl w-full" />
      </div>
    }>
      <WebStoreOrdersContent />
    </Suspense>
  );
}
