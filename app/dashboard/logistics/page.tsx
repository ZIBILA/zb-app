"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Truck,
  Search,
  RefreshCw,
  Printer,
  ExternalLink,
  MapPin,
  ChevronRight,
  Clock,
  AlertCircle,
  Zap,
  Globe,
  Loader2,
  Box,
  Layers,
  X,
  CalendarClock,
  Ban,
  RotateCw,
  AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

// ─── Types ───────────────────────────────────────────────────────────

interface Shipment {
  id: string;
  orderId: string;
  awb: string | null;
  courier: string | null;
  status: string;
  trackingUrl: string | null;
  provider?: string;
  isReverse?: boolean;
  createdAt: string;
  order: {
    shopifyOrderId: string;
    fulfillmentStatus?: string;
    customer: {
      name: string | null;
    };
  };
}

interface TrackingData {
  ShipmentData?: Array<{
    Shipment: {
      AWB: string;
      ReferenceNo?: string;
      ExpectedDeliveryDate?: string;
      Status: {
        Status: string;
        StatusDateTime: string;
        StatusType: string;
        StatusLocation: string;
        Instructions?: string;
      };
      Scans?: Array<{
        ScanDetail: {
          Scan: string;
          ScannedLocation: string;
          ScanDateTime: string;
          Instructions?: string;
        };
      }>;
    };
  }>;
}

// ─── Status Theme ────────────────────────────────────────────────────

const STATUS_THEME: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  manifested:        { label: "Manifested",        color: "text-cyan-400",    bg: "bg-cyan-500/10",    dot: "bg-cyan-400" },
  manifest_required: { label: "Awaiting Manifest",  color: "text-amber-400",   bg: "bg-amber-500/10",   dot: "bg-amber-400" },
  confirmed:         { label: "Confirmed",          color: "text-cyan-400",    bg: "bg-cyan-500/10",    dot: "bg-cyan-400" },
  shipped:           { label: "Shipped",            color: "text-blue-400",    bg: "bg-blue-500/10",    dot: "bg-blue-400" },
  in_transit:        { label: "In Transit",         color: "text-blue-400",    bg: "bg-blue-500/10",    dot: "bg-blue-400" },
  out_for_delivery:  { label: "Out for Delivery",   color: "text-purple-400",  bg: "bg-purple-500/10",  dot: "bg-purple-400" },
  delivered:         { label: "Delivered",           color: "text-emerald-400", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
  pickup_pending:    { label: "Pickup Pending",     color: "text-amber-400",   bg: "bg-amber-500/10",   dot: "bg-amber-400" },
  rto:               { label: "RTO",                color: "text-rose-400",    bg: "bg-rose-500/10",    dot: "bg-rose-400" },
  cancelled:         { label: "Cancelled",          color: "text-rose-400",    bg: "bg-rose-500/10",    dot: "bg-rose-400" },
  pickup_scheduled:  { label: "Pickup Scheduled",   color: "text-amber-400",   bg: "bg-amber-500/10",   dot: "bg-amber-400" },
  picked_up:         { label: "Picked Up",          color: "text-blue-400",    bg: "bg-blue-500/10",    dot: "bg-blue-400" },
  pickup_failed:     { label: "Pickup Failed",      color: "text-rose-400",    bg: "bg-rose-500/10",    dot: "bg-rose-400" },
  undelivered:       { label: "Delivery Failed",    color: "text-rose-400",    bg: "bg-rose-500/10",    dot: "bg-rose-400" },
  rto_delivered:     { label: "RTO Received",       color: "text-rose-400",    bg: "bg-rose-500/10",    dot: "bg-rose-400" },
  lost:              { label: "Lost / Damaged",     color: "text-rose-400",    bg: "bg-rose-500/10",    dot: "bg-rose-400" },
};

// ─── Main Page ───────────────────────────────────────────────────────

export default function LogisticsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // TAT State
  const [tat, setTat] = useState<{ origin: string; dest: string; result: { success?: boolean; msg?: string; data?: { tat: number }; tat?: number } | null }>({ origin: "", dest: "", result: null });
  const [calculating, setCalculating] = useState(false);

  // Sync State
  const [syncing, setSyncing] = useState(false);

  // Schedule Pickup Modal
  const [pickupModal, setPickupModal] = useState(false);
  const [pickupDate, setPickupDate] = useState("");
  const [pickupCount, setPickupCount] = useState("1");
  const [schedulingPickup, setSchedulingPickup] = useState(false);

  // Tracking Modal
  const [trackingModal, setTrackingModal] = useState<string | null>(null);
  const [trackingData, setTrackingData] = useState<TrackingData | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);

  // Inline Actions
  const [manifestingOrderId, setManifestingOrderId] = useState<string | null>(null);
  const [cancellingAwb, setCancellingAwb] = useState<string | null>(null);
  const [confirmCancelAwb, setConfirmCancelAwb] = useState<string | null>(null);

  // ─── Toast ───────────────────────────────────────────────────────

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ─── Fetch Shipments ─────────────────────────────────────────────

  const fetchShipments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/admin/logistics/shipments?${params.toString()}`);
      const data = await res.json();
      if (data.success) setShipments(data.shipments);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  // ─── TAT Handler ──────────────────────────────────────────────────

  const handleTat = async () => {
    if (!tat.origin || !tat.dest) return;
    setCalculating(true);
    try {
      const res = await fetch(`/api/admin/logistics/tat?origin=${tat.origin}&destination=${tat.dest}`);
      const data = await res.json();
      if (data.success) {
        setTat(prev => ({ ...prev, result: data.tat }));
      } else {
        showToast(data.error || "TAT lookup failed", "error");
      }
    } catch {
      showToast("TAT lookup failed", "error");
    } finally {
      setCalculating(false);
    }
  };

  // ─── Sync Statuses ────────────────────────────────────────────────

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/logistics/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast(`Synced ${data.syncedCount} shipment${data.syncedCount !== 1 ? "s" : ""}`);
        fetchShipments();
      } else {
        showToast(data.error || "Sync failed", "error");
      }
    } catch {
      showToast("Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  };

  // ─── Schedule Pickup ──────────────────────────────────────────────

  const handleSchedulePickup = async () => {
    if (!pickupDate || !pickupCount) return;
    setSchedulingPickup(true);
    try {
      const res = await fetch("/api/delhivery/schedule-pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickupDatetime: pickupDate,
          packageCount: parseInt(pickupCount, 10),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Pickup scheduled successfully");
        setPickupModal(false);
        setPickupDate("");
        setPickupCount("1");
      } else {
        showToast(data.error || "Failed to schedule pickup", "error");
      }
    } catch {
      showToast("Failed to schedule pickup", "error");
    } finally {
      setSchedulingPickup(false);
    }
  };

  // ─── Inline Manifest (Create Shipment) ────────────────────────────

  const handleManifest = async (orderId: string) => {
    const actualOrderId = orderId.replace("pending-", "");
    setManifestingOrderId(orderId);
    try {
      const res = await fetch("/api/delhivery/create-shipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: actualOrderId }),
      });
      const data = await res.json();
      if (data.awb) {
        showToast(`Shipment created — AWB: ${data.awb}`);
        fetchShipments();
      } else {
        showToast(data.error || "Failed to create shipment", "error");
      }
    } catch {
      showToast("Failed to create shipment", "error");
    } finally {
      setManifestingOrderId(null);
    }
  };

  // ─── Inline Cancel ────────────────────────────────────────────────

  const handleCancel = (awb: string) => {
    setConfirmCancelAwb(awb);
  };

  const executeCancel = async (awb: string) => {
    setCancellingAwb(awb);
    try {
      const res = await fetch("/api/admin/logistics/cancel-shipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ awb }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Shipment cancelled");
        setConfirmCancelAwb(null);
        fetchShipments();
      } else {
        showToast(data.error || data.message || "Failed to cancel shipment", "error");
      }
    } catch {
      showToast("Failed to cancel shipment", "error");
    } finally {
      setCancellingAwb(null);
    }
  };

  // ─── Tracking Modal ───────────────────────────────────────────────

  const openTracking = async (awb: string) => {
    setTrackingModal(awb);
    setTrackingLoading(true);
    setTrackingData(null);
    try {
      const res = await fetch(`/api/logistics/track?awb=${encodeURIComponent(awb)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setTrackingData(null);
      } else {
        const history: Array<{ status?: string; location?: string; timestamp?: string; description?: string }> =
          Array.isArray(data.scan_history) ? data.scan_history : [];
        const sorted = [...history].sort((a, b) => {
          const ta = new Date(a.timestamp || "").getTime() || 0;
          const tb = new Date(b.timestamp || "").getTime() || 0;
          return tb - ta;
        });
        setTrackingData({
          ShipmentData: [
            {
              Shipment: {
                AWB: data.awb || awb,
                ExpectedDeliveryDate: data.estimated_delivery || undefined,
                Status: {
                  Status: data.status_label || data.status || "unknown",
                  StatusDateTime: sorted[0]?.timestamp || "",
                  StatusType: data.status || "",
                  StatusLocation: data.current_location || sorted[0]?.location || "",
                  Instructions: sorted[0]?.description || undefined,
                },
                Scans: sorted.map((e) => ({
                  ScanDetail: {
                    Scan: e.status || "",
                    ScannedLocation: e.location || "",
                    ScanDateTime: e.timestamp || "",
                    Instructions: e.description || undefined,
                  },
                })),
              },
            },
          ],
        });
      }
    } catch {
      showToast("Failed to load tracking data", "error");
    } finally {
      setTrackingLoading(false);
    }
  };

  // ─── Computed Stats ───────────────────────────────────────────────

  const stats = {
    total: shipments.length,
    manifested: shipments.filter(s => s.status === "manifested" || s.status === "confirmed" || s.status === "pickup_scheduled").length,
    awaiting: shipments.filter(s => s.status === "manifest_required").length,
    delivered: shipments.filter(s => s.status === "delivered").length,
    inTransit: shipments.filter(s => ["shipped", "in_transit", "picked_up", "out_for_delivery", "pickup_pending"].includes(s.status)).length,
  };

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="max-w-[1400px] mx-auto pb-32 space-y-12 pt-4">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-6 right-6 z-50 px-6 py-3 rounded-2xl text-[12px] font-bold uppercase tracking-widest shadow-2xl border ${
              toast.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-rose-500/10 border-rose-500/20 text-rose-400"
            }`}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-foreground/5 border border-foreground/10 flex items-center justify-center">
              <Truck className="w-4 h-4 text-foreground/40" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/20">Shiprocket · Delhivery</span>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">Logistics</h1>
          <p className="text-[13px] text-foreground/40 max-w-md font-medium leading-relaxed">
            Shipment management, label generation, tracking, and pickup scheduling.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Sync Button */}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2.5 px-6 py-3 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 rounded-2xl text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/60 hover:text-foreground transition-all disabled:opacity-50"
          >
            <RotateCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync Statuses"}
          </button>

          {/* Schedule Pickup Button */}
          <button
            onClick={() => setPickupModal(true)}
            className="flex items-center gap-2.5 px-6 py-3 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 rounded-2xl text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/60 hover:text-foreground transition-all"
          >
            <CalendarClock className="w-3.5 h-3.5" />
            Schedule Pickup
          </button>

          {/* Labels Page Link */}
          <Link
            href="/dashboard/logistics/labels"
            className="flex items-center gap-3 px-8 py-3 bg-foreground text-background rounded-2xl text-[11px] font-bold uppercase tracking-[0.2em] hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-foreground/5"
          >
            <Printer className="w-4 h-4" />
            Batch Labels
          </Link>
        </div>
      </div>

      {/* ─── Stats Strip ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total", value: stats.total, color: "text-foreground/60" },
          { label: "Awaiting Manifest", value: stats.awaiting, color: "text-amber-400" },
          { label: "Manifested", value: stats.manifested, color: "text-cyan-400" },
          { label: "In Transit", value: stats.inTransit, color: "text-blue-400" },
          { label: "Delivered", value: stats.delivered, color: "text-emerald-400" },
        ].map((s, i) => (
          <div key={i} className="p-4 rounded-2xl bg-foreground/[0.03] border border-foreground/5 space-y-1">
            <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">{s.label}</p>
            <p className={`text-2xl font-bold tracking-tight ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ─── Main Content ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Shipment Feed */}
        <div className="lg:col-span-8 space-y-8">
          {/* Search & Filter Bar */}
          <div className="flex items-center gap-4 p-2 glass-card rounded-[24px] border border-foreground/5 shadow-2xl">
            <div className="flex-1 relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/10 group-focus-within:text-foreground/40 transition-colors" />
              <input
                type="text"
                placeholder="Search by AWB, order ID, or customer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-transparent pl-12 pr-4 py-2.5 text-[13px] text-foreground placeholder:text-foreground/10 outline-none"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-[11px] text-foreground/60 outline-none appearance-none cursor-pointer"
            >
              <option value="">All Status</option>
              <option value="manifest_required">Awaiting Manifest</option>
              <option value="manifested">Booked / Manifested</option>
              <option value="pickup_scheduled">Pickup Scheduled</option>
              <option value="in_transit">In Transit</option>
              <option value="out_for_delivery">Out for Delivery</option>
              <option value="delivered">Delivered</option>
              <option value="rto">RTO In Progress</option>
              <option value="rto_delivered">RTO Received</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button onClick={fetchShipments} className="p-2.5 text-foreground/20 hover:text-foreground transition-all">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-blue-500" : ""}`} />
            </button>
          </div>

          {/* Table Header */}
          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-4 px-6 py-3 text-[10px] font-bold text-foreground/20 uppercase tracking-[0.2em]">
              <div className="col-span-4">Waybill / Order</div>
              <div className="col-span-3">Status</div>
              <div className="col-span-5 text-right">Actions</div>
            </div>

            <AnimatePresence mode="popLayout">
              {loading ? (
                <div className="py-40 flex flex-col items-center justify-center space-y-6">
                  <Loader2 className="w-6 h-6 animate-spin text-foreground/10" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.5em] text-foreground/10 italic">Loading shipments...</p>
                </div>
              ) : shipments.length === 0 ? (
                <div className="py-40 flex flex-col items-center justify-center space-y-6 border border-dashed border-foreground/5 rounded-[32px]">
                  <Box className="w-8 h-8 text-foreground/5" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/10">No shipments found</p>
                </div>
              ) : (
                shipments.map((s, i) => (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.015 }}
                    className="group"
                  >
                    <div className="grid grid-cols-12 gap-4 items-center px-6 py-4 rounded-2xl hover:bg-foreground/[0.03] border border-transparent hover:border-foreground/5 transition-all">
                      {/* Col 1: AWB / Order */}
                      <div className="col-span-4 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-foreground/5 flex items-center justify-center border border-foreground/5 shadow-inner flex-shrink-0">
                          <Layers className="w-4 h-4 text-foreground/20" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-foreground tracking-tight truncate">
                            {s.awb || "—"}
                          </p>
                          <p className="text-[10px] text-foreground/30 font-bold uppercase tracking-widest mt-0.5 truncate">
                            {s.order.shopifyOrderId?.replace("#", "") || ""}
                            {s.order.customer?.name ? ` · ${s.order.customer.name}` : ""}
                          </p>
                        </div>
                      </div>

                      {/* Col 2: Status */}
                      <div className="col-span-3">
                        <StatusBadge status={s.status} />
                        <p className="text-[10px] text-foreground/20 font-semibold uppercase tracking-widest mt-1.5 flex items-center gap-1.5">
                          <Globe className="w-2.5 h-2.5" />
                          {s.courier || "Courier"}{s.isReverse ? " · Reverse pickup" : ""}
                        </p>
                      </div>

                      {/* Col 3: Actions */}
                      <div className="col-span-5 text-right flex items-center justify-end gap-2 flex-wrap">
                        {s.awb ? (
                          <>
                            {/* Print Label (forward shipments only) */}
                            {!s.isReverse && (
                            <a
                              href={
                                s.provider === "delhivery"
                                  ? `/api/delhivery/label?awb=${s.awb}`
                                  : `/api/logistics/label?order_id=${s.orderId}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Print Label"
                              className="p-2.5 bg-foreground/5 hover:bg-foreground hover:text-background border border-foreground/10 rounded-xl transition-all text-foreground/40"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </a>
                            )}

                            {/* Track */}
                            <button
                              onClick={() => openTracking(s.awb!)}
                              title="View Tracking"
                              className="p-2.5 bg-foreground/5 hover:bg-blue-500/20 hover:text-blue-400 border border-foreground/10 rounded-xl transition-all text-foreground/40"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                            </button>

                            {/* External Link */}
                            <a
                              href={
                                s.trackingUrl ||
                                (s.provider === "delhivery"
                                  ? `https://www.delhivery.com/track/package/${s.awb}`
                                  : `https://shiprocket.co/tracking/${s.awb}`)
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open carrier tracking page"
                              className="p-2.5 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 rounded-xl text-foreground/40 hover:text-foreground transition-all"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>

                            {/* Cancel (only for cancellable statuses) */}
                            {["manifested", "confirmed", "packed", "pickup_pending", "pickup_scheduled"].includes(s.status) && (
                              <button
                                onClick={() => handleCancel(s.awb!)}
                                disabled={cancellingAwb === s.awb}
                                title="Cancel Shipment"
                                className="p-2.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-xl text-rose-400 transition-all disabled:opacity-50"
                              >
                                {cancellingAwb === s.awb ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Ban className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </>
                        ) : (
                          /* Booking */
                          s.provider === "shiprocket" ? (
                            <Link
                              href={`/dashboard/orders/${s.orderId.replace("pending-", "")}`}
                              className="flex items-center gap-2 px-5 py-2 bg-blue-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-lg shadow-blue-500/20"
                            >
                              <Zap className="w-3.5 h-3.5 fill-white" />
                              Book Courier
                            </Link>
                          ) : (
                            <button
                              onClick={() => handleManifest(s.id)}
                              disabled={manifestingOrderId === s.id}
                              className="flex items-center gap-2 px-5 py-2 bg-blue-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50"
                            >
                              {manifestingOrderId === s.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Zap className="w-3.5 h-3.5 fill-white" />
                              )}
                              Manifest
                            </button>
                          )
                        )}

                        {/* Order Detail Link */}
                        <Link
                          href={`/dashboard/orders/${s.orderId.replace("pending-", "")}`}
                          className="p-2.5 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 rounded-xl text-foreground/20 hover:text-foreground transition-all"
                          title="View Order"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ─── Sidebar Tools ───────────────────────────────────── */}
        <div className="lg:col-span-4 space-y-12">
          {/* TAT Estimator */}
          <div className="glass-card rounded-[40px] border border-foreground/5 p-10 space-y-10 relative overflow-hidden">
            <div className="absolute -left-20 -top-20 w-40 h-40 bg-blue-500/10 blur-[80px] rounded-full" />

            <div className="space-y-2 relative z-10">
              <h3 className="text-[10px] font-bold text-foreground/20 uppercase tracking-[0.4em]">Delhivery TAT</h3>
              <p className="text-[18px] font-semibold text-foreground tracking-tight italic">Expected Delivery Time</p>
            </div>

            <div className="space-y-6 relative z-10">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[8px] font-bold text-foreground/20 uppercase tracking-widest ml-1">Origin PIN</label>
                    <input
                      type="text"
                      placeholder="122001"
                      maxLength={6}
                      value={tat.origin}
                      onChange={(e) => setTat({ ...tat, origin: e.target.value.replace(/\D/g, "") })}
                      className="w-full bg-foreground/5 border border-foreground/5 rounded-xl px-4 py-3 text-[13px] text-foreground outline-none focus:border-foreground/20 transition-all font-mono placeholder:opacity-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[8px] font-bold text-foreground/20 uppercase tracking-widest ml-1">Destination PIN</label>
                    <input
                      type="text"
                      placeholder="400001"
                      maxLength={6}
                      value={tat.dest}
                      onChange={(e) => setTat({ ...tat, dest: e.target.value.replace(/\D/g, "") })}
                      className="w-full bg-foreground/5 border border-foreground/5 rounded-xl px-4 py-3 text-[13px] text-foreground outline-none focus:border-foreground/20 transition-all font-mono placeholder:opacity-10"
                    />
                  </div>
                </div>
                <button
                  onClick={handleTat}
                  disabled={calculating || tat.origin.length < 6 || tat.dest.length < 6}
                  className="w-full py-4 bg-foreground text-background rounded-[20px] text-[10px] font-bold uppercase tracking-[0.3em] shadow-2xl hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 group flex items-center justify-center gap-3"
                >
                  {calculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 fill-background" />}
                  {calculating ? "Checking..." : "Calculate TAT"}
                </button>
              </div>

              <AnimatePresence>
                {tat.result && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-6 rounded-[24px] bg-foreground/[0.03] border border-foreground/5 space-y-3"
                  >
                    {tat.result.success === false ? (
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest italic">Result</span>
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                        </div>
                        <p className="text-[13px] font-bold text-rose-400">{tat.result.msg || "Not serviceable"}</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest italic">Expected TAT</span>
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                        </div>
                        <p className="text-[28px] font-bold text-foreground tracking-tight">
                          {tat.result.data?.tat || tat.result.tat || "—"}
                          <span className="text-[14px] text-foreground/40 ml-1.5">days</span>
                        </p>
                        {tat.result.data?.tat && (
                          <p className="text-[11px] text-foreground/30 font-medium">
                            Est. arrival:{" "}
                            {new Date(Date.now() + (tat.result.data.tat * 24 * 60 * 60 * 1000)).toLocaleDateString("en-IN", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </p>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="glass-card rounded-[40px] border border-foreground/5 p-10 space-y-8 bg-gradient-to-br from-white/[0.03] to-transparent shadow-2xl">
            <h3 className="text-[10px] font-bold text-foreground/20 uppercase tracking-[0.4em]">Quick Actions</h3>
            <div className="space-y-3">
              <Link
                href="/dashboard/logistics/labels"
                className="flex items-center justify-between p-4 rounded-2xl bg-foreground/[0.03] border border-foreground/5 hover:bg-foreground/[0.06] transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-foreground/5 flex items-center justify-center">
                    <Printer className="w-4 h-4 text-foreground/30" />
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-foreground tracking-tight">Batch Labels</p>
                    <p className="text-[10px] text-foreground/30">Select and print multiple</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-foreground/10 group-hover:text-foreground/40 transition-colors" />
              </Link>

              <button
                onClick={() => setPickupModal(true)}
                className="w-full flex items-center justify-between p-4 rounded-2xl bg-foreground/[0.03] border border-foreground/5 hover:bg-foreground/[0.06] transition-all group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-foreground/5 flex items-center justify-center">
                    <CalendarClock className="w-4 h-4 text-foreground/30" />
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-foreground tracking-tight">Schedule Pickup</p>
                    <p className="text-[10px] text-foreground/30">Request Delhivery collection</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-foreground/10 group-hover:text-foreground/40 transition-colors" />
              </button>

              <button
                onClick={handleSync}
                disabled={syncing}
                className="w-full flex items-center justify-between p-4 rounded-2xl bg-foreground/[0.03] border border-foreground/5 hover:bg-foreground/[0.06] transition-all group text-left disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-foreground/5 flex items-center justify-center">
                    <RotateCw className={`w-4 h-4 text-foreground/30 ${syncing ? "animate-spin" : ""}`} />
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-foreground tracking-tight">Sync All Statuses</p>
                    <p className="text-[10px] text-foreground/30">Pull latest from Delhivery</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-foreground/10 group-hover:text-foreground/40 transition-colors" />
              </button>
            </div>
          </div>

          {/* Infrastructure Metrics */}
          <div className="glass-card rounded-[40px] border border-foreground/5 p-10 space-y-8 bg-gradient-to-br from-white/[0.03] to-transparent shadow-2xl">
            <h3 className="text-[10px] font-bold text-foreground/20 uppercase tracking-[0.4em]">Grid Metrics</h3>
            <div className="space-y-6">
              {[
                { label: "Delivery Reach", value: "28,000+ Pins", color: "bg-blue-500" },
                { label: "Sync Latency", value: "0.8ms", color: "bg-emerald-500" },
                { label: "Webhook Node", value: "Operational", color: "bg-purple-500" },
              ].map((m, i) => (
                <div key={i} className="space-y-2.5">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="font-bold text-foreground/60 uppercase tracking-widest">{m.label}</span>
                    <span className="font-mono text-foreground/20 font-bold">{m.value}</span>
                  </div>
                  <div className="h-[1px] w-full bg-foreground/5 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: "100%" }}
                      transition={{ delay: 0.5 + i * 0.1, duration: 0.8 }}
                      className={`h-full ${m.color}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Schedule Pickup Modal ──────────────────────────────── */}
      <AnimatePresence>
        {pickupModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setPickupModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md glass-card rounded-[32px] border border-foreground/10 p-8 space-y-8 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="text-[18px] font-semibold text-foreground tracking-tight">Schedule Pickup</h3>
                  <p className="text-[11px] text-foreground/40">Request Delhivery courier collection</p>
                </div>
                <button onClick={() => setPickupModal(false)} className="p-2 hover:bg-foreground/10 rounded-xl transition-colors">
                  <X className="w-4 h-4 text-foreground/40" />
                </button>
              </div>

              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">Pickup Date & Time</label>
                  <input
                    type="datetime-local"
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    className="w-full bg-foreground/5 border border-foreground/5 rounded-xl px-4 py-3 text-[13px] text-foreground outline-none focus:border-foreground/20 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">Expected Packages</label>
                  <input
                    type="number"
                    min="1"
                    value={pickupCount}
                    onChange={(e) => setPickupCount(e.target.value)}
                    className="w-full bg-foreground/5 border border-foreground/5 rounded-xl px-4 py-3 text-[13px] text-foreground outline-none focus:border-foreground/20 transition-all font-mono"
                  />
                </div>
              </div>

              <button
                onClick={handleSchedulePickup}
                disabled={schedulingPickup || !pickupDate}
                className="w-full py-4 bg-foreground text-background rounded-2xl text-[11px] font-bold uppercase tracking-[0.2em] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-3"
              >
                {schedulingPickup ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
                {schedulingPickup ? "Scheduling..." : "Confirm Pickup"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Tracking Timeline Modal ────────────────────────────── */}
      <AnimatePresence>
        {trackingModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setTrackingModal(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg glass-card rounded-[32px] border border-foreground/10 p-8 space-y-8 shadow-2xl max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="text-[18px] font-semibold text-foreground tracking-tight">Tracking Timeline</h3>
                  <p className="text-[11px] text-foreground/40 font-mono">AWB: {trackingModal}</p>
                </div>
                <button onClick={() => setTrackingModal(null)} className="p-2 hover:bg-foreground/10 rounded-xl transition-colors">
                  <X className="w-4 h-4 text-foreground/40" />
                </button>
              </div>

              {trackingLoading ? (
                <div className="py-16 flex flex-col items-center space-y-4">
                  <Loader2 className="w-6 h-6 animate-spin text-foreground/10" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/10">Fetching tracking data...</p>
                </div>
              ) : trackingData?.ShipmentData && trackingData.ShipmentData.length > 0 ? (
                <div className="space-y-6">
                  {/* Current Status */}
                  {(() => {
                    const shipment = trackingData.ShipmentData![0].Shipment;
                    return (
                      <div className="p-5 rounded-2xl bg-foreground/[0.03] border border-foreground/5 space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">Current Status</span>
                          <StatusBadge status={shipment.Status.Status} />
                        </div>
                        <p className="text-[13px] text-foreground/60">{shipment.Status.Instructions || shipment.Status.StatusType}</p>
                        <div className="flex items-center gap-4 text-[10px] text-foreground/30">
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {shipment.Status.StatusLocation}</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(shipment.Status.StatusDateTime).toLocaleString("en-IN")}
                          </span>
                        </div>
                        {shipment.ExpectedDeliveryDate && (
                          <p className="text-[11px] text-emerald-400 font-bold">
                            EDD: {new Date(shipment.ExpectedDeliveryDate).toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" })}
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Scan Timeline */}
                  {trackingData.ShipmentData![0].Shipment.Scans && trackingData.ShipmentData![0].Shipment.Scans.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest mb-4">Scan History</p>
                      <div className="space-y-0">
                        {trackingData.ShipmentData![0].Shipment.Scans.map((scan, idx) => (
                          <div key={idx} className="flex gap-4 items-start py-3">
                            <div className="flex flex-col items-center">
                              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${idx === 0 ? "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" : "bg-foreground/10"}`} />
                              {idx < trackingData.ShipmentData![0].Shipment.Scans!.length - 1 && (
                                <div className="w-px h-full bg-foreground/5 min-h-[24px]" />
                              )}
                            </div>
                            <div className="space-y-1 min-w-0 flex-1 -mt-0.5">
                              <p className="text-[12px] font-semibold text-foreground tracking-tight">{scan.ScanDetail.Scan}</p>
                              <p className="text-[10px] text-foreground/30">{scan.ScanDetail.Instructions || ""}</p>
                              <div className="flex items-center gap-3 text-[9px] text-foreground/20">
                                <span>{scan.ScanDetail.ScannedLocation}</span>
                                <span>{new Date(scan.ScanDetail.ScanDateTime).toLocaleString("en-IN")}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-16 flex flex-col items-center space-y-4">
                  <AlertCircle className="w-6 h-6 text-foreground/10" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/10">
                    {trackingData ? "No tracking data available for this AWB" : "Failed to load tracking data"}
                  </p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Cancel Shipment Modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {confirmCancelAwb && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !cancellingAwb && setConfirmCancelAwb(null)}
              className="absolute inset-0 bg-background/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="relative w-full max-w-md p-8 md:p-10 rounded-[36px] bg-[#0C0C0C]/95 border border-foreground/10 shadow-2xl space-y-6 text-left z-10"
            >
              <div className="flex items-center gap-4 text-rose-500">
                <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold uppercase tracking-tight text-foreground leading-none">
                    Cancel Shipment
                  </h3>
                  <p className="text-[10px] text-rose-500/70 uppercase tracking-[0.2em] mt-1.5 font-bold">
                    Logistics Command
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-[13px] text-foreground/80 leading-relaxed font-medium">
                  Are you sure you want to cancel shipment for AWB{' '}
                  <strong className="text-foreground font-mono bg-foreground/5 px-2 py-0.5 rounded border border-foreground/10">
                    {confirmCancelAwb}
                  </strong>
                  ?
                </p>
                <div className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/10 space-y-2 text-[11px] text-rose-400/90 font-medium">
                  <p>• The shipment will be voided with the logistics partner.</p>
                  <p>• Wallet balance will be refunded where applicable.</p>
                  <p>• This action cannot be reversed once confirmed.</p>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmCancelAwb(null)}
                  disabled={Boolean(cancellingAwb)}
                  className="flex-1 py-4 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 text-foreground/60 hover:text-foreground text-[10px] font-bold uppercase tracking-widest rounded-2xl transition-all disabled:opacity-50"
                >
                  Keep Shipment
                </button>
                <button
                  type="button"
                  onClick={() => executeCancel(confirmCancelAwb)}
                  disabled={Boolean(cancellingAwb)}
                  className="flex-1 py-4 bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-rose-500/20 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
                >
                  {cancellingAwb ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    'Confirm Cancel'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Status Badge Component ──────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const norm = status.toLowerCase().replace(/\s+/g, "_");
  const theme = STATUS_THEME[norm] || {
    label: status.replace(/_/g, " "),
    color: "text-foreground/40",
    bg: "bg-foreground/5",
    dot: "bg-foreground/20",
  };

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border border-foreground/5 ${theme.bg}`}>
      <div className={`w-1 h-1 rounded-full ${theme.dot}`} />
      <span className={`text-[9px] font-bold uppercase tracking-widest ${theme.color}`}>{theme.label}</span>
    </div>
  );
}
