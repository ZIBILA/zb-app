"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, CheckCircle2, XCircle, Clock, Inbox, ArrowRight, X, Search, Plus, Eye, Package, TruckIcon, CreditCard, ArrowLeftRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatExactDateTime, extractItemVariantAndSize } from "@/lib/utils";
import { formatDisplayOrderNumber } from "@/lib/formatOrderNumber";
import VariantBadge from "@/components/admin/VariantBadge";
import InlineSizeSelector from "@/components/admin/InlineSizeSelector";
import { parseLinkedId } from "@/lib/linkedIds";

type ExchangeRequest = {
  exchangeRequestId: string;
  displayId?: string | null;
  replacementDisplayId?: string | null;
  logisticsPartner?: string | null;
  reverseAwb?: string | null;
  receivedAt?: string | null;
  orderId: string;
  shopifyOrderId: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: string;
  priceDifference: number;
  paymentStatus: string;
  createdAt: string;
  reason: string | null;
  returnRequestId: string | null;
  newShopifyOrderId: string | null;
  items: any[];
};

type Summary = {
  requested: number;
  approved: number;
  rejected: number;
  received: number;
  completed: number;
  total: number;
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  pending_approval: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Pending Approval" },
  approved: { color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20", label: "Approved" },
  rejected: { color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Rejected" },
  return_created: { color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20", label: "Return Created" },
  received: { color: "text-teal-500", bg: "bg-teal-500/10", border: "border-teal-500/20", label: "Received" },
  qc_passed: { color: "text-cyan-500", bg: "bg-cyan-500/10", border: "border-cyan-500/20", label: "QC Passed" },
  new_order_created: { color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "New Order Created" },
  shipped: { color: "text-violet-500", bg: "bg-violet-500/10", border: "border-violet-500/20", label: "Shipped" },
  completed: { color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/20", label: "Completed" },
  requested: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Requested" }
};

function StatusBadge({ status }: { status: string }) {
  const normalized = (status || "").toLowerCase().replace(/[_-]/g, '_');
  const cfg = STATUS_CONFIG[normalized] || STATUS_CONFIG.pending_approval;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.color.replace('text-', 'bg-')} ${normalized === 'pending_approval' || normalized === 'requested' ? 'animate-pulse' : ''}`} />
      {cfg.label}
    </span>
  );
}

export default function ExchangesPage() {
  const router = useRouter();
  const [exchanges, setExchanges] = useState<ExchangeRequest[]>([]);
  const [summary, setSummary] = useState<Summary>({ requested: 0, approved: 0, rejected: 0, received: 0, completed: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  // Linked ids (R_/E_/G_E_) are looked up server-side (debounced) so older requests are found too.
  const [linkedSearch, setLinkedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setLinkedSearch(parseLinkedId(search) ? search.trim() : ""), 350);
    return () => clearTimeout(t);
  }, [search]);
  const [toast, setToast] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ─── Manual Create States ─────────────────────────────────────────
  const [createModal, setCreateModal] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");
  const [searchedOrders, setSearchedOrders] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [originalItem, setOriginalItem] = useState<any | null>(null);
  const [replacementItem, setReplacementItem] = useState<any | null>(null);
  const [replacements, setReplacements] = useState<any[]>([]);
  const [searchingReplacements, setSearchingReplacements] = useState(false);
  const [replacementSearch, setReplacementSearch] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const handleUpdateExchangeSize = async (exchangeItemId: string, itemType: "original" | "new", newSize: string) => {
    try {
      const res = await fetch("/api/admin/exchanges/update-size", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchangeId: exchangeItemId, itemType, size: newSize }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update size");
      }
      showToast("Size updated successfully");
      fetchExchanges();
    } catch (e: any) {
      showToast(e.message || "Failed to update size");
      throw e;
    }
  };

  const fetchExchanges = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (linkedSearch) params.set("search", linkedSearch);

      const res = await fetch(`/api/admin/exchanges?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setExchanges(data.exchanges || []);
        
        const sc = data.statusCounts || {};
        const pending = sc.pending_approval || 0;
        const approved = (sc.approved || 0) + (sc.return_created || 0);
        const rejected = sc.rejected || 0;
        const received = (sc.received || 0) + (sc.qc_passed || 0);
        const completed = (sc.new_order_created || 0) + (sc.shipped || 0) + (sc.completed || 0);
        setSummary({ requested: pending, approved, rejected, received, completed, total: data.total || 0 });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, linkedSearch]);

  useEffect(() => {
    fetchExchanges();
  }, [fetchExchanges]);

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

  const searchReplacements = async (q: string) => {
    if (!q) return;
    setSearchingReplacements(true);
    try {
      const res = await fetch(`/api/admin/products?search=${encodeURIComponent(q)}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setReplacements(data.products || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSearchingReplacements(false);
    }
  };

  const handleAction = async (id: string, action: "approve" | "reject", extra?: any) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/exchanges/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) {
        showToast(`Exchange request ${action}d successfully`);
        fetchExchanges();
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

  const handleCreateExchange = async () => {
    if (!selectedOrder || !originalItem || !replacementItem) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/exchanges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          customerId: selectedOrder.customerId,
          items: [{
            originalLineItemId: originalItem.id,
            newProductId: replacementItem.productId,
            newVariantId: replacementItem.variantId,
            newVariantTitle: replacementItem.variantTitle || null,
            newSize: replacementItem.size || replacementItem.variantTitle || null,
            reason: "Admin manual exchange"
          }]
        })
      });
      if (res.ok) {
        showToast("Exchange created successfully");
        setCreateModal(false);
        setSelectedOrder(null);
        setOriginalItem(null);
        setReplacementItem(null);
        fetchExchanges();
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

  const filteredExchanges = exchanges.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.shopifyOrderId?.toLowerCase().includes(q) ||
      e.displayId?.toLowerCase().includes(q) ||
      e.replacementDisplayId?.toLowerCase().includes(q) ||

      e.userName?.toLowerCase().includes(q) ||
      e.userEmail?.toLowerCase().includes(q) ||
      e.exchangeRequestId?.toLowerCase().includes(q)
    );
  });

  const summaryCards = [
    { label: "Pending", statusKey: "pending_approval", count: summary.requested, icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: "In Progress", statusKey: "approved", count: summary.approved, icon: ArrowLeftRight, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Received", statusKey: "received", count: summary.received, icon: Package, color: "text-teal-500", bg: "bg-teal-500/10" },
    { label: "Completed", statusKey: "completed", count: summary.completed, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Rejected", statusKey: "rejected", count: summary.rejected, icon: XCircle, color: "text-rose-500", bg: "bg-rose-500/10" },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-6 pb-20 relative z-10">
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -20, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: -20, x: "-50%" }} className="fixed top-8 left-1/2 z-50 bg-background border border-foreground/[0.05] rounded-md px-4 py-2 text-[10px] font-medium text-foreground shadow-sm flex items-center gap-2 uppercase tracking-wide">
            <CheckCircle2 className="w-3 h-3 text-green-500" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Exchanges</h1>
          <p className="text-[11px] text-foreground/50 tracking-wide max-w-xl">Manage exchange requests, replacements, and automatically create new orders.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCreateModal(true)} className="flex items-center gap-2 px-4 py-2 border border-foreground/[0.05] rounded-md text-[10px] font-medium uppercase tracking-[0.15em] hover:bg-foreground/[0.02] transition-colors">
            <ArrowLeftRight className="w-3 h-3" />
            New Exchange
          </button>
          <button onClick={fetchExchanges} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-md text-[10px] font-medium uppercase tracking-[0.15em] hover:opacity-90 disabled:opacity-50 transition-opacity">
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
          {["all", "pending_approval", "approved", "received", "new_order_created", "completed", "rejected"].map((s) => (
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
                <th className="px-4 py-3 text-[9px] font-semibold text-foreground/50 uppercase tracking-widest hidden md:table-cell">Exchange Items</th>
                <th className="px-4 py-3 text-[9px] font-semibold text-foreground/50 uppercase tracking-widest">Payment</th>
                <th className="px-4 py-3 text-[9px] font-semibold text-foreground/50 uppercase tracking-widest">Status</th>
                <th className="px-4 py-3 text-[9px] font-semibold text-foreground/50 uppercase tracking-widest text-center hidden sm:table-cell">Date</th>
                <th className="px-4 py-3 text-[9px] font-semibold text-foreground/50 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/[0.03]">
              {loading && exchanges.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-foreground/30" />
                    <p className="text-[10px] font-medium uppercase tracking-widest text-foreground/40">Loading exchanges...</p>
                  </td>
                </tr>
              ) : filteredExchanges.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <Inbox className="w-8 h-8 text-foreground/10 mx-auto mb-3" />
                    <p className="text-[11px] font-semibold text-foreground/50 uppercase tracking-tight">No exchanges found</p>
                  </td>
                </tr>
              ) : (
                filteredExchanges.map((req) => (
                  <tr
                    key={req.exchangeRequestId}
                    className="hover:bg-foreground/[0.01] transition-all cursor-pointer"
                    onClick={() => router.push(`/dashboard/exchanges/${req.exchangeRequestId}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-[11px] font-semibold text-foreground">{formatDisplayOrderNumber(req.shopifyOrderId || req.orderId)}</div>
                      {req.displayId && (
                        <div className="text-[9px] font-bold text-blue-500 mt-0.5 font-mono">{req.displayId}</div>
                      )}
                      {req.replacementDisplayId && (
                        <div className="text-[9px] font-bold text-emerald-500 font-mono">{req.replacementDisplayId}</div>
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
                    <td className="px-4 py-3 max-w-[340px] whitespace-normal hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                      {req.items?.slice(0, 2).map((item: any, idx: number) => {
                        const origTitle = item.originalProduct?.title || item.originalItem?.title || "Original Item";
                        const origSku = item.originalProduct?.sku || item.originalSku;
                        const origV = extractItemVariantAndSize(origTitle, origSku, item.originalVariantTitle || item.originalVariant, item.originalSize);
                        const origSize = item.originalSize || origV.size;
                        const origVariant = item.originalVariantTitle || item.originalVariant || origV.variant;

                        const newTitle = item.newProduct?.title || item.newProductTitle || "Replacement Item";
                        const newSku = item.newProduct?.sku || item.newSku;
                        const newV = extractItemVariantAndSize(newTitle, newSku, item.newVariantTitle || item.newVariant, item.newSize);
                        const newSize = item.newSize || newV.size;
                        const newVariant = item.newVariantTitle || item.newVariant || newV.variant;

                        return (
                          <div key={idx} className="p-2.5 rounded-xl bg-foreground/[0.02] border border-foreground/5 mb-1.5 text-[10px] space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap justify-between">
                              <div className="flex items-center gap-1.5 opacity-80">
                                <span className="line-through text-foreground/60 font-medium truncate max-w-[100px]">{origTitle}</span>
                                <InlineSizeSelector
                                  size={origSize}
                                  variantTitle={origVariant}
                                  itemId={item.id}
                                  itemType="original"
                                  onUpdateSize={(sz) => handleUpdateExchangeSize(item.id, "original", sz)}
                                />
                              </div>
                              <ArrowRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <div className="flex items-center gap-1.5 font-semibold text-foreground">
                                <span className="truncate max-w-[100px]">{newTitle}</span>
                                <InlineSizeSelector
                                  size={newSize}
                                  variantTitle={newVariant}
                                  itemId={item.id}
                                  itemType="new"
                                  onUpdateSize={(sz) => handleUpdateExchangeSize(item.id, "new", sz)}
                                />
                              </div>
                            </div>
                            {item.reason && <div className="text-[9px] text-foreground/40 font-medium">Reason: {item.reason}</div>}
                          </div>
                        );
                      })}
                      {req.items?.length > 2 && (
                        <span className="text-[9px] text-foreground/40 font-medium">+{req.items.length - 2} more items</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[11px] font-semibold text-foreground">
                        {req.priceDifference !== 0 ? `₹${Math.abs(req.priceDifference).toLocaleString("en-IN")}` : "₹0"}
                      </div>
                      <div className={`text-[9px] mt-0.5 capitalize ${
                        req.priceDifference === 0 ? 'text-emerald-500 font-semibold' :
                        req.paymentStatus === 'paid' ? 'text-emerald-500' :
                        req.paymentStatus === 'cod_pending' ? 'text-amber-500' : 'text-foreground/40'
                      }`}>
                        {req.priceDifference === 0
                          ? "Paid"
                          : req.priceDifference < 0
                            ? "Store Credit"
                            : (req.paymentStatus || "").replace(/_/g, " ")
                        }
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={req.status} />
                    </td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      <div className="text-[10px] font-medium text-foreground/70">{formatExactDateTime(req.createdAt)}</div>
                      <div className="text-[8px] text-foreground/30 uppercase tracking-widest font-mono">Requested At</div>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => router.push(`/dashboard/exchanges/${req.exchangeRequestId}`)}
                          className="px-2.5 py-1.5 rounded-lg text-foreground/60 hover:text-foreground hover:bg-foreground/[0.03] text-[8px] font-bold uppercase tracking-widest"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {req.status === "pending_approval" && (
                          <>
                            <button onClick={() => handleAction(req.exchangeRequestId, "reject", { reason: "Admin rejected" })} disabled={actionLoading === req.exchangeRequestId} className="px-3 py-1.5 rounded-lg text-rose-500 hover:bg-rose-500/5 border border-rose-500/10 text-[8px] font-bold uppercase tracking-widest disabled:opacity-50">
                              Reject
                            </button>
                            <button onClick={() => handleAction(req.exchangeRequestId, "approve")} disabled={actionLoading === req.exchangeRequestId} className="px-3 py-1.5 bg-foreground text-background rounded-lg text-[8px] font-bold uppercase tracking-widest shadow-lg disabled:opacity-50 flex items-center gap-1">
                              {actionLoading === req.exchangeRequestId ? <Loader2 className="w-3 h-3 animate-spin" /> : "Approve"}
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

      {/* Create Exchange Modal */}
      <AnimatePresence>
        {createModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <div className="absolute inset-0 z-0" onClick={() => { setCreateModal(false); setSelectedOrder(null); setOriginalItem(null); setReplacementItem(null); }} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-background w-full max-w-lg rounded-xl p-6 border border-foreground/[0.05] shadow-2xl relative z-10 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-[12px] font-semibold text-foreground tracking-widest uppercase">Create Manual Exchange</h2>
                <button onClick={() => { setCreateModal(false); setSelectedOrder(null); setOriginalItem(null); setReplacementItem(null); }} className="text-foreground/40 hover:text-foreground"><X className="w-4 h-4" /></button>
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
                      <button onClick={() => { setSelectedOrder(null); setOriginalItem(null); setReplacementItem(null); }} className="text-[9px] text-blue-500 font-bold uppercase tracking-widest">Change</button>
                    </div>
                    <p className="text-[9px] text-foreground/50">{selectedOrder.customer?.name} • {selectedOrder.customer?.email}</p>
                  </div>

                  <div className="space-y-3">
                    <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest">Select Item to Replace</p>
                    {selectedOrder.items?.map((item: any) => (
                      <button 
                        key={item.id} 
                        onClick={() => setOriginalItem(item)}
                        className={`w-full flex items-center gap-3 p-2 rounded-lg border transition-all ${originalItem?.id === item.id ? "border-blue-500/50 bg-blue-500/5" : "border-foreground/[0.05]"}`}
                      >
                         <div className="flex-1 text-left min-w-0">
                          <p className="text-[11px] font-semibold text-foreground truncate">{item.title}</p>
                          <p className="text-[9px] text-foreground/40">₹{item.price?.toLocaleString()}</p>
                        </div>
                      </button>
                    ))}
                  </div>

                  {originalItem && (
                    <div className="space-y-3 pt-4 border-t border-foreground/[0.05]">
                      <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest">Search Replacement Product</p>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
                        <input 
                          type="text" 
                          placeholder="Search products..." 
                          className="w-full bg-foreground/[0.02] border border-foreground/[0.05] rounded-md pl-10 pr-4 py-2.5 text-[11px] outline-none" 
                          value={replacementSearch}
                          onChange={(e) => { setReplacementSearch(e.target.value); searchReplacements(e.target.value); }}
                        />
                      </div>

                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {searchingReplacements ? (
                          <Loader2 className="w-4 h-4 animate-spin mx-auto text-foreground/10" />
                        ) : replacements.map(p => (
                          <div key={p.id} className="p-2 border border-foreground/[0.05] rounded-lg">
                            <p className="text-[10px] font-bold text-foreground">{p.title}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {p.variants?.map((v: any) => (
                                <button 
                                  key={v.id} 
                                  onClick={() => setReplacementItem({ productId: p.id, variantId: v.id, title: `${p.title} - ${v.title}`, price: v.price, variantTitle: v.title, size: v.title })}
                                  className={`px-2 py-1 rounded text-[8px] font-bold border transition-all ${replacementItem?.variantId === v.id ? "bg-foreground text-background" : "border-foreground/10 text-foreground/60"}`}
                                >
                                  {v.title}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {replacementItem && (
                    <div className="pt-4 border-t border-foreground/[0.05]">
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest">Replacement</span>
                        <span className="text-[11px] font-bold text-foreground">{replacementItem.title}</span>
                      </div>
                      <button onClick={handleCreateExchange} className="w-full py-3 bg-foreground text-background rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-lg flex items-center justify-center gap-2">
                        <CheckCircle2 className="w-4 h-4" /> Create Exchange Request
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
