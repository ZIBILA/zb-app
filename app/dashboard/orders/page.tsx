"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ShoppingCart,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Search,
  Plus,
  Package,
  Calendar,
  ArrowRight,
  Smartphone,
  ShoppingBag,
  Zap,
  Truck,
  ExternalLink
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatExactDateTime, extractItemVariantAndSize } from "@/lib/utils";
import { formatDisplayOrderNumber } from "@/lib/formatOrderNumber";
import InlineSizeSelector from "@/components/admin/InlineSizeSelector";
import { LOGISTICS_FILTER_OPTIONS, pickActiveOutboundShipment, shipmentAwb } from "@/lib/logistics/status";

interface OrderItem {
  id: string;
  title: string;
  quantity: number;
  price: number;
  sku: string | null;
  image: string | null;
}

interface Order {
  id: string;
  shopifyOrderId: string;
  status: string;
  totalPrice: number;
  paymentStatus: string;
  paymentMethod: string | null;
  fulfillmentStatus: string;
  deliveryStatus: string;
  createdAt: string;
  note: string | null;
  customer: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  items: OrderItem[];
  shipments: Array<{
    id?: string;
    awb?: string | null;
    trackingNumber?: string | null;
    courier?: string | null;
    status?: string;
    trackingUrl?: string | null;
  }>;
  delhivery_awb?: string | null;
  tracking_status?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  courier?: string | null;
  orderType?: string;
  internalOrderNumber?: string | null;
  displayOrderNumber?: string | null;
  shopifyOrderName?: string | null;
  shopifySyncStatus?: string | null;
  shopifySyncError?: string | null;
  tags?: string | null;
  returnRequests?: Array<{ id: string; displayId?: string | null; status: string }>;
  exchangeRequests?: Array<{ id: string; displayId?: string | null; status: string }>;
  discountAmount?: number;
  subtotalPrice?: number | null;
  paidAmount?: number;
}

const STATUS_THEME: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  payment_pending: { label: "Order creation in process", color: "text-amber-400", bg: "bg-amber-400/10", dot: "bg-amber-400" },
  'payment pending': { label: "Order creation in process", color: "text-amber-400", bg: "bg-amber-400/10", dot: "bg-amber-400" },
  paid: { label: "Settled", color: "text-emerald-500", bg: "bg-emerald-500/10", dot: "bg-emerald-500" },
  success: { label: "Settled", color: "text-emerald-500", bg: "bg-emerald-500/10", dot: "bg-emerald-500" },
  pending: { label: "Pending", color: "text-amber-500", bg: "bg-amber-500/10", dot: "bg-amber-500" },
  cod_upfront_paid: { label: "COD Upfront", color: "text-amber-500", bg: "bg-amber-500/10", dot: "bg-amber-500" },
  refunded: { label: "Refunded", color: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
  fulfilled: { label: "Dispatched", color: "text-blue-500", bg: "bg-blue-500/10", dot: "bg-blue-500" },
  unfulfilled: { label: "Draft", color: "text-foreground/40", bg: "bg-foreground/5", dot: "bg-foreground/20" },
  delivered: { label: "Delivered", color: "text-emerald-500", bg: "bg-emerald-500/10", dot: "bg-emerald-500" },
  manifested: { label: "Manifested", color: "text-blue-400", bg: "bg-blue-400/10", dot: "bg-blue-400" },
  'in transit': { label: "In Transit", color: "text-indigo-400", bg: "bg-indigo-400/10", dot: "bg-indigo-400" },
  'out for delivery': { label: "Out for Delivery", color: "text-amber-400", bg: "bg-amber-400/10", dot: "bg-amber-400" },
  shipped: { label: "Shipped", color: "text-blue-500", bg: "bg-blue-500/10", dot: "bg-blue-500" },
  confirmed: { label: "Booked", color: "text-cyan-400", bg: "bg-cyan-400/10", dot: "bg-cyan-400" },
  'pickup scheduled': { label: "Pickup Scheduled", color: "text-amber-400", bg: "bg-amber-400/10", dot: "bg-amber-400" },
  undelivered: { label: "Delivery Failed", color: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
  rto: { label: "RTO", color: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
  'returned to origin': { label: "RTO Received", color: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
  lost: { label: "Lost / Damaged", color: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
  partially_refunded: { label: "Partially Refunded", color: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
  awaiting_approval: { label: "Reviewing", color: "text-purple-500", bg: "bg-purple-500/10", dot: "bg-purple-500" },
  payment_failed: { label: "Failed", color: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
  failed: { label: "Failed", color: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
  cancelled: { label: "Cancelled", color: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
  cod: { label: "COD", color: "text-amber-500", bg: "bg-amber-500/10", dot: "bg-amber-500" },
  prepaid: { label: "Prepaid", color: "text-emerald-500", bg: "bg-emerald-500/10", dot: "bg-emerald-500" },
  razorpay: { label: "Prepaid", color: "text-emerald-500", bg: "bg-emerald-500/10", dot: "bg-emerald-500" },
};

function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = status.toLowerCase().replace(/[_-]/g, ' ');
  const theme = STATUS_THEME[normalizedStatus] || STATUS_THEME[status.toLowerCase()] || { 
    label: status.replace(/[_-]/g, ' '), 
    color: "text-foreground/40", 
    bg: "bg-foreground/5", 
    dot: "bg-foreground/20" 
  };
  
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-foreground/5 ${theme.bg}`}>
      <div className={`w-1 h-1 rounded-full ${theme.dot}`} />
      <span className={`text-[9px] font-bold uppercase tracking-widest ${theme.color}`}>
        {theme.label}
      </span>
    </div>
  );
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("any");
  const [paymentFilter, setPaymentFilter] = useState("any");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("any");
  const [logisticsFilter, setLogisticsFilter] = useState("any");
  const [tab, setTab] = useState<'all' | 'unfulfilled' | 'unpaid' | 'open'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const abortRef = useRef<AbortController | null>(null);

  const fetchOrders = useCallback(async (silent = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!silent && orders.length === 0) {
      setLoading(true);
    } else if (silent) {
      setIsRefreshing(true);
    }

    try {
      let finalStatus = statusFilter;
      let finalPayment = paymentFilter;
      let finalFulfillment = fulfillmentFilter;

      if (tab === 'unfulfilled') finalFulfillment = 'unfulfilled';
      if (tab === 'unpaid') finalPayment = 'pending';
      if (tab === 'open') finalStatus = 'active';

      const offset = (page - 1) * LIMIT;
      const url = `/api/admin/orders?limit=${LIMIT}&offset=${offset}&status=${finalStatus}&paymentStatus=${finalPayment}&fulfillmentStatus=${finalFulfillment}&logistics=${logisticsFilter}&search=${encodeURIComponent(search)}`;
      
      const res = await fetch(url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      
      if (res.status === 401 || res.status === 403) {
        if (typeof window !== "undefined") {
          window.location.href = "/dashboard/login?callbackUrl=" + encodeURIComponent(window.location.pathname);
        }
        return;
      }

      const data = await res.json();
      if (data.success || Array.isArray(data.orders)) {
        setOrders(data.orders || []);
        setTotal(data.total || 0);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("[Orders] Fetch error:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [statusFilter, paymentFilter, fulfillmentFilter, logisticsFilter, search, tab, page]);

  const handleUpdateOrderItemSize = async (orderItemId: string, newSize: string) => {
    try {
      const res = await fetch("/api/admin/orders/update-size", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderItemId, size: newSize }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update order item size");
      }
      setToast("Size updated successfully");
      fetchOrders(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to update order item size";
      setToast(msg);
      throw e;
    }
  };

  useEffect(() => {
    setPage(1);
  }, [statusFilter, paymentFilter, fulfillmentFilter, logisticsFilter, search, tab]);

  useEffect(() => {
    const timer = setTimeout(() => fetchOrders(false), 250);
    return () => clearTimeout(timer);
  }, [fetchOrders]);

  // Background refresh — keep infrequent to avoid DB/Shopify stampedes
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchOrders(true);
      }
    }, 45_000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  useEffect(() => {
    let last = 0;
    const handleSync = () => {
      const now = Date.now();
      if (now - last < 45_000) return;
      last = now;
      fetchOrders(true);
    };
    window.addEventListener("realtime-sync", handleSync);
    return () => window.removeEventListener("realtime-sync", handleSync);
  }, [fetchOrders]);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setToast("Initializing Deep Shopify Sync...");
    
    const timeout = setTimeout(() => {
      setSyncing(false);
      setToast("Sync taking longer than expected. Refreshing list...");
      fetchOrders(false);
    }, 30000);

    try {
      const res = await fetch("/api/shopify/sync", { method: "POST" });
      const data = await res.json();
      clearTimeout(timeout);
      
      if (data.success) {
        setToast(`Live Manifest Synchronized: ${data.synced?.orders || 0} orders updated`);
        fetchOrders(false);
      } else {
        setToast("Sync partial failure. Check logs.");
      }
    } catch {
      clearTimeout(timeout);
      setToast("Sync connection error");
    } finally {
      setSyncing(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto pb-32 space-y-10 pt-4">
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className="fixed top-8 left-1/2 z-[100] glass-card px-6 py-3 rounded-2xl border border-foreground/10 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground shadow-2xl flex items-center gap-3"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-10">
        <div className="space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-foreground/5 border border-foreground/10 flex items-center justify-center shadow-2xl">
              <ShoppingBag className="w-6 h-6 text-foreground/30" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-4xl md:text-5xl font-bold tracking-tighter text-foreground uppercase">
                  Order Manifest
                </h1>
                {isRefreshing && (
                  <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-bold uppercase tracking-wider">
                    <Zap className="w-3 h-3 animate-bounce" />
                    <span>Live</span>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-foreground/20 font-bold uppercase tracking-[0.4em] mt-1">
                Global Transactional Database
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
           <div className="flex bg-foreground/5 p-1 rounded-xl border border-foreground/10 mr-4">
              {[
                { id: 'all', label: 'All' },
                { id: 'unfulfilled', label: 'Unfulfilled' },
                { id: 'unpaid', label: 'Unpaid' },
                { id: 'open', label: 'Open' }
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id as 'all' | 'unfulfilled' | 'unpaid' | 'open')}
                  className={`px-6 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${tab === t.id ? 'bg-foreground text-background shadow-lg' : 'text-foreground/40 hover:text-foreground'}`}
                >
                  {t.label}
                </button>
              ))}
           </div>

          <button
            onClick={handleSync}
            disabled={syncing}
            className="group flex items-center gap-3 px-8 py-3.5 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 rounded-2xl text-[10px] font-bold uppercase tracking-[0.3em] text-foreground transition-all disabled:opacity-50"
          >
            <div className="relative">
              <RefreshCw className={`w-4 h-4 transition-transform duration-700 ${syncing ? "animate-spin" : "group-hover:rotate-180"}`} />
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            </div>
            {syncing ? "Syncing..." : "Sync Shopify"}
          </button>
          <Link
            href="/dashboard/orders/new"
            className="flex items-center gap-3 px-10 py-3.5 bg-foreground text-background rounded-2xl text-[10px] font-bold uppercase tracking-[0.3em] hover:opacity-95 transition-all shadow-2xl shadow-foreground/10"
          >
            <Plus className="w-4 h-4" strokeWidth={3} />
            Create
          </Link>
        </div>
      </div>

      {/* Control Bar */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-center border-b border-foreground/5 pb-10">
        <div className="xl:col-span-4 relative group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/10 group-focus-within:text-foreground/40 transition-colors" />
          <input
            type="text"
            placeholder="Search by ID, customer, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-2xl pl-14 pr-6 py-4 text-[13px] text-foreground placeholder:text-foreground/10 outline-none focus:border-foreground/10 transition-all"
          />
        </div>
        
        <div className="xl:col-span-8 flex flex-wrap items-center justify-end gap-4">
          {[
            { value: statusFilter, onChange: setStatusFilter, options: [
              { label: 'Process: All', value: 'any' },
              { label: 'Approved', value: 'approved' },
              { label: 'Open', value: 'open' },
              { label: 'Cancelled', value: 'cancelled' }
            ]},
            { value: paymentFilter, onChange: setPaymentFilter, options: [
              { label: 'Payment: All', value: 'any' },
              { label: 'Paid / Settled', value: 'settled' },
              { label: 'Refunded', value: 'refunded' },
              { label: 'COD Upfront', value: 'cod_upfront' },
              { label: 'Awaiting', value: 'pending' },
              { label: 'Failed', value: 'failed' }
            ]},
            { value: logisticsFilter, onChange: setLogisticsFilter, options: LOGISTICS_FILTER_OPTIONS.map((o) => ({ label: o.label, value: o.value })) }
          ].map((filter, i) => (
            <div key={i} className="relative group">
              <select
                value={filter.value}
                onChange={(e) => filter.onChange(e.target.value)}
                className="bg-foreground/[0.03] border border-foreground/5 hover:border-foreground/10 rounded-xl px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-foreground/40 hover:text-foreground/60 outline-none appearance-none cursor-pointer pr-12 transition-all"
              >
                {filter.options.map(opt => (
                  <option key={opt.value} value={opt.value} className="bg-[#0A0A0A] text-foreground">{opt.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/10 pointer-events-none group-hover:text-foreground/30 transition-colors" />
            </div>
          ))}

          <div className="h-10 w-[1px] bg-foreground/5 mx-2 hidden lg:block" />

          <div className="px-6 py-3 rounded-xl bg-foreground/5 border border-foreground/5 text-[10px] font-bold text-foreground/30 uppercase tracking-[0.2em]">
            <span className="text-foreground/60">{total}</span> Valid Signals
          </div>
        </div>
      </div>

      {/* Main List */}
      <div className="space-y-2">
        <div className="grid grid-cols-12 gap-6 px-8 py-4 text-[10px] font-bold text-foreground/20 uppercase tracking-[0.3em]">
          <div className="col-span-3">Entity / Identification</div>
          <div className="col-span-3">Customer Identity</div>
          <div className="col-span-2">Settlement</div>
          <div className="col-span-2">Logistics</div>
          <div className="col-span-2 text-right">Market Value</div>
        </div>

        <AnimatePresence mode="popLayout">
          {loading ? (
            <div className="py-48 flex flex-col items-center justify-center space-y-6">
              <div className="relative">
                <Loader2 className="w-10 h-10 animate-spin text-foreground/5" strokeWidth={1} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-foreground/20 animate-pulse" />
                </div>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-[0.5em] text-foreground/10">Reading Encrypted Logs...</p>
            </div>
          ) : orders.length === 0 ? (
             <div className="py-48 border border-dashed border-foreground/5 rounded-[2.5rem] flex flex-col items-center justify-center space-y-8 animate-in fade-in zoom-in duration-700">
                <div className="w-20 h-20 rounded-3xl bg-foreground/5 flex items-center justify-center border border-foreground/5 shadow-2xl relative">
                  <Package className="w-8 h-8 text-foreground/10" />
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500/20 rounded-full blur-sm" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-[14px] font-bold text-foreground/40 uppercase tracking-[0.3em]">No Transactions Detected</p>
                  <p className="text-[11px] text-foreground/15 max-w-[280px] mx-auto font-medium">Your global manifest is currently empty. Synchronize with Shopify to populate your records.</p>
                </div>
                <button 
                  onClick={handleSync}
                  className="px-10 py-3.5 bg-foreground/5 hover:bg-foreground hover:text-background border border-foreground/10 rounded-2xl text-[10px] font-bold uppercase tracking-[0.3em] transition-all"
                >
                  Force Initial Sync
                </button>
             </div>
          ) : orders.map((order, i) => {
            const isMobile = /^(ZB71|ZB8)/i.test(order.shopifyOrderId) || order.orderType === 'MOBILE_APP';
            
            return (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.015 }}
                className="group"
              >
                <Link 
                  href={`/dashboard/orders/${order.id}`}
                  className="grid grid-cols-12 gap-6 items-center px-8 py-6 rounded-[2rem] hover:bg-foreground/[0.02] border border-transparent hover:border-foreground/5 transition-all duration-500"
                >
                  <div className="col-span-3 flex items-center gap-5">
                    <div className="w-12 h-12 rounded-2xl bg-foreground/5 flex items-center justify-center border border-foreground/5 shadow-inner transition-colors group-hover:bg-foreground/10 group-hover:border-foreground/10">
                      {isMobile ? (
                        <Smartphone className="w-5 h-5 text-foreground/40 group-hover:text-foreground/60 transition-colors" />
                      ) : (
                        <ShoppingCart className="w-5 h-5 text-foreground/30 group-hover:text-foreground/50 transition-colors" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[14px] font-bold text-foreground tracking-tighter">
                          {formatDisplayOrderNumber(order.displayOrderNumber || order.internalOrderNumber || order.shopifyOrderName || order.shopifyOrderId || order.id)}
                        </span>
                        {order.shopifyOrderName && order.internalOrderNumber && order.shopifyOrderName !== order.internalOrderNumber && (
                          <span className="text-[10px] font-medium text-foreground/40">
                            ({order.shopifyOrderName})
                          </span>
                        )}
                        {order.internalOrderNumber?.startsWith('ZBPF') && (
                          <div className="px-1.5 py-0.5 rounded-md bg-rose-500/10 border border-rose-500/20 text-[8px] font-bold text-rose-500 uppercase tracking-tighter flex items-center gap-1">
                            FAILED
                          </div>
                        )}
                        {order.internalOrderNumber?.startsWith('ZBPP') && (
                          <div className="px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[8px] font-bold text-amber-500 uppercase tracking-tighter flex items-center gap-1">
                            PENDING
                          </div>
                        )}
                        {isMobile && (
                          <div className="px-1.5 py-0.5 rounded-md bg-foreground/5 border border-foreground/10 text-[8px] font-bold text-foreground/30 uppercase tracking-tighter">
                            APP
                          </div>
                        )}
                        {order.shopifySyncStatus === 'failed' && (
                          <div className="px-1.5 py-0.5 rounded-md bg-rose-500/10 border border-rose-500/20 text-[8px] font-bold text-rose-500 uppercase tracking-tighter flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full bg-rose-500" />
                            SYNC FAILED
                          </div>
                        )}
                        {order.shopifySyncStatus === 'pending' && (
                          <div className="px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[8px] font-bold text-amber-500 uppercase tracking-tighter flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full bg-amber-500" />
                            PENDING SYNC
                          </div>
                        )}
                        {order.shopifySyncStatus === 'synced' && (
                          <div className="px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[8px] font-bold text-emerald-500 uppercase tracking-tighter flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full bg-emerald-500" />
                            SYNCED
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-foreground/50 font-medium tracking-wide flex items-center gap-1.5 mt-0.5 font-mono">
                        <Calendar className="w-3 h-3 text-foreground/30" />
                        {formatExactDateTime(order.createdAt, true)}
                      </p>
                    </div>
                  </div>

                  <div className="col-span-3">
                    <p className="text-[14px] font-bold text-foreground/80 tracking-tight mb-0.5">{order.customer?.name || "Guest Checkout"}</p>
                    <div className="flex items-center gap-2 text-[10px] text-foreground/40 font-semibold truncate max-w-[200px] mb-1">
                      {order.customer?.email || order.customer?.phone || "Private Contact"}
                    </div>
                    {order.items && order.items.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {order.items.slice(0, 2).map((item, idx) => {
                          const itemObj = item as OrderItem & { variantTitle?: string; size?: string };
                          const vInfo = extractItemVariantAndSize(item.title, item.sku, itemObj.variantTitle, itemObj.size);
                          const resolvedSize = itemObj.size || vInfo.size;
                          const resolvedVariantTitle = itemObj.variantTitle || vInfo.variant;
                          return (
                            <span key={idx} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-foreground/5 text-[9px] text-foreground/70 border border-foreground/5 font-mono" onClick={(e) => e.stopPropagation()}>
                              <span className="font-semibold text-foreground truncate max-w-[100px]">{item.title}</span>
                              <InlineSizeSelector
                                size={resolvedSize}
                                variantTitle={resolvedVariantTitle}
                                itemId={item.id}
                                itemType="orderItem"
                                onUpdateSize={(sz) => handleUpdateOrderItemSize(item.id, sz)}
                              />
                              <span className="text-foreground/40">x{item.quantity}</span>
                            </span>
                          );
                        })}
                        {order.items.length > 2 && (
                          <span className="text-[9px] text-foreground/30 font-bold self-center">+{order.items.length - 2} more</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="col-span-2">
                    <StatusBadge status={order.paymentStatus} />
                  </div>

                  <div className="col-span-2">
                    <StatusBadge status={order.status === 'cancelled' ? 'cancelled' : (order.deliveryStatus || order.fulfillmentStatus || 'unfulfilled')} />
                    {(order.returnRequests?.length || order.exchangeRequests?.length) ? (
                      <div className="mt-1.5 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                        {order.returnRequests?.filter((r) => r.status !== 'cancelled' && (r.displayId || !order.exchangeRequests?.length)).map((r) => (
                          <a key={r.id} href={`/dashboard/returns/${r.id}`} className="px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[8px] font-mono font-bold text-amber-500 tracking-tight" title={`Return · ${r.status.replace(/_/g, ' ')}`}>
                            {r.displayId || 'RETURN'}
                          </a>
                        ))}
                        {order.exchangeRequests?.filter((r) => r.status !== 'cancelled').map((r) => (
                          <a key={r.id} href={`/dashboard/exchanges/${r.id}`} className="px-1.5 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-[8px] font-mono font-bold text-blue-500 tracking-tight" title={`Exchange · ${r.status.replace(/_/g, ' ')}`}>
                            {r.displayId || 'EXCHANGE'}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {(() => {
                      const shipment = pickActiveOutboundShipment((order.shipments || []) as any[]) as any;
                      const awb = order.trackingNumber || shipmentAwb(shipment) || order.delhivery_awb;
                      const trackUrl = order.trackingUrl || shipment?.trackingUrl || (awb ? `https://zicabella.shiprocket.co/tracking/${awb}` : null);
                      const courierName = order.courier || shipment?.courier || (order.delhivery_awb ? 'Delhivery' : null);

                      if (!awb) return null;

                      return (
                        <div className="mt-1.5 flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
                          {trackUrl ? (
                            <a
                              href={trackUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-indigo-400 hover:text-indigo-300 hover:underline transition-colors"
                              title={`Track via ${courierName || 'Courier'}`}
                            >
                              <Truck className="w-2.5 h-2.5 shrink-0 text-indigo-400" />
                              <span className="truncate max-w-[110px]">{awb}</span>
                              <ExternalLink className="w-2 h-2 shrink-0 opacity-70" />
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[9px] font-mono text-foreground/50">
                              <Truck className="w-2.5 h-2.5 shrink-0 text-foreground/40" />
                              <span className="truncate max-w-[110px]">{awb}</span>
                            </span>
                          )}
                          {courierName && (
                            <span className="text-[8px] text-foreground/40 font-medium truncate max-w-[110px]">
                              {courierName}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="col-span-2 text-right flex items-center justify-end gap-6">
                     <div className="text-right">
                        <p className="text-[16px] font-bold text-foreground tracking-tighter leading-none mb-1">
                          ₹{order.totalPrice.toLocaleString("en-IN")}
                        </p>
                        <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mb-1.5 leading-none">
                          Paid: ₹{(order.paidAmount ?? (order.paymentStatus === 'paid' ? order.totalPrice : 0)).toLocaleString("en-IN")}
                        </p>
                        <p className="text-[9px] text-foreground/20 font-bold uppercase tracking-widest">
                          {order.items.length} Units
                        </p>
                     </div>
                     <div className="w-10 h-10 rounded-xl bg-foreground/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all border border-foreground/10 translate-x-4 group-hover:translate-x-0">
                        <ChevronRight className="w-5 h-5 text-foreground/30" strokeWidth={2.5} />
                     </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Pagination Controls */}
      {total > LIMIT && (
        <div className="flex items-center justify-between gap-4 pt-10 border-t border-foreground/5">
          <p className="text-[10px] font-bold text-foreground/20 uppercase tracking-[0.2em]">
            Showing <span className="text-foreground/40">{(page - 1) * LIMIT + 1}</span> to <span className="text-foreground/40">{Math.min(page * LIMIT, total)}</span> of <span className="text-foreground/40">{total}</span> Transactions
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="px-6 py-3 bg-foreground/5 hover:bg-foreground/10 disabled:opacity-30 border border-foreground/10 rounded-xl text-[10px] font-bold uppercase tracking-widest text-foreground transition-all"
            >
              Previous
            </button>
            <div className="px-5 py-3 rounded-xl bg-foreground text-background text-[10px] font-black tracking-widest min-w-[40px] text-center">
              {page}
            </div>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page * LIMIT >= total || loading}
              className="px-8 py-3 bg-foreground/5 hover:bg-foreground/10 disabled:opacity-30 border border-foreground/10 rounded-xl text-[10px] font-bold uppercase tracking-widest text-foreground transition-all flex items-center gap-3"
            >
              Next
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
