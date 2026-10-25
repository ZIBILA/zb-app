"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Users,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  Wallet,
  TrendingUp,
  MousePointerClick,
  Copy,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  ShieldAlert,
  Edit2,
  RefreshCw,
  CreditCard
} from "lucide-react";

import { formatCommissionRate } from "@/lib/affiliate/rate";
import ApproveAffiliateModal, { type ApproveAffiliateTarget } from "@/components/admin/ApproveAffiliateModal";
export default function AffiliateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [affiliate, setAffiliate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // Rate edit state
  const [isEditingRate, setIsEditingRate] = useState(false);
  const [newRatePercent, setNewRatePercent] = useState<number>(10);
  const [approvingAffiliate, setApprovingAffiliate] = useState<ApproveAffiliateTarget | null>(null);
  const [approveSubmitting, setApproveSubmitting] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // Bank reveal state
  const [revealedBank, setRevealedBank] = useState<any>(null);
  const [isRevealingBank, setIsRevealingBank] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/admin/affiliates/${id}`);
      if (res.ok) {
        const data = await res.json();
        setAffiliate(data.affiliate);
        setNewRatePercent(Number(((data.affiliate.commissionRate || 0.1) * 100).toFixed(2)));
      }
    } catch (err) {
      console.error("Error loading affiliate:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleCopyLink = (slug: string) => {
    const url = `https://zicabella.com/r/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const handleUpdateRate = async () => {
    const rateFraction = Math.max(0, Math.min(1, newRatePercent / 100));
    try {
      const res = await fetch(`/api/admin/affiliates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionRate: rateFraction }),
      });
      if (res.ok) {
        setIsEditingRate(false);
        fetchDetail();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update commission rate");
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const openApprove = () => {
    if (!affiliate) return;
    setApproveError(null);
    setApprovingAffiliate({
      id: affiliate.id,
      name: affiliate.displayName || affiliate.customer?.name || "Unnamed",
      code: affiliate.code,
      commissionRate: affiliate.commissionRate,
      reactivate: affiliate.status === "SUSPENDED",
    });
  };

  const handleApproveSubmit = async (commissionRate: number) => {
    setApproveSubmitting(true);
    setApproveError(null);
    try {
      const res = await fetch(`/api/admin/affiliates/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionRate }),
      });
      if (res.ok) {
        setApprovingAffiliate(null);
        fetchDetail();
      } else {
        const err = await res.json().catch(() => ({}));
        setApproveError(err.error || "Failed to approve");
      }
    } catch (e: any) {
      setApproveError(e.message || "Failed to approve");
    } finally {
      setApproveSubmitting(false);
    }
  };

  const handleSuspend = async () => {
    const reason = prompt("Enter suspension reason (optional):");
    if (reason === null) return;
    try {
      const res = await fetch(`/api/admin/affiliates/${id}/suspend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) fetchDetail();
      else alert("Failed to suspend");
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleRevealBank = async () => {
    if (revealedBank) {
      setRevealedBank(null);
      return;
    }

    if (!confirm("SECURITY NOTICE: Revealing full bank details is strictly audit-logged with your Admin identity. Proceed?")) {
      return;
    }

    setIsRevealingBank(true);
    try {
      const res = await fetch(`/api/admin/affiliates/${id}/reveal-bank`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setRevealedBank(data.account);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to reveal bank details");
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsRevealingBank(false);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-zinc-500">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading creator profile...
      </div>
    );
  }

  if (!affiliate) {
    return (
      <div className="p-8 text-center text-zinc-400">
        Affiliate not found.
        <div className="mt-4">
          <Link href="/dashboard/affiliates" className="text-sm text-emerald-400 underline">
            Back to Affiliates
          </Link>
        </div>
      </div>
    );
  }

  const defaultAccount = affiliate.payoutAccounts?.find((a: any) => a.isDefault) || affiliate.payoutAccounts?.[0];

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6 text-zinc-100">
      {/* ─── Back & Header ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
        <div>
          <Link
            href="/dashboard/affiliates"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white mb-2 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Affiliates
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              {affiliate.displayName || affiliate.customer?.name || "Affiliate Creator"}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-zinc-800 border border-zinc-700 text-zinc-200">
              {affiliate.code}
            </span>
            {affiliate.status === "APPROVED" && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Approved
              </span>
            )}
            {affiliate.status === "PENDING" && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Pending Review
              </span>
            )}
            {affiliate.status === "SUSPENDED" && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-700/30 text-zinc-400 border border-zinc-700/40">
                Suspended
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Customer ID: <code className="text-zinc-300">{affiliate.customerId}</code> • Joined: {new Date(affiliate.appliedAt).toLocaleDateString("en-IN")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {affiliate.status === "PENDING" && (
            <button
              onClick={openApprove}
              className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors"
            >
              Approve Creator
            </button>
          )}

          {affiliate.status === "APPROVED" && (
            <button
              onClick={handleSuspend}
              className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium text-zinc-300 transition-colors"
            >
              Suspend Partnership
            </button>
          )}

          {affiliate.status === "SUSPENDED" && (
            <button
              onClick={openApprove}
              className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors"
            >
              Reactivate Partnership
            </button>
          )}
        </div>
      </div>

      {/* ─── Financial & Performance KPIs ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium uppercase mb-1">
            <span>Available Balance</span>
            <Wallet className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">₹{affiliate.availableBalance.toLocaleString("en-IN")}</div>
          <div className="text-xs text-zinc-400 mt-1">
            Pending Hold: ₹{affiliate.pendingEarnings.toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium uppercase mb-1">
            <span>Lifetime Earnings</span>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white">₹{affiliate.lifetimeEarnings.toLocaleString("en-IN")}</div>
          <div className="text-xs text-zinc-400 mt-1">
            Paid Out: ₹{affiliate.paidOut.toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium uppercase mb-1">
            <span>Attributed Revenue</span>
            <CreditCard className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">₹{affiliate.totalRevenue.toLocaleString("en-IN")}</div>
          <div className="text-xs text-zinc-400 mt-1">
            {affiliate.totalConversions} conversions
          </div>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium uppercase mb-1">
            <span>Commission Rate</span>
            <button
              onClick={() => setIsEditingRate(!isEditingRate)}
              className="text-zinc-400 hover:text-white"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {isEditingRate ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={newRatePercent}
                onChange={(e) => setNewRatePercent(Number(e.target.value))}
                className="w-16 px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-sm font-bold text-white"
              />
              <span className="text-xs font-bold">%</span>
              <button
                onClick={handleUpdateRate}
                className="px-2 py-1 rounded bg-emerald-600 text-[11px] font-semibold text-white"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="text-2xl font-bold text-white">{formatCommissionRate(affiliate.commissionRate)}</div>
          )}
          <div className="text-xs text-zinc-400 mt-1">
            Total Clicks: {affiliate.totalClicks.toLocaleString("en-IN")}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── Payout Account & Security Card ─── */}
        <div className="lg:col-span-1 p-5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-400" />
              Payout Account
            </h3>
            {defaultAccount && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                {defaultAccount.method}
              </span>
            )}
          </div>

          {defaultAccount ? (
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-xs text-zinc-500 block">Account Holder</span>
                <span className="font-medium text-zinc-200">{defaultAccount.accountHolderName}</span>
              </div>

              {defaultAccount.method === "BANK" ? (
                <>
                  <div>
                    <span className="text-xs text-zinc-500 block">Bank Name</span>
                    <span className="text-zinc-200">{defaultAccount.bankName || "—"}</span>
                  </div>
                  <div>
                    <span className="text-xs text-zinc-500 block">Account Number</span>
                    <span className="font-mono text-zinc-200">
                      {revealedBank ? revealedBank.accountNumber : `••••••••${defaultAccount.last4}`}
                    </span>
                  </div>
                  {revealedBank && (
                    <div>
                      <span className="text-xs text-zinc-500 block">IFSC Code</span>
                      <span className="font-mono text-emerald-400">{revealedBank.ifsc}</span>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <span className="text-xs text-zinc-500 block">UPI ID</span>
                  <span className="font-mono text-zinc-200">
                    {revealedBank ? revealedBank.upiId : `***${defaultAccount.last4}`}
                  </span>
                </div>
              )}

              <div className="pt-2 border-t border-zinc-800">
                <button
                  onClick={handleRevealBank}
                  disabled={isRevealingBank}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 text-xs font-medium text-amber-400 border border-amber-500/20 transition-colors"
                >
                  {revealedBank ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" /> Hide Sensitive Details
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" /> Reveal Full Details (Audited)
                    </>
                  )}
                </button>
                <p className="text-[10px] text-zinc-500 text-center mt-1.5 flex items-center justify-center gap-1">
                  <ShieldAlert className="w-3 h-3 text-amber-500" /> Action logged to security audit
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 italic">No payout account linked yet.</p>
          )}
        </div>

        {/* ─── Links Card ─── */}
        <div className="lg:col-span-2 p-5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <MousePointerClick className="w-4 h-4 text-blue-400" />
              Trackable Links ({affiliate.links?.length || 0})
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500 border-b border-zinc-800 uppercase text-[10px]">
                <tr>
                  <th className="pb-2">Short Link</th>
                  <th className="pb-2">Target</th>
                  <th className="pb-2">Clicks</th>
                  <th className="pb-2">Conv</th>
                  <th className="pb-2">Revenue</th>
                  <th className="pb-2 text-right">Copy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                {affiliate.links?.map((l: any) => (
                  <tr key={l.id} className="hover:bg-zinc-800/20">
                    <td className="py-2.5 font-mono text-zinc-200">/r/{l.slug}</td>
                    <td className="py-2.5">
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px]">{l.targetType}</span>
                    </td>
                    <td className="py-2.5 font-mono">{l.clicks}</td>
                    <td className="py-2.5 font-mono">{l.conversions}</td>
                    <td className="py-2.5 font-mono text-emerald-400">₹{l.revenue.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => handleCopyLink(l.slug)}
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                        title="Copy full URL"
                      >
                        {copiedSlug === l.slug ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─── Referrals Ledger Feed ─── */}
      <div className="p-5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 border-b border-zinc-800 pb-3">
          <CreditCard className="w-4 h-4 text-emerald-400" />
          Recent Referrals & Commissions ({affiliate.referrals?.length || 0})
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500 border-b border-zinc-800 uppercase text-[10px]">
              <tr>
                <th className="pb-2">Date</th>
                <th className="pb-2">Order #</th>
                <th className="pb-2">Order Total</th>
                <th className="pb-2">Eligible Amount</th>
                <th className="pb-2">Commission</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Hold Until</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
              {affiliate.referrals?.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-zinc-500">
                    No referrals recorded yet.
                  </td>
                </tr>
              ) : (
                affiliate.referrals?.map((r: any) => (
                  <tr key={r.id} className="hover:bg-zinc-800/20">
                    <td className="py-2.5 text-zinc-400">{new Date(r.createdAt).toLocaleDateString("en-IN")}</td>
                    <td className="py-2.5 font-mono text-zinc-200">
                      {r.order?.internalOrderNumber || (r.order?.shopifyOrderId ? `#${r.order.shopifyOrderId}` : `#ZB${r.orderId.slice(-5).toUpperCase()}`)}
                    </td>
                    <td className="py-2.5 font-mono">₹{r.orderTotal.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 font-mono">₹{r.eligibleAmount.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 font-mono text-emerald-400 font-semibold">₹{r.commissionAmount.toLocaleString("en-IN")}</td>
                    <td className="py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        r.status === "CONFIRMED"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : r.status === "PENDING"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-zinc-400">
                      {r.holdUntil ? new Date(r.holdUntil).toLocaleDateString("en-IN") : "—"}
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
        submitting={approveSubmitting}
        error={approveError}
        onCancel={() => setApprovingAffiliate(null)}
        onConfirm={handleApproveSubmit}
      />
    </div>
  );
}
