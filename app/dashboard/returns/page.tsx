"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, CheckCircle2, XCircle, RefreshCw, Package, CreditCard, AlertTriangle, Check, X, Clock, Inbox, Eye, ArrowRight, TruckIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatExactDateTime, extractItemVariantAndSize } from "@/lib/utils";
import { formatDisplayOrderNumber } from "@/lib/formatOrderNumber";
import VariantBadge from "@/components/admin/VariantBadge";
import InlineSizeSelector from "@/components/admin/InlineSizeSelector";
import { parseLinkedId } from "@/lib/linkedIds";
import { COD_STORE_CREDIT_MESSAGE } from "@/lib/returnPolicy";

type ReturnRequest = {
  returnRequestId: string;
  displayId?: string | null;
  logisticsPartner?: string | null;
  reverseAwb?: string | null;
  receivedAt?: string | null;
  /** COD orders can only be refunded as Store Credit — no method choice. */
  isCod?: boolean;
  orderId: string;
  shopifyOrderId: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: string;
  liveStage?: string | null;
  liveStageLabel?: string | null;
  estimatedRefund: number;
  actualRefund: number | null;
  createdAt: string;
  items: any[];
};

type Summary = {
  pending: number;
  pickup_scheduled: number;
  in_transit: number;
  failed: number;
  received: number;
  refunded: number;
  rejected: number;
  total: number;
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  pending: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Pending" },
  awaiting_acceptance: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Pending" },
  awaiting_partner: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Accepted – Pickup Pending" },
  pending_approval: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Pending" },
  approved: { color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20", label: "Accepted – Pickup Pending" },
  pickup_scheduled: { color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20", label: "Pickup Scheduled" },
  in_transit: { color: "text-sky-500", bg: "bg-sky-500/10", border: "border-sky-500/20", label: "In Transit" },
  awaiting_receipt: { color: "text-sky-500", bg: "bg-sky-500/10", border: "border-sky-500/20", label: "Delivered – Awaiting Check" },
  failed: { color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Failed" },
  pickup_failed: { color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Pickup Failed" },
  received: { color: "text-teal-500", bg: "bg-teal-500/10", border: "border-teal-500/20", label: "Received" },
  rejected: { color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Rejected" },
  refunded: { color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Refunded" },
  refund_pending: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Refund Pending" },
};

function StatusBadge({ status, label }: { status: string; label?: string | null }) {
  const normalized = (status || "").toLowerCase().replace(/[_-]/g, '_');
  const cfg = STATUS_CONFIG[normalized] || STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.color.replace('text-', 'bg-')} ${normalized === 'pending' || normalized === 'awaiting_acceptance' ? 'animate-pulse' : ''}`} />
      {label || cfg.label}
    </span>
  );
}

export default function ReturnsPage() {
  const router = useRouter();
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [summary, setSummary] = useState<Summary>({
    pending: 0,
    pickup_scheduled: 0,
    in_transit: 0,
    failed: 0,
    received: 0,
    refunded: 0,
    rejected: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Linked ids (R_/E_/G_E_) are looked up server-side (debounced) so older requests are found too.
  const [linkedSearch, setLinkedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setLinkedSearch(parseLinkedId(search) ? search.trim() : ""), 350);
    return () => clearTimeout(t);
  }, [search]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [toast, setToast] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [refundModal, setRefundModal] = useState<ReturnRequest | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundType, setRefundType] = useState<"original_method" | "store_credit">("original_method");

  // ─── Manual Create States ─────────────────────────────────────────
  const [createModal, setCreateModal] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");
  const [searchedOrders, setSearchedOrders] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [selectedItems, setSelectedItems] = useState<any[]>([]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const handleUpdateReturnSize = async (returnItemId: string, newSize: string) => {
    try {
      const res = await fetch("/api/admin/returns/update-size", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnId: returnItemId, size: newSize }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update return size");
      }
      showToast("Size updated successfully");
      fetchReturns(true);
    } catch (e: any) {
      showToast(e.message || "Failed to update return size");
      throw e;
    }
  };

  const fetchReturns = useCallback(async (silent = false) => {
    if (!silent && returns.length === 0) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (linkedSearch) params.set("search", linkedSearch);

      const res = await fetch(`/api/admin/returns?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setReturns(data.returns || []);
        
        const sc = data.statusCounts || {};
        setSummary({
          pending: sc.pending || sc.pending_approval || 0,
          pickup_scheduled: sc.pickup_scheduled || 0,
          in_transit: sc.in_transit || 0,
          failed: sc.failed || 0,
          received: sc.received || 0,
          refunded: sc.refunded || 0,
          rejected: sc.rejected || 0,
          total: data.total || 0,
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, linkedSearch, returns.length]);

  useEffect(() => {
    fetchReturns(false);
  }, [fetchReturns]);

  useEffect(() => {
    const handleSync = () => {
      fetchReturns(true);
    };
    window.addEventListener("realtime-sync", handleSync);
    return () => window.removeEventListener("realtime-sync", handleSync);
  }, [fetchReturns]);

  const searchOrders = async (q: string) => {
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/orders?search=${encodeURIComponent(q)}&limit=5`);
      if (res.ok) {
        const data = await res.json();
        setSearchedOrders(data.orders || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  };

  const handleAction = async (id: string, action: "approve" | "reject", extra?: any) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/returns/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(extra || {}),
      });
      if (res.ok) {
        showToast(`Return request ${action}d successfully`);
        fetchReturns();
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
      showToast("Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateReturn = async () => {
    if (!selectedOrder || selectedItems.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          customerId: selectedOrder.customerId,
          items: selectedItems.map(si => ({
            lineItemId: si.id,
            reason: "Admin manual return",
            quantity: si.quantity
          })),
          estimatedRefund: selectedItems.reduce((acc: number, si: any) => acc + (si.price * si.quantity), 0)
        })
      });
      if (res.ok) {
        showToast("Return created successfully");
        setCreateModal(false);
        fetchReturns();
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
      showToast("Creation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRefundSubmit = () => {
    if (!refundModal) return;
    handleAction(refundModal.returnRequestId, "approve", { 
      actualRefund: parseFloat(refundAmount) || refundModal.estimatedRefund,
      isStoreCredit: refundModal.isCod ? true : refundType === "store_credit",
      customerId: refundModal.userId
    });
    setRefundModal(null);
    setRefundAmount("");
  };

  const filteredReturns = returns.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.shopifyOrderId?.toLowerCase().includes(q) ||
      r.displayId?.toLowerCase().includes(q) ||

      r.userName?.toLowerCase().includes(q) ||
      r.userEmail?.toLowerCase().includes(q) ||
      r.returnRequestId?.toLowerCase().includes(q)
    );
  });

  const summaryCards = [
    { label: "Pending", statusKey: "pending", count: summary.pending, icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: "Pickup Scheduled", statusKey: "pickup_scheduled", count: summary.pickup_scheduled, icon: Package, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    { label: "In Transit", statusKey: "in_transit", count: summary.in_transit, icon: TruckIcon, color: "text-sky-500", bg: "bg-sky-500/10" },
    { label: "Failed", statusKey: "failed", count: summary.failed, icon: AlertTriangle, color: "text-rose-500", bg: "bg-rose-500/10" },
    { label: "Received", statusKey: "received", count: summary.received, icon: CheckCircle2, color: "text-teal-500", bg: "bg-teal-500/10" },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-6 pb-20 relative z-10">
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -20, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: -20, x: "-50%" }} className="fixed top-8 left-1/2 z-50 bg-background border border-foreground/[0.05] rounded-md px-4 py-2 text-[10px] font-medium text-foreground shadow-sm flex items-center gap-2 uppercase tracking-wide">
            <Check className="w-3 h-3 text-green-500" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Returns</h1>
          <p className="text-[11px] text-foreground/50 tracking-wide max-w-xl">Manage return requests, view reasons, and process approvals/refunds.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCreateModal(true)} className="flex items-center gap-2 px-4 py-2 border border-foreground/[0.05] rounded-md text-[10px] font-medium uppercase tracking-[0.15em] hover:bg-foreground/[0.02] transition-colors">
            <Package className="w-3 h-3" />
            New Return
          </button>
          <button onClick={() => fetchReturns()} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-md text-[10px] font-medium uppercase tracking-[0.15em] hover:opacity-90 disabled:opacity-50 transition-opacity">
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <motion.button key={card.label} onClick={() => setStatusFilter(card.statusKey)} className={`glass-card p-4 rounded-2xl text-left transition-all hover:scale-[1.02] active:scale-[0.98] group relative overflow-hidden ${statusFilter === card.statusKey ? "ring-1 ring-foreground/20" : ""}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] font-bold text-foreground/40 uppercase tracking-[0.3em]">{card.label}</span>
                <div className={`w-7 h-7 rounded-lg ${card.bg} flex items-center justify-center`}><Icon className={`w-3.5 h-3.5 ${card.color}`} /></div>
              </div>
              <p className="text-2xl font-bold text-foreground tracking-tighter">{card.count}</p>
            </motion.button>
          );
        })}
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex items-center bg-background border border-foreground/[0.05] rounded-md p-1 overflow-x-auto">
          {["all", "pending", "pickup_scheduled", "in_transit", "failed", "received", "refunded", "rejected"].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-[4px] text-[8px] font-medium uppercase tracking-[0.15em] transition-colors whitespace-nowrap ${statusFilter === s ? "bg-foreground text-background" : "text-foreground/50 hover:bg-foreground/[0.03]"}`}>
              {s === "all" ? "All" : STATUS_CONFIG[s]?.label || s}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
          <input
            type="text"
            placeholder="Search by order ID, R_/E_/G_E_ ID, customer..."
            className="w-full bg-background border border-foreground/[0.05] rounded-md pl-10 pr-4 py-2 text-[11px] outline-none focus:border-foreground/20 transition-colors"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key !== 'Enter') return;
              const q = search.trim();
              if (!/^(R_|E_|G_E_)/i.test(q)) return;
              try {
                const res = await fetch(`/api/admin/linked-id?q=${encodeURIComponent(q)}`);
                const data = await res.json();
                if (data?.found && data.href) {
                  e.preventDefault();
                  router.push(data.href);
                }
              } catch { /* list search still works */ }
            }}
          />
        </div>
      </div>

      <div className="bg-background border border-foreground/[0.05] rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-foreground/[0.01] border-b border-foreground/[0.05]">
              <tr>
                <th className="px-4 py-3 text-[9px] font-semibold text-foreground/50 uppercase tracking-widest">Order</th>
                <th className="px-4 py-3 text-[9px] font-semibold text-foreground/50 uppercase tracking-widest">Customer</th>
                <th className="px-4 py-3 text-[9px] font-semibold text-foreground/50 uppercase tracking-widest hidden md:table-cell">Items</th>
                <th className="px-4 py-3 text-[9px] font-semibold text-foreground/50 uppercase tracking-widest">Refund</th>
                <th className="px-4 py-3 text-[9px] font-semibold text-foreground/50 uppercase tracking-widest">Status</th>
                <th className="px-4 py-3 text-[9px] font-semibold text-foreground/50 uppercase tracking-widest text-center hidden sm:table-cell">Date</th>
                <th className="px-4 py-3 text-[9px] font-semibold text-foreground/50 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/[0.03]">
              {loading && returns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-foreground/30" />
                    <p className="text-[10px] font-medium uppercase tracking-widest text-foreground/40">Loading returns...</p>
                  </td>
                </tr>
              ) : filteredReturns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <Inbox className="w-8 h-8 text-foreground/10 mx-auto mb-3" />
                    <p className="text-[11px] font-semibold text-foreground/50 uppercase tracking-tight">No returns found</p>
                  </td>
                </tr>
              ) : (
                filteredReturns.map((req) => (
                  <tr
                    key={req.returnRequestId}
                    className="hover:bg-foreground/[0.01] transition-all cursor-pointer"
                    onClick={() => router.push(`/dashboard/returns/${req.returnRequestId}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-[11px] font-semibold text-foreground">{formatDisplayOrderNumber(req.shopifyOrderId || req.orderId)}</div>
                      {req.displayId && (
                        <div className="text-[9px] font-bold text-blue-500 mt-0.5 font-mono">{req.displayId}</div>
                      )}

                      {(req as any).orderCreatedAt && (
                        <div className="text-[9px] text-foreground/40 mt-0.5 font-mono">
                          Ordered: {formatExactDateTime((req as any).orderCreatedAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[11px] font-medium text-foreground">{req.userName}</div>
                      <div className="text-[9px] text-foreground/40 mt-0.5">{req.userEmail}</div>
                    </td>
                    <td className="px-4 py-3 max-w-[280px] whitespace-normal hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                      {req.items?.slice(0, 2).map((item: any, idx: number) => {
                        const itemTitle = item.title || item.product?.title || "Returned Item";
                        const itemSku = item.sku || item.product?.sku;
                        const vInfo = extractItemVariantAndSize(itemTitle, itemSku, item.variantTitle, item.size);
                        const resolvedSize = item.size || vInfo.size;
                        const resolvedVariant = item.variantTitle || vInfo.variant;

                        return (
                          <div key={idx} className="text-[10px] text-foreground/80 mb-1.5 p-2 rounded-xl bg-foreground/[0.02] border border-foreground/5 space-y-1">
                            <div className="font-semibold text-foreground flex items-center justify-between gap-2">
                              <span className="truncate max-w-[140px]">{itemTitle}</span>
                              <InlineSizeSelector
                                size={resolvedSize}
                                variantTitle={resolvedVariant}
                                itemId={item.id}
                                itemType="return"
                                onUpdateSize={(sz) => handleUpdateReturnSize(item.id, sz)}
                              />
                            </div>
                            <div className="text-[9px] text-foreground/40 flex items-center justify-between gap-2">
                              <span>Reason: {item.reason || "Return"}</span>
                              {itemSku && <span className="font-mono text-[8px]">SKU: {itemSku}</span>}
                            </div>
                          </div>
                        );
                      })}
                      {req.items?.length > 2 && (
                        <span className="text-[9px] text-foreground/40 font-medium">+{req.items.length - 2} more items</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-semibold text-foreground">₹{(req.actualRefund || req.estimatedRefund).toLocaleString("en-IN")}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={req.liveStage || req.status} label={req.liveStageLabel} />
                    </td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      <div className="text-[10px] font-medium text-foreground/70">{formatExactDateTime(req.createdAt)}</div>
                      <div className="text-[8px] text-foreground/30 uppercase tracking-widest font-mono">Requested At</div>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => router.push(`/dashboard/returns/${req.returnRequestId}`)}
                          className="px-2.5 py-1.5 rounded-lg text-foreground/60 hover:text-foreground hover:bg-foreground/[0.03] text-[8px] font-bold uppercase tracking-widest"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {req.status === "pending_approval" && (
                          <>
                            <button onClick={() => handleAction(req.returnRequestId, "reject", { reason: "Admin rejected" })} disabled={actionLoading === req.returnRequestId} className="px-3 py-1.5 rounded-lg text-rose-500 hover:bg-rose-500/5 border border-rose-500/10 text-[8px] font-bold uppercase tracking-widest disabled:opacity-50">
                              Reject
                            </button>
                            <button onClick={() => { setRefundModal(req); setRefundAmount(String(req.estimatedRefund)); }} disabled={actionLoading === req.returnRequestId} className="px-3 py-1.5 bg-foreground text-background rounded-lg text-[8px] font-bold uppercase tracking-widest shadow-lg disabled:opacity-50 flex items-center gap-1">
                              {actionLoading === req.returnRequestId ? <Loader2 className="w-3 h-3 animate-spin" /> : "Approve"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Refund Modal */}
      <AnimatePresence>
        {refundModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <div className="absolute inset-0 z-0" onClick={() => setRefundModal(null)} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-background w-full max-w-sm rounded-xl p-6 border border-foreground/[0.05] shadow-lg relative z-10">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-[12px] font-semibold text-foreground tracking-widest uppercase">Approve & Issue Refund</h2>
                <button onClick={() => setRefundModal(null)} className="text-foreground/40 hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>

              <div className="space-y-4">
                <div className="bg-foreground/[0.02] border border-foreground/[0.05] rounded-lg p-3 space-y-1">
                  <p className="text-[10px] text-foreground/50 uppercase tracking-widest">Order #{refundModal.shopifyOrderId}</p>
                  <p className="text-[10px] text-foreground/70">{refundModal.userName} • {refundModal.userEmail}</p>
                </div>

                {refundModal.isCod ? (
                  <p className="text-[10px] text-amber-500 leading-relaxed">{COD_STORE_CREDIT_MESSAGE}</p>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => setRefundType("original_method")} className={`flex-1 py-2 rounded-lg text-[8px] font-bold uppercase tracking-widest border transition-all ${refundType === "original_method" ? "bg-foreground text-background" : "border-foreground/[0.05] text-foreground/40"}`}>Original Method</button>
                    <button onClick={() => setRefundType("store_credit")} className={`flex-1 py-2 rounded-lg text-[8px] font-bold uppercase tracking-widest border transition-all ${refundType === "store_credit" ? "bg-foreground text-background" : "border-foreground/[0.05] text-foreground/40"}`}>Store Credit</button>
                  </div>
                )}

                <div>
                  <label className="block text-[9px] font-semibold uppercase tracking-widest text-foreground/50 mb-1.5">Refund Amount (₹)</label>
                  <input type="number" step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} className="w-full bg-foreground/[0.02] border border-foreground/[0.05] focus:border-foreground/20 rounded-md px-3 py-2.5 text-[14px] font-semibold text-foreground outline-none" placeholder="0.00" />
                </div>

                <button onClick={handleRefundSubmit} className="w-full py-2.5 bg-emerald-500 text-white rounded-md text-[10px] font-semibold uppercase tracking-[0.15em] hover:bg-emerald-600 transition-colors mt-2 flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Approve Request
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Return Modal */}
      <AnimatePresence>
        {createModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <div className="absolute inset-0 z-0" onClick={() => { setCreateModal(false); setSelectedOrder(null); setSelectedItems([]); }} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-background w-full max-w-lg rounded-xl p-6 border border-foreground/[0.05] shadow-2xl relative z-10 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-[12px] font-semibold text-foreground tracking-widest uppercase">Create Manual Return</h2>
                <button onClick={() => { setCreateModal(false); setSelectedOrder(null); setSelectedItems([]); }} className="text-foreground/40 hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>

              {!selectedOrder ? (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
                    <input 
                      type="text" 
                      placeholder="Search order by ID or customer..." 
                      className="w-full bg-foreground/[0.02] border border-foreground/[0.05] rounded-md pl-10 pr-4 py-2.5 text-[11px] outline-none" 
                      value={orderSearch}
                      onChange={(e) => { setOrderSearch(e.target.value); searchOrders(e.target.value); }}
                    />
                  </div>

                  <div className="space-y-2">
                    {searching ? (
                      <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-foreground/10" /></div>
                    ) : searchedOrders.map(order => (
                      <button key={order.id} onClick={() => setSelectedOrder(order)} className="w-full text-left p-3 rounded-lg border border-foreground/[0.05] hover:bg-foreground/[0.02] transition-colors">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-bold text-foreground">#{order.shopifyOrderId || order.id.slice(0,8)}</span>
                          <span className="text-[9px] text-foreground/40">{new Date(order.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div className="text-[10px] text-foreground/60 mt-1">{order.customer?.name} ({order.customer?.email})</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="p-3 bg-foreground/[0.02] border border-foreground/[0.05] rounded-lg">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold text-foreground">#{selectedOrder.shopifyOrderId || selectedOrder.id.slice(0,8)}</span>
                      <button onClick={() => { setSelectedOrder(null); setSelectedItems([]); }} className="text-[9px] text-blue-500 font-bold uppercase tracking-widest">Change</button>
                    </div>
                    <p className="text-[9px] text-foreground/50">{selectedOrder.customer?.name} • {selectedOrder.customer?.email}</p>
                  </div>

                  <div className="space-y-3">
                    <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest">Select Items to Return</p>
                    {selectedOrder.items?.map((item: any) => {
                      const isSelected = selectedItems.some((si: any) => si.id === item.id);
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedItems(selectedItems.filter((si: any) => si.id !== item.id));
                            } else {
                              setSelectedItems([...selectedItems, { ...item, quantity: item.quantity }]);
                            }
                          }}
                          className={`w-full flex items-center gap-3 p-2 rounded-lg border transition-all ${isSelected ? "border-emerald-500/50 bg-emerald-500/5" : "border-foreground/[0.05]"}`}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? "bg-emerald-500 border-emerald-500" : "border-foreground/20"}`}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-[11px] font-semibold text-foreground truncate">{item.title}</p>
                            <p className="text-[9px] text-foreground/40">₹{item.price.toLocaleString()} x {item.quantity}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {selectedItems.length > 0 && (
                    <div className="pt-4 border-t border-foreground/[0.05]">
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest">Est. Refund</span>
                        <span className="text-lg font-bold text-foreground">₹{selectedItems.reduce((acc: number, si: any) => acc + (si.price * si.quantity), 0).toLocaleString()}</span>
                      </div>
                      <button onClick={handleCreateReturn} className="w-full py-3 bg-foreground text-background rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-lg flex items-center justify-center gap-2">
                        <CheckCircle2 className="w-4 h-4" /> Create Return Request
                      </button>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
