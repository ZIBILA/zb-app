"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  ShoppingBag,
  CreditCard,
  Truck,
  Calendar,
  User,
  Mail,
  Phone,
  MapPin,
  Clock,
  CheckCircle,
  AlertCircle,
  FileText,
  Save,
  Sparkles,
  ExternalLink,
  Settings,
  Banknote,
  ShieldCheck,
  DollarSign,
  Package,
  X,
  RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import LineItemEditor from "@/components/orders/LineItemEditor";

interface LineItem {
  product_id: string;
  variant_id: string;
  title: string;
  image_url: string;
  quantity: number;
  price: number;
  size?: string;
}

interface Address {
  name?: string;
  phone?: string;
  email?: string;
  houseNo?: string;
  street?: string;
  landmark?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  pincode?: string;
  country?: string;
}

interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: Address;
  items: LineItem[];
  subtotal: number;
  shippingCharge: number;
  discountCode?: string;
  discountAmount: number;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  codUpfrontPaid?: number;
  codUpfrontPaymentId?: string;
  paymentFailureReason?: string | null;
  fulfillmentStatus: string;
  deliveryStatus?: string;
  deliveredAt?: string;
  shopifyOrderId?: string;
  shopifyOrderName?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  notes?: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export default function WebStoreOrderDetail() {
  const router = useRouter();
  const params = useParams();
  const orderId = params?.id as string;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  // Editable fields states
  const [paymentStatus, setPaymentStatus] = useState("");
  const [fulfillmentStatus, setFulfillmentStatus] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [notes, setNotes] = useState("");

  const fetchOrderDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/web-store/orders/${orderId}`);
      if (!res.ok) throw new Error("Order not found");
      const data = await res.json();
      setOrder(data.order);
      
      // Initialize states
      setPaymentStatus(data.order.paymentStatus);
      setFulfillmentStatus(data.order.fulfillmentStatus);
      setTrackingNumber(data.order.trackingNumber || "");
      setTrackingUrl(data.order.trackingUrl || "");
      setNotes(data.order.notes || "");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load order detail";
      toast.error(msg);
      router.push("/dashboard/webstore/orders");
    } finally {
      setLoading(false);
    }
  }, [orderId, router]);

  useEffect(() => {
    fetchOrderDetail();
  }, [fetchOrderDetail]);

  useEffect(() => {
    if (order?.orderNumber) {
      document.title = `Order ${order.orderNumber} | Zica Bella Admin`;
    }
  }, [order?.orderNumber]);

  const handleUpdateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    try {
      const res = await fetch(`/api/web-store/orders/${orderId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          paymentStatus,
          fulfillmentStatus,
          trackingNumber: trackingNumber || null,
          trackingUrl: trackingUrl || null,
          notes: notes || null,
        }),
      });

      if (!res.ok) throw new Error("Failed to update order");
      const result = await res.json();
      setOrder(result.order);
      toast.success("Order updated successfully");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error updating order";
      toast.error(msg);
    } finally {
      setUpdating(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const getFulfillmentBadge = (status: string) => {
    switch (status) {
      case "delivered":
        return <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle className="w-3.5 h-3.5" /> Delivered</span>;
      case "out_for_delivery":
        return <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20"><Truck className="w-3.5 h-3.5" /> Out for Delivery</span>;
      case "shipped":
        return <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20"><Truck className="w-3.5 h-3.5" /> Shipped</span>;
      case "processing":
        return <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"><Clock className="w-3.5 h-3.5" /> Processing</span>;
      case "cancelled":
        return <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20"><X className="w-3.5 h-3.5" /> Cancelled</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-foreground/30 text-foreground/60 border border-foreground/30"><AlertCircle className="w-3.5 h-3.5" /> Unfulfilled</span>;
    }
  };

  const formatReasonText = (reason?: string | null) => {
    if (!reason) return null;
    if (reason === "payment_cancelled_by_user") return "Cancelled by customer";
    if (reason === "awaiting_confirmation") return "Awaiting confirmation";
    if (reason === "payment_timed_out") return "Payment timed out";
    return reason.replace(/_/g, " ");
  };

  const getPaymentBadge = (status: string, failureReason?: string | null) => {
    const reasonLabel = formatReasonText(failureReason);
    switch (status) {
      case "paid":
        return <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle className="w-3.5 h-3.5" /> Paid</span>;
      case "cod_upfront_paid":
      case "partially_paid":
        return <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><Banknote className="w-3.5 h-3.5" /> COD Upfront Paid</span>;
      case "failed":
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="w-3.5 h-3.5" /> Failed {reasonLabel ? `(${reasonLabel})` : ""}
          </span>
        );
      case "cancelled":
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <X className="w-3.5 h-3.5" /> Cancelled {reasonLabel ? `(${reasonLabel})` : ""}
          </span>
        );
      case "refunded":
        return <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">Refunded</span>;
      default:
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3.5 h-3.5" /> Pending
          </span>
        );
    }
  };

  /* ─── Address display helper (handles both old and new formats) ─── */
  const renderAddress = (addr: Address) => {
    if (addr.houseNo || addr.street) {
      return (
        <div className="space-y-1 text-[12px] pt-2 text-foreground/75 font-medium">
          {addr.houseNo && <p>{addr.houseNo}</p>}
          {addr.street && <p>{addr.street}</p>}
          {addr.landmark && <p className="text-foreground/50">{addr.landmark}</p>}
          <p>
            {addr.city}{addr.city && addr.state ? ", " : ""}{addr.state}{(addr.city || addr.state) && (addr.zip || addr.pincode) ? " - " : ""}{addr.zip || addr.pincode}
          </p>
          {addr.country && <p>{addr.country}</p>}
        </div>
      );
    }
    return (
      <div className="space-y-1 text-[12px] pt-2 text-foreground/75 font-medium">
        {addr.line1 && <p>{addr.line1}</p>}
        {addr.line2 && <p>{addr.line2}</p>}
        <p>
          {addr.city}{addr.city && addr.state ? ", " : ""}{addr.state}{(addr.city || addr.state) && (addr.zip || addr.pincode) ? " - " : ""}{addr.zip || addr.pincode}
        </p>
        {addr.country && <p>{addr.country}</p>}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-6 w-32 bg-foreground/10 rounded-lg" />
        <div className="h-32 bg-foreground/5 rounded-[2rem]" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-96 lg:col-span-2 bg-foreground/5 rounded-[2rem]" />
          <div className="h-96 bg-foreground/5 rounded-[2rem]" />
        </div>
      </div>
    );
  }

  if (!order) return null;

  const isCOD = (order.paymentMethod || "").toLowerCase().trim() === "cod";
  const codUpfront = Number(order.codUpfrontPaid || 0);
  const balanceDue = isCOD ? Number(order.totalAmount) - codUpfront : 0;

  return (
    <div className="space-y-8">
      {/* Back button & Page title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/webstore/orders"
            className="w-10 h-10 rounded-2xl flex items-center justify-center bg-foreground/5 text-foreground/60 border border-foreground/10 hover:bg-foreground/10 hover:text-foreground transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight font-inter flex items-center gap-2 text-foreground">
              Order {order.orderNumber} <Sparkles className="w-5 h-5 text-indigo-400" />
            </h1>
            <p className="text-[12px] text-foreground/50 mt-1 flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" /> Placed on {formatDate(order.createdAt)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {getPaymentBadge(order.paymentStatus, order.paymentFailureReason)}
          {getFulfillmentBadge(order.deliveryStatus || order.fulfillmentStatus)}
          {order.trackingNumber && (
            <a
              href={order.trackingUrl || `https://zicabella.shiprocket.co/tracking/${order.trackingNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition-all font-mono"
            >
              <Truck className="w-3.5 h-3.5" /> Track: {order.trackingNumber} <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      </div>

      {/* ═══ Payment Collected Banner ═══ */}
      {(() => {
        const isPaid = order.paymentStatus === "paid";
        const isPartiallyPaid = order.paymentStatus === "cod_upfront_paid" || order.paymentStatus === "partially_paid" || (isCOD && (codUpfront > 0 || Boolean(order.codUpfrontPaymentId)));
        const isFailed = (order.paymentStatus === "failed") && !isPartiallyPaid;
        const isCancelled = (order.paymentStatus === "cancelled") && !isPartiallyPaid;
        const isPending = (order.paymentStatus === "pending" || order.paymentStatus === "payment_pending") && !isPartiallyPaid;

        if (isFailed || isCancelled) {
          return (
            <div className="glass rounded-[2rem] border border-rose-500/20 bg-rose-500/[0.03] p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center">
                    <AlertCircle className="w-6 h-6 text-rose-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-rose-400 flex items-center gap-2">
                      Payment {isCancelled ? "Cancelled" : "Failed"}
                    </h3>
                    <p className="text-[11px] text-rose-300/80 mt-0.5 font-medium">
                      Reason: {formatReasonText(order.paymentFailureReason) || order.paymentFailureReason || "Payment was not completed or was cancelled."}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-rose-400/60">Collected</p>
                    <p className="text-2xl font-black text-rose-400">{formatCurrency(0)}</p>
                  </div>
                  <div className="w-[1px] h-10 bg-rose-500/15" />
                  <div className="text-center">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">Order Total</p>
                    <p className="text-2xl font-black text-foreground">{formatCurrency(Number(order.totalAmount))}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        if (isPending) {
          return (
            <div className="glass rounded-[2rem] border border-amber-500/20 bg-amber-500/[0.03] p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center">
                    <Clock className="w-6 h-6 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2">
                      Payment Pending
                    </h3>
                    <p className="text-[11px] text-amber-300/80 mt-0.5 font-medium">
                      Awaiting payment confirmation from Razorpay or customer.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-amber-400/60">Collected</p>
                    <p className="text-2xl font-black text-amber-400">{formatCurrency(0)}</p>
                  </div>
                  <div className="w-[1px] h-10 bg-amber-500/15" />
                  <div className="text-center">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">Order Total</p>
                    <p className="text-2xl font-black text-foreground">{formatCurrency(Number(order.totalAmount))}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div className={`glass rounded-[2rem] border p-6 ${
            isCOD ? "border-indigo-500/20 bg-indigo-500/[0.02]" : "border-emerald-500/20 bg-emerald-500/[0.02]"
          }`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                  isCOD ? "bg-indigo-500/10" : "bg-emerald-500/10"
                }`}>
                  <DollarSign className={`w-6 h-6 ${isCOD ? "text-indigo-400" : "text-emerald-400"}`} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    Payment Collected
                    {(codUpfront > 0 || isPaid) && <ShieldCheck className="w-4 h-4 text-emerald-400" />}
                  </h3>
                  <p className="text-[11px] text-foreground/50 mt-0.5">
                    {isCOD
                      ? `Cash on Delivery — ₹${codUpfront} upfront fee collected via Razorpay`
                      : "Full payment collected via Razorpay"
                    }
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                {isCOD ? (
                  <>
                    <div className="text-center">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">Upfront Paid</p>
                      <p className="text-xl font-black text-indigo-400">{formatCurrency(codUpfront)}</p>
                    </div>
                    <div className="w-[1px] h-10 bg-foreground/10" />
                    <div className="text-center">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">Due at Delivery</p>
                      <p className="text-xl font-black text-foreground/70">{formatCurrency(balanceDue)}</p>
                    </div>
                    <div className="w-[1px] h-10 bg-foreground/10" />
                    <div className="text-center">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">Order Total</p>
                      <p className="text-xl font-black text-foreground">{formatCurrency(Number(order.totalAmount))}</p>
                    </div>
                  </>
                ) : (
                  <div className="text-center">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">Amount Paid</p>
                    <p className="text-2xl font-black text-emerald-400">{formatCurrency(Number(order.totalAmount))}</p>
                  </div>
                )}
              </div>
            </div>

            {/* COD upfront payment ID */}
            {isCOD && order.codUpfrontPaymentId && (
              <div className="mt-3 pt-3 border-t border-foreground/5">
                <p className="text-[10px] text-foreground/40 font-medium">
                  <span className="font-bold uppercase tracking-wider">Upfront Payment ID:</span>{" "}
                  <span className="font-mono text-indigo-400">{order.codUpfrontPaymentId}</span>
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Main Grid content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Col: Order items & Summary */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Order items list */}
          <div className="glass rounded-[2rem] border border-foreground/5 p-6 md:p-8 space-y-6">
            <h3 className="text-base font-bold text-foreground font-inter flex items-center gap-2">
              <Package className="w-4 h-4 text-indigo-400" /> Line Items ({order.items.length})
            </h3>
            
            <div className="divide-y divide-foreground/5">
              {order.items.map((item, idx) => (
                <div key={idx} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="w-16 h-20 rounded-xl bg-foreground/5 border border-foreground/10 relative overflow-hidden shrink-0 flex items-center justify-center">
                    {item.image_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={item.image_url}
                        alt={item.title}
                        className="object-cover w-full h-full"
                      />
                    ) : (
                      <ShoppingBag className="w-6 h-6 text-foreground/20" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <h4 className="text-[12px] font-bold text-foreground truncate">{item.title}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        {item.size && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-foreground/50 bg-foreground/5 px-1.5 py-0.5 rounded">
                            Size: {item.size}
                          </span>
                        )}
                        <span className="text-[9px] text-foreground/40 font-mono uppercase tracking-wider">
                          ID: {item.variant_id || item.product_id || "—"}
                        </span>
                      </div>
                      <LineItemEditor
                        orderId={order.id}
                        lineItemId={item.variant_id || item.product_id || `item_${idx}`}
                        shopifyLineItemId={item.variant_id}
                        currentProductId={item.product_id}
                        currentTitle={item.title}
                        currentSku={item.variant_id}
                        currentQuantity={item.quantity}
                        currentPrice={item.price}
                        onSuccess={() => fetchOrderDetail()}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] mt-1">
                      <span className="text-foreground/50 font-medium">
                        Qty: {item.quantity}
                      </span>
                      <span className="font-bold text-foreground">
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pricing summary */}
          <div className="glass rounded-[2rem] border border-foreground/5 p-6 md:p-8 space-y-4">
            <h3 className="text-base font-bold text-foreground font-inter flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-indigo-400" /> Billing Summary
            </h3>
            
            <div className="space-y-2 text-[12px] pt-2">
              <div className="flex justify-between text-foreground/60 font-medium">
                <span>Subtotal</span>
                <span>{formatCurrency(Number(order.subtotal))}</span>
              </div>
              <div className="flex justify-between text-foreground/60 font-medium">
                <span>Shipping</span>
                <span>{formatCurrency(Number(order.shippingCharge))}</span>
              </div>
              {order.discountCode && (
                <div className="flex justify-between text-emerald-400 font-semibold">
                  <span className="flex items-center gap-1">Discount ({order.discountCode})</span>
                  <span>-{formatCurrency(Number(order.discountAmount))}</span>
                </div>
              )}
              {isCOD && codUpfront > 0 && (
                <div className="flex justify-between text-indigo-400 font-semibold">
                  <span>COD Upfront Fee (Collected)</span>
                  <span>{formatCurrency(codUpfront)}</span>
                </div>
              )}
              <div className="h-[1px] bg-foreground/5 my-2" />
              <div className="flex justify-between text-[14px] font-extrabold text-foreground">
                <span>Grand Total</span>
                <span>{formatCurrency(Number(order.totalAmount))}</span>
              </div>
              {isCOD && (
                <div className="flex justify-between text-[12px] font-bold text-foreground/50 mt-1">
                  <span>Remaining Due at Delivery</span>
                  <span>{formatCurrency(balanceDue)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Customer & Shipping information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Customer Details */}
            <div className="glass rounded-[2rem] border border-foreground/5 p-6 md:p-8 space-y-4">
              <h3 className="text-base font-bold text-foreground font-inter flex items-center gap-2">
                <User className="w-4 h-4 text-indigo-400" /> Customer
              </h3>
              <div className="space-y-3 text-[12px] pt-2">
                <div className="flex items-center gap-2.5">
                  <User className="w-4 h-4 text-foreground/30 shrink-0" />
                  <span className="font-semibold text-foreground">{order.customerName}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-foreground/30 shrink-0" />
                  <a href={`mailto:${order.customerEmail}`} className="text-foreground/70 hover:text-indigo-400 transition-colors truncate">
                    {order.customerEmail}
                  </a>
                </div>
                <div className="flex items-center gap-2.5">
                  <Phone className="w-4 h-4 text-foreground/30 shrink-0" />
                  <a href={`tel:${order.customerPhone}`} className="text-foreground/70 hover:text-indigo-400 transition-colors">
                    {order.customerPhone || "Not provided"}
                  </a>
                </div>
              </div>
            </div>

            {/* Shipping Address */}
            <div className="glass rounded-[2rem] border border-foreground/5 p-6 md:p-8 space-y-4">
              <h3 className="text-base font-bold text-foreground font-inter flex items-center gap-2">
                <MapPin className="w-4 h-4 text-indigo-400" /> Shipping Address
              </h3>
              {renderAddress(order.shippingAddress)}
            </div>
          </div>
        </div>

        {/* Right Col: Admin Controls & Modifiers */}
        <div className="space-y-8">
          
          {/* Live Tracking Card */}
          {order.trackingNumber && (
            <div className="glass rounded-[2rem] border border-indigo-500/20 bg-indigo-500/[0.03] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Live Shipment</h4>
                    <p className="text-[11px] text-indigo-400 font-mono font-bold mt-0.5">{order.trackingNumber}</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold uppercase font-mono px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {order.deliveryStatus || order.fulfillmentStatus}
                </span>
              </div>
              {order.trackingUrl && (
                <a
                  href={order.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-indigo-600 text-white hover:bg-indigo-500 transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20"
                >
                  <span>Track on Courier Portal</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          )}

          {/* Form container */}
          <div className="glass rounded-[2rem] border border-foreground/5 p-6 md:p-8 space-y-6">
            <h3 className="text-base font-bold text-foreground font-inter flex items-center gap-2">
              <Settings className="w-4 h-4 text-indigo-400" /> Order Operations
            </h3>

            <form onSubmit={handleUpdateOrder} className="space-y-4 text-xs font-medium">
              
              {/* Payment status */}
              <div className="space-y-2">
                <label className="text-foreground/45 text-[10px] font-bold uppercase tracking-wider block">Payment Status</label>
                <select
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value)}
                  className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-indigo-500/30 transition-all appearance-none cursor-pointer"
                >
                  <option value="pending" className="bg-[#0e0e0e]">Pending</option>
                  <option value="paid" className="bg-[#0e0e0e]">Paid</option>
                  <option value="cod_upfront_paid" className="bg-[#0e0e0e]">COD Upfront Paid</option>
                  <option value="partially_paid" className="bg-[#0e0e0e]">Partially Paid</option>
                  <option value="failed" className="bg-[#0e0e0e]">Failed</option>
                  <option value="refunded" className="bg-[#0e0e0e]">Refunded</option>
                  <option value="cancelled" className="bg-[#0e0e0e]">Cancelled</option>
                </select>
              </div>

              {/* Fulfillment status */}
              <div className="space-y-2">
                <label className="text-foreground/45 text-[10px] font-bold uppercase tracking-wider block">Fulfillment Status</label>
                <select
                  value={fulfillmentStatus}
                  onChange={(e) => setFulfillmentStatus(e.target.value)}
                  className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-indigo-500/30 transition-all appearance-none cursor-pointer"
                >
                  <option value="unfulfilled" className="bg-[#0e0e0e]">Unfulfilled</option>
                  <option value="processing" className="bg-[#0e0e0e]">Processing</option>
                  <option value="shipped" className="bg-[#0e0e0e]">Shipped</option>
                  <option value="delivered" className="bg-[#0e0e0e]">Delivered</option>
                  <option value="returned" className="bg-[#0e0e0e]">Returned</option>
                  <option value="cancelled" className="bg-[#0e0e0e]">Cancelled</option>
                </select>
              </div>

              {/* Tracking number */}
              <div className="space-y-2">
                <label className="text-foreground/45 text-[10px] font-bold uppercase tracking-wider block">Tracking Number</label>
                <input
                  type="text"
                  placeholder="e.g. AWB10293847"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-indigo-500/30 transition-all"
                />
              </div>

              {/* Tracking URL */}
              <div className="space-y-2">
                <label className="text-foreground/45 text-[10px] font-bold uppercase tracking-wider block">
                  Tracking URL 
                  {order.trackingUrl && (
                    <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-indigo-400 hover:text-indigo-300">
                      (Open <ExternalLink className="w-2.5 h-2.5" />)
                    </a>
                  )}
                </label>
                <input
                  type="url"
                  placeholder="e.g. https://delhivery.com/track..."
                  value={trackingUrl}
                  onChange={(e) => setTrackingUrl(e.target.value)}
                  className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-indigo-500/30 transition-all"
                />
              </div>

              {/* Internal Notes */}
              <div className="space-y-2">
                <label className="text-foreground/45 text-[10px] font-bold uppercase tracking-wider block">Internal Notes</label>
                <textarea
                  placeholder="Packaging notes, special instructions, etc."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-indigo-500/30 transition-all resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={updating}
                className="w-full py-3 px-4 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 mt-4"
              >
                <Save className="w-4 h-4" /> {updating ? "Saving..." : "Save Changes"}
              </button>
            </form>
          </div>

          {/* Integration metadata */}
          <div className="glass rounded-[2rem] border border-foreground/5 p-6 md:p-8 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground font-inter flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" /> Integration Data
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setUpdating(true);
                    try {
                      const res = await fetch(`/api/web-store/orders/${order.id}/sync-shopify`, {
                        method: "POST",
                      });
                      const result = await res.json();
                      if (!res.ok) throw new Error(result.error || "Sync failed");
                      toast.success(result.message || "Shopify tracking & status synced!");
                      fetchOrderDetail();
                    } catch (e: unknown) {
                      const msg = e instanceof Error ? e.message : "Failed to sync with Shopify";
                      toast.error(msg);
                    } finally {
                      setUpdating(false);
                    }
                  }}
                  disabled={updating}
                  className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20 transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${updating ? "animate-spin" : ""}`} /> Sync Shopify
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setUpdating(true);
                    try {
                      const res = await fetch("/api/web-store/orders/sync-razorpay", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ orderIds: [order.id] }),
                      });
                      if (!res.ok) throw new Error("Sync failed");
                      toast.success("Razorpay payment status synced!");
                      fetchOrderDetail();
                    } catch (e: unknown) {
                      const msg = e instanceof Error ? e.message : "Failed to sync payment status";
                      toast.error(msg);
                    } finally {
                      setUpdating(false);
                    }
                  }}
                  disabled={updating}
                  className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 bg-indigo-500/10 px-2.5 py-1 rounded-lg border border-indigo-500/20 transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${updating ? "animate-spin" : ""}`} /> Sync Razorpay
                </button>
              </div>
            </div>
            
            <div className="space-y-3 pt-2 text-[11px] font-mono text-foreground/60 leading-relaxed break-all">
              <div>
                <span className="text-foreground/45 font-sans font-bold uppercase tracking-wider block text-[9px] mb-0.5">Order ID</span>
                {order.id}
              </div>
              <div>
                <span className="text-foreground/45 font-sans font-bold uppercase tracking-wider block text-[9px] mb-0.5">Source</span>
                <span className="text-indigo-400 font-bold uppercase">{order.source} storefront</span>
              </div>
              <div>
                <span className="text-foreground/45 font-sans font-bold uppercase tracking-wider block text-[9px] mb-0.5">Payment Method</span>
                <span className={`font-bold uppercase ${isCOD ? "text-indigo-400" : "text-emerald-400"}`}>
                  {isCOD ? "Cash on Delivery" : "Razorpay (Prepaid)"}
                </span>
              </div>
              {order.shopifyOrderId && (
                <div>
                  <span className="text-foreground/45 font-sans font-bold uppercase tracking-wider block text-[9px] mb-0.5">Shopify Order ID</span>
                  <span className="text-emerald-400 font-bold">{order.shopifyOrderId}</span>
                  {order.shopifyOrderName && (
                    <span className="ml-2 text-foreground/50">({order.shopifyOrderName})</span>
                  )}
                </div>
              )}
              {order.deliveryStatus && (
                <div>
                  <span className="text-foreground/45 font-sans font-bold uppercase tracking-wider block text-[9px] mb-0.5">Delivery Status</span>
                  <span className="text-emerald-400 font-bold uppercase">{order.deliveryStatus}</span>
                  {order.deliveredAt && (
                    <span className="ml-2 text-foreground/50">on {formatDate(order.deliveredAt)}</span>
                  )}
                </div>
              )}
              {order.paymentFailureReason && (
                <div>
                  <span className="text-rose-400/80 font-sans font-bold uppercase tracking-wider block text-[9px] mb-0.5">Payment Failure Reason</span>
                  <span className="text-rose-400 font-sans font-bold">{order.paymentFailureReason}</span>
                </div>
              )}
              {order.razorpayOrderId && (
                <div>
                  <span className="text-foreground/45 font-sans font-bold uppercase tracking-wider block text-[9px] mb-0.5">Razorpay Order ID</span>
                  {order.razorpayOrderId}
                </div>
              )}
              {order.razorpayPaymentId && (
                <div>
                  <span className="text-foreground/45 font-sans font-bold uppercase tracking-wider block text-[9px] mb-0.5">Razorpay Payment ID</span>
                  {order.razorpayPaymentId}
                </div>
              )}
              {order.codUpfrontPaymentId && (
                <div>
                  <span className="text-foreground/45 font-sans font-bold uppercase tracking-wider block text-[9px] mb-0.5">COD Upfront Payment ID</span>
                  <span className="text-indigo-400">{order.codUpfrontPaymentId}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
