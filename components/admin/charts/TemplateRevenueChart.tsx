"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "@/components/admin/lazy-recharts";

const COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ec4899"];

export default function TemplateRevenueChart({
  data,
}: {
  data: { name: string; revenue: number; conversions?: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <XAxis dataKey="name" stroke="currentColor" className="text-[10px] opacity-40" tickLine={false} />
        <YAxis stroke="currentColor" className="text-[10px] opacity-40" tickLine={false} />
        <Tooltip contentStyle={{ background: "rgba(0, 0, 0, 0.8)", border: "1px solid rgba(255, 255, 255, 0.1)", borderRadius: "8px", fontSize: "12px" }} />
        <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]}>
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
