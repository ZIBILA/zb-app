"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  CheckCircle2, AlertTriangle, CreditCard, ExternalLink, KeyRound,
  Webhook, RefreshCw, Shield, Zap, Copy, Check, Eye, EyeOff,
  ArrowRight, Globe, Smartphone, Server, Activity,
} from "lucide-react";
import { motion } from "framer-motion";

type PaymentStatus = {
  razorpayReady: boolean;
  source: "database" | "environment" | "none";
};

type ConfigData = {
  keyId?: string;
  isConfigured: boolean;
  source?: string;
  error?: string;
};

type SettingsData = {
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  webhookSecret?: string;
  [key: string]: any;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="p-1.5 rounded-lg hover:bg-foreground/10 transition-colors" title="Copy">
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-foreground/40" />}
    </button>
  );
}

function MaskedKey({ value, label }: { value?: string; label: string }) {
  const [show, setShow] = useState(false);
  if (!value) return <span className="text-amber-500/80 font-bold">Not configured</span>;
  const masked = value.slice(0, 8) + "••••••••" + value.slice(-4);
  return (
    <div className="flex items-center gap-2">
      <code className="bg-foreground/5 px-3 py-1.5 rounded-lg text-[11px] font-mono tracking-tight text-foreground/80">
        {show ? value : masked}
      </code>
      <button onClick={() => setShow(!show)} className="p-1 rounded-lg hover:bg-foreground/10 transition-colors">
        {show ? <EyeOff className="w-3.5 h-3.5 text-foreground/40" /> : <Eye className="w-3.5 h-3.5 text-foreground/40" />}
      </button>
      <CopyButton text={value} />
    </div>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <div className={`w-2.5 h-2.5 rounded-full ${active ? "bg-emerald-500 animate-pulse" : "bg-red-500/60"}`} />
  );
}

function InfoCard({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="glass-card rounded-[2rem] border border-foreground/5 overflow-hidden"
    >
      <div className="px-8 py-5 border-b border-foreground/5 flex items-center gap-3">
        <Icon className="w-5 h-5 text-foreground/50" strokeWidth={1.5} />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.3em] text-foreground/60">{title}</h3>
      </div>
      <div className="px-8 py-6">{children}</div>
    </motion.div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-4 border-b border-foreground/5 last:border-0 gap-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-foreground/40">{label}</span>
      <div className="text-xs text-foreground/80 font-medium">{children}</div>
    </div>
  );
}

export default function RazorpayPaymentsPage() {
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [configData, setConfigData] = useState<ConfigData | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const loadData = useCallback(() => {
    fetch("/api/admin/payment-status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ razorpayReady: false, source: "none" }));

    fetch("/api/razorpay/config")
      .then((r) => r.json())
      .then(setConfigData)
      .catch(() => setConfigData({ isConfigured: false }));

    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => null);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const ready = status?.razorpayReady === true;
  const sourceLabel =
    status?.source === "database" ? "Dashboard Settings"
    : status?.source === "environment" ? "Environment Variables"
    : "Not configured";

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/razorpay/config");
      const data = await res.json();
      if (data.isConfigured) {
        setTestResult({ ok: true, message: `Connected! Key: ${data.keyId?.slice(0, 12)}... (Source: ${data.source})` });
      } else {
        setTestResult({ ok: false, message: data.error || "Not configured" });
      }
    } catch {
      setTestResult({ ok: false, message: "Could not reach the config endpoint" });
    } finally {
      setTesting(false);
    }
  };

  const webhookUrl = "https://zicabella.com/api/webhooks/razorpay";
  const isLive = configData?.keyId?.startsWith("rzp_live_");
  const isTest = configData?.keyId?.startsWith("rzp_test_");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="max-w-3xl mx-auto space-y-8 pb-16"
    >
      {/* Header */}
      <div className="pt-6">
        <h1 className="text-4xl font-bold text-foreground uppercase tracking-tighter">Razorpay</h1>
        <p className="text-[11px] text-foreground/50 font-medium uppercase tracking-[0.25em] mt-2">
          Payment gateway configuration, status, and integration details
        </p>
      </div>

      {/* Status Banner */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1, duration: 0.5 }}
        className={`rounded-[2rem] border p-8 flex gap-5 ${
          ready ? "bg-emerald-500/10 border-emerald-500/25" : "bg-amber-500/10 border-amber-500/25"
        }`}
      >
        {ready ? (
          <CheckCircle2 className="w-10 h-10 text-emerald-600 shrink-0 mt-0.5" strokeWidth={1.5} />
        ) : (
          <AlertTriangle className="w-10 h-10 text-amber-600 shrink-0 mt-0.5" strokeWidth={1.5} />
        )}
        <div className="flex-1">
          <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">
            {ready ? "Razorpay is Active" : "Configuration Required"}
          </h2>
          <p className="text-xs text-foreground/70 mt-2 leading-relaxed">
            {ready
              ? `Live payments can be created and verified. Keys loaded from: ${sourceLabel}.`
              : "Add your Razorpay Key ID and Key Secret in Settings → Payment Gateways, then save."}
          </p>

          <div className="flex flex-wrap gap-3 mt-4">
            {!ready && (
              <Link
                href="/dashboard/settings"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-foreground text-background text-[10px] font-bold uppercase tracking-widest"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Open Settings
              </Link>
            )}
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-foreground/15 text-[10px] font-bold uppercase tracking-widest hover:bg-foreground/5 transition-colors disabled:opacity-50"
            >
              {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Test Connection
            </button>
          </div>

          {testResult && (
            <div className={`mt-3 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 ${
              testResult.ok ? "text-emerald-600" : "text-red-500"
            }`}>
              {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              {testResult.message}
            </div>
          )}
        </div>
      </motion.div>

      {/* API Keys Details */}
      <InfoCard icon={KeyRound} title="API Credentials">
        <div className="space-y-0">
          <DetailRow label="Key ID">
            {settings?.razorpayKeyId ? (
              <div className="flex items-center gap-3">
                <MaskedKey value={settings.razorpayKeyId} label="Key ID" />
                {isLive && <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 text-[9px] font-bold uppercase tracking-widest border border-emerald-500/20">Live</span>}
                {isTest && <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 text-[9px] font-bold uppercase tracking-widest border border-amber-500/20">Test</span>}
              </div>
            ) : <span className="text-amber-500/80 font-bold text-[10px] uppercase tracking-widest">Not set</span>}
          </DetailRow>
          <DetailRow label="Key Secret">
            <MaskedKey value={settings?.razorpayKeySecret} label="Key Secret" />
          </DetailRow>
          <DetailRow label="Source">
            <div className="flex items-center gap-2">
              <StatusDot active={ready} />
              <span className="text-[10px] font-bold uppercase tracking-widest">{sourceLabel}</span>
            </div>
          </DetailRow>
          <DetailRow label="Mode">
            <span className={`text-[10px] font-bold uppercase tracking-widest ${isLive ? "text-emerald-600" : isTest ? "text-amber-600" : "text-foreground/40"}`}>
              {isLive ? "🟢 Production" : isTest ? "🟡 Test / Sandbox" : "Not configured"}
            </span>
          </DetailRow>
        </div>
        <div className="mt-4 pt-4 border-t border-foreground/5">
          <Link
            href="/dashboard/settings"
            className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] text-foreground/50 hover:text-foreground transition-colors"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            Edit in Infrastructure Settings
          </Link>
        </div>
      </InfoCard>

      {/* Mobile App Config */}
      <InfoCard icon={Smartphone} title="Mobile App (React Native)">
        <div className="space-y-4 text-xs text-foreground/70 leading-relaxed">
          <p>
            The React Native app uses <strong className="text-foreground">react-native-razorpay</strong> SDK.
            The key is fetched dynamically from the <code className="bg-foreground/10 px-1.5 py-0.5 rounded text-[10px]">create-order</code> API response.
          </p>
          <div className="space-y-0">
            <DetailRow label="EXPO_PUBLIC_RAZORPAY_KEY_ID">
              <code className="bg-foreground/5 px-3 py-1.5 rounded-lg text-[11px] font-mono">
                {settings?.razorpayKeyId || "Not set"}
              </code>
            </DetailRow>
            <DetailRow label="Create Order API">
              <div className="flex items-center gap-2">
                <code className="bg-foreground/5 px-3 py-1.5 rounded-lg text-[10px] font-mono">
                  POST /api/app/payment/create-order
                </code>
                <CopyButton text="https://app.zicabella.com/api/app/payment/create-order" />
              </div>
            </DetailRow>
            <DetailRow label="Verify API">
              <div className="flex items-center gap-2">
                <code className="bg-foreground/5 px-3 py-1.5 rounded-lg text-[10px] font-mono">
                  POST /api/app/payment/verify
                </code>
                <CopyButton text="https://app.zicabella.com/api/app/payment/verify" />
              </div>
            </DetailRow>
          </div>
          <div className="rounded-xl bg-foreground/5 p-4 text-[10px] space-y-1">
            <p className="font-bold text-foreground/60 uppercase tracking-widest mb-2">Payment Flow</p>
            <p>1. App calls <code>create-order</code> → gets <code>order_id</code> + <code>key_id</code></p>
            <p>2. App opens <code>RazorpayCheckout.open()</code> with those values</p>
            <p>3. On success, app calls <code>verify</code> with signature</p>
            <p>4. App calls <code>orders/create</code> to record order in Shopify</p>
          </div>
        </div>
      </InfoCard>

      {/* Webhooks */}
      <InfoCard icon={Webhook} title="Webhooks">
        <div className="space-y-4 text-xs text-foreground/70">
          <p className="leading-relaxed">
            Configure this URL in <strong className="text-foreground">Razorpay Dashboard → Webhooks</strong>.
            Set <code className="bg-foreground/10 px-1.5 py-0.5 rounded text-[10px]">RAZORPAY_WEBHOOK_SECRET</code> to match the secret shown in Razorpay.
          </p>
          <div className="rounded-xl bg-foreground/5 p-4 flex items-center justify-between gap-3">
            <code className="font-mono text-[11px] break-all text-foreground/80">{webhookUrl}</code>
            <CopyButton text={webhookUrl} />
          </div>
          <DetailRow label="Webhook Secret">
            <MaskedKey value={settings?.webhookSecret} label="Webhook Secret" />
          </DetailRow>
          <div className="rounded-xl bg-foreground/5 p-4 text-[10px] space-y-1">
            <p className="font-bold text-foreground/60 uppercase tracking-widest mb-2">Required Events</p>
            <p>✅ <code>payment.captured</code> — Marks orders as paid</p>
            <p>✅ <code>payment.failed</code> — Marks orders as failed</p>
            <p>✅ <code>refund.created</code> — Logs refund events</p>
          </div>
          <Link
            href="/dashboard/webhooks"
            className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-foreground/50 hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Webhooks Overview
          </Link>
        </div>
      </InfoCard>

      {/* API Endpoints */}
      <InfoCard icon={Server} title="API Endpoints">
        <div className="space-y-0">
          <DetailRow label="Create Order (Mobile)">
            <code className="bg-foreground/5 px-3 py-1.5 rounded-lg text-[10px] font-mono">/api/app/payment/create-order</code>
          </DetailRow>
          <DetailRow label="Verify Payment (Mobile)">
            <code className="bg-foreground/5 px-3 py-1.5 rounded-lg text-[10px] font-mono">/api/app/payment/verify</code>
          </DetailRow>
          <DetailRow label="Headless Process (S2S)">
            <code className="bg-foreground/5 px-3 py-1.5 rounded-lg text-[10px] font-mono">/api/app/payment/process</code>
          </DetailRow>
          <DetailRow label="Payment Status">
            <code className="bg-foreground/5 px-3 py-1.5 rounded-lg text-[10px] font-mono">/api/app/payment/status/[id]</code>
          </DetailRow>
          <DetailRow label="Webhook">
            <code className="bg-foreground/5 px-3 py-1.5 rounded-lg text-[10px] font-mono">/api/webhooks/razorpay</code>
          </DetailRow>
          <DetailRow label="Refund">
            <code className="bg-foreground/5 px-3 py-1.5 rounded-lg text-[10px] font-mono">/api/razorpay/refund</code>
          </DetailRow>
          <DetailRow label="Config Check">
            <code className="bg-foreground/5 px-3 py-1.5 rounded-lg text-[10px] font-mono">/api/razorpay/config</code>
          </DetailRow>
        </div>
      </InfoCard>

      {/* Quick Links */}
      <div className="flex flex-wrap gap-3">
        <Link
          href="/dashboard/orders"
          className="px-5 py-3 rounded-xl bg-foreground text-background text-[10px] font-bold uppercase tracking-widest"
        >
          Orders
        </Link>
        <Link
          href="/dashboard/mobile-orders"
          className="px-5 py-3 rounded-xl border border-foreground/15 text-[10px] font-bold uppercase tracking-widest hover:bg-foreground/5 transition-colors"
        >
          Mobile Orders
        </Link>
        <Link
          href="/dashboard/settings"
          className="px-5 py-3 rounded-xl border border-foreground/15 text-[10px] font-bold uppercase tracking-widest hover:bg-foreground/5 transition-colors"
        >
          Infrastructure Settings
        </Link>
        <a
          href="https://dashboard.razorpay.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="px-5 py-3 rounded-xl border border-foreground/15 text-[10px] font-bold uppercase tracking-widest hover:bg-foreground/5 transition-colors inline-flex items-center gap-2"
        >
          Razorpay Dashboard <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </motion.div>
  );
}
