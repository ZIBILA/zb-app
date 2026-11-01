"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Calendar, Info, Loader2 } from "lucide-react";

const ChannelSessionsChart = dynamic(
  () => import("@/components/admin/charts/ChannelSessionsChart"),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-foreground/[0.03]" />,
  }
);

interface ChannelRow {
  name: string;
  group: string;
  sessions: number;
  orders: number;
  revenue: number;
  conversionRate: number | null;
  revenueShare: number;
}

interface MessagingRow {
  name: string;
  sent: number;
  delivered: number | null;
  opened: number | null;
  clicked: number | null;
}

interface StatsResponse {
  model: { name: string; lookbackDays: number; note: string };
  summary: {
    sessions: number;
    orders: number;
    revenue: number;
    conversionRate: number | null;
    attributedShare: number | null;
    changes: { sessions: number | null; orders: number | null; revenue: number | null };
  };
  channels: ChannelRow[];
  chartData: Array<Record<string, number | string>>;
  messaging: MessagingRow[];
  error?: string;
}

const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const num = (v: number) => v.toLocaleString("en-IN");
const pctOf = (part: number | null, whole: number) =>
  part === null ? null : whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—";

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[10px] text-foreground/35">no prior period</span>;
  const up = value >= 0;
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${up ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" : "text-rose-600 dark:text-rose-400 bg-rose-500/10"}`}>
      {up ? "▲" : "▼"} {Math.abs(value)}%
    </span>
  );
}

export default function AnalyticsHubPage() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState("30");

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/marketing/stats?range=${timeRange}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.details || json.error || "Failed to load analytics");
        setData(json);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [timeRange]);

  const s = data?.summary;
  const tiles = s
    ? [
        { label: "Sessions", value: num(s.sessions), change: s.changes.sessions },
        { label: "Paid orders", value: num(s.orders), change: s.changes.orders },
        { label: "Revenue", value: inr(s.revenue), change: s.changes.revenue },
        { label: "Conversion rate", value: s.conversionRate === null ? "—" : `${s.conversionRate}%`, change: null as number | null, hideChange: true },
        { label: "Orders linked to a visit", value: s.attributedShare === null ? "—" : `${s.attributedShare}%`, change: null as number | null, hideChange: true },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Omnichannel Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Traffic, orders and revenue by channel — each order counted once</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-foreground/45" />
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2 text-sm outline-none cursor-pointer hover:bg-foreground/10 transition-colors"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="h-[50vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-foreground/20" />
        </div>
      ) : error || !data ? (
        <div className="glass-card p-6 text-sm text-rose-500">{error || "No data"}</div>
      ) : (
        <>
          <div className="glass-card p-4 flex items-start gap-3 text-xs text-foreground/60">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-foreground/40" />
            <p>
              <span className="font-semibold text-foreground/80">Attribution: {data.model.name}, {data.model.lookbackDays}-day lookback.</span>{" "}
              {data.model.note} Orders with no tracked visit in that window appear as <em>Unattributed</em>; nothing is estimated.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {tiles.map((t) => (
              <div key={t.label} className="glass-card p-5">
                <div className="text-xs font-semibold text-foreground/50 tracking-wider uppercase mb-3">{t.label}</div>
                <div className="text-2xl font-bold tracking-tight">{t.value}</div>
                {!("hideChange" in t) && timeRange !== "lifetime" && (
                  <div className="mt-1.5">
                    <Change value={t.change} />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold">Traffic by channel group</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Daily sessions{timeRange === "lifetime" ? " (last 90 days)" : ""}. Per-channel figures are in the table below.
            </p>
            <div className="h-[300px]">
              <ChannelSessionsChart data={data.chartData} />
            </div>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="p-6 pb-3">
              <h3 className="text-lg font-semibold">Channel performance</h3>
              <p className="text-xs text-muted-foreground mt-1">Revenue column adds up to total revenue — no order is credited to two channels.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-foreground/45 border-b border-foreground/10">
                    <th className="text-left font-semibold px-6 py-3">Channel</th>
                    <th className="text-right font-semibold px-4 py-3">Sessions</th>
                    <th className="text-right font-semibold px-4 py-3">Orders</th>
                    <th className="text-right font-semibold px-4 py-3">Revenue</th>
                    <th className="text-right font-semibold px-4 py-3">Share</th>
                    <th className="text-right font-semibold px-6 py-3">Conversion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/[0.06]">
                  {data.channels.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-foreground/40 text-xs">No sessions or paid orders in this period.</td>
                    </tr>
                  ) : (
                    data.channels.map((c) => (
                      <tr key={c.name}>
                        <td className="px-6 py-3">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-[10px] text-foreground/40">{c.group}</div>
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums">{num(c.sessions)}</td>
                        <td className="text-right px-4 py-3 tabular-nums">{num(c.orders)}</td>
                        <td className="text-right px-4 py-3 tabular-nums font-medium">{inr(c.revenue)}</td>
                        <td className="text-right px-4 py-3 tabular-nums text-foreground/60">{c.revenueShare}%</td>
                        <td className="text-right px-6 py-3 tabular-nums text-foreground/60">{c.conversionRate === null ? "—" : `${c.conversionRate}%`}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {data.channels.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-foreground/10 font-semibold">
                      <td className="px-6 py-3">Total</td>
                      <td className="text-right px-4 py-3 tabular-nums">{num(data.summary.sessions)}</td>
                      <td className="text-right px-4 py-3 tabular-nums">{num(data.summary.orders)}</td>
                      <td className="text-right px-4 py-3 tabular-nums">{inr(data.summary.revenue)}</td>
                      <td className="text-right px-4 py-3 tabular-nums">100%</td>
                      <td className="text-right px-6 py-3 tabular-nums">{data.summary.conversionRate === null ? "—" : `${data.summary.conversionRate}%`}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="p-6 pb-3">
              <h3 className="text-lg font-semibold">Owned messaging delivery</h3>
              <p className="text-xs text-muted-foreground mt-1">Campaign sends in this period. “Not tracked” means the provider doesn’t report that step.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-foreground/45 border-b border-foreground/10">
                    <th className="text-left font-semibold px-6 py-3">Channel</th>
                    <th className="text-right font-semibold px-4 py-3">Sent</th>
                    <th className="text-right font-semibold px-4 py-3">Delivered</th>
                    <th className="text-right font-semibold px-4 py-3">Opened / read</th>
                    <th className="text-right font-semibold px-6 py-3">Clicked</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/[0.06]">
                  {data.messaging.map((m) => (
                    <tr key={m.name}>
                      <td className="px-6 py-3 font-medium">{m.name}</td>
                      <td className="text-right px-4 py-3 tabular-nums">{num(m.sent)}</td>
                      {[m.delivered, m.opened, m.clicked].map((v, i) => (
                        <td key={i} className={`text-right py-3 tabular-nums ${i === 2 ? "px-6" : "px-4"}`}>
                          {v === null ? (
                            <span className="text-[11px] text-foreground/35">Not tracked</span>
                          ) : (
                            <>
                              {num(v)} <span className="text-foreground/40 text-xs">{pctOf(v, m.sent)}</span>
                            </>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
