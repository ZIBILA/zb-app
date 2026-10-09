"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, ArrowLeft, Check, X, Clock, Package, TruckIcon, CheckCircle2, XCircle, CreditCard, AlertTriangle, RefreshCw, User, Mail, Phone, ArrowRight, ShoppingBag, ClipboardCheck, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatExactDateTime, extractItemVariantAndSize } from "@/lib/utils";
import VariantBadge from "@/components/admin/VariantBadge";
import InlineSizeSelector from "@/components/admin/InlineSizeSelector";
import ReversePickupPanel from "@/components/admin/ReversePickupPanel";
import { deriveReverseStage, REVERSE_STAGE_LABEL } from "@/lib/returnPolicy";

const STATUS_STEPS = [
  { key: "pending_approval", label: "Requested", icon: Clock },
  { key: "approved", label: "Approved", icon: CheckCircle2 },
  { key: "received", label: "Received", icon: Package },
  { key: "qc_passed", label: "QC Passed", icon: ClipboardCheck },
  { key: "new_order_created", label: "Order Created", icon: ShoppingBag },
  { key: "completed", label: "Completed", icon: Check },
];

const STATUS_INDEX: Record<string, number> = {
  pending_approval: 0,
  approved: 1,
  approved_pickup_failed: 1,
  in_transit: 1,
  delivered_to_warehouse: 1,
  return_created: 1,
  received: 2,
  qc_passed: 3,
  new_order_created: 4,
  shipped: 5,
  completed: 5,
  rejected: -1,
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  pending_approval: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Pending Approval" },
  approved_pickup_failed: { color: "text-amber-600", bg: "bg-amber-600/10", border: "border-amber-600/20", label: "Pickup Reg. Failed" },
  approved: { color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20", label: "Approved" },
  rejected: { color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Rejected" },
  return_created: { color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20", label: "Return Created" },
  received: { color: "text-teal-500", bg: "bg-teal-500/10", border: "border-teal-500/20", label: "Received" },
  qc_passed: { color: "text-cyan-500", bg: "bg-cyan-500/10", border: "border-cyan-500/20", label: "QC Passed" },
  new_order_created: { color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "New Order Created" },
  shipped: { color: "text-violet-500", bg: "bg-violet-500/10", border: "border-violet-500/20", label: "Shipped" },
  completed: { color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/20", label: "Completed" },
  requested: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Requested" },
  in_transit: { color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20", label: "Pickup In Transit" },
  delivered_to_warehouse: { color: "text-teal-500", bg: "bg-teal-500/10", border: "border-teal-500/20", label: "Delivered – Confirm Receipt" },
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

export default function ExchangeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const exchangeId = params.id as string;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
      setToast("Size updated successfully");
      setTimeout(() => setToast(null), 3000);
      fetchDetail();
    } catch (e: any) {
      setToast(e.message || "Failed to update size");
      setTimeout(() => setToast(null), 3000);
      throw e;
    }
  };

  // QC Modal State
  const [showQcModal, setShowQcModal] = useState(false);
  const [qcNotes, setQcNotes] = useState("");
  const [qcStatus, setQcStatus] = useState<"passed" | "failed">("passed");

  // AWB Modal State
  const [showAwbModal, setShowAwbModal] = useState(false);
  const [editingAwbType, setEditingAwbType] = useState<"reverse" | "forward">("reverse");
  const [inputAwb, setInputAwb] = useState("");

  const handleSaveAwb = async () => {
    if (!inputAwb.trim()) return;
    setActionLoading("update-awb");
    try {
      const res = await fetch(`/api/admin/exchanges/${exchangeId}/update-awb`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ awb: inputAwb.trim(), type: editingAwbType }),
      });
      if (res.ok) {
        showToast("AWB updated & synced with Delhivery!");
        setShowAwbModal(false);
        setInputAwb("");
        fetchDetail();
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
      }
    } catch (err) {
      showToast("Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/exchanges/${exchangeId}`);
      if (res.ok) {
        const json = await res.json();
        setData(json.exchangeRequest || json.exchange || json);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [exchangeId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleApprove = async () => {
    setActionLoading("approve");
    try {
      const res = await fetch(`/api/admin/exchanges/${exchangeId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (res.ok) {
        showToast("Exchange approved! Return order created.");
        fetchDetail();
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
      }
    } catch (err) {
      showToast("Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    setActionLoading("reject");
    try {
      const res = await fetch(`/api/admin/exchanges/${exchangeId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Admin rejected" }),
      });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        showToast(
          json?.refund?.amount
            ? `Exchange rejected — ₹${json.refund.amount} refunded to the customer's original payment`
            : "Exchange rejected"
        );
        fetchDetail();
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
      }
    } catch (err) {
      showToast("Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReceive = async () => {
    setActionLoading("receive");
    try {
      const res = await fetch(`/api/admin/exchanges/${exchangeId}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qcStatus, qcNotes }),
      });
      if (res.ok) {
        showToast("Items received & QC completed");
        setShowQcModal(false);
        fetchDetail();
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
      }
    } catch (err) {
      showToast("Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateShopifyOrder = async () => {
    setActionLoading("create-order");
    try {
      const res = await fetch(`/api/admin/exchanges/${exchangeId}/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const result = await res.json();
        showToast(`Shopify order created: ${result.shopifyOrderId || "Success"}`);
        fetchDetail();
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
      }
    } catch (err) {
      showToast("Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRegeneratePickup = async () => {
    setActionLoading("regenerate-pickup");
    try {
      const res = await fetch(`/api/admin/exchanges/${exchangeId}/regenerate-pickup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const result = await res.json();
        showToast(`Reverse pickup regenerated! AWB: ${result.awb}`);
        fetchDetail();
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
      }
    } catch (err) {
      showToast("Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleStatusUpdate = async (newStatus: string) => {
    setActionLoading(newStatus);
    try {
      const res = await fetch(`/api/admin/exchanges/${exchangeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        showToast(`Status updated to ${newStatus}`);
        fetchDetail();
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
      }
    } catch (err) {
      showToast("Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-foreground/30" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <AlertTriangle className="w-8 h-8 text-foreground/20" />
        <p className="text-[11px] text-foreground/50 uppercase tracking-widest">Exchange not found</p>
        <button onClick={() => router.push("/dashboard/exchanges")} className="text-[10px] text-blue-500 font-bold uppercase tracking-widest">← Back to Exchanges</button>
      </div>
    );
  }

  const currentStatus = (data.status || "pending_approval").toLowerCase();
  const currentStepIndex = STATUS_INDEX[currentStatus] ?? 0;
  const isRejected = currentStatus === "rejected";
  const order = data.order;
  const customer = order?.customer;
  const exchanges = data.exchanges || [];
  const linkedReturn = data.linkedReturn;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-6 pb-20 relative z-10">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -20, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: -20, x: "-50%" }} className="fixed top-8 left-1/2 z-50 bg-background border border-foreground/[0.05] rounded-md px-4 py-2 text-[10px] font-medium text-foreground shadow-sm flex items-center gap-2 uppercase tracking-wide">
            <Check className="w-3 h-3 text-green-500" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/dashboard/exchanges")} className="p-2 rounded-lg hover:bg-foreground/[0.03] transition-colors">
            <ArrowLeft className="w-4 h-4 text-foreground/60" />
          </button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-lg font-semibold text-foreground tracking-tight">Exchange {data.displayId || `#${(data.id || exchangeId).slice(0, 8)}`}</h1>
              {data.replacementDisplayId && (
                <span className="text-[10px] font-bold text-emerald-500 font-mono">→ {data.replacementDisplayId}</span>
              )}
              <StatusBadge status={currentStatus} />
            </div>
            <p className="text-[10px] font-medium text-foreground/50 mt-0.5 font-mono">
              Requested on: {formatExactDateTime(data.createdAt, true)}
            </p>
          </div>
        </div>
        <button onClick={fetchDetail} className="flex items-center gap-2 px-3 py-1.5 border border-foreground/[0.05] rounded-md text-[9px] font-medium uppercase tracking-widest hover:bg-foreground/[0.02]">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {/* Status Timeline */}
      {!isRejected && (
        <div className="bg-background border border-foreground/[0.05] rounded-xl p-6">
          <p className="text-[9px] font-bold text-foreground/40 uppercase tracking-[0.3em] mb-6">Exchange Workflow</p>
          <div className="flex items-center justify-between relative">
            <div className="absolute top-4 left-0 right-0 h-[2px] bg-foreground/[0.05]">
              <motion.div
                className="h-full bg-foreground/60 rounded-full"
                initial={{ width: "0%" }}
                animate={{ width: `${(currentStepIndex / (STATUS_STEPS.length - 1)) * 100}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </div>

            {STATUS_STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isActive = idx <= currentStepIndex;
              const isCurrent = idx === currentStepIndex;
              return (
                <div key={step.key} className="flex flex-col items-center relative z-10">
                  <motion.div
                    className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${
                      isCurrent ? "bg-foreground text-background border-foreground scale-110" :
                      isActive ? "bg-foreground/80 text-background border-foreground/60" :
                      "bg-background text-foreground/30 border-foreground/10"
                    }`}
                    initial={{ scale: 0.8 }}
                    animate={{ scale: isCurrent ? 1.1 : 1 }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </motion.div>
                  <span className={`text-[7px] sm:text-[8px] font-bold uppercase tracking-widest mt-2 whitespace-nowrap text-center ${isCurrent ? "text-foreground" : isActive ? "text-foreground/60" : "text-foreground/25"}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rejected Banner */}
      {isRejected && (
        <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-rose-500 shrink-0" />
          <div>
            <p className="text-[11px] font-semibold text-rose-500">Exchange Request Rejected</p>
            {data.reason && <p className="text-[10px] text-rose-400/70 mt-1">Reason: {data.reason}</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Exchange Items */}
          <div className="bg-background border border-foreground/[0.05] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-foreground/[0.05]">
              <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.3em]">Exchange Items ({exchanges.length})</p>
            </div>
            <div className="divide-y divide-foreground/[0.03]">
              {exchanges.map((ex: any, idx: number) => {
                const origTitle = ex.originalProduct?.title || "Original Item";
                const origSku = ex.originalSku || ex.originalProduct?.sku;
                const origV = extractItemVariantAndSize(origTitle, origSku, ex.originalVariantTitle || ex.originalVariant, ex.originalSize);
                const origSize = ex.originalSize || origV.size;
                const origVariant = ex.originalVariantTitle || ex.originalVariant || origV.variant;

                const newTitle = ex.newProduct?.title || "Replacement Item";
                const newSku = ex.newSku || ex.newProduct?.sku;
                const newV = extractItemVariantAndSize(newTitle, newSku, ex.newVariantTitle || ex.newVariant, ex.newSize);
                const newSize = ex.newSize || newV.size;
                const newVariant = ex.newVariantTitle || ex.newVariant || newV.variant;

                return (
                  <div key={idx} className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <StatusBadge status={ex.status || "REQUESTED"} />
                      {ex.qcStatus && (
                        <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${ex.qcStatus === 'passed' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                          QC: {ex.qcStatus}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-col sm:flex-row">
                      {/* Original Product */}
                      <div className="flex-1 p-4 rounded-xl bg-rose-500/[0.03] border border-rose-500/10 w-full space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[8px] font-bold text-rose-500/80 uppercase tracking-widest">Returning Item</p>
                          <InlineSizeSelector
                            size={origSize}
                            variantTitle={origVariant}
                            itemId={ex.id}
                            itemType="original"
                            onUpdateSize={(sz) => handleUpdateExchangeSize(ex.id, "original", sz)}
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-14 h-14 rounded-lg bg-foreground/[0.02] border border-foreground/[0.05] overflow-hidden shrink-0 flex items-center justify-center">
                            {ex.originalProduct?.featuredImage ? (
                              <img src={ex.originalProduct.featuredImage} className="w-full h-full object-cover" alt="" />
                            ) : (
                              <Package className="w-4 h-4 text-foreground/20" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-foreground truncate">{origTitle}</p>
                            <p className="text-[9px] text-foreground/40 font-mono mt-0.5">SKU: {origSku || "N/A"}</p>
                            <p className="text-[10px] font-semibold text-foreground mt-0.5">₹{(ex.originalProduct?.price || 0).toLocaleString("en-IN")}</p>
                          </div>
                        </div>
                      </div>

                      <ArrowRight className="w-5 h-5 text-foreground/20 shrink-0 hidden sm:block" />

                      {/* New Product */}
                      <div className="flex-1 p-4 rounded-xl bg-emerald-500/[0.03] border border-emerald-500/10 w-full space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[8px] font-bold text-emerald-500/80 uppercase tracking-widest">Requested Replacement</p>
                          <InlineSizeSelector
                            size={newSize}
                            variantTitle={newVariant}
                            itemId={ex.id}
                            itemType="new"
                            onUpdateSize={(sz) => handleUpdateExchangeSize(ex.id, "new", sz)}
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-14 h-14 rounded-lg bg-foreground/[0.02] border border-foreground/[0.05] overflow-hidden shrink-0 flex items-center justify-center">
                            {ex.newProduct?.featuredImage ? (
                              <img src={ex.newProduct.featuredImage} className="w-full h-full object-cover" alt="" />
                            ) : (
                              <Package className="w-4 h-4 text-foreground/20" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-foreground truncate">{newTitle}</p>
                            <p className="text-[9px] text-foreground/40 font-mono mt-0.5">SKU: {newSku || "N/A"}</p>
                            <p className="text-[10px] font-semibold text-foreground mt-0.5">₹{(ex.newProduct?.price || 0).toLocaleString("en-IN")}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    {ex.qcNotes && (
                      <div className="mt-3 p-2 bg-foreground/[0.02] rounded-lg">
                        <p className="text-[9px] text-foreground/50"><span className="font-bold">QC Notes:</span> {ex.qcNotes}</p>
                      </div>
                    )}
                    {ex.reason && (
                      <div className="mt-2 p-2 bg-foreground/[0.02] rounded-lg">
                        <p className="text-[9px] text-foreground/50"><span className="font-bold">Reason:</span> {ex.reason}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Linked Return Order */}
          {linkedReturn && (
            <div className="bg-background border border-indigo-500/20 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-bold text-indigo-500/80 uppercase tracking-[0.3em]">Linked Return Order</p>
                <button
                  onClick={() => router.push(`/dashboard/returns/${linkedReturn.id}`)}
                  className="flex items-center gap-1 text-[9px] text-indigo-500 font-bold uppercase tracking-widest hover:underline"
                >
                  View Return <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest">Return ID</p>
                  <p className="text-[11px] font-semibold text-foreground mt-1">#{linkedReturn.id.slice(0, 8)}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest">Status</p>
                  <p className="text-[11px] font-semibold text-foreground mt-1 capitalize">{linkedReturn.status}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest">Items</p>
                  <p className="text-[11px] font-semibold text-foreground mt-1">{linkedReturn.returns?.length || 0}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest">Created</p>
                  <p className="text-[11px] font-semibold text-foreground mt-1 font-mono">{formatExactDateTime(linkedReturn.createdAt)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Original Order */}
          {order && (
            <div className="bg-background border border-foreground/[0.05] rounded-xl p-5">
              <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.3em] mb-4">Original Order Details</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest">Shopify Order</p>
                  <p className="text-[12px] font-semibold text-foreground mt-1">#{order.shopifyOrderId || order.id?.slice(0, 8)}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest">Order Total</p>
                  <p className="text-[12px] font-semibold text-foreground mt-1">₹{order.totalPrice?.toLocaleString("en-IN")}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest">Payment</p>
                  <p className="text-[12px] font-semibold text-foreground mt-1 capitalize">{order.paymentStatus}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest">Exact Order Time</p>
                  <p className="text-[11px] font-semibold text-foreground mt-1 font-mono">{formatExactDateTime(order.createdAt, true)}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Customer */}
          {customer && (
            <div className="bg-background border border-foreground/[0.05] rounded-xl p-5">
              <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.3em] mb-4">Customer</p>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-foreground/[0.05] flex items-center justify-center">
                    <User className="w-3.5 h-3.5 text-foreground/40" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-foreground">{customer.name || "Unknown"}</p>
                  </div>
                </div>
                {customer.email && (
                  <div className="flex items-center gap-2 text-foreground/60">
                    <Mail className="w-3 h-3" />
                    <span className="text-[10px]">{customer.email}</span>
                  </div>
                )}
                {customer.phone && (
                  <div className="flex items-center gap-2 text-foreground/60">
                    <Phone className="w-3 h-3" />
                    <span className="text-[10px]">{customer.phone}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Logistics & Tracking */}
          <div className="bg-background border border-foreground/[0.05] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.3em]">Logistics & Tracking</p>
              <button
                onClick={() => {
                  setEditingAwbType("reverse");
                  setInputAwb(data.reverseAwb || "");
                  setShowAwbModal(true);
                }}
                className="text-[9px] font-bold text-blue-500 uppercase tracking-widest hover:underline"
              >
                + Edit Reverse AWB
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-foreground/50">Pickup Status</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-foreground">
                  {data.liveStageLabel ||
                    REVERSE_STAGE_LABEL[
                      deriveReverseStage({
                        requestStatus: currentStatus,
                        receivedAt: data.receivedAt,
                        hasAwb: !!data.reverseAwb,
                        carrierStatus: data.carrierStatus,
                      })
                    ]}
                </span>
              </div>
              {data.carrierStatusLabel && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-foreground/50">Carrier Movement</span>
                  <span className="text-[10px] font-semibold text-foreground">{data.carrierStatusLabel}</span>
                </div>
              )}
              {data.currentLocation && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-foreground/50">Location</span>
                  <span className="text-[10px] font-semibold text-foreground">{data.currentLocation}</span>
                </div>
              )}
              {data.estimatedDelivery && !data.receivedAt && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-foreground/50">Expected</span>
                  <span className="text-[10px] font-semibold text-foreground font-mono">
                    {formatExactDateTime(data.estimatedDelivery, true)}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-foreground/50">Pickup Done</span>
                <span className="text-[10px] font-semibold text-foreground">
                  {data.pickupDone ? "Yes" : "No"}
                </span>
              </div>
              {data.reverseAwb && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-foreground/50">Track</span>
                  <a
                    href={data.trackingUrl || `https://shiprocket.co/tracking/${data.reverseAwb}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-semibold text-blue-500 hover:underline flex items-center gap-1 font-mono"
                  >
                    {data.reverseAwb} <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
              <ReversePickupPanel
                kind="exchange"
                requestId={data.id || exchangeId}
                status={currentStatus}
                reverseAwb={data.reverseAwb}
                logisticsPartner={data.logisticsPartner}
                onBooked={(m) => { showToast(m); fetchDetail(); }}
                onError={(m) => showToast(`Error: ${m}`)}
              />
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-foreground/50">Received by us</span>
                <span className="text-[10px] font-semibold text-foreground font-mono">
                  {data.receivedAt ? formatExactDateTime(data.receivedAt, true) : "Not yet"}
                </span>
              </div>
              {data.replacementDisplayId && (
                <div className="flex justify-between items-center pt-2 border-t border-foreground/[0.05]">
                  <span className="text-[10px] text-foreground/50">Replacement Order</span>
                  <a
                    href={`/dashboard/orders/${data.replacementOrderId || ""}`}
                    className="text-[11px] font-semibold text-emerald-500 hover:underline font-mono"
                  >
                    {data.replacementDisplayId}
                  </a>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-foreground/[0.05]">
                <span className="text-[10px] text-foreground/50">Replacement Forward AWB</span>
                <div className="flex items-center gap-2">
                  {order?.delhivery_awb ? (
                    <a
                      href={`https://shiprocket.co/tracking/${order.delhivery_awb}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-semibold text-emerald-500 hover:underline flex items-center gap-1 font-mono"
                    >
                      {order.delhivery_awb} <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="text-[10px] text-foreground/40">Not Generated</span>
                  )}
                  <button
                    onClick={() => {
                      setEditingAwbType("forward");
                      setInputAwb(order?.delhivery_awb || "");
                      setShowAwbModal(true);
                    }}
                    className="text-[8px] text-foreground/50 hover:text-foreground font-bold uppercase tracking-widest ml-1"
                  >
                    Edit
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Price Difference */}
          <div className="bg-background border border-foreground/[0.05] rounded-xl p-5">
            <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.3em] mb-4">Payment Details</p>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-foreground/50">Settlement Preference</span>
                <span className="text-[10px] font-semibold text-foreground uppercase tracking-widest font-mono">
                  {data.settlementPreference === "COD_ON_DELIVERY" ? "COD on Delivery" : "Prepaid"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-foreground/50">Price Difference</span>
                <span className={`text-[14px] font-bold ${data.priceDifference > 0 ? 'text-rose-500' : data.priceDifference < 0 ? 'text-emerald-500' : 'text-foreground'}`}>
                  {data.priceDifference > 0 ? '+' : ''}₹{Math.abs(data.priceDifference || 0).toLocaleString("en-IN")}
                </span>
              </div>
              {data.priceDifference < 0 && (
                <div className="flex justify-between items-center pt-2 border-t border-foreground/[0.05]">
                  <span className="text-[10px] text-foreground/50">Store Credit Issued</span>
                  <span className="text-[11px] font-bold text-emerald-500">₹{Math.abs(data.priceDifference).toLocaleString("en-IN")}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-foreground/50">Payment Status</span>
                <span className={`text-[10px] font-semibold capitalize ${
                  (data.priceDifference || 0) === 0 ? 'text-emerald-500' :
                  (data.paymentStatus === 'paid' ? 'text-emerald-500' :
                   data.paymentStatus === 'cod_pending' ? 'text-amber-500' : 'text-foreground')
                }`}>
                  {(data.priceDifference || 0) === 0
                    ? "Paid (No Balance Due)"
                    : data.priceDifference < 0
                      ? "Store Credit Adjustment"
                      : (data.paymentStatus || "not_required").replace(/_/g, " ")
                  }
                </span>
              </div>
              {data.paymentId && (
                <div className="flex justify-between items-center pt-2 border-t border-foreground/[0.05]">
                  <span className="text-[10px] text-foreground/50">Payment ID</span>
                  <span className="text-[9px] font-mono text-foreground/60">{data.paymentId}</span>
                </div>
              )}
              {data.newShopifyOrderId && (
                <div className="flex justify-between items-center pt-2 border-t border-foreground/[0.05]">
                  <span className="text-[10px] text-foreground/50">Shopify Order</span>
                  <span className="text-[10px] font-semibold text-blue-500">#{data.newShopifyOrderId}</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="bg-background border border-foreground/[0.05] rounded-xl p-5">
            <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.3em] mb-4">Actions</p>
            <div className="space-y-2">
              {currentStatus === "pending_approval" && (
                <>
                  <button
                    onClick={handleApprove}
                    disabled={!!actionLoading}
                    className="w-full py-2.5 bg-foreground text-background rounded-lg text-[9px] font-bold uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {actionLoading === "approve" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Approve Exchange
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={!!actionLoading}
                    className="w-full py-2.5 border border-rose-500/20 text-rose-500 rounded-lg text-[9px] font-bold uppercase tracking-widest disabled:opacity-50 hover:bg-rose-500/5"
                  >
                    {actionLoading === "reject" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Reject"}
                  </button>
                </>
              )}
              {["approved", "return_created", "in_transit", "delivered_to_warehouse", "approved_pickup_failed"].includes(currentStatus) && (
                <button
                  onClick={() => setShowQcModal(true)}
                  disabled={!!actionLoading}
                  className="w-full py-2.5 bg-teal-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === "receive" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
                  Mark as Received & QC
                </button>
              )}
              {currentStatus === "received" && (
                <>
                  <p className="text-[9px] text-amber-500 leading-relaxed">
                    The returned parcel did not pass QC, so no replacement can be created. Reject the exchange to refund any amount the customer paid.
                  </p>
                  <button
                    onClick={handleReject}
                    disabled={!!actionLoading}
                    className="w-full py-2.5 border border-rose-500/20 text-rose-500 rounded-lg text-[9px] font-bold uppercase tracking-widest disabled:opacity-50 hover:bg-rose-500/5"
                  >
                    {actionLoading === "reject" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Reject Exchange"}
                  </button>
                </>
              )}
              {isRejected && ["paid", "refund_pending"].includes(String(data?.paymentStatus || "").toLowerCase()) && (
                <button
                  onClick={handleReject}
                  disabled={!!actionLoading}
                  className="w-full py-2.5 bg-rose-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest disabled:opacity-50"
                >
                  {actionLoading === "reject" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Retry Payment Refund"}
                </button>
              )}
              {currentStatus === "qc_passed" && (
                <button
                  onClick={handleCreateShopifyOrder}
                  disabled={!!actionLoading}
                  className="w-full py-2.5 bg-emerald-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === "create-order" ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShoppingBag className="w-3.5 h-3.5" />}
                  Create Replacement Order
                </button>
              )}
              {currentStatus === "new_order_created" && (
                <button
                  onClick={() => handleStatusUpdate("completed")}
                  disabled={!!actionLoading}
                  className="w-full py-2.5 bg-green-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === "completed" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Mark as Completed
                </button>
              )}
              {(currentStatus === "completed" || isRejected) && (
                <p className="text-[10px] text-foreground/40 text-center py-2">No further actions available</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* QC Modal */}
      <AnimatePresence>
        {showQcModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <div className="absolute inset-0 z-0" onClick={() => setShowQcModal(false)} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-background w-full max-w-sm rounded-xl p-6 border border-foreground/[0.05] shadow-lg relative z-10">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-[12px] font-semibold text-foreground tracking-widest uppercase">Receive & Quality Check</h2>
                <button onClick={() => setShowQcModal(false)} className="text-foreground/40 hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[9px] font-semibold uppercase tracking-widest text-foreground/50 mb-2">Quality Check Result</label>
                  <div className="flex gap-2">
                    <button onClick={() => setQcStatus("passed")} className={`flex-1 py-2.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border transition-all ${qcStatus === "passed" ? "bg-emerald-500 text-white border-emerald-500" : "border-foreground/10 text-foreground/40"}`}>
                      ✓ Passed
                    </button>
                    <button onClick={() => setQcStatus("failed")} className={`flex-1 py-2.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border transition-all ${qcStatus === "failed" ? "bg-rose-500 text-white border-rose-500" : "border-foreground/10 text-foreground/40"}`}>
                      ✗ Failed
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[9px] font-semibold uppercase tracking-widest text-foreground/50 mb-1.5">QC Notes (Optional)</label>
                  <textarea
                    value={qcNotes}
                    onChange={(e) => setQcNotes(e.target.value)}
                    rows={3}
                    className="w-full bg-foreground/[0.02] border border-foreground/[0.05] focus:border-foreground/20 rounded-md px-3 py-2 text-[11px] text-foreground outline-none resize-none"
                    placeholder="Add any quality check observations..."
                  />
                </div>
                <button
                  onClick={handleReceive}
                  disabled={!!actionLoading}
                  className="w-full py-2.5 bg-foreground text-background rounded-md text-[10px] font-semibold uppercase tracking-[0.15em] hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                >
                  {actionLoading === "receive" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />}
                  Confirm Receipt & QC
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AWB Edit Modal */}
      <AnimatePresence>
        {showAwbModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <div className="absolute inset-0 z-0" onClick={() => setShowAwbModal(false)} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-background w-full max-w-sm rounded-xl p-6 border border-foreground/[0.05] shadow-lg relative z-10">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-[12px] font-semibold text-foreground tracking-widest uppercase">
                  Update {editingAwbType === "reverse" ? "Reverse Pickup" : "Replacement Forward"} AWB
                </h2>
                <button onClick={() => setShowAwbModal(false)} className="text-foreground/40 hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[9px] font-semibold uppercase tracking-widest text-foreground/50 mb-1.5">Delhivery AWB Number</label>
                  <input
                    type="text"
                    value={inputAwb}
                    onChange={(e) => setInputAwb(e.target.value)}
                    className="w-full bg-foreground/[0.02] border border-foreground/[0.05] focus:border-foreground/20 rounded-md px-3 py-2.5 text-[12px] font-mono text-foreground outline-none"
                    placeholder="Enter Delhivery AWB..."
                  />
                </div>
                <button
                  onClick={handleSaveAwb}
                  disabled={!!actionLoading || !inputAwb.trim()}
                  className="w-full py-2.5 bg-blue-500 text-white rounded-md text-[10px] font-semibold uppercase tracking-[0.15em] hover:bg-blue-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {actionLoading === "update-awb" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Save & Sync with Delhivery
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
