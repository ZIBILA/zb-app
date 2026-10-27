"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Users,
  Search,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ArrowUpRight,
  RefreshCw,
  Wallet,
  TrendingUp,
  MousePointerClick,
  ShoppingBag,
  Ban,
  Check,
  X,
  Copy,
  ExternalLink,
  ChevronRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { formatCommissionRate } from "@/lib/affiliate/rate";
import ApproveAffiliateModal, { type ApproveAffiliateTarget } from "@/components/admin/ApproveAffiliateModal";
interface PayoutAccount {
  id: string;
  method: string;
  accountHolderName: string;
  bankName: string | null;
  last4: string | null;
  isVerified: boolean;
}

interface AffiliateRow {
  id: string;
  customerId: string;
  code: string;
  displayName: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  commissionRate: number;
  appliedAt: string;
  approvedAt: string | null;
  totalClicks: number;
  totalConversions: number;
  totalRevenue: number;
  pendingEarnings: number;
  availableBalance: number;
  lifetimeEarnings: number;
  paidOut: number;
  customer: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  payoutAccounts: PayoutAccount[];
  _count: {
    referrals: number;
    links: number;
  };
}

interface Metrics {
  totalCreators: number;
  approvedCreators: number;
  pendingApplications: number;
  suspendedCreators: number;
  totalClicks: number;
  totalConversions: number;
  totalRevenue: number;
  pendingEarnings: number;
  availableBalance: number;
  totalPaidOut: number;
}

export default function AffiliatesDashboardPage() {
  const [affiliates, setAffiliates] = useState<AffiliateRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Reject Modal state
  const [rejectingAffiliateId, setRejectingAffiliateId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [submittingAction, setSubmittingAction] = useState(false);
  const [approvingAffiliate, setApprovingAffiliate] = useState<ApproveAffiliateTarget | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  const fetchAffiliates = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/admin/affiliates?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAffiliates(data.affiliates || []);
        setMetrics(data.metrics || null);
      }
    } catch (err) {
      console.error("Error fetching affiliates:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter, searchQuery]);

  // Initial fetch and filter change
  useEffect(() => {
    fetchAffiliates();
  }, [fetchAffiliates]);

  // Visibility-gated polling (every 30 seconds only when tab is visible)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchAffiliates(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchAffiliates(true);
      }
    }, 30000);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
    };
  }, [fetchAffiliates]);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleApproveSubmit = async (commissionRate: number) => {
    if (!approvingAffiliate) return;
    setSubmittingAction(true);
    setApproveError(null);
    try {
      const res = await fetch(`/api/admin/affiliates/${approvingAffiliate.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionRate }),
      });
      if (res.ok) {
        setApprovingAffiliate(null);
        await fetchAffiliates(true);
      } else {
        const err = await res.json().catch(() => ({}));
        setApproveError(err.error || "Failed to approve affiliate");
      }
    } catch (err: any) {
      setApproveError(err.message || "Failed to approve");
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectingAffiliateId || !rejectionReason.trim()) return;
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/admin/affiliates/${rejectingAffiliateId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectionReason.trim() }),
      });
      if (res.ok) {
        setRejectingAffiliateId(null);
        setRejectionReason("");
        await fetchAffiliates(true);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to reject affiliate");
      }
    } catch (err: any) {
      alert(err.message || "Failed to reject");
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSuspend = async (id: string) => {
    const reason = prompt("Enter a reason for suspending this creator (optional):");
    if (reason === null) return; // user cancelled
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/admin/affiliates/${id}/suspend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      if (res.ok) {
        await fetchAffiliates(true);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to suspend");
      }
    } catch (err: any) {
      alert(err.message || "Failed to suspend");
    } finally {
      setSubmittingAction(false);
    }
  };

  const statusBadge = (status: AffiliateRow["status"]) => {
    switch (status) {
      case "APPROVED":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle2 className="w-3 h-3" /> Approved</span>;
      case "PENDING":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20"><Clock className="w-3 h-3" /> Pending</span>;
      case "REJECTED":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20"><XCircle className="w-3 h-3" /> Rejected</span>;
      case "SUSPENDED":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-foreground/[0.08] text-foreground/60 border border-foreground/15"><Ban className="w-3 h-3" /> Suspended</span>;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6 text-foreground">
      {/* ─── Header ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-foreground/10 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Users className="w-6 h-6 text-foreground/80" />
            Affiliate & Creator Program
          </h1>
          <p className="text-sm text-foreground/60 mt-1">
            Manage creator partnerships, review applications, and audit performance metrics.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/affiliates/withdrawals"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-background hover:bg-foreground/[0.06] border border-foreground/10 text-sm font-medium text-foreground transition-colors"
          >
            <Wallet className="w-4 h-4 text-emerald-400" />
            Payout Queue
            {metrics && metrics.availableBalance > 0 && (
              <span className="ml-1.5 px-2 py-0.5 text-[10px] rounded-full bg-emerald-500/20 text-emerald-300">
                ₹{metrics.availableBalance.toLocaleString("en-IN")}
              </span>
            )}
          </Link>

          <button
            onClick={() => fetchAffiliates()}
            disabled={refreshing}
            className="p-2 rounded-lg bg-background hover:bg-foreground/[0.06] border border-foreground/10 text-foreground/60 hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ─── Summary Metric Cards ─── */}
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-foreground/[0.03] border border-foreground/10 backdrop-blur-sm">
            <div className="flex items-center justify-between text-foreground/60 mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">Creators</span>
              <Users className="w-4 h-4 text-foreground/60" />
            </div>
            <div className="text-2xl font-bold text-foreground">{metrics.approvedCreators}</div>
            <div className="text-xs text-foreground/60 mt-1 flex items-center gap-1.5">
              <span className="text-amber-400">{metrics.pendingApplications} pending</span>
              <span>•</span>
              <span>{metrics.totalCreators} total</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-foreground/[0.03] border border-foreground/10 backdrop-blur-sm">
            <div className="flex items-center justify-between text-foreground/60 mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">Traffic & Clicks</span>
              <MousePointerClick className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-2xl font-bold text-foreground">{metrics.totalClicks.toLocaleString("en-IN")}</div>
            <div className="text-xs text-foreground/60 mt-1">
              Attributed short-link visits
            </div>
          </div>

          <div className="p-4 rounded-xl bg-foreground/[0.03] border border-foreground/10 backdrop-blur-sm">
            <div className="flex items-center justify-between text-foreground/60 mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">Attributed Revenue</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-foreground">₹{metrics.totalRevenue.toLocaleString("en-IN")}</div>
            <div className="text-xs text-emerald-400 mt-1">
              {metrics.totalConversions} conversions
            </div>
          </div>

          <div className="p-4 rounded-xl bg-foreground/[0.03] border border-foreground/10 backdrop-blur-sm">
            <div className="flex items-center justify-between text-foreground/60 mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">Creator Balance</span>
              <Wallet className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-foreground">₹{metrics.availableBalance.toLocaleString("en-IN")}</div>
            <div className="text-xs text-foreground/60 mt-1">
              Pending: ₹{metrics.pendingEarnings.toLocaleString("en-IN")} • Paid: ₹{metrics.totalPaidOut.toLocaleString("en-IN")}
            </div>
          </div>
        </div>
      )}

      {/* ─── Filter & Search Bar ─── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-foreground/[0.03] p-2.5 rounded-xl border border-foreground/10">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          {[
            { id: "ALL", label: "All Creators" },
            { id: "PENDING", label: "Pending Review" },
            { id: "APPROVED", label: "Approved" },
            { id: "SUSPENDED", label: "Suspended" },
            { id: "REJECTED", label: "Rejected" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                statusFilter === tab.id
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/50" />
          <input
            type="text"
            placeholder="Search code, email, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-background border border-foreground/10 text-sm text-foreground placeholder:text-foreground/50 focus:outline-none focus:border-foreground/15"
          />
        </div>
      </div>

      {/* ─── Affiliates Table ─── */}
      <div className="bg-foreground/[0.03] border border-foreground/10 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-foreground/80">
            <thead className="bg-foreground/[0.03] text-[11px] font-semibold text-foreground/60 uppercase tracking-wider border-b border-foreground/10">
              <tr>
                <th className="py-3 px-4">Creator / Customer</th>
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Rate</th>
                <th className="py-3 px-4">Clicks</th>
                <th className="py-3 px-4">Conversions</th>
                <th className="py-3 px-4">Attributed Rev</th>
                <th className="py-3 px-4">Available</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/10">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-foreground/50">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading creators...
                  </td>
                </tr>
              ) : affiliates.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-foreground/50">
                    No affiliates found matching the selected filter.
                  </td>
                </tr>
              ) : (
                affiliates.map((row) => (
                  <tr key={row.id} className="hover:bg-foreground/[0.05] transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-foreground">{row.displayName || row.customer?.name || "Unnamed"}</div>
                      <div className="text-xs text-foreground/60">{row.customer?.email || row.customer?.phone || "—"}</div>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleCopyCode(row.code)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-foreground/[0.06] border border-foreground/15 font-mono text-xs text-foreground hover:bg-foreground/10 transition-colors"
                        title="Click to copy code"
                      >
                        {row.code}
                        {copiedCode === row.code ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-foreground/60" />}
                      </button>
                    </td>
                    <td className="py-3 px-4">{statusBadge(row.status)}</td>
                    <td className="py-3 px-4 font-mono text-xs">{formatCommissionRate(row.commissionRate)}</td>
                    <td className="py-3 px-4 font-mono text-xs text-foreground/80">{row.totalClicks.toLocaleString("en-IN")}</td>
                    <td className="py-3 px-4 font-mono text-xs text-foreground/80">{row.totalConversions.toLocaleString("en-IN")}</td>
                    <td className="py-3 px-4 font-mono text-xs text-emerald-400 font-medium">₹{row.totalRevenue.toLocaleString("en-IN")}</td>
                    <td className="py-3 px-4 font-mono text-xs text-amber-300 font-medium">₹{row.availableBalance.toLocaleString("en-IN")}</td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        {row.status === "PENDING" && (
                          <>
                            <button
                              onClick={() => {
                                setApproveError(null);
                                setApprovingAffiliate({
                                  id: row.id,
                                  name: row.displayName || row.customer?.name || "Unnamed",
                                  code: row.code,
                                  commissionRate: row.commissionRate,
                                });
                              }}
                              disabled={submittingAction}
                              className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium border border-emerald-500/30 transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => setRejectingAffiliateId(row.id)}
                              disabled={submittingAction}
                              className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-medium border border-rose-500/30 transition-colors"
                            >
                              Reject
                            </button>
                          </>
                        )}

                        {row.status === "APPROVED" && (
                          <button
                            onClick={() => handleSuspend(row.id)}
                            disabled={submittingAction}
                            className="px-2.5 py-1 rounded bg-foreground/[0.06] hover:bg-foreground/10 text-foreground/80 text-xs font-medium transition-colors"
                          >
                            Suspend
                          </button>
                        )}

                        <Link
                          href={`/dashboard/affiliates/${row.id}`}
                          className="p-1.5 rounded hover:bg-foreground/[0.06] text-foreground/60 hover:text-foreground transition-colors"
                          title="View Detail"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ApproveAffiliateModal
        target={approvingAffiliate}
        submitting={submittingAction}
        error={approveError}
        onCancel={() => setApprovingAffiliate(null)}
        onConfirm={handleApproveSubmit}
      />

      {/* ─── Rejection Modal ─── */}
      <AnimatePresence>
        {rejectingAffiliateId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border border-foreground/10 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-foreground/10 pb-3">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-rose-400" />
                  Reject Affiliate Application
                </h3>
                <button
                  onClick={() => setRejectingAffiliateId(null)}
                  className="text-foreground/50 hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground/60">Reason for rejection</label>
                <textarea
                  rows={3}
                  placeholder="e.g. Account does not meet minimum active order history requirements."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full p-2.5 rounded-lg bg-background border border-foreground/10 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-foreground/15"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setRejectingAffiliateId(null)}
                  className="px-3.5 py-1.5 rounded-lg bg-foreground/[0.06] hover:bg-foreground/10 text-xs font-medium text-foreground/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRejectSubmit}
                  disabled={!rejectionReason.trim() || submittingAction}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-xs font-medium text-white transition-colors"
                >
                  {submittingAction ? "Rejecting..." : "Confirm Rejection"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
