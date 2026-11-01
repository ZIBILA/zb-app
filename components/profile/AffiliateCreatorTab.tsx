"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Link as LinkIcon,
  Copy,
  Check,
  TrendingUp,
  Wallet,
  ShoppingBag,
  MousePointerClick,
  Clock,
  CheckCircle2,
  XCircle,
  CreditCard,
  Building2,
  Share2,
  ArrowUpRight,
  ChevronRight,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  X,
  Mail,
  User,
  ShieldCheck,
  Zap,
  Lock,
  ArrowRight,
} from "lucide-react";
import { getPusherClient } from "@/lib/pusher";
import { trackStorefrontEvent } from "@/lib/track-client";

interface AffiliateData {
  id: string;
  code: string;
  displayName: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  commissionRate: number;
  totalClicks: number;
  totalConversions: number;
  totalRevenue: number;
  pendingEarnings: number;
  availableBalance: number;
  lifetimeEarnings: number;
  paidOut: number;
  conversionRate: number;
  firstWithdrawalDone: boolean;
  minFirstWithdrawal: number;
  minWithdrawal: number;
  defaultPayoutAccount?: {
    id: string;
    method: string;
    accountHolderName: string;
    last4: string;
    bankName?: string;
  } | null;
}

export default function AffiliateCreatorTab({ customer }: { customer?: any }) {
  const [loading, setLoading] = useState(true);
  const [isAffiliate, setIsAffiliate] = useState(false);
  const [affiliate, setAffiliate] = useState<AffiliateData | null>(null);

  // Apply form state
  const [displayName, setDisplayName] = useState(customer?.name || "");
  const [email, setEmail] = useState(customer?.email || "");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");

  useEffect(() => {
    if (customer?.name && !displayName) {
      setDisplayName(customer.name);
    }
    if (customer?.email && !email) {
      setEmail(customer.email);
    }
  }, [customer?.name, customer?.email]);

  // Links state
  const [links, setLinks] = useState<any[]>([]);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [linkTargetType, setLinkTargetType] = useState<"STORE" | "PRODUCT" | "COLLECTION" | "URL">("STORE");
  const [linkTargetValue, setLinkTargetValue] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [copiedLinkSlug, setCopiedLinkSlug] = useState<string | null>(null);
  const [showLinkBuilder, setShowLinkBuilder] = useState(false);

  // Referrals feed state
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loadingReferrals, setLoadingReferrals] = useState(false);
  const [referralFilter, setReferralFilter] = useState<"ALL" | "CONFIRMED" | "PENDING">("ALL");

  // Bank account modal
  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [holderName, setHolderName] = useState(customer?.name || "");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [bankName, setBankName] = useState("");
  const [savingBank, setSavingBank] = useState(false);
  const [bankError, setBankError] = useState("");

  // Withdrawal modal
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [requestingWithdrawal, setRequestingWithdrawal] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawSuccess, setWithdrawSuccess] = useState("");

  // Fetch me status
  const fetchAffiliateProfile = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/affiliate/me");
      if (res.ok) {
        const data = await res.json();
        setIsAffiliate(data.isAffiliate);
        setAffiliate(data.affiliate || null);
      }
    } catch (e) {
      console.error("[Affiliate UI] Profile load error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Settlement can be requested once a week (server-enforced); null = available now
  const [nextSettlementAt, setNextSettlementAt] = useState<Date | null>(null);

  // Fetch creator data once approved
  const fetchCreatorData = useCallback(async () => {
    if (!affiliate || affiliate.status !== "APPROVED") return;

    try {
      // 1. Links
      const linksRes = await fetch("/api/affiliate/links");
      if (linksRes.ok) {
        const d = await linksRes.json();
        setLinks(d.links || []);
      }

      // 2. Referrals
      setLoadingReferrals(true);
      const refRes = await fetch("/api/affiliate/referrals?limit=25");
      if (refRes.ok) {
        const d = await refRes.json();
        setReferrals(d.referrals || []);
      }
      setLoadingReferrals(false);

      // 3. Weekly settlement window
      const wRes = await fetch("/api/affiliate/withdrawals");
      if (wRes.ok) {
        const d = await wRes.json();
        setNextSettlementAt(d.nextSettlementAt ? new Date(d.nextSettlementAt) : null);
      }
    } catch (e) {
      console.error("[Affiliate UI] Data load error:", e);
      setLoadingReferrals(false);
    }
  }, [affiliate?.status]);

  useEffect(() => {
    fetchAffiliateProfile();
  }, [fetchAffiliateProfile]);

  useEffect(() => {
    if (affiliate && affiliate.status === "APPROVED") {
      fetchCreatorData();
    }
  }, [affiliate?.status, fetchCreatorData]);

  // Real-time Pusher listener
  useEffect(() => {
    if (!affiliate?.id) return;
    const pusherClient = getPusherClient();
    if (!pusherClient) return;

    const channel = pusherClient.subscribe(`affiliate-${affiliate.id}`);
    channel.bind("stats_update", () => {
      fetchAffiliateProfile(true);
      fetchCreatorData();
    });

    channel.bind("new_referral", () => {
      fetchAffiliateProfile(true);
      fetchCreatorData();
    });

    return () => {
      if (pusherClient) {
        pusherClient.unsubscribe(`affiliate-${affiliate.id}`);
      }
    };
  }, [affiliate?.id, fetchAffiliateProfile, fetchCreatorData]);

  // Apply Action
  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setApplying(true);
    setApplyError("");

    const trimmedName = displayName.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName || trimmedName.length < 2) {
      setApplyError("Please enter your name or creator handle (at least 2 characters)");
      setApplying(false);
      return;
    }

    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setApplyError("Please enter a valid email address");
      setApplying(false);
      return;
    }

    try {
      const res = await fetch("/api/affiliate/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: trimmedName,
          email: trimmedEmail,
        }),
      });

      if (res.ok) {
        trackStorefrontEvent("affiliate_applied", { customerId: customer?.id, metadata: { email: trimmedEmail } });
        await fetchAffiliateProfile();
      } else {
        const err = await res.json();
        setApplyError(err.error || "Failed to submit application");
      }
    } catch (err: any) {
      setApplyError(err.message || "Something went wrong");
    } finally {
      setApplying(false);
    }
  };

  // Generate Link Action
  const handleGenerateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneratingLink(true);
    try {
      const res = await fetch("/api/affiliate/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: linkTargetType,
          targetValue: linkTargetValue.trim() || undefined,
          label: linkLabel.trim() || undefined,
        }),
      });

      if (res.ok) {
        setLinkTargetValue("");
        setLinkLabel("");
        setShowLinkBuilder(false);
        await fetchCreatorData();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to generate link");
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setGeneratingLink(false);
    }
  };

  // Copy Link Helper
  const handleCopy = (url: string, slug: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(url);
    }
    setCopiedLinkSlug(slug);
    setTimeout(() => setCopiedLinkSlug(null), 2000);
  };

  // Native Web Share
  const handleShare = async (url: string, title?: string) => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: title || "Zica Bella Luxury Streetwear",
          url,
        });
        return;
      } catch {
        // Fallback to clipboard copy
      }
    }
    handleCopy(url, "master");
  };

  // Save bank account (Direct Bank Transfer only) — same rules as the server
  const handleSaveBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setBankError("");

    const cleanAccount = accountNumber.replace(/\s+/g, "");
    const cleanIfsc = ifsc.trim().toUpperCase();
    if (holderName.trim().length < 2) return setBankError("Enter the account holder's name.");
    if (!/^\d{9,18}$/.test(cleanAccount)) return setBankError("Account number must be 9–18 digits.");
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
      return setBankError("Enter a valid 11-character IFSC code (e.g. HDFC0001234).");
    }

    setSavingBank(true);
    try {
      const res = await fetch("/api/affiliate/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "BANK",
          accountHolderName: holderName.trim(),
          accountNumber: cleanAccount,
          ifsc: cleanIfsc,
          bankName: bankName.trim() || undefined,
        }),
      });

      if (res.ok) {
        setIsBankModalOpen(false);
        setAccountNumber("");
        setIfsc("");
        await fetchAffiliateProfile(true);
      } else {
        const err = await res.json().catch(() => ({}));
        setBankError(err.error || "Could not save your bank details. Please try again.");
      }
    } catch {
      setBankError("Network error. Please check your connection and try again.");
    } finally {
      setSavingBank(false);
    }
  };

  // Request Withdrawal
  const handleRequestWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestingWithdrawal(true);
    setWithdrawError("");
    setWithdrawSuccess("");

    const amt = parseFloat(withdrawAmount);
    if (isNaN(amt) || amt <= 0) {
      setWithdrawError("Please enter a valid amount");
      setRequestingWithdrawal(false);
      return;
    }

    try {
      const res = await fetch("/api/affiliate/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt }),
      });

      if (res.ok) {
        setWithdrawSuccess("Withdrawal requested! Funds will be transferred to your linked payout account.");
        setWithdrawAmount("");
        await fetchAffiliateProfile(true);
        await fetchCreatorData();
        setTimeout(() => {
          setIsWithdrawModalOpen(false);
          setWithdrawSuccess("");
        }, 2200);
      } else {
        const err = await res.json();
        setWithdrawError(err.error || "Failed to submit withdrawal request");
      }
    } catch (err: any) {
      setWithdrawError(err.message);
    } finally {
      setRequestingWithdrawal(false);
    }
  };

  // ─── LOADING STATE ───
  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-center">
        <div className="relative flex items-center justify-center w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/10 mb-3 shadow-inner">
          <RefreshCw className="w-5 h-5 animate-spin text-zinc-300" />
        </div>
        <span className="text-[11px] font-mono tracking-widest uppercase text-zinc-400">Loading Creator Suite...</span>
      </div>
    );
  }

  // ─── STATE A: Not an Affiliate Yet (Apple-Grade Application Form) ───
  if (!isAffiliate || !affiliate) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-lg mx-auto py-4 px-2 sm:px-0"
      >
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-zinc-950/70 backdrop-blur-2xl p-6 sm:p-8 text-center space-y-6 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
          {/* Subtle Ambient Radial Glow */}
          <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 bg-gradient-to-b from-white/10 to-transparent blur-3xl rounded-full" />

          {/* Top Pill Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.05] border border-white/10 text-[11px] font-medium tracking-widest uppercase text-zinc-300 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-zinc-200" />
            <span>Creator Collective</span>
          </div>

          {/* Headline & Description */}
          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Join Zica Bella Creators
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-sm mx-auto leading-relaxed">
              Generate custom trackable links to your favorite luxury streetwear pieces, share them with your audience, and manage your creator profile.
            </p>
          </div>

          {/* Application Form */}
          <form onSubmit={handleApply} className="space-y-4 pt-2 text-left">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 block px-1">
                Creator / Display Name
              </label>
              <div className="relative flex items-center rounded-2xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/10 focus-within:border-white/30 focus-within:ring-2 focus-within:ring-white/10 transition-all px-3.5 py-3">
                <User className="w-4 h-4 text-zinc-500 mr-2.5 shrink-0" />
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your Name or Brand Handle"
                  className="w-full bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 block px-1">
                Email Address
              </label>
              <div className="relative flex items-center rounded-2xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/10 focus-within:border-white/30 focus-within:ring-2 focus-within:ring-white/10 transition-all px-3.5 py-3">
                <Mail className="w-4 h-4 text-zinc-500 mr-2.5 shrink-0" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  className="w-full bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                />
              </div>
              <p className="text-[11px] text-zinc-500 px-1">
                We will send program updates and notifications to this email address.
              </p>
            </div>

            {applyError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{applyError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={applying}
              className="w-full h-12 rounded-2xl bg-white text-black font-semibold text-xs uppercase tracking-widest hover:bg-zinc-200 active:scale-[0.99] transition-all shadow-[0_0_24px_rgba(255,255,255,0.15)] flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
            >
              {applying ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-black" />
                  <span>Submitting Application...</span>
                </>
              ) : (
                <>
                  <span>Apply to Join as a Creator</span>
                  <ArrowRight className="w-4 h-4 text-black" />
                </>
              )}
            </button>
          </form>

          {/* Security & Zero Fee Note */}
          <div className="pt-2 flex items-center justify-center gap-1.5 text-[11px] text-zinc-500">
            <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
            <span>Official Zica Bella Partner Program • Instant Review</span>
          </div>
        </div>
      </motion.div>
    );
  }

  // ─── STATE B: Application Under Review ───
  if (affiliate.status === "PENDING") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md mx-auto py-10 px-2 sm:px-0 text-center space-y-6"
      >
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-zinc-950/70 backdrop-blur-2xl p-8 space-y-5 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Clock className="w-7 h-7 text-amber-400 animate-pulse" />
          </div>

          <div className="space-y-2">
            <span className="px-3 py-1 rounded-full text-[10px] font-mono tracking-widest uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Application Under Review
            </span>
            <h2 className="text-xl font-bold tracking-tight text-white pt-1">
              Welcome to the Waitlist
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed max-w-sm mx-auto">
              Thank you for applying to the Zica Bella Creator Program! Our partnerships team is currently reviewing your profile. You will be notified as soon as your creator tools are active.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">Assigned Partner Code</span>
            <span className="text-base font-mono font-bold text-white tracking-wider">{affiliate.code}</span>
          </div>
        </div>
      </motion.div>
    );
  }

  // ─── STATE C: Rejected / Suspended ───
  if (affiliate.status === "REJECTED" || affiliate.status === "SUSPENDED") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md mx-auto py-10 px-2 sm:px-0 text-center space-y-4"
      >
        <div className="rounded-3xl border border-white/[0.08] bg-zinc-950/70 backdrop-blur-2xl p-8 space-y-4 shadow-xl">
          <div className="w-12 h-12 mx-auto rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
            <XCircle className="w-6 h-6 text-rose-400" />
          </div>
          <h2 className="text-lg font-bold text-white">
            {affiliate.status === "REJECTED" ? "Application Not Approved" : "Account Suspended"}
          </h2>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {affiliate.status === "REJECTED"
              ? "Your creator application could not be approved at this time. Please feel free to contact our partnerships concierge for feedback."
              : "Your creator account has been suspended. Please contact creator support for assistance."}
          </p>
        </div>
      </motion.div>
    );
  }

  // ─── STATE D: Approved Creator Dashboard (Apple-Grade Bento & Mobile-First) ───
  const minRequiredForWithdrawal = !affiliate.firstWithdrawalDone
    ? affiliate.minFirstWithdrawal || 5000
    : affiliate.minWithdrawal || 1000;

  const weeklyLimitActive = nextSettlementAt !== null && nextSettlementAt > new Date();
  const canWithdraw = (affiliate.availableBalance || 0) >= minRequiredForWithdrawal && !weeklyLimitActive;
  const progressPercent = Math.min(100, Math.round(((affiliate.availableBalance || 0) / minRequiredForWithdrawal) * 100));

  // Find primary storefront link
  const masterLink = links.find((l) => l.targetType === "STORE") || {
    slug: affiliate.code.toLowerCase(),
    shortUrl: typeof window !== "undefined" ? `${window.location.origin}/r/${affiliate.code.toLowerCase()}` : `/r/${affiliate.code.toLowerCase()}`,
    clicks: affiliate.totalClicks,
    conversions: affiliate.totalConversions,
    revenue: affiliate.totalRevenue,
  };

  // Filter referrals
  const filteredReferrals = referrals.filter((r) => {
    if (referralFilter === "CONFIRMED") return r.status === "CONFIRMED";
    if (referralFilter === "PENDING") return r.status === "PENDING";
    return true;
  });

  return (
    <div className="space-y-6 max-w-4xl mx-auto py-2 px-1 sm:px-0">
      {/* ─── 1. Top Identity Ribbon ─── */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-zinc-950/60 backdrop-blur-2xl p-5 sm:p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-white/10 to-white/[0.02] border border-white/15 flex items-center justify-center font-bold text-lg text-white shadow-inner">
            {(affiliate.displayName || customer?.name || "C")[0].toUpperCase()}
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                {affiliate.displayName || customer?.name || "Creator"}
              </h2>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Active Creator
              </span>
            </div>
            <p className="text-xs text-zinc-400 flex items-center gap-2 font-mono">
              <span>Code: <strong className="text-white">{affiliate.code}</strong></span>
              <span>•</span>
              <span>{Number((affiliate.commissionRate * 100).toFixed(2))}% Commission</span>
            </p>
          </div>
        </div>

        {/* Master Link Quick Action Button */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => handleShare(masterLink.shortUrl, `${affiliate.displayName || "My"} Zica Bella Collection`)}
            className="flex-1 sm:flex-initial h-10 px-4 rounded-xl bg-white text-black font-semibold text-xs uppercase tracking-wider hover:bg-zinc-200 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            {copiedLinkSlug === "master" ? (
              <>
                <Check className="w-3.5 h-3.5 text-black" />
                <span>Link Copied</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5 text-black" />
                <span>Share Store Link</span>
              </>
            )}
          </button>

          <button
            onClick={() => handleCopy(masterLink.shortUrl, "master")}
            className="h-10 px-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-white text-xs font-mono transition-colors flex items-center justify-center"
            title="Copy direct URL"
          >
            <Copy className="w-3.5 h-3.5 text-zinc-400" />
          </button>
        </div>
      </div>

      {/* ─── 2. Apple Wallet Style Balance & Payout Card ─── */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-zinc-900/90 via-zinc-950/80 to-black backdrop-blur-2xl p-6 sm:p-8 shadow-[0_12px_40px_rgba(0,0,0,0.5)] space-y-6">
        <div className="pointer-events-none absolute -right-16 -top-16 w-60 h-60 bg-emerald-500/10 blur-3xl rounded-full" />

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-400 block">
              Available for Payout
            </span>
            <div className="text-3xl sm:text-4xl md:text-5xl font-mono font-bold text-white tracking-tight flex items-baseline gap-1">
              <span>₹{affiliate.availableBalance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400 pt-1">
              <span>Pending Hold: <strong className="text-zinc-300 font-mono">₹{affiliate.pendingEarnings.toLocaleString("en-IN")}</strong></span>
              <span>•</span>
              <span>Paid Out: <strong className="text-zinc-300 font-mono">₹{affiliate.paidOut.toLocaleString("en-IN")}</strong></span>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <button
              onClick={() => setIsBankModalOpen(true)}
              className="h-11 px-4 rounded-2xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 text-xs font-medium text-white transition-colors flex items-center justify-center gap-2"
            >
              <CreditCard className="w-4 h-4 text-zinc-400" />
              <span>
                {affiliate.defaultPayoutAccount
                  ? `${affiliate.defaultPayoutAccount.method} ••••${affiliate.defaultPayoutAccount.last4}`
                  : "Link Payout Account"}
              </span>
            </button>

            <button
              onClick={() => setIsWithdrawModalOpen(true)}
              disabled={!canWithdraw || !affiliate.defaultPayoutAccount}
              className="h-11 px-5 rounded-2xl bg-white text-black text-xs font-semibold uppercase tracking-wider hover:bg-zinc-200 active:scale-[0.98] transition-all disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.15)]"
            >
              <Wallet className="w-4 h-4 text-black" />
              <span>Withdraw Funds</span>
            </button>
          </div>
          {weeklyLimitActive && (
            <p className="text-[11px] text-zinc-400">
              One settlement per week — next request available{" "}
              {nextSettlementAt!.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.
            </p>
          )}
        </div>

        {/* Withdrawal Threshold Progress */}
        <div className="pt-2 border-t border-white/[0.06] space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-400">
              {!affiliate.firstWithdrawalDone
                ? `Initial payout milestone: ₹${affiliate.availableBalance.toLocaleString("en-IN")} of ₹${minRequiredForWithdrawal.toLocaleString("en-IN")}`
                : `Payout threshold: ₹${minRequiredForWithdrawal.toLocaleString("en-IN")}`}
            </span>
            <span className="font-mono text-zinc-300 font-medium">{progressPercent}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
            />
          </div>
        </div>
      </div>

      {/* ─── 3. Bento Metric Cards (Mobile 2-column, Desktop 3-column) ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-3xl border border-white/[0.08] bg-zinc-950/60 backdrop-blur-xl p-4 sm:p-5 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-[10px] uppercase tracking-wider font-semibold">
            <span>Orders Driven</span>
            <ShoppingBag className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-mono font-bold text-white">
            {affiliate.totalConversions}
          </div>
          <p className="text-[11px] text-zinc-400 font-mono">
            ₹{affiliate.totalRevenue.toLocaleString("en-IN")} volume
          </p>
        </div>

        <div className="rounded-3xl border border-white/[0.08] bg-zinc-950/60 backdrop-blur-xl p-4 sm:p-5 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-[10px] uppercase tracking-wider font-semibold">
            <span>Link Clicks</span>
            <MousePointerClick className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-mono font-bold text-white">
            {affiliate.totalClicks.toLocaleString("en-IN")}
          </div>
          <p className="text-[11px] text-zinc-400 font-mono">
            {affiliate.conversionRate}% conversion
          </p>
        </div>

        <div className="col-span-2 md:col-span-1 rounded-3xl border border-white/[0.08] bg-zinc-950/60 backdrop-blur-xl p-4 sm:p-5 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-[10px] uppercase tracking-wider font-semibold">
            <span>Lifetime Earned</span>
            <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-mono font-bold text-emerald-400">
            ₹{affiliate.lifetimeEarnings.toLocaleString("en-IN", { minimumFractionDigits: 0 })}
          </div>
          <p className="text-[11px] text-zinc-400 font-mono">
            All-time commission
          </p>
        </div>
      </div>

      {/* ─── 4. Link Generator & Link Hub ─── */}
      <div className="rounded-3xl border border-white/[0.08] bg-zinc-950/60 backdrop-blur-2xl p-5 sm:p-6 space-y-5 shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.06] pb-4">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Trackable Links</h3>
            <p className="text-xs text-zinc-400">Share custom links with your audience to attribute sales.</p>
          </div>
          <button
            onClick={() => setShowLinkBuilder(!showLinkBuilder)}
            className="self-start sm:self-auto px-3.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-xs font-medium text-white transition-colors flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-zinc-300" />
            <span>{showLinkBuilder ? "Close Builder" : "Create Product Link"}</span>
          </button>
        </div>

        {/* Link Builder Expandable Drawer */}
        <AnimatePresence>
          {showLinkBuilder && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              onSubmit={handleGenerateLink}
              className="space-y-4 overflow-hidden pt-1 pb-3"
            >
              {/* Apple-style Segmented Control */}
              <div className="flex p-1 rounded-2xl bg-white/[0.04] border border-white/10 gap-1 overflow-x-auto text-xs">
                {(["STORE", "PRODUCT", "COLLECTION", "URL"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setLinkTargetType(type)}
                    className={`flex-1 min-w-[70px] py-2 px-3 rounded-xl font-medium transition-all text-center ${
                      linkTargetType === type
                        ? "bg-white text-black font-semibold shadow-md"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    {type === "STORE" ? "Storefront" : type === "PRODUCT" ? "Product" : type === "COLLECTION" ? "Collection" : "Custom URL"}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {linkTargetType !== "STORE" && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 block px-1">
                      {linkTargetType === "PRODUCT"
                        ? "Product Handle"
                        : linkTargetType === "COLLECTION"
                        ? "Collection Handle"
                        : "Target Path"}
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={linkTargetType === "PRODUCT" ? "oversized-acid-wash-tee" : linkTargetType === "COLLECTION" ? "drip-denims" : "/pages/story"}
                      value={linkTargetValue}
                      onChange={(e) => setLinkTargetValue(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 block px-1">
                    Label (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Bio Link or Reels Tag"
                    value={linkLabel}
                    onChange={(e) => setLinkLabel(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={generatingLink}
                  className="h-10 px-5 rounded-xl bg-white text-black text-xs font-semibold uppercase tracking-wider hover:bg-zinc-200 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {generatingLink ? "Creating..." : "Generate Short Link"}
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Links Mobile Cards + Desktop Table */}
        <div className="space-y-2">
          {/* Mobile Card Layout */}
          <div className="block sm:hidden space-y-2.5">
            {links.map((link) => (
              <div
                key={link.id}
                className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-2.5 hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-white">/r/{link.slug}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.06] text-zinc-300">
                    {link.label || link.targetType}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                  <div className="flex items-center gap-3 text-zinc-400 font-mono text-[11px]">
                    <span>{link.clicks} clicks</span>
                    <span>•</span>
                    <span>{link.conversions} orders</span>
                    <span>•</span>
                    <span className="text-emerald-400 font-bold">₹{link.revenue.toLocaleString("en-IN")}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleShare(link.shortUrl, link.label)}
                      className="p-1.5 rounded-lg bg-white/[0.06] text-zinc-300 hover:text-white"
                      title="Share"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleCopy(link.shortUrl, link.slug)}
                      className="px-2.5 py-1.5 rounded-lg bg-white text-black font-semibold text-[11px] flex items-center gap-1 active:scale-95"
                    >
                      {copiedLinkSlug === link.slug ? (
                        <>
                          <Check className="w-3 h-3 text-black" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-black" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 border-b border-white/[0.08]">
                <tr>
                  <th className="pb-2.5">Short Link</th>
                  <th className="pb-2.5">Target</th>
                  <th className="pb-2.5">Clicks</th>
                  <th className="pb-2.5">Conversions</th>
                  <th className="pb-2.5">Volume</th>
                  <th className="pb-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04] text-zinc-300">
                {links.map((link) => (
                  <tr key={link.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 font-mono font-medium text-white">/r/{link.slug}</td>
                    <td className="py-3 text-zinc-400">{link.label || link.targetType}</td>
                    <td className="py-3 font-mono">{link.clicks}</td>
                    <td className="py-3 font-mono">{link.conversions}</td>
                    <td className="py-3 font-mono text-emerald-400 font-bold">₹{link.revenue.toLocaleString("en-IN")}</td>
                    <td className="py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => handleShare(link.shortUrl, link.label)}
                          className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 transition-colors"
                          title="Share"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleCopy(link.shortUrl, link.slug)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white font-mono text-xs transition-colors"
                        >
                          {copiedLinkSlug === link.slug ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 text-zinc-400" /> Copy
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─── 5. Recent Referrals Feed ─── */}
      <div className="rounded-3xl border border-white/[0.08] bg-zinc-950/60 backdrop-blur-2xl p-5 sm:p-6 space-y-4 shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Attributed Orders</h3>
            <p className="text-xs text-zinc-400">Commission is held for 14 days post-delivery before clearing.</p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/10 text-xs">
            {(["ALL", "CONFIRMED", "PENDING"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setReferralFilter(tab)}
                className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  referralFilter === tab
                    ? "bg-white text-black font-semibold"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {tab === "ALL" ? "All Orders" : tab === "CONFIRMED" ? "Confirmed" : "Hold Period"}
              </button>
            ))}
          </div>
        </div>

        {/* Referrals List */}
        {loadingReferrals ? (
          <div className="py-8 text-center text-xs text-zinc-500 font-mono uppercase tracking-wider">
            Loading order records...
          </div>
        ) : filteredReferrals.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <ShoppingBag className="w-8 h-8 text-zinc-600 mx-auto" />
            <p className="text-xs text-zinc-400">No orders match this filter yet.</p>
            <p className="text-[11px] text-zinc-600">Share your trackable links on Instagram, YouTube, or WhatsApp to drive sales.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Mobile Card View */}
            <div className="block sm:hidden space-y-2.5">
              {filteredReferrals.map((r) => (
                <div
                  key={r.id}
                  className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-2 hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-white">{r.orderNumber}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      r.status === "CONFIRMED"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : r.status === "PENDING"
                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    }`}>
                      {r.status === "PENDING" ? "Hold Period" : r.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                    <span className="text-zinc-500 text-[11px]">
                      {new Date(r.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric" })} • Order ₹{r.orderTotal.toLocaleString("en-IN")}
                    </span>
                    <span className="font-mono text-emerald-400 font-bold">
                      +₹{r.commissionAmount.toLocaleString("en-IN")}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 border-b border-white/[0.08]">
                  <tr>
                    <th className="pb-2.5">Date</th>
                    <th className="pb-2.5">Order</th>
                    <th className="pb-2.5">Order Value</th>
                    <th className="pb-2.5">Commission</th>
                    <th className="pb-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] text-zinc-300">
                  {filteredReferrals.map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 text-zinc-400">{new Date(r.createdAt).toLocaleDateString("en-IN")}</td>
                      <td className="py-3 font-mono font-medium text-white">{r.orderNumber}</td>
                      <td className="py-3 font-mono">₹{r.orderTotal.toLocaleString("en-IN")}</td>
                      <td className="py-3 font-mono text-emerald-400 font-bold">+₹{r.commissionAmount.toLocaleString("en-IN")}</td>
                      <td className="py-3 text-right">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium ${
                          r.status === "CONFIRMED"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : r.status === "PENDING"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}>
                          {r.status === "PENDING" ? "Hold Period" : r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ─── Apple-Grade Bank Account Modal ─── */}
      <AnimatePresence>
        {isBankModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="bg-zinc-950 border border-white/15 rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-5 shadow-[0_20px_60px_rgba(0,0,0,0.8)] text-white"
            >
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-white/[0.06] border border-white/10">
                    <CreditCard className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Bank details</h3>
                    <p className="text-[11px] text-zinc-400">Payouts are sent by direct bank transfer · stored encrypted</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsBankModalOpen(false)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveBank} noValidate className="space-y-4">
                {[
                  { label: "Account holder name", value: holderName, set: setHolderName, placeholder: "As shown on your bank account", autoComplete: "name" },
                  { label: "Bank name", value: bankName, set: setBankName, placeholder: "e.g. HDFC Bank", optional: true },
                ].map((f) => (
                  <label key={f.label} className="block space-y-1.5">
                    <span className="text-xs text-zinc-400">
                      {f.label}
                      {f.optional && <span className="text-zinc-600"> (optional)</span>}
                    </span>
                    <input
                      type="text"
                      value={f.value}
                      onChange={(e) => f.set(e.target.value)}
                      placeholder={f.placeholder}
                      autoComplete={f.autoComplete}
                      className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 text-[16px] sm:text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30"
                    />
                  </label>
                ))}

                <label className="block space-y-1.5">
                  <span className="text-xs text-zinc-400">Account number</span>
                  {/* Visible while typing so creators can check every digit before submitting */}
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/[^\d\s]/g, ""))}
                    placeholder="Enter account number"
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 font-mono tracking-wider text-[16px] sm:text-sm text-white placeholder:text-zinc-600 placeholder:font-sans placeholder:tracking-normal outline-none focus:border-white/30"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs text-zinc-400">IFSC code</span>
                  <input
                    type="text"
                    autoComplete="off"
                    maxLength={11}
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                    placeholder="e.g. HDFC0001234"
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 font-mono uppercase tracking-wider text-[16px] sm:text-sm text-white placeholder:text-zinc-600 placeholder:font-sans placeholder:normal-case placeholder:tracking-normal outline-none focus:border-white/30"
                  />
                </label>

                {bankError && (
                  <p className="px-3.5 py-2.5 rounded-xl bg-rose-500/10 text-xs text-rose-300">{bankError}</p>
                )}

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsBankModalOpen(false)}
                    className="flex-1 h-11 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingBank}
                    className="flex-1 h-11 rounded-xl bg-white text-black text-sm font-semibold hover:bg-zinc-200 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {savingBank ? "Saving…" : "Save bank details"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── Apple-Grade Withdrawal Request Modal ─── */}
      <AnimatePresence>
        {isWithdrawModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="bg-zinc-950 border border-white/15 rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-5 shadow-[0_20px_60px_rgba(0,0,0,0.8)] text-white"
            >
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <Wallet className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Withdraw Earnings</h3>
                    <p className="text-[11px] text-zinc-400">Direct settlement to linked account</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsWithdrawModalOpen(false)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Available Balance:</span>
                  <span className="font-mono font-bold text-white">₹{affiliate.availableBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Minimum Required:</span>
                  <span className="font-mono text-zinc-300">₹{minRequiredForWithdrawal.toLocaleString("en-IN")}</span>
                </div>
                {affiliate.defaultPayoutAccount && (
                  <div className="flex justify-between border-t border-white/[0.06] pt-2">
                    <span className="text-zinc-400">Payout Target:</span>
                    <span className="font-mono text-emerald-400 font-medium">
                      {affiliate.defaultPayoutAccount.method} ••••{affiliate.defaultPayoutAccount.last4}
                    </span>
                  </div>
                )}
              </div>

              <form onSubmit={handleRequestWithdrawal} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 block">
                      Amount to Withdraw (INR) *
                    </label>
                    <button
                      type="button"
                      onClick={() => setWithdrawAmount(String(affiliate.availableBalance))}
                      className="text-[10px] text-emerald-400 hover:underline font-mono uppercase"
                    >
                      Max Available
                    </button>
                  </div>
                  <div className="relative flex items-center rounded-2xl bg-white/[0.03] border border-white/10 px-3.5 py-3 focus-within:border-white/30">
                    <span className="font-mono text-zinc-400 mr-2 text-sm">₹</span>
                    <input
                      type="number"
                      step="any"
                      required
                      min={minRequiredForWithdrawal}
                      max={affiliate.availableBalance}
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder={String(minRequiredForWithdrawal)}
                      className="w-full bg-transparent font-mono text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                    />
                  </div>
                </div>

                {withdrawError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
                    {withdrawError}
                  </div>
                )}

                {withdrawSuccess && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>{withdrawSuccess}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setIsWithdrawModalOpen(false)}
                    className="h-10 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 text-xs font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={requestingWithdrawal}
                    className="h-10 px-5 rounded-xl bg-white text-black font-semibold text-xs uppercase tracking-wider hover:bg-zinc-200 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {requestingWithdrawal ? "Processing..." : "Confirm Withdrawal"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
