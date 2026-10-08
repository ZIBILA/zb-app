"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { 
  RotateCcw, 
  ArrowLeftRight, 
  Calendar, 
  Sparkles, 
  Loader2, 
  RefreshCw, 
  ChevronRight, 
  Package
} from "lucide-react";
import Link from "next/link";
import RequestStatusCard from "@/components/RequestStatusCard";
import { useRouter } from "next/navigation";

export default function ReturnsExchangesPage() {
  const { data: session, status } = useSession();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'eligible' | 'active'>('all');
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated" && !loading) {
      router.push("/login?callbackUrl=/returns");
    }
  }, [status, loading, router]);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch("/api/orders");
      if (res.status === 401) {
        router.push("/login?callbackUrl=/returns");
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setOrders(data.orders || []);
      }
    } catch (e) {
      console.error("Error fetching orders for returns", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    if (!confirm("Are you sure you want to cancel this request?")) return;
    setCancellingId(requestId);
    try {
      const res = await fetch("/api/returns/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnRequestId: requestId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel request");
      await fetchOrders();
    } catch (e: any) {
      alert(e.message || "Error cancelling request");
    } finally {
      setCancellingId(null);
    }
  };

  // Compute lists
  const eligibleOrders = useMemo(() => {
    return orders.filter(o => o.isEligible);
  }, [orders]);

  const activeRequestOrders = useMemo(() => {
    return orders.filter(o => o.hasActiveRequest || (o.userReturnRequests && o.userReturnRequests.length > 0) || (o.userExchangeRequests && o.userExchangeRequests.length > 0));
  }, [orders]);

  const displayedOrders = useMemo(() => {
    if (activeTab === 'eligible') return eligibleOrders;
    if (activeTab === 'active') return activeRequestOrders;
    return orders.filter(o => o.isDelivered || o.hasActiveRequest);
  }, [activeTab, orders, eligibleOrders, activeRequestOrders]);

  return (
    <div className="min-h-screen bg-background text-foreground relative">
      <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-32">
        
        {/* Title Header */}
        <div className="mb-6">
          <p className="text-[7px] font-black uppercase tracking-[0.55em] text-foreground/30 mb-1 ml-0.5">Customer Support</p>
          <div className="flex items-center justify-between">
            <h1 className="font-heading text-xl uppercase tracking-widest text-foreground flex items-center gap-3">
              <RotateCcw className="w-5 h-5 text-amber-500" />
              Returns & Exchanges
            </h1>
            <button 
              onClick={() => fetchOrders(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full glass-button text-[8px] font-bold uppercase tracking-wider disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              Sync Status
            </button>
          </div>
        </div>

        {/* Policy Notice Card */}
        <div className="mb-8 p-5 rounded-3xl glass-panel border border-foreground/10 bg-foreground/[0.01] flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[12px] font-bold uppercase tracking-wider text-foreground">15-Day Return & Exchange Policy</p>
              <p className="text-[10px] text-foreground/60 mt-1 leading-relaxed">
                Orders are eligible for return or exchange within 15 days from delivery date. 
                Approving one request automatically cancels any conflicting draft requests to ensure seamless processing.
              </p>
            </div>
          </div>
          <Link href="/faq" className="shrink-0 px-4 py-2 rounded-xl glass-button text-[9px] font-bold uppercase tracking-wider text-center">
            Read Policy Guidelines
          </Link>
        </div>

        {/* Tab Selection Filter */}
        <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2 scrollbar-none">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === 'all'
                ? 'bg-foreground text-background shadow-lg'
                : 'glass-button text-foreground/60 hover:text-foreground'
            }`}
          >
            Delivered Orders ({orders.filter(o => o.isDelivered).length})
          </button>

          <button
            onClick={() => setActiveTab('eligible')}
            className={`px-4 py-2 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'eligible'
                ? 'bg-foreground text-background shadow-lg'
                : 'glass-button text-foreground/60 hover:text-foreground'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Eligible for Action ({eligibleOrders.length})
          </button>

          <button
            onClick={() => setActiveTab('active')}
            className={`px-4 py-2 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'active'
                ? 'bg-foreground text-background shadow-lg'
                : 'glass-button text-foreground/60 hover:text-foreground'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Request History ({activeRequestOrders.length})
          </button>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-4">
            <Loader2 className="w-6 h-6 animate-spin text-foreground/30" />
            <p className="text-[8px] text-foreground/30 font-black uppercase tracking-[0.3em]">Checking Return Eligibility</p>
          </div>
        ) : displayedOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-5 text-center">
            <div className="w-16 h-16 bg-foreground/[0.03] rounded-3xl flex items-center justify-center border border-foreground/5">
              <Package className="w-6 h-6 text-foreground/30" />
            </div>
            <div className="space-y-1">
              <h2 className="text-[12px] font-heading uppercase tracking-widest text-foreground">
                {activeTab === 'eligible' ? 'No Orders Eligible for Return or Exchange' : 'No Return or Exchange Requests Found'}
              </h2>
              <p className="text-[9.5px] text-foreground/40 max-w-sm mx-auto font-medium">
                {activeTab === 'eligible' ? 'Only orders delivered within the last 15 days without active requests are eligible.' : 'Your submitted return or exchange requests will appear here.'}
              </p>
            </div>
            <Link href="/orders" className="glass-cta px-6 py-2.5 text-[9px]">
              View All Orders
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {displayedOrders.map((order, idx) => {
              const orderItems = order.items || [];
              const activeRet = order.activeReturn;
              const activeEx = order.activeExchange;

              return (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="rounded-3xl p-6 glass-panel border border-foreground/10 space-y-5 relative overflow-hidden shadow-xl"
                >
                  {/* Order Header info */}
                  <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-foreground/5">
                    <div>
                      <p className="text-[8px] font-mono font-bold uppercase tracking-wider text-foreground/40">
                        Order {order.orderNumber}
                      </p>
                      <p className="text-[9px] text-foreground/40 mt-0.5 font-medium">
                        Placed on {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest ${
                        order.isDelivered ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-foreground/5 text-foreground/50'
                      }`}>
                        {order.isDelivered ? 'Delivered' : order.deliveryStatus || 'Pending Delivery'}
                      </span>
                      <Link href={`/orders/${order.id}`} className="px-3 py-1 rounded-full glass-button text-[8px] font-bold uppercase tracking-wider flex items-center gap-1">
                        Order Details <ChevronRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>

                  {/* Order Products Preview */}
                  <div className="flex items-center gap-4">
                    <div className="flex -space-x-3 shrink-0">
                      {orderItems.slice(0, 3).map((item: any, i: number) => {
                        const img = item.image || item.product?.featuredImage || "";
                        return (
                          <div key={i} className="h-12 w-12 rounded-xl ring-2 ring-background bg-foreground/[0.02] flex items-center justify-center overflow-hidden border border-foreground/10 relative">
                            {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] font-bold">ZB</span>}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-foreground truncate">{orderItems[0]?.title || 'Items'}</p>
                      <p className="text-[8px] text-foreground/40 uppercase tracking-widest mt-0.5">{orderItems.length > 1 ? `+ ${orderItems.length - 1} more items` : `1 item`}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[12px] font-bold font-inter text-foreground">₹{order.totalPrice?.toLocaleString('en-IN')}</p>
                    </div>
                  </div>

                  {/* RETURN / EXCHANGE REQUESTS (ids, pickup, refund — same data as admin) */}
                  {(order.userReturnRequests || [])
                    .filter((r: any) => r.status !== 'cancelled' && r.summary)
                    .map((r: any) => (
                      <RequestStatusCard
                        key={r.id}
                        summary={r.summary}
                        action={
                          r.status === 'pending_approval' ? (
                            <button
                              onClick={() => handleCancelRequest(r.id)}
                              disabled={cancellingId === r.id}
                              className="px-3 py-1 rounded-lg text-[8px] font-bold uppercase tracking-wider text-red-500 hover:bg-red-500/10 border border-red-500/20 transition-colors"
                            >
                              {cancellingId === r.id ? "Cancelling..." : "Cancel Request"}
                            </button>
                          ) : null
                        }
                      >
                        <p>Requested on: {new Date(r.createdAt).toLocaleDateString('en-IN')}</p>
                        {r.reason && <p className="text-foreground/50">Reason: {r.reason}</p>}
                      </RequestStatusCard>
                    ))}
                  {(order.userExchangeRequests || [])
                    .filter((e: any) => e.status !== 'cancelled' && e.summary)
                    .map((e: any) => (
                      <RequestStatusCard
                        key={e.id}
                        summary={e.summary}
                        action={
                          e.status === 'pending_approval' ? (
                            <button
                              onClick={() => handleCancelRequest(e.id)}
                              disabled={cancellingId === e.id}
                              className="px-3 py-1 rounded-lg text-[8px] font-bold uppercase tracking-wider text-red-500 hover:bg-red-500/10 border border-red-500/20 transition-colors"
                            >
                              {cancellingId === e.id ? "Cancelling..." : "Cancel Request"}
                            </button>
                          ) : null
                        }
                      >
                        <p>Requested on: {new Date(e.createdAt).toLocaleDateString('en-IN')}</p>
                        <p>Price Difference: <span className="font-bold text-foreground">₹{e.priceDifference?.toLocaleString('en-IN')}</span> ({String(e.paymentStatus || '').replace(/_/g, ' ')})</p>
                        {e.reason && <p className="text-foreground/50">Reason: {e.reason}</p>}
                      </RequestStatusCard>
                    ))}

                  {/* ELIGIBLE ACTIONS */}
                  {order.isEligible && (
                    <div className="pt-3 border-t border-foreground/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 text-[9.5px] font-bold text-emerald-500">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Eligible for Return or Exchange ({order.remainingDays} days left in 15-day window)</span>
                      </div>

                      <div className="flex gap-2">
                        <Link
                          href={`/orders/${order.id}/return`}
                          className="px-4 py-2 rounded-xl glass-button text-[8px] font-bold uppercase tracking-wider flex items-center gap-1.5"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Return Item
                        </Link>
                        <Link
                          href={`/orders/${order.id}/exchange`}
                          className="px-4 py-2 rounded-xl glass-cta text-[8px] font-bold uppercase tracking-wider flex items-center gap-1.5"
                        >
                          <ArrowLeftRight className="w-3 h-3" />
                          Exchange Item
                        </Link>
                      </div>
                    </div>
                  )}

                  {/* NOT ELIGIBLE EXPLANATION */}
                  {!order.isEligible && !order.hasActiveRequest && order.isDelivered && (
                    <div className="pt-2 text-[8.5px] text-foreground/40 italic">
                      This order is past the 15-day return/exchange window.
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
