"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Smartphone,
  Search,
  RefreshCw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  History,
  ShieldCheck,
  Globe,
  ShoppingBag,
  UserCheck,
  MapPin
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

interface LoginLog {
  id: string;
  phone: string;
  status: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  hasPurchased: boolean;
  orderCount: number;
  geoSource?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  countryCode?: string | null;
  zip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export default function WebStoreLoginsPage() {
  const [logins, setLogins] = useState<LoginLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const limit = 50;

  const fetchLogins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/web-store/logins?page=${page}&limit=${limit}`);
      if (!res.ok) throw new Error("Failed to load logs");
      const data = await res.json();
      setLogins(data.logins || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      console.error("Failed to load logins", err);
      toast.error(err.message || "Error fetching login logs");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchLogins();
  }, [fetchLogins]);

  const totalPages = Math.ceil(total / limit);

  // Client-side quick filter
  const filteredLogins = logins.filter(
    (l) =>
      l.phone.includes(searchQuery) ||
      l.status.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (l.userAgent && l.userAgent.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (l.city && l.city.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (l.region && l.region.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (l.country && l.country.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (l.ip && l.ip.includes(searchQuery))
  );

  const getGeoSourceBadge = (source?: string | null) => {
    switch (source) {
      case "GPS":
        return (
          <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            GPS Verified
          </span>
        );
      case "IP":
        return (
          <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/20">
            IP Geolocation
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider bg-foreground/5 text-foreground/40 border border-foreground/10">
            Unknown
          </span>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "OTP_SENT":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/15">
            OTP Sent
          </span>
        );
      case "OTP_FAILED":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/15">
            OTP Failed
          </span>
        );
      case "OTP_INVALID":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/15">
            Invalid OTP
          </span>
        );
      case "LOGGED_IN":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
            Logged In
          </span>
        );
      case "ACCOUNT_CREATED":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/15 animate-pulse">
            New Account
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-foreground/5 text-foreground/60 border border-foreground/10">
            {status}
          </span>
        );
    }
  };

  const getOrderBadge = (log: LoginLog) => {
    if (log.hasPurchased) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-500 border border-amber-500/20 flex items-center gap-1 w-max">
          <ShoppingBag className="w-2.5 h-2.5" /> Ordered ({log.orderCount})
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-foreground/5 text-foreground/40 border border-foreground/5">
        No Orders
      </span>
    );
  };

  const formatBrowserName = (ua: string | null) => {
    if (!ua) return "Web Browser";
    if (ua.includes("Firefox/")) return "Mozilla Firefox";
    if (ua.includes("Chrome/")) return "Google Chrome";
    if (ua.includes("Safari/")) return "Apple Safari";
    if (ua.includes("Edge/")) return "Microsoft Edge";
    if (ua.includes("Mobile")) return "Mobile Browser";
    return ua.slice(0, 20) + "...";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 relative z-10"
    >
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight font-inter flex items-center gap-2">
            Web Store Login Logs <Sparkles className="w-5 h-5 text-amber-500" />
          </h1>
          <p className="text-[12px] text-foreground/50 mt-1">
            Monitor real-time verification activity, user acquisitions, and checkout sync patterns for the webstore.
          </p>
        </div>

        <button
          onClick={fetchLogins}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-foreground text-background dark:bg-white dark:text-black rounded-xl text-[10px] font-bold uppercase tracking-[0.15em] hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Logs
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass rounded-[2rem] border border-foreground/5 p-6 space-y-2">
          <p className="text-[9px] text-foreground/45 font-bold uppercase tracking-widest flex items-center gap-1">
            <History className="w-3.5 h-3.5 text-foreground/40" /> Total Attempts
          </p>
          <p className="text-3xl font-extrabold text-foreground">{total}</p>
        </div>
        <div className="glass rounded-[2rem] border border-foreground/5 p-6 space-y-2">
          <p className="text-[9px] text-foreground/45 font-bold uppercase tracking-widest flex items-center gap-1">
            <Smartphone className="w-3.5 h-3.5 text-blue-500/80" /> OTP Dispatched
          </p>
          <p className="text-3xl font-extrabold text-blue-400">
            {logins.filter((l) => l.status === "OTP_SENT").length}{" "}
            <span className="text-[10px] text-foreground/40 font-normal">in this page</span>
          </p>
        </div>
        <div className="glass rounded-[2rem] border border-foreground/5 p-6 space-y-2">
          <p className="text-[9px] text-foreground/45 font-bold uppercase tracking-widest flex items-center gap-1">
            <UserCheck className="w-3.5 h-3.5 text-emerald-500/80" /> Verified Accounts
          </p>
          <p className="text-3xl font-extrabold text-emerald-400">
            {logins.filter((l) => l.status === "LOGGED_IN" || l.status === "ACCOUNT_CREATED").length}{" "}
            <span className="text-[10px] text-foreground/40 font-normal">in this page</span>
          </p>
        </div>
        <div className="glass rounded-[2rem] border border-foreground/5 p-6 space-y-2">
          <p className="text-[9px] text-foreground/45 font-bold uppercase tracking-widest flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-purple-500/80" /> Conversion Rate
          </p>
          <p className="text-3xl font-extrabold text-foreground">
            {total > 0
              ? `${Math.round(
                  (logins.filter((l) => l.status === "LOGGED_IN" || l.status === "ACCOUNT_CREATED").length /
                    (logins.length || 1)) *
                    100
                )}%`
              : "0%"}
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="glass rounded-[2rem] border border-foreground/5 p-6">
        <div className="relative max-w-md w-full">
          <Search className="absolute left-4.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/35" />
          <input
            type="text"
            placeholder="Search logs by phone number, status..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-2xl pl-11 pr-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-amber-500/30 transition-all font-medium"
          />
        </div>
      </div>

      {/* Table Section */}
      <div className="glass rounded-[2rem] border border-foreground/5 overflow-hidden shadow-2xl">
        {loading && logins.length === 0 ? (
          <div className="p-12 space-y-4 animate-pulse">
            {[...Array(6)].map((_, idx) => (
              <div key={idx} className="h-12 bg-foreground/5 rounded-xl w-full" />
            ))}
          </div>
        ) : filteredLogins.length === 0 ? (
          <div className="py-20 text-center flex flex-col items-center">
            <Smartphone className="w-16 h-16 text-foreground/10 mb-4" />
            <h3 className="text-sm font-bold text-foreground mb-1">No Login Logs Found</h3>
            <p className="text-xs text-foreground/45 max-w-xs">No webstore auth logs were matched for this view.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-foreground/5 text-[10px] font-bold text-foreground/40 uppercase tracking-wider">
                  <th className="py-4 px-6">Timestamp</th>
                  <th className="py-4 px-4">Phone Number</th>
                  <th className="py-4 px-4">Status</th>
                  <th className="py-4 px-4">Purchased / Orders</th>
                  <th className="py-4 px-4">Browser / Agent</th>
                  <th className="py-4 px-4"><span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Location</span></th>
                  <th className="py-4 px-6"><span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> IP Address</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/5">
                {filteredLogins.map((login) => (
                  <tr
                    key={login.id}
                    className="hover:bg-foreground/[0.01] transition-colors"
                  >
                    <td className="py-4 px-6 text-[11px] text-foreground/60 whitespace-nowrap">
                      {new Date(login.createdAt).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit"
                      })}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-3.5 h-3.5 text-foreground/30" />
                        <span className="text-[12px] font-semibold text-foreground font-mono">{login.phone}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap">{getStatusBadge(login.status)}</td>
                    <td className="py-4 px-4 whitespace-nowrap">{getOrderBadge(login)}</td>
                    <td className="py-4 px-4 text-[10.5px] text-foreground/50 max-w-[200px] truncate" title={login.userAgent || ""}>
                      {formatBrowserName(login.userAgent)}
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1 text-[11px] font-medium text-foreground/80">
                          {login.latitude != null && login.longitude != null ? (
                            <a
                              href={`https://www.google.com/maps?q=${login.latitude},${login.longitude}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-500 hover:text-emerald-400 hover:underline flex items-center gap-0.5 font-semibold"
                              title={`View Map (${login.latitude.toFixed(4)}, ${login.longitude.toFixed(4)})`}
                            >
                              <span>📍</span>
                              <span>{[login.city, login.region, login.country].filter(Boolean).join(", ") || "View Map"}</span>
                            </a>
                          ) : (
                            <span>📍 {[login.city, login.region, login.country].filter(Boolean).join(", ") || "—"}</span>
                          )}
                        </div>
                        <div>{getGeoSourceBadge(login.geoSource)}</div>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-[11px] font-mono text-foreground/45 whitespace-nowrap">
                      {login.ip || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <span className="text-[10px] text-foreground/40 font-bold uppercase tracking-widest">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              className="px-3.5 py-2 bg-foreground/5 rounded-xl text-[10px] font-bold text-foreground/60 uppercase tracking-widest hover:bg-foreground/10 disabled:opacity-30 border border-foreground/5 flex items-center gap-1 active:scale-95 transition-all"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="px-3.5 py-2 bg-foreground/5 rounded-xl text-[10px] font-bold text-foreground/60 uppercase tracking-widest hover:bg-foreground/10 disabled:opacity-30 border border-foreground/5 flex items-center gap-1 active:scale-95 transition-all"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
