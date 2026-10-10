"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { ReactNode, useState } from "react";

export type AppDialogTone = "default" | "danger" | "success";

export type AppDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  tone?: AppDialogTone;
  /** Primary action. Omit for a simple alert with one dismiss button. */
  onConfirm?: () => void | Promise<void>;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
};

const toneIcon = {
  default: AlertCircle,
  danger: AlertCircle,
  success: CheckCircle2,
} as const;

const toneColor = {
  default: "text-foreground",
  danger: "text-red-500",
  success: "text-emerald-500",
} as const;

/**
 * Apple-glass confirm / alert dialog for storefront surfaces.
 * Prefer this over window.alert / window.confirm.
 */
export default function AppDialog({
  open,
  onClose,
  title,
  description,
  tone = "default",
  onConfirm,
  confirmLabel = "Confirm",
  cancelLabel = "Go Back",
  loading: loadingProp,
}: AppDialogProps) {
  const [internalLoading, setInternalLoading] = useState(false);
  const loading = loadingProp ?? internalLoading;
  const Icon = toneIcon[tone];
  const isAlert = !onConfirm;

  const handleConfirm = async () => {
    if (!onConfirm || loading) return;
    try {
      setInternalLoading(true);
      await onConfirm();
    } finally {
      setInternalLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !loading && onClose()}
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            className="relative z-10 w-full max-w-md apple-glass-capsule rounded-[28px] border border-foreground/10 p-7 shadow-2xl space-y-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className={`flex items-center gap-2.5 ${toneColor[tone]}`}>
                <Icon className="w-5 h-5 shrink-0" />
                <h3
                  id="app-dialog-title"
                  className="text-[12px] font-black uppercase tracking-[0.2em] text-foreground"
                >
                  {title}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="p-1 rounded-lg text-foreground/40 hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-40"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {description != null && (
              <div className="text-[12px] text-foreground/70 leading-relaxed font-medium space-y-2">
                {description}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              {isAlert ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-3 rounded-xl bg-foreground text-background text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition-all"
                >
                  OK
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={loading}
                    className="flex-1 py-3 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/70 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
                  >
                    {cancelLabel}
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={loading}
                    className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 ${
                      tone === "danger"
                        ? "bg-red-500 hover:bg-red-600 text-white"
                        : "bg-foreground text-background hover:opacity-90"
                    }`}
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {confirmLabel}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
