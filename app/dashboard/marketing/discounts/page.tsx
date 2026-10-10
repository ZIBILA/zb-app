"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Tag, Plus, Trash2, Calendar, Percent, Banknote, 
  Search, Filter, ChevronRight, X, CheckCircle2,
  AlertCircle, Sparkles, Clock, ShieldCheck, Edit2, Smartphone, Monitor
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface WebstoreSettings {
  discountType: string;
  discountValue: number;
  minOrderValue: number;
  applicability: string;
  prepaidDiscountType: string;
  prepaidDiscountValue: number;
  codDiscountType: string;
  codDiscountValue: number;
  applyAsStoreCredit: boolean;
  cashbackEnabled: boolean;
  cashbackType: string;
  cashbackValue: number;
}

interface AppSettings {
  type: string;
  value: number;
  minOrderAmount: number;
  maxDiscount?: number | null;
  cashbackEnabled: boolean;
  cashbackType: string;
  cashbackValue: number;
}

interface Campaign {
  id: string;
  code: string;
  targets: string[];
  description?: string;
  validFrom: string;
  validUntil?: string | null;
  usageLimit?: number | null;
  usedCount: number;
  isActive: boolean;
  autoApply: boolean;
  isSecure: boolean;
  createdAt: string;
  webstoreSettings?: WebstoreSettings | null;
  appSettings?: AppSettings | null;
}

export default function UnifiedDiscountsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterChannel, setFilterChannel] = useState("all"); // all, webstore, app

  // Unified campaign states
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [targets, setTargets] = useState<string[]>(["webstore", "app"]);
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [autoApply, setAutoApply] = useState(false);
  const [isSecure, setIsSecure] = useState(false);

  // Web Store specific states
  const [webstoreDiscountType, setWebstoreDiscountType] = useState("percentage");
  const [webstoreDiscountValue, setWebstoreDiscountValue] = useState("");
  const [webstoreMinOrderValue, setWebstoreMinOrderValue] = useState("0");
  const [webstoreApplicability, setWebstoreApplicability] = useState("ALL"); // ALL, PREPAID_ONLY, COD_ONLY, CUSTOM_RATES
  const [prepaidDiscountType, setPrepaidDiscountType] = useState("percentage");
  const [prepaidDiscountValue, setPrepaidDiscountValue] = useState("");
  const [codDiscountType, setCodDiscountType] = useState("percentage");
  const [codDiscountValue, setCodDiscountValue] = useState("");
  const [webstoreApplyAsStoreCredit, setWebstoreApplyAsStoreCredit] = useState(false);
  const [webstoreCashbackEnabled, setWebstoreCashbackEnabled] = useState(false);
  const [webstoreCashbackType, setWebstoreCashbackType] = useState("percentage");
  const [webstoreCashbackValue, setWebstoreCashbackValue] = useState("");

  // Mobile App specific states
  const [appDiscountType, setAppDiscountType] = useState("percentage");
  const [appDiscountValue, setAppDiscountValue] = useState("");
  const [appMinOrderAmount, setAppMinOrderAmount] = useState("0");
  const [appMaxDiscount, setAppMaxDiscount] = useState("");
  const [appCashbackEnabled, setAppCashbackEnabled] = useState(false);
  const [appCashbackType, setAppCashbackType] = useState("percentage");
  const [appCashbackValue, setAppCashbackValue] = useState("");

  const [submitLoading, setSubmitLoading] = useState(false);

  const fetchCampaigns = async (silent = false) => {
    try {
      if (!silent && campaigns.length === 0) setLoading(true);
      const res = await fetch("/api/discounts");
      const data = await res.json();
      if (data.success) {
        setCampaigns(data.discounts);
      }
    } catch (err) {
      if (!silent) toast.error("Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  useEffect(() => {
    const handleSync = () => {
      fetchCampaigns(true);
    };
    window.addEventListener("realtime-sync", handleSync);
    return () => window.removeEventListener("realtime-sync", handleSync);
  }, []);

  const openAddModal = () => {
    setEditingCampaign(null);
    setCode("");
    setDescription("");
    setTargets(["webstore", "app"]);
    
    // Default valid dates (today, and 1 year expiry)
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    
    setValidFrom(todayStr);
    setValidUntil("");
    setUsageLimit("");
    setIsActive(true);
    setAutoApply(false);
    setIsSecure(false);

    // Reset webstore form
    setWebstoreDiscountType("percentage");
    setWebstoreDiscountValue("");
    setWebstoreMinOrderValue("0");
    setWebstoreApplicability("ALL");
    setPrepaidDiscountType("percentage");
    setPrepaidDiscountValue("");
    setCodDiscountType("percentage");
    setCodDiscountValue("");
    setWebstoreApplyAsStoreCredit(false);
    setWebstoreCashbackEnabled(false);
    setWebstoreCashbackType("percentage");
    setWebstoreCashbackValue("");

    // Reset app form
    setAppDiscountType("percentage");
    setAppDiscountValue("");
    setAppMinOrderAmount("0");
    setAppMaxDiscount("");
    setAppCashbackEnabled(false);
    setAppCashbackType("percentage");
    setAppCashbackValue("");

    setIsModalOpen(true);
  };

  const formatToInputDate = (dateStr: any) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const pad = (num: number) => String(num).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const openEditModal = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setCode(campaign.code);
    setDescription(campaign.description || "");
    setTargets(campaign.targets);
    setValidFrom(formatToInputDate(campaign.validFrom));
    setValidUntil(formatToInputDate(campaign.validUntil));
    setUsageLimit(campaign.usageLimit ? String(campaign.usageLimit) : "");
    setIsActive(campaign.isActive);
    setAutoApply(!!campaign.autoApply);
    setIsSecure(!!campaign.isSecure);

    // Populate webstore fields if available
    if (campaign.webstoreSettings) {
      const ws = campaign.webstoreSettings;
      setWebstoreDiscountType(ws.discountType);
      setWebstoreDiscountValue(String(ws.discountValue));
      setWebstoreMinOrderValue(String(ws.minOrderValue));
      setWebstoreApplicability(ws.applicability || "ALL");
      setPrepaidDiscountType(ws.prepaidDiscountType || "percentage");
      setPrepaidDiscountValue(String(ws.prepaidDiscountValue || ""));
      setCodDiscountType(ws.codDiscountType || "percentage");
      setCodDiscountValue(String(ws.codDiscountValue || ""));
      setWebstoreApplyAsStoreCredit(!!ws.applyAsStoreCredit);
      setWebstoreCashbackEnabled(!!ws.cashbackEnabled);
      setWebstoreCashbackType(ws.cashbackType || "percentage");
      setWebstoreCashbackValue(ws.cashbackValue ? String(ws.cashbackValue) : "");
    } else {
      // Default reset if not targeted before
      setWebstoreDiscountType("percentage");
      setWebstoreDiscountValue("");
      setWebstoreMinOrderValue("0");
      setWebstoreApplicability("ALL");
      setPrepaidDiscountType("percentage");
      setPrepaidDiscountValue("");
      setCodDiscountType("percentage");
      setCodDiscountValue("");
      setWebstoreApplyAsStoreCredit(false);
      setWebstoreCashbackEnabled(false);
      setWebstoreCashbackType("percentage");
      setWebstoreCashbackValue("");
    }

    // Populate app fields if available
    if (campaign.appSettings) {
      const app = campaign.appSettings;
      setAppDiscountType(app.type);
      setAppDiscountValue(String(app.value));
      setAppMinOrderAmount(String(app.minOrderAmount));
      setAppMaxDiscount(app.maxDiscount ? String(app.maxDiscount) : "");
      setAppCashbackEnabled(!!app.cashbackEnabled);
      setAppCashbackType(app.cashbackType || "percentage");
      setAppCashbackValue(app.cashbackValue ? String(app.cashbackValue) : "");
    } else {
      // Default reset if not targeted before
      setAppDiscountType("percentage");
      setAppDiscountValue("");
      setAppMinOrderAmount("0");
      setAppMaxDiscount("");
      setAppCashbackEnabled(false);
      setAppCashbackType("percentage");
      setAppCashbackValue("");
    }

    setIsModalOpen(true);
  };

  const handleToggleTarget = (channel: string) => {
    setTargets(prev => 
      prev.includes(channel) 
        ? prev.filter(t => t !== channel) 
        : [...prev, channel]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (targets.length === 0) {
      toast.error("Please select at least one target channel (Web Store or Mobile App).");
      return;
    }

    setSubmitLoading(true);
    const saveToast = toast.loading("Deploying promotion...");

    const webstoreSettings = targets.includes("webstore") ? {
      discountType: webstoreDiscountType,
      discountValue: parseFloat(webstoreDiscountValue || "0"),
      minOrderValue: parseFloat(webstoreMinOrderValue || "0"),
      applicability: webstoreApplicability,
      prepaidDiscountType: prepaidDiscountType,
      prepaidDiscountValue: parseFloat(prepaidDiscountValue || "0"),
      codDiscountType: codDiscountType,
      codDiscountValue: parseFloat(codDiscountValue || "0"),
      applyAsStoreCredit: webstoreApplyAsStoreCredit,
      cashbackEnabled: webstoreCashbackEnabled,
      cashbackType: webstoreCashbackType,
      cashbackValue: parseFloat(webstoreCashbackValue || "0")
    } : null;

    const appSettings = targets.includes("app") ? {
      type: appDiscountType,
      value: parseFloat(appDiscountValue || "0"),
      minOrderAmount: parseFloat(appMinOrderAmount || "0"),
      maxDiscount: appMaxDiscount ? parseFloat(appMaxDiscount) : null,
      cashbackEnabled: appCashbackEnabled,
      cashbackType: appCashbackType,
      cashbackValue: parseFloat(appCashbackValue || "0")
    } : null;

    const payload = {
      code: code.toUpperCase().trim(),
      targets,
      description,
      validFrom: validFrom ? new Date(validFrom).toISOString() : new Date().toISOString(),
      validUntil: validUntil ? new Date(validUntil).toISOString() : null,
      usageLimit: usageLimit ? parseInt(usageLimit) : null,
      isActive,
      autoApply,
      isSecure,
      webstoreSettings,
      appSettings
    };

    try {
      const res = await fetch("/api/discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        toast.success(editingCampaign ? "Campaign updated successfully!" : "Incentive code deployed successfully!", { id: saveToast });
        setIsModalOpen(false);
        fetchCampaigns();
      } else {
        toast.error(data.error || "Failed to save promotion.", { id: saveToast });
      }
    } catch (err) {
      toast.error("Network error saving campaign.", { id: saveToast });
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = async (campaign: Campaign) => {
    if (!confirm(`Are you sure you want to delete campaign code ${campaign.code}? This will remove it from both Web and Mobile systems.`)) return;
    const delToast = toast.loading(`Deleting promo code ${campaign.code}...`);
    try {
      const res = await fetch(`/api/discounts?code=${campaign.code}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast.success("Promo code deleted completely from all channels.", { id: delToast });
        fetchCampaigns();
      } else {
        toast.error(data.error || "Failed to delete promotion.", { id: delToast });
      }
    } catch (err) {
      toast.error("Failed to delete", { id: delToast });
    }
  };

  const filteredCampaigns = campaigns.filter(c => {
    const matchesSearch = c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description?.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (!matchesSearch) return false;
    
    if (filterChannel === "webstore") return c.targets.includes("webstore");
    if (filterChannel === "app") return c.targets.includes("app");
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-10 pb-20 px-2 md:px-4">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 pt-6 md:pt-10">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-emerald-500/10 rounded-lg">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
             </div>
             <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-500">Revenue Optimization Active</span>
          </div>
          <h1 className="text-5xl font-bold text-foreground uppercase tracking-tighter leading-none">
            Promo <span className="text-foreground/30">Architect</span>
          </h1>
          <p className="text-[11px] text-foreground/50 font-bold uppercase tracking-[0.4em] max-w-xl leading-relaxed">
            Configure dynamic multi-channel incentives. Manage unified promo codes, checkout rules, and cashback campaigns.
          </p>
        </div>

        <button 
          onClick={openAddModal}
          className="bg-foreground text-background h-14 px-10 rounded-2xl font-bold text-[10px] uppercase tracking-[0.3em] hover:scale-105 active:scale-95 transition-all shadow-2xl flex items-center justify-center gap-4"
        >
          <Plus className="w-4 h-4" />
          <span>Generate New Code</span>
        </button>
      </div>

      {/* Stats & Search Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass p-6 rounded-3xl border-foreground/[0.03] flex items-center gap-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/10">
            <Tag className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <div className="text-2xl font-black">{campaigns.length}</div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-foreground/30">Active Campaigns</div>
          </div>
        </div>
        
        <div className="md:col-span-2 glass p-4 rounded-3xl border-foreground/[0.03] flex flex-col sm:flex-row items-center gap-4">
          <div className="flex items-center gap-3 flex-1 w-full">
            <Search className="w-5 h-5 text-foreground/20 ml-2" />
            <input 
              type="text" 
              placeholder="Filter by code or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-sm font-medium placeholder:text-foreground/20 text-foreground"
            />
          </div>
          <div className="hidden sm:block h-8 w-px bg-foreground/10" />
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Filter className="w-5 h-5 text-foreground/20" />
            <select
              value={filterChannel}
              onChange={(e) => setFilterChannel(e.target.value)}
              className="bg-transparent border border-foreground/10 sm:border-none rounded-xl px-3 py-2 sm:p-0 outline-none text-[10px] font-bold uppercase tracking-wider text-foreground/60 cursor-pointer pr-4 w-full sm:w-auto"
            >
              <option value="all" className="bg-[#0e0e0e] text-foreground">All Channels</option>
              <option value="webstore" className="bg-[#0e0e0e] text-foreground">Web Store Only</option>
              <option value="app" className="bg-[#0e0e0e] text-foreground">Mobile App Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Campaigns Listing */}
      <div className="glass rounded-[2.5rem] overflow-hidden border-foreground/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="border-b border-foreground/[0.05] bg-foreground/[0.02]">
                <th className="px-8 py-6 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/30">Promo Code</th>
                <th className="px-8 py-6 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/30">Targets</th>
                <th className="px-8 py-6 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/30">Configuration Details</th>
                <th className="px-8 py-6 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/30">Validity</th>
                <th className="px-8 py-6 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/30">Usage</th>
                <th className="px-8 py-6 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/30 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/[0.03]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-8 py-20 text-center">
                    <div className="flex flex-col items-center gap-4 opacity-20">
                      <Clock className="w-8 h-8 animate-spin text-foreground" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Accessing Secure Vault...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-8 py-20 text-center">
                    <div className="flex flex-col items-center gap-4 opacity-20">
                      <Tag className="w-8 h-8 text-foreground" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">No promotions defined</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCampaigns.map((campaign) => (
                  <tr key={campaign.code} className="hover:bg-foreground/[0.02] transition-colors group">
                    <td className="px-8 py-6">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                          <span className="px-4 py-1.5 bg-foreground text-background text-[11px] font-black rounded-lg tracking-widest uppercase">
                            {campaign.code}
                          </span>
                          {!campaign.isActive && (
                            <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" title="Inactive" />
                          )}
                        </div>
                        <span className="text-[10px] font-medium text-foreground/40 max-w-[200px] truncate">{campaign.description || 'No description'}</span>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-wrap items-center gap-2">
                        {campaign.targets.includes("webstore") && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-wider">
                            <Monitor className="w-3 h-3" /> Web
                          </span>
                        )}
                        {campaign.targets.includes("app") && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black bg-purple-500/10 text-purple-400 border border-purple-500/20 uppercase tracking-wider">
                            <Smartphone className="w-3 h-3" /> App
                          </span>
                        )}
                        {campaign.autoApply && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider">
                            Auto-Apply
                          </span>
                        )}
                        {campaign.isSecure && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
                            Secure
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col gap-2 text-xs">
                        {/* Web Store configuration details */}
                        {campaign.webstoreSettings && (
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest block">Web Store configuration:</span>
                            <div className="flex flex-wrap gap-2 text-foreground/80 font-medium">
                              {campaign.webstoreSettings.applicability === "CUSTOM_RATES" ? (
                                <>
                                  <span className="bg-foreground/5 px-2 py-0.5 rounded text-[10px]">
                                    Prepaid: {campaign.webstoreSettings.prepaidDiscountType === "percentage" ? `${campaign.webstoreSettings.prepaidDiscountValue}%` : `₹${campaign.webstoreSettings.prepaidDiscountValue}`}
                                  </span>
                                  <span className="bg-foreground/5 px-2 py-0.5 rounded text-[10px]">
                                    COD: {campaign.webstoreSettings.codDiscountType === "percentage" ? `${campaign.webstoreSettings.codDiscountValue}%` : `₹${campaign.webstoreSettings.codDiscountValue}`}
                                  </span>
                                </>
                              ) : (
                                <span className="bg-foreground/5 px-2 py-0.5 rounded text-[10px]">
                                  {campaign.webstoreSettings.discountType === "percentage" ? `${campaign.webstoreSettings.discountValue}%` : `₹${campaign.webstoreSettings.discountValue}`} Off ({campaign.webstoreSettings.applicability})
                                </span>
                              )}
                              {campaign.webstoreSettings.applyAsStoreCredit && (
                                <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider">Store Credit</span>
                              )}
                              {campaign.webstoreSettings.cashbackEnabled && (
                                <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider">
                                  + {campaign.webstoreSettings.cashbackType === "percentage" ? `${campaign.webstoreSettings.cashbackValue}%` : `₹${campaign.webstoreSettings.cashbackValue}`} Cashback
                                </span>
                              )}
                            </div>
                            <span className="text-[9px] text-foreground/30 font-bold uppercase">Min Spend: ₹{campaign.webstoreSettings.minOrderValue}</span>
                          </div>
                        )}

                        {/* Mobile App configuration details */}
                        {campaign.appSettings && (
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold text-purple-400 uppercase tracking-widest block">Mobile App configuration:</span>
                            <div className="flex flex-wrap gap-2 text-foreground/80 font-medium">
                              <span className="bg-foreground/5 px-2 py-0.5 rounded text-[10px]">
                                {campaign.appSettings.type === "percentage" ? `${campaign.appSettings.value}%` : `₹${campaign.appSettings.value}`} Off
                              </span>
                              {campaign.appSettings.maxDiscount && (
                                <span className="bg-foreground/5 px-2 py-0.5 rounded text-[10px]">Max off: ₹{campaign.appSettings.maxDiscount}</span>
                              )}
                              {campaign.appSettings.cashbackEnabled && (
                                <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider">
                                  + {campaign.appSettings.cashbackType === "percentage" ? `${campaign.appSettings.cashbackValue}%` : `₹${campaign.appSettings.cashbackValue}`} Cashback
                                </span>
                              )}
                            </div>
                            <span className="text-[9px] text-foreground/30 font-bold uppercase">Min Spend: ₹{campaign.appSettings.minOrderAmount}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-[11px] font-bold text-foreground/70">
                          <Calendar className="w-3 h-3 opacity-30" />
                          <span>{campaign.validUntil ? format(new Date(campaign.validUntil), "MMM d, yyyy") : 'Infinite'}</span>
                        </div>
                        <span className={`text-[9px] font-black uppercase tracking-widest ${campaign.validUntil && new Date(campaign.validUntil) < new Date() ? 'text-red-500/50' : 'text-emerald-500/50'}`}>
                          {campaign.validUntil && new Date(campaign.validUntil) < new Date() ? 'Expired' : 'Live'}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col gap-2">
                        <div className="w-24 h-1.5 bg-foreground/5 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-500" 
                            style={{ width: campaign.usageLimit ? `${(campaign.usedCount / campaign.usageLimit) * 100}%` : '5%' }} 
                          />
                        </div>
                        <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-widest">
                          {campaign.usedCount} / {campaign.usageLimit || '∞'} Redemptions
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(campaign)}
                          className="p-3 bg-foreground/5 hover:bg-foreground/10 text-foreground/40 hover:text-foreground rounded-xl transition-all border border-transparent hover:border-foreground/10"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(campaign)}
                          className="p-3 bg-red-500/5 hover:bg-red-500/10 text-red-500/30 hover:text-red-500 rounded-xl transition-all border border-transparent hover:border-red-500/20"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Campaign generation Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-background/60 backdrop-blur-xl"
            />
            
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-3xl glass rounded-[2.5rem] shadow-[0_0_100px_rgba(0,0,0,0.2)] overflow-hidden border-foreground/5 my-8 max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-6 md:p-8 border-b border-foreground/5 flex justify-between items-center shrink-0">
                <div className="space-y-1">
                  <h2 className="text-2xl font-black uppercase tracking-tight">
                    {editingCampaign ? "Edit Campaign" : "Code Generation"}
                  </h2>
                  <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.2em]">Configure dynamic campaign rules and targets</p>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center hover:bg-foreground/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Modal Content */}
              <div className="p-6 md:p-8 overflow-y-auto flex-1 custom-scrollbar space-y-8">
                <form onSubmit={handleSubmit} className="space-y-8">
                  {/* Basic settings */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Promo Identifier</label>
                      <input 
                        required
                        disabled={!!editingCampaign}
                        type="text" 
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        placeholder="SUMMER25"
                        className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-2xl px-6 py-4 text-sm font-bold uppercase tracking-widest outline-none focus:border-foreground/20 disabled:opacity-50"
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Target Platforms</label>
                      <div className="flex bg-foreground/[0.03] p-1.5 rounded-2xl border border-foreground/[0.05] gap-2">
                        <button 
                          type="button"
                          onClick={() => handleToggleTarget("webstore")}
                          className={`flex-1 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                            targets.includes("webstore") ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-lg" : "opacity-30 border border-transparent"
                          }`}
                        >
                          <Monitor className="w-4 h-4" /> Web Store
                        </button>
                        <button 
                          type="button"
                          onClick={() => handleToggleTarget("app")}
                          className={`flex-1 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                            targets.includes("app") ? "bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-lg" : "opacity-30 border border-transparent"
                          }`}
                        >
                          <Smartphone className="w-4 h-4" /> Mobile App
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-3">
                      <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Start Date</label>
                      <input 
                        required
                        type="date" 
                        value={validFrom}
                        onChange={(e) => setValidFrom(e.target.value)}
                        className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:border-foreground/20 text-foreground"
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Expiration Date</label>
                      <input 
                        type="date" 
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                        className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:border-foreground/20 text-foreground"
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Global Usage Limit</label>
                      <input 
                        type="number" 
                        value={usageLimit}
                        onChange={(e) => setUsageLimit(e.target.value)}
                        placeholder="Infinite"
                        className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:border-foreground/20 text-foreground"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Campaign Description</label>
                    <textarea 
                      rows={2}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Add an internal campaign note (e.g. 15% off for Diwali campaigns)..."
                      className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-2xl px-6 py-4 text-sm font-medium outline-none focus:border-foreground/20 resize-none text-foreground"
                    />
                  </div>

                  {/* Campaign Auto Apply & Security Options */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-[2rem] bg-foreground/[0.02] border border-foreground/[0.05]">
                    <div className="flex items-start gap-3">
                      <input 
                        type="checkbox"
                        id="autoApplyToggle"
                        checked={autoApply}
                        onChange={(e) => setAutoApply(e.target.checked)}
                        className="w-5 h-5 rounded-lg border-2 border-foreground/10 bg-background checked:bg-foreground checked:border-foreground transition-all cursor-pointer appearance-none relative checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-background checked:after:text-[10px] checked:after:font-black"
                      />
                      <label htmlFor="autoApplyToggle" className="flex flex-col cursor-pointer select-none">
                        <span className="text-[12px] font-bold text-foreground">Auto-Apply on Checkout</span>
                        <span className="text-[9px] text-foreground/40 font-medium">Automatically rank and apply this discount when customer meets criteria.</span>
                      </label>
                    </div>

                    <div className="flex items-start gap-3">
                      <input 
                        type="checkbox"
                        id="isSecureToggle"
                        checked={isSecure}
                        onChange={(e) => setIsSecure(e.target.checked)}
                        className="w-5 h-5 rounded-lg border-2 border-foreground/10 bg-background checked:bg-foreground checked:border-foreground transition-all cursor-pointer appearance-none relative checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-background checked:after:text-[10px] checked:after:font-black"
                      />
                      <label htmlFor="isSecureToggle" className="flex flex-col cursor-pointer select-none">
                        <span className="text-[12px] font-bold text-foreground">Secure Promotion (Manual Entry Only)</span>
                        <span className="text-[9px] text-foreground/40 font-medium">Hide code from active listings and require manual typing to validate.</span>
                      </label>
                    </div>
                  </div>

                  {/* ──────────────────────────────────────────────────────── */}
                  {/* Web Store Options Panel */}
                  {/* ──────────────────────────────────────────────────────── */}
                  {targets.includes("webstore") && (
                    <div className="p-6 rounded-[2rem] bg-blue-500/[0.02] border border-blue-500/10 space-y-6">
                      <div className="flex items-center gap-2">
                        <Monitor className="w-5 h-5 text-blue-400" />
                        <h3 className="text-sm font-black uppercase tracking-widest text-blue-400">Web Store Specific Settings</h3>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-3">
                          <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Discount Mode</label>
                          <div className="flex bg-foreground/[0.03] p-1 rounded-2xl border border-foreground/[0.05]">
                            <button 
                              type="button"
                              onClick={() => setWebstoreDiscountType("percentage")}
                              className={`flex-1 py-3 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all ${webstoreDiscountType === "percentage" ? "bg-foreground text-background shadow-md" : "opacity-40"}`}
                            >Percent</button>
                            <button 
                              type="button"
                              onClick={() => setWebstoreDiscountType("fixed")}
                              className={`flex-1 py-3 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all ${webstoreDiscountType === "fixed" ? "bg-foreground text-background shadow-md" : "opacity-40"}`}
                            >Fixed</button>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">
                            Discount Value ({webstoreDiscountType === "percentage" ? "%" : "₹"})
                          </label>
                          <input 
                            required={targets.includes("webstore") && webstoreApplicability !== "CUSTOM_RATES"}
                            disabled={webstoreApplicability === "CUSTOM_RATES"}
                            type="number"
                            value={webstoreDiscountValue}
                            onChange={(e) => setWebstoreDiscountValue(e.target.value)}
                            className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:border-foreground/20 text-foreground disabled:opacity-25"
                          />
                        </div>

                        <div className="space-y-3">
                          <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Min Spend (₹)</label>
                          <input 
                            type="number" 
                            value={webstoreMinOrderValue}
                            onChange={(e) => setWebstoreMinOrderValue(e.target.value)}
                            className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:border-foreground/20 text-foreground"
                          />
                        </div>
                      </div>

                      {/* Applicability setting */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                          <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Applicability Filter</label>
                          <select
                            value={webstoreApplicability}
                            onChange={(e) => setWebstoreApplicability(e.target.value)}
                            className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:border-foreground/20 text-foreground"
                          >
                            <option value="ALL" className="bg-[#0e0e0e]">Prepaid & COD (Universal)</option>
                            <option value="PREPAID_ONLY" className="bg-[#0e0e0e]">Prepaid Orders Only</option>
                            <option value="COD_ONLY" className="bg-[#0e0e0e]">COD Orders Only</option>
                            <option value="CUSTOM_RATES" className="bg-[#0e0e0e]">Custom Rates (Prepaid vs COD)</option>
                          </select>
                        </div>

                        <div className="flex items-center pt-8">
                          <label className="flex items-center gap-3 cursor-pointer select-none">
                            <input 
                              type="checkbox"
                              checked={webstoreApplyAsStoreCredit}
                              onChange={(e) => setWebstoreApplyAsStoreCredit(e.target.checked)}
                              className="w-5 h-5 rounded-lg border-2 border-foreground/10 bg-background checked:bg-foreground checked:border-foreground transition-all cursor-pointer appearance-none relative checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-background checked:after:text-[10px] checked:after:font-black"
                            />
                            <div className="flex flex-col">
                              <span className="text-[12px] font-bold text-foreground">Apply as Store Credit Discount</span>
                              <span className="text-[9px] text-foreground/40 font-medium">Subtract discount and issue as store credits instead.</span>
                            </div>
                          </label>
                        </div>
                      </div>

                      {/* Webstore Custom Rates settings */}
                      {webstoreApplicability === "CUSTOM_RATES" && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/[0.04]">
                          {/* Prepaid rates */}
                          <div className="space-y-4">
                            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest block">Prepaid Checkout Rates</span>
                            <div className="flex gap-4">
                              <div className="w-24">
                                <select
                                  value={prepaidDiscountType}
                                  onChange={(e) => setPrepaidDiscountType(e.target.value)}
                                  className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-xl px-2 py-3.5 text-xs font-bold outline-none text-foreground"
                                >
                                  <option value="percentage">% Off</option>
                                  <option value="fixed">₹ Off</option>
                                </select>
                              </div>
                              <input 
                                required={webstoreApplicability === "CUSTOM_RATES"}
                                type="number" 
                                placeholder="Value"
                                value={prepaidDiscountValue}
                                onChange={(e) => setPrepaidDiscountValue(e.target.value)}
                                className="flex-1 bg-foreground/[0.03] border border-foreground/[0.05] rounded-xl px-4 py-3.5 text-sm font-bold outline-none text-foreground"
                              />
                            </div>
                          </div>

                          {/* COD rates */}
                          <div className="space-y-4">
                            <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest block">COD Checkout Rates</span>
                            <div className="flex gap-4">
                              <div className="w-24">
                                <select
                                  value={codDiscountType}
                                  onChange={(e) => setCodDiscountType(e.target.value)}
                                  className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-xl px-2 py-3.5 text-xs font-bold outline-none text-foreground"
                                >
                                  <option value="percentage">% Off</option>
                                  <option value="fixed">₹ Off</option>
                                </select>
                              </div>
                              <input 
                                required={webstoreApplicability === "CUSTOM_RATES"}
                                type="number" 
                                placeholder="Value"
                                value={codDiscountValue}
                                onChange={(e) => setCodDiscountValue(e.target.value)}
                                className="flex-1 bg-foreground/[0.03] border border-foreground/[0.05] rounded-xl px-4 py-3.5 text-sm font-bold outline-none text-foreground"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Webstore Cashback Reward options */}
                      <div className="p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/[0.04] space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-3 cursor-pointer select-none">
                            <input 
                              type="checkbox"
                              checked={webstoreCashbackEnabled}
                              onChange={(e) => setWebstoreCashbackEnabled(e.target.checked)}
                              className="w-5 h-5 rounded-lg border-2 border-foreground/10 bg-background checked:bg-foreground checked:border-foreground transition-all cursor-pointer appearance-none relative checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-background checked:after:text-[10px] checked:after:font-black"
                            />
                            <div className="flex flex-col">
                              <span className="text-[12px] font-bold text-foreground">Double Cashback Rewards</span>
                              <span className="text-[9px] text-foreground/40 font-medium">Issue store credits cashback after successful delivery (webstore). Calculated on amount paid after instant discount.</span>
                            </div>
                          </label>
                        </div>

                        {webstoreCashbackEnabled && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                            <div className="space-y-2">
                              <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Cashback Type</label>
                              <select
                                value={webstoreCashbackType}
                                onChange={(e) => setWebstoreCashbackType(e.target.value)}
                                className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-xl px-4 py-3 text-xs font-bold outline-none text-foreground"
                              >
                                <option value="percentage">Percentage (%)</option>
                                <option value="fixed">Fixed Amount (₹)</option>
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Cashback Value</label>
                              <input 
                                required={webstoreCashbackEnabled}
                                type="number" 
                                value={webstoreCashbackValue}
                                onChange={(e) => setWebstoreCashbackValue(e.target.value)}
                                className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-xl px-4 py-3 text-sm font-bold outline-none text-foreground"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ──────────────────────────────────────────────────────── */}
                  {/* Mobile App Options Panel */}
                  {/* ──────────────────────────────────────────────────────── */}
                  {targets.includes("app") && (
                    <div className="p-6 rounded-[2rem] bg-purple-500/[0.02] border border-purple-500/10 space-y-6">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-5 h-5 text-purple-400" />
                        <h3 className="text-sm font-black uppercase tracking-widest text-purple-400">Mobile App Specific Settings</h3>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="space-y-3">
                          <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Discount Mode</label>
                          <div className="flex bg-foreground/[0.03] p-1 rounded-2xl border border-foreground/[0.05]">
                            <button 
                              type="button"
                              onClick={() => setAppDiscountType("percentage")}
                              className={`flex-1 py-3 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all ${appDiscountType === "percentage" ? "bg-foreground text-background shadow-md" : "opacity-40"}`}
                            >Percent</button>
                            <button 
                              type="button"
                              onClick={() => setAppDiscountType("fixed")}
                              className={`flex-1 py-3 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all ${appDiscountType === "fixed" ? "bg-foreground text-background shadow-md" : "opacity-40"}`}
                            >Fixed</button>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">
                            Discount Value ({appDiscountType === "percentage" ? "%" : "₹"})
                          </label>
                          <input 
                            required={targets.includes("app")}
                            type="number"
                            value={appDiscountValue}
                            onChange={(e) => setAppDiscountValue(e.target.value)}
                            className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:border-foreground/20 text-foreground"
                          />
                        </div>

                        <div className="space-y-3">
                          <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Min Spend (₹)</label>
                          <input 
                            type="number" 
                            value={appMinOrderAmount}
                            onChange={(e) => setAppMinOrderAmount(e.target.value)}
                            className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:border-foreground/20 text-foreground"
                          />
                        </div>

                        <div className="space-y-3">
                          <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Max Cap (₹)</label>
                          <input 
                            type="number"
                            disabled={appDiscountType === "fixed"}
                            value={appMaxDiscount}
                            onChange={(e) => setAppMaxDiscount(e.target.value)}
                            placeholder={appDiscountType === "fixed" ? "N/A" : "Infinite"}
                            className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:border-foreground/20 text-foreground disabled:opacity-20"
                          />
                        </div>
                      </div>

                      {/* App Cashback options */}
                      <div className="p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/[0.04] space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-3 cursor-pointer select-none">
                            <input 
                              type="checkbox"
                              checked={appCashbackEnabled}
                              onChange={(e) => setAppCashbackEnabled(e.target.checked)}
                              className="w-5 h-5 rounded-lg border-2 border-foreground/10 bg-background checked:bg-foreground checked:border-foreground transition-all cursor-pointer appearance-none relative checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-background checked:after:text-[10px] checked:after:font-black"
                            />
                            <div className="flex flex-col">
                              <span className="text-[12px] font-bold text-foreground">App Store Credit Cashback</span>
                              <span className="text-[9px] text-foreground/40 font-medium">Issue store credits cashback after successful delivery (mobile app). Calculated on amount paid after instant discount.</span>
                            </div>
                          </label>
                        </div>

                        {appCashbackEnabled && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                            <div className="space-y-2">
                              <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Cashback Type</label>
                              <select
                                value={appCashbackType}
                                onChange={(e) => setAppCashbackType(e.target.value)}
                                className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-xl px-4 py-3 text-xs font-bold outline-none text-foreground"
                              >
                                <option value="percentage">Percentage (%)</option>
                                <option value="fixed">Fixed Amount (₹)</option>
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-[9px] font-black uppercase tracking-widest text-foreground/45 ml-1">Cashback Value</label>
                              <input 
                                required={appCashbackEnabled}
                                type="number" 
                                value={appCashbackValue}
                                onChange={(e) => setAppCashbackValue(e.target.value)}
                                className="w-full bg-foreground/[0.03] border border-foreground/[0.05] rounded-xl px-4 py-3 text-sm font-bold outline-none text-foreground"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Actions / Submit button */}
                  <div className="flex items-center justify-between pt-6 border-t border-foreground/5 shrink-0">
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox"
                        id="isActiveToggle"
                        checked={isActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                        className="w-5 h-5 rounded-lg border-2 border-foreground/10 bg-background checked:bg-foreground checked:border-foreground transition-all cursor-pointer appearance-none relative checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-background checked:after:text-[10px] checked:after:font-black"
                      />
                      <label htmlFor="isActiveToggle" className="text-xs font-bold uppercase tracking-wider text-foreground select-none cursor-pointer">
                        Promotion is Live & Active
                      </label>
                    </div>

                    <div className="flex items-center gap-3">
                      <button 
                        type="button"
                        onClick={() => setIsModalOpen(false)}
                        className="px-6 py-4 rounded-2xl bg-foreground/5 hover:bg-foreground/10 text-[10px] font-bold uppercase tracking-widest transition-colors text-foreground"
                      >
                        Cancel
                      </button>
                      <button 
                        disabled={submitLoading}
                        type="submit"
                        className="bg-foreground text-background px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] hover:scale-105 active:scale-95 transition-all shadow-xl flex items-center gap-2 disabled:opacity-50"
                      >
                        {submitLoading ? (
                          <Clock className="w-4.5 h-4.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4 text-emerald-400 fill-emerald-400" />
                        )}
                        <span>{editingCampaign ? "Save Updates" : "Deploy Promotion"}</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
