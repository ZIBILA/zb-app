"use client";

import { useCallback, useState } from "react";
import { Loader2, TruckIcon, RefreshCw } from "lucide-react";

interface CourierOption {
  courier_company_id: number;
  courier_name: string;
  rate: number;
  estimated_delivery_days: number | null;
}

interface PickupOptions {
  activeProvider: string;
  displayId: string;
  customerPincode: string;
  couriers: CourierOption[];
  recommendedCourierId: number | null;
  message: string | null;
}

interface Props {
  kind: "return" | "exchange";
  requestId: string;
  /** Request status; the picker is only offered while a partner can still be (re)selected. */
  status: string;
  reverseAwb?: string | null;
  logisticsPartner?: string | null;
  onBooked: (message: string) => void;
  onError: (message: string) => void;
}

const BOOKABLE = ["approved", "approved_pickup_failed"];

/**
 * "Select Logistics Partner" step shown after a return/exchange is accepted:
 * ops picks a Shiprocket courier → AWB is generated and pickup requested.
 */
export default function ReversePickupPanel({
  kind,
  requestId,
  status,
  reverseAwb,
  logisticsPartner,
  onBooked,
  onError,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [options, setOptions] = useState<PickupOptions | null>(null);
  const [weight, setWeight] = useState("0.5");
  const [length, setLength] = useState("30");
  const [breadth, setBreadth] = useState("20");
  const [height, setHeight] = useState("5");
  const [choice, setChoice] = useState<string>("");
  /** Couriers that already refused to issue an AWB for this pickup (courier id → Shiprocket's reason). */
  const [failed, setFailed] = useState<Record<number, string>>({});

  const base = `/api/admin/${kind === "return" ? "returns" : "exchanges"}/${requestId}/pickup`;

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ weight, length, breadth, height });
      const res = await fetch(`${base}?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load couriers");
      setOptions(json);
      setFailed({});
      if (json.activeProvider === "shiprocket" && json.couriers?.length) {
        setChoice(`sr:${json.recommendedCourierId || json.couriers[0].courier_company_id}`);
      } else {
        setChoice("");
      }
    } catch (e: any) {
      onError(e?.message || "Failed to load couriers");
    } finally {
      setLoading(false);
    }
  }, [base, weight, length, breadth, height, onError]);

  const book = async () => {
    if (!choice) return;
    setBooking(true);
    try {
      const body: Record<string, unknown> = { weight, length, breadth, height };
      const id = Number(choice.replace("sr:", ""));
      const courier = options?.couriers.find((c) => c.courier_company_id === id);
      body.provider = "shiprocket";
      body.courier_id = id;
      body.courier_name = courier?.courier_name;
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to book pickup");
      setOpen(false);
      onBooked(`Pickup booked via ${json.courier} — AWB ${json.awb}`);
    } catch (e: any) {
      const message = e?.message || "Failed to book pickup";
      const failedId = Number(choice.replace("sr:", ""));
      const courierName = options?.couriers.find((c) => c.courier_company_id === failedId)?.courier_name || "That courier";
      const nextFailed = { ...failed, [failedId]: message };
      setFailed(nextFailed);
      // Move the selection to the next courier that has not refused yet.
      const next = options?.couriers.find((c) => !nextFailed[c.courier_company_id]);
      if (next) setChoice(`sr:${next.courier_company_id}`);
      onError(`${courierName} refused: ${message}${next ? ` — try ${next.courier_name}.` : ""}`);
    } finally {
      setBooking(false);
    }
  };

  const bookable = BOOKABLE.includes(String(status || "").toLowerCase());
  const input =
    "w-full bg-foreground/[0.02] border border-foreground/[0.05] focus:border-foreground/20 rounded-md px-2 py-1.5 text-[11px] font-mono text-foreground outline-none";

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-foreground/50">Logistics Partner</span>
          <span className="text-[11px] font-semibold text-foreground">{logisticsPartner || "Not selected"}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-foreground/50">Reverse AWB</span>
          <span className="text-[11px] font-semibold text-foreground font-mono">{reverseAwb || "Not generated"}</span>
        </div>
      </div>

      {bookable && !open && (
        <button
          onClick={() => {
            setOpen(true);
            loadOptions();
          }}
          className="w-full py-2.5 bg-amber-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest flex items-center justify-center gap-2"
        >
          <TruckIcon className="w-3.5 h-3.5" />
          {reverseAwb || status === "approved_pickup_failed" ? "Re-select Logistics Partner" : "Select Logistics Partner"}
        </button>
      )}

      {bookable && open && (
        <div className="border border-foreground/[0.08] rounded-lg p-3 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {[
              ["Wt (kg)", weight, setWeight],
              ["L (cm)", length, setLength],
              ["B (cm)", breadth, setBreadth],
              ["H (cm)", height, setHeight],
            ].map(([label, value, setter]) => (
              <div key={label as string}>
                <p className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest mb-1">{label as string}</p>
                <input
                  className={input}
                  value={value as string}
                  onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            ))}
          </div>
          <button
            onClick={loadOptions}
            disabled={loading}
            className="text-[9px] font-bold text-blue-500 uppercase tracking-widest flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh couriers
          </button>

          {loading && <Loader2 className="w-4 h-4 animate-spin text-foreground/40" />}

          {options && !loading && (
            <div className="space-y-2">
              <p className="text-[9px] text-foreground/40">
                Pickup pincode {options.customerPincode || "—"} → warehouse · {options.displayId}
              </p>
              {options.couriers.length === 0 && options.activeProvider === "shiprocket" && (
                <p className="text-[10px] text-amber-500">
                  {options.message || "No Shiprocket courier available for this pincode."}
                </p>
              )}
              <div className="max-h-56 overflow-y-auto space-y-1">
                {options.couriers.map((c) => (
                  <label
                    key={c.courier_company_id}
                    className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border cursor-pointer text-[11px] ${
                      choice === `sr:${c.courier_company_id}`
                        ? "border-foreground/40 bg-foreground/[0.04]"
                        : "border-foreground/[0.06]"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="reverse-courier"
                        checked={choice === `sr:${c.courier_company_id}`}
                        onChange={() => setChoice(`sr:${c.courier_company_id}`)}
                      />
                      <span className={`font-semibold ${failed[c.courier_company_id] ? "text-foreground/40 line-through" : ""}`}>{c.courier_name}</span>
                      {failed[c.courier_company_id] && (
                        <span className="text-[8px] text-red-500 font-bold max-w-[160px] truncate" title={failed[c.courier_company_id]}>
                          Refused: {failed[c.courier_company_id]}
                        </span>
                      )}
                      {options.recommendedCourierId === c.courier_company_id && (
                        <span className="text-[8px] uppercase tracking-widest text-emerald-500 font-bold">Recommended</span>
                      )}
                    </span>
                    <span className="text-foreground/50 font-mono">
                      ₹{c.rate}
                      {c.estimated_delivery_days != null ? ` · ${c.estimated_delivery_days}d` : ""}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={book}
              disabled={booking || !choice}
              className="flex-1 py-2 bg-foreground text-background rounded-md text-[9px] font-bold uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {booking ? <Loader2 className="w-3 h-3 animate-spin" /> : <TruckIcon className="w-3 h-3" />}
              Generate AWB &amp; Schedule Pickup
            </button>
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-2 border border-foreground/[0.08] rounded-md text-[9px] font-bold uppercase tracking-widest"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
