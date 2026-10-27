"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Star,
  Search,
  Plus,
  Eye,
  EyeOff,
  Edit2,
  Trash2,
  Filter,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  User,
  ShoppingBag,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ThumbsUp,
  MessageSquare,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type ReviewProduct = {
  id: string;
  title: string;
  slug: string;
  price: number;
  image: string | null;
};

type ReviewUser = {
  id: string;
  name: string;
  email: string;
};

type Review = {
  id: string;
  productId: string;
  orderId: string;
  userId: string;
  rating: number;
  title: string | null;
  body: string;
  verifiedPurchase: boolean;
  status: "VISIBLE" | "HIDDEN";
  createdAt: string;
  updatedAt: string;
  product: ReviewProduct | null;
  user: ReviewUser | null;
};

type Stats = {
  totalReviews: number;
  visibleCount: number;
  hiddenCount: number;
  avgRating: number;
  fiveStarRatio: number;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type AvailableProduct = {
  id: string;
  title: string;
  featuredImage?: string | null;
};

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalReviews: 0,
    visibleCount: 0,
    hiddenCount: 0,
    avgRating: 0,
    fiveStarRatio: 0,
  });
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "VISIBLE" | "HIDDEN">("ALL");
  const [ratingFilter, setRatingFilter] = useState<string>("ALL");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "rating_desc" | "rating_asc">("newest");

  // Notifications
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Action states
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [deletingReview, setDeletingReview] = useState<Review | null>(null);

  // Products for Add Modal
  const [availableProducts, setAvailableProducts] = useState<AvailableProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Form states
  const [formProductId, setFormProductId] = useState("");
  const [formRating, setFormRating] = useState(5);
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formReviewerName, setFormReviewerName] = useState("");
  const [formReviewerEmail, setFormReviewerEmail] = useState("");
  const [formVerified, setFormVerified] = useState(true);
  const [formStatus, setFormStatus] = useState<"VISIBLE" | "HIDDEN">("VISIBLE");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const showNotification = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch reviews from API
  const fetchReviews = useCallback(
    async (pageNum = 1, isSilent = false) => {
      if (!isSilent) setLoading(true);
      else setRefreshing(true);

      try {
        const params = new URLSearchParams();
        params.set("page", pageNum.toString());
        params.set("limit", pagination.limit.toString());
        params.set("status", statusFilter);
        params.set("rating", ratingFilter);
        params.set("sort", sortOrder);
        if (debouncedSearch) params.set("search", debouncedSearch);

        const res = await fetch(`/api/admin/reviews?${params.toString()}`);
        const data = await res.json();

        if (res.ok && data.success) {
          setReviews(data.reviews || []);
          if (data.stats) setStats(data.stats);
          if (data.pagination) setPagination(data.pagination);
        } else {
          showNotification(data.error || "Failed to fetch reviews", "error");
        }
      } catch (err) {
        console.error("Error fetching admin reviews:", err);
        showNotification("Failed to connect to server", "error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [statusFilter, ratingFilter, sortOrder, debouncedSearch, pagination.limit]
  );

  useEffect(() => {
    fetchReviews(1);
  }, [fetchReviews]);

  // Fetch available products for Add Review modal
  const fetchProductsForAdd = async () => {
    if (availableProducts.length > 0) return;
    setLoadingProducts(true);
    try {
      const res = await fetch("/api/admin/products-list");
      if (res.ok) {
        const data = await res.json();
        const prods = data.products || data || [];
        setAvailableProducts(
          prods.map((p: any) => ({
            id: p.id,
            title: p.title,
            featuredImage: p.featuredImage || p.image,
          }))
        );
      }
    } catch (err) {
      console.error("Failed to fetch products list:", err);
    } finally {
      setLoadingProducts(false);
    }
  };

  // Toggle Visibility
  const toggleVisibility = async (review: Review) => {
    const newStatus = review.status === "VISIBLE" ? "HIDDEN" : "VISIBLE";
    setActionLoadingId(review.id);

    try {
      const res = await fetch(`/api/admin/reviews/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setReviews((prev) =>
          prev.map((r) => (r.id === review.id ? { ...r, status: newStatus } : r))
        );
        setStats((prev) => ({
          ...prev,
          visibleCount: newStatus === "VISIBLE" ? prev.visibleCount + 1 : prev.visibleCount - 1,
          hiddenCount: newStatus === "HIDDEN" ? prev.hiddenCount + 1 : prev.hiddenCount - 1,
        }));
        showNotification(`Review status updated to ${newStatus}`);
      } else {
        showNotification(data.error || "Failed to update review status", "error");
      }
    } catch {
      showNotification("Error updating review status", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  // Open Edit Modal
  const openEditModal = (review: Review) => {
    setEditingReview(review);
    setFormRating(review.rating);
    setFormTitle(review.title || "");
    setFormBody(review.body);
    setFormVerified(review.verifiedPurchase);
    setFormStatus(review.status);
    setFormError(null);
  };

  // Submit Edit Review
  const handleSaveEdit = async () => {
    if (!editingReview) return;
    if (formBody.trim().length < 3) {
      setFormError("Review body must be at least 3 characters long");
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch(`/api/admin/reviews/${editingReview.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: formRating,
          title: formTitle.trim() || undefined,
          body: formBody.trim(),
          verifiedPurchase: formVerified,
          status: formStatus,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showNotification("Review updated successfully");
        setEditingReview(null);
        fetchReviews(pagination.page, true);
      } else {
        setFormError(data.error || "Failed to update review");
      }
    } catch {
      setFormError("Network error while updating review");
    } finally {
      setFormSubmitting(false);
    }
  };

  // Delete Review
  const handleDeleteReview = async () => {
    if (!deletingReview) return;
    setActionLoadingId(deletingReview.id);

    try {
      const res = await fetch(`/api/admin/reviews/${deletingReview.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showNotification("Review permanently deleted");
        setDeletingReview(null);
        fetchReviews(pagination.page, true);
      } else {
        showNotification(data.error || "Failed to delete review", "error");
      }
    } catch {
      showNotification("Error deleting review", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  // Open Add Modal
  const openAddModal = () => {
    fetchProductsForAdd();
    setFormProductId("");
    setFormRating(5);
    setFormTitle("");
    setFormBody("");
    setFormReviewerName("");
    setFormReviewerEmail("");
    setFormVerified(true);
    setFormStatus("VISIBLE");
    setFormError(null);
    setShowAddModal(true);
  };

  // Submit New Review
  const handleCreateReview = async () => {
    if (!formProductId) {
      setFormError("Please select a product");
      return;
    }
    if (formBody.trim().length < 3) {
      setFormError("Please write a review body (minimum 3 characters)");
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch("/api/admin/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: formProductId,
          rating: formRating,
          title: formTitle.trim() || undefined,
          body: formBody.trim(),
          reviewerName: formReviewerName.trim() || undefined,
          reviewerEmail: formReviewerEmail.trim() || undefined,
          verifiedPurchase: formVerified,
          status: formStatus,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showNotification("Review added successfully!");
        setShowAddModal(false);
        fetchReviews(1, true);
      } else {
        setFormError(data.error || "Failed to create review");
      }
    } catch {
      setFormError("Network error while creating review");
    } finally {
      setFormSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-neutral-100 p-4 sm:p-6 lg:p-8 font-sans selection:bg-amber-500 selection:text-black">
      {/* Notification Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-xl ${
              toast.type === "success"
                ? "bg-emerald-950/90 border-emerald-500/30 text-emerald-300"
                : "bg-rose-950/90 border-rose-500/30 text-rose-300"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span className="text-xs font-semibold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-foreground/10 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Product Reviews</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Live Feedback
              </span>
            </div>
            <p className="text-xs text-foreground/60 mt-1">
              Manage, moderate, and publish customer ratings and reviews across your product store.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchReviews(pagination.page, true)}
              disabled={refreshing}
              className="p-2.5 rounded-xl border border-foreground/10 bg-foreground/5 hover:bg-foreground/10 text-foreground/80 transition-colors disabled:opacity-50"
              title="Refresh Reviews"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>

            <button
              onClick={openAddModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs shadow-lg shadow-amber-500/20 transition-all active:scale-[0.98]"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Add Review</span>
            </button>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          <div className="p-4 rounded-2xl bg-foreground/[0.03] border border-foreground/5 backdrop-blur-xl relative overflow-hidden group hover:border-foreground/10 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">Total Reviews</span>
              <MessageSquare className="w-4 h-4 text-foreground/50" />
            </div>
            <p className="text-2xl font-extrabold text-foreground mt-2">{stats.totalReviews}</p>
            <p className="text-[10px] text-foreground/50 mt-1">Store-wide reviews</p>
          </div>

          <div className="p-4 rounded-2xl bg-foreground/[0.03] border border-amber-500/10 backdrop-blur-xl relative overflow-hidden group hover:border-amber-500/20 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Average Rating</span>
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
            </div>
            <div className="flex items-baseline gap-1.5 mt-2">
              <p className="text-2xl font-extrabold text-amber-400">{stats.avgRating.toFixed(1)}</p>
              <span className="text-xs text-foreground/60">/ 5.0</span>
            </div>
            <p className="text-[10px] text-foreground/50 mt-1">From visible reviews</p>
          </div>

          <div className="p-4 rounded-2xl bg-foreground/[0.03] border border-emerald-500/10 backdrop-blur-xl relative overflow-hidden group hover:border-emerald-500/20 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Published</span>
              <Eye className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-extrabold text-emerald-400 mt-2">{stats.visibleCount}</p>
            <p className="text-[10px] text-emerald-500/70 mt-1">Visible on storefront</p>
          </div>

          <div className="p-4 rounded-2xl bg-foreground/[0.03] border border-rose-500/10 backdrop-blur-xl relative overflow-hidden group hover:border-rose-500/20 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-rose-400">Hidden</span>
              <EyeOff className="w-4 h-4 text-rose-400" />
            </div>
            <p className="text-2xl font-extrabold text-rose-400 mt-2">{stats.hiddenCount}</p>
            <p className="text-[10px] text-rose-500/70 mt-1">Moderated / Hidden</p>
          </div>

          <div className="p-4 rounded-2xl bg-foreground/[0.03] border border-indigo-500/10 backdrop-blur-xl relative overflow-hidden col-span-2 sm:col-span-1 group hover:border-indigo-500/20 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">5-Star Ratio</span>
              <ThumbsUp className="w-4 h-4 text-indigo-400" />
            </div>
            <p className="text-2xl font-extrabold text-indigo-400 mt-2">{stats.fiveStarRatio}%</p>
            <p className="text-[10px] text-foreground/50 mt-1">Top tier feedback</p>
          </div>
        </div>

        {/* Filter and Search Toolbar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-4 rounded-2xl bg-foreground/[0.03] border border-foreground/5 backdrop-blur-xl">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/50" />
            <input
              type="text"
              placeholder="Search by product, customer, title, text, or order..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-background border border-foreground/10 text-xs text-foreground placeholder:text-foreground/50 focus:outline-none focus:border-amber-500/50 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/50 hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filter options */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Tabs */}
            <div className="flex items-center p-1 rounded-xl bg-background border border-foreground/10 text-xs">
              <button
                onClick={() => setStatusFilter("ALL")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  statusFilter === "ALL"
                    ? "bg-white/10 text-white shadow"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setStatusFilter("VISIBLE")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  statusFilter === "VISIBLE"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                Visible
              </button>
              <button
                onClick={() => setStatusFilter("HIDDEN")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  statusFilter === "HIDDEN"
                    ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                Hidden
              </button>
            </div>

            {/* Rating Filter */}
            <select
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-background border border-foreground/10 text-xs text-foreground/80 focus:outline-none focus:border-amber-500/50"
            >
              <option value="ALL">All Ratings</option>
              <option value="5">★ ★ ★ ★ ★ (5 Stars)</option>
              <option value="4">★ ★ ★ ★ ☆ (4 Stars)</option>
              <option value="3">★ ★ ★ ☆ ☆ (3 Stars)</option>
              <option value="2">★ ★ ☆ ☆ ☆ (2 Stars)</option>
              <option value="1">★ ☆ ☆ ☆ ☆ (1 Star)</option>
            </select>

            {/* Sort Order */}
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as any)}
              className="px-3 py-2 rounded-xl bg-background border border-foreground/10 text-xs text-foreground/80 focus:outline-none focus:border-amber-500/50"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="rating_desc">Highest Rating</option>
              <option value="rating_asc">Lowest Rating</option>
            </select>
          </div>
        </div>

        {/* Reviews Content Area */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 bg-foreground/[0.03] rounded-2xl border border-foreground/5">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin mb-3" />
            <p className="text-xs text-foreground/60">Loading product reviews...</p>
          </div>
        ) : reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-foreground/[0.03] rounded-2xl border border-foreground/5 text-center px-4">
            <MessageSquare className="w-12 h-12 text-foreground/40 mb-3" />
            <h3 className="text-base font-bold text-foreground/80">No Product Reviews Found</h3>
            <p className="text-xs text-foreground/50 max-w-sm mt-1">
              {debouncedSearch || statusFilter !== "ALL" || ratingFilter !== "ALL"
                ? "No reviews match your filter criteria. Try resetting filters."
                : "No customer reviews have been submitted yet. Click 'Add Review' to create one."}
            </p>
            {(debouncedSearch || statusFilter !== "ALL" || ratingFilter !== "ALL") && (
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter("ALL");
                  setRatingFilter("ALL");
                }}
                className="mt-4 px-4 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-xs font-semibold text-foreground/80 border border-foreground/10 transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              {reviews.map((review) => (
                <div
                  key={review.id}
                  className={`p-4 rounded-2xl bg-foreground/[0.03] border transition-all ${
                    review.status === "VISIBLE"
                      ? "border-white/5 hover:border-white/15"
                      : "border-rose-500/20 bg-rose-950/10"
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    {/* Left: Product & Review Content */}
                    <div className="flex items-start gap-4 flex-1">
                      {/* Product Thumbnail */}
                      <div className="w-14 h-14 rounded-xl bg-foreground/[0.06] border border-foreground/10 overflow-hidden shrink-0 relative">
                        {review.product?.image ? (
                          <Image
                            src={review.product.image}
                            alt={review.product.title || "Product"}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-foreground/40">
                            <ShoppingBag className="w-6 h-6" />
                          </div>
                        )}
                      </div>

                      {/* Details */}
                      <div className="space-y-1.5 flex-1 min-w-0">
                        {/* Product Title & Link */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            href={review.product?.slug ? `/products/${review.product.slug}` : "#"}
                            target="_blank"
                            className="text-xs font-bold text-foreground hover:text-amber-400 flex items-center gap-1 transition-colors truncate"
                          >
                            <span>{review.product?.title || `Product (${review.productId})`}</span>
                            <ExternalLink className="w-3 h-3 text-foreground/50 shrink-0" />
                          </Link>

                          {review.verifiedPurchase && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              Verified Purchase
                            </span>
                          )}

                          <span
                            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                              review.status === "VISIBLE"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            }`}
                          >
                            {review.status}
                          </span>
                        </div>

                        {/* Star Rating & Reviewer info */}
                        <div className="flex items-center gap-3 text-xs flex-wrap">
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className={`w-3.5 h-3.5 ${
                                  star <= review.rating
                                    ? "text-amber-400 fill-amber-400"
                                    : "text-neutral-700"
                                }`}
                              />
                            ))}
                          </div>

                          <span className="text-foreground/60 text-[11px]">
                            by <span className="font-semibold text-foreground">{review.user?.name || "Customer"}</span>
                            {review.user?.email && ` (${review.user.email})`}
                          </span>

                          <span className="text-foreground/50 text-[10px]">
                            Order: <span className="font-mono text-foreground/60">{review.orderId}</span>
                          </span>

                          <span className="text-foreground/50 text-[10px]">
                            {new Date(review.createdAt).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        </div>

                        {/* Title & Body */}
                        {review.title && (
                          <h4 className="text-xs font-bold text-foreground mt-1">{review.title}</h4>
                        )}
                        <p className="text-xs text-neutral-300 leading-relaxed bg-black/20 p-2.5 rounded-xl border border-foreground/5">
                          "{review.body}"
                        </p>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center md:flex-col gap-2 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-foreground/5">
                      <button
                        onClick={() => toggleVisibility(review)}
                        disabled={actionLoadingId === review.id}
                        className={`flex-1 md:w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                          review.status === "VISIBLE"
                            ? "bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30"
                            : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        }`}
                      >
                        {actionLoadingId === review.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : review.status === "VISIBLE" ? (
                          <>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span>Hide</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>Publish</span>
                          </>
                        )}
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditModal(review)}
                          className="p-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/80 hover:text-foreground border border-foreground/10 transition-colors"
                          title="Edit Review"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => setDeletingReview(review)}
                          className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-colors"
                          title="Delete Review"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between p-4 rounded-2xl bg-foreground/[0.03] border border-foreground/5 text-xs text-foreground/60">
                <span>
                  Showing {reviews.length} of {pagination.total} reviews
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchReviews(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-background border border-foreground/10 text-foreground disabled:opacity-40 hover:bg-foreground/5 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Prev</span>
                  </button>

                  <span className="font-semibold text-foreground px-2">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>

                  <button
                    onClick={() => fetchReviews(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-background border border-foreground/10 text-foreground disabled:opacity-40 hover:bg-foreground/5 transition-colors"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Review Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-background border border-foreground/10 rounded-2xl p-6 shadow-2xl space-y-4 relative"
            >
              <div className="flex items-center justify-between border-b border-foreground/10 pb-4">
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Plus className="w-4 h-4 text-amber-500" />
                  <span>Add Manual Product Review</span>
                </h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-foreground/60 hover:text-foreground p-1 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                  {formError}
                </div>
              )}

              <div className="space-y-3.5 text-xs">
                {/* Product Select */}
                <div>
                  <label className="block text-foreground/60 font-bold uppercase tracking-wider mb-1">
                    Select Product *
                  </label>
                  {loadingProducts ? (
                    <div className="flex items-center gap-2 text-foreground/60 py-2">
                      <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                      <span>Loading products...</span>
                    </div>
                  ) : (
                    <select
                      value={formProductId}
                      onChange={(e) => setFormProductId(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-background border border-foreground/10 text-foreground focus:outline-none focus:border-amber-500/50"
                    >
                      <option value="">-- Choose a product --</option>
                      {availableProducts.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          {prod.title} (ID: {prod.id.slice(-8)})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Rating selection */}
                <div>
                  <label className="block text-foreground/60 font-bold uppercase tracking-wider mb-1">
                    Star Rating (1-5) *
                  </label>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setFormRating(star)}
                        className="p-1 text-2xl transition-transform hover:scale-110"
                      >
                        <Star
                          className={`w-6 h-6 ${
                            star <= formRating
                              ? "text-amber-400 fill-amber-400"
                              : "text-neutral-700"
                          }`}
                        />
                      </button>
                    ))}
                    <span className="font-bold text-amber-400 text-sm ml-2">{formRating} / 5 Stars</span>
                  </div>
                </div>

                {/* Review Title */}
                <div>
                  <label className="block text-foreground/60 font-bold uppercase tracking-wider mb-1">
                    Review Headline / Title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Absolutely stunning quality!"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-background border border-foreground/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-amber-500/50"
                  />
                </div>

                {/* Review Body */}
                <div>
                  <label className="block text-foreground/60 font-bold uppercase tracking-wider mb-1">
                    Review Content *
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Write detailed customer feedback..."
                    value={formBody}
                    onChange={(e) => setFormBody(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-background border border-foreground/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-amber-500/50 resize-none"
                  />
                </div>

                {/* Reviewer Details */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-foreground/60 font-bold uppercase tracking-wider mb-1">
                      Reviewer Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Priya Sharma"
                      value={formReviewerName}
                      onChange={(e) => setFormReviewerName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-background border border-foreground/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                  <div>
                    <label className="block text-foreground/60 font-bold uppercase tracking-wider mb-1">
                      Reviewer Email
                    </label>
                    <input
                      type="email"
                      placeholder="priya@example.com"
                      value={formReviewerEmail}
                      onChange={(e) => setFormReviewerEmail(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-background border border-foreground/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>
                </div>

                {/* Toggles */}
                <div className="flex items-center justify-between pt-2 border-t border-foreground/5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formVerified}
                      onChange={(e) => setFormVerified(e.target.checked)}
                      className="rounded border-foreground/10 bg-background text-amber-500 focus:ring-amber-500"
                    />
                    <span className="text-foreground/80 font-medium">Verified Purchase Badge</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <span className="text-foreground/60 font-medium">Initial Status:</span>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as any)}
                      className="px-2.5 py-1 rounded-lg bg-background border border-foreground/10 text-foreground font-bold"
                    >
                      <option value="VISIBLE">VISIBLE</option>
                      <option value="HIDDEN">HIDDEN</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-foreground/10">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/80 font-semibold text-xs transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleCreateReview}
                  disabled={formSubmitting}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  {formSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Review</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Review Modal */}
      <AnimatePresence>
        {editingReview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-background border border-foreground/10 rounded-2xl p-6 shadow-2xl space-y-4 relative"
            >
              <div className="flex items-center justify-between border-b border-foreground/10 pb-4">
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Edit2 className="w-4 h-4 text-amber-500" />
                  <span>Edit Review</span>
                </h3>
                <button
                  onClick={() => setEditingReview(null)}
                  className="text-foreground/60 hover:text-foreground p-1 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                  {formError}
                </div>
              )}

              <div className="space-y-3.5 text-xs">
                {/* Rating selection */}
                <div>
                  <label className="block text-foreground/60 font-bold uppercase tracking-wider mb-1">
                    Star Rating
                  </label>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setFormRating(star)}
                        className="p-1 text-2xl transition-transform hover:scale-110"
                      >
                        <Star
                          className={`w-6 h-6 ${
                            star <= formRating
                              ? "text-amber-400 fill-amber-400"
                              : "text-neutral-700"
                          }`}
                        />
                      </button>
                    ))}
                    <span className="font-bold text-amber-400 text-sm ml-2">{formRating} / 5 Stars</span>
                  </div>
                </div>

                {/* Title */}
                <div>
                  <label className="block text-foreground/60 font-bold uppercase tracking-wider mb-1">
                    Review Headline / Title
                  </label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-background border border-foreground/10 text-foreground focus:outline-none focus:border-amber-500/50"
                  />
                </div>

                {/* Body */}
                <div>
                  <label className="block text-foreground/60 font-bold uppercase tracking-wider mb-1">
                    Review Content *
                  </label>
                  <textarea
                    rows={4}
                    value={formBody}
                    onChange={(e) => setFormBody(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-background border border-foreground/10 text-foreground focus:outline-none focus:border-amber-500/50 resize-none"
                  />
                </div>

                {/* Status and Verified */}
                <div className="flex items-center justify-between pt-2 border-t border-foreground/5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formVerified}
                      onChange={(e) => setFormVerified(e.target.checked)}
                      className="rounded border-foreground/10 bg-background text-amber-500 focus:ring-amber-500"
                    />
                    <span className="text-foreground/80 font-medium">Verified Purchase Badge</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <span className="text-foreground/60 font-medium">Status:</span>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as any)}
                      className="px-2.5 py-1 rounded-lg bg-background border border-foreground/10 text-foreground font-bold"
                    >
                      <option value="VISIBLE">VISIBLE</option>
                      <option value="HIDDEN">HIDDEN</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-foreground/10">
                <button
                  type="button"
                  onClick={() => setEditingReview(null)}
                  className="px-4 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/80 font-semibold text-xs transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={formSubmitting}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  {formSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Modal */}
      <AnimatePresence>
        {deletingReview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-background border border-rose-500/20 rounded-2xl p-6 shadow-2xl space-y-4 relative text-center"
            >
              <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>

              <div>
                <h3 className="text-base font-bold text-foreground">Delete Product Review?</h3>
                <p className="text-xs text-foreground/60 mt-1">
                  This action will permanently delete the review from your database and update product rating aggregates.
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setDeletingReview(null)}
                  className="px-4 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/80 font-semibold text-xs transition-colors"
                >
                  Cancel
                </button>

                <button
                  onClick={handleDeleteReview}
                  disabled={actionLoadingId === deletingReview.id}
                  className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {actionLoadingId === deletingReview.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Permanently Delete</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
