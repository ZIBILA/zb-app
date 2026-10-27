"use client";

import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "@/components/admin/lazy-recharts";

export default function StorefrontEventTrendsChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorPurchases" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" stroke="currentColor" className="text-[9px] opacity-40" tickLine={false} />
        <YAxis stroke="currentColor" className="text-[9px] opacity-40" tickLine={false} />
        <Tooltip contentStyle={{ background: "rgba(0, 0, 0, 0.8)", border: "1px solid rgba(255, 255, 255, 0.1)", borderRadius: "8px", fontSize: "12px" }} />
        <Area type="monotone" dataKey="views" name="Product Views" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorViews)" strokeWidth={2} />
        <Area type="monotone" dataKey="purchases" name="Purchases" stroke="#10b981" fillOpacity={1} fill="url(#colorPurchases)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
