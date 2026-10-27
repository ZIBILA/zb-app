"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, X } from "lucide-react";

export interface ApproveAffiliateTarget {
  id: string;
  name: string;
  code: string;
  /** Current rate as a fraction (0.1 = 10%), used to pre-fill the field. */
  commissionRate?: number | null;
  /** True when re-activating a suspended affiliate. */
  reactivate?: boolean;
}

interface Props {
  target: ApproveAffiliateTarget | null;
  submitting: boolean;
  error?: string | null;
  onCancel: () => void;
  /** Called with the rate as a fraction (12.5% → 0.125). */
  onConfirm: (commissionRate: number) => void;
}

/** Approve (or reactivate) an affiliate with a commission rate entered by the admin. */
export default function ApproveAffiliateModal({ target, submitting, error, onCancel, onConfirm }: Props) {
  const [percent, setPercent] = useState("");

  useEffect(() => {
    if (target) {
      setPercent(target.commissionRate ? String(Number((target.commissionRate * 100).toFixed(2))) : "");
    }
  }, [target]);

  const value = Number(percent);
  const valid = percent.trim() !== "" && Number.isFinite(value) && value > 0 && value <= 100;
  const showInvalid = percent.trim() !== "" && !valid;
  const exampleEarning = valid ? Math.round(1000 * value) / 100 : null;

  const submit = () => {
    if (!valid || submitting) return;
    onConfirm(Math.round(value * 100) / 10000);
  };

  return (
    <AnimatePresence>
      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-background border border-foreground/10 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-foreground/10 pb-3">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                {target.reactivate ? "Reactivate Partnership" : "Approve Affiliate"}
              </h3>
              <button onClick={onCancel} className="text-foreground/50 hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-sm text-foreground/80">
              <span className="font-medium text-foreground">{target.name}</span>
              <span className="ml-2 font-mono text-xs px-1.5 py-0.5 rounded bg-foreground/[0.06] text-foreground/80">{target.code}</span>
            </div>

            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <label htmlFor="affiliate-commission" className="text-xs font-medium text-foreground/60">
                Commission rate
              </label>
              <div className="relative">
                <input
                  id="affiliate-commission"
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  max={100}
                  step={0.01}
                  autoFocus
                  placeholder="e.g. 10 or 12.5"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  className={`w-full p-2.5 pr-8 rounded-lg bg-background border text-sm text-foreground placeholder:text-foreground/40 focus:outline-none ${
                    showInvalid ? "border-rose-500/60" : "border-zinc-800 focus:border-zinc-700"
                  }`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground/50">%</span>
              </div>
              {showInvalid ? (
                <p className="text-xs text-rose-400">Enter a percentage greater than 0 and up to 100.</p>
              ) : (
                <p className="text-xs text-foreground/50">
                  {exampleEarning !== null
                    ? `On a ₹1,000 order (after discounts) they earn ₹${exampleEarning.toLocaleString("en-IN")}.`
                    : "Percentage of each referred order (after discounts) paid to this affiliate."}
                </p>
              )}
              {error && <p className="text-xs text-rose-400">{error}</p>}
            </form>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={onCancel}
                className="px-3.5 py-1.5 rounded-lg bg-foreground/[0.06] hover:bg-foreground/10 text-xs font-medium text-foreground/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!valid || submitting}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-medium text-white transition-colors"
              >
                {submitting ? "Saving..." : target.reactivate ? "Reactivate" : "Approve"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
