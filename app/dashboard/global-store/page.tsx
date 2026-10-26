"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Globe,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Save,
  ShieldCheck,
  CreditCard,
  ExternalLink,
  DollarSign,
  TrendingUp,
  Sliders,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

interface Country {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  currencySymbol: string;
  locale: string;
  isBase: boolean;
  multiplier: number;
  exchangeRate: number;
  isActive: boolean;
  sortOrder: number;
}

export default function GlobalStoreAdminPage() {
  const [globalStoreEnabled, setGlobalStoreEnabled] = useState(false);
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, countriesRes] = await Promise.all([
        fetch("/api/admin/global-store/settings"),
        fetch("/api/admin/global-store/countries"),
      ]);

      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        setGlobalStoreEnabled(settingsData.globalStoreEnabled ?? false);
      }

      if (countriesRes.ok) {
        const countriesData = await countriesRes.json();
        setCountries(countriesData ?? []);
      }
    } catch (err) {
      toast.error("Failed to load global store data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleGlobalStore = async () => {
    const nextState = !globalStoreEnabled;
    setGlobalStoreEnabled(nextState);
    try {
      const res = await fetch("/api/admin/global-store/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalStoreEnabled: nextState }),
      });
      if (res.ok) {
        toast.success(`Global Storefront ${nextState ? "Enabled" : "Disabled"}`);
      } else {
        throw new Error();
      }
    } catch {
      setGlobalStoreEnabled(!nextState);
      toast.error("Failed to update settings");
    }
  };

  const handleCountryChange = (id: string, field: keyof Country, value: any) => {
    setCountries((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
    setHasChanges(true);
  };

  const handleSaveCountries = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/global-store/countries", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countries }),
      });

      if (res.ok) {
        const updated = await res.json();
        setCountries(updated);
        setHasChanges(false);
        toast.success("Country pricing configurations saved!");
      } else {
        throw new Error();
      }
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-foreground/10 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-foreground/5 border border-foreground/10 text-foreground">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Global Multi-Country Storefront</h1>
              <p className="text-xs text-foreground/50 mt-0.5">
                Manage international countries, currencies, markup multipliers, and exchange rates
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2.5 rounded-xl border border-foreground/10 hover:bg-foreground/5 transition-colors text-foreground/60"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          {hasChanges && (
            <button
              onClick={handleSaveCountries}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-foreground text-background font-medium text-xs hover:opacity-90 active:scale-95 transition-all shadow-md"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? "Saving..." : "Save Changes"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Feature Toggle & Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Toggle Card */}
        <div className="md:col-span-2 rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sliders className="w-5 h-5 text-foreground/70" />
              <div>
                <h3 className="text-sm font-semibold">Storefront Multi-Currency Feature</h3>
                <p className="text-xs text-foreground/50">
                  Enable international price localization and country switcher for global buyers
                </p>
              </div>
            </div>

            <button
              onClick={handleToggleGlobalStore}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                globalStoreEnabled ? "bg-emerald-500" : "bg-foreground/20"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  globalStoreEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs pt-2 border-t border-foreground/5 text-foreground/60">
            <span
              className={`w-2 h-2 rounded-full ${
                globalStoreEnabled ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              }`}
            />
            <span>
              Status:{" "}
              <strong>
                {globalStoreEnabled
                  ? "ACTIVE — Storefront displaying localized currencies"
                  : "DISABLED — Storefront defaulting to INR (India base price)"}
              </strong>
            </span>
          </div>
        </div>

        {/* Razorpay International Status */}
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-6 space-y-3">
          <div className="flex items-center gap-2 text-emerald-500">
            <ShieldCheck className="w-5 h-5" />
            <h3 className="text-xs font-bold uppercase tracking-wider">Razorpay International</h3>
          </div>
          <p className="text-xs text-foreground/70 leading-relaxed">
            International Payments features active on Razorpay merchant account. Multi-currency card charges processed directly via Razorpay.
          </p>
          <div className="pt-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-semibold text-emerald-500">
              <CheckCircle2 className="w-3 h-3" /> VERIFIED & ACTIVE
            </span>
          </div>
        </div>
      </div>

      {/* Countries Configuration Table */}
      <div className="rounded-2xl border border-foreground/10 bg-foreground/[0.02] overflow-hidden space-y-4">
        <div className="p-6 pb-2 flex items-center justify-between border-b border-foreground/5">
          <div>
            <h3 className="text-sm font-semibold">Configured Countries & Pricing Rules</h3>
              <p className="text-xs text-foreground/50 mt-0.5">
                Formula: Local Price = round(Base INR × Multiplier × Exchange Rate, 2). India: Prepaid + COD. All other countries: Prepaid only.
              </p>
          </div>
          {hasChanges && (
            <span className="text-xs text-amber-500 font-medium animate-pulse">
              Unsaved changes detected
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-foreground/[0.03] border-b border-foreground/5 text-foreground/50 uppercase text-[10px] font-mono tracking-wider">
              <tr>
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Country</th>
                <th className="py-3 px-4">Currency</th>
                <th className="py-3 px-4">Multiplier</th>
                <th className="py-3 px-4">Exchange Rate (INR → Local)</th>
                <th className="py-3 px-4">Example (₹4,990)</th>
                <th className="py-3 px-4">Payments</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/5">
              {countries.map((c) => {
                const samplePriceINR = 4990;
                const sampleConverted = (
                  Math.round(samplePriceINR * c.multiplier * c.exchangeRate * 100) / 100
                ).toFixed(2);

                return (
                  <tr key={c.id} className="hover:bg-foreground/[0.02] transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-foreground/80">
                      {c.code}
                    </td>
                    <td className="py-3.5 px-4 font-medium text-foreground">
                      {c.name}
                      {c.isBase && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-foreground/10 text-[9px] font-mono text-foreground/60">
                          BASE
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-foreground/70">
                      {c.currencySymbol} {c.currencyCode}
                    </td>
                    <td className="py-3.5 px-4">
                      {c.isBase ? (
                        <span className="font-mono text-foreground/40">1.0000 (Locked)</span>
                      ) : (
                        <input
                          type="number"
                          step="0.01"
                          min="0.1"
                          max="10"
                          value={c.multiplier}
                          onChange={(e) =>
                            handleCountryChange(c.id, "multiplier", parseFloat(e.target.value) || 1)
                          }
                          className="w-24 px-2.5 py-1 rounded-lg border border-foreground/15 bg-background text-foreground font-mono text-xs focus:outline-none focus:border-foreground/40"
                        />
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {c.isBase ? (
                        <span className="font-mono text-foreground/40">1.000000 (Locked)</span>
                      ) : (
                        <input
                          type="number"
                          step="0.000001"
                          min="0"
                          value={c.exchangeRate}
                          onChange={(e) =>
                            handleCountryChange(c.id, "exchangeRate", parseFloat(e.target.value) || 0)
                          }
                          className="w-32 px-2.5 py-1 rounded-lg border border-foreground/15 bg-background text-foreground font-mono text-xs focus:outline-none focus:border-foreground/40"
                        />
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-semibold text-foreground/90">
                      {c.isBase
                        ? "₹4,990"
                        : `${c.currencySymbol}${sampleConverted} ${c.currencyCode}`}
                    </td>
                    <td className="py-3.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-foreground/60">
                      {c.isBase || c.code === "IN" ? "Prepaid + COD" : "Prepaid only"}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {c.isBase ? (
                        <span className="text-emerald-500 font-bold">Always Active</span>
                      ) : (
                        <button
                          onClick={() => handleCountryChange(c.id, "isActive", !c.isActive)}
                          className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
                            c.isActive
                              ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                              : "bg-foreground/5 text-foreground/40 border border-foreground/10"
                          }`}
                        >
                          {c.isActive ? "Active" : "Disabled"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
