"use client";

import { useTheme } from "next-themes";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "@/components/admin/lazy-recharts";

/**
 * Daily sessions per channel group. The groups are fixed entities, so each keeps its color across
 * date ranges. Palette: blue / orange / aqua validated together (all pairs, light + dark) with the
 * dataviz palette validator; "Direct & other" is a neutral gray, not a fourth hue.
 */
export const CHANNEL_GROUP_SERIES = [
  { key: "Paid social", light: "#2a78d6", dark: "#3987e5" },
  { key: "Search", light: "#eb6834", dark: "#d95926" },
  { key: "Owned messaging", light: "#1baf7a", dark: "#199e70" },
  { key: "Direct & other", light: "#8a8984", dark: "#8f8e88" },
] as const;

const fmtDate = (date: string) =>
  new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function ChannelSessionsChart({ data }: { data: Array<Record<string, number | string>> }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  const ink = dark ? "rgba(255,255,255," : "rgba(0,0,0,";

  return (
    <div className="flex flex-col h-full">
      {/* Legend — identity never relies on color alone */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3" role="list" aria-label="Channel groups">
        {CHANNEL_GROUP_SERIES.map((s) => (
          <span key={s.key} role="listitem" className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-block w-3 h-[2px] rounded" style={{ background: dark ? s.dark : s.light }} />
            {s.key}
          </span>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={`${ink}0.06)`} />
            <XAxis
              dataKey="date"
              stroke={`${ink}0.35)`}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
              tickFormatter={fmtDate}
            />
            <YAxis stroke={`${ink}0.35)`} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: `${ink}0.25)`, strokeWidth: 1 }}
              labelFormatter={(label) => fmtDate(String(label))}
              formatter={(value, name) => [`${Number(value).toLocaleString("en-IN")} sessions`, name]}
              contentStyle={{
                background: dark ? "rgba(20,20,20,0.95)" : "rgba(255,255,255,0.97)",
                border: `1px solid ${ink}0.1)`,
                borderRadius: "10px",
                fontSize: "12px",
              }}
              labelStyle={{ fontSize: "11px", color: `${ink}0.6)`, fontWeight: 600 }}
            />
            {CHANNEL_GROUP_SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={dark ? s.dark : s.light}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: dark ? "#1a1a19" : "#fcfcfb" }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
