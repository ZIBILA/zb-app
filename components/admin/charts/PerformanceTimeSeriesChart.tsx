"use client";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "@/components/admin/lazy-recharts";

export type PerformanceChartKey =
  | "revenue"
  | "orders"
  | "sessions"
  | "conversion"
  | "logins"
  | "newLogins";

type Point = Record<string, string | number>;

function formatCurrency(val: number): string {
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `₹${(val / 1000).toFixed(1)}K`;
  return `₹${val.toLocaleString("en-IN")}`;
}

function formatNumber(val: number): string {
  if (val >= 100000) return `${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
  return val.toLocaleString("en-IN");
}

function formatChartDate(dateStr: string, granularity: string): string {
  const d = new Date(dateStr);
  if (granularity === "hour") return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (granularity === "day") return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (granularity === "week") return `W${Math.ceil(d.getDate() / 7)} ${d.toLocaleDateString("en-IN", { month: "short" })}`;
  return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

export default function PerformanceTimeSeriesChart({
  data,
  granularity,
  activeChart,
}: {
  data: Point[];
  granularity: string;
  activeChart: PerformanceChartKey;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={280}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--foreground))" stopOpacity={0.15} />
            <stop offset="100%" stopColor="hsl(var(--foreground))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--foreground) / 0.06)" />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => formatChartDate(String(v), granularity)}
          tick={{ fontSize: 10, fill: "hsl(var(--foreground) / 0.4)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "hsl(var(--foreground) / 0.4)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (activeChart === "revenue" ? formatCurrency(Number(v)) : formatNumber(Number(v)))}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--background))",
            border: "1px solid hsl(var(--foreground) / 0.1)",
            borderRadius: "12px",
            fontSize: "11px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          }}
          labelFormatter={(v) => formatChartDate(String(v), granularity)}
          formatter={(value: any) =>
            activeChart === "revenue" ? [formatCurrency(value), "Revenue"]
            : activeChart === "conversion" ? [`${value}%`, "Conversion"]
            : activeChart === "logins" ? [formatNumber(value), "Logins"]
            : activeChart === "newLogins" ? [formatNumber(value), "New Signups"]
            : [formatNumber(value), activeChart.charAt(0).toUpperCase() + activeChart.slice(1)]
          }
        />
        <Area
          type="monotone"
          dataKey={
            activeChart === "revenue" ? "revenue"
            : activeChart === "orders" ? "orders"
            : activeChart === "sessions" ? "sessions"
            : activeChart === "logins" ? "logins"
            : activeChart === "newLogins" ? "newLogins"
            : "conversionRate"
          }
          stroke="hsl(var(--foreground))"
          strokeWidth={2}
          fill="url(#chartGradient)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, fill: "hsl(var(--background))" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
