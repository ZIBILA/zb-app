"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  BellOff,
  CheckCheck,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  Package,
  Users,
  Settings,
  LogIn,
  Edit,
  Trash2,
  Plus,
  Eye,
  Shield,
  Activity,
  Loader2,
  Inbox,
  Clock,
  ArrowUpRight,
  Smartphone,
  CreditCard,
  Truck,
  MessageCircle,
  Sparkles,
  BarChart3,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

interface Notification {
  id: string;
  userId: string | null;
  action: string;
  module: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | string | null;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: string;
  user: {
    name: string | null;
    email: string | null;
    role: string;
  } | null;
}

type FilterType = "all" | "unread" | "orders" | "products" | "users" | "system";

const FILTER_OPTIONS: { key: FilterType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "all", label: "All Activity", icon: Activity },
  { key: "unread", label: "Unread", icon: Bell },
  { key: "orders", label: "Orders", icon: ShoppingBag },
  { key: "products", label: "Products", icon: Package },
  { key: "users", label: "Users", icon: Users },
  { key: "system", label: "System", icon: Settings },
];

function getActionMeta(action: string, module: string | null) {
  const a = action.toUpperCase();

  // Determine color
  let color = "text-foreground/60 bg-foreground/5 border-foreground/10";
  if (a.includes("CREATE") || a.includes("ADD") || a.includes("NEW"))
    color = "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
  else if (a.includes("DELETE") || a.includes("REMOVE") || a.includes("REJECT"))
    color = "text-red-500 bg-red-500/10 border-red-500/20";
  else if (a.includes("UPDATE") || a.includes("EDIT") || a.includes("CHANGE") || a.includes("MODIFY"))
    color = "text-blue-500 bg-blue-500/10 border-blue-500/20";
  else if (a.includes("LOGIN") || a.includes("AUTH") || a.includes("LOGOUT"))
    color = "text-amber-500 bg-amber-500/10 border-amber-500/20";
  else if (a.includes("APPROVE") || a.includes("ACCEPT"))
    color = "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
  else if (a.includes("SEND") || a.includes("DISPATCH") || a.includes("PUSH"))
    color = "text-violet-500 bg-violet-500/10 border-violet-500/20";
  else if (a.includes("SYNC") || a.includes("IMPORT") || a.includes("EXPORT"))
    color = "text-cyan-500 bg-cyan-500/10 border-cyan-500/20";

  // Determine icon
  let icon = Activity;
  if (a.includes("CREATE") || a.includes("ADD") || a.includes("NEW")) icon = Plus;
  else if (a.includes("DELETE") || a.includes("REMOVE")) icon = Trash2;
  else if (a.includes("UPDATE") || a.includes("EDIT") || a.includes("CHANGE")) icon = Edit;
  else if (a.includes("LOGIN") || a.includes("AUTH")) icon = LogIn;
  else if (a.includes("VIEW") || a.includes("ACCESS")) icon = Eye;
  else if (a.includes("APPROVE") || a.includes("ACCEPT")) icon = CheckCheck;

  // Module-based icon override
  const m = (module || "").toUpperCase();
  if (m.includes("ORDER")) icon = ShoppingBag;
  else if (m.includes("PRODUCT") || m.includes("INVENTORY")) icon = Package;
  else if (m.includes("CUSTOMER") || m.includes("ADMIN_USER")) icon = Users;
  else if (m.includes("SETTING")) icon = Settings;
  else if (m.includes("LOGISTICS")) icon = Truck;
  else if (m.includes("FINANCIAL") || m.includes("PAYMENT")) icon = CreditCard;
  else if (m.includes("MOBILE")) icon = Smartphone;
  else if (m.includes("COMMUNITY") || m.includes("SUPPORT")) icon = MessageCircle;
  else if (m.includes("AI")) icon = Sparkles;
  else if (m.includes("MARKETING")) icon = BarChart3;

  return { color, icon };
}

function formatAction(action: string) {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatModule(module: string | null) {
  if (!module) return "General";
  return module
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function timeAgo(date: string) {
  const now = new Date();
  const d = new Date(date);
  const diff = now.getTime() - d.getTime();
  const secs = Math.floor(diff / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (secs < 60) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function getNotificationLink(module: string | null, action: string, targetId: string | null): string | null {
  const m = (module || "").toUpperCase();
  const act = (action || "").toUpperCase();
  if (m.includes("RETURNS_EXCHANGES") || m.includes("RETURN") || m.includes("EXCHANGE")) {
    if (act.includes("RETURN")) return `/dashboard/returns`;
    if (act.includes("EXCHANGE")) return `/dashboard/exchanges`;
  }
  if (m.includes("SUPPORT")) return `/dashboard/support`;
  if (m.includes("MARKETING")) return `/dashboard/notifications`;
  if (m.includes("INTEGRATION")) return `/dashboard/app-logins`;
  if (m.includes("ORDER") && targetId) return `/dashboard/orders/${targetId}`;
  if (m.includes("PRODUCT") && targetId) return `/dashboard/products`;
  if (m.includes("CUSTOMER") && targetId) return `/dashboard/customers`;
  if (m.includes("ADMIN_USER")) return `/dashboard/admin-users`;
  if (m.includes("SETTING")) return `/dashboard/settings`;
  if (m.includes("INVENTORY")) return `/dashboard/inventory`;
  if (m.includes("LOGISTICS")) return `/dashboard/logistics`;
  return null;
}

function extractSummary(metadata: unknown): string {
  if (!metadata) return "";
  let metaObj: Record<string, unknown> | null = null;
  if (typeof metadata === "string") {
    try {
      metaObj = JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return metadata;
    }
  } else if (typeof metadata === "object") {
    metaObj = metadata as Record<string, unknown>;
  }
  if (!metaObj) return "";

  const parts: string[] = [];
  if (typeof metaObj.summary === "string") parts.push(metaObj.summary);
  if (typeof metaObj.description === "string") parts.push(metaObj.description);
  if (parts.length > 0) return parts.join(" · ");

  if (typeof metaObj.message === "string") return metaObj.message;
  if (metaObj.details) return typeof metaObj.details === "string" ? metaObj.details : JSON.stringify(metaObj.details);
  if (typeof metaObj.name === "string") return `Name: ${metaObj.name}`;
  if (typeof metaObj.title === "string") return `Title: ${metaObj.title}`;
  if (typeof metaObj.email === "string") return `Email: ${metaObj.email}`;

  const keys = Object.keys(metaObj).slice(0, 3);
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}: ${typeof metaObj[k] === "object" ? "..." : String(metaObj[k])}`).join(" · ");
}

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastReadAt, setLastReadAt] = useState<string>("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [markingRead, setMarkingRead] = useState(false);
  const limit = 30;

  const fetchNotifications = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const res = await fetch(
        `/api/admin/notifications?page=${page}&limit=${limit}&filter=${filter}`
      );
      const data = await res.json();
      if (res.ok) {
        const next = (data.notifications || []) as Notification[];
        // Keep previous list reference when nothing changed so React skips a full list remount.
        setNotifications((prev) => {
          if (
            prev.length === next.length &&
            prev.every(
              (n, i) =>
                n.id === next[i]?.id &&
                n.timestamp === next[i]?.timestamp &&
                n.action === next[i]?.action
            )
          ) {
            return prev;
          }
          return next;
        });
        setTotal(data.total || 0);
        setUnreadCount(data.unreadCount || 0);
        setLastReadAt(data.lastReadAt || "");
      } else if (!silent) {
        const errMsg = data.error || "Failed to load notifications";
        setError(errMsg);
        toast.error(errMsg);
      }
    } catch {
      if (!silent) {
        const errMsg = "Network error loading notifications";
        setError(errMsg);
        toast.error(errMsg);
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [page, filter]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    const handleSync = () => {
      // Background poll: revalidate only — no loading spinner / list wipe.
      fetchNotifications({ silent: true });
    };
    window.addEventListener("realtime-sync", handleSync);
    return () => window.removeEventListener("realtime-sync", handleSync);
  }, [fetchNotifications]);

  const handleMarkAllRead = async () => {
    setMarkingRead(true);
    try {
      const res = await fetch("/api/admin/notifications", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success("All notifications marked as read");
        setUnreadCount(0);
        setLastReadAt(new Date().toISOString());
        fetchNotifications({ silent: true });
      }
    } catch {
      toast.error("Failed to mark as read");
    } finally {
      setMarkingRead(false);
    }
  };

  const isUnread = (timestamp: string) => {
    if (!lastReadAt) return true;
    return new Date(timestamp) > new Date(lastReadAt);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-foreground/5 rounded-2xl border border-foreground/10">
              <Bell className="w-6 h-6 text-foreground/70" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/50 bg-clip-text text-transparent">
                Notifications
              </h1>
              <p className="text-foreground/40 text-sm mt-0.5">
                All dashboard activity, changes, and system events
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {unreadCount > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={handleMarkAllRead}
              disabled={markingRead}
              className="flex items-center gap-2 px-5 py-2.5 bg-foreground text-background rounded-2xl text-[12px] font-bold hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg disabled:opacity-50"
            >
              {markingRead ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCheck className="w-4 h-4" />
              )}
              Mark All Read ({unreadCount})
            </motion.button>
          )}

          <button
            onClick={() => fetchNotifications()}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2.5 bg-foreground/5 border border-foreground/10 rounded-2xl text-[12px] font-semibold hover:bg-foreground/10 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="glass-card rounded-2xl p-5 border border-foreground/5">
          <div className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest mb-2">
            Total Events
          </div>
          <div className="text-2xl font-black">{total.toLocaleString()}</div>
        </div>
        <div className="glass-card rounded-2xl p-5 border border-foreground/5">
          <div className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest mb-2">
            Unread
          </div>
          <div className="text-2xl font-black text-blue-500">{unreadCount}</div>
        </div>
        <div className="glass-card rounded-2xl p-5 border border-foreground/5">
          <div className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest mb-2">
            Current Page
          </div>
          <div className="text-2xl font-black">
            {page}
            <span className="text-foreground/20 text-lg">/{totalPages || 1}</span>
          </div>
        </div>
        <div className="glass-card rounded-2xl p-5 border border-foreground/5">
          <div className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest mb-2">
            Filter
          </div>
          <div className="text-lg font-bold capitalize text-foreground/70">
            {filter === "all" ? "All" : filter}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar -mx-1 px-1">
        {FILTER_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = filter === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => {
                setFilter(opt.key);
                setPage(1);
              }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-[12px] font-semibold whitespace-nowrap transition-all border ${
                active
                  ? "bg-foreground text-background border-foreground shadow-lg"
                  : "bg-foreground/5 text-foreground/60 border-foreground/10 hover:bg-foreground/10 hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {opt.label}
              {opt.key === "unread" && unreadCount > 0 && (
                <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-black ${
                  active ? "bg-background/20 text-background" : "bg-blue-500/10 text-blue-500"
                }`}>
                  {unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Notifications List */}
      <div className="glass-card rounded-[2.5rem] border border-foreground/5 shadow-2xl overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-28 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-foreground/20" />
            <span className="text-[12px] font-bold text-foreground/30 uppercase tracking-widest">
              Loading notifications...
            </span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center gap-4">
            <div className="p-4 bg-red-500/10 text-red-500 rounded-2xl border border-red-500/20">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-foreground">{error}</p>
              <p className="text-xs text-foreground/40">An issue occurred while loading activity events.</p>
            </div>
            <button
              onClick={() => fetchNotifications()}
              className="flex items-center gap-2 px-5 py-2.5 bg-foreground text-background text-xs font-semibold rounded-xl hover:opacity-90 transition-opacity mt-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-28 gap-6">
            <div className="p-6 bg-foreground/5 rounded-3xl border border-foreground/10">
              {filter === "unread" ? (
                <BellOff className="w-12 h-12 text-foreground/15" />
              ) : (
                <Inbox className="w-12 h-12 text-foreground/15" />
              )}
            </div>
            <div className="text-center space-y-2">
              <p className="text-[14px] font-bold text-foreground/40">
                {filter === "unread" ? "All caught up!" : "No notifications yet"}
              </p>
              <p className="text-[12px] text-foreground/25 max-w-sm">
                {filter === "unread"
                  ? "You've read all your notifications. Check back later for new activity."
                  : "There are no notifications matching this filter."}
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-foreground/[0.04]">
            <AnimatePresence mode="popLayout">
              {notifications.map((n, idx) => {
                const unread = isUnread(n.timestamp);
                const { color, icon: Icon } = getActionMeta(n.action, n.module);
                const link = getNotificationLink(n.module, n.action, n.targetId);
                const summary = extractSummary(n.metadata);

                const content = (
                  <motion.div
                    key={n.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.02, duration: 0.3 }}
                    className={`flex items-start gap-4 sm:gap-6 px-6 sm:px-8 py-5 sm:py-6 hover:bg-foreground/[0.02] transition-all group relative ${
                      unread ? "bg-blue-500/[0.02]" : ""
                    }`}
                  >
                    {/* Unread indicator */}
                    {unread && (
                      <div className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                    )}

                    {/* Icon */}
                    <div className={`shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center border ${color} mt-0.5`}>
                      <Icon className="w-4 h-4" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                        <span className={`text-[13px] font-bold ${unread ? "text-foreground" : "text-foreground/80"}`}>
                          {formatAction(n.action)}
                        </span>
                        <span className="text-[10px] font-bold text-foreground/20 uppercase tracking-wider">
                          {formatModule(n.module)}
                        </span>
                      </div>

                      {summary && (
                        <p className="text-[12px] text-foreground/40 leading-relaxed line-clamp-2 max-w-2xl">
                          {summary}
                        </p>
                      )}

                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1.5 text-[11px] text-foreground/30">
                          <Clock className="w-3 h-3" />
                          {timeAgo(n.timestamp)}
                        </span>
                        {n.user && (
                          <span className="flex items-center gap-1.5 text-[11px] text-foreground/30">
                            <Shield className="w-3 h-3" />
                            {n.user.name || n.user.email || "System"}
                          </span>
                        )}
                        {n.ipAddress && (
                          <span className="text-[10px] text-foreground/20 font-mono">
                            {n.ipAddress}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Arrow for linked items */}
                    {link && (
                      <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity self-center">
                        <ArrowUpRight className="w-4 h-4 text-foreground/30" />
                      </div>
                    )}
                  </motion.div>
                );

                if (link) {
                  return (
                    <Link key={n.id} href={link} className="block">
                      {content}
                    </Link>
                  );
                }
                return content;
              })}
            </AnimatePresence>
          </div>
        )}

        {/* Pagination */}
        {!isLoading && !error && total > limit && (
          <div className="px-6 sm:px-8 py-5 bg-foreground/[0.02] border-t border-foreground/5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="text-[12px] text-foreground/40 font-medium">
              Showing {(page - 1) * limit + 1} to{" "}
              {Math.min(page * limit, total)} of {total.toLocaleString()} events
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2.5 rounded-xl border border-foreground/10 hover:bg-foreground/5 disabled:opacity-30 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1 px-2">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-8 h-8 rounded-lg text-[12px] font-bold transition-all ${
                        page === pageNum
                          ? "bg-foreground text-background shadow-md"
                          : "text-foreground/40 hover:bg-foreground/5"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2.5 rounded-xl border border-foreground/10 hover:bg-foreground/5 disabled:opacity-30 transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        .glass-card {
          background: rgba(255, 255, 255, 0.01);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .dark .glass-card {
          background: rgba(0, 0, 0, 0.2);
        }
      `}</style>
    </div>
  );
}
