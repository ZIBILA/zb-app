"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, CheckCircle2, AlertTriangle, XCircle, Info, Loader2, RefreshCw, Pencil, X } from "lucide-react";

type Level = "pass" | "warn" | "fail";
interface Quality {
  rating: "poor" | "good" | "excellent";
  checks: Array<{ id: string; label: string; level: Level; detail?: string }>;
  shiprocketScore: number | null;
  sources: string[];
  address: { name: string; phone: string; address1: string; address2: string; city: string; state: string; pincode: string };
  checkedAt: string;
}

const RATING = {
  excellent: { label: "Excellent", cls: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20", Icon: CheckCircle2 },
  good: { label: "Good", cls: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20", Icon: AlertTriangle },
  poor: { label: "Poor", cls: "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20", Icon: XCircle },
} as const;

const LEVEL_ICON = {
  pass: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />,
  warn: <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />,
  fail: <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />,
};

/**
 * Address check next to Logistics Command: rating from real checks (Shiprocket serviceability, India Post pincode
 * directory, completeness), problems highlighted, and the address can be corrected before the AWB, then re-checked.
 */
export default function AddressQuality({ orderId, awbAssigned, onAddressUpdated }: { orderId: string; awbAssigned: boolean; onAddressUpdated?: () => void }) {
  const [quality, setQuality] = useState<Quality | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Quality["address"] | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/address-quality`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Address check failed");
      setQuality(data.quality);
    } catch (e: any) {
      setError(e.message || "Address check failed");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/address-quality`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update the address");
      if (data.quality) setQuality(data.quality);
      setEditing(false);
      onAddressUpdated?.();
    } catch (e: any) {
      setError(e.message || "Could not update the address");
    } finally {
      setSaving(false);
    }
  };

  const r = quality ? RATING[quality.rating] : null;
  const problems = quality?.checks.filter((c) => c.level !== "pass") || [];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-foreground/10 bg-background hover:bg-foreground/[0.02] transition-colors"
        aria-expanded={open}
      >
        <MapPin className="w-3.5 h-3.5 text-foreground/50" />
        <span className="text-[11px] font-semibold text-foreground/80">Address Quality</span>
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-foreground/40" />
        ) : r ? (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${r.cls}`}>
            <r.Icon className="w-3 h-3" />
            {quality?.shiprocketScore != null ? `${quality.shiprocketScore}% ` : ""}{r.label}
          </span>
        ) : (
          <span className="text-[10px] text-foreground/40">Unavailable</span>
        )}
        <Info className="w-3.5 h-3.5 text-blue-500" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-[340px] max-w-[90vw] rounded-2xl border border-foreground/10 bg-background shadow-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-widest text-foreground/60">Address check</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={load} disabled={loading} className="p-1.5 rounded-lg hover:bg-foreground/[0.05]" aria-label="Check again">
                <RefreshCw className={`w-3.5 h-3.5 text-foreground/50 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button type="button" onClick={() => { setOpen(false); setEditing(false); }} className="p-1.5 rounded-lg hover:bg-foreground/[0.05]" aria-label="Close">
                <X className="w-3.5 h-3.5 text-foreground/50" />
              </button>
            </div>
          </div>

          {error && <p className="text-[11px] text-rose-500">{error}</p>}

          {quality && !editing && (
            <>
              {problems.length > 0 && (
                <div className="rounded-xl bg-rose-500/[0.06] border border-rose-500/15 p-2.5 space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Needs attention before dispatch</p>
                  {problems.map((c) => (
                    <p key={c.id} className="text-[11px] text-foreground/75">• {c.label}{c.detail ? `: ${c.detail}` : ""}</p>
                  ))}
                </div>
              )}
              <ul className="space-y-1.5">
                {quality.checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-[11px] text-foreground/75">
                    {LEVEL_ICON[c.level]}
                    <span>
                      {c.label}
                      {c.detail && c.level === "pass" ? <span className="text-foreground/40"> · {c.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] leading-relaxed text-foreground/40">
                Based on: {quality.sources.join(", ")}. Shiprocket&apos;s standard API returns no address score; a % score appears here only once
                Shiprocket Sense (Address Score API) is enabled for the account.
              </p>
              {awbAssigned ? (
                <p className="text-[10px] text-foreground/40">The AWB is already generated, so the address can no longer be changed here.</p>
              ) : (
                <button
                  type="button"
                  onClick={() => { setForm({ ...quality.address }); setEditing(true); }}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-foreground text-background text-[11px] font-semibold"
                >
                  <Pencil className="w-3.5 h-3.5" /> Correct address
                </button>
              )}
            </>
          )}

          {editing && form && (
            <div className="space-y-2">
              {([
                ["name", "Name"],
                ["phone", "Mobile"],
                ["address1", "House / flat, street"],
                ["address2", "Area, landmark"],
                ["city", "City"],
                ["state", "State"],
                ["pincode", "Pincode"],
              ] as const).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/40">{label}</span>
                  <input
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="mt-0.5 w-full rounded-lg border border-foreground/10 bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-foreground/30"
                  />
                </label>
              ))}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setEditing(false)} className="flex-1 py-2 rounded-xl border border-foreground/10 text-[11px] font-semibold text-foreground/70">
                  Cancel
                </button>
                <button type="button" onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-foreground text-background text-[11px] font-semibold disabled:opacity-50">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save &amp; re-check
                </button>
              </div>
              <p className="text-[10px] text-foreground/40">Saved on the order, in Shopify and on the Shiprocket order (before AWB).</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
