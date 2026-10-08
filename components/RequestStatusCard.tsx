"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, RotateCcw, ExternalLink, CheckCircle2, ChevronDown } from "lucide-react";
import type { RequestSummary } from "@/lib/services/requestSummary";
import { REFUND_POLICY_PATH } from "@/lib/returnPolicy";

interface Props {
  summary: RequestSummary;
  /** Optional extra info rendered under the header (reason, amounts…) */
  children?: React.ReactNode;
  /** Optional right-hand header action (e.g. cancel button) */
  action?: React.ReactNode;
}

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;

/**
 * Customer-facing return / exchange card: id, status, pickup tracking, received flag,
 * refund / store-credit state and replacement shipment — identical data to the admin view.
 */
export default function RequestStatusCard({ summary, children, action }: Props) {
  const [showTimeline, setShowTimeline] = useState(false);
  const isReturn = summary.kind === "return";
  const tone = isReturn
    ? { box: "bg-amber-500/10 border-amber-500/20", text: "text-amber-500", Icon: RotateCcw }
    : { box: "bg-blue-500/10 border-blue-500/20", text: "text-blue-500", Icon: ArrowLeftRight };
  const { pickup, refund, replacement } = summary;
  const hasPickup = !!pickup.awb;

  return (
    <div className={`p-4 rounded-2xl border space-y-3 ${tone.box}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <tone.Icon className={`w-4 h-4 mt-0.5 ${tone.text}`} />
          <div>
            <h4 className={`text-[10px] font-bold uppercase tracking-wider ${tone.text}`}>
              {isReturn ? "Return" : "Exchange"} {summary.displayId || ""}
            </h4>
            <p className="text-[9px] font-bold uppercase tracking-widest text-foreground/60 mt-0.5">{summary.stageLabel}</p>
          </div>
        </div>
        {action}
      </div>

      {summary.codMessage && (
        <p className="text-[9.5px] leading-relaxed text-foreground/70 bg-background/40 rounded-xl px-3 py-2">
          {summary.codMessage}{" "}
          <Link href={REFUND_POLICY_PATH} className="underline font-bold text-foreground">
            Learn More
          </Link>
        </p>
      )}

      {children && <div className="text-[9.5px] text-foreground/70 space-y-1">{children}</div>}

      {/* Pickup */}
      <div className="text-[9.5px] text-foreground/70 space-y-1 border-t border-foreground/10 pt-2.5">
        <div className="flex justify-between gap-3">
          <span className="text-foreground/50">Pickup</span>
          <span className="font-bold text-foreground">{pickup.stageLabel}</span>
        </div>
        {hasPickup && (
          <>
            <div className="flex justify-between gap-3">
              <span className="text-foreground/50">Courier</span>
              <span className="font-bold text-foreground">{pickup.courier || "—"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-foreground/50">AWB</span>
              {pickup.trackingUrl ? (
                <a href={pickup.trackingUrl} target="_blank" rel="noreferrer" className="font-mono font-bold text-foreground underline flex items-center gap-1">
                  {pickup.awb} <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="font-mono font-bold text-foreground">{pickup.awb}</span>
              )}
            </div>
            {pickup.carrierStatusLabel && (
              <div className="flex justify-between gap-3">
                <span className="text-foreground/50">Movement</span>
                <span className="font-bold text-foreground">
                  {pickup.carrierStatusLabel}
                  {pickup.location ? ` · ${pickup.location}` : ""}
                </span>
              </div>
            )}
            {pickup.expectedDate && !summary.received && (
              <div className="flex justify-between gap-3">
                <span className="text-foreground/50">Expected</span>
                <span className="font-bold text-foreground">{fmtDate(pickup.expectedDate)}</span>
              </div>
            )}
            {pickup.timeline.length > 0 && (
              <button
                onClick={() => setShowTimeline((v) => !v)}
                className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest text-foreground/50 pt-1"
              >
                Pickup history <ChevronDown className={`w-3 h-3 transition-transform ${showTimeline ? "rotate-180" : ""}`} />
              </button>
            )}
            {showTimeline && (
              <ul className="space-y-1 pt-1">
                {pickup.timeline.slice(0, 8).map((e, i) => (
                  <li key={i} className="flex justify-between gap-3 text-[9px]">
                    <span className="text-foreground/80">
                      {e.status}
                      {e.location ? ` · ${e.location}` : ""}
                    </span>
                    <span className="text-foreground/40 shrink-0">{fmt(e.dateTime)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="flex justify-between gap-3 pt-1">
          <span className="text-foreground/50">Received at warehouse</span>
          {summary.received ? (
            <span className="font-bold text-emerald-500 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Yes{summary.receivedAt ? ` · ${fmtDate(summary.receivedAt)}` : ""}
            </span>
          ) : (
            <span className="font-bold text-foreground/60">Not yet</span>
          )}
        </div>
      </div>

      {/* Refund / store credit */}
      {refund && (
        <div className="text-[9.5px] text-foreground/70 space-y-1 border-t border-foreground/10 pt-2.5">
          <div className="flex justify-between gap-3">
            <span className="text-foreground/50">{refund.method === "store_credit" ? "Store Credit" : "Refund"}</span>
            <span className="font-bold text-foreground">₹{refund.amount.toLocaleString("en-IN")} · {refund.methodLabel}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-foreground/50">Status</span>
            <span className={`font-bold ${refund.state === "released" ? "text-emerald-500" : "text-foreground"}`}>{refund.stateLabel}</span>
          </div>
        </div>
      )}

      {/* Replacement */}
      {replacement && (
        <div className="text-[9.5px] text-foreground/70 space-y-1 border-t border-foreground/10 pt-2.5">
          <div className="flex justify-between gap-3">
            <span className="text-foreground/50">Replacement order</span>
            {replacement.orderId ? (
              <Link href={`/orders/${replacement.orderId}`} className="font-mono font-bold text-foreground underline">
                {replacement.displayId}
              </Link>
            ) : (
              <span className="font-mono font-bold text-foreground">{replacement.displayId}</span>
            )}
          </div>
          {replacement.status && (
            <div className="flex justify-between gap-3">
              <span className="text-foreground/50">Status</span>
              <span className="font-bold text-foreground">{replacement.status}</span>
            </div>
          )}
          {replacement.awb && (
            <div className="flex justify-between gap-3">
              <span className="text-foreground/50">AWB</span>
              {replacement.trackingUrl ? (
                <a href={replacement.trackingUrl} target="_blank" rel="noreferrer" className="font-mono font-bold text-foreground underline">
                  {replacement.awb}
                </a>
              ) : (
                <span className="font-mono font-bold text-foreground">{replacement.awb}</span>
              )}
            </div>
          )}
          {replacement.paymentLabel && (
            <div className="flex justify-between gap-3">
              <span className="text-foreground/50">Payment</span>
              <span className="font-bold text-foreground">{replacement.paymentLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
