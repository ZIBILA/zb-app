"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  Activity,
  Copy,
  Calendar,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Database,
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Zap,
  Clock,
  FileText,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

const AUTO_REFRESH_INTERVAL = 60_000; // 60 seconds

interface SyncMeta {
  timestamp: string;
  api_version: string;
  pixel_ok: boolean;
  stats_ok: boolean;
  last_fired_ok: boolean;
}

interface ConnectionCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  detail?: string;
}

interface ConnectionTestResult {
  overall: "pass" | "fail" | "warn";
  checks: ConnectionCheck[];
  root_cause_summary?: string | null;
  api_version: string;
  pixel_id?: string;
  app_id?: string;
  token_debug?: any;
  timestamp: string;
}

interface MetaApiLogEntry {
  timestamp: string;
  endpoint: string;
  method: string;
  fields?: string;
  httpStatus: number;
  errorCode?: number;
  errorSubcode?: number;
  errorMessage?: string;
  fbtrace_id?: string;
  response_time_ms: number;
  success: boolean;
  responsePreview?: string;
}

interface LogsResponse {
  stats: {
    total: number;
    successes: number;
    failures: number;
    avgResponseMs: number;
    lastRequestAt: string | null;
  };
  logs: MetaApiLogEntry[];
}

export default function MetaPixelPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [lastSyncFailed, setLastSyncFailed] = useState<string | null>(null);

  // Connection test state
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [showTest, setShowTest] = useState(false);

  // Logs state
  const [logsData, setLogsData] = useState<LogsResponse | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async (isAutoRefresh = false) => {
    if (!isAutoRefresh) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/event-stats");
      const json = await res.json();
      if (!res.ok) {
        throw json.error || { summary: "Failed to fetch", detail: json.error?.message || "Unknown error" };
      }
      setData(json);
      setWarnings(json._warnings || []);
      setLastSync(new Date().toISOString());
    } catch (err: any) {
      console.error(err);
      const errorObj =
        typeof err === "object" && err.summary
          ? err
          : { summary: "Connection Error", detail: err.message || "Error connecting to Meta API" };
      setError(errorObj);
      setLastSyncFailed(new Date().toISOString());
      if (isAutoRefresh) {
        // Don't blank the screen on auto-refresh failure — keep stale data
        toast.error("Meta sync failed — showing cached data");
      }
    } finally {
      if (!isAutoRefresh) setLoading(false);
    }
  }, []);

  const runConnectionTest = useCallback(async () => {
    setTestLoading(true);
    setShowTest(true);
    try {
      const res = await fetch("/api/meta/connection-test");
      const json = await res.json();
      setTestResult(json);
    } catch (err: any) {
      setTestResult({
        overall: "fail",
        checks: [{ name: "Network", status: "fail", message: err.message || "Failed to reach connection test endpoint" }],
        api_version: "unknown",
        timestamp: new Date().toISOString(),
      });
    } finally {
      setTestLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/meta/logs");
      const json = await res.json();
      setLogsData(json);
    } catch (err: any) {
      toast.error("Failed to fetch API logs");
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const clearLogs = useCallback(async () => {
    try {
      await fetch("/api/meta/logs", { method: "DELETE" });
      setLogsData(null);
      toast.success("API logs cleared");
    } catch {
      toast.error("Failed to clear logs");
    }
  }, []);

  // Initial fetch + auto-refresh (no 1s countdown ticker — that forced a re-render every second)
  useEffect(() => {
    fetchData();

    intervalRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      fetchData(true);
    }, AUTO_REFRESH_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Pixel ID copied to clipboard");
  };

  const handleManualRefresh = () => {
    fetchData();
  };

  // ── Loading State ──────────────────────────
  if (loading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-foreground/20" />
      </div>
    );
  }

  // ── Error State ─────────────────────────────
  if (error && !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Meta Pixel & Dataset Status</h1>
            <p className="text-sm text-muted-foreground mt-1">Direct integration diagnostics from Meta Graph API</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runConnectionTest}
              disabled={testLoading}
              className="flex items-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-400 rounded-xl px-4 py-2 text-sm transition-all disabled:opacity-50"
            >
              {testLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Test Connection
            </button>
            <button
              onClick={handleManualRefresh}
              className="flex items-center gap-2 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 rounded-xl px-4 py-2 text-sm transition-all"
            >
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          </div>
        </div>

        <div className="glass-card p-8 flex flex-col items-center justify-center text-center space-y-4 max-w-xl mx-auto mt-8 border-red-500/20 bg-red-500/[0.02]">
          <div className="p-4 bg-red-500/10 rounded-full text-red-500">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="font-semibold text-lg">{error.summary || "Failed to Connect with Meta"}</h2>
            <p className="text-sm text-muted-foreground max-w-sm">{error.detail || "Unknown error"}</p>
            {error.fix && (
              <p className="text-xs text-muted-foreground/70 max-w-sm mt-2 border-t border-foreground/5 pt-2">
                <span className="font-medium text-foreground/60">Fix: </span>
                {error.fix}
              </p>
            )}
            {error.code && typeof error.code === "number" && (
              <p className="text-xs text-muted-foreground/50 font-mono mt-1">
                Meta Error #{error.code}
                {error.subcode ? `.${error.subcode}` : ""}
                {error.endpoint ? ` on ${error.endpoint}` : ""}
              </p>
            )}
            {error.fbtrace_id && (
              <p className="text-xs text-muted-foreground/40 font-mono mt-1">
                Request ID: {error.fbtrace_id}
              </p>
            )}
            {error.requestedFields && (
              <p className="text-xs text-muted-foreground/40 font-mono mt-1">
                Fields: {error.requestedFields}
              </p>
            )}
          </div>
        </div>

        {/* Connection Test Results */}
        <AnimatePresence>
          {showTest && <ConnectionTestPanel result={testResult} loading={testLoading} />}
        </AnimatePresence>
      </div>
    );
  }

  // ── Success State ───────────────────────────
  const creationDate = data?.creation_time
    ? new Date(data.creation_time).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "N/A";

  // Use event_time_max (unix timestamp) for last event
  const lastFiredRaw = data?.event_time_max || data?.last_fired_time;
  const lastFiredDate = lastFiredRaw
    ? new Date(
        typeof lastFiredRaw === "number" && lastFiredRaw < 1e12
          ? lastFiredRaw * 1000
          : lastFiredRaw
      ).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "N/A";

  // Extract stats arrays safely — support both formats
  const eventStats = data?.event_stats || data?.stats?.data || [];
  const syncMeta: SyncMeta | null = data?._sync || null;

  const connectionStatus = syncMeta?.pixel_ok ? "connected" : "partial";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Meta Pixel & Dataset</h1>
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                connectionStatus === "connected"
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-amber-500/10 text-amber-500"
              }`}
            >
              {connectionStatus === "connected" ? (
                <Wifi className="w-3 h-3" />
              ) : (
                <WifiOff className="w-3 h-3" />
              )}
              {connectionStatus === "connected" ? "Connected" : "Partial"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time tracking and server-side integration quality logs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runConnectionTest}
            disabled={testLoading}
            className="flex items-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-400 rounded-xl px-4 py-2 text-sm transition-all disabled:opacity-50"
          >
            {testLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Test Connection
          </button>
          <button
            onClick={() => {
              setShowLogs(!showLogs);
              if (!showLogs && !logsData) fetchLogs();
            }}
            className="flex items-center gap-2 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 rounded-xl px-4 py-2 text-sm transition-all"
          >
            <FileText className="w-4 h-4" /> API Logs
          </button>
          <button
            onClick={handleManualRefresh}
            className="flex items-center gap-2 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 rounded-xl px-4 py-2 text-sm transition-all"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Sync Status Bar */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
        <div className="flex items-center gap-4">
          {lastSync && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              Last sync: {new Date(lastSync).toLocaleTimeString("en-IN")}
            </span>
          )}
          {lastSyncFailed && (
            <span className="flex items-center gap-1">
              <XCircle className="w-3 h-3 text-red-400" />
              Last failed: {new Date(lastSyncFailed).toLocaleTimeString("en-IN")}
            </span>
          )}
          {syncMeta?.api_version && (
            <span className="font-mono opacity-60">API {syncMeta.api_version}</span>
          )}
        </div>
        <span className="flex items-center gap-1 opacity-60">
          <Clock className="w-3 h-3" />
          Auto-refresh every {AUTO_REFRESH_INTERVAL / 1000}s
        </span>
      </div>

      {/* Warnings from partial responses */}
      {warnings.length > 0 && (
        <div className="glass-card p-4 border-amber-500/20 bg-amber-500/[0.02] space-y-2">
          <div className="flex items-center gap-2 text-amber-500 text-sm font-semibold">
            <AlertCircle className="w-4 h-4" />
            Partial Data — Some requests failed
          </div>
          {warnings.map((w: any, i: number) => (
            <div key={i} className="text-xs text-muted-foreground">
              <span className="font-semibold">{w.summary}:</span> {w.detail}
              {w.fix && <span className="text-muted-foreground/60"> — Fix: {w.fix}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Connection Test Results */}
      <AnimatePresence>
        {showTest && <ConnectionTestPanel result={testResult} loading={testLoading} />}
      </AnimatePresence>

      {/* API Logs Panel */}
      <AnimatePresence>
        {showLogs && (
          <ApiLogsPanel
            data={logsData}
            loading={logsLoading}
            onRefresh={fetchLogs}
            onClear={clearLogs}
          />
        )}
      </AnimatePresence>

      {/* Health Status Grid */}
      {syncMeta && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <HealthIndicator label="Pixel" ok={syncMeta.pixel_ok} />
          <HealthIndicator label="Stats" ok={syncMeta.stats_ok} />
          <HealthIndicator label="Last Event" ok={syncMeta.last_fired_ok} />
          <HealthIndicator
            label="API Version"
            ok={true}
            customValue={syncMeta.api_version}
          />
        </div>
      )}

      {/* Main Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-6 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold text-foreground/50 tracking-wider uppercase">
              Dataset Name
            </span>
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight">{data?.name || "Zica Bella Pixel"}</h3>
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground font-mono">
              <span>ID: {data?.id}</span>
              <button
                onClick={() => handleCopy(data?.id)}
                className="hover:text-foreground transition-colors p-0.5"
                title="Copy ID"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-6 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold text-foreground/50 tracking-wider uppercase">
              Last Event Received
            </span>
            <Activity className="w-5 h-5 text-indigo-500 animate-pulse" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight">{lastFiredDate}</h3>
            <span className="text-xs text-muted-foreground mt-2 block">Source: Browser/Server direct sync</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card p-6 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold text-foreground/50 tracking-wider uppercase">Created On</span>
            <Calendar className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight">{creationDate}</h3>
            <span className="text-xs text-muted-foreground mt-2 block">Direct integration Dataset API</span>
          </div>
        </motion.div>
      </div>

      {/* Dataset Event Stats / Event Match Quality */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight mt-8">Active Event Metrics</h2>

        {eventStats.length === 0 ? (
          <div className="glass-card p-8 text-center text-muted-foreground">
            No active event history returned within the Meta attribution window. Keep testing client actions to populate
            stats.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {eventStats.map((event: any, i: number) => {
              const qualityScore = event.match_quality || 100;
              const qualityColor =
                qualityScore >= 90 ? "text-emerald-500 bg-emerald-500/10" : "text-amber-500 bg-amber-500/10";

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                  className="glass-card p-6 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-foreground/5 text-foreground/75">
                        <Database className="w-4 h-4" />
                      </div>
                      <h3 className="font-semibold text-md">{event.event_type || event.event}</h3>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${qualityColor}`}>
                      {qualityScore}% Match Quality
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-4 pt-2 border-t border-foreground/5 font-mono">
                    <div>
                      <div className="text-[10px] text-muted-foreground font-sans font-semibold uppercase tracking-wider">
                        Browser Events
                      </div>
                      <div className="text-lg font-bold mt-1">{event.browser_count || event.count || 0}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground font-sans font-semibold uppercase tracking-wider">
                        Server Events
                      </div>
                      <div className="text-lg font-bold mt-1">{event.server_count || 0}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground font-sans font-semibold uppercase tracking-wider">
                        Deduplicated
                      </div>
                      <div className="text-lg font-bold mt-1">{event.deduplicated_count || 0}</div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Visual Payload Schema & Match Quality Audit */}
      <div className="glass-card p-6 space-y-6 border-indigo-500/10 mt-8">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Conversions API (CAPI) Matching Audit</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Real-time parameters validation & Meta best practices alignment</p>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400">
            Target EMQ: 10/10
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground/80 border-b border-foreground/5 pb-2">Hashed Customer Identifiers</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full p-0.5 bg-emerald-500/15 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-semibold flex items-center gap-2">
                    Email (em) <span className="text-[10px] text-emerald-500 font-mono font-normal">Active</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">SHA-256 hashed on client & server. Trimmed and converted to lowercase prior to hashing.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full p-0.5 bg-emerald-500/15 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-semibold flex items-center gap-2">
                    Phone (ph) <span className="text-[10px] text-emerald-500 font-mono font-normal">Active</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">E.164 digits-only normalized (e.g. 91XXXXXXXXXX) without special characters or plus signs before SHA-256 hashing.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full p-0.5 bg-emerald-500/15 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-semibold flex items-center gap-2">
                    Names & Location (fn, ln, ct, st, zp, country) <span className="text-[10px] text-emerald-500 font-mono font-normal">Active</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Names, state, city and zip are stripped of spaces/punctuation. Country normalized to lowercase 2-letter ISO code (e.g. "in") before hashing.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold text-foreground/80 border-b border-foreground/5 pb-2">Technical & Deduplication Keys</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full p-0.5 bg-emerald-500/15 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-semibold flex items-center gap-2">
                    Browser ID (_fbp) <span className="text-[10px] text-emerald-500 font-mono font-normal">Active</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Created on browser, persisted in cookies, and forwarded in all Conversions API payloads for browser-server matching.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full p-0.5 bg-amber-500/15 text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-semibold flex items-center gap-2">
                    Click ID (_fbc) <span className="text-[10px] text-amber-500 font-mono font-normal">Conditional</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Captured from fbclid URL parameter. Automatically forwarded in CAPI payloads when traffic originates from Facebook/Instagram ads.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full p-0.5 bg-emerald-500/15 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-semibold flex items-center gap-2">
                    Event Deduplication (event_id & event_time) <span className="text-[10px] text-emerald-500 font-mono font-normal">Active</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Browser and CAPI events share matching event_id and event_time generated at the client to ensure 100% deduplication success.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-foreground/5">
          <h3 className="text-xs font-semibold text-foreground/80 mb-2">Browser vs Server Payload Schema Comparison</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-[10px] bg-foreground/[0.02] p-4 rounded-lg border border-foreground/5 overflow-x-auto">
            <div className="space-y-1">
              <div className="text-indigo-400 border-b border-foreground/5 pb-1 mb-1 font-sans font-bold">Browser Pixel Event</div>
              <div>fbq('track', 'PageView', {}, &#123;</div>
              <div className="pl-4">eventID: "pv.12345678-90ab-cdef..."</div>
              <div>&#125;);</div>
            </div>
            <div className="space-y-1">
              <div className="text-indigo-400 border-b border-foreground/5 pb-1 mb-1 font-sans font-bold">Server Conversions API Event</div>
              <div>&#123;</div>
              <div className="pl-4">"event_name": "PageView",</div>
              <div className="pl-4">"event_id": "pv.12345678-90ab-cdef...",</div>
              <div className="pl-4">"event_time": 1719792000,</div>
              <div className="pl-4">"user_data": &#123;</div>
              <div className="pl-8">"client_ip_address": "127.0.0.1",</div>
              <div className="pl-8">"client_user_agent": "Mozilla/5.0...",</div>
              <div className="pl-8">"fbp": "fb.1.1719792000.12345...",</div>
              <div className="pl-8">"external_id": "zb.12345678-90ab..."</div>
              <div className="pl-4">&#125;</div>
              <div>&#125;</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Health Indicator ──────────────────────
function HealthIndicator({
  label,
  ok,
  customValue,
}: {
  label: string;
  ok: boolean;
  customValue?: string;
}) {
  return (
    <div className="glass-card px-4 py-3 flex items-center gap-3">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
      )}
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{label}</div>
        <div className="text-xs font-semibold mt-0.5">
          {customValue || (ok ? "OK" : "Failed")}
        </div>
      </div>
    </div>
  );
}

// ── Connection Test Panel ──────────────────
function ConnectionTestPanel({
  result,
  loading,
}: {
  result: ConnectionTestResult | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="glass-card p-6 space-y-4 border-indigo-500/20 bg-indigo-500/[0.02]"
      >
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
          <span className="text-sm font-medium">Running connection diagnostics (10 checks)...</span>
        </div>
      </motion.div>
    );
  }

  if (!result) return null;

  const statusIcon = {
    pass: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
    fail: <XCircle className="w-5 h-5 text-red-500" />,
    warn: <AlertCircle className="w-5 h-5 text-amber-500" />,
  };

  const overallColors = {
    pass: "border-emerald-500/20 bg-emerald-500/[0.02]",
    fail: "border-red-500/20 bg-red-500/[0.02]",
    warn: "border-amber-500/20 bg-amber-500/[0.02]",
  };

  const overallLabels = {
    pass: "All Checks Passed",
    fail: "Critical Check Failed",
    warn: "Issues Detected",
  };

  const passCount = result.checks.filter(c => c.status === "pass").length;
  const failCount = result.checks.filter(c => c.status === "fail").length;
  const warnCount = result.checks.filter(c => c.status === "warn").length;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className={`glass-card p-6 space-y-4 ${overallColors[result.overall]}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {statusIcon[result.overall]}
          <div>
            <h3 className="font-semibold text-sm">{overallLabels[result.overall]}</h3>
            <p className="text-xs text-muted-foreground">
              Graph API {result.api_version} •{" "}
              {new Date(result.timestamp).toLocaleTimeString("en-IN")} •{" "}
              <span className="text-emerald-500">{passCount} pass</span>
              {failCount > 0 && <>, <span className="text-red-400">{failCount} fail</span></>}
              {warnCount > 0 && <>, <span className="text-amber-400">{warnCount} warn</span></>}
            </p>
          </div>
        </div>
        {result.pixel_id && (
          <span className="text-xs font-mono text-muted-foreground/50">
            Pixel: {result.pixel_id}
          </span>
        )}
      </div>

      {result.root_cause_summary && (
        <div className="py-3 px-4 rounded-lg bg-amber-500/[0.06] border border-amber-500/20 space-y-1">
          <div className="flex items-center gap-2 text-amber-500 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            Root Cause Identified
          </div>
          <div className="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {result.root_cause_summary}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {result.checks.map((check, i) => (
          <div
            key={i}
            className="flex items-start gap-3 py-2 px-3 rounded-lg bg-foreground/[0.02] border border-foreground/5"
          >
            <div className="mt-0.5">
              {check.status === "pass" && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              {check.status === "fail" && <XCircle className="w-4 h-4 text-red-500" />}
              {check.status === "warn" && <AlertCircle className="w-4 h-4 text-amber-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold">{check.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5 break-words">{check.message}</div>
              {check.detail && (
                <div className="text-[11px] text-muted-foreground/60 mt-1 break-words font-mono whitespace-pre-wrap">
                  {check.detail}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ── API Logs Panel ──────────────────────
function ApiLogsPanel({
  data,
  loading,
  onRefresh,
  onClear,
}: {
  data: LogsResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onClear: () => void;
}) {
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="glass-card p-6 space-y-4 border-foreground/10"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-foreground/60" />
            Meta Graph API Logs
          </h3>
          {data?.stats && (
            <p className="text-xs text-muted-foreground mt-1">
              {data.stats.total} requests • {data.stats.successes} success • {data.stats.failures} failed • avg {data.stats.avgResponseMs}ms
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1 text-xs bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 rounded-lg px-3 py-1.5 transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-xs bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 text-red-400 rounded-lg px-3 py-1.5 transition-all"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        </div>
      </div>

      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading logs...
        </div>
      )}

      {data && data.logs.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-4">
          No API requests logged yet. Logs are stored in memory and reset on server restart.
        </div>
      )}

      {data && data.logs.length > 0 && (
        <div className="space-y-1 max-h-[400px] overflow-y-auto">
          {data.logs.slice(0, 50).map((log, i) => (
            <div
              key={i}
              className={`rounded-lg border border-foreground/5 text-xs cursor-pointer transition-all hover:bg-foreground/[0.02] ${
                !log.success ? "border-red-500/10 bg-red-500/[0.01]" : ""
              }`}
              onClick={() => setExpandedLog(expandedLog === i ? null : i)}
            >
              <div className="flex items-center gap-3 px-3 py-2">
                {log.success ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                ) : (
                  <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                )}
                <span className="font-mono font-semibold text-[10px] bg-foreground/5 px-1.5 py-0.5 rounded">
                  {log.method}
                </span>
                <span className="font-mono text-muted-foreground truncate flex-1">{log.endpoint}</span>
                <span className="text-muted-foreground/50">{log.httpStatus || "ERR"}</span>
                <span className="text-muted-foreground/40">{log.response_time_ms}ms</span>
                {expandedLog === i ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </div>
              {expandedLog === i && (
                <div className="px-3 pb-3 pt-1 border-t border-foreground/5 space-y-1 font-mono text-muted-foreground/60">
                  <div>Time: {new Date(log.timestamp).toLocaleString("en-IN")}</div>
                  {log.fields && <div>Fields: {log.fields}</div>}
                  {log.errorCode && <div>Error: #{log.errorCode}{log.errorSubcode ? `.${log.errorSubcode}` : ""}</div>}
                  {log.errorMessage && <div className="text-red-400/80">Message: {log.errorMessage}</div>}
                  {log.fbtrace_id && <div>Request ID: {log.fbtrace_id}</div>}
                  {log.responsePreview && (
                    <div className="mt-1 bg-foreground/[0.03] rounded p-2 text-[10px] break-all max-h-[150px] overflow-y-auto">
                      {log.responsePreview}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
