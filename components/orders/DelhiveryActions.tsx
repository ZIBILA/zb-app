'use client';

import React, { useState } from 'react';
import { Loader2, Copy, Check, ExternalLink, Printer, Trash2, Zap, Truck, Package, Scale, Ruler, ChevronDown, Box, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Order {
  id: string;
  shopifyOrderId: string;
  status: string;
  totalPrice: number;
  paymentMethod: string | null;
  delhivery_awb: string | null;
  tracking_status: string | null;
}

interface DelhiveryActionsProps {
  order: Order;
  onRefresh: () => void;
}

export default function DelhiveryActions({ order, onRefresh }: DelhiveryActionsProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPackageForm, setShowPackageForm] = useState(false);

  // Package details state
  const [weight, setWeight] = useState('500');
  const [length, setLength] = useState('30');
  const [width, setWidth] = useState('20');
  const [height, setHeight] = useState('5');
  const [shippingMode, setShippingMode] = useState<'Surface' | 'Express'>('Surface');

  const handleCreateShipment = async () => {
    // Validate inputs
    const w = Number(weight);
    const l = Number(length);
    const wd = Number(width);
    const h = Number(height);

    if (!w || w <= 0) {
      setError('Package weight must be greater than 0');
      return;
    }
    if (w > 30000) {
      setError('Package weight cannot exceed 30,000 grams (30 kg)');
      return;
    }
    if (!l || l <= 0 || !wd || wd <= 0 || !h || h <= 0) {
      setError('All dimensions must be greater than 0');
      return;
    }
    if (l > 150 || wd > 150 || h > 150) {
      setError('Dimensions cannot exceed 150 cm');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/delhivery/create-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          weight: w,
          shipment_length: l,
          shipment_width: wd,
          shipment_height: h,
          shipping_mode: shippingMode,
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create shipment');
      }
      setShowPackageForm(false);
      onRefresh();
    } catch (err: any) {
      console.error('[DelhiveryActions] Create Shipment Error:', err);
      setError(err.message || 'Fulfillment request failed');
    } finally {
      setLoading(false);
    }
  };

  const [showCancelModal, setShowCancelModal] = useState(false);

  const handleCancelShipment = () => {
    if (!order.delhivery_awb) return;
    setShowCancelModal(true);
  };

  const handleConfirmCancel = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/delhivery/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ awb: order.delhivery_awb })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to cancel shipment');
      }
      setShowCancelModal(false);
      onRefresh();
    } catch (err: any) {
      console.error('[DelhiveryActions] Cancel Shipment Error:', err);
      setError(err.message || 'Cancellation request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!order.delhivery_awb) return;
    try {
      await navigator.clipboard.writeText(order.delhivery_awb);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  };

  // Quick preset buttons for common package sizes
  const presets = [
    { label: 'Small (Shirt)', weight: '350', l: '25', w: '18', h: '3' },
    { label: 'Medium (Jersey)', weight: '500', l: '30', w: '20', h: '5' },
    { label: 'Large (Jacket)', weight: '800', l: '35', w: '25', h: '8' },
    { label: 'Bundle (2-3 items)', weight: '1200', l: '38', w: '28', h: '10' },
  ];

  return (
    <div className="space-y-6">
      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-3"
          >
            <div className="w-5 h-5 rounded-full bg-rose-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-rose-500 text-[10px] font-bold">!</span>
            </div>
            <div className="flex-1">
              <p className="text-rose-500 text-[11px] uppercase tracking-widest font-bold">
                {error}
              </p>
            </div>
            <button onClick={() => setError(null)} className="text-rose-500/40 hover:text-rose-500 transition-colors">
              <span className="text-xs">✕</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {!order.delhivery_awb ? (
        <div className="space-y-6">
          {/* No shipment state */}
          <AnimatePresence mode="wait">
            {!showPackageForm ? (
              <motion.div
                key="no-shipment"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="flex flex-col items-center justify-center py-8 space-y-6 border border-dashed border-foreground/10 rounded-[32px]"
              >
                <Truck className="w-10 h-10 text-foreground/5" />
                <div className="text-center space-y-2">
                  <p className="text-[11px] font-bold text-foreground/20 uppercase tracking-[0.2em]">Node Awaiting Shipment</p>
                  <p className="text-[13px] text-foreground/40 max-w-xs mx-auto">No active shipment record exists. Configure package details below.</p>
                </div>
                <button
                  onClick={() => {
                    setShowPackageForm(true);
                    setError(null);
                  }}
                  disabled={order.status === 'cancelled' || order.status === 'payment_failed'}
                  className="flex items-center gap-3 px-10 py-4 bg-foreground text-background rounded-2xl text-[11px] font-bold uppercase tracking-[0.3em] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                >
                  <Package className="w-4 h-4" />
                  Configure & Ship
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="package-form"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="space-y-8"
              >
                {/* Form Header */}
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h4 className="text-[14px] font-semibold text-foreground tracking-tight">Package Configuration</h4>
                    <p className="text-[10px] text-foreground/30 font-bold uppercase tracking-widest">Delhivery Shipment Parameters</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowPackageForm(false);
                      setError(null);
                    }}
                    className="px-4 py-1.5 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-[10px] font-bold uppercase tracking-widest text-foreground/40 hover:text-foreground transition-all"
                  >
                    Cancel
                  </button>
                </div>

                {/* Preset Buttons */}
                <div className="space-y-3">
                  <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">Quick Presets</p>
                  <div className="grid grid-cols-2 gap-2">
                    {presets.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => {
                          setWeight(preset.weight);
                          setLength(preset.l);
                          setWidth(preset.w);
                          setHeight(preset.h);
                        }}
                        className={`p-3 rounded-xl border text-left transition-all group hover:border-foreground/20 ${
                          weight === preset.weight && length === preset.l && width === preset.w && height === preset.h
                            ? 'bg-foreground/10 border-foreground/20'
                            : 'bg-foreground/[0.03] border-foreground/5'
                        }`}
                      >
                        <p className="text-[11px] font-semibold text-foreground/70 group-hover:text-foreground transition-colors">{preset.label}</p>
                        <p className="text-[9px] text-foreground/30 font-mono mt-1">{preset.weight}g · {preset.l}×{preset.w}×{preset.h} cm</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Package Weight */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Scale className="w-3.5 h-3.5 text-foreground/20" />
                    <label className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest">
                      Package Weight (grams)
                    </label>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      min="1"
                      max="30000"
                      placeholder="500"
                      className="w-full bg-foreground/[0.03] border border-foreground/10 rounded-2xl px-5 py-4 text-[15px] font-mono font-bold text-foreground placeholder:text-foreground/15 focus:outline-none focus:border-foreground/30 focus:bg-foreground/[0.05] transition-all"
                    />
                    <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-foreground/20 uppercase tracking-widest">gm</span>
                  </div>
                  <p className="text-[9px] text-foreground/20 font-medium px-1">Enter the actual weight of the packaged item in grams. Standard jersey: ~500g</p>
                </div>

                {/* Package Dimensions */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Ruler className="w-3.5 h-3.5 text-foreground/20" />
                    <label className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest">
                      Dimensions (centimeters)
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[8px] font-bold text-foreground/20 uppercase tracking-widest px-1">Length</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={length}
                          onChange={(e) => setLength(e.target.value)}
                          min="1"
                          max="150"
                          placeholder="30"
                          className="w-full bg-foreground/[0.03] border border-foreground/10 rounded-xl px-4 py-3.5 text-[14px] font-mono font-bold text-foreground placeholder:text-foreground/15 focus:outline-none focus:border-foreground/30 focus:bg-foreground/[0.05] transition-all"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold text-foreground/15">cm</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[8px] font-bold text-foreground/20 uppercase tracking-widest px-1">Width</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={width}
                          onChange={(e) => setWidth(e.target.value)}
                          min="1"
                          max="150"
                          placeholder="20"
                          className="w-full bg-foreground/[0.03] border border-foreground/10 rounded-xl px-4 py-3.5 text-[14px] font-mono font-bold text-foreground placeholder:text-foreground/15 focus:outline-none focus:border-foreground/30 focus:bg-foreground/[0.05] transition-all"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold text-foreground/15">cm</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[8px] font-bold text-foreground/20 uppercase tracking-widest px-1">Height</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={height}
                          onChange={(e) => setHeight(e.target.value)}
                          min="1"
                          max="150"
                          placeholder="5"
                          className="w-full bg-foreground/[0.03] border border-foreground/10 rounded-xl px-4 py-3.5 text-[14px] font-mono font-bold text-foreground placeholder:text-foreground/15 focus:outline-none focus:border-foreground/30 focus:bg-foreground/[0.05] transition-all"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold text-foreground/15">cm</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-[9px] text-foreground/20 font-medium px-1">Measure the outer dimensions of the packed package in centimeters.</p>
                </div>

                {/* Volumetric Weight Indicator */}
                {Number(length) > 0 && Number(width) > 0 && Number(height) > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10 space-y-2"
                  >
                    <p className="text-[9px] font-bold text-blue-400/60 uppercase tracking-widest">Volumetric Weight (Delhivery Formula)</p>
                    <div className="flex items-end gap-4">
                      <p className="text-[20px] font-mono font-bold text-blue-400">
                        {Math.round((Number(length) * Number(width) * Number(height)) / 5000 * 1000)} gm
                      </p>
                      <p className="text-[10px] text-blue-400/40 font-medium pb-1">
                        ({length} × {width} × {height}) ÷ 5000 × 1000
                      </p>
                    </div>
                    {Number(weight) < Math.round((Number(length) * Number(width) * Number(height)) / 5000 * 1000) && (
                      <p className="text-[9px] text-amber-400/80 font-bold uppercase tracking-wider mt-1">
                        ⚠ Volumetric weight exceeds actual weight — Delhivery will charge by volumetric weight
                      </p>
                    )}
                  </motion.div>
                )}

                {/* Shipping Mode */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Truck className="w-3.5 h-3.5 text-foreground/20" />
                    <label className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest">
                      Shipping Mode
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setShippingMode('Surface')}
                      className={`p-4 rounded-2xl border text-left transition-all ${
                        shippingMode === 'Surface'
                          ? 'bg-foreground/10 border-foreground/20'
                          : 'bg-foreground/[0.03] border-foreground/5 hover:border-foreground/15'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                          shippingMode === 'Surface' ? 'border-foreground' : 'border-foreground/20'
                        }`}>
                          {shippingMode === 'Surface' && <div className="w-1.5 h-1.5 rounded-full bg-foreground" />}
                        </div>
                        <span className="text-[12px] font-bold text-foreground/80">Surface</span>
                      </div>
                      <p className="text-[9px] text-foreground/30 mt-2 pl-5.5">Standard delivery (3-7 days)</p>
                    </button>
                    <button
                      onClick={() => setShippingMode('Express')}
                      className={`p-4 rounded-2xl border text-left transition-all ${
                        shippingMode === 'Express'
                          ? 'bg-foreground/10 border-foreground/20'
                          : 'bg-foreground/[0.03] border-foreground/5 hover:border-foreground/15'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                          shippingMode === 'Express' ? 'border-foreground' : 'border-foreground/20'
                        }`}>
                          {shippingMode === 'Express' && <div className="w-1.5 h-1.5 rounded-full bg-foreground" />}
                        </div>
                        <span className="text-[12px] font-bold text-foreground/80">Express</span>
                      </div>
                      <p className="text-[9px] text-foreground/30 mt-2 pl-5.5">Air priority delivery (1-3 days)</p>
                    </button>
                  </div>
                </div>

                {/* Summary Card */}
                <div className="p-5 rounded-2xl bg-foreground/[0.04] border border-foreground/8 space-y-3">
                  <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">Shipment Summary</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <div className="flex justify-between">
                      <span className="text-[10px] text-foreground/30">Weight</span>
                      <span className="text-[10px] font-mono font-bold text-foreground/60">{weight} gm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[10px] text-foreground/30">Mode</span>
                      <span className="text-[10px] font-bold text-foreground/60 uppercase">{shippingMode}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[10px] text-foreground/30">Dimensions</span>
                      <span className="text-[10px] font-mono font-bold text-foreground/60">{length} × {width} × {height} cm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[10px] text-foreground/30">Payment</span>
                      <span className="text-[10px] font-bold text-foreground/60 uppercase">{order.paymentMethod || 'Prepaid'}</span>
                    </div>
                  </div>
                </div>

                {/* Action Button */}
                <button
                  onClick={handleCreateShipment}
                  disabled={loading || order.status === 'cancelled' || order.status === 'payment_failed'}
                  className="w-full flex items-center justify-center gap-3 py-5 bg-foreground text-background rounded-2xl text-[12px] font-bold uppercase tracking-[0.3em] hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 shadow-2xl shadow-foreground/10"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5 fill-background" />}
                  Create Delhivery Shipment
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="p-6 rounded-[24px] bg-foreground/[0.03] border border-foreground/5 space-y-6">
            <div className="space-y-2">
              <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">Tracking Status</p>
              <StatusBadge status={order.tracking_status || 'manifested'} />
            </div>

            <div className="space-y-2">
              <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">AWB Number</p>
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-foreground/5 border border-foreground/10">
                <span className="font-mono text-xs font-bold text-foreground select-all">{order.delhivery_awb}</span>
                <button
                  onClick={handleCopy}
                  className="p-1 rounded hover:bg-foreground/10 transition-colors text-foreground/40 hover:text-foreground"
                  title="Copy to clipboard"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 justify-center">
            <a
              href={`/api/delhivery/label?awb=${order.delhivery_awb}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 py-4 bg-foreground/5 hover:bg-foreground hover:text-background border border-foreground/10 rounded-[20px] text-[11px] font-bold uppercase tracking-widest transition-all group"
            >
              <Printer className="w-4 h-4 text-foreground/40 group-hover:text-background transition-colors" />
              Print Label
            </a>

            <a
              href={`https://www.delhivery.com/track/package/${order.delhivery_awb}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 py-4 bg-foreground/5 hover:bg-foreground hover:text-background border border-foreground/10 rounded-[20px] text-[11px] font-bold uppercase tracking-widest transition-all group"
            >
              <ExternalLink className="w-4 h-4 text-foreground/40 group-hover:text-background transition-colors" />
              Track Shipment
            </a>

            <button
              onClick={handleCancelShipment}
              disabled={loading}
              className="flex items-center justify-center gap-2.5 py-4 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-[20px] text-[11px] font-bold uppercase tracking-widest text-rose-500 transition-all disabled:opacity-50 active:scale-95"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Cancel Shipment
            </button>
          </div>
        </div>
      )}

      {/* Custom Confirmation Modal */}
      <AnimatePresence>
        {showCancelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !loading && setShowCancelModal(false)}
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
                    Delhivery Direct Protocol
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-[13px] text-foreground/80 leading-relaxed font-medium">
                  Are you sure you want to cancel the shipment for AWB{' '}
                  <strong className="text-foreground font-mono bg-foreground/5 px-2 py-0.5 rounded border border-foreground/10">
                    {order.delhivery_awb}
                  </strong>
                  ?
                </p>
                <div className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/10 space-y-2 text-[11px] text-rose-400/90 font-medium">
                  <p>• The waybill will be immediately cancelled in Delhivery.</p>
                  <p>• Downstream pickup and routing requests will be terminated.</p>
                  <p>• This action is available until courier physically picks up the package.</p>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCancelModal(false)}
                  disabled={loading}
                  className="flex-1 py-4 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 text-foreground/60 hover:text-foreground text-[10px] font-bold uppercase tracking-widest rounded-2xl transition-all disabled:opacity-50"
                >
                  Keep Shipment
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancel}
                  disabled={loading}
                  className="flex-1 py-4 bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-rose-500/20 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
                >
                  {loading ? (
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

function StatusBadge({ status }: { status: string }) {
  const norm = status.toLowerCase();
  let color = "text-foreground/40";
  let bg = "bg-foreground/5";
  let dot = "bg-foreground/20";
  let label = status.replace('_', ' ');

  if (norm.includes('deliver') || norm.includes('paid') || norm.includes('success')) {
    color = "text-emerald-500";
    bg = "bg-emerald-500/10";
    dot = "bg-emerald-500";
  } else if (norm.includes('transit') || norm.includes('ship') || norm.includes('manifest')) {
    color = "text-blue-500";
    bg = "bg-blue-500/10";
    dot = "bg-blue-500";
  } else if (norm.includes('pending') || norm.includes('awaiting')) {
    color = "text-amber-500";
    bg = "bg-amber-500/10";
    dot = "bg-amber-500";
  } else if (norm.includes('cancel') || norm.includes('failed') || norm.includes('rto')) {
    color = "text-rose-500";
    bg = "bg-rose-500/10";
    dot = "bg-rose-500";
  }

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border border-foreground/5 ${bg}`}>
      <div className={`w-1 h-1 rounded-full ${dot}`} />
      <span className={`text-[9px] font-bold uppercase tracking-widest ${color}`}>
        {label}
      </span>
    </div>
  );
}
