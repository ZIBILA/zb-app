"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  TrendingUp,
  ShoppingBag,
  Users,
  Tag,
  ArrowRight,
  AlertCircle,
  Clock,
  CheckCircle,
  Truck,
  Sparkles
} from "lucide-react";
import { motion } from "framer-motion";

interface Metrics {
  totalSales: number;
  totalOrdersCount: number;
  unfulfilledCount: number;
  activeCouponsCount: number;
  activeBannersCount: number;
}

interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  totalAmount: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  createdAt: string;
}

interface Coupon {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  usedCount: number;
}

export default function WebStoreDashboardOverview() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [topCoupons, setTopCoupons] = useState<Coupon[]>([]);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/web-store/stats");
        if (!res.ok) {
          throw new Error("Failed to load dashboard metrics");
        }
        const data = await res.json();
        setMetrics(data.metrics);
        setRecentOrders(data.recentOrders || []);
        setTopCoupons(data.topCoupons || []);
      } catch (err: any) {
        setError(err.message || "An unexpected error occurred");
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getFulfillmentBadge = (status: string) => {
    switch (status) {
      case "delivered":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle className="w-3 h-3" /> Delivered</span>;
      case "shipped":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20"><Truck className="w-3 h-3" /> Shipped</span>;
      case "processing":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20"><Clock className="w-3 h-3" /> Processing</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20"><AlertCircle className="w-3 h-3" /> Unfulfilled</span>;
    }
  };

  const getPaymentBadge = (status: string) => {
    switch (status) {
      case "paid":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Paid</span>;
      case "failed":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">Failed</span>;
      case "refunded":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">Refunded</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Pending</span>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="flex flex-col gap-2">
          <div className="h-6 w-48 bg-foreground/10 rounded-lg" />
          <div className="h-4 w-72 bg-foreground/5 rounded-md" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-foreground/5 rounded-3xl border border-foreground/5" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-96 bg-foreground/5 rounded-3xl border border-foreground/5" />
          <div className="h-96 bg-foreground/5 rounded-3xl border border-foreground/5" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center glass rounded-[2rem] border border-red-500/15 p-8 max-w-xl mx-auto">
        <AlertCircle className="w-16 h-16 text-rose-500 mb-4" />
        <h3 className="text-lg font-bold text-foreground mb-2">Failed to Load Dashboard</h3>
        <p className="text-sm text-foreground/60 mb-6">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2.5 rounded-xl bg-foreground text-background font-semibold hover:opacity-90 transition-opacity"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Title section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-inter flex items-center gap-2">
            Overview <Sparkles className="w-5 h-5 text-amber-500" />
          </h1>
          <p className="text-[12px] text-foreground/50 mt-1">
            Real-time analytics and management for the zicabella.com web storefront.
          </p>
        </div>
        <div className="text-[11px] text-foreground/40 font-mono bg-foreground/5 px-3 py-1.5 rounded-xl border border-foreground/5">
          Live sync: SUPABASE SECURE
        </div>
      </div>

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Metric: Revenue */}
        <motion.div
          whileHover={{ y: -4 }}
          className="glass rounded-3xl p-6 border border-foreground/5 relative overflow-hidden flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-foreground/40 uppercase tracking-wider">
              Total Revenue
            </span>
            <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/10">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <h2 className="text-3xl font-extrabold tracking-tight font-inter">
              {formatCurrency(metrics?.totalSales || 0)}
            </h2>
            <p className="text-[10px] text-emerald-400 mt-2 flex items-center gap-1">
              <span>+100%</span> from web checkout launch
            </p>
          </div>
        </motion.div>

        {/* Metric: Orders */}
        <motion.div
          whileHover={{ y: -4 }}
          className="glass rounded-3xl p-6 border border-foreground/5 relative overflow-hidden flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-foreground/40 uppercase tracking-wider">
              Web Store Orders
            </span>
            <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/10">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <h2 className="text-3xl font-extrabold tracking-tight font-inter">
              {metrics?.totalOrdersCount || 0}
            </h2>
            <p className="text-[10px] text-foreground/40 mt-2">
              Lifetime successful web checkouts
            </p>
          </div>
        </motion.div>

        {/* Metric: Unfulfilled Backlog */}
        <motion.div
          whileHover={{ y: -4 }}
          className="glass rounded-3xl p-6 border border-foreground/5 relative overflow-hidden flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-foreground/40 uppercase tracking-wider">
              Fulfillment Backlog
            </span>
            <div className="p-2.5 rounded-2xl bg-rose-500/10 text-rose-500 border border-rose-500/10">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <h2 className="text-3xl font-extrabold tracking-tight font-inter">
              {metrics?.unfulfilledCount || 0}
            </h2>
            <p className="text-[10px] text-rose-400 mt-2">
              Orders requiring delivery actions
            </p>
          </div>
        </motion.div>

        {/* Metric: Active CMS / Banners */}
        <motion.div
          whileHover={{ y: -4 }}
          className="glass rounded-3xl p-6 border border-foreground/5 relative overflow-hidden flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-foreground/40 uppercase tracking-wider">
              Marketing Assets
            </span>
            <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/10">
              <Tag className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <h2 className="text-3xl font-extrabold tracking-tight font-inter">
              {metrics?.activeBannersCount || 0} <span className="text-sm font-medium text-foreground/30">banners</span>
            </h2>
            <p className="text-[10px] text-amber-400 mt-2">
              {metrics?.activeCouponsCount || 0} active coupons valid
            </p>
          </div>
        </motion.div>
      </div>

      {/* Two Column Live Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Orders Panel */}
        <div className="lg:col-span-2 glass rounded-[2rem] border border-foreground/5 p-6 md:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-foreground font-inter">Recent Web Orders</h3>
                <p className="text-[11px] text-foreground/40">Latest customer purchases on web</p>
              </div>
              <Link
                href="/dashboard/webstore/orders"
                className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-500 hover:text-amber-400 transition-colors"
              >
                View all <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {recentOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <ShoppingBag className="w-12 h-12 text-foreground/20 mb-3" />
                <p className="text-sm text-foreground/40 font-medium">No recent orders yet</p>
                <p className="text-[11px] text-foreground/30 mt-0.5">They will appear here once checkouts occur.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-foreground/5 text-[10px] font-bold text-foreground/40 uppercase tracking-wider">
                      <th className="pb-3">Order Number</th>
                      <th className="pb-3">Customer</th>
                      <th className="pb-3">Total Amount</th>
                      <th className="pb-3">Payment</th>
                      <th className="pb-3">Fulfillment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/5">
                    {recentOrders.map((order) => (
                      <tr key={order.id} className="group hover:bg-foreground/[0.01] transition-colors">
                        <td className="py-4 font-mono text-[12px] font-semibold text-foreground group-hover:text-amber-500 transition-colors">
                          <Link href={`/dashboard/webstore/orders/${order.id}`}>
                            {order.orderNumber}
                          </Link>
                        </td>
                        <td className="py-4 text-[12px] font-medium text-foreground/80">{order.customerName}</td>
                        <td className="py-4 text-[12px] font-bold text-foreground">{formatCurrency(order.totalAmount)}</td>
                        <td className="py-4">{getPaymentBadge(order.paymentStatus)}</td>
                        <td className="py-4">{getFulfillmentBadge(order.fulfillmentStatus)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Coupons performance Panel */}
        <div className="glass rounded-[2rem] border border-foreground/5 p-6 md:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-foreground font-inter">Top Coupons</h3>
                <p className="text-[11px] text-foreground/40">Highest usage discount codes</p>
              </div>
              <Link
                href="/dashboard/webstore/coupons"
                className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-500 hover:text-amber-400 transition-colors"
              >
                Manage <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {topCoupons.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Tag className="w-12 h-12 text-foreground/20 mb-3" />
                <p className="text-sm text-foreground/40 font-medium">No coupons active</p>
                <p className="text-[11px] text-foreground/30 mt-0.5">Create your first promo code to start tracking stats.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {topCoupons.map((coupon) => (
                  <div
                    key={coupon.id}
                    className="flex items-center justify-between p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/5 group hover:border-amber-500/20 transition-all duration-300"
                  >
                    <div>
                      <span className="font-mono text-[12px] font-bold text-foreground bg-foreground/5 px-2.5 py-1 rounded-lg border border-foreground/5">
                        {coupon.code}
                      </span>
                      <p className="text-[10px] text-foreground/40 mt-2 font-medium">
                        Discount: {coupon.discountType === "percentage" ? `${coupon.discountValue}%` : formatCurrency(coupon.discountValue)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-[14px] font-extrabold text-foreground">{coupon.usedCount}</span>
                      <p className="text-[9px] text-foreground/40 font-medium uppercase tracking-wider mt-0.5">Uses</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
