"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, ArrowLeft, Check, X, Clock, Package, TruckIcon, CheckCircle2, XCircle, CreditCard, AlertTriangle, RefreshCw, User, MapPin, Mail, Phone, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatExactDateTime, extractItemVariantAndSize } from "@/lib/utils";
import VariantBadge from "@/components/admin/VariantBadge";
import InlineSizeSelector from "@/components/admin/InlineSizeSelector";
import ReversePickupPanel from "@/components/admin/ReversePickupPanel";
import { isCodOrder, COD_STORE_CREDIT_MESSAGE, deriveReverseStage, REVERSE_STAGE_LABEL } from "@/lib/returnPolicy";

const STATUS_STEPS = [
  { key: "pending_approval", label: "Requested", icon: Clock },
  { key: "approved", label: "Accepted", icon: CheckCircle2 },
  { key: "pickup_scheduled", label: "Pickup Scheduled", icon: TruckIcon },
  { key: "in_transit", label: "In Transit", icon: TruckIcon },
  { key: "received", label: "Received", icon: Package },
  { key: "refunded", label: "Refund / Credit", icon: CreditCard },
];

function stepIndexFor(status: string, hasAwb: boolean, receivedAt: unknown): number {
  const s = (status || "").toLowerCase();
  if (s === "refunded") return 5;
  if (s === "received" || s === "qc_passed" || s === "refund_pending" || receivedAt) return 4;
  if (s === "in_transit" || s === "delivered_to_warehouse") return 3;
  if (s === "pickup_scheduled" || ((s === "approved" || s === "approved_pickup_failed") && hasAwb)) return 2;
  if (s === "approved" || s === "approved_pickup_failed") return 1;
  return 0;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  pending_approval: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Pending Approval" },
  approved: { color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20", label: "Approved" },
  refund_pending: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Refund Pending" },
  rejected: { color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Rejected" },
  pickup_scheduled: { color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20", label: "Pickup Scheduled" },
  received: { color: "text-teal-500", bg: "bg-teal-500/10", border: "border-teal-500/20", label: "Received" },
  refunded: { color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Refunded" },
  requested: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Requested" },
  in_transit: { color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20", label: "In Transit" },
  delivered_to_warehouse: { color: "text-teal-500", bg: "bg-teal-500/10", border: "border-teal-500/20", label: "Delivered – Confirm Receipt" },
  approved_pickup_failed: { color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Pickup Failed" },
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

export default function ReturnDetailPage() {
  const params = useParams();
  const router = useRouter();
  const returnId = params.id as string;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
      setToast("Size updated successfully");
      setTimeout(() => setToast(null), 3000);
      fetchDetail();
    } catch (e: any) {
      setToast(e.message || "Failed to update return size");
      setTimeout(() => setToast(null), 3000);
      throw e;
    }
  };

  // Refund modal state
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundType, setRefundType] = useState<"original_method" | "store_credit">("original_method");

  // AWB Modal State
  const [showAwbModal, setShowAwbModal] = useState(false);
  const [inputAwb, setInputAwb] = useState("");

  const handleSaveAwb = async () => {
    if (!inputAwb.trim()) return;
    setActionLoading("update-awb");
    try {
      const res = await fetch(`/api/admin/returns/${returnId}/update-awb`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ awb: inputAwb.trim() }),
      });
      if (res.ok) {
        showToast("Reverse AWB updated & synced with Delhivery!");
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
      // Try fetching as ReturnRequest first
      const res = await fetch(`/api/admin/returns/${returnId}`);
      if (res.ok) {
        const json = await res.json();
        setData(json.return || json);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [returnId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleStatusUpdate = async (newStatus: string, extra?: any) => {
    setActionLoading(newStatus);
    try {
      // Use the approve/reject endpoints for those actions
      if (newStatus === "approved" || newStatus === "APPROVED") {
        const res = await fetch(`/api/admin/returns/${returnId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(extra || {}),
        });
        if (res.ok) {
          showToast("Return accepted — now select the logistics partner");
          fetchDetail();
        } else {
          const err = await res.json();
          showToast(`Error: ${err.error}`);
        }
      } else if (newStatus === "rejected" || newStatus === "REJECTED") {
        const res = await fetch(`/api/admin/returns/${returnId}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(extra || {}),
        });
        if (res.ok) {
          showToast("Return rejected");
          fetchDetail();
        } else {
          const err = await res.json();
          showToast(`Error: ${err.error}`);
        }
      } else {
        // Use PATCH for other status transitions (RECEIVED, REFUNDED, etc.)
        const res = await fetch(`/api/admin/returns/${returnId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus, ...extra }),
        });
        if (res.ok) {
          showToast(`Status updated to ${newStatus}`);
          fetchDetail();
        } else {
          const err = await res.json();
          showToast(`Error: ${err.error}`);
        }
      }
    } catch (err) {
      console.error(err);
      showToast("Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRefundSubmit = () => {
    handleStatusUpdate("approved", {
      actualRefund: parseFloat(refundAmount) || data?.estimatedRefund || 0,
      customerId: data?.customerId || data?.customer?.id,
    });
    setShowRefundModal(false);
  };

  const handleReleaseRefund = async () => {
    setActionLoading("release-refund");
    try {
      const res = await fetch(`/api/admin/refunds/${returnId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(json.message || "Refund released");
        fetchDetail();
      } else {
        showToast(`Error: ${json.error || "Failed to release refund"}`);
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
      const res = await fetch(`/api/admin/returns/${returnId}/regenerate-pickup`, {
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
        <p className="text-[11px] text-foreground/50 uppercase tracking-widest">Return not found</p>
        <button onClick={() => router.push("/dashboard/returns")} className="text-[10px] text-blue-500 font-bold uppercase tracking-widest">← Back to Returns</button>
      </div>
    );
  }

  // Normalize data structure — could come as ReturnRequest (with .returns[]) or Return (individual)
  const isReturnRequest = !!data.returns;
  const returnItems = isReturnRequest ? data.returns : [data];
  const currentStatus = (data.status || "pending_approval").toLowerCase();
  const currentStepIndex = stepIndexFor(currentStatus, !!data.reverseAwb, data.receivedAt);
  const codOrder = isCodOrder(data.order);
  const stage = deriveReverseStage({
    requestStatus: currentStatus,
    receivedAt: data.receivedAt,
    hasAwb: !!data.reverseAwb,
    carrierStatus: data.carrierStatus,
  });
  const isReceived = !!data.receivedAt || ["received", "qc_passed", "refund_pending"].includes(currentStatus);
  const releaseLabel =
    codOrder || returnItems[0]?.refundMethod === "store_credit" ? "Release Store Credit" : "Release Refund";
  const isRejected = currentStatus === "rejected";
  const order = data.order;
  const customer = data.customer || order?.customer;

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
          <button onClick={() => router.push("/dashboard/returns")} className="p-2 rounded-lg hover:bg-foreground/[0.03] transition-colors">
            <ArrowLeft className="w-4 h-4 text-foreground/60" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-foreground tracking-tight">Return {data.displayId || `#${(data.id || returnId).slice(0, 8)}`}</h1>
              <StatusBadge status={currentStatus} />
            </div>
            <p className="text-[10px] font-medium text-foreground/50 mt-0.5 font-mono">
              Requested on: {formatExactDateTime(data.createdAt || data.requestedAt, true)}
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
          <p className="text-[9px] font-bold text-foreground/40 uppercase tracking-[0.3em] mb-6">Status Timeline</p>
          <div className="flex items-center justify-between relative">
            {/* Progress Line */}
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
                    transition={{ duration: 0.3 }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </motion.div>
                  <span className={`text-[8px] font-bold uppercase tracking-widest mt-2 whitespace-nowrap ${isCurrent ? "text-foreground" : isActive ? "text-foreground/60" : "text-foreground/25"}`}>
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
            <p className="text-[11px] font-semibold text-rose-500">Return Request Rejected</p>
            {data.reason && <p className="text-[10px] text-rose-400/70 mt-1">Reason: {data.reason}</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Return Items */}
          <div className="bg-background border border-foreground/[0.05] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-foreground/[0.05]">
              <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.3em]">Returned Items ({returnItems.length})</p>
            </div>
            <div className="divide-y divide-foreground/[0.03]">
              {returnItems.map((item: any, idx: number) => {
                const itemTitle = item.title || item.product?.title || "Product";
                const itemSku = item.sku || item.product?.sku;
                const vInfo = extractItemVariantAndSize(itemTitle, itemSku, item.variantTitle, item.size);
                const resolvedSize = item.size || vInfo.size;
                const resolvedVariant = item.variantTitle || vInfo.variant;

                return (
                  <div key={idx} className="p-5 flex items-start gap-4">
                    <div className="w-16 h-16 rounded-xl bg-foreground/[0.02] border border-foreground/[0.05] overflow-hidden shrink-0 flex items-center justify-center">
                      {item.product?.featuredImage ? (
                        <img src={item.product.featuredImage} alt={itemTitle} className="w-full h-full object-cover" />
                      ) : (
                        <Package className="w-5 h-5 text-foreground/20" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[13px] font-bold text-foreground">{itemTitle}</p>
                            <InlineSizeSelector
                              size={resolvedSize}
                              variantTitle={resolvedVariant}
                              itemId={item.id}
                              itemType="return"
                              onUpdateSize={(sz) => handleUpdateReturnSize(item.id, sz)}
                            />
                          </div>
                          <p className="text-[10px] text-foreground/40 mt-1 font-mono">SKU: {itemSku || "N/A"} • Qty: {item.quantity || 1}</p>
                        </div>
                        <StatusBadge status={item.status || "REQUESTED"} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-4 pt-2 border-t border-foreground/5">
                        <div>
                          <p className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest">Reason</p>
                          <p className="text-[11px] text-foreground/70 mt-0.5">{item.reason || "Not specified"}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest">Refund Amount</p>
                          <p className="text-[11px] font-semibold text-foreground mt-0.5">₹{(item.refundAmount || 0).toLocaleString("en-IN")}</p>
                        </div>
                        {item.storeCreditAmount > 0 && (
                          <div>
                            <p className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest">Store Credit</p>
                            <p className="text-[11px] font-semibold text-emerald-500 mt-0.5">₹{item.storeCreditAmount.toLocaleString("en-IN")}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Order Details */}
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
          {/* Customer Info */}
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
                    <p className="text-[9px] text-foreground/40">{customer.shopifyId ? `#${customer.shopifyId}` : ""}</p>
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

          {/* Reverse Pickup Logistics */}
          <div className="bg-background border border-foreground/[0.05] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.3em]">Logistics & Tracking</p>
              <button
                onClick={() => {
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
                  {data.liveStageLabel || REVERSE_STAGE_LABEL[stage]}
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
              {data.estimatedDelivery && !isReceived && (
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
              {!data.reason?.includes?.("EXCHANGE_RETURN") && (
                <ReversePickupPanel
                  kind="return"
                  requestId={data.id || returnId}
                  status={currentStatus}
                  reverseAwb={data.reverseAwb}
                  logisticsPartner={data.logisticsPartner}
                  onBooked={(m) => { showToast(m); fetchDetail(); }}
                  onError={(m) => showToast(`Error: ${m}`)}
                />
              )}
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-foreground/50">Received by us</span>
                <span className="text-[10px] font-semibold text-foreground font-mono">
                  {data.receivedAt ? formatExactDateTime(data.receivedAt, true) : "Not yet"}
                </span>
              </div>
            </div>
          </div>

          {/* Refund Summary */}
          <div className="bg-background border border-foreground/[0.05] rounded-xl p-5">
            <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.3em] mb-4">Refund Summary</p>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-foreground/50">Estimated Refund</span>
                <span className="text-[12px] font-semibold text-foreground">₹{(data.estimatedRefund || returnItems.reduce((a: number, i: any) => a + (i.refundAmount || 0), 0)).toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-foreground/50">Customer Preference</span>
                <span className="text-[10px] font-semibold text-foreground uppercase tracking-widest">
                  {codOrder || returnItems[0]?.refundMethod === "store_credit" ? "Store Credit" : "Original Method"}
                </span>
              </div>
              {codOrder && (
                <p className="text-[9px] text-amber-500 leading-relaxed">{COD_STORE_CREDIT_MESSAGE}</p>
              )}
              {data.actualRefund != null && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-foreground/50">Actual Refund</span>
                  <span className="text-[12px] font-bold text-emerald-500">₹{data.actualRefund.toLocaleString("en-IN")}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-foreground/[0.05]">
                <span className="text-[10px] text-foreground/50">Refund Status</span>
                <span className="text-[10px] font-semibold text-foreground capitalize">{data.refundStatus || returnItems[0]?.refundStatus || "Pending"}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="bg-background border border-foreground/[0.05] rounded-xl p-5">
            <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.3em] mb-4">Actions</p>
            <div className="space-y-2">
              {currentStatus === "pending_approval" && (
                <>
                  <button
                    onClick={() => {
                      const pref = returnItems[0]?.refundMethod === "store_credit" ? "store_credit" : "original_method";
                      setRefundType(pref);
                      setShowRefundModal(true);
                      setRefundAmount(String(data.estimatedRefund || returnItems.reduce((a: number, i: any) => a + (i.refundAmount || 0), 0)));
                    }}
                    disabled={!!actionLoading}
                    className="w-full py-2.5 bg-foreground text-background rounded-lg text-[9px] font-bold uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {actionLoading === "refund_pending" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Approve Request
                  </button>
                  <button
                    onClick={() => handleStatusUpdate("rejected", { reason: "Admin rejected" })}
                    disabled={!!actionLoading}
                    className="w-full py-2.5 border border-rose-500/20 text-rose-500 rounded-lg text-[9px] font-bold uppercase tracking-widest disabled:opacity-50 hover:bg-rose-500/5"
                  >
                    {actionLoading === "rejected" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Reject Request"}
                  </button>
                </>
              )}
              {["approved", "in_transit", "delivered_to_warehouse", "approved_pickup_failed"].includes(currentStatus) && (
                <button
                  onClick={() => handleStatusUpdate("received")}
                  disabled={!!actionLoading}
                  className="w-full py-2.5 bg-teal-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === "received" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
                  Confirm Parcel Received
                </button>
              )}
              {isReceived && currentStatus !== "refunded" && (
                <button
                  onClick={handleReleaseRefund}
                  disabled={!!actionLoading}
                  className="w-full py-2.5 bg-emerald-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === "release-refund" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
                  {releaseLabel}
                </button>
              )}
              {(currentStatus === "refunded" || isRejected) && (
                <p className="text-[10px] text-foreground/40 text-center py-2">No further actions available</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Refund Modal */}
      <AnimatePresence>
        {showRefundModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <div className="absolute inset-0 z-0" onClick={() => setShowRefundModal(false)} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-background w-full max-w-sm rounded-xl p-6 border border-foreground/[0.05] shadow-lg relative z-10">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-[12px] font-semibold text-foreground tracking-widest uppercase">Accept Return</h2>
                <button onClick={() => setShowRefundModal(false)} className="text-foreground/40 hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>

              <div className="space-y-4">
                {codOrder ? (
                  <p className="text-[10px] text-amber-500 leading-relaxed">{COD_STORE_CREDIT_MESSAGE}</p>
                ) : (
                  <p className="text-[10px] text-foreground/60 leading-relaxed">
                    Refund method follows the customer&apos;s preference above. No manual override.
                  </p>
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

      {/* AWB Edit Modal */}
      <AnimatePresence>
        {showAwbModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <div className="absolute inset-0 z-0" onClick={() => setShowAwbModal(false)} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-background w-full max-w-sm rounded-xl p-6 border border-foreground/[0.05] shadow-lg relative z-10">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-[12px] font-semibold text-foreground tracking-widest uppercase">
                  Update Reverse Pickup AWB
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
