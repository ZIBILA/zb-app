"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Smartphone,
  Search,
  RefreshCw,
  ChevronRight,
  Filter,
  CreditCard,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Loader2,
  MoreHorizontal,
  ExternalLink,
  ShieldCheck,
  Zap,
  ArrowLeft,
  ArrowRight,
  Activity
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { cachedAdminFetch, invalidateAdminCache } from "@/lib/adminClientCache";

interface MobileOrder {
  id: string;
  orderNumber: string;
  createdAt: string;
  totalPrice: number;
  paymentStatus: string;
  status: string;
  deliveryStatus: string;
  shopifyOrderId?: string | null;
  customer: {
    name: string;
    email: string;
  };
}

const STATUS_THEME: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  paid: { label: "Settled", color: "text-emerald-500", bg: "bg-emerald-500/10", dot: "bg-emerald-500" },
  success: { label: "Settled", color: "text-emerald-500", bg: "bg-emerald-500/10", dot: "bg-emerald-500" },
  pending: { label: "Awaiting", color: "text-amber-500", bg: "bg-amber-500/10", dot: "bg-amber-500" },
  awaiting_approval: { label: "Reviewing", color: "text-purple-500", bg: "bg-purple-500/10", dot: "bg-purple-500" },
  payment_failed: { label: "Failed", color: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
  failed: { label: "Failed", color: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
  delivered: { label: "Arrived", color: "text-emerald-500", bg: "bg-emerald-500/10", dot: "bg-emerald-500" },
  manifested: { label: "Manifested", color: "text-blue-400", bg: "bg-blue-400/10", dot: "bg-blue-400" },
  'in transit': { label: "In Transit", color: "text-indigo-400", bg: "bg-indigo-400/10", dot: "bg-indigo-400" },
  'out for delivery': { label: "Out for Delivery", color: "text-amber-400", bg: "bg-amber-400/10", dot: "bg-amber-400" },
  shipped: { label: "Shipped", color: "text-blue-500", bg: "bg-blue-500/10", dot: "bg-blue-500" },
  open: { label: "Active", color: "text-emerald-500", bg: "bg-emerald-500/10", dot: "bg-emerald-500" },
  fulfilled: { label: "Dispatched", color: "text-cyan-500", bg: "bg-cyan-500/10", dot: "bg-cyan-500" },
  unfulfilled: { label: "Draft", color: "text-foreground/40", bg: "bg-foreground/5", dot: "bg-foreground/20" },
  payment_pending: { label: "Unpaid", color: "text-amber-500", bg: "bg-amber-500/10", dot: "bg-amber-500" },
  cancelled: { label: "Cancelled", color: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
};

export default function MobileOrdersPage() {
  const [orders, setOrders] = useState<MobileOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<'all' | 'active' | 'abandoned'>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({
    totalValue: 0,
    activeCount: 0,
    abandonedCount: 0,
    syncRequired: 0
  });
  const LIMIT = 50;

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent && orders.length === 0) setLoading(true);
    try {
      const offset = (page - 1) * LIMIT;
      let url = `/api/admin/mobile-orders?limit=${LIMIT}&offset=${offset}&search=${search}`;
      if (tab !== 'all') {
        url += `&${tab === 'abandoned' ? 'abandoned=true' : 'active=true'}`;
      }
      
      const data = await cachedAdminFetch<any>(url, {
        skipCache: silent,
        ttlMs: 30_000,
      });
      
      if (data.success) {
        setOrders(data.orders);
        setTotal(data.total);
        
        // Calculate some basic stats from current page for immediate feedback
        // In a real app, we might fetch these from a separate stats endpoint
        const totalValue = data.orders.reduce((acc: number, o: any) => acc + (o.totalPrice || 0), 0);
        const syncRequired = data.orders.filter((o: any) => o.status === 'open' && !/^\d+$/.test(o.shopifyOrderId)).length;
        
        setStats({
          totalValue: data.totalStats?.revenue || totalValue,
          activeCount: data.totalStats?.active || data.total,
          abandonedCount: data.totalStats?.abandoned || 0,
          syncRequired: data.totalStats?.syncRequired || syncRequired
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tab, search, page]);

  useEffect(() => {
    setPage(1);
  }, [tab, search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchOrders();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchOrders]);

  return (
    <div className="max-w-[1400px] mx-auto space-y-12 pb-32 pt-10 px-6">
      {/* Dynamic Background Elements */}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-500/5 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* Hero Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12">
        <div className="space-y-6">
          <div className="flex items-center gap-4">
             <motion.div 
               initial={{ scale: 0.8, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               className="w-16 h-16 rounded-[22px] island-blur flex items-center justify-center shadow-2xl"
             >
               <Smartphone className="w-8 h-8 text-foreground/40" strokeWidth={1.5} />
             </motion.div>
             <div>
               <motion.span 
                 initial={{ opacity: 0, x: -10 }}
                 animate={{ opacity: 1, x: 0 }}
                 className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500/60 mb-1 block"
               >
                 Mobile Ecosystem v2.0
               </motion.span>
               <h1 className="text-5xl lg:text-6xl font-black tracking-tighter text-foreground uppercase italic">
                 App Manifest
               </h1>
             </div>
          </div>
          <p className="text-[15px] text-foreground/40 max-w-xl font-medium leading-relaxed">
            Real-time synchronization of transactions originating from the native iOS and Android clients. High-fidelity signals only.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="island-blur p-1.5 rounded-[20px] flex items-center gap-1">
            {[
              { id: 'all', label: 'All Signal' },
              { id: 'active', label: 'Active' },
              { id: 'abandoned', label: 'Abandoned' }
            ].map((t) => (
              <button 
                key={t.id}
                onClick={() => setTab(t.id as any)}
                className={`px-8 py-3 rounded-[14px] text-[11px] font-black uppercase tracking-widest transition-all duration-500 ${tab === t.id ? 'bg-foreground text-background shadow-2xl scale-[1.02]' : 'text-foreground/30 hover:text-foreground/60 hover:bg-foreground/5'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          
          <button 
            onClick={() => fetchOrders()} 
            className="w-14 h-14 island-blur rounded-[20px] flex items-center justify-center hover:bg-foreground hover:text-background transition-all group active:scale-90"
          >
            <RefreshCw className={`w-5 h-5 transition-transform duration-700 ${loading ? "animate-spin" : "group-hover:rotate-180"}`} />
          </button>
        </div>
      </div>

      {/* System Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: "Market Volume", value: `₹${stats.totalValue.toLocaleString()}`, icon: Zap, color: "text-blue-500" },
          { label: "Active Flow", value: stats.activeCount, icon: Activity, color: "text-emerald-500" },
          { label: "Sync Required", value: stats.syncRequired, icon: ShieldCheck, color: "text-purple-500" },
          { label: "System Health", value: "98.4%", icon: ShieldCheck, color: "text-blue-400" },
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="glass-card p-6 rounded-[32px] border-transparent hover:border-foreground/10 transition-all group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-2xl bg-foreground/5 group-hover:scale-110 transition-transform`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} strokeWidth={2} />
              </div>
              <ArrowUpRight className="w-4 h-4 text-foreground/10 group-hover:text-foreground/30 transition-colors" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 mb-1">{stat.label}</p>
            <p className="text-2xl font-black text-foreground tracking-tighter italic">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Control Center */}
      <div className="glass p-8 rounded-[40px] space-y-8 shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex-1 relative group">
            <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/10 group-focus-within:text-foreground/40 transition-colors" />
            <input
              type="text"
              placeholder="Search by ID, customer, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-foreground/[0.03] border border-foreground/5 focus:border-foreground/20 rounded-2xl pl-14 pr-8 py-4 text-[13px] text-foreground placeholder:text-foreground/10 outline-none transition-all font-medium"
            />
          </div>
          <div className="flex items-center gap-4 px-6 py-4 rounded-2xl bg-foreground/[0.03] border border-foreground/5">
             <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_12px_rgba(59,130,246,0.8)]" />
             <span className="text-[11px] font-black text-foreground/40 uppercase tracking-[0.3em]">{total} Live Records</span>
          </div>
        </div>

        {/* Manifest List */}
        <div className="space-y-3">
          <div className="grid grid-cols-12 gap-6 px-10 py-4 text-[10px] font-black text-foreground/20 uppercase tracking-[0.4em]">
            <div className="col-span-3">Entity / Identification</div>
            <div className="col-span-3">Identity Profile</div>
            <div className="col-span-2">Settlement</div>
            <div className="col-span-2">Logistics</div>
            <div className="col-span-2 text-right">Market Value</div>
          </div>

          <AnimatePresence mode="popLayout">
            {loading ? (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                className="py-48 flex flex-col items-center justify-center space-y-8"
              >
                <div className="relative">
                  <div className="w-20 h-20 rounded-full border-2 border-foreground/5 border-t-foreground/20 animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Zap className="w-6 h-6 text-foreground/10 animate-pulse" />
                  </div>
                </div>
                <p className="text-[10px] font-black uppercase tracking-[0.6em] text-foreground/10">Reading Encrypted Node...</p>
              </motion.div>
            ) : orders.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }} 
                animate={{ opacity: 1, scale: 1 }} 
                className="py-48 flex flex-col items-center justify-center space-y-8 border-2 border-dashed border-foreground/5 rounded-[40px] bg-foreground/[0.01]"
              >
                <div className="w-24 h-24 rounded-[32px] island-blur flex items-center justify-center border border-foreground/5">
                  <ShieldCheck className="w-10 h-10 text-foreground/5" />
                </div>
                <div className="text-center space-y-3">
                  <p className="text-[16px] font-black uppercase tracking-[0.3em] text-foreground/40">Zero Signals Detected</p>
                  <p className="text-[12px] text-foreground/15 max-w-[320px] mx-auto font-bold leading-relaxed">No mobile transactions currently match your filter criteria. Refresh to re-scan the ecosystem.</p>
                </div>
              </motion.div>
            ) : (
              orders.map((order, i) => {
                const isShopifySynced = /^\d+$/.test(order.shopifyOrderId || '');
                const displayStatus = order.status === 'open' && !isShopifySynced ? 'awaiting_approval' : order.status;
                
                return (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.015, type: 'spring', damping: 20 }}
                    className="group"
                  >
                    <div className="flex items-center gap-4">
                      <Link 
                        href={`/dashboard/orders/${order.id}`}
                        className="flex-1 grid grid-cols-12 gap-6 items-center px-8 py-4 rounded-[24px] glass-card border-transparent group-hover:border-foreground/10 transition-all duration-500 relative overflow-hidden"
                      >
                        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                        
                        <div className="col-span-3 flex items-center gap-5">
                          <div className="w-10 h-10 rounded-xl bg-foreground/5 flex items-center justify-center border border-foreground/5 group-hover:bg-foreground/10 group-hover:scale-105 transition-all duration-500">
                            <Smartphone className="w-4 h-4 text-foreground/40 group-hover:text-foreground/70" strokeWidth={1.5} />
                          </div>
                          <div>
                            <div className="flex items-center gap-3 mb-0.5">
                              <span className="text-[15px] font-black text-foreground tracking-tighter italic">
                                {order.orderNumber.startsWith('ZB') ? order.orderNumber : `#${order.orderNumber.replace('#', '')}`}
                              </span>
                              {isShopifySynced && (
                                <div className="px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[7px] font-black text-emerald-500 uppercase">Synced</div>
                              )}
                            </div>
                            <p className="text-[9px] text-foreground/30 font-black uppercase tracking-[0.2em] flex items-center gap-1.5">
                              <Clock className="w-3 h-3" />
                              {new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                            </p>
                          </div>
                        </div>

                        <div className="col-span-3">
                          <p className="text-[13px] font-black text-foreground/80 tracking-tight mb-0.5 uppercase italic">{order.customer?.name || "Guest Entity"}</p>
                          <p className="text-[9px] text-foreground/20 font-bold truncate max-w-[180px] tracking-widest">{order.customer?.email}</p>
                        </div>

                        <div className="col-span-2">
                          <StatusBadge status={order.paymentStatus} />
                        </div>

                        <div className="col-span-2">
                          <StatusBadge status={order.status === 'cancelled' ? 'cancelled' : (order.deliveryStatus || 'pending')} />
                        </div>

                        <div className="col-span-2 text-right flex items-center justify-end gap-4">
                           <div className="text-right">
                              <p className="text-[16px] font-black text-foreground tracking-tighter leading-none mb-1 italic">
                                ₹{order.totalPrice.toLocaleString("en-IN")}
                              </p>
                           </div>
                           <div className="w-8 h-8 rounded-xl bg-foreground/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all border border-foreground/10 translate-x-2 group-hover:translate-x-0 group-hover:bg-foreground group-hover:text-background">
                              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
                           </div>
                        </div>
                      </Link>

                      {displayStatus === 'awaiting_approval' && tab !== 'abandoned' && (
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={async (e) => {
                            e.preventDefault();
                            const confirmSync = confirm("Approve and Synchronize this order to Shopify?");
                            if (confirmSync) {
                              try {
                                const res = await fetch(`/api/admin/mobile-orders/${order.id}/approve`, { method: 'POST' });
                                const data = await res.json();
                                if (data.success) {
                                  alert("Order synchronized successfully!");
                                  fetchOrders();
                                } else {
                                  alert("Sync failed: " + data.error);
                                }
                              } catch (err) {
                                alert("Sync error");
                              }
                            }
                          }}
                          className="px-6 py-4 bg-foreground text-background rounded-[24px] text-[9px] font-black uppercase tracking-[0.2em] hover:opacity-90 transition-all mr-4 flex flex-col items-center justify-center gap-2 shadow-2xl shadow-foreground/20"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          Approve
                        </motion.button>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>

        {/* Pagination Console */}
        {total > LIMIT && (
          <div className="flex flex-col md:flex-row items-center justify-between gap-8 pt-10 border-t border-foreground/5">
            <div className="flex items-center gap-6">
              <div className="w-12 h-12 rounded-2xl bg-foreground/5 flex items-center justify-center border border-foreground/5">
                <Box className="w-5 h-5 text-foreground/20" />
              </div>
              <p className="text-[11px] font-black text-foreground/20 uppercase tracking-[0.3em]">
                Displaying Node <span className="text-foreground/50">{(page - 1) * LIMIT + 1}</span> — <span className="text-foreground/50">{Math.min(page * LIMIT, total)}</span> of <span className="text-foreground/50">{total}</span> System Signals
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="px-10 py-4 bg-foreground/5 hover:bg-foreground hover:text-background disabled:opacity-20 border border-foreground/5 rounded-[20px] text-[11px] font-black uppercase tracking-[0.2em] text-foreground transition-all duration-500"
              >
                Prev Node
              </button>
              <div className="w-14 h-14 rounded-[20px] bg-foreground text-background flex items-center justify-center text-[13px] font-black italic shadow-2xl shadow-foreground/20">
                {page}
              </div>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page * LIMIT >= total || loading}
                className="px-10 py-4 bg-foreground/5 hover:bg-foreground hover:text-background disabled:opacity-20 border border-foreground/5 rounded-[20px] text-[11px] font-black uppercase tracking-[0.2em] text-foreground transition-all duration-500 flex items-center gap-3"
              >
                Next Node
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = status.toLowerCase().replace(/[_-]/g, ' ');
  const theme = STATUS_THEME[normalizedStatus] || STATUS_THEME[status.toLowerCase()] || { 
    label: status.replace(/[_-]/g, ' '), 
    color: "text-foreground/40", 
    bg: "bg-foreground/5", 
    dot: "bg-foreground/20" 
  };

  return (
    <motion.div 
      whileHover={{ scale: 1.05 }}
      className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-xl border border-foreground/5 ${theme.bg} shadow-sm backdrop-blur-md`}
    >
      <div className={`w-1 h-1 rounded-full ${theme.dot} shadow-[0_0_8px_currentColor]`} />
      <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${theme.color}`}>
        {theme.label}
      </span>
    </motion.div>
  );
}

const Box = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
    <path d="m3.3 7 8.7 5 8.7-5"/>
    <path d="M12 22V12"/>
  </svg>
);
