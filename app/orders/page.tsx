"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Package, 
  Truck, 
  ChevronRight, 
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  RotateCcw,
  ArrowLeftRight,
  Sparkles,
  Calendar,
  Star
} from "lucide-react";
import Link from "next/link";
import { formatPriceString } from "@/lib/global-pricing-client";
import { useRouter, useSearchParams } from "next/navigation";
import OrderReviewModal from "@/components/reviews/OrderReviewModal";

export default function OrdersPage() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'all';

  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [activeReviewOrder, setActiveReviewOrder] = useState<any | null>(null);
  const [activeReviewItems, setActiveReviewItems] = useState<any[]>([]);
  const router = useRouter();

  const handleOpenReviewModal = async (order: any) => {
    setActiveReviewOrder(order);
    try {
      const res = await fetch(`/api/orders/${order.id}/reviewable`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.items) {
          setActiveReviewItems(data.items);
          return;
        }
      }
    } catch (e) {
      console.error("Error loading order review items", e);
    }
    setActiveReviewItems(
      (order.items || []).map((i: any) => ({
        id: i.id,
        productId: i.productId || i.id,
        title: i.title,
        image: i.image,
        reviewed: false,
      }))
    );
  };

  useEffect(() => {
    if (status === "unauthenticated" && !loading) {
      router.push("/login?callbackUrl=/orders");
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
        router.push("/login?callbackUrl=/orders");
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setOrders(data.orders || []);
      }
    } catch (e) {
      console.error("Error fetching orders", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const getEligibilityInfo = (order: any) => {
    const ds = (order?.deliveryStatus || '').toLowerCase();
    const s = (order?.status || '').toLowerCase();
    const isDelivered = ds === 'delivered' || s === 'delivered';

    const isTerminal = (st: string) =>
      ['cancelled', 'rejected', 'refunded', 'completed', 'new_order_created'].includes(String(st || '').toLowerCase());
    const activeReturn = order.returnRequests?.find(
      (r: any) => !isTerminal(r.status) && !String(r.reason || '').includes('EXCHANGE_RETURN')
    );
    const activeExchange = order.exchangeRequests?.find((e: any) => !isTerminal(e.status));
    const hasActiveRequest = !!(activeReturn || activeExchange);

    if (!isDelivered) {
      return { isDelivered: false, isEligible: false, remainingDays: 0, hasActiveRequest, activeReturn, activeExchange };
    }

    const timelineArr = Array.isArray(order?.statusTimeline) ? order.statusTimeline : [];
    const deliveredEntry = timelineArr.find((t: any) => t.step === 'delivered');
    const deliveredAt = order?.deliveredAt || deliveredEntry?.completedAt || order?.updatedAt || order?.createdAt;
    const diffDays = Math.floor((Date.now() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24));

    const isWithin15Days = diffDays <= 15;
    const isEligible = isWithin15Days && !hasActiveRequest;
    const remainingDays = Math.max(0, 15 - diffDays);

    return { 
      isDelivered: true, 
      isEligible, 
      remainingDays, 
      hasActiveRequest, 
      activeReturn, 
      activeExchange 
    };
  };

  const eligibleOrders = useMemo(() => {
    return orders.filter(o => getEligibilityInfo(o).isEligible);
  }, [orders]);

  const activeRequestOrders = useMemo(() => {
    return orders.filter(o => getEligibilityInfo(o).hasActiveRequest);
  }, [orders]);

  const displayedOrders = useMemo(() => {
    if (activeTab === 'eligible') return eligibleOrders;
    if (activeTab === 'returns' || activeTab === 'exchanges') return activeRequestOrders;
    return orders;
  }, [activeTab, orders, eligibleOrders, activeRequestOrders]);

  const getStatusConfig = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s.includes('cancel')) return { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/20', label: 'Cancelled' };
    if (s === 'delivered') return { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'Delivered' };
    if (s === 'shipped' || s === 'out_for_delivery') return { icon: Truck, color: 'text-purple-500', bg: 'bg-purple-500/10 border-purple-500/20', label: 'Shipped' };
    if (s.includes('return') || s.includes('exchange')) return { icon: RotateCcw, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', label: 'Return/Exchange' };
    if (s === 'processing' || s === 'confirmed') return { icon: Clock, color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Processing' };
    return { icon: Clock, color: 'text-foreground/50', bg: 'bg-foreground/5 border-foreground/10', label: status || 'Pending' };
  };

  return (
    <div className="min-h-screen bg-background text-foreground relative">
      <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-32">
        {/* Page Title & Sync */}
        <div className="mb-6">
          <p className="text-[7px] font-black uppercase tracking-[0.55em] text-foreground/30 mb-0.5 ml-0.5">Your Account</p>
          <div className="flex items-center justify-between">
            <h1 className="font-heading text-[15px] uppercase tracking-widest text-foreground flex items-center gap-2">
              Order History
            </h1>
            <button 
              onClick={() => fetchOrders(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-button text-[8px] font-bold uppercase tracking-wider disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              Sync Status
            </button>
          </div>
        </div>

        {/* Dedicated Returns & Exchanges Navigation Banner */}
        <div className="mb-8 p-5 rounded-3xl glass-panel border border-amber-500/20 bg-amber-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-500 shrink-0">
              <RotateCcw className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">Need to Return or Exchange an Item?</p>
              <p className="text-[9px] text-foreground/60 mt-0.5">View 15-day eligibility window and track active request statuses in the Returns & Exchanges portal.</p>
            </div>
          </div>
          <Link href="/returns" className="shrink-0 px-4 py-2.5 rounded-xl glass-cta text-[8px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5">
            Returns & Exchanges Portal <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Orders List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-4">
            <Loader2 className="w-5 h-5 animate-spin text-foreground/20" />
            <p className="text-[7px] text-foreground/25 font-black uppercase tracking-[0.3em]">Loading Orders</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-6 text-center animate-in fade-in duration-700">
            <div className="w-16 h-16 bg-foreground/[0.02] rounded-[2rem] flex items-center justify-center border border-foreground/5">
              <Package className="w-6 h-6 text-foreground/20" />
            </div>
            <div className="space-y-1">
              <h2 className="text-[11px] font-heading uppercase tracking-widest text-foreground/60">
                No Orders Found
              </h2>
              <p className="text-[9px] text-foreground/30 font-medium">
                Your order history will appear here once you make a purchase.
              </p>
            </div>
            <Link href="/collections" className="glass-cta px-8 py-3 text-[9px]">
              Explore Collection
            </Link>
          </div>
        ) : (
          <div className="space-y-4 max-w-4xl mx-auto">
            {orders.map((order, idx) => {
              // Order cancel only — ignore shipment/fulfillment void (was painting delivered RMAs as CANCELLED)
              const statusLower = String(order.status || '').toLowerCase();
              const isCancelled =
                Boolean(order.cancelledBy) ||
                statusLower === 'cancelled' ||
                statusLower === 'canceled';
              const statusKey = isCancelled
                ? 'cancelled'
                : (order.deliveryStatus || order.status || 'pending');
              const statusConfig = getStatusConfig(statusKey);
              const statusLabel =
                isCancelled && String(order.cancelledBy || '').toLowerCase() === 'admin'
                  ? 'Cancelled by Zica Bella'
                  : statusConfig.label;
              const StatusIcon = statusConfig.icon;
              const orderItems = order.items || [];
              const awbNumber =
                order.shipments?.[0]?.awb || order.delhivery_awb || null;

              return (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  onClick={() => router.push(`/orders/${order.id}`)}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push(`/orders/${order.id}`);
                    }
                  }}
                  className="group relative rounded-3xl p-5 transition-all duration-500 overflow-hidden glass-panel hover:translate-y-[-1px] shadow-xl border border-foreground/5 cursor-pointer"
                >
                  {/* Header Info */}
                  <div className="flex justify-between items-start mb-4">
                    <div className="space-y-0.5">
                      <p className="text-[8px] font-black uppercase tracking-[0.15em] text-foreground/40 flex items-center gap-1.5 font-mono">
                        <Clock className="w-2.5 h-2.5 opacity-30" />
                        {order.orderNumber 
                          ? (order.orderNumber.startsWith('#') ? order.orderNumber : `#${order.orderNumber}`)
                          : (order.shopifyOrderId && !order.shopifyOrderId.startsWith('app_pending_') 
                              ? (order.shopifyOrderId.startsWith('#') ? order.shopifyOrderId : `#${order.shopifyOrderId}`)
                              : `#ZB${order.id.slice(-6).toUpperCase()}`)}
                      </p>
                      <p className="text-[9px] text-foreground/30 font-bold">
                        {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[7px] font-black uppercase tracking-widest ${statusConfig.bg}`}>
                        <StatusIcon className={`w-3.5 h-3.5 ${statusConfig.color}`} />
                        <span className={statusConfig.color}>{statusLabel}</span>
                      </div>
                    </div>
                  </div>

                  {/* Main Content */}
                  <div className="flex items-center gap-4 mb-2">
                    <div className="flex -space-x-3.5 shrink-0">
                      {orderItems.slice(0, 3).map((item: any, i: number) => {
                        const imageSrc = item.image || item.product?.featuredImage || (item.product?.images?.[0] as any)?.src || (item.product?.images?.[0] as any) || "";
                        return (
                          <div key={i} className="h-12 w-12 rounded-xl ring-2 ring-background bg-foreground/[0.02] flex items-center justify-center overflow-hidden border border-foreground/10 shadow-sm relative group-hover:scale-105 transition-transform">
                            {imageSrc ? (
                              <img src={imageSrc} alt="" className="object-cover w-full h-full opacity-90" />
                            ) : (
                              <span className="text-[10px] font-black text-foreground/20">{(item.title || 'ZB')[0]}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold truncate tracking-tight text-foreground/90 leading-snug">
                        {orderItems[0]?.title || 'Order Items'}
                      </p>
                      <p className="text-[8px] text-foreground/40 font-medium mt-0.5 uppercase tracking-widest">
                        {orderItems.length > 1 ? `+ ${orderItems.length - 1} more items` : `1 item`}
                      </p>
                    </div>
                    <div className="text-right shrink-0 flex flex-col items-end gap-1">
                      <p className="text-[12px] font-inter font-bold tracking-tight text-foreground">{formatPriceString(Number(order.totalPrice), order.currency || "INR", "en-US")}</p>
                      
                      <div className="flex items-center gap-2">
                        {((order.deliveryStatus || order.status || '').toLowerCase() === 'delivered') && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleOpenReviewModal(order);
                            }}
                            className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-amber-400 hover:text-amber-300 transition-colors bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20"
                          >
                            <Star className="w-2.5 h-2.5 fill-amber-400" />
                            <span>Review</span>
                          </button>
                        )}

                        <span className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-foreground/40 group-hover:text-foreground transition-colors">
                          Details <ChevronRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* AWB Tracking Information Bar */}
                  {awbNumber && (
                    <div className="mt-3 pt-3 border-t border-foreground/5 flex items-center justify-between text-[8px]">
                      <span className="text-foreground/50 font-mono flex items-center gap-1.5">
                        <Truck className="w-3 h-3 text-purple-400" />
                        AWB: {awbNumber}
                      </span>
                      <button 
                        onClick={(e) => { 
                          e.preventDefault(); 
                          e.stopPropagation(); 
                          const trackingUrl = order.shipments?.[0]?.trackingUrl || `https://www.shiprocket.in/shipment-tracking/?awb=${awbNumber}`;
                          window.open(trackingUrl, '_blank'); 
                        }}
                        className="relative z-10 px-3 py-1 rounded-lg glass-button font-bold uppercase tracking-widest text-foreground/75 hover:text-foreground"
                      >
                        Track Shipment
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </main>

      {/* Review Modal */}
      <OrderReviewModal
        isOpen={!!activeReviewOrder}
        onClose={() => setActiveReviewOrder(null)}
        orderId={activeReviewOrder?.id || ""}
        orderNumber={activeReviewOrder?.orderNumber || activeReviewOrder?.shopifyOrderId || (activeReviewOrder ? `#${activeReviewOrder.id.slice(-6).toUpperCase()}` : "")}
        items={activeReviewItems}
        onReviewSubmitted={() => fetchOrders(true)}
      />
    </div>
  );
}
