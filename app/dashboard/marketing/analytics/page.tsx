"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { 
  BarChart3, TrendingUp, Users, MousePointerClick, 
  MessageCircle, Mail, Bell, MessageSquare, Loader2, Calendar 
} from "lucide-react";

const ChannelSessionsChart = dynamic(
  () => import("@/components/admin/charts/ChannelSessionsChart"),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-foreground/[0.03]" />,
  }
);

export default function AnalyticsHubPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState("lifetime");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/marketing/stats?range=${timeRange}`)
      .then(res => res.json())
      .then(json => {
        setData(json);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch stats:", err);
        setLoading(false);
      });
  }, [timeRange]);

  const stats = [
    { 
      label: "Total Reach", 
      value: data?.summary?.totalReach || "0", 
      change: data?.summary?.changes?.reach || "0%", 
      isPositive: !(data?.summary?.changes?.reach || "0%").startsWith("-"),
      icon: Users 
    },
    { 
      label: "Total Engagement", 
      value: data?.summary?.totalEngagement || "0", 
      change: data?.summary?.changes?.engagement || "0%", 
      isPositive: !(data?.summary?.changes?.engagement || "0%").startsWith("-"),
      icon: MousePointerClick 
    },
    { 
      label: "Avg Conversion", 
      value: data?.summary?.avgConversion || "0%", 
      change: data?.summary?.changes?.conversion || "0%", 
      isPositive: !(data?.summary?.changes?.conversion || "0%").startsWith("-"),
      icon: TrendingUp 
    },
    { 
      label: "Marketing ROI", 
      value: data?.summary?.marketingROI || "0%", 
      change: data?.summary?.changes?.roi || "0%", 
      isPositive: !(data?.summary?.changes?.roi || "0%").startsWith("-"),
      icon: BarChart3 
    },
  ];

  const channelIcons: any = {
    "WhatsApp": { icon: MessageCircle, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    "Email": { icon: Mail, color: "text-blue-500", bg: "bg-blue-500/10" },
    "Push Notifications": { icon: Bell, color: "text-foreground", bg: "bg-foreground/10" },
    "SMS": { icon: MessageSquare, color: "text-purple-500", bg: "bg-purple-500/10" },
  };

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Omnichannel Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Cross-channel marketing performance and engagement</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-foreground/45" />
          <select 
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2 text-sm outline-none cursor-pointer hover:bg-foreground/10 transition-colors"
          >
            <option value="lifetime">Lifetime (Live)</option>
            <option value="30">Last 30 Days</option>
            <option value="7">Last 7 Days</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="h-[50vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-foreground/20" />
        </div>
      ) : (
        <>
          {/* KPI Dashboard */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="glass-card p-5"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-semibold text-foreground/50 tracking-wider uppercase">{stat.label}</span>
                  <stat.icon className="w-4 h-4 text-foreground/40" />
                </div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-2xl font-bold tracking-tight">{stat.value}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                    stat.isPositive ? "text-emerald-500 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"
                  }`}>
                    {stat.change}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Chart Section */}
          {data?.chartData && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card p-6"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Channel Engagement Over Time</h2>
                  <p className="text-xs text-muted-foreground mt-1">Daily session volumes attributed to marketing channels</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-foreground/60">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded bg-emerald-500"></span> WhatsApp
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded bg-blue-500"></span> Email
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded bg-foreground"></span> Push
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded bg-purple-500"></span> SMS
                  </span>
                </div>
              </div>

              <div className="h-[280px] w-full">
                <ChannelSessionsChart data={data.chartData} />
              </div>
            </motion.div>
          )}

          {/* Channel Performance Grid */}
          <h2 className="text-lg font-semibold tracking-tight mt-8 mb-4">Channel Performance</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data?.channels?.map((channel: any, i: number) => {
              const style = channelIcons[channel.name] || channelIcons["Push Notifications"];
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 + i * 0.05 }}
                  className="glass-card p-6"
                >
                  <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-xl ${style.bg}`}>
                        <style.icon className={`w-6 h-6 ${style.color}`} />
                      </div>
                      <h3 className="font-semibold text-lg">{channel.name}</h3>
                    </div>
                    {channel.metrics.revenue && (
                      <div className="text-right">
                        <div className="text-xs text-foreground/50 font-medium">Attributed Sales</div>
                        <div className="font-semibold text-emerald-500">{channel.metrics.revenue}</div>
                      </div>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-foreground/50 font-medium mb-1">Sent</div>
                      <div className="text-xl font-bold">{channel.metrics.sent}</div>
                    </div>
                    <div>
                      <div className="text-xs text-foreground/50 font-medium mb-1">Open/Read</div>
                      <div className="text-xl font-bold">{channel.metrics.open}</div>
                    </div>
                    <div>
                      <div className="text-xs text-foreground/50 font-medium mb-1">CTR</div>
                      <div className="text-xl font-bold">{channel.metrics.click}</div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Campaign Performance Table */}
          {data?.recentCampaigns && data.recentCampaigns.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="glass-card p-6 mt-6"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold tracking-tight">Recent Campaign Performance</h2>
                <span className="text-xs text-foreground/50 font-medium">Last {data.recentCampaigns.length} activities</span>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-foreground/50 border-b border-foreground/5 text-xs uppercase tracking-wider font-semibold text-left">
                      <th className="py-3 px-4">Campaign Name</th>
                      <th className="py-3 px-4">Channel</th>
                      <th className="py-3 px-4">Sent At</th>
                      <th className="py-3 px-4 text-right">Reach</th>
                      <th className="py-3 px-4 text-right">Open Rate</th>
                      <th className="py-3 px-4 text-right">CTR</th>
                      <th className="py-3 px-4 text-right">Attributed Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentCampaigns.map((c: any, index: number) => {
                      const style = channelIcons[c.channel] || channelIcons["Push Notifications"];
                      return (
                        <tr key={index} className="border-b border-foreground/[0.03] hover:bg-foreground/[0.01] transition-colors text-foreground/80">
                          <td className="py-3.5 px-4 font-medium text-foreground">{c.name}</td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <span className={`p-1.5 rounded-lg ${style.bg}`}>
                                <style.icon className={`w-3.5 h-3.5 ${style.color}`} />
                              </span>
                              <span className="text-xs font-semibold">{c.channel}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-foreground/60 text-xs">{formatDate(c.sentAt)}</td>
                          <td className="py-3.5 px-4 text-right font-medium">{c.sent.toLocaleString("en-IN")}</td>
                          <td className="py-3.5 px-4 text-right">{c.openRate}</td>
                          <td className="py-3.5 px-4 text-right">{c.ctr}</td>
                          <td className="py-3.5 px-4 text-right font-semibold text-emerald-500">{c.revenue}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
