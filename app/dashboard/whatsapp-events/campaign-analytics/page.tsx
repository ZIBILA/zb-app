"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { 
  TrendingUp, Send, CheckCircle2, MessageCircle, DollarSign,
  Percent, BarChart3, RefreshCcw, Sparkles, Megaphone, Calendar,
  Search, ExternalLink
} from "lucide-react";
import { toast } from "sonner";

const TemplateRevenueChart = dynamic(
  () => import("@/components/admin/charts/TemplateRevenueChart"),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-foreground/[0.03]" />,
  }
);

export default function CampaignAnalyticsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // Search & Filter State
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    async function loadStats() {
      setLoading(true);
      try {
        const res = await fetch("/api/whatsapp-events/stats");
        const statsData = await res.json();
        if (res.ok) {
          setData(statsData);
        } else {
          toast.error("Failed to load analytics details.");
        }
      } catch (err) {
        toast.error("Network error loading analytics.");
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <RefreshCcw className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  // Pre-arrange template data for charts
  const chartData = data?.templates?.map((t: any) => ({
    name: t.templateName.replace("zb_", "").replace("zica_", "").replace("_v1", ""),
    revenue: t.revenue,
    conversions: t.conversions
  })) || [];

  // Filter campaigns
  const filteredCampaigns = (data?.recentCampaigns || []).filter((camp: any) => {
    const name = camp.campaign_name || camp.name || "";
    const matchesSearch = name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || camp.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "border-emerald-500/20 text-emerald-500 bg-emerald-500/10";
      case "sending": return "border-blue-500/20 text-blue-500 bg-blue-500/10 animate-pulse";
      case "scheduled": return "border-amber-500/20 text-amber-500 bg-amber-500/10";
      case "paused": return "border-violet-500/20 text-violet-500 bg-violet-500/10";
      case "cancelled": return "border-foreground/30 text-foreground/50 bg-foreground/30";
      default: return "border-rose-500/20 text-rose-500 bg-rose-500/10";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaign Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Detailed performance tracking, conversions attribution, and templates optimization.</p>
        </div>

        <button 
          onClick={() => setRefreshTrigger(p => p + 1)}
          className="p-2.5 bg-foreground/5 hover:bg-foreground/10 text-foreground border border-foreground/10 rounded-xl transition-all"
        >
          <RefreshCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Template Revenue Attribution Chart */}
        <div className="lg:col-span-2 glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-500" />
              <h3 className="font-semibold text-base">Revenue Attribution by Template</h3>
            </div>
            <span className="text-[10px] text-muted-foreground uppercase font-mono">Sales Share</span>
          </div>

          <div className="h-72 w-full pt-4">
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No revenue logs recorded yet.
              </div>
            ) : (
              <TemplateRevenueChart data={chartData} />
            )}
          </div>
        </div>

        {/* Campaign conversions Rate Summary */}
        <div className="glass-card p-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <h3 className="font-semibold text-base">Conversion Summary</h3>
              </div>
              <Percent className="w-4 h-4 text-emerald-400" />
            </div>

            <div className="space-y-6 pt-4">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-xl">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Total Broadcasts</span>
                  <h4 className="text-xl font-bold">{data?.metrics?.totalSent ?? 0}</h4>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl">
                  <Percent className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Conversion Efficiency</span>
                  <h4 className="text-xl font-bold">{((data?.metrics?.conversionRate ?? 0) * 100).toFixed(2)}%</h4>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="p-3 bg-teal-500/10 text-teal-500 rounded-xl">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Aesthetic Sales Yield</span>
                  <h4 className="text-xl font-bold">₹{(data?.metrics?.totalRevenue ?? 0).toLocaleString('en-IN')}</h4>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-foreground/5 text-xs text-muted-foreground">
            Attributed using direct session checks and Click-to-WhatsApp link referral logging.
          </div>
        </div>

      </div>

      {/* Campaigns list table */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-foreground/5">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-emerald-500" />
            <h3 className="font-semibold text-base">Campaigns Performance Registry</h3>
          </div>

          {/* Filters & Search Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search campaigns..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-foreground/5 border border-foreground/10 rounded-xl pl-8 pr-4 py-1.5 outline-none focus:border-emerald-500/50 text-xs w-48 text-foreground"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-1.5 outline-none text-xs text-foreground focus:border-emerald-500/50"
            >
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="sending">Sending</option>
              <option value="scheduled">Scheduled</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          {filteredCampaigns.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No matching campaigns found. Try adjusting your filter or search query.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-foreground/5 bg-foreground/[0.01] text-xs font-bold text-muted-foreground uppercase">
                  <th className="px-5 py-3">Campaign Name</th>
                  <th className="px-5 py-3">Template</th>
                  <th className="px-5 py-3">Target</th>
                  <th className="px-5 py-3">Sent</th>
                  <th className="px-5 py-3">Delivered</th>
                  <th className="px-5 py-3">Read</th>
                  <th className="px-5 py-3">Clicks</th>
                  <th className="px-5 py-3">Conversions</th>
                  <th className="px-5 py-3 text-right">Revenue</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/5 text-sm">
                {filteredCampaigns.map((camp: any) => {
                  const sent = camp.total_sent || camp.statsSent || 0;
                  const del = camp.delivered || camp.statsDelivered || 0;
                  const read = camp.read_count || camp.statsRead || 0;
                  const clicks = camp.click_count || 0;
                  const convs = camp.conversions || 0;
                  const rev = camp.revenue_generated || 0;

                  return (
                    <tr 
                      key={camp.id} 
                      className="hover:bg-foreground/[0.03] cursor-pointer transition-colors group"
                      onClick={() => router.push(`/dashboard/marketing/whatsapp?campaignId=${camp.id}`)}
                    >
                      <td className="px-5 py-3">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground/90 group-hover:text-emerald-500 transition-colors">
                            {camp.campaign_name || camp.name}
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`inline-flex px-1.5 py-0.2 rounded text-[8px] font-bold border uppercase tracking-wider ${getStatusColor(camp.status)}`}>
                              {camp.status}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {new Date(camp.createdAt).toLocaleDateString('en-IN')}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{camp.template_name || camp.templateName}</td>
                      <td className="px-5 py-3 text-xs capitalize text-muted-foreground">{camp.target_audience || camp.targetSegment}</td>
                      <td className="px-5 py-3 font-bold text-foreground/80">{sent}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          <span>{sent > 0 ? `${((del / sent) * 100).toFixed(0)}%` : "0%"}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <MessageCircle className="w-3.5 h-3.5 text-violet-500" />
                          <span>{sent > 0 ? `${((read / sent) * 100).toFixed(0)}%` : "0%"}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 font-semibold text-amber-500">{clicks}</td>
                      <td className="px-5 py-3 font-semibold text-rose-500">{convs}</td>
                      <td className="px-5 py-3 text-right font-bold text-teal-500">₹{rev.toLocaleString('en-IN')}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/dashboard/marketing/whatsapp?campaignId=${camp.id}`);
                          }}
                          className="p-1 bg-foreground/5 hover:bg-emerald-500/10 hover:text-emerald-400 text-muted-foreground border border-foreground/10 rounded-lg transition-all inline-flex items-center justify-center"
                          title="View Details in Hub"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
