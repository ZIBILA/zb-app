"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Coins,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Eye,
  CreditCard,
  Wallet,
  ShieldCheck,
  User,
  ShoppingBag,
  ArrowRight,
  Loader2,
  X,
  Check,
  Package
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface RefundItem {
  id: string;
  type: string;
  returnRequestId: string;
  orderId: string;
  shopifyOrderId: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  status: string;
  refundStatus: 'PENDING' | 'COMPLETED' | 'REJECTED';
  refundAmount: number;
  refundMethod: 'original_method' | 'store_credit';
  paymentMethod: string;
  razorpayPaymentId?: string | null;
  qcStatus: string;
  createdAt: string;
  updatedAt: string;
  reason: string;
  items: Array<{
    id: string;
    title: string;
    sku: string | null;
    quantity: number;
    refundAmount: number;
    reason?: string | null;
  }>;
}

interface SummaryStats {
  totalRequests: number;
  pendingCount: number;
  completedCount: number;
  rejectedCount: number;
  totalPendingAmount: number;
  totalCompletedAmount: number;
  razorpayPendingCount: number;
  storeCreditPendingCount: number;
}

export default function RefundsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStatus = (() => {
    const s = String(searchParams.get("status") || "all").toLowerCase();
    return ["all", "pending", "completed", "rejected"].includes(s) ? s : "all";
  })();
  const [refunds, setRefunds] = useState<RefundItem[]>([]);
  const [summary, setSummary] = useState<SummaryStats>({
    totalRequests: 0,
    pendingCount: 0,
    completedCount: 0,
    rejectedCount: 0,
    totalPendingAmount: 0,
    totalCompletedAmount: 0,
    razorpayPendingCount: 0,
    storeCreditPendingCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [methodFilter, setMethodFilter] = useState("all");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Approval Modal State
  const [selectedRefund, setSelectedRefund] = useState<RefundItem | null>(null);
  const [overrideMethod, setOverrideMethod] = useState<"original_method" | "store_credit">("original_method");
  const [customAmount, setCustomAmount] = useState<string>("");
  const [actionLoading, setActionLoading] = useState(false);

  // Rejection Modal State
  const [rejectingRefund, setRejectingRefund] = useState<RefundItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchRefunds = useCallback(async (silent = false) => {
    if (!silent && refunds.length === 0) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (methodFilter !== "all") params.set("method", methodFilter);
      if (search) params.set("search", search);

      const res = await fetch(`/api/admin/refunds?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setRefunds(data.refunds || []);
        setSummary(data.summary || {
          totalRequests: 0,
          pendingCount: 0,
          completedCount: 0,
          rejectedCount: 0,
          totalPendingAmount: 0,
          totalCompletedAmount: 0,
          razorpayPendingCount: 0,
          storeCreditPendingCount: 0,
        });
      }
    } catch (err) {
      console.error("Error fetching refunds:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, methodFilter, search, refunds.length]);

  useEffect(() => {
    fetchRefunds(false);
  }, [fetchRefunds]);

  // Deep-link from Returns dashboard: /dashboard/refunds?status=pending
  useEffect(() => {
    const s = String(searchParams.get("status") || "").toLowerCase();
    if (["pending", "completed", "rejected", "all"].includes(s)) {
      setStatusFilter(s);
    }
  }, [searchParams]);

  useEffect(() => {
    const handleSync = () => fetchRefunds(true);
    window.addEventListener("realtime-sync", handleSync);
    return () => window.removeEventListener("realtime-sync", handleSync);
  }, [fetchRefunds]);

  const openApproveModal = (refund: RefundItem) => {
    setSelectedRefund(refund);
    setOverrideMethod(refund.refundMethod || "original_method");
    setCustomAmount(String(refund.refundAmount || 0));
  };

  const handleApproveRefund = async () => {
    if (!selectedRefund) return;
    setActionLoading(true);

    try {
      const res = await fetch(`/api/admin/refunds/${selectedRefund.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overrideAmount: parseFloat(customAmount) || selectedRefund.refundAmount,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message || "Refund successfully approved and processed!", "success");
        setSelectedRefund(null);
        fetchRefunds(true);
      } else {
        showToast(data.error || "Failed to process refund. Please try again.", "error");
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Network error processing refund", "error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectRefund = async () => {
    if (!rejectingRefund) return;
    setActionLoading(true);

    try {
      const res = await fetch(`/api/admin/refunds/${rejectingRefund.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast("Refund request rejected successfully.", "success");
        setRejectingRefund(null);
        setRejectReason("");
        fetchRefunds(true);
      } else {
        showToast(data.error || "Failed to reject refund", "error");
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Error rejecting refund", "error");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-6 lg:p-8 space-y-8">
      {/* Toast Banner */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-6 right-6 z-50 px-5 py-3.5 rounded-xl shadow-2xl backdrop-blur-xl border text-sm font-semibold flex items-center gap-3 ${
              toast.type === "success"
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                : "bg-rose-500/15 border-rose-500/30 text-rose-400"
            }`}
          >
            {toast.type === "success" ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Secure Admin Portal</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Refunds Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review Quality Check (QC) status and manually approve all return/exchange refunds. Auto-refunds are disabled for maximum security.
          </p>
        </div>

        <button
          onClick={() => fetchRefunds(false)}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-secondary/80 hover:bg-secondary border border-border/50 text-xs font-semibold tracking-wide transition-all self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
          <span>Refresh Queue</span>
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Pending Refunds Card */}
        <div className="p-5 rounded-2xl bg-card/60 backdrop-blur-xl border border-amber-500/20 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 text-amber-500">
            <Clock className="w-16 h-16" />
          </div>
          <div className="flex items-center gap-2 text-amber-500 text-xs font-mono uppercase tracking-wider font-semibold">
            <Clock className="w-4 h-4 animate-pulse" />
            <span>Pending Admin Approval</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black">{summary.pendingCount}</span>
            <span className="text-xs text-muted-foreground">requests</span>
          </div>
          <div className="mt-2 text-xs font-medium text-amber-400">
            Total ₹{summary.totalPendingAmount.toLocaleString('en-IN')} pending
          </div>
        </div>

        {/* Razorpay Gateway Pending */}
        <div className="p-5 rounded-2xl bg-card/60 backdrop-blur-xl border border-blue-500/20 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 text-blue-500">
            <CreditCard className="w-16 h-16" />
          </div>
          <div className="flex items-center gap-2 text-blue-400 text-xs font-mono uppercase tracking-wider font-semibold">
            <CreditCard className="w-4 h-4" />
            <span>Razorpay Auto-Refund Queue</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black">{summary.razorpayPendingCount}</span>
            <span className="text-xs text-muted-foreground">online payments</span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Executed live via Razorpay API on approval
          </div>
        </div>

        {/* Store Credit Pending */}
        <div className="p-5 rounded-2xl bg-card/60 backdrop-blur-xl border border-emerald-500/20 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 text-emerald-500">
            <Wallet className="w-16 h-16" />
          </div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono uppercase tracking-wider font-semibold">
            <Wallet className="w-4 h-4" />
            <span>Store Credit Queue</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black">{summary.storeCreditPendingCount}</span>
            <span className="text-xs text-muted-foreground">credits pending</span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Credited directly to user wallet on approval
          </div>
        </div>

        {/* Completed Refunds */}
        <div className="p-5 rounded-2xl bg-card/60 backdrop-blur-xl border border-border/50 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 text-emerald-400">
            <CheckCircle2 className="w-16 h-16" />
          </div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono uppercase tracking-wider font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            <span>Total Refunded</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black">{summary.completedCount}</span>
            <span className="text-xs text-muted-foreground">completed</span>
          </div>
          <div className="mt-2 text-xs text-emerald-400 font-semibold">
            ₹{summary.totalCompletedAmount.toLocaleString('en-IN')} refunded
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-card/40 p-4 rounded-2xl border border-border/40 backdrop-blur-lg">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by Order #, Customer Name, Email, Phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-secondary/50 border border-border/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/60"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 bg-secondary/50 p-1 rounded-xl border border-border/50 text-xs">
            <button
              onClick={() => setStatusFilter("all")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${statusFilter === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              All Status
            </button>
            <button
              onClick={() => setStatusFilter("pending")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${statusFilter === "pending" ? "bg-amber-500/20 text-amber-400 shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Pending ({summary.pendingCount})
            </button>
            <button
              onClick={() => setStatusFilter("completed")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${statusFilter === "completed" ? "bg-emerald-500/20 text-emerald-400 shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Refunded
            </button>
          </div>

          {/* Method Filter */}
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="px-3 py-2 bg-secondary/50 border border-border/50 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">All Methods</option>
            <option value="original_method">Razorpay Gateway</option>
            <option value="store_credit">Store Credit</option>
          </select>
        </div>
      </div>

      {/* Refunds Table */}
      <div className="bg-card/60 backdrop-blur-xl border border-border/40 rounded-2xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Loading refund requests queue...</p>
          </div>
        ) : refunds.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
            <Coins className="w-12 h-12 opacity-30 text-primary" />
            <h3 className="text-base font-bold">No Refund Requests Found</h3>
            <p className="text-xs max-w-sm">
              {search || statusFilter !== "all" || methodFilter !== "all"
                ? "Try clearing your filters or search terms."
                : "All return & exchange refund requests have been processed."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/40 bg-secondary/30 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  <th className="py-3.5 px-4 font-semibold">Order & Request</th>
                  <th className="py-3.5 px-4 font-semibold">Customer</th>
                  <th className="py-3.5 px-4 font-semibold">Items & Reason</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Refund Amount</th>
                  <th className="py-3.5 px-4 font-semibold text-center">Requested Method</th>
                  <th className="py-3.5 px-4 font-semibold text-center">QC Status</th>
                  <th className="py-3.5 px-4 font-semibold text-center">Refund Status</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30 text-xs">
                {refunds.map((refund) => {
                  const isPending = refund.refundStatus === "PENDING";
                  const isCompleted = refund.refundStatus === "COMPLETED";
                  const isRejected = refund.refundStatus === "REJECTED";

                  return (
                    <tr key={refund.id} className="hover:bg-secondary/20 transition-colors">
                      {/* Order & Request */}
                      <td className="py-4 px-4 font-mono">
                        <div className="font-bold text-foreground flex items-center gap-1.5">
                          <ShoppingBag className="w-3.5 h-3.5 text-primary" />
                          <span>#{refund.shopifyOrderId || refund.orderId}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(refund.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                      </td>

                      {/* Customer */}
                      <td className="py-4 px-4">
                        <div className="font-semibold text-foreground">{refund.customerName}</div>
                        <div className="text-[10px] text-muted-foreground">{refund.customerEmail || refund.customerPhone || "N/A"}</div>
                      </td>

                      {/* Items & Reason */}
                      <td className="py-4 px-4 max-w-xs">
                        <div className="space-y-1">
                          {refund.items.map((item, idx) => (
                            <div key={idx} className="text-xs truncate font-medium text-foreground">
                              {item.quantity}x {item.title} {item.sku ? `(${item.sku})` : ''}
                            </div>
                          ))}
                        </div>
                        {refund.reason && (
                          <div className="text-[10px] text-muted-foreground mt-1 truncate italic">
                            "{refund.reason}"
                          </div>
                        )}
                      </td>

                      {/* Refund Amount */}
                      <td className="py-4 px-4 text-right font-mono">
                        <span className="text-sm font-extrabold text-emerald-400">
                          ₹{refund.refundAmount.toLocaleString('en-IN')}
                        </span>
                      </td>

                      {/* Requested Method */}
                      <td className="py-4 px-4 text-center">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          refund.refundMethod === 'store_credit'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        }`}>
                          {refund.refundMethod === 'store_credit' ? (
                            <>
                              <Wallet className="w-3 h-3" />
                              <span>Store Credit</span>
                            </>
                          ) : (
                            <>
                              <CreditCard className="w-3 h-3" />
                              <span>Razorpay</span>
                            </>
                          )}
                        </span>
                      </td>

                      {/* QC Status */}
                      <td className="py-4 px-4 text-center">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-secondary text-foreground">
                          {refund.qcStatus || "PENDING"}
                        </span>
                      </td>

                      {/* Refund Status */}
                      <td className="py-4 px-4 text-center">
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <Clock className="w-3 h-3 animate-pulse" />
                            <span>Pending Approval</span>
                          </span>
                        )}
                        {isCompleted && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Refunded</span>
                          </span>
                        )}
                        {isRejected && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <XCircle className="w-3 h-3" />
                            <span>Rejected</span>
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-4 text-right">
                        {isPending ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openApproveModal(refund)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shadow-md hover:shadow-emerald-500/20 transition-all flex items-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Approve</span>
                            </button>
                            <button
                              onClick={() => setRejectingRefund(refund)}
                              className="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg font-bold text-xs transition-all flex items-center gap-1"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {isCompleted ? "Approved & Executed" : "Request Declined"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* APPROVAL MODAL */}
      <AnimatePresence>
        {selectedRefund && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border/50 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between border-b border-border/40 pb-4">
                <div>
                  <h3 className="text-lg font-bold">Approve & Execute Refund</h3>
                  <p className="text-xs text-muted-foreground">Order #{selectedRefund.shopifyOrderId || selectedRefund.orderId}</p>
                </div>
                <button
                  onClick={() => setSelectedRefund(null)}
                  className="p-1 rounded-lg hover:bg-secondary text-muted-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Items Summary */}
              <div className="bg-secondary/40 p-4 rounded-xl border border-border/40 space-y-2">
                <div className="text-xs font-mono uppercase text-muted-foreground font-semibold">Items Included</div>
                {selectedRefund.items.map((item, i) => (
                  <div key={i} className="flex justify-between items-center text-xs">
                    <span className="font-medium text-foreground">{item.quantity}x {item.title}</span>
                    <span className="font-mono text-muted-foreground">₹{item.refundAmount}</span>
                  </div>
                ))}
              </div>

              {/* Customer refund method (read-only — no admin override) */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                  Customer Refund Method
                </label>
                <div
                  className={`p-3.5 rounded-xl border text-left flex flex-col gap-1 ${
                    (selectedRefund.refundMethod || "original_method") === "store_credit"
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                      : "bg-blue-500/15 border-blue-500/40 text-blue-400"
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-xs">
                    {(selectedRefund.refundMethod || "original_method") === "store_credit" ? (
                      <Wallet className="w-4 h-4" />
                    ) : (
                      <CreditCard className="w-4 h-4" />
                    )}
                    <span>
                      {(selectedRefund.refundMethod || "original_method") === "store_credit"
                        ? "Store Credit"
                        : "Original Payment Method"}
                    </span>
                  </div>
                  <p className="text-[10px] opacity-80">
                    Processed automatically from the customer&apos;s choice at return request. No manual override.
                  </p>
                </div>
              </div>

              {/* Amount input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Approved Refund Amount (₹)</label>
                <input
                  type="number"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="w-full px-4 py-2.5 bg-secondary/50 border border-border/50 rounded-xl text-lg font-mono font-bold text-emerald-400 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedRefund(null)}
                  disabled={actionLoading}
                  className="flex-1 py-2.5 rounded-xl border border-border/50 bg-secondary/50 text-xs font-semibold hover:bg-secondary transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApproveRefund}
                  disabled={actionLoading}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>Confirm & Execute Refund</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* REJECTION MODAL */}
      <AnimatePresence>
        {rejectingRefund && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border/50 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4"
            >
              <h3 className="text-lg font-bold text-rose-400">Reject Refund Request</h3>
              <p className="text-xs text-muted-foreground">
                Provide a reason for rejecting the refund for Order #{rejectingRefund.shopifyOrderId || rejectingRefund.orderId}.
              </p>

              <textarea
                placeholder="Reason for rejection (e.g., Physical item failed Quality Check, item returned damaged)..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                className="w-full p-3 bg-secondary/50 border border-border/50 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/50"
              />

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setRejectingRefund(null)}
                  disabled={actionLoading}
                  className="flex-1 py-2.5 rounded-xl border border-border/50 bg-secondary/50 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRejectRefund}
                  disabled={actionLoading}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center justify-center gap-2"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  <span>Reject Refund</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
