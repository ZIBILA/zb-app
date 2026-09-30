"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Package, 
  Truck, 
  ChevronLeft, 
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  MapPin,
  CreditCard,
  ShoppingBag,
  ExternalLink,
  RefreshCw,
  Box,
  Home,
  RotateCcw,
  ArrowLeftRight,
  X,
  Star
} from "lucide-react";
import Link from "next/link";
import { formatPriceString } from "@/lib/global-pricing-client";
import { useParams, useRouter } from "next/navigation";
import OrderReviewModal from "@/components/reviews/OrderReviewModal";

const STEPS = [
  { id: "order_placed",   label: "Order Placed",   icon: CheckCircle2 },
  { id: "confirmed",      label: "Confirmed",      icon: Clock },
  { id: "shipped",        label: "Shipped",        icon: Package },
  { id: "in_transit",     label: "In Transit",     icon: Truck },
  { id: "out_for_delivery", label: "Out for Delivery", icon: Box },
  { id: "delivered",      label: "Delivered",      icon: Home },
];

const RETURN_STEPS = [
  { id: "order_placed",      label: "Order Placed",            icon: CheckCircle2 },
  { id: "delivered",          label: "Delivered",               icon: Home },
  { id: "return_requested",   label: "Return/Exchange Requested", icon: RotateCcw },
  { id: "pickup_approved",    label: "Pickup Manifested",       icon: Truck },
  { id: "refund_completed",   label: "Refund/Exchange Completed", icon: CheckCircle2 },
];

export default function OrderDetailsPage() {
  const { id } = useParams();
  const { data: session, status } = useSession();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewableItems, setReviewableItems] = useState<any[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();

  const fetchReviewableItems = async () => {
    try {
      const res = await fetch(`/api/orders/${id}/reviewable`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.items) {
          setReviewableItems(data.items);
        }
      }
    } catch (err) {
      console.error("Error fetching reviewable items:", err);
    }
  };

  useEffect(() => {
    if (order && (order.deliveryStatus || "").toLowerCase() === "delivered") {
      fetchReviewableItems();
    }
  }, [order]);

  useEffect(() => {
    if (status === "unauthenticated" && !loading) {
      router.push(`/login?callbackUrl=/orders/${id}`);
    }
  }, [status, loading, router, id]);

  useEffect(() => {
    fetchOrder();
  }, [id]);

  useEffect(() => {
    if (order?.orderNumber) {
      const event = new CustomEvent("update-header-order-number", { detail: order.orderNumber });
      window.dispatchEvent(event);
    }
  }, [order]);

  const fetchOrder = async () => {
    try {
      const res = await fetch(`/api/orders/${id}`);
      if (res.status === 401) {
        router.push(`/login?callbackUrl=/orders/${id}`);
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setOrder(data.order);
      }
    } catch (e) {
      console.error("Error fetching order", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    await new Promise(r => setTimeout(r, 1500));
    await fetchOrder();
    setSyncing(false);
  };

  const handleCancelOrder = async () => {
    setCancelling(true);
    try {
      const res = await fetch("/api/app/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, reason: "User cancelled from webstore" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel");
      setToast("Order cancelled successfully.");
      setShowCancelModal(false);
      fetchOrder();
    } catch (e: any) {
      setToast(e.message || "Failed to cancel order");
    } finally {
      setCancelling(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const handleCancelReturnExchange = async () => {
    const pendingReq = order.returnRequests?.find((r: any) => r.status === 'pending_approval')
      || order.exchangeRequests?.find((e: any) => e.status === 'pending_approval');
    if (!pendingReq) {
      alert("No pending return or exchange request to cancel.");
      return;
    }
    if (!confirm("Are you sure you want to cancel this return/exchange request?")) return;
    try {
      const res = await fetch("/api/returns/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnRequestId: pendingReq.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel");
      alert("Return/Exchange request cancelled.");
      fetchOrder();
    } catch (e: any) {
      alert(e.message || "Failed to cancel request");
    }
  };

  // Compute derived state
  const isCOD = useMemo(() => order?.paymentMethod === 'COD', [order]);
  const isProcessed = useMemo(() => {
    if (!order) return false;
    const s = (order.status || '').toLowerCase();
    return !['open', 'awaiting_approval', 'payment_pending'].includes(s);
  }, [order]);
  const isCancelled = useMemo(() => (order?.status || '').toLowerCase().includes('cancel'), [order]);
  const isDelivered = useMemo(() => {
    const ds = (order?.deliveryStatus || '').toLowerCase();
    const s = (order?.status || '').toLowerCase();
    return ds === 'delivered' || s === 'delivered';
  }, [order]);

  const activeReturnReq = useMemo(() => order?.returnRequests?.find((r: any) => r.status !== 'cancelled' && (!r.reason || !r.reason.includes('EXCHANGE_RETURN'))), [order]);
  const activeExchangeReq = useMemo(() => order?.exchangeRequests?.find((e: any) => e.status !== 'cancelled'), [order]);

  const hasActiveReturn = useMemo(() => !!activeReturnReq, [activeReturnReq]);
  const hasActiveExchange = useMemo(() => !!activeExchangeReq, [activeExchangeReq]);
  const hasPendingRequest = useMemo(() => {
    return order?.returnRequests?.some((r: any) => r.status === 'pending_approval' && (!r.reason || !r.reason.includes('EXCHANGE_RETURN'))) || 
           order?.exchangeRequests?.some((e: any) => e.status === 'pending_approval') || false;
  }, [order]);

  const isReturnWindowOpen = useMemo(() => {
    if (!isDelivered) return false;
    const timelineArr = Array.isArray(order?.statusTimeline) ? order.statusTimeline : [];
    const deliveredEntry = timelineArr.find((t: any) => t.step === 'delivered');
    const deliveredAt = order?.deliveredAt || deliveredEntry?.completedAt || order?.createdAt;
    if (!deliveredAt) return false;
    const diffDays = Math.ceil(Math.abs(Date.now() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 15;
  }, [order, isDelivered]);

  const isReturnFlow = useMemo(() => {
    if (!order) return false;
    const s = (order.status || '').toLowerCase();
    return s.includes('return') || s.includes('exchange') || s === 'returned' || s === 'exchanged' || hasActiveReturn || hasActiveExchange;
  }, [order, hasActiveReturn, hasActiveExchange]);

  const steps = isReturnFlow ? RETURN_STEPS : STEPS;

  const timelineByStep = useMemo(() => {
    const tl = Array.isArray(order?.statusTimeline) ? order.statusTimeline : [];
    const m = new Map<string, string | null>();
    tl.forEach((t: any) => m.set(t.step, t.completedAt || null));
    return m;
  }, [order]);

  const getCurrentStepIndex = () => {
    if (!order) return 0;
    const s = order.deliveryStatus.toLowerCase();
    if (isReturnFlow) {
      if (timelineByStep.get('refund_completed')) return 4;
      if (timelineByStep.get('pickup_approved')) return 3;
      if (timelineByStep.get('return_requested')) return 2;
      if (timelineByStep.get('delivered')) return 1;
      return 0;
    }
    switch (s) {
      case "delivered": return 5;
      case "out_for_delivery": return 4;
      case "shipped": return 3;
      case "processing": return 1;
      case "pending": return 0;
      default: return 0;
    }
  };

  const currentStepIndex = getCurrentStepIndex();

  const displayLabel = useMemo(() => {
    if (isCancelled) return "Order Cancelled";
    const s = (order?.status || '').toLowerCase();
    const ds = (order?.deliveryStatus || '').toLowerCase();
    
    if (['payment_failed', 'payment_pending', 'failed', 'pending'].includes(s) || s.includes('failed')) {
      return "Payment Failed";
    }
    if (s.includes('return') || s.includes('exchange') || s === 'returned' || s === 'exchanged' || hasActiveReturn || hasActiveExchange) {
      if (hasActiveReturn) return "Return Requested";
      if (hasActiveExchange) return "Exchange Requested";
      return "Returned/Exchanged";
    }
    if (ds === 'delivered') return "Delivered";
    if (ds === 'out_for_delivery') return "Out for Delivery";
    if (ds === 'shipped') return "Shipped / In Transit";
    if (ds === 'processing') return "Ready for Dispatch";
    return "Order Placed";
  }, [order, isCancelled, hasActiveReturn, hasActiveExchange]);

  const statusColor = useMemo(() => {
    if (isCancelled) return "#FF3B30";
    const label = displayLabel;
    if (label.includes("Failed")) return "#FF3B30";
    if (label.includes("Return") || label.includes("Exchange")) return "#FF9F0A";
    if (label === "Delivered") return "#34C759";
    if (label.includes("Shipped") || label === "Out for Delivery") return "#AF52DE";
    if (label === "Ready for Dispatch") return "#FF9500";
    return "#007AFF"; // Order Placed
  }, [displayLabel, isCancelled]);

  const canCancel = useMemo(() => {
    if (!order) return false;
    const s = (order.status || '').toLowerCase();
    const f = (order.fulfillmentStatus || '').toLowerCase();
    
    if (s.includes('cancel') || ['payment_failed', 'failed'].includes(s)) {
      return false;
    }
    if (['fulfilled', 'shipped', 'dispatched', 'delivered'].includes(f)) {
      return false;
    }
    
    return (f === 'unfulfilled' || f === 'pending' || f === '') && !isDelivered;
  }, [order, isDelivered]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 space-y-4">
        <Loader2 className="w-6 h-6 animate-spin text-foreground/20" />
        <p className="text-[8px] text-foreground/30 font-black uppercase tracking-[0.3em]">Locating Package</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center space-y-6">
        <div className="w-16 h-16 bg-foreground/5 rounded-[2rem] flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-red-500/50" />
        </div>
        <div className="space-y-1">
          <h2 className="text-[12px] font-heading uppercase tracking-widest text-foreground">Order Not Found</h2>
          <p className="text-[9px] text-foreground/50">The requested order could not be located.</p>
        </div>
        <Link href="/orders" className="glass-cta px-8 py-3 text-[9px]">
             Back to Orders
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground relative pb-safe-nav">
      <main className="relative z-10 max-w-3xl mx-auto px-5 pt-28 pb-32">
        {/* Header Navigation */}
        <div className="flex items-center justify-between mb-10">
          <Link href="/orders" className="group flex items-center gap-2 p-2 -ml-2 rounded-full hover:bg-foreground/5 transition-colors">
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            <span className="text-[9px] font-black uppercase tracking-widest text-foreground/40">Orders</span>
          </Link>
          <button 
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-button text-[8px] font-black uppercase tracking-wider disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
            <span>Sync Status</span>
          </button>
        </div>

        {/* Order Identifier */}
        <div className="mb-10 text-center">
            <p className="text-[7px] font-light uppercase tracking-[0.55em] text-foreground/30 mb-2 font-mono">Order Identifier</p>
            <h1 className="text-2xl font-heading tracking-widest uppercase text-foreground/80 mb-1">
              {order.orderNumber 
                ? (order.orderNumber.startsWith('#') ? order.orderNumber : `#${order.orderNumber}`)
                : (order.shopifyOrderId && !order.shopifyOrderId.startsWith('app_pending_') 
                    ? (order.shopifyOrderId.startsWith('#') ? order.shopifyOrderId : `#${order.shopifyOrderId}`)
                    : `#ZB${order.id.slice(-6).toUpperCase()}`)}
            </h1>
        </div>

        {/* Status Card matching Mobile App */}
        <div className="mb-10 p-5 rounded-3xl border border-foreground/5 bg-foreground/[0.01] dark:bg-foreground/[0.02] flex items-center justify-between relative overflow-hidden">
            <div className="flex-1 min-w-0">
               <p className="text-[8px] font-black uppercase tracking-[0.15em] text-foreground/30 mb-1 font-mono">Status</p>
               <h3 className="text-[15px] font-extrabold text-foreground tracking-wide leading-tight">
                  {displayLabel}
               </h3>
               <p className="text-[9px] text-foreground/40 mt-1.5 font-medium">
                  {new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at {new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
               </p>
            </div>
            <div className="w-1.5 h-12 rounded-full ml-4" style={{ backgroundColor: statusColor }} />
        </div>

        {/* LIVE STATUS BAR (STEPPER) */}
        {!isCancelled && (
          <div className="relative mb-14 px-2">
              <div className="absolute top-4 left-10 right-10 h-[2px] bg-foreground/5 z-0" />
              <motion.div 
                 className="absolute top-4 left-10 h-[2px] bg-foreground z-[1]" 
                 initial={{ width: 0 }}
                 animate={{ width: `${(currentStepIndex / (steps.length - 1)) * 80}%` }}
                 transition={{ duration: 1, ease: "circOut" }}
              />
              
              <div className="flex justify-between relative z-10">
                 {steps.map((step, i) => {
                   const isCompleted = !!timelineByStep.get(step.id);
                   const isActive = i === currentStepIndex;
                   const Icon = step.icon;

                   return (
                     <div key={step.id} className="flex flex-col items-center group">
                        <div 
                           className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500 border-2 ${
                             isCompleted 
                              ? 'bg-foreground border-foreground shadow-[0_0_15px_rgba(var(--foreground),0.2)]' 
                              : 'bg-background border-foreground/10'
                           }`}
                        >
                           <Icon className={`w-3.5 h-3.5 transition-colors duration-500 ${isCompleted ? 'text-background' : 'text-foreground/10'}`} />
                        </div>
                        <span className={`text-[6px] font-black uppercase tracking-widest mt-2 transition-colors duration-500 ${isCompleted ? 'text-foreground/60' : 'text-foreground/10'} ${isActive ? 'text-foreground/80' : ''}`}>
                           {step.label}
                        </span>
                     </div>
                   );
                 })}
              </div>
          </div>
        )}

        {/* Cancelled State */}
        {isCancelled && (
          <div className="mb-10 p-5 rounded-2xl glass-panel border-red-500/20 text-center space-y-2">
            <AlertCircle className="w-6 h-6 text-red-500 mx-auto" />
            <p className="text-[12px] font-bold text-red-500 uppercase tracking-wider">Order Cancelled</p>
          </div>
        )}

        {/* ACTIVE RETURN REQUEST CARD */}
        {activeReturnReq && (
          <div className="mb-8 p-6 rounded-3xl glass-panel border border-amber-500/20 bg-amber-500/5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-amber-500" />
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-amber-500">Return Request</h3>
              </div>
              <span className="px-3 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest bg-amber-500/10 text-amber-500 border border-amber-500/20">
                {activeReturnReq.status.replace('_', ' ')}
              </span>
            </div>
            <div className="text-[11px] space-y-1 text-foreground/70">
              <p className="font-medium">Requested on: {new Date(activeReturnReq.createdAt).toLocaleDateString('en-IN')}</p>
              <p className="font-medium">Estimated Refund: <span className="font-bold text-foreground">₹{activeReturnReq.estimatedRefund?.toLocaleString('en-IN')}</span></p>
              {activeReturnReq.reason && <p className="text-[10px] text-foreground/50">Reason: {activeReturnReq.reason}</p>}
            </div>
            {activeReturnReq.status === 'pending_approval' && (
              <p className="text-[9px] text-foreground/40 italic">Your return is under review. Our team will verify and initiate pickup shortly.</p>
            )}
          </div>
        )}

        {/* ACTIVE EXCHANGE REQUEST CARD */}
        {activeExchangeReq && (
          <div className="mb-8 p-6 rounded-3xl glass-panel border border-blue-500/20 bg-blue-500/5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-blue-500" />
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-blue-500">Exchange Request</h3>
              </div>
              <span className="px-3 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest bg-blue-500/10 text-blue-500 border border-blue-500/20">
                {activeExchangeReq.status.replace('_', ' ')}
              </span>
            </div>
            <div className="text-[11px] space-y-1 text-foreground/70">
              <p className="font-medium">Requested on: {new Date(activeExchangeReq.createdAt).toLocaleDateString('en-IN')}</p>
              <p className="font-medium">Price Difference: <span className="font-bold text-foreground">₹{activeExchangeReq.priceDifference?.toLocaleString('en-IN')}</span> ({activeExchangeReq.paymentStatus})</p>
              {activeExchangeReq.reason && <p className="text-[10px] text-foreground/50">Reason: {activeExchangeReq.reason}</p>}
            </div>
            {activeExchangeReq.status === 'pending_approval' && (
              <p className="text-[9px] text-foreground/40 italic">Your exchange is under review. Replacement item order will be processed upon approval.</p>
            )}
          </div>
        )}

        {/* SHIPMENT DETAILS CARD */}
        {(() => {
          const s = order.shipments?.[0];
          const awb = s?.trackingNumber || s?.awb || order.trackingNumber || order.delhivery_awb;
          const courier = s?.courier || order.courier || (order.delhivery_awb ? 'Delhivery' : 'Standard Express');
          const status = s?.status || order.deliveryStatus || order.fulfillmentStatus || 'Shipped';
          const trackUrl = s?.trackingUrl || order.trackingUrl || (awb ? `https://zicabella.shiprocket.co/tracking/${awb}` : null);

          if (!awb) return null;

          return (
            <div className="mb-8 p-5 rounded-3xl glass-panel overflow-hidden relative group">
              <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-foreground/0 via-foreground/10 to-foreground/0 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex items-start justify-between mb-6">
                  <div className="space-y-1">
                      <p className="text-[7px] font-black uppercase tracking-[0.3em] text-foreground/40">Live Shipment</p>
                      <h3 className="text-[12px] font-heading tracking-widest text-foreground/80 uppercase">
                          {courier}
                      </h3>
                  </div>
                  <div className="p-2 bg-foreground/10 rounded-xl">
                     <Truck className="w-4 h-4 text-foreground/60" />
                  </div>
              </div>

              <div className="grid grid-cols-2 gap-8 mb-4">
                  <div>
                     <p className="text-[6.5px] font-black uppercase tracking-widest text-foreground/15 mb-1.5 font-mono">Tracking No.</p>
                     <p className="text-[10px] font-mono text-foreground/60 font-medium uppercase">{awb}</p>
                  </div>
                  <div>
                     <p className="text-[6.5px] font-black uppercase tracking-widest text-foreground/15 mb-1.5 font-mono">Status</p>
                     <p className="text-[10px] text-foreground/60 font-medium uppercase">{status}</p>
                  </div>
              </div>

              {trackUrl && (
                <button 
                    onClick={() => window.open(trackUrl, '_blank')}
                    className="w-full py-3 rounded-2xl glass-button text-[8px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2"
                >
                    External Track <ExternalLink className="w-3 h-3 opacity-30" />
                </button>
              )}
            </div>
          );
        })()}

        {/* Reverse Shipment (Return Pickup) */}
        {order.shipments?.find((s: any) => String(s.awb || s.trackingNumber || '').startsWith('ZBRET') || String(s.status || '').includes('pickup')) && (
          <div className="mb-8 p-5 rounded-3xl glass-panel border-amber-500/20 overflow-hidden">
            <p className="text-[7px] font-black uppercase tracking-[0.3em] text-amber-500/60 mb-2">Return Pickup Logistics</p>
            <p className="text-[10px] font-mono text-foreground/60">
              {(() => {
                const rs = order.shipments.find((s: any) => String(s.awb || s.trackingNumber || '').startsWith('ZBRET') || String(s.status || '').includes('pickup'));
                return `${rs.courier || ''} • ${rs.awb || rs.trackingNumber} • Status: ${rs.status === 'pickup_pending' ? 'Awaiting Pickup Agent' : rs.status?.toUpperCase()}`;
              })()}
            </p>
          </div>
        )}

        {/* ORDER ITEMS */}
        <div className="mb-10">
           <h4 className="text-[8px] font-black uppercase tracking-[0.3em] text-foreground/20 mb-6 flex items-center gap-2">
              <ShoppingBag className="w-3 h-3" /> Package Contents
           </h4>
           <div className="space-y-3">
              {order.items.map((item: any) => (
                <div 
                   key={item.id} 
                   className="flex items-center gap-4 p-3 rounded-2xl glass-panel"
                >
                   <div className="w-14 h-14 rounded-xl overflow-hidden bg-foreground/5 border border-foreground/5 flex-shrink-0">
                      {(() => {
                        const imageSrc = item.image || item.product?.featuredImage || (item.product?.images?.[0] as any)?.src || (item.product?.images?.[0] as any) || "";
                        return imageSrc ? (
                          <img src={imageSrc} alt={item.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-foreground/5 text-foreground/20 font-black text-lg uppercase">{item.title[0]}</div>
                        );
                      })()}
                   </div>
                   <div className="flex-1 min-w-0">
                      <h5 className="text-[10px] font-bold text-foreground/80 truncate uppercase tracking-tight">{item.title}</h5>
                      <p className="text-[8px] font-extralight text-foreground/40 mt-0.5 font-mono">Qty: {item.quantity} · {formatPriceString(Number(item.price), order.currency || "INR", "en-US")}</p>
                   </div>
                   <div className="text-right">
                      <p className="text-[10px] font-inter font-bold text-foreground/60">{formatPriceString(Number(item.price) * item.quantity, order.currency || "INR", "en-US")}</p>
                   </div>
                </div>
              ))}
           </div>
        </div>

        {/* DELIVERY ADDRESS */}
        <div className="mb-10">
           <h4 className="text-[8px] font-black uppercase tracking-[0.3em] text-foreground/20 mb-3 ml-1">
              Delivery Address
           </h4>
           <div className="p-5 rounded-3xl glass-panel">
              {(() => {
                if (!order.shippingAddress) return <p className="text-[10px] text-foreground/40">No address provided.</p>;
                try {
                  const addr = typeof order.shippingAddress === 'string' ? JSON.parse(order.shippingAddress) : order.shippingAddress;
                  return (
                    <div className="space-y-4">
                      <div>
                        <p className="text-[12px] font-bold text-foreground uppercase">{addr.name || 'Recipient'}</p>
                        <p className="text-[10px] text-foreground/50 leading-relaxed mt-1">
                          {addr.address1 || addr.line1 || addr.street}
                          {addr.address2 ? `, ${addr.address2}` : ''}
                          <br />
                          {addr.city}, {addr.province || addr.state} - {addr.zip || addr.pincode}
                          <br />
                          {addr.country || 'India'}
                        </p>
                      </div>
                      {addr.phone && (
                        <div className="pt-3 border-t border-foreground/5">
                          <p className="text-[7px] font-black uppercase tracking-widest text-foreground/20">Contact</p>
                          <p className="text-[10px] font-medium text-foreground/75 mt-0.5">{addr.phone}</p>
                        </div>
                      )}
                    </div>
                  );
                } catch {
                  return <p className="text-[10px] text-foreground/50 leading-relaxed">{String(order.shippingAddress)}</p>;
                }
              })()}
           </div>
        </div>

        {/* ORDER INFO */}
        <div className="mb-10">
           <h4 className="text-[8px] font-black uppercase tracking-[0.3em] text-foreground/20 mb-3 ml-1">
              Order Info
           </h4>
           <div className="p-5 rounded-3xl glass-panel divide-y divide-foreground/5 space-y-3">
              <div className="flex justify-between items-center text-[10px] font-medium pt-0">
                 <span className="text-foreground/40">Payment Method</span>
                 <span className="text-foreground font-bold uppercase tracking-wider">{order.paymentMethod || 'Razorpay'}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-medium pt-3">
                 <span className="text-foreground/45">Order Source</span>
                 <span className="text-foreground font-bold uppercase tracking-wider">{order.orderType === 'WEB_STORE' ? 'Web Store' : 'Mobile App'}</span>
              </div>
           </div>
        </div>

        {/* BILLING SUMMARY */}
        <div className="mb-10">
           <h4 className="text-[8px] font-black uppercase tracking-[0.3em] text-foreground/20 mb-3 ml-1">
              Billing Summary
           </h4>
           <div className="p-5 rounded-3xl glass-panel space-y-3">
              <div className="flex justify-between items-center text-[11px] font-medium text-foreground/60">
                 <span>Subtotal</span>
                 <span className="font-bold text-foreground/80">{formatPriceString(Number(order.subtotalPrice || (order.totalPrice + (order.discountAmount || 0))), order.currency || "INR", "en-US")}</span>
              </div>
              {order.discountAmount > 0 && (
                 <div className="flex justify-between items-center text-[11px] font-medium text-foreground/60">
                    <span>Discount ({order.discountCode || 'Coupon'})</span>
                    <span className="font-bold text-emerald-500/80">- {formatPriceString(Number(order.discountAmount), order.currency || "INR", "en-US")}</span>
                 </div>
              )}
              <div className="flex justify-between items-center text-[11px] font-medium text-foreground/60">
                 <span>Shipping</span>
                 <span className="text-emerald-500 uppercase text-[9px] font-black tracking-widest">Free</span>
              </div>
              <div className="pt-4 mt-2 border-t border-foreground/5 space-y-2">
                 <div className="flex justify-between items-center">
                    <span className="text-[12px] font-black uppercase tracking-widest text-foreground/50">Total Order Amount</span>
                    <span className="text-lg font-black tracking-tight text-foreground">{formatPriceString(Number(order.totalPrice), order.currency || "INR", "en-US")}</span>
                 </div>
                 {order.isCod && (
                    <div className="pt-2 border-t border-dashed border-foreground/10 space-y-1.5 text-[11px]">
                       <div className="flex justify-between items-center text-emerald-500 font-semibold">
                          <span>Amount Paid Online (Upfront)</span>
                          <span>✓ {formatPriceString(Number(order.codUpfrontPaid || 99), order.currency || "INR", "en-US")}</span>
                       </div>
                       <div className="flex justify-between items-center text-amber-500 font-bold">
                          <span>Balance Due at Delivery</span>
                          <span>{formatPriceString(Number(order.codBalanceDue || Math.max(0, order.totalPrice - 99)), order.currency || "INR", "en-US")}</span>
                       </div>
                    </div>
                 )}
              </div>
           </div>
        </div>

        {/* ACTION BUTTONS */}
        <div className="space-y-3 mb-20">
          {/* Rate & Review button for delivered orders */}
          {(order?.deliveryStatus || '').toLowerCase() === 'delivered' && (
            <button
              onClick={() => {
                fetchReviewableItems();
                setShowReviewModal(true);
              }}
              className="w-full py-4 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-amber-500/5"
            >
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              <span>{reviewableItems.some(i => i.reviewed) ? "View & Update Product Reviews" : "Rate & Review Products"}</span>
            </button>
          )}

          {/* Return & Exchange buttons for delivered orders within window */}
          {isReturnWindowOpen && !hasActiveReturn && !hasActiveExchange && (
            <div className="flex gap-3">
              <Link 
                href={`/orders/${id}/return`}
                className="flex-1 py-4 rounded-2xl glass-button text-[11px] font-bold uppercase tracking-wider text-center flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Return
              </Link>
              <Link 
                href={`/orders/${id}/exchange`}
                className="flex-1 py-4 rounded-2xl glass-cta text-[11px] flex items-center justify-center gap-2"
              >
                <ArrowLeftRight className="w-4 h-4" />
                Exchange
              </Link>
            </div>
          )}

          {/* Cancel pending return/exchange */}
          {hasPendingRequest && (
            <button
              onClick={handleCancelReturnExchange}
              className="w-full py-4 rounded-2xl text-[11px] font-bold uppercase tracking-wider text-red-500 bg-red-500/5 border border-red-500/15 hover:bg-red-500/10 transition-all active:scale-[0.98]"
            >
              Cancel Return/Exchange Request
            </button>
          )}

          {/* Cancel order for pending/COD */}
          {canCancel && !hasPendingRequest && (
            <button
              onClick={() => setShowCancelModal(true)}
              disabled={cancelling}
              className="w-full py-4 rounded-2xl text-[11px] font-bold uppercase tracking-wider text-red-500 bg-red-500/5 border border-red-500/15 hover:bg-red-500/10 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {cancelling ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Cancel Order"}
            </button>
          )}

          {/* Contact Support */}
          <Link
            href={`/support?tab=chat&orderId=${order.orderNumber || order.shopifyOrderId || order.id}`}
            className="block w-full py-4 rounded-2xl glass-button text-[11px] font-bold uppercase tracking-wider text-center"
          >
            Contact Support
          </Link>
        </div>
      </main>

      {/* Review Modal */}
      <OrderReviewModal
        isOpen={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        orderId={id as string}
        orderNumber={order?.orderNumber || order?.shopifyOrderId || `#${(id as string).slice(-6).toUpperCase()}`}
        items={reviewableItems.length > 0 ? reviewableItems : (order?.items || []).map((i: any) => ({
          id: i.id,
          productId: i.productId || i.id,
          title: i.title,
          image: i.image,
          reviewed: false,
        }))}
        onReviewSubmitted={fetchReviewableItems}
      />

      {/* Toast Notice */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] px-6 py-3.5 bg-black/90 border border-foreground/10 text-foreground text-[10px] font-bold uppercase tracking-widest rounded-full shadow-2xl backdrop-blur-md"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Cancellation Modal */}
      <AnimatePresence>
        {showCancelModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCancelModal(false)}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md glass-card p-8 rounded-[32px] border border-foreground/15 shadow-2xl space-y-6 bg-[#090909]/95 text-left z-10"
            >
              <div className="flex items-center gap-3 text-red-500">
                <AlertCircle className="w-5 h-5" />
                <h3 className="text-[12px] font-black uppercase tracking-[0.25em]">Cancel Order</h3>
              </div>

              <div className="space-y-3">
                <p className="text-[12px] text-foreground/70 leading-relaxed font-medium">
                  Are you sure you want to cancel order <span className="text-foreground font-semibold">{order?.orderNumber || order?.id}</span>?
                </p>
                <p className="text-[10px] text-foreground/45 leading-normal">
                  All items will be restocked.
                  {isCOD ? (
                    isProcessed ? (
                      <span className="text-amber-500/90 font-medium block mt-1">Note: Since this order has already been processed, the upfront COD fee of ₹99 is non-refundable.</span>
                    ) : (
                      <span className="text-emerald-400/90 font-medium block mt-1">The upfront COD fee of ₹99 will be fully refunded to your source account.</span>
                    )
                  ) : (
                    " Any upfront online payments will be refunded to your source account automatically."
                  )}
                  {" This action is irreversible."}
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="flex-1 py-3 bg-foreground/5 hover:bg-foreground/10 text-foreground/60 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all"
                >
                  Go Back
                </button>
                <button
                  onClick={handleCancelOrder}
                  disabled={cancelling}
                  className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  {cancelling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirm Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
