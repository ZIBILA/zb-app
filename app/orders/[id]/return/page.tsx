"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ChevronLeft, 
  CheckCircle2, 
  Loader2,
  RotateCcw,
  AlertCircle
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { isCodOrder, COD_STORE_CREDIT_MESSAGE, REFUND_POLICY_PATH } from "@/lib/returnPolicy";

const RETURN_REASONS = [
  "Defective or damaged",
  "Wrong size or fit",
  "Wrong color or pattern",
  "Not as described",
  "Changed mind",
  "Other"
];

export default function ReturnRequestPage() {
  const { id } = useParams();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [refundMethod, setRefundMethod] = useState<"original_method" | "store_credit">("original_method");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(`/login?callbackUrl=/orders/${id}/return`);
    }
  }, [status, router, id]);

  useEffect(() => {
    fetchOrder();
  }, [id]);

  // COD orders are refunded as Store Credit only (return policy).
  const codOrder = isCodOrder(order);
  useEffect(() => {
    if (codOrder) setRefundMethod("store_credit");
  }, [codOrder]);

  const fetchOrder = async () => {
    try {
      const res = await fetch(`/api/orders/${id}`);
      if (res.status === 401) {
        router.push(`/login?callbackUrl=/orders/${id}/return`);
        return;
      }
      const data = await res.json();
      if (res.ok) setOrder(data.order);
    } catch (e) {
      console.error("Error fetching order", e);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (itemId: string) => {
    const newSet = new Set(selectedItems);
    if (newSet.has(itemId)) {
      newSet.delete(itemId);
    } else {
      newSet.add(itemId);
    }
    setSelectedItems(newSet);
  };

  const estimatedRefund = Array.from(selectedItems).reduce((sum, itemId) => {
    const item = order?.items?.find((i: any) => i.id === itemId);
    if (item) return sum + (item.price * item.quantity);
    return sum;
  }, 0);

  const handleSubmit = async () => {
    if (selectedItems.size === 0) {
      setError("Please select at least one item to return");
      return;
    }
    for (const itemId of selectedItems) {
      if (!reasons[itemId]) {
        setError("Please select a reason for all selected items");
        return;
      }
    }

    setIsSubmitting(true);
    setError("");

    try {
      const returnItemsPayload = Array.from(selectedItems).map(itemId => {
        const item = order.items.find((i: any) => i.id === itemId);
        return {
          orderItemId: itemId,
          quantity: item.quantity,
          reason: reasons[itemId],
          comments: comments[itemId] || ''
        };
      });

      const res = await fetch("/api/returns/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          returnItems: returnItemsPayload,
          refundMethod: refundMethod
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit return request");

      setSuccess(true);
      setTimeout(() => router.push(`/orders/${id}`), 2000);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-foreground/20" />
        <p className="text-[8px] text-foreground/30 font-black uppercase tracking-[0.3em]">Loading</p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-center px-6">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200 }}>
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
        </motion.div>
        <h2 className="text-[14px] font-bold text-foreground uppercase tracking-wider">Return Request Submitted</h2>
        <p className="text-[10px] text-foreground/50">We'll review your request and get back to you within 24-48 hours.</p>
        <Link href={`/orders/${id}`} className="glass-cta px-8 py-3 text-[9px] mt-4">Back to Order</Link>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-center px-6">
        <AlertCircle className="w-8 h-8 text-red-500/50" />
        <p className="text-[11px] text-foreground/60">Order not found</p>
        <Link href="/orders" className="glass-cta px-8 py-3 text-[9px]">Back to Orders</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-2xl mx-auto px-4 pt-28 pb-40">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href={`/orders/${id}`} className="group flex items-center gap-2 p-2 -ml-2 rounded-full hover:bg-foreground/5 transition-colors">
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          </Link>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">Request Return</h1>
            <p className="text-[11px] text-foreground/40 font-medium">Select items you want to return and specify reasons.</p>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-4">
          {order.items?.map((item: any) => {
            const isSelected = selectedItems.has(item.id);
            const imgUrl = item.image || item.product?.featuredImage;
            return (
              <motion.div 
                key={item.id} 
                layout
                className={`rounded-2xl glass-panel overflow-hidden transition-all ${isSelected ? 'ring-2 ring-foreground/30' : ''}`}
              >
                {/* Item row */}
                <button
                  onClick={() => toggleSelection(item.id)}
                  className="w-full flex items-center gap-4 p-4 text-left"
                >
                  {/* Checkbox */}
                  <div className={`w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all ${
                    isSelected ? 'bg-foreground border-foreground' : 'border-foreground/20'
                  }`}>
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-background" />}
                  </div>

                  {/* Image */}
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-foreground/5 shrink-0">
                    {imgUrl ? (
                      <img src={imgUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-foreground/20 text-[14px] font-bold">{item.title[0]}</div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-foreground/80 truncate">{item.title}</p>
                    <p className="text-[10px] text-foreground/40 mt-0.5">Qty: {item.quantity} · ₹{item.price.toLocaleString('en-IN')}</p>
                  </div>
                </button>

                {/* Reason picker (when selected) */}
                <AnimatePresence>
                  {isSelected && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }} 
                      animate={{ height: "auto", opacity: 1 }} 
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-2 border-t border-foreground/5">
                        <p className="text-[10px] font-bold text-foreground/60 mb-3 uppercase tracking-wider">Reason for return</p>
                        <div className="flex flex-wrap gap-2">
                          {RETURN_REASONS.map(reason => (
                            <button
                              key={reason}
                              onClick={() => setReasons(prev => ({ ...prev, [item.id]: reason }))}
                              className={`px-3 py-1.5 rounded-full text-[10px] font-medium border transition-all ${
                                reasons[item.id] === reason
                                  ? 'bg-foreground text-background border-foreground font-bold'
                                  : 'border-foreground/10 text-foreground/50 hover:text-foreground/80 hover:border-foreground/20'
                              }`}
                            >
                              {reason}
                            </button>
                          ))}
                        </div>

                        {reasons[item.id] === 'Other' && (
                          <textarea
                            className="glass-input w-full mt-3 px-3 py-2.5 text-[12px] min-h-[60px] resize-none"
                            placeholder="Please specify..."
                            value={comments[item.id] || ''}
                            onChange={(e) => setComments(prev => ({ ...prev, [item.id]: e.target.value }))}
                          />
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>

        {/* Refund Method Selection */}
        <div className="mt-6 rounded-2xl glass-panel p-6 border border-foreground/[0.05] space-y-4">
          <div>
            <h3 className="text-[11px] font-bold text-foreground uppercase tracking-widest">Refund Preference</h3>
            <p className="text-[10px] text-foreground/45 mt-1 leading-relaxed">Select how you want to be refunded once your return is processed.</p>
          </div>
          {codOrder ? (
            <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">Store Credit</p>
              <p className="text-[10px] text-foreground/70 mt-1.5 leading-relaxed">
                {COD_STORE_CREDIT_MESSAGE}{" "}
                <Link href={REFUND_POLICY_PATH} className="underline font-bold text-foreground">Learn More</Link>
              </p>
            </div>
          ) : (
          <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setRefundMethod("original_method")}
                className={`flex-1 p-4 rounded-xl border text-left transition-all ${
                  refundMethod === "original_method"
                    ? "bg-foreground/[0.03] border-foreground/30 text-foreground"
                    : "border-foreground/5 text-foreground/40 hover:border-foreground/10"
                }`}
              >
                <p className="text-[11px] font-bold uppercase tracking-wider">Original Payment Method</p>
                <p className="text-[9px] text-foreground/40 mt-1.5 leading-relaxed">Funds are reversed directly to your source account (Credit/Debit Card, UPI, net banking, or Razorpay wallet).</p>
              </button>
              <button
                type="button"
                onClick={() => setRefundMethod("store_credit")}
                className={`flex-1 p-4 rounded-xl border text-left transition-all ${
                  refundMethod === "store_credit"
                    ? "bg-foreground/[0.03] border-foreground/30 text-foreground"
                    : "border-foreground/5 text-foreground/40 hover:border-foreground/10"
                }`}
              >
                <p className="text-[11px] font-bold uppercase tracking-wider">Store Credit (Fastest)</p>
                <p className="text-[9px] text-foreground/40 mt-1.5 leading-relaxed">Added as a store balance to your account wallet once your returned item is received and checked. Recommended.</p>
              </button>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mt-6 flex items-center gap-2 p-3.5 rounded-xl text-[10px] font-bold bg-red-500/5 border border-red-500/15 text-red-500">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}
      </main>

      {/* Fixed Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-foreground/5 px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto">
          <div className="flex justify-between items-center mb-3">
            <span className="text-[11px] text-foreground/50 font-medium">Estimated Refund</span>
            <span className="text-lg font-bold text-foreground">₹{estimatedRefund.toLocaleString('en-IN')}</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={selectedItems.size === 0 || isSubmitting}
            className="glass-cta w-full py-4 text-[11px] flex items-center justify-center gap-2 disabled:opacity-30"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <RotateCcw className="w-4 h-4" />
                Submit Return Request
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
