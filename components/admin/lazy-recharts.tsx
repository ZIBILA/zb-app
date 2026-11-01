"use client";

/**
 * Client-only recharts surface for admin pages.
 * Import this module only from components loaded via next/dynamic(..., { ssr: false })
 * so the chart library stays out of the initial dashboard chunk.
 */
export {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
} from "recharts";
