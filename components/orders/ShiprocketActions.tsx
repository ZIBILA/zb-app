'use client';

import React, { useState } from 'react';
import {
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Zap,
  Truck,
  Package,
  ScanLine,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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

export default function ShiprocketActions({ order, onRefresh }: ShiprocketActionsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shipment = order.shipments?.[0];
  const awb = shipment?.awb || order.delhivery_awb || null;
  const trackingNumber = shipment?.trackingNumber || null;
  const status = shipment?.status || order.deliveryStatus || 'pending';
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

  const blocked =
    order.status === 'cancelled' || order.status === 'payment_failed';

  const run = async (key: string, fn: () => Promise<void>) => {
    setLoading(key);
    setError(null);
    setMessage(null);
    try {
      await fn();
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(null);
    }
  };

  const handleBook = () =>
    run('book', async () => {
      const res = await fetch('/api/logistics/create-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to book Shiprocket shipment');
      setMessage(data.awb ? `AWB ${data.awb} assigned` : 'Shipment booked');
    });

  const handleAssignAwb = () =>
    run('awb', async () => {
      const res = await fetch('/api/logistics/assign-awb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to assign AWB');
      setMessage(`AWB ${data.awb} assigned`);
    });

  const handlePickup = () =>
    run('pickup', async () => {
      const res = await fetch('/api/logistics/generate-pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to schedule pickup');
      setMessage(data.message || 'Pickup scheduled');
    });

  const handleSync = () =>
    run('sync', async () => {
      const res = await fetch('/api/logistics/sync-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to sync status');
      setMessage(data.message || `Status: ${data.shipmentStatus}`);
    });

  const handleCancel = () =>
    run('cancel', async () => {
      if (!awb && !trackingNumber) throw new Error('Nothing to cancel');
      if (!window.confirm('Cancel this Shiprocket shipment? Works until the courier has picked it up. Wallet may be refunded by Shiprocket.')) {
        return;
      }
      const res = await fetch('/api/admin/logistics/cancel-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ awb: awb || trackingNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to cancel');
      setMessage('Shipment cancelled — click Sync status if panel still looks stale');
    });

  const handleCopy = async () => {
    if (!awb) return;
    try {
      await navigator.clipboard.writeText(awb);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

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
            <p className="text-rose-500 text-[11px] uppercase tracking-widest font-bold flex-1">
              {error}
            </p>
            <button onClick={() => setError(null)} className="text-rose-500/40 hover:text-rose-500 text-xs">
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {message && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
          <p className="text-emerald-400 text-[11px] uppercase tracking-widest font-bold">{message}</p>
        </div>
      )}

      {!awb ? (
        <div className="flex flex-col items-center justify-center py-8 space-y-6 border border-dashed border-foreground/10 rounded-[32px]">
          <Truck className="w-10 h-10 text-foreground/5" />
          <div className="text-center space-y-2">
            <p className="text-[11px] font-bold text-foreground/20 uppercase tracking-[0.2em]">
              Shiprocket — awaiting AWB
            </p>
            <p className="text-[13px] text-foreground/40 max-w-sm mx-auto">
              {trackingNumber
                ? 'Order exists in Shiprocket but AWB is not assigned yet.'
                : 'No Shiprocket shipment yet. Book to create the order and assign AWB.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {!trackingNumber && (
              <button
                onClick={handleBook}
                disabled={blocked || loading !== null}
                className="flex items-center gap-3 px-8 py-4 bg-foreground text-background rounded-2xl text-[11px] font-bold uppercase tracking-[0.25em] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
              >
                {loading === 'book' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Book + Assign AWB
              </button>
            )}
            {trackingNumber && (
              <button
                onClick={handleAssignAwb}
                disabled={blocked || loading !== null}
                className="flex items-center gap-3 px-8 py-4 bg-foreground text-background rounded-2xl text-[11px] font-bold uppercase tracking-[0.25em] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
              >
                {loading === 'awb' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
                Assign AWB
              </button>
            )}
          </div>
        </div>
      ) : (
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
            {!pickupDone && (
              <button
                onClick={handlePickup}
                disabled={blocked || loading !== null}
                className="flex items-center justify-center gap-3 py-4 bg-foreground text-background rounded-[20px] text-[11px] font-bold uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50"
              >
                {loading === 'pickup' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                Generate Pickup
              </button>
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
              className="flex items-center justify-center gap-2.5 py-4 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-[20px] text-[11px] font-bold uppercase tracking-widest text-rose-500 transition-all disabled:opacity-50"
            >
              {loading === 'cancel' && <Loader2 className="w-4 h-4 animate-spin" />}
              Cancel Shipment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const norm = status.toLowerCase();
  let color = 'text-foreground/40';
  let bg = 'bg-foreground/5';
  let dot = 'bg-foreground/20';

  if (norm.includes('deliver') || norm.includes('success')) {
    color = 'text-emerald-500';
    bg = 'bg-emerald-500/10';
    dot = 'bg-emerald-500';
  } else if (norm.includes('pickup') || norm.includes('transit') || norm.includes('confirm')) {
    color = 'text-blue-500';
    bg = 'bg-blue-500/10';
    dot = 'bg-blue-500';
  } else if (norm.includes('pending') || norm.includes('new') || norm.includes('process')) {
    color = 'text-amber-500';
    bg = 'bg-amber-500/10';
    dot = 'bg-amber-500';
  } else if (norm.includes('cancel') || norm.includes('fail') || norm.includes('rto')) {
    color = 'text-rose-500';
    bg = 'bg-rose-500/10';
    dot = 'bg-rose-500';
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
