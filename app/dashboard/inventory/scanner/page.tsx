"use client";

import { useEffect, useState, useRef, useCallback, type ChangeEvent } from "react";
import { useDeviceScanner } from "@/lib/hooks/useDeviceScanner";
import { useBarcodeCamera } from "@/lib/hooks/useBarcodeCamera";
import { 
  ScanLine, 
  RefreshCcw, 
  CheckCircle2, 
  AlertCircle,
  Package,
  Zap,
  Box,
  Truck,
  RotateCcw,
  ArrowRightLeft,
  XCircle,
  ClipboardList,
  Plus,
  Minus,
  Terminal,
  Usb,
  Camera,
  AlertOctagon,
  Trash2,
  Info,
  CircleDot
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function InventoryScannerPage() {
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(true);
  const [status, setStatus] = useState<'idle' | 'confirm' | 'success' | 'error' | 'syncing'>('idle');
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'STOCK_IN' | 'ORDER_OUT' | 'RETURN' | 'EXCHANGE' | 'RTO'>('STOCK_IN');
  const [recentScans, setRecentScans] = useState<any[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [lookupResult, setLookupResult] = useState<{ productName: string; sku?: string; barcode?: string; currentQty?: number } | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef(status);
  const scanningRef = useRef(isScanning);
  const fieldIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldBurstStartRef = useRef(0);
  const stopCameraRef = useRef<() => void>(() => {});
  const onScanSuccessRef = useRef<(code: string) => void>(() => {});

  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    scanningRef.current = isScanning;
  }, [isScanning]);

  const clearFieldIdleTimer = useCallback(() => {
    if (fieldIdleTimerRef.current) {
      clearTimeout(fieldIdleTimerRef.current);
      fieldIdleTimerRef.current = null;
    }
  }, []);

  const modes = [
    { id: 'STOCK_IN', label: 'Stock In', icon: Package, color: 'text-[#34C759]', bg: 'bg-[#34C759]/10' },
    { id: 'ORDER_OUT', label: 'Order Out', icon: Truck, color: 'text-[#007AFF]', bg: 'bg-[#007AFF]/10' },
    { id: 'RETURN', label: 'Return', icon: RotateCcw, color: 'text-[#FF9500]', bg: 'bg-[#FF9500]/10' },
    { id: 'EXCHANGE', label: 'Exchange', icon: ArrowRightLeft, color: 'text-[#AF52DE]', bg: 'bg-[#AF52DE]/10' },
    { id: 'RTO', label: 'RTO', icon: XCircle, color: 'text-[#FF3B30]', bg: 'bg-[#FF3B30]/10' },
  ];

  const onScanSuccess = useCallback(async (decodedText: string) => {
    if (statusRef.current !== "idle") return;
    clearFieldIdleTimer();
    stopCameraRef.current();

    setManualBarcode("");
    setScanResult(decodedText);
    setIsScanning(false);
    setQuantity(1);
    setStatus("syncing");
    setMessage("Identifying product…");

    try {
      const res = await fetch("/api/admin/inventory/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: decodedText, mode: "LOOKUP" }),
      });
      const data = await res.json();
      if (res.ok) {
        setLookupResult(data);
        setStatus("confirm");
        setMessage("");
      } else {
        throw new Error(data.error || "Product not found");
      }
    } catch (e: unknown) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Lookup failed");
    }
  }, [clearFieldIdleTimer]);

  onScanSuccessRef.current = (code: string) => {
    void onScanSuccess(code);
  };

  const camera = useBarcodeCamera(
    useCallback((raw: string) => {
      if (statusRef.current !== "idle" || !scanningRef.current) return;
      onScanSuccessRef.current(raw);
    }, [])
  );

  useEffect(() => {
    stopCameraRef.current = camera.stop;
  }, [camera.stop]);

  const onDeviceScan = useCallback(
    (code: string, _deviceId: string) => {
      void _deviceId;
      void onScanSuccess(code);
    },
    [onScanSuccess]
  );

  // Device connection & multiplexing hook
  const {
    devices,
    selectedDeviceId,
    selectDevice,
    isConnected,
    requestHIDDevice,
    requestSerialDevice,
    removeDevice,
    hidSupported,
    serialSupported,
    globalError,
    clearError,
  } = useDeviceScanner({
    onScan: onDeviceScan,
    minBarcodeLength: 1,
    keyboardDebounceMs: 100,
  });

  useEffect(() => {
    if (!isScanning || status !== 'idle') return;
    const id = requestAnimationFrame(() => {
      scanInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [isScanning, status]);

  const handleSync = async () => {
    if (!scanResult) return;
    const code = scanResult;
    setStatus('syncing');
    setMessage('Synchronizing with Core Matrix...');
    
    try {
      const res = await fetch('/api/admin/inventory/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, mode, quantity })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setStatus('success');
        setMessage(data.message || `Processed: ${data.productName || code}`);
        setRecentScans(prev => [{
          id: Date.now(),
          code,
          mode,
          sku: data.sku || lookupResult?.sku,
          productName: data.productName || lookupResult?.productName || 'Unknown',
          quantity,
          timestamp: new Date().toLocaleTimeString(),
          status: 'success'
        }, ...prev].slice(0, 8));
        
        try { new Audio('/success.mp3').play(); } catch(e){}
      } else {
        throw new Error(data.error || 'Sync Failed');
      }
    } catch (e: any) {
      setStatus('error');
      setMessage(e.message || 'Transmission Failed');
    }
  };

  const resetScanner = () => {
    stopCameraRef.current();
    clearFieldIdleTimer();
    setScanResult(null);
    setLookupResult(null);
    setStatus("idle");
    setMessage("");
    setQuantity(1);
    setIsScanning(true);
    setManualBarcode("");
  };

  const onManualScanFieldChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (v.length === 1) fieldBurstStartRef.current = Date.now();
      setManualBarcode(v);
      clearFieldIdleTimer();
      if (!v.trim()) return;
      fieldIdleTimerRef.current = setTimeout(() => {
        fieldIdleTimerRef.current = null;
        const el = scanInputRef.current;
        const t = (el?.value ?? v).trim();
        if (t.length < 1) return;
        if (statusRef.current !== "idle" || !scanningRef.current) return;
        if (Date.now() - fieldBurstStartRef.current > 4500) return;
        onScanSuccessRef.current(t);
      }, 140);
    },
    [clearFieldIdleTimer]
  );

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="pb-20 max-w-6xl mx-auto"
    >
      {/* Siri Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 lg:gap-6 mb-8 lg:mb-12 relative z-10">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl lg:text-3xl font-bold text-foreground uppercase tracking-tighter leading-none">
              Logistics Scanner
            </h1>
            <div className={`px-3 py-1 rounded-full border transition-all duration-500 ${isConnected ? 'bg-[#34C759]/10 border-[#34C759]/20 text-[#34C759]' : 'bg-amber-400/10 border-amber-400/20 text-amber-500'}`}>
              <span className="text-[9px] font-black uppercase tracking-widest leading-none">
                {isConnected ? 'Scanner Active' : 'Waiting...'}
              </span>
            </div>
          </div>
          <p className="text-[9px] lg:text-[10px] text-foreground/50 font-bold uppercase tracking-[0.3em] max-w-xl">
            Advanced inventory reconciliation and substrate tracking.
          </p>
        </div>

        {/* Mode Selector - Siri Tab Style */}
        <div className="bg-foreground/[0.04] dark:bg-foreground/5 p-1.5 rounded-2xl flex items-center gap-1.5 overflow-x-auto hide-scrollbar border border-foreground/[0.06] shadow-inner max-w-full backdrop-blur-xl">
          {modes.map((m) => {
            const Icon = m.icon;
            const isActive = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id as any)}
                className={`relative flex items-center gap-2.5 px-5 py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all whitespace-nowrap z-10 overflow-hidden ${
                  isActive 
                    ? 'text-white dark:text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.08)]' 
                    : 'text-foreground/50 hover:text-foreground/80 hover:bg-background/5 dark:hover:bg-foreground/10'
                }`}
              >
                {isActive && (
                   <motion.div 
                     layoutId="activeMode"
                     className="absolute inset-0 bg-neutral-900 dark:bg-[#2C2C2E] rounded-xl -z-10"
                     transition={{ type: "spring", stiffness: 300, damping: 30 }}
                   />
                )}
                <div className={`w-6 h-6 rounded-md flex items-center justify-center ${isActive ? m.bg : 'bg-transparent'}`}>
                  <Icon className={`w-3.5 h-3.5 ${isActive ? m.color : 'text-inherit opacity-60'}`} strokeWidth={2.5} />
                </div>
                <span className="relative z-10">{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Global Error Banner ────────────────────────────────────────────── */}
      <AnimatePresence>
        {globalError && (
          <motion.div 
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 32 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-start gap-4 p-4 lg:p-6 bg-rose-500/[0.05] border border-rose-500/20 shadow-[0_8px_32px_rgba(225,29,72,0.1)] rounded-[1.5rem] relative">
               <div className="w-10 h-10 rounded-2xl bg-rose-500/10 flex items-center justify-center flex-shrink-0">
                  <AlertOctagon className="w-5 h-5 text-rose-500" />
               </div>
               <div className="flex-1 pr-8">
                  <h3 className="text-[12px] font-black uppercase text-rose-500 tracking-[0.2em] mb-1.5 flex items-center gap-2">
                     Connection Terminated <span className="px-2 py-0.5 rounded bg-rose-500/10 text-[9px]">{globalError.code}</span>
                  </h3>
                  <p className="text-[11px] font-bold text-rose-500/80 leading-relaxed mb-3">{globalError.message}</p>
                  
                  {globalError.code === 'ERR_DEVICE_LOCKED' && (
                     <div className="p-3 bg-rose-500/[0.03] border border-rose-500/10 rounded-xl">
                        <p className="text-[10px] font-bold text-rose-500/70">
                           <strong className="text-rose-500">Hint:</strong> If your physical scanner is set to "Keyboard Wedge" mode, you do not need to click Add USB. Just select the standard Keyboard source in the Hardware link panel and scan normally.
                        </p>
                     </div>
                  )}
               </div>
               <button onClick={clearError} className="absolute top-4 right-4 p-2 rounded-xl text-rose-500/50 hover:bg-rose-500/10 hover:text-rose-500 transition-colors">
                  <XCircle className="w-5 h-5" />
               </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid lg:grid-cols-5 gap-8">
        {/* Scanner Substrate */}
        <div className="lg:col-span-3 relative group">
          <div className="bg-foreground/[0.015] dark:bg-foreground/[0.02] backdrop-blur-[60px] saturate-[200%] border border-foreground/[0.08] rounded-[2rem] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.04)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.2)] p-6 h-full relative">
            <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-transparent dark:from-white/5 pointer-events-none z-0" />
            
            <div className={`relative z-10 w-full h-[400px] md:h-full min-h-[400px] rounded-[1.5rem] overflow-hidden border border-foreground/[0.05] bg-foreground/[0.02] dark:bg-background/20 ${isScanning ? 'shadow-inner' : ''}`}>
               {isScanning && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-transparent">
                     <div className="w-64 h-64 border-2 border-[#007AFF]/25 rounded-[2.5rem] flex flex-col items-center justify-center bg-foreground/[0.03] dark:bg-background/25 backdrop-blur-md relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-t from-[#007AFF]/10 to-transparent"></div>
                        <Terminal className="w-16 h-16 text-[#007AFF]/40 mb-4 animate-pulse" strokeWidth={1.5} />
                        <div className="relative z-10 text-center px-6">
                           <p className="text-[12px] font-black text-foreground uppercase tracking-[0.2em] mb-2 leading-none">Ready to Scan</p>
                           <p className="text-[8px] font-bold text-foreground/40 uppercase tracking-[0.1em] leading-tight">USB Optical Interface Active</p>
                        </div>
                        
                        {/* Scanning beam animation */}
                        <div className="absolute top-0 left-0 w-full h-0.5 bg-[#007AFF] animate-[scan_3s_ease-in-out_infinite] shadow-[0_0_15px_#007AFF]"></div>
                     </div>
                      <p className="mt-8 text-[10px] font-black text-foreground/35 uppercase tracking-[0.5em]">Waiting for transmission</p>

                      {/* Manual Entry */}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const code = manualBarcode.trim();
                          if (code.length >= 1) {
                            void onScanSuccess(code);
                            setManualBarcode("");
                          }
                        }}
                        className="mt-6 w-full max-w-sm mx-auto flex gap-2 px-4"
                      >
                        <input
                          ref={scanInputRef}
                          type="text"
                          value={manualBarcode}
                          onChange={onManualScanFieldChange}
                          placeholder="Aim scanner here — barcode or QR text"
                          data-scanner-input="true"
                          autoComplete="off"
                          spellCheck={false}
                          className="flex-1 bg-foreground/[0.03] border border-foreground/[0.08] rounded-xl px-4 py-3 text-sm font-mono text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 transition-shadow"
                        />
                        <button
                          type="submit"
                          disabled={manualBarcode.trim().length < 1}
                          className="px-5 py-3 bg-[#007AFF] hover:bg-[#0062CC] text-foreground text-[11px] font-black uppercase tracking-widest rounded-xl transition-colors shadow-lg shadow-[#007AFF]/20 disabled:opacity-40"
                        >
                          Submit
                        </button>
                      </form>

                      <div className="mt-5 w-full max-w-md mx-auto px-4 space-y-2">
                        {camera.supported ? (
                          <>
                            {camera.error && (
                              <p className="text-[10px] font-bold text-amber-500 text-center">{camera.error}</p>
                            )}
                            {!camera.active ? (
                              <button
                                type="button"
                                onClick={() => void camera.start()}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] text-foreground text-[10px] font-black uppercase tracking-widest hover:bg-foreground/[0.06] transition-colors"
                              >
                                <Camera className="w-4 h-4 opacity-80" />
                                Use device camera (QR &amp; barcode)
                              </button>
                            ) : (
                              <div className="space-y-2">
                                <video
                                  ref={camera.videoRef}
                                  className="w-full max-h-52 rounded-xl border border-foreground/10 bg-background object-cover"
                                  playsInline
                                  muted
                                />
                                <button
                                  type="button"
                                  onClick={() => camera.stop()}
                                  className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-foreground/75 hover:bg-foreground/[0.06] border border-foreground/[0.08]"
                                >
                                  Stop camera
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-[9px] font-bold text-foreground/35 text-center uppercase tracking-widest leading-relaxed">
                            Camera decode needs Chrome or Edge over HTTPS. USB scanners work in any browser.
                          </p>
                        )}
                      </div>
                   </div>
               )}

              {!isScanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-2xl z-20 p-8 text-center animate-in fade-in zoom-in-95 duration-300">
                  {status === 'confirm' ? (
                    <>
                      <div className="w-20 h-20 rounded-[2rem] flex items-center justify-center mb-6 shadow-2xl bg-[#007AFF]/10 text-[#007AFF] shadow-[#007AFF]/25">
                         <ScanLine className="w-10 h-10" strokeWidth={2} />
                      </div>
                      <h3 className="text-[14px] font-black uppercase tracking-[0.2em] mb-2 text-neutral-800 dark:text-neutral-200">Verify submission</h3>

                      {scanResult && (
                        <div className="mb-5 w-full max-w-md mx-auto rounded-2xl border border-[#007AFF]/25 bg-[#007AFF]/5 px-4 py-3 text-center">
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#007AFF]/80 block mb-1.5">
                            Scanned code
                          </span>
                          <p className="text-[13px] font-mono font-bold text-foreground break-all leading-snug">
                            {scanResult}
                          </p>
                        </div>
                      )}
                      
                      <div className="mb-6 space-y-1">
                        <p className="text-[14px] font-black text-foreground uppercase tracking-tight">
                          {lookupResult?.productName || 'Unknown Item'}
                        </p>
                        <p className="text-[10px] font-bold text-foreground/50 uppercase tracking-[0.2em]">
                          SKU: {lookupResult?.sku || 'N/A'}
                        </p>
                        {lookupResult?.currentQty !== undefined && (
                          <p className="text-[10px] font-black text-[#007AFF] uppercase tracking-widest mt-2">
                            Current Stock: {lookupResult.currentQty}
                          </p>
                        )}
                      </div>
                      
                      {/* Quantity Selector */}
                      <div className="flex items-center gap-4 mb-8 bg-foreground/[0.03] dark:bg-foreground/5 p-2 rounded-[1.5rem] border border-foreground/[0.05] shadow-inner">
                        <button 
                          onClick={() => setQuantity(Math.max(1, quantity - 1))} 
                          className="w-12 h-12 rounded-xl bg-neutral-900 text-white dark:bg-[#2C2C2E] dark:text-foreground flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-md"
                        >
                          <Minus className="w-5 h-5" strokeWidth={2.5} />
                        </button>
                        <div className="w-16 flex flex-col items-center justify-center">
                          <span className="text-2xl font-black text-foreground tracking-tighter leading-none">{quantity}</span>
                          <span className="text-[8px] font-black text-foreground/40 uppercase tracking-widest mt-1">Units</span>
                        </div>
                        <button 
                          onClick={() => setQuantity(quantity + 1)} 
                          className="w-12 h-12 rounded-xl bg-neutral-900 text-white dark:bg-[#2C2C2E] dark:text-foreground flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-md"
                        >
                          <Plus className="w-5 h-5" strokeWidth={2.5} />
                        </button>
                      </div>

                      <div className="flex gap-3">
                        <button 
                          onClick={resetScanner} 
                          className="px-6 py-4 rounded-2xl text-[12px] font-bold uppercase tracking-[0.1em] text-foreground/60 hover:bg-foreground/[0.03] hover:text-foreground transition-colors"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={handleSync} 
                          className="inline-flex items-center gap-2 px-8 py-4 bg-[#34C759] text-foreground rounded-2xl text-[12px] font-bold uppercase tracking-[0.15em] hover:scale-105 active:scale-95 transition-all shadow-lg shadow-[#34C759]/20"
                        >
                          <Zap className="w-4 h-4" strokeWidth={2.5} />
                          Confirm
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center mb-6 shadow-2xl ${
                         status === 'success' ? 'bg-[#34C759]/10 text-[#34C759] shadow-[#34C759]/20' : 
                         status === 'error' ? 'bg-[#FF3B30]/10 text-[#FF3B30] shadow-[#FF3B30]/20' : 
                         'bg-[#007AFF]/10 text-[#007AFF] shadow-[#007AFF]/20 animate-pulse'
                      }`}>
                         <Zap className="w-10 h-10" strokeWidth={2} />
                      </div>
                      <h3 className="text-[14px] font-black uppercase tracking-[0.2em] mb-2 text-foreground">
                        {status === 'success' ? 'Terminal State Achieved' : status === 'error' ? 'Transmission Failed' : 'Signal Decoded'}
                      </h3>
                      <p className="text-[12px] font-bold text-foreground/75 mb-8 whitespace-pre-wrap max-w-[80%] mx-auto flex flex-col items-center">
                        <span className="text-[10px] uppercase tracking-widest opacity-60 mb-2 block">{scanResult}</span>
                        {message}
                      </p>
                      
                      {status !== 'syncing' && (
                        <button 
                          onClick={resetScanner}
                          className="inline-flex items-center gap-3 px-8 py-4 bg-foreground text-background rounded-2xl text-[12px] font-bold uppercase tracking-[0.15em] hover:scale-105 active:scale-95 transition-all shadow-md"
                        >
                          <RefreshCcw className="w-4 h-4" strokeWidth={2} />
                          Restart Link
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

         {/* Transmission Logistics */}
        <div className="lg:col-span-2 space-y-6 flex flex-col">
          
          {/* HARDWARE LINK MODULE */}
          <div className="bg-foreground/[0.015] dark:bg-foreground/[0.02] backdrop-blur-[60px] saturate-[200%] border border-foreground/[0.08] rounded-[2rem] p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.2)] relative overflow-hidden flex-shrink-0">
            <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-transparent dark:from-white/5 pointer-events-none z-0" />
            <div className="relative z-10">
               <div className="flex items-center justify-between mb-5">
                  <h2 className="text-[11px] font-black uppercase tracking-[0.25em] text-foreground/50 flex items-center gap-2">
                     <Usb className="w-4 h-4 text-[#34C759]" strokeWidth={2.5} /> Hardware Link
                  </h2>
                  <div className="flex items-center gap-1.5">
                     {hidSupported && (
                        <button onClick={requestHIDDevice} className="px-3 py-1.5 bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.08] rounded-xl text-[9px] font-black tracking-widest uppercase transition-all flex items-center gap-1.5">
                           <Plus className="w-3 h-3" /> USB
                        </button>
                     )}
                     {serialSupported && (
                        <button onClick={requestSerialDevice} className="px-3 py-1.5 bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.08] rounded-xl text-[9px] font-black tracking-widest uppercase transition-all flex items-center gap-1.5">
                           <Plus className="w-3 h-3" /> COM
                        </button>
                     )}
                  </div>
               </div>

               <div className="space-y-2 mb-4">
                  {devices.map(device => {
                     const isSelected = selectedDeviceId === device.id;
                     const timeSince = device.lastActivity ? Math.round((Date.now() - device.lastActivity) / 1000) : null;
                     const isError = !!device.error;

                     return (
                        <div 
                           key={device.id} 
                           onClick={() => selectDevice(device.id)}
                           className={`group flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${
                              isSelected ? 'bg-foreground/[0.03] border-foreground/[0.12] dark:bg-foreground/10 dark:border-foreground/20 shadow-inner' : 'bg-foreground/[0.01] border-foreground/[0.04] hover:bg-foreground/[0.03]'
                           } ${isError ? '!bg-rose-500/[0.05] !border-rose-500/20' : ''}`}
                        >
                           <div className="flex items-center gap-3">
                              <div className="relative flex h-2 w-2 flex-shrink-0">
                                 {device.connected ? (
                                    <>
                                       <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#34C759] opacity-75" />
                                       <span className="relative inline-flex rounded-full h-2 w-2 bg-[#34C759]" />
                                    </>
                                 ) : (
                                    <span className={`h-2 w-2 rounded-full flex-shrink-0 ${isError ? 'bg-rose-500' : 'bg-foreground/20'}`} />
                                 )}
                              </div>
                              <div className="flex flex-col">
                                 <span className={`text-[10px] font-black uppercase tracking-widest ${isError ? 'text-rose-500' : isSelected ? 'text-foreground' : 'text-foreground/60'}`}>{device.name}</span>
                                 <span className={`text-[8px] font-bold uppercase tracking-[0.2em] mt-0.5 ${isError ? 'text-rose-500/70' : 'text-foreground/35'}`}>
                                    {isError ? 'Connection Error' : device.connected ? (timeSince !== null && timeSince < 10 ? 'ACTIVE NOW' : 'LINK ESTABLISHED') : 'STANDBY OR UNAVAILABLE'}
                                 </span>
                              </div>
                           </div>
                           <div className="flex items-center gap-2">
                              {device.type !== 'keyboard' && (
                                 <button onClick={(e) => { e.stopPropagation(); removeDevice(device.id); }} className="p-1.5 opacity-0 group-hover:opacity-100 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all">
                                    <Trash2 className="w-3.5 h-3.5" />
                                 </button>
                              )}
                              <CircleDot className={`w-3.5 h-3.5 ${isSelected ? 'text-[#34C759]' : 'text-transparent'}`} />
                           </div>
                        </div>
                     )
                  })}
               </div>

               {/* Help Toggle */}
               <button onClick={() => setShowHelp(!showHelp)} className="w-full flex items-center justify-center gap-1.5 py-2 hover:bg-foreground/[0.03] rounded-xl transition-colors">
                  <Info className="w-3 h-3 text-foreground/30" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-foreground/35">Hardware Linking Guide</span>
               </button>

               <AnimatePresence>
                  {showHelp && (
                     <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="pt-4 space-y-3">
                           <div className="p-3 bg-foreground/[0.02] rounded-xl border border-foreground/[0.05]">
                              <h4 className="text-[9.5px] font-black uppercase tracking-widest mb-1 text-foreground/75">Standard Scanner (Keyboard Mode)</h4>
                              <p className="text-[10px] text-foreground/60 leading-relaxed font-medium">Most USB and Bluetooth scanners type into the page like a keyboard. Keep the cursor in the scan box (it focuses automatically). You can highlight any row in Hardware Link — keyboard scans still work. Only use Add USB/COM if your device manual says to use serial or raw HID.</p>
                           </div>
                           <div className="p-3 bg-[#007AFF]/5 rounded-xl border border-[#007AFF]/20">
                              <h4 className="text-[9.5px] font-black uppercase tracking-widest mb-1 text-[#007AFF]">Advanced Scanners (Web HID/COM)</h4>
                              <p className="text-[10px] text-[#007AFF]/70 leading-relaxed font-medium">If your scanner requires pure optical data transmission without keyboard emulation, click "Add USB" or "Add COM" to pair the browser directly with the hardware interface.</p>
                           </div>
                        </div>
                     </motion.div>
                  )}
               </AnimatePresence>
            </div>
          </div>

          <div className="bg-foreground/[0.015] dark:bg-foreground/[0.02] backdrop-blur-[60px] saturate-[200%] border border-foreground/[0.08] rounded-[2rem] p-8 shadow-[0_8px_32px_rgba(0,0,0,0.04)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.2)] relative overflow-hidden flex-1 flex flex-col min-h-[400px]">
            <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-transparent dark:from-white/5 pointer-events-none z-0" />
            
            <div className="relative z-10 flex flex-col h-full">
               <h2 className="text-[11px] font-black uppercase tracking-[0.25em] text-foreground/50 mb-6 flex items-center gap-2">
                  <ActivityLine /> Activity Feed
               </h2>
               
               {/* Status Module */}
               <AnimatePresence mode="wait">
                 <motion.div 
                   key={status + mode}
                   initial={{ opacity: 0, scale: 0.95 }}
                   animate={{ opacity: 1, scale: 1 }}
                   exit={{ opacity: 0, scale: 0.95 }}
                   className={`p-6 rounded-[1.5rem] flex items-start gap-5 border shadow-inner mb-8 ${
                     status === 'success' ? 'bg-[#34C759]/5 text-[#34C759] border-[#34C759]/20' :
                     status === 'error' ? 'bg-[#FF3B30]/5 text-[#FF3B30] border-[#FF3B30]/20' :
                     status === 'syncing' ? 'bg-[#007AFF]/5 text-[#007AFF] border-[#007AFF]/20' :
                     'bg-foreground/[0.02] dark:bg-foreground/5 text-foreground border-foreground/[0.06]'
                   }`}
                 >
                   <div className={`p-3 rounded-xl flex items-center justify-center ${
                          status === 'success' ? 'bg-[#34C759]/10' :
                          status === 'error' ? 'bg-[#FF3B30]/10' :
                          status === 'syncing' ? 'bg-[#007AFF]/10' :
                          'bg-foreground/[0.05]'
                   }`}>
                     {status === 'success' ? <CheckCircle2 className="w-6 h-6" strokeWidth={2.5} /> :
                      status === 'error' ? <AlertCircle className="w-6 h-6" strokeWidth={2.5} /> :
                      status === 'syncing' ? <RefreshCcw className="w-6 h-6 animate-spin" strokeWidth={2.5} /> :
                      <ScanLine className="w-6 h-6 opacity-60" strokeWidth={2.5} />}
                   </div>
                   
                   <div className="flex-1">
                     <div className="flex items-center justify-between mb-2">
                       <p className="text-[13px] font-black tracking-tight uppercase leading-none">
                         {status === 'idle' ? 'Standby' : status === 'syncing' ? 'Syncing Matrix' : status.toUpperCase()}
                       </p>
                       <span className="text-[9px] font-bold opacity-60 uppercase tracking-widest leading-none bg-background/15 dark:bg-foreground/10 px-2.5 py-1 rounded-md">{mode.replace('_', ' ')}</span>
                     </div>
                     <p className="text-[12px] font-bold opacity-90 mb-3">{status === 'idle' ? `Awaiting ${mode.toLowerCase().replace('_', ' ')} signal` : message}</p>
                     <p className="text-[10px] font-medium opacity-65 uppercase tracking-wide leading-relaxed">
                       {status === 'idle' ? 'Align optical link with target matrix QR cluster.' : 
                         status === 'syncing' ? 'Injecting transaction into the distributed ledger...' :
                         status === 'success' ? 'Terminal state achieved. Valid block captured.' : 'Signal failure detected in transmission.'}
                     </p>
                   </div>
                 </motion.div>
               </AnimatePresence>

               {/* Recent Transactions List */}
                <div className="flex-1 overflow-y-auto pr-2 -mr-2 hide-scrollbar">
                  <div className="space-y-3">
                     <AnimatePresence initial={false}>
                       {recentScans.length > 0 ? recentScans.map((s) => (
                         <motion.div
                           key={s.id}
                           initial={{ opacity: 0, x: -20 }}
                           animate={{ opacity: 1, x: 0 }}
                           className="bg-foreground/[0.015] dark:bg-foreground/[0.02] p-4 rounded-2xl border border-foreground/[0.04] flex items-center justify-between group hover:bg-foreground/[0.03] transition-colors"
                         >
                           <div className="flex items-center gap-4 hidden sm:flex">
                              <div className="w-10 h-10 rounded-xl bg-foreground/[0.03] dark:bg-foreground/15 border border-foreground/[0.05] flex items-center justify-center shadow-inner">
                                 {(() => {
                                    const m = modes.find(mod => mod.id === s.mode);
                                    const Icon = m?.icon || Box;
                                    return <Icon className={`w-4 h-4 ${m?.color || 'text-foreground/80'}`} strokeWidth={2} />;
                                 })()}
                              </div>
                              <div>
                                 <p className="text-[12px] font-bold text-foreground capitalize tracking-tight leading-none mb-2 line-clamp-1">{s.productName}</p>
                                 <div className="flex items-center gap-2">
                                   {s.sku && <span className="text-[9px] font-black text-[#007AFF] uppercase tracking-widest">{s.sku}</span>}
                                   <p className="text-[9px] font-semibold text-foreground/40 uppercase tracking-widest leading-none font-mono">{s.code.substring(0, 12)}</p>
                                 </div>
                              </div>
                           </div>
                           <div className="text-right">
                              <span className="text-[9px] font-black px-2.5 py-1.5 rounded-lg bg-foreground/[0.04] text-foreground/75 uppercase tracking-[0.15em]">{s.mode} {s.quantity > 1 ? `x${s.quantity}` : ''}</span>
                              <p className="text-[9px] font-bold text-foreground/35 mt-2 uppercase tracking-widest">{s.timestamp}</p>
                           </div>
                         </motion.div>
                       )) : (
                         <div className="h-40 border border-dashed border-foreground/10 rounded-2xl flex flex-col items-center justify-center text-foreground/30">
                            <ClipboardList className="w-8 h-8 mb-3 opacity-50" strokeWidth={1.5} />
                            <span className="text-[10px] font-bold uppercase tracking-widest">No Signals Captured</span>
                         </div>
                       )}
                     </AnimatePresence>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ActivityLine() {
   return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-activity text-[#5E5CE6]"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>
   )
}
