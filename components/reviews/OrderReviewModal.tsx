"use client";

import { useState } from "react";
import ReviewPhotoPicker from "./ReviewPhotoPicker";
import Image from "next/image";
import { Star, X, CheckCircle2, Loader2, Sparkles, ShoppingBag } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type OrderItemReview = {
  id: string;
  productId: string;
  title: string;
  image: string | null;
  reviewed: boolean;
  review?: {
    id: string;
    rating: number;
    title: string | null;
    body: string;
    status: string;
    createdAt: string;
  } | null;
};

interface OrderReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber?: string;
  items: OrderItemReview[];
  onReviewSubmitted?: () => void;
}

export default function OrderReviewModal({
  isOpen,
  onClose,
  orderId,
  orderNumber,
  items,
  onReviewSubmitted,
}: OrderReviewModalProps) {
  const [selectedProductId, setSelectedProductId] = useState<string>(
    items.find((i) => !i.reviewed)?.productId || items[0]?.productId || ""
  );

  const selectedItem = items.find((i) => i.productId === selectedProductId) || items[0];

  const [rating, setRating] = useState(5);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmitReview = async () => {
    if (!selectedItem) return;
    if (rating < 1 || rating > 5) {
      setError("Please select a star rating");
      return;
    }
    if (body.trim().length < 3) {
      setError("Please write a few words about your experience (minimum 3 characters)");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedItem.productId,
          orderId,
          rating,
          title: title.trim() || undefined,
          body: body.trim(),
          photos,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSubmittedSuccess(true);
        if (onReviewSubmitted) onReviewSubmitted();
        setTimeout(() => {
          setSubmittedSuccess(false);
          setTitle("");
          setBody("");
          setPhotos([]);
        }, 2000);
      } else {
        setError(data.error || "Failed to submit review");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="w-full max-w-lg bg-neutral-950/90 border border-white/10 rounded-3xl p-6 shadow-2xl space-y-5 text-foreground relative overflow-hidden backdrop-blur-2xl"
        >
          {/* Subtle glow background */}
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold tracking-tight text-white font-serif">
                  Write Product Review
                </h3>
              </div>
              <p className="text-[10px] text-neutral-400">
                Order {orderNumber || `#${orderId.slice(-6).toUpperCase()}`}
              </p>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Product selector tabs if multiple items */}
          {items.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {items.map((item) => (
                <button
                  key={item.productId}
                  onClick={() => {
                    setSelectedProductId(item.productId);
                    setError(null);
                    setSubmittedSuccess(false);
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[10px] font-bold transition-all shrink-0 ${
                    selectedProductId === item.productId
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                      : "bg-white/5 border-white/5 text-neutral-400 hover:text-white"
                  }`}
                >
                  <span className="truncate max-w-[120px]">{item.title}</span>
                  {item.reviewed && (
                    <span className="text-[8px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300">
                      ✓ Reviewed
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Active Product Preview */}
          {selectedItem && (
            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-neutral-900 overflow-hidden relative shrink-0 border border-white/10">
                {selectedItem.image ? (
                  <Image
                    src={selectedItem.image}
                    alt={selectedItem.title}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-600">
                    <ShoppingBag className="w-5 h-5" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-bold text-white truncate">{selectedItem.title}</h4>
                <p className="text-[9px] text-neutral-400 mt-0.5">Verified Purchase</p>
              </div>
            </div>
          )}

          {/* If selected item already reviewed */}
          {selectedItem?.reviewed ? (
            <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/20 space-y-2">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs font-bold">You have reviewed this product</span>
              </div>
              {selectedItem.review && (
                <div className="space-y-1 pt-1 text-[11px] text-neutral-300">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`w-3 h-3 ${
                          star <= selectedItem.review!.rating
                            ? "text-amber-400 fill-amber-400"
                            : "text-neutral-700"
                        }`}
                      />
                    ))}
                  </div>
                  {selectedItem.review.title && (
                    <p className="font-bold text-white">{selectedItem.review.title}</p>
                  )}
                  <p className="text-neutral-400 italic">"{selectedItem.review.body}"</p>
                </div>
              )}
            </div>
          ) : (
            /* Review Form */
            <div className="space-y-4">
              {submittedSuccess ? (
                <div className="p-4 rounded-2xl bg-emerald-950/50 border border-emerald-500/30 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                  <h4 className="text-xs font-bold text-emerald-300">Review Submitted!</h4>
                  <p className="text-[10px] text-neutral-400">
                    Thank you! It will appear on the product page once our team approves it.
                  </p>
                </div>
              ) : (
                <>
                  {error && (
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                      {error}
                    </div>
                  )}

                  {/* Rating Selector */}
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                      Overall Rating *
                    </label>
                    <div className="flex items-center gap-1.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onMouseEnter={() => setHoveredRating(star)}
                          onMouseLeave={() => setHoveredRating(0)}
                          onClick={() => setRating(star)}
                          className="p-1 transition-transform hover:scale-110"
                        >
                          <Star
                            className={`w-6 h-6 ${
                              star <= (hoveredRating || rating)
                                ? "text-amber-400 fill-amber-400"
                                : "text-neutral-700"
                            }`}
                          />
                        </button>
                      ))}
                      <span className="text-xs font-bold text-amber-400 ml-2">
                        {hoveredRating || rating} / 5 Stars
                      </span>
                    </div>
                  </div>

                  {/* Title */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                      Headline (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Great fit & premium heavy fabric!"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                  {/* Body */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                      Your Review *
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Write your honest review about quality, sizing, and comfort..."
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-amber-500/50 resize-none"
                    />
                  </div>

                  {/* Photos */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                      Photos (optional)
                    </label>
                    <ReviewPhotoPicker photos={photos} onChange={setPhotos} variant="dark" />
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 text-xs font-semibold transition-colors"
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      onClick={handleSubmitReview}
                      disabled={submitting}
                      className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50"
                    >
                      {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>Submit Review</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
