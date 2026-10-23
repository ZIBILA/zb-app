"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { 
  BarChart3, MessageCircle, Send, CheckCircle2, 
  ArrowUpRight, RefreshCcw, TrendingUp, DollarSign,
  MousePointer, Percent, ShieldCheck, ToggleLeft, ToggleRight, Settings
} from "lucide-react";
import { toast } from "sonner";

const StorefrontEventTrendsChart = dynamic(
  () => import("@/components/admin/charts/StorefrontEventTrendsChart"),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-foreground/[0.03]" />,
  }
);

export default function EventsOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [settings, setSettings] = useState<any>({
    enable_meta_events: false,
    whatsapp_dataset_id: "",
    whatsapp_page_id: ""
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const statsRes = await fetch("/api/whatsapp-events/stats");
        const statsData = await statsRes.json();
        
        const settingsRes = await fetch("/api/whatsapp-events/settings");
        const settingsData = await settingsRes.json();

        if (statsRes.ok) setData(statsData);
        if (settingsRes.ok) setSettings(settingsData);
      } catch (err) {
        toast.error("Failed to load dashboard statistics.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [refreshTrigger]);

  const handleToggleMetaEvents = async () => {
    setSavingSettings(true);
    const updatedStatus = !settings.enable_meta_events;
    const toastId = toast.loading(`${updatedStatus ? "Enabling" : "Disabling"} Meta event forwarding...`);
    
    try {
      const res = await fetch("/api/whatsapp-events/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable_meta_events: updatedStatus })
      });
      if (res.ok) {
        setSettings((prev: any) => ({ ...prev, enable_meta_events: updatedStatus }));
        toast.success(`Meta event forwarding ${updatedStatus ? "enabled" : "disabled"}!`, { id: toastId });
      } else {
        toast.error("Failed to update settings.", { id: toastId });
      }
    } catch (e) {
      toast.error("Network error saving configuration.", { id: toastId });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    const toastId = toast.loading("Saving configuration...");

    try {
      const res = await fetch("/api/whatsapp-events/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          whatsapp_dataset_id: settings.whatsapp_dataset_id,
          whatsapp_page_id: settings.whatsapp_page_id
        })
      });
      if (res.ok) {
        toast.success("Settings updated successfully!", { id: toastId });
      } else {
        toast.error("Failed to save settings.", { id: toastId });
      }
    } catch (e) {
      toast.error("Network error saving settings.", { id: toastId });
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <RefreshCcw className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  const kpis = [
    {
      title: "Total Messages Sent",
      value: data?.metrics?.totalSent ?? 0,
      icon: Send,
      description: "Outbound templates & text messages",
      color: "text-blue-500",
      bg: "bg-blue-500/10"
    },
    {
      title: "Delivery Rate",
      value: `${((data?.metrics?.deliveryRate ?? 0) * 100).toFixed(1)}%`,
      icon: CheckCircle2,
      description: "Delivered & read messages ratio",
      color: "text-emerald-500",
      bg: "bg-emerald-500/10"
    },
    {
      title: "Read Rate",
      value: `${((data?.metrics?.readRate ?? 0) * 100).toFixed(1)}%`,
      icon: MessageCircle,
      description: "Proportion of read messages",
      color: "text-violet-500",
      bg: "bg-violet-500/10"
    },
    {
      title: "Click Rate",
      value: `${((data?.metrics?.clickRate ?? 0) * 100).toFixed(1)}%`,
      icon: MousePointer,
      description: "Campaign button interactions",
      color: "text-amber-500",
      bg: "bg-amber-500/10"
    },
    {
      title: "Conversion Rate",
      value: `${((data?.metrics?.conversionRate ?? 0) * 100).toFixed(1)}%`,
      icon: Percent,
      description: "Purchase attribution from sends",
      color: "text-rose-500",
      bg: "bg-rose-500/10"
    },
    {
      title: "Attributed Revenue",
      value: `₹${(data?.metrics?.totalRevenue ?? 0).toLocaleString('en-IN')}`,
      icon: DollarSign,
      description: "Revenue originating from WhatsApp",
      color: "text-teal-500",
      bg: "bg-teal-500/10"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header section with toggle */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WhatsApp Events Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time monitoring of marketing, commerce, and user tracking events.</p>
        </div>

        <div className="flex items-center gap-4 bg-foreground/5 p-3 rounded-2xl border border-foreground/10 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <ShieldCheck className={`w-5 h-5 ${settings.enable_meta_events ? "text-emerald-500" : "text-muted-foreground"}`} />
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-foreground/90">Meta Conversions API</span>
              <span className="text-[10px] text-muted-foreground">{settings.enable_meta_events ? "Forwarding Active" : "Local Storage Only"}</span>
            </div>
          </div>
          
          <button 
            onClick={handleToggleMetaEvents}
            disabled={savingSettings}
            className="text-foreground transition-opacity hover:opacity-80"
          >
            {settings.enable_meta_events ? (
              <ToggleRight className="w-10 h-10 text-emerald-500" />
            ) : (
              <ToggleLeft className="w-10 h-10 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={kpi.title}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="glass-card p-6 flex items-start justify-between"
            >
              <div className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{kpi.title}</span>
                <h2 className="text-2xl font-bold tracking-tight">{kpi.value}</h2>
                <p className="text-[11px] text-muted-foreground">{kpi.description}</p>
              </div>
              <div className={`p-3 rounded-xl ${kpi.bg} ${kpi.color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Charts section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Daily Event Activity */}
        <div className="lg:col-span-2 glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <h3 className="font-semibold text-base">Storefront Event Trends</h3>
            </div>
            <span className="text-[10px] text-muted-foreground uppercase font-mono">Last 14 Days</span>
          </div>

          <div className="h-72 w-full pt-4">
            <StorefrontEventTrendsChart data={data?.dailyCounts || []} />
          </div>
        </div>

        {/* Funnel conversion Rate */}
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-500" />
              <h3 className="font-semibold text-base">Conversion Funnel</h3>
            </div>
            <span className="text-[10px] text-muted-foreground uppercase font-mono">Event Flow</span>
          </div>

          <div className="space-y-4 pt-4">
            {data?.funnel?.map((step: any, index: number) => (
              <div key={step.name} className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-foreground/80">{step.name}</span>
                  <div className="space-x-2">
                    <span className="font-bold">{step.value}</span>
                    <span className="text-[10px] text-muted-foreground">({step.rate}%)</span>
                  </div>
                </div>
                
                <div className="w-full bg-foreground/5 h-2 rounded-full overflow-hidden border border-foreground/5">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${step.rate}%` }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Meta API Settings Manager */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-2 border-b border-foreground/5 pb-3">
          <Settings className="w-5 h-5 text-emerald-500 animate-pulse" />
          <h3 className="font-semibold text-base">Meta Conversions API Settings</h3>
        </div>

        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground/60 uppercase block">Meta Dataset / Pixel ID</label>
            <input
              type="text"
              placeholder="e.g. 2417186128794726"
              value={settings.whatsapp_dataset_id}
              onChange={(e) => setSettings((s: any) => ({ ...s, whatsapp_dataset_id: e.target.value }))}
              className="glass-input w-full"
            />
            <p className="text-[10px] text-muted-foreground">The dataset ID where conversions should be sent under Meta Events Manager.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground/60 uppercase block">Facebook Page ID</label>
            <input
              type="text"
              placeholder="e.g. 104278453472091"
              value={settings.whatsapp_page_id}
              onChange={(e) => setSettings((s: any) => ({ ...s, whatsapp_page_id: e.target.value }))}
              className="glass-input w-full"
            />
            <p className="text-[10px] text-muted-foreground">The ID of the Facebook page linked with your WhatsApp Business Account.</p>
          </div>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={savingSettings}
              className="glass-cta"
            >
              {savingSettings ? "Saving Settings..." : "Save Settings"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
