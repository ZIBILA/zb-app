"use client";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "@/components/admin/lazy-recharts";

export default function ChannelSessionsChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="colorWhatsApp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorEmail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorPush" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ffffff" stopOpacity={0.1} />
            <stop offset="95%" stopColor="#ffffff" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorSMS" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="date"
          stroke="rgba(255,255,255,0.3)"
          fontSize={10}
          tickLine={false}
          tickFormatter={(date) => {
            const d = new Date(date);
            return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
          }}
        />
        <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} />
        <Tooltip
          contentStyle={{
            background: "rgba(10, 10, 10, 0.8)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "12px",
          }}
          itemStyle={{ fontSize: "12px" }}
          labelStyle={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.5)", fontWeight: "600" }}
        />
        <Area type="monotone" dataKey="WhatsApp" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorWhatsApp)" />
        <Area type="monotone" dataKey="Email" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorEmail)" />
        <Area type="monotone" dataKey="Push" stroke="#ffffff" strokeWidth={2} fillOpacity={1} fill="url(#colorPush)" />
        <Area type="monotone" dataKey="SMS" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorSMS)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
