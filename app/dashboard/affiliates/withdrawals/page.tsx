"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Wallet,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Search,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  X,
  CreditCard
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/** Every creator's current payout account — masked; full details via the audit-logged reveal endpoint. */
function SavedPayoutAccounts() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Record<string, any>>({});
  const [revealing, setRevealing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/affiliates/payout-accounts");
      if (res.ok) setAccounts((await res.json()).accounts || []);
    } catch (err) {
      console.error("Error fetching payout accounts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reveal = async (affiliateId: string) => {
    setRevealing(affiliateId);
    try {
      const res = await fetch(`/api/admin/affiliates/${affiliateId}/reveal-bank`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.account) setRevealed((r) => ({ ...r, [affiliateId]: data.account }));
      else alert(data.error || "Could not reveal bank details");
    } finally {
      setRevealing(null);
    }
  };

  return (
    <div className="bg-foreground/[0.03] border border-foreground/10 rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-foreground/10 flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-foreground">Saved Payout Accounts</h2>
        <span className="text-xs text-foreground/50">({accounts.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-foreground/80">
          <thead className="bg-foreground/[0.03] text-[11px] font-semibold text-foreground/60 uppercase tracking-wider border-b border-foreground/10">
            <tr>
              <th className="py-3 px-4">Creator</th>
              <th className="py-3 px-4">Account Holder</th>
              <th className="py-3 px-4">Bank</th>
              <th className="py-3 px-4">Account Number</th>
              <th className="py-3 px-4">IFSC</th>
              <th className="py-3 px-4">Saved</th>
              <th className="py-3 px-4 text-right">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/10">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-foreground/50">
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto" />
                </td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-foreground/50 text-xs">
                  No creator has saved bank details yet.
                </td>
              </tr>
            ) : (
              accounts.map((a) => {
                const full = revealed[a.affiliate.id];
                const isUpi = a.method === "UPI";
                return (
                  <tr key={a.id} className="hover:bg-foreground/[0.05]">
                    <td className="py-3 px-4">
                      <Link href={`/dashboard/affiliates/${a.affiliate.id}`} className="text-foreground hover:underline">
                        {a.affiliate.name || a.affiliate.code}
                      </Link>
                      <div className="text-[11px] text-foreground/50">{a.affiliate.code}</div>
                    </td>
                    <td className="py-3 px-4">{a.accountHolderName}</td>
                    <td className="py-3 px-4">{isUpi ? "UPI (legacy)" : a.bankName || "—"}</td>
                    <td className="py-3 px-4 font-mono">
                      {full ? (isUpi ? full.upiId : full.accountNumber) : `••••${a.last4 || ""}`}
                    </td>
                    <td className="py-3 px-4 font-mono">{full ? full.ifsc || "—" : "•••••••••••"}</td>
                    <td className="py-3 px-4 text-xs text-foreground/60">{new Date(a.updatedAt).toLocaleString()}</td>
                    <td className="py-3 px-4 text-right">
                      {full ? (
                        <button
                          onClick={() => navigator.clipboard?.writeText(`${full.accountHolderName}\n${full.accountNumber || full.upiId}\n${full.ifsc || ""}`)}
                          className="px-2.5 py-1 rounded bg-foreground/[0.06] hover:bg-foreground/10 text-foreground/80 text-xs font-medium transition-colors"
                        >
                          Copy
                        </button>
                      ) : (
                        <button
                          onClick={() => reveal(a.affiliate.id)}
                          disabled={revealing === a.affiliate.id}
                          className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-medium border border-emerald-500/30 transition-colors disabled:opacity-50"
                        >
                          {revealing === a.affiliate.id ? "Revealing…" : "Reveal"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2.5 text-[11px] text-foreground/50 border-t border-foreground/10">
        Full details are decrypted only on Reveal, and every reveal is recorded in the audit log.
      </p>
    </div>
  );
}

export default function AffiliateWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("REQUESTED");

  // Mark Paid modal state
  const [markPaidItem, setMarkPaidItem] = useState<any | null>(null);
  const [utrNumber, setUtrNumber] = useState("");
  const [submittingAction, setSubmittingAction] = useState(false);

  // Reject modal state
  const [rejectItem, setRejectItem] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchWithdrawals = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);

      const res = await fetch(`/api/admin/affiliates/withdrawals?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setWithdrawals(data.withdrawals || []);
      }
    } catch (err) {
      console.error("Error fetching withdrawals queue:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchWithdrawals();
  }, [fetchWithdrawals]);

  // Visibility-gated polling (every 30s when tab active)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchWithdrawals(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchWithdrawals(true);
    }, 30000);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
    };
  }, [fetchWithdrawals]);

  const handleApprove = async (id: string) => {
    if (!confirm("Approve this payout request? If RazorpayX is disabled, it will move to Approved awaiting manual transfer.")) return;
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/admin/affiliates/withdrawals/${id}/approve`, { method: "POST" });
      if (res.ok) {
        fetchWithdrawals(true);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to approve");
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleMarkPaidSubmit = async () => {
    if (!markPaidItem || !utrNumber.trim()) return;
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/admin/affiliates/withdrawals/${markPaidItem.id}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutRef: utrNumber.trim() }),
      });
      if (res.ok) {
        setMarkPaidItem(null);
        setUtrNumber("");
        fetchWithdrawals(true);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to settle payout");
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectItem || !rejectReason.trim()) return;
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/admin/affiliates/withdrawals/${rejectItem.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      if (res.ok) {
        setRejectItem(null);
        setRejectReason("");
        fetchWithdrawals(true);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to reject payout");
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmittingAction(false);
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "PAID":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"><CheckCircle2 className="w-3 h-3" /> Paid</span>;
      case "REQUESTED":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"><Clock className="w-3 h-3" /> Requested</span>;
      case "APPROVED":
      case "PROCESSING":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20"><Clock className="w-3 h-3" /> {status}</span>;
      case "REJECTED":
      case "FAILED":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20"><XCircle className="w-3 h-3" /> {status}</span>;
      default:
        return <span className="text-zinc-400 text-xs">{status}</span>;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6 text-zinc-100">
      {/* ─── Header ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-foreground/10 pb-5">
        <div>
          <Link
            href="/dashboard/affiliates"
            className="inline-flex items-center gap-1.5 text-xs text-foreground/60 hover:text-foreground mb-2 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Affiliates
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Wallet className="w-6 h-6 text-emerald-400" />
            Affiliate Payout Queue
          </h1>
          <p className="text-sm text-foreground/60 mt-1">
            Review creator withdrawal requests, execute payouts, and enter manual bank transfer UTR references.
          </p>
        </div>

        <button
          onClick={() => fetchWithdrawals()}
          disabled={refreshing}
          className="p-2 rounded-lg bg-background hover:bg-foreground/[0.06] border border-foreground/10 text-foreground/60 hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* ─── Filters ─── */}
      <div className="flex items-center gap-1.5 bg-foreground/[0.03] p-2.5 rounded-xl border border-foreground/10 overflow-x-auto">
        {[
          { id: "REQUESTED", label: "Requested (Action Needed)" },
          { id: "APPROVED", label: "Approved (Awaiting UTR)" },
          { id: "PROCESSING", label: "Processing" },
          { id: "PAID", label: "Paid" },
          { id: "REJECTED", label: "Rejected" },
          { id: "ALL", label: "All Records" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              statusFilter === tab.id
                ? "bg-foreground/[0.06] text-foreground shadow-sm"
                : "text-foreground/60 hover:text-foreground hover:bg-foreground/[0.05]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Table ─── */}
      <div className="bg-zinc-900/50 border border-foreground/10 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="bg-zinc-900/80 text-[11px] font-semibold text-foreground/60 uppercase tracking-wider border-b border-zinc-800">
              <tr>
                <th className="py-3 px-4">Creator</th>
                <th className="py-3 px-4">Requested At</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Payout Account</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Reference / UTR</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/10">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading withdrawal queue...
                  </td>
                </tr>
              ) : withdrawals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500">
                    No withdrawal requests found in this view.
                  </td>
                </tr>
              ) : (
                withdrawals.map((w: any) => {
                  const account = w.affiliate?.payoutAccounts?.[0];
                  return (
                    <tr key={w.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="py-3 px-4">
                        <Link
                          href={`/dashboard/affiliates/${w.affiliate?.id}`}
                          className="font-medium text-foreground hover:underline flex items-center gap-1.5"
                        >
                          {w.affiliate?.displayName || w.affiliate?.customer?.name || "Creator"}
                          <span className="font-mono text-xs text-zinc-400">({w.affiliate?.code})</span>
                        </Link>
                        <div className="text-xs text-zinc-400">{w.affiliate?.customer?.email || w.affiliate?.customer?.phone}</div>
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-400">
                        {new Date(w.requestedAt).toLocaleString("en-IN")}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono font-bold text-base text-white">
                          ₹{w.amount.toLocaleString("en-IN")}
                        </span>
                        {!w.affiliate?.firstWithdrawalDone && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300">
                            1st Withdrawal
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {account ? (
                          <div>
                            <span className="font-medium text-zinc-200">{account.accountHolderName}</span>
                            <div className="text-zinc-400 font-mono text-[11px]">
                              {account.method === "BANK" ? `${account.bankName || "Bank"} ••••${account.last4}` : `UPI: ***${account.last4}`}
                            </div>
                          </div>
                        ) : (
                          <span className="text-foreground/50 italic">No account</span>
                        )}
                      </td>
                      <td className="py-3 px-4">{statusBadge(w.status)}</td>
                      <td className="py-3 px-4 font-mono text-xs text-foreground/80">
                        {w.payoutRef ? (
                          <span className="text-emerald-400">{w.payoutRef}</span>
                        ) : (
                          <span className="text-foreground/40">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {w.status === "REQUESTED" && (
                            <button
                              onClick={() => handleApprove(w.id)}
                              disabled={submittingAction}
                              className="px-2.5 py-1 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-xs font-medium border border-blue-500/30 transition-colors"
                            >
                              Approve
                            </button>
                          )}

                          {w.status !== "PAID" && (
                            <button
                              onClick={() => {
                                setMarkPaidItem(w);
                                setUtrNumber("");
                              }}
                              className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium border border-emerald-500/30 transition-colors"
                            >
                              Mark Paid
                            </button>
                          )}

                          {w.status !== "PAID" && w.status !== "REJECTED" && (
                            <button
                              onClick={() => {
                                setRejectItem(w);
                                setRejectReason("");
                              }}
                              className="px-2.5 py-1 rounded bg-foreground/[0.06] hover:bg-foreground/10 text-foreground/80 text-xs font-medium transition-colors"
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Saved creator bank details (submitted from the Creator tab) ─── */}
      <SavedPayoutAccounts />

      {/* ─── Mark Paid Modal ─── */}
      <AnimatePresence>
        {markPaidItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border border-foreground/10 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-foreground/10 pb-3">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  Settle Withdrawal (Mark Paid)
                </h3>
                <button
                  onClick={() => setMarkPaidItem(null)}
                  className="text-foreground/50 hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3 rounded-lg bg-background border border-foreground/10 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-foreground/50">Creator:</span>
                  <span className="text-foreground font-medium">{markPaidItem.affiliate?.displayName} ({markPaidItem.affiliate?.code})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/50">Amount:</span>
                  <span className="text-emerald-400 font-bold">₹{markPaidItem.amount.toLocaleString("en-IN")}</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground/60">
                  Bank UTR / IMPS / UPI Reference Number *
                </label>
                <input
                  type="text"
                  placeholder="e.g. UTR123456789012"
                  value={utrNumber}
                  onChange={(e) => setUtrNumber(e.target.value)}
                  className="w-full p-2.5 rounded-lg bg-background border border-foreground/10 font-mono text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-foreground/15"
                />
                <p className="text-[11px] text-foreground/50">
                  Recording the UTR finalizes the ledger hold as DEBIT and marks the withdrawal settled.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setMarkPaidItem(null)}
                  className="px-3.5 py-1.5 rounded-lg bg-foreground/[0.06] hover:bg-foreground/10 text-xs font-medium text-foreground/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMarkPaidSubmit}
                  disabled={!utrNumber.trim() || submittingAction}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-medium text-white transition-colors"
                >
                  {submittingAction ? "Settling..." : "Confirm & Settle"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── Reject Modal ─── */}
      <AnimatePresence>
        {rejectItem && (
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
                  Reject Withdrawal Request
                </h3>
                <button
                  onClick={() => setRejectItem(null)}
                  className="text-foreground/50 hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-foreground/60">
                Rejecting this request will release the <strong className="text-foreground">₹{rejectItem.amount.toLocaleString("en-IN")}</strong> hold back to the creator&apos;s available balance.
              </p>

              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground/60">Rejection Reason *</label>
                <textarea
                  rows={3}
                  placeholder="e.g. Bank IFSC code mismatch. Please re-enter your account details."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full p-2.5 rounded-lg bg-background border border-foreground/10 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-foreground/15"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setRejectItem(null)}
                  className="px-3.5 py-1.5 rounded-lg bg-foreground/[0.06] hover:bg-foreground/10 text-xs font-medium text-foreground/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRejectSubmit}
                  disabled={!rejectReason.trim() || submittingAction}
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
