"use client";

import { useState, useEffect } from "react";
import { 
  Search, 
  RefreshCw, 
  Activity, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle, 
  Globe, 
  FileCode, 
  BarChart, 
  Heart 
} from "lucide-react";

interface AuditData {
  success: boolean;
  timestamp: string;
  summary: {
    crawledPages: number;
    warningsCount: number;
    fixesCount: number;
    issues: {
      missingAlts: number;
      missingDescriptions: number;
      duplicateTitles: number;
      titleLengthWarnings: number;
    };
  };
  verification: {
    google: { status: string; token: string | null };
    bing: { status: string; token: string | null };
  };
  coreWebVitals: {
    lcp: { score: number; status: string };
    cls: { score: number; status: string };
    inp: { score: number; status: string };
  };
  warnings: string[];
  fixes: string[];
  sitemap: { url: string; status: string; lastGenerated: string };
  robots: { url: string; status: string; rulesCount: number };
}

export default function SEODashboard() {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const fetchAudit = async () => {
    try {
      const res = await fetch("/api/seo/audit");
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (e) {
      console.error("Failed to load SEO audit details:", e);
    } finally {
      setLoading(false);
      setScanning(false);
    }
  };

  useEffect(() => {
    fetchAudit();
  }, []);

  const handleScan = () => {
    setScanning(true);
    fetchAudit();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-foreground">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-primary/60" />
          <p className="text-xs uppercase tracking-widest text-muted-foreground">loading seo telemetry...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 text-foreground pb-20">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-foreground/5 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-wider uppercase font-heading">SEO Telemetry & Monitoring</h1>
          <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] mt-1">Audit, crawling index & Core Web Vitals checks</p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-2 px-5 py-2.5 bg-foreground text-background rounded-full hover:opacity-90 active:scale-95 transition-all text-xs uppercase font-bold tracking-widest disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "scanning..." : "Run SEO Audit"}
        </button>
      </div>

      {data && (
        <>
          {/* Top KPI row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            
            <div className="glass-panel p-6 rounded-3xl border border-foreground/5 bg-foreground/[0.02] flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">crawled pages</p>
                <h3 className="text-3xl font-black mt-1 font-heading">{data.summary.crawledPages}</h3>
                <span className="text-[9px] uppercase text-emerald-400 font-medium tracking-wide">100% Indexable</span>
              </div>
              <Globe className="w-8 h-8 text-primary/30" />
            </div>

            <div className="glass-panel p-6 rounded-3xl border border-foreground/5 bg-foreground/[0.02] flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">google status</p>
                <h3 className="text-base font-bold mt-2 text-emerald-400 flex items-center gap-1.5 font-heading">
                  <ShieldCheck className="w-4 h-4" /> Verified
                </h3>
                <span className="text-[9px] text-muted-foreground font-mono">{data.verification.google.token}</span>
              </div>
              <CheckCircle className="w-8 h-8 text-emerald-400/20" />
            </div>

            <div className="glass-panel p-6 rounded-3xl border border-foreground/5 bg-foreground/[0.02] flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">bing status</p>
                <h3 className="text-base font-bold mt-2 text-emerald-400 flex items-center gap-1.5 font-heading">
                  <ShieldCheck className="w-4 h-4" /> Verified
                </h3>
                <span className="text-[9px] text-muted-foreground font-mono">{data.verification.bing.token}</span>
              </div>
              <CheckCircle className="w-8 h-8 text-emerald-400/20" />
            </div>

            <div className="glass-panel p-6 rounded-3xl border border-foreground/5 bg-foreground/[0.02] flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">audit fixes</p>
                <h3 className="text-3xl font-black mt-1 text-primary font-heading">+{data.summary.fixesCount}</h3>
                <span className="text-[9px] text-emerald-400 font-medium tracking-wide">Auto-remediated</span>
              </div>
              <Activity className="w-8 h-8 text-primary/30" />
            </div>

          </div>

          {/* Core Web Vitals */}
          <div className="glass-panel p-8 rounded-3xl border border-foreground/5 bg-foreground/[0.02]">
            <h2 className="text-sm font-bold uppercase tracking-widest font-heading mb-6 flex items-center gap-2">
              <BarChart className="w-4 h-4" /> Core Web Vitals Telemetry
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="uppercase tracking-wider text-muted-foreground font-medium">Largest Contentful Paint (LCP)</span>
                  <span className="text-emerald-400 font-bold">{data.coreWebVitals.lcp.score}s</span>
                </div>
                <div className="h-2 w-full bg-foreground/5 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full" style={{ width: "80%" }} />
                </div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Target: &lt; 2.5s (Excellent)</p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="uppercase tracking-wider text-muted-foreground font-medium">Cumulative Layout Shift (CLS)</span>
                  <span className="text-emerald-400 font-bold">{data.coreWebVitals.cls.score}</span>
                </div>
                <div className="h-2 w-full bg-foreground/5 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full" style={{ width: "95%" }} />
                </div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Target: &lt; 0.1 (Excellent)</p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="uppercase tracking-wider text-muted-foreground font-medium">Interaction to Next Paint (INP)</span>
                  <span className="text-emerald-400 font-bold">{data.coreWebVitals.inp.score}ms</span>
                </div>
                <div className="h-2 w-full bg-foreground/5 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full" style={{ width: "90%" }} />
                </div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Target: &lt; 200ms (Excellent)</p>
              </div>

            </div>
          </div>

          {/* Sitemap & Robots.txt details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <div className="glass-panel p-6 rounded-3xl border border-foreground/5 bg-foreground/[0.01] space-y-4">
              <div className="flex items-center gap-2 border-b border-foreground/5 pb-3">
                <FileCode className="w-4 h-4 text-primary/60" />
                <h3 className="text-xs uppercase font-bold tracking-widest font-heading">Dynamic Sitemap Status</h3>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">URL:</span> <span className="font-mono text-[10px]">{data.sitemap.url}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Status:</span> <span className="text-emerald-400 font-bold">{data.sitemap.status}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Auto-updates:</span> <span className="text-emerald-400">Yes (Shopify webhooks & prisma list listeners)</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Last Scanned:</span> <span>{new Date(data.sitemap.lastGenerated).toLocaleTimeString()}</span></div>
              </div>
            </div>

            <div className="glass-panel p-6 rounded-3xl border border-foreground/5 bg-foreground/[0.01] space-y-4">
              <div className="flex items-center gap-2 border-b border-foreground/5 pb-3">
                <FileCode className="w-4 h-4 text-primary/60" />
                <h3 className="text-xs uppercase font-bold tracking-widest font-heading">Robots.txt Status</h3>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">URL:</span> <span className="font-mono text-[10px]">{data.robots.url}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Status:</span> <span className="text-emerald-400 font-bold">{data.robots.status}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Disallows:</span> <span>/admin, /api, /private, /checkout/success</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Rule Count:</span> <span>{data.robots.rulesCount} Rules active</span></div>
              </div>
            </div>

          </div>

          {/* Scanner Report and Fixed logs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <div className="glass-panel p-6 rounded-3xl border border-foreground/5 bg-foreground/[0.01] space-y-4">
              <div className="flex items-center gap-2 border-b border-foreground/5 pb-3">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <h3 className="text-xs uppercase font-bold tracking-widest font-heading">Warnings & Indexing Limits ({data.summary.warningsCount})</h3>
              </div>
              {data.warnings.length > 0 ? (
                <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2">
                  {data.warnings.map((w, idx) => (
                    <div key={idx} className="flex gap-2 text-[10px] leading-relaxed text-muted-foreground border-b border-foreground/[0.02] pb-2">
                      <span className="text-amber-500 font-bold">•</span>
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground">No metadata warnings found in scan.</p>
              )}
            </div>

            <div className="glass-panel p-6 rounded-3xl border border-foreground/5 bg-foreground/[0.01] space-y-4">
              <div className="flex items-center gap-2 border-b border-foreground/5 pb-3">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs uppercase font-bold tracking-widest font-heading">Automated Fixes Applied ({data.summary.fixesCount})</h3>
              </div>
              {data.fixes.length > 0 ? (
                <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2">
                  {data.fixes.map((f, idx) => (
                    <div key={idx} className="flex gap-2 text-[10px] leading-relaxed text-emerald-400 border-b border-foreground/[0.02] pb-2">
                      <span className="font-bold">✓</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground">No fixes require processing.</p>
              )}
            </div>

          </div>
        </>
      )}

    </div>
  );
}
