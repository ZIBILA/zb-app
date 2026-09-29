"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCw,
  Rss,
} from "lucide-react";

interface FeedBuild {
  format: "xml" | "csv";
  status: "success" | "error";
  itemCount: number;
  productCount: number;
  durationMs: number;
  error: string | null;
  createdAt: string;
}

interface FeedStatusResponse {
  success: boolean;
  urls: { xml: string; csv: string };
  platforms: { name: string; format: string; preferredUrl: string }[];
  excludedCollections: string[];
  builds: { xml: FeedBuild | null; csv: FeedBuild | null };
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-foreground/10 text-[10px] uppercase tracking-widest font-semibold hover:bg-foreground/5 transition-colors"
    >
      <Copy className="w-3 h-3" />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function BuildCard({ title, build, url }: { title: string; build: FeedBuild | null; url: string }) {
  const ok = build?.status === "success";
  return (
    <div className="rounded-xl border border-foreground/10 bg-background p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-tight">{title}</p>
          <p className="text-[11px] text-muted-foreground break-all mt-1">{url}</p>
        </div>
        <CopyButton value={url} />
      </div>

      {!build ? (
        <p className="text-xs text-muted-foreground">
          No build recorded yet. Open the feed URL or click Refresh status.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            {ok ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            )}
            <span className="uppercase tracking-widest font-semibold">
              {ok ? "Last build OK" : "Last build failed"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
            <div>Items: <span className="text-foreground font-medium">{build.itemCount}</span></div>
            <div>Products: <span className="text-foreground font-medium">{build.productCount}</span></div>
            <div>Duration: <span className="text-foreground font-medium">{build.durationMs}ms</span></div>
            <div>When: <span className="text-foreground font-medium">{new Date(build.createdAt).toLocaleString()}</span></div>
          </div>
          {!ok && build.error && (
            <pre className="text-[11px] whitespace-pre-wrap rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-amber-700 dark:text-amber-300">
              {build.error}
            </pre>
          )}
        </div>
      )}

      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold text-foreground/70 hover:text-foreground"
      >
        Open feed <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

export default function CatalogueFeedsPage() {
  const [data, setData] = useState<FeedStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/admin/feeds/status", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || json.message || `HTTP ${res.status}`);
      }
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Failed to load feed status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setError(null);
      const res = await fetch("/api/admin/feeds/status", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || json.message || `HTTP ${res.status}`);
      }
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        <span className="text-xs uppercase tracking-widest">Loading catalogue feeds…</span>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-foreground">
            <Rss className="w-5 h-5" />
            <h1 className="text-xl font-semibold tracking-tight">Catalogue Feeds</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Live product feeds for Meta, Google, Snapchat and ChatGPT / OpenAI Ads.
            Platforms pull these URLs on their schedule; each request rebuilds from Shopify
            (cached ~15 minutes).
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-foreground/10 text-[11px] uppercase tracking-widest font-semibold hover:bg-foreground/5 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh status
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <BuildCard title="XML feed (/feed.xml)" build={data.builds.xml} url={data.urls.xml} />
            <BuildCard title="CSV feed (/feed.csv)" build={data.builds.csv} url={data.urls.csv} />
          </div>

          <div className="rounded-xl border border-foreground/10 p-5 space-y-3">
            <h2 className="text-sm font-semibold tracking-tight">Paste into each platform</h2>
            <div className="divide-y divide-foreground/5">
              {data.platforms.map((p) => (
                <div key={p.name} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">{p.format}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-[11px] bg-foreground/5 px-2 py-1 rounded max-w-[280px] truncate">
                      {p.preferredUrl}
                    </code>
                    <CopyButton value={p.preferredUrl} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-foreground/10 p-5 space-y-2">
            <h2 className="text-sm font-semibold tracking-tight">Exclusions</h2>
            <p className="text-xs text-muted-foreground">
              Collection exclusions are configured under{" "}
              <a href="/dashboard/storefront" className="underline underline-offset-2">
                Storefront settings
              </a>
              . Per-product toggles live on the Products page.
            </p>
            <p className="text-xs">
              Currently excluded collections:{" "}
              <span className="font-medium">
                {data.excludedCollections.length
                  ? data.excludedCollections.join(", ")
                  : "none"}
              </span>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
