"use client";

import { format } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "@/components/admin/lazy-recharts";

export default function ChatGrowthChart({
  data,
}: {
  data: { date: string; count: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--foreground))" stopOpacity={0.1} />
            <stop offset="95%" stopColor="hsl(var(--foreground))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 9, fill: "currentColor", opacity: 0.3 }}
          tickFormatter={(str) => format(new Date(str), "MMM d")}
        />
        <YAxis hide />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--background))",
            border: "1px solid hsl(var(--foreground) / 0.1)",
            borderRadius: "12px",
            fontSize: "10px",
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="hsl(var(--foreground))"
          fillOpacity={1}
          fill="url(#colorCount)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
