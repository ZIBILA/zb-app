'use client';

import React, { useState } from 'react';
import {
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Truck,
  Package,
  ScanLine,
  Weight,
  ChevronRight,
  Star,
  Clock,
  IndianRupee,
  AlertTriangle,
  Printer,
  FileText,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface CourierOption {
  courier_company_id: number;
  courier_name: string;
  rate: number;
  estimated_delivery_days: number | null;
  cod: boolean;
  charge_weight: number;
  freight_charge: number;
  cod_charges: number;
}

interface ShiprocketOrder {
  id: string;
  status: string;
  paymentMethod: string | null;
  deliveryStatus?: string | null;
  delhivery_awb?: string | null;
  shipments?: Array<{
    trackingNumber?: string | null;
    awb?: string | null;
    courier?: string | null;
    status?: string | null;
    trackingUrl?: string | null;
    labelUrl?: string | null;
    rawDelhiveryResponse?: string | null;
  }>;
}

interface ShiprocketActionsProps {
  order: ShiprocketOrder;
  onRefresh: () => void;
}

type FlowStep = 'idle' | 'dimensions' | 'couriers' | 'booked';

export default function ShiprocketActions({ order, onRefresh }: ShiprocketActionsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Parcel dimensions state
  const [weight, setWeight] = useState('');
  const [length, setLength] = useState('');
  const [breadth, setBreadth] = useState('');
  const [height, setHeight] = useState('');

  // Courier selection state
  const [couriers, setCouriers] = useState<CourierOption[]>([]);
  const [recommendedId, setRecommendedId] = useState<number | null>(null);
  const [selectedCourierId, setSelectedCourierId] = useState<number | null>(null);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [step, setStep] = useState<FlowStep>('idle');

  const activeShipment = order.shipments?.find((s) => s.status !== 'cancelled') || order.shipments?.[0];
  const isShipmentCancelled = activeShipment?.status === 'cancelled' || order.deliveryStatus === 'cancelled';
  const shipment = isShipmentCancelled ? null : activeShipment;
  const awb = shipment?.awb || (isShipmentCancelled ? null : order.delhivery_awb) || null;
  const trackingNumber = shipment?.trackingNumber || null;
  const status = isShipmentCancelled ? 'cancelled' : (shipment?.status || order.deliveryStatus || 'pending');
  const trackingUrl =
    shipment?.trackingUrl || (awb ? `https://shiprocket.co/tracking/${awb}` : null);

  const pickupDone = status === 'pickup_scheduled' || Boolean(
    (() => {
      try {
        const raw = shipment?.rawDelhiveryResponse;
        if (!raw) return false;
        const meta = JSON.parse(raw);
        return Boolean(meta?.pickup_scheduled_at);
      } catch {
        return false;
      }
    })()
  );

  const blocked = order.status === 'cancelled' || order.status === 'payment_failed';

  const dimensionsValid =
    parseFloat(weight) > 0 &&
    parseFloat(length) > 0 &&
    parseFloat(breadth) > 0 &&
    parseFloat(height) > 0;

  const handleFetchCouriers = async () => {
    if (!dimensionsValid) return;
    setLoading('couriers');
    setError(null);
    setCouriers([]);
    setSelectedCourierId(null);
    setEmptyReason(null);
    try {
      const res = await fetch('/api/logistics/couriers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          weight: parseFloat(weight),
          length: parseFloat(length),
          breadth: parseFloat(breadth),
          height: parseFloat(height),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch couriers');
      setCouriers(data.available_couriers || []);
      setRecommendedId(data.recommended_courier_id ?? null);
      setEmptyReason(data.message || null);
      setStep('couriers');
    } catch (err: any) {
      setError(err.message || 'Failed to fetch courier options');
    } finally {
      setLoading(null);
    }
  };

  const handleBookWithCourier = async () => {
    if (!selectedCourierId) return;
    const chosen = couriers.find((c) => c.courier_company_id === selectedCourierId);
    if (!chosen) return;

    setLoading('book');
    setError(null);
    try {
      const res = await fetch('/api/logistics/book-with-courier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          courier_id: selectedCourierId,
          courier_name: chosen.courier_name,
          weight: parseFloat(weight),
          length: parseFloat(length),
          breadth: parseFloat(breadth),
          height: parseFloat(height),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to book shipment');
      setMessage(`AWB ${data.awb} assigned via ${data.courier}`);
      setStep('booked');
      onRefresh();
    } catch (err: any) {
      const raw = String(err.message || '');
      if (/awb assign failed|could not assign an awb|try a different courier/i.test(raw)) {
        setError(
          raw.includes('Try a different courier')
            ? raw
            : 'This courier could not assign an AWB. Choose another courier/provider and try again — the shipment is already saved.'
        );
      } else {
        setError(raw || 'Failed to book shipment');
      }
    } finally {
      setLoading(null);
    }
  };

  const handlePickup = async () => {
    setLoading('pickup');
    setError(null);
    try {
      const res = await fetch('/api/logistics/generate-pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to schedule pickup');
      setMessage(data.message || 'Pickup scheduled');
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(null);
    }
  };

  const handleSync = async () => {
    setLoading('sync');
    setError(null);
    try {
      const res = await fetch('/api/logistics/sync-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to sync status');
      setMessage(data.message || `Status: ${data.shipmentStatus}`);
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(null);
    }
  };

  const [showCancelModal, setShowCancelModal] = useState(false);

  const handleCancel = () => {
    if (!awb && !trackingNumber) return;
    setShowCancelModal(true);
  };

  const handleConfirmCancel = async () => {
    if (!awb && !trackingNumber) return;
    setLoading('cancel');
    setError(null);
    try {
      const res = await fetch('/api/admin/logistics/cancel-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ awb: awb || trackingNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to cancel');
      setMessage('Shipment cancelled — courier AWB has been voided.');
      setShowCancelModal(false);
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(null);
    }
  };

  const handleCopy = async () => {
    if (!awb) return;
    try {
      await navigator.clipboard.writeText(awb);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  // ─── AWB Already Assigned ──────────────────────────────────────────────────
  if (awb) {
    return (
      <div className="space-y-6">
        <Alerts error={error} message={message} onClearError={() => setError(null)} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="p-6 rounded-[24px] bg-foreground/[0.03] border border-foreground/5 space-y-6">
            <div className="space-y-2">
              <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">Status</p>
              <StatusBadge status={status} />
            </div>
            <div className="space-y-2">
              <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">AWB Number</p>
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-foreground/5 border border-foreground/10">
                <span className="font-mono text-xs font-bold text-foreground select-all">{awb}</span>
                <button
                  onClick={handleCopy}
                  className="p-1 rounded hover:bg-foreground/10 transition-colors text-foreground/40 hover:text-foreground"
                  title="Copy AWB"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            {pickupDone && (
              <p className="text-[11px] text-emerald-400/90 font-medium">
                Pickup has been requested in Shiprocket.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 justify-center">
            <a
              href={`/api/logistics/label?order_id=${order.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 py-4 bg-foreground text-background rounded-[20px] text-[11px] font-bold uppercase tracking-widest hover:opacity-90 transition-all group"
            >
              <Printer className="w-4 h-4" />
              Download Shipping Label
            </a>
            <a
              href={`/api/logistics/invoice?order_id=${order.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 py-4 bg-foreground/5 hover:bg-foreground hover:text-background border border-foreground/10 rounded-[20px] text-[11px] font-bold uppercase tracking-widest transition-all group"
            >
              <FileText className="w-4 h-4 text-foreground/40 group-hover:text-background transition-colors" />
              Download Invoice
            </a>
            {!pickupDone && (
              <div className="space-y-2">
                <button
                  onClick={handlePickup}
                  disabled={blocked || loading !== null}
                  className="w-full flex items-center justify-center gap-3 py-4 bg-foreground/5 hover:bg-foreground hover:text-background border border-foreground/10 rounded-[20px] text-[11px] font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                >
                  {loading === 'pickup' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                  Generate Pickup
                </button>
                <p className="text-[11px] text-foreground/40 px-1 leading-relaxed">
                  AWB only reserves the waybill. Click this when the parcel is packed so the courier schedules a warehouse pickup.
                </p>
              </div>
            )}
            <button
              onClick={handleSync}
              disabled={loading !== null}
              className="flex items-center justify-center gap-3 py-4 bg-foreground/5 hover:bg-foreground hover:text-background border border-foreground/10 rounded-[20px] text-[11px] font-bold uppercase tracking-widest transition-all disabled:opacity-50"
            >
              {loading === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
              Sync Status from Shiprocket
            </button>
            {trackingUrl && (
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 py-4 bg-foreground/5 hover:bg-foreground hover:text-background border border-foreground/10 rounded-[20px] text-[11px] font-bold uppercase tracking-widest transition-all group"
              >
                <ExternalLink className="w-4 h-4 text-foreground/40 group-hover:text-background transition-colors" />
                Track Shipment
              </a>
            )}
            <button
              onClick={handleCancel}
              disabled={loading !== null}
              className="flex items-center justify-center gap-2.5 py-4 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-[20px] text-[11px] font-bold uppercase tracking-widest text-rose-500 transition-all disabled:opacity-50 active:scale-95"
            >
              {loading === 'cancel' && <Loader2 className="w-4 h-4 animate-spin" />}
              Cancel Shipment
            </button>
          </div>
        </div>

        {/* Custom Confirmation Modal */}
        <AnimatePresence>
          {showCancelModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => loading !== 'cancel' && setShowCancelModal(false)}
                className="absolute inset-0 bg-background/80 backdrop-blur-md"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                className="relative w-full max-w-md p-8 md:p-10 rounded-[36px] bg-[#0C0C0C]/95 border border-foreground/10 shadow-2xl space-y-6 text-left z-10"
              >
                <div className="flex items-center gap-4 text-rose-500">
                  <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold uppercase tracking-tight text-foreground leading-none">
                      Cancel Shipment
                    </h3>
                    <p className="text-[10px] text-rose-500/70 uppercase tracking-[0.2em] mt-1.5 font-bold">
                      Shiprocket Logistics Hub
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-[13px] text-foreground/80 leading-relaxed font-medium">
                    Are you sure you want to cancel the shipment for AWB{' '}
                    <strong className="text-foreground font-mono bg-foreground/5 px-2 py-0.5 rounded border border-foreground/10">
                      {awb || trackingNumber}
                    </strong>
                    ?
                  </p>
                  <div className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/10 space-y-2 text-[11px] text-rose-400/90 font-medium">
                    <p>• The AWB will be immediately voided in Shiprocket.</p>
                    <p>• Charged freight balance will be refunded to your Shiprocket wallet.</p>
                    <p>• This action is available until courier physically picks up the package.</p>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCancelModal(false)}
                    disabled={loading === 'cancel'}
                    className="flex-1 py-4 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 text-foreground/60 hover:text-foreground text-[10px] font-bold uppercase tracking-widest rounded-2xl transition-all disabled:opacity-50"
                  >
                    Keep Shipment
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmCancel}
                    disabled={loading === 'cancel'}
                    className="flex-1 py-4 bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-rose-500/20 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
                  >
                    {loading === 'cancel' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Cancelling...
                      </>
                    ) : (
                      'Confirm Cancel'
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ─── No AWB Yet: Manual Booking Flow ──────────────────────────────────────

  return (
    <div className="space-y-6">
      <Alerts error={error} message={message} onClearError={() => setError(null)} />

      {trackingNumber && !awb && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-1">
          <p className="text-[11px] font-bold text-amber-400 uppercase tracking-widest">
            Shiprocket shipment {trackingNumber} — AWB pending
          </p>
          <p className="text-[12px] text-foreground/60">
            Order already exists in Shiprocket. Re-enter dimensions, pick a courier that fits the weight
            (avoid Surface 5kg if the parcel is heavier), and book again to resume AWB assign — do not
            use the old Delhivery panel.
          </p>
        </div>
      )}

      {/* Step 1: Dimensions Form */}
      <div className="border border-dashed border-foreground/10 rounded-[32px] p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Weight className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-foreground/20 uppercase tracking-[0.2em]">
              Step 1 — Parcel Dimensions
            </p>
            <p className="text-[13px] text-foreground/60">
              Enter the actual parcel weight and box dimensions
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Weight (kg)', value: weight, onChange: setWeight, placeholder: '0.5' },
            { label: 'Length (cm)', value: length, onChange: setLength, placeholder: '20' },
            { label: 'Breadth (cm)', value: breadth, onChange: setBreadth, placeholder: '15' },
            { label: 'Height (cm)', value: height, onChange: setHeight, placeholder: '10' },
          ].map(({ label, value, onChange, placeholder }) => (
            <div key={label} className="space-y-2">
              <p className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest">{label}</p>
              <input
                type="number"
                min="0"
                step="0.01"
                value={value}
                onChange={(e) => { onChange(e.target.value); setStep('idle'); setCouriers([]); }}
                placeholder={placeholder}
                className="w-full h-12 px-4 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-sm font-mono focus:outline-none focus:border-indigo-500/40 focus:bg-foreground/[0.07] transition-all"
              />
            </div>
          ))}
        </div>

        <button
          onClick={handleFetchCouriers}
          disabled={!dimensionsValid || blocked || loading !== null}
          className="w-full flex items-center justify-center gap-3 py-4 bg-indigo-500 text-white rounded-[20px] text-[11px] font-bold uppercase tracking-[0.25em] hover:bg-indigo-400 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading === 'couriers' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
          {loading === 'couriers' ? 'Fetching couriers...' : 'Check Available Couriers'}
        </button>
      </div>

      {/* Step 2: Courier Selection */}
      <AnimatePresence>
        {step === 'couriers' && couriers.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <ChevronRight className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-foreground/20 uppercase tracking-[0.2em]">
                  Step 2 — Select Courier
                </p>
                <p className="text-[13px] text-foreground/60">
                  {couriers.length} courier{couriers.length !== 1 ? 's' : ''} available — choose the one you want
                </p>
              </div>
            </div>

            <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1">
              {couriers.map((c) => {
                const isRecommended = c.courier_company_id === recommendedId;
                const isSelected = c.courier_company_id === selectedCourierId;
                return (
                  <button
                    key={c.courier_company_id}
                    onClick={() => setSelectedCourierId(c.courier_company_id)}
                    className={`w-full text-left p-5 rounded-2xl border transition-all ${
                      isSelected
                        ? 'border-indigo-500/40 bg-indigo-500/10'
                        : 'border-foreground/10 bg-foreground/[0.02] hover:bg-foreground/[0.04] hover:border-foreground/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-foreground">{c.courier_name}</p>
                          {isRecommended && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/20 text-[9px] font-bold text-amber-400 uppercase tracking-widest">
                              <Star className="w-2.5 h-2.5" />
                              Recommended
                            </span>
                          )}
                          {c.cod && (
                            <span className="px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-[9px] font-bold text-blue-400 uppercase tracking-widest">
                              COD
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          {c.estimated_delivery_days != null && (
                            <div className="flex items-center gap-1 text-[11px] text-foreground/50">
                              <Clock className="w-3 h-3" />
                              {c.estimated_delivery_days === 1
                                ? '1 day'
                                : `${c.estimated_delivery_days} days`}
                            </div>
                          )}
                          <div className="flex items-center gap-1 text-[11px] text-foreground/50">
                            <Package className="w-3 h-3" />
                            {c.charge_weight}kg charged
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="flex items-center gap-0.5 justify-end">
                          <IndianRupee className="w-3.5 h-3.5 text-foreground font-bold" />
                          <span className="text-lg font-bold text-foreground">{c.rate}</span>
                        </div>
                        {c.cod_charges > 0 && (
                          <p className="text-[10px] text-foreground/40">+₹{c.cod_charges} COD</p>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="mt-3 pt-3 border-t border-indigo-500/20">
                        <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest">
                          ✓ Selected — scroll down to book
                        </p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Step 3: Book */}
            {selectedCourierId && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="pt-2"
              >
                <button
                  onClick={handleBookWithCourier}
                  disabled={blocked || loading !== null}
                  className="w-full flex items-center justify-center gap-3 py-5 bg-foreground text-background rounded-[20px] text-[11px] font-bold uppercase tracking-[0.25em] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                >
                  {loading === 'book' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ScanLine className="w-4 h-4" />
                  )}
                  {loading === 'book'
                    ? 'Booking shipment...'
                    : `Generate AWB — ${couriers.find(c => c.courier_company_id === selectedCourierId)?.courier_name}`
                  }
                </button>
              </motion.div>
            )}
          </motion.div>
        )}

        {step === 'couriers' && couriers.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 text-center space-y-3"
          >
            <p className="text-amber-400 text-[11px] font-bold uppercase tracking-widest">
              No couriers available for this pincode and weight combination.
            </p>
            {emptyReason && (
              <p className="text-foreground/60 text-xs font-mono bg-foreground/5 py-1 px-3 rounded-lg inline-block">
                {emptyReason}
              </p>
            )}
            <p className="text-foreground/40 text-xs">
              Try adjusting the dimensions or check Shiprocket dashboard directly.
            </p>
            <div>
              <button
                type="button"
                onClick={() => setStep('idle')}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold underline underline-offset-4"
              >
                Adjust Dimensions & Try Again
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Helper Components ─────────────────────────────────────────────────────

function Alerts({
  error,
  message,
  onClearError,
}: {
  error: string | null;
  message: string | null;
  onClearError: () => void;
}) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-3"
        >
          <p className="text-rose-500 text-[11px] uppercase tracking-widest font-bold flex-1">{error}</p>
          <button onClick={onClearError} className="text-rose-500/40 hover:text-rose-500 text-xs">✕</button>
        </motion.div>
      )}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20"
        >
          <p className="text-emerald-400 text-[11px] uppercase tracking-widest font-bold">{message}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StatusBadge({ status }: { status: string }) {
  const norm = status.toLowerCase();
  let color = 'text-foreground/40';
  let bg = 'bg-foreground/5';
  let dot = 'bg-foreground/20';

  if (norm.includes('deliver') || norm.includes('success')) {
    color = 'text-emerald-500'; bg = 'bg-emerald-500/10'; dot = 'bg-emerald-500';
  } else if (norm.includes('pickup') || norm.includes('transit') || norm.includes('confirm')) {
    color = 'text-blue-500'; bg = 'bg-blue-500/10'; dot = 'bg-blue-500';
  } else if (norm.includes('pending') || norm.includes('new') || norm.includes('process')) {
    color = 'text-amber-500'; bg = 'bg-amber-500/10'; dot = 'bg-amber-500';
  } else if (norm.includes('cancel') || norm.includes('fail') || norm.includes('rto')) {
    color = 'text-rose-500'; bg = 'bg-rose-500/10'; dot = 'bg-rose-500';
  }

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border border-foreground/5 ${bg}`}>
      <div className={`w-1 h-1 rounded-full ${dot}`} />
      <span className={`text-[9px] font-bold uppercase tracking-widest ${color}`}>
        {status.replace(/_/g, ' ')}
      </span>
    </div>
  );
}
