"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Bell, Send, Smartphone, Users, Zap, Image as ImageIcon, 
  Link as LinkIcon, Clock, ShieldCheck, Sparkles, AlertCircle,
  History, RefreshCw, CheckCircle2, XCircle, ChevronRight,
  Filter, Layers, Target, Activity
} from "lucide-react";
import { Suspense } from "react";
import { toast } from "sonner";
import { format } from "date-fns";

function PushNotificationsContent() {
  const searchParams = useSearchParams();
  const [isMounted, setIsMounted] = useState(false);
  const [title, setTitle] = useState(searchParams.get("title") || "");
  const [body, setBody] = useState(searchParams.get("body") || "");
  const [imageUrl, setImageUrl] = useState("");
  const [targetType, setTargetType] = useState(searchParams.get("targetType") || "all");
  const [targetValue, setTargetValue] = useState(searchParams.get("targetValue") || "");
  const [deepLinkType, setDeepLinkType] = useState("none");
  const [deepLinkId, setDeepLinkId] = useState("");
  const [loading, setLoading] = useState(false);
  const [isInstant, setIsInstant] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ activeDevices: 0, vipCount: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    const t = searchParams.get("title");
    const b = searchParams.get("body");
    const tt = searchParams.get("targetType");
    const tv = searchParams.get("targetValue");
    
    if (t) setTitle(t);
    if (b) setBody(b);
    if (tt) setTargetType(tt);
    if (tv) setTargetValue(tv);
  }, [searchParams]);

  useEffect(() => {
    setIsMounted(true);
    fetchHistory();
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setStatsLoading(true);
      const res = await fetch("/api/notifications/stats");
      const data = await res.json();
      if (data.success) {
        setStats({
          activeDevices: data.activeDevices || 0,
          vipCount: data.vipCount || 0
        });
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    } finally {
      setStatsLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      setHistoryLoading(true);
      const res = await fetch("/api/notifications/history?limit=10");
      const data = await res.json();
      if (data.success) {
        setHistory(data.history || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error("Failed to fetch history:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const res = await fetch("/api/notifications/send-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          imageUrl,
          targetType,
          targetValue: targetType === 'segment' ? 'all' : targetValue,
          deepLinkType,
          deepLinkId,
          priority: isInstant ? 'high' : 'normal'
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success("Push notification dispatched successfully!");
        setTitle("");
        setBody("");
        setImageUrl("");
        setDeepLinkId("");
        fetchHistory(); // Refresh history
      } else {
        toast.error(data.error || "Failed to send notification");
      }
    } catch (err) {
      toast.error("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-12 pb-20 pt-10 px-4 sm:px-6 lg:px-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-10">
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
              <Activity className="w-5 h-5 text-emerald-500 animate-pulse" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-emerald-500/80 mb-1">Status: Operational</span>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-[9px] font-bold text-foreground/40 uppercase tracking-widest">Neural Gateway v2.4</span>
              </div>
            </div>
          </div>
          <h1 className="text-6xl md:text-8xl font-black text-foreground uppercase tracking-tighter leading-[0.85] italic">
            NEURAL<br/><span className="text-foreground/20 not-italic">DISPATCH</span>
          </h1>
          <p className="text-[12px] text-foreground/40 font-bold uppercase tracking-[0.5em] max-w-xl leading-relaxed">
            Proprietary engagement architecture for Zica Bella. <br/>
            Real-time packet transmission with zero latency.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:w-[400px]">
          <div className="glass-card p-6 rounded-[2rem] border border-foreground/5 relative group overflow-hidden">
            <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform duration-700">
              <Users className="w-20 h-20" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 block mb-2">Total Reach</span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black italic">{isMounted && !statsLoading ? stats.activeDevices.toLocaleString() : '...'}</span>
              <span className="text-[10px] font-bold opacity-30">PTS</span>
            </div>
          </div>
          <div className="glass-card p-6 rounded-[2rem] border border-foreground/5 relative group overflow-hidden bg-foreground/5">
            <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform duration-700">
              <Target className="w-20 h-20" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 block mb-2">VIP Latency</span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black italic text-emerald-500">0.4</span>
              <span className="text-[10px] font-bold opacity-30">MS</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-12">
        {/* Composer Form */}
        <div className="xl:col-span-7 space-y-10">
          <div className="glass-card p-8 sm:p-12 rounded-[3.5rem] relative overflow-hidden border border-foreground/[0.05] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.1)]">
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-foreground/5 blur-[120px] rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            
            <div className="relative z-10 flex items-center gap-4 mb-12">
              <div className="w-12 h-12 rounded-2xl bg-foreground flex items-center justify-center shadow-2xl rotate-3">
                <Zap className="w-6 h-6 text-background fill-background" />
              </div>
              <h2 className="text-2xl font-black uppercase tracking-tighter">Broadcast Composer</h2>
            </div>

            <form onSubmit={handleSend} className="space-y-10 relative z-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-[10px] font-black tracking-[0.3em] text-foreground/40 uppercase px-2">
                    <Layers className="w-3 h-3" /> Campaign Heading
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Midnight Drop"
                    className="w-full bg-foreground/[0.03] border border-foreground/[0.08] rounded-3xl px-8 py-5 text-[14px] font-bold outline-none focus:bg-foreground/[0.05] focus:border-foreground/20 transition-all placeholder:text-foreground/20"
                    required
                  />
                </div>

                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-[10px] font-black tracking-[0.3em] text-foreground/40 uppercase px-2">
                    <ImageIcon className="w-3 h-3" /> Media Asset URL
                  </label>
                  <div className="relative">
                    <input
                        type="text"
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        placeholder="https://images.zicabella.com/..."
                        className="w-full bg-foreground/[0.03] border border-foreground/[0.08] rounded-3xl pl-14 pr-8 py-5 text-[13px] font-bold outline-none focus:bg-foreground/[0.05] focus:border-foreground/20 transition-all placeholder:text-foreground/20 font-mono"
                    />
                    <div className="absolute left-6 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-foreground/10" />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <label className="flex items-center gap-2 text-[10px] font-black tracking-[0.3em] text-foreground/40 uppercase px-2">
                  <Sparkles className="w-3 h-3" /> Core Narrative
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Draft the message that will define this campaign..."
                  rows={4}
                  className="w-full bg-foreground/[0.03] border border-foreground/[0.08] rounded-[2.5rem] px-10 py-8 text-[15px] font-medium outline-none focus:bg-foreground/[0.05] focus:border-foreground/20 transition-all placeholder:text-foreground/20 resize-none leading-relaxed"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="space-y-4">
                  <label className="text-[10px] font-black tracking-[0.3em] text-foreground/40 uppercase px-2">Target Segment</label>
                  <div className="relative">
                    <select
                        value={targetType}
                        onChange={(e) => setTargetType(e.target.value)}
                        className="w-full bg-foreground/[0.03] border border-foreground/[0.08] rounded-3xl px-8 py-5 text-[11px] font-bold outline-none focus:border-foreground/20 transition-all appearance-none uppercase tracking-widest cursor-pointer"
                    >
                        <option value="all">Global Broadcast</option>
                        <option value="segment">VIP Segment</option>
                        <option value="user">Individual</option>
                    </select>
                    <ChevronRight className="absolute right-6 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20 rotate-90" />
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[10px] font-black tracking-[0.3em] text-foreground/40 uppercase px-2">Action Route</label>
                  <div className="relative">
                    <select
                        value={deepLinkType}
                        onChange={(e) => setDeepLinkType(e.target.value)}
                        className="w-full bg-foreground/[0.03] border border-foreground/[0.08] rounded-3xl px-8 py-5 text-[11px] font-bold outline-none focus:border-foreground/20 transition-all appearance-none uppercase tracking-widest cursor-pointer"
                    >
                        <option value="none">Open Shell</option>
                        <option value="product">Product</option>
                        <option value="collection">Collection</option>
                        <option value="orders">Orders</option>
                    </select>
                    <ChevronRight className="absolute right-6 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20 rotate-90" />
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[10px] font-black tracking-[0.3em] text-foreground/40 uppercase px-2">Flash Mode</label>
                  <div className="flex items-center justify-between bg-foreground/[0.03] border border-foreground/[0.08] rounded-3xl px-8 py-5">
                     <span className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">{isInstant ? 'High' : 'Normal'}</span>
                     <button 
                        type="button"
                        onClick={() => setIsInstant(!isInstant)}
                        className={`w-12 h-6 rounded-full relative transition-all duration-500 shadow-inner ${isInstant ? 'bg-emerald-500' : 'bg-foreground/10'}`}
                     >
                        <motion.div 
                          animate={{ x: isInstant ? 26 : 4 }}
                          className="absolute top-1 w-4 h-4 rounded-full bg-foreground shadow-xl" 
                        />
                     </button>
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {(targetType !== 'all' || (deepLinkType !== 'none' && deepLinkType !== 'orders')) && (
                  <motion.div 
                    initial={{ opacity: 0, y: -20, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -20, height: 0 }}
                    className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4"
                  >
                    {targetType !== 'all' && (
                      <div className="space-y-4">
                        <label className="text-[10px] font-black tracking-[0.3em] text-foreground/40 uppercase px-2">
                           {targetType === 'user' ? 'Target ID / Phone' : 'Segment Logic'}
                        </label>
                        <input
                           type="text"
                           value={targetValue}
                           onChange={(e) => setTargetValue(e.target.value)}
                           placeholder={targetType === 'user' ? "+91..." : "e.g., active_30d"}
                           className="w-full bg-foreground/[0.05] border border-foreground/10 rounded-3xl px-8 py-5 text-[13px] font-bold outline-none focus:border-foreground/30 transition-all placeholder:text-foreground/20"
                           required
                        />
                      </div>
                    )}
                    {deepLinkType !== 'none' && deepLinkType !== 'orders' && (
                      <div className="space-y-4">
                        <label className="text-[10px] font-black tracking-[0.3em] text-foreground/40 uppercase px-2">Resource Handle</label>
                        <input
                           type="text"
                           value={deepLinkId}
                           onChange={(e) => setDeepLinkId(e.target.value)}
                           placeholder={`Enter ${deepLinkType} ID...`}
                           className="w-full bg-foreground/[0.05] border border-foreground/10 rounded-3xl px-8 py-5 text-[13px] font-bold outline-none focus:border-foreground/30 transition-all placeholder:text-foreground/20"
                           required
                        />
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-10 bg-foreground text-background font-black h-20 rounded-3xl hover:scale-[1.01] active:scale-[0.98] transition-all shadow-[0_30px_60px_-12px_rgba(0,0,0,0.3)] flex items-center justify-center gap-6 text-[12px] uppercase tracking-[0.5em] group overflow-hidden relative"
              >
                {loading ? (
                  <div className="flex items-center gap-4">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Synchronizing Packets...</span>
                  </div>
                ) : (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/10 to-emerald-500/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                    <Zap className="w-5 h-5 text-emerald-400 fill-emerald-400 group-hover:scale-125 transition-transform" />
                    <span>Initiate Neural Broadcast</span>
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="flex items-center gap-6 p-8 bg-amber-500/[0.03] rounded-[2.5rem] border border-amber-500/10">
             <div className="p-3 bg-amber-500/10 rounded-2xl">
                <AlertCircle className="w-6 h-6 text-amber-500" />
             </div>
             <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-amber-500/70 leading-relaxed">
                <span className="text-amber-500 block mb-1">Protocol Warning:</span>
                {targetType === 'all' 
                  ? `Global broadcast targets ${isMounted ? stats.activeDevices.toLocaleString() : '...'} endpoints. ` 
                  : targetType === 'segment' 
                  ? `Targeting ${isMounted ? stats.vipCount.toLocaleString() : '...'} high-value nodes. ` 
                  : 'Individual node targeting active. '}
                Transmission is irreversible once the neural handshake is complete.
             </p>
          </div>
        </div>

        {/* Device Preview Overlay */}
        <div className="xl:col-span-5 relative hidden xl:block">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="sticky top-12 flex flex-col items-center"
          >
            <div className="relative group">
                {/* Dynamic Aura */}
                <div className="absolute -inset-20 bg-blue-500/5 blur-[120px] rounded-full opacity-30 group-hover:opacity-100 transition-opacity duration-1000" />
                
                {/* iPhone 15 Pro Max Mockup */}
                <div className="w-[340px] h-[690px] border-[12px] border-foreground/90 rounded-[4.5rem] relative bg-black shadow-[0_0_120px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden ring-1 ring-foreground/20">
                    <div className="absolute top-0 inset-x-0 h-10 bg-foreground/[0.02] z-10" />
                    
                    {/* Dynamic Island */}
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 w-32 h-8 bg-black rounded-[1.2rem] z-30 flex items-center justify-center border border-foreground/5 shadow-2xl">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500/30 absolute right-4" />
                    </div>

                    {/* Content Area (Lock Screen UI) */}
                    <div className="flex-1 bg-[url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop')] bg-cover pt-28 px-8 relative">
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
                        
                        <div className="flex flex-col items-center mb-20 space-y-2 opacity-90 relative z-10 text-foreground">
                            <span className="text-7xl font-extralight tracking-tighter">12:00</span>
                            <span className="text-[12px] font-black uppercase tracking-[0.4em] opacity-60">Monday, May 14</span>
                        </div>

                        {/* Notification Stack */}
                        <div className="relative z-20 space-y-3">
                          <AnimatePresence mode="wait">
                              {(title || body) ? (
                                  <motion.div
                                      key="preview"
                                      initial={{ y: 30, opacity: 0, scale: 0.9 }}
                                      animate={{ y: 0, opacity: 1, scale: 1 }}
                                      exit={{ y: -20, opacity: 0, scale: 0.9 }}
                                      className="bg-foreground/10 backdrop-blur-3xl border border-foreground/10 p-6 rounded-[2.5rem] shadow-2xl flex flex-col gap-4 text-foreground"
                                  >
                                      <div className="flex items-center gap-4">
                                          <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center shadow-lg">
                                              <Bell className="w-5 h-5 text-black" />
                                          </div>
                                          <div className="flex-1 overflow-hidden">
                                              <div className="flex justify-between items-center mb-0.5">
                                                  <span className="text-[9px] font-black uppercase tracking-widest text-foreground/40">Zica Bella App</span>
                                                  <span className="text-[9px] font-bold opacity-30">now</span>
                                              </div>
                                              <h3 className="text-[14px] font-black leading-tight truncate">{title || "Notification Preview"}</h3>
                                          </div>
                                      </div>
                                      
                                      <p className="text-[13px] leading-snug text-foreground/70 font-medium line-clamp-2">
                                          {body || "Your message payload will manifest here..."}
                                      </p>

                                      {imageUrl && (
                                          <div className="w-full aspect-[16/9] rounded-2xl bg-foreground/5 overflow-hidden mt-1 border border-foreground/10">
                                              <img src={imageUrl} alt="Preview" className="w-full h-full object-cover" />
                                          </div>
                                      )}
                                  </motion.div>
                              ) : (
                                <div className="flex flex-col items-center gap-4 opacity-20 py-10">
                                   <div className="w-16 h-1 rounded-full bg-foreground/30" />
                                   <p className="text-[10px] font-black uppercase tracking-widest text-foreground text-center">Awaiting Transmission...</p>
                                </div>
                              )}
                          </AnimatePresence>
                        </div>

                        {/* Bottom UI */}
                        <div className="absolute bottom-12 inset-x-0 flex justify-between px-12 relative z-10">
                            <div className="w-14 h-14 rounded-full bg-foreground/10 backdrop-blur-xl flex items-center justify-center border border-foreground/5 shadow-2xl">
                                <ImageIcon className="w-6 h-6 text-foreground" />
                            </div>
                            <div className="w-14 h-14 rounded-full bg-foreground/10 backdrop-blur-xl flex items-center justify-center border border-foreground/5 shadow-2xl">
                                <Smartphone className="w-6 h-6 text-foreground" />
                            </div>
                        </div>
                    </div>
                    
                    {/* Home Indicator */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-36 h-1.5 bg-foreground/20 rounded-full z-20" />
                </div>
            </div>

            <div className="mt-10 flex items-center gap-3 opacity-20">
               <div className="w-2 h-2 rounded-full bg-foreground" />
               <p className="text-[10px] font-black uppercase tracking-[0.5em] text-foreground">
                  Neural Mirror Simulation
               </p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* History Section */}
      <div className="space-y-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
           <div className="flex items-center gap-6">
              <div className="w-14 h-14 bg-foreground/5 rounded-[1.5rem] flex items-center justify-center border border-foreground/5">
                 <History className="w-6 h-6 text-foreground/40" />
              </div>
              <div>
                 <h2 className="text-3xl font-black uppercase tracking-tighter">Transmission Registry</h2>
                 <p className="text-[10px] font-black text-foreground/30 uppercase tracking-[0.3em] mt-1">Real-time audit log of neural activity</p>
              </div>
           </div>
           
           <button 
             onClick={fetchHistory}
             disabled={historyLoading}
             className="flex items-center gap-4 px-8 py-4 bg-foreground/5 hover:bg-foreground/10 rounded-2xl transition-all border border-foreground/[0.08] active:scale-95"
           >
              <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
              <span className="text-[10px] font-black uppercase tracking-widest">Resync Registry</span>
           </button>
        </div>

        <div className="glass-card rounded-[3rem] overflow-hidden border border-foreground/[0.05] shadow-2xl">
           <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                 <thead>
                    <tr className="border-b border-foreground/[0.05] bg-foreground/[0.01]">
                       <th className="px-10 py-8 text-[10px] font-black uppercase tracking-[0.3em] text-foreground/30">Timestamp</th>
                       <th className="px-10 py-8 text-[10px] font-black uppercase tracking-[0.3em] text-foreground/30">Payload Details</th>
                       <th className="px-10 py-8 text-[10px] font-black uppercase tracking-[0.3em] text-foreground/30">Vector</th>
                       <th className="px-10 py-8 text-[10px] font-black uppercase tracking-[0.3em] text-foreground/30 text-center">Reach</th>
                       <th className="px-10 py-8 text-[10px] font-black uppercase tracking-[0.3em] text-foreground/30 text-right">Protocol</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-foreground/[0.03]">
                    {historyLoading && history.length === 0 ? (
                       <tr>
                          <td colSpan={5} className="px-10 py-32 text-center">
                             <div className="flex flex-col items-center gap-6 opacity-20">
                                <RefreshCw className="w-12 h-12 animate-spin" />
                                <span className="text-[12px] font-black uppercase tracking-[0.5em]">Synchronizing...</span>
                             </div>
                          </td>
                       </tr>
                    ) : history.length === 0 ? (
                       <tr>
                          <td colSpan={5} className="px-10 py-32 text-center">
                             <div className="flex flex-col items-center gap-6 opacity-20">
                                <Bell className="w-12 h-12" />
                                <span className="text-[12px] font-black uppercase tracking-[0.5em]">No dispatch records</span>
                             </div>
                          </td>
                       </tr>
                    ) : (
                       history.map((record) => (
                          <tr key={record.id} className="hover:bg-foreground/[0.01] transition-colors group">
                             <td className="px-10 py-10">
                                <div className="flex flex-col gap-1.5">
                                   <span className="text-[14px] font-black italic">
                                      {isMounted ? format(new Date(record.createdAt), "MMM d, HH:mm") : ""}
                                   </span>
                                   <span className="text-[10px] font-bold text-foreground/20 uppercase tracking-widest">
                                      ID: {record.id.slice(-6)}
                                   </span>
                                </div>
                             </td>
                             <td className="px-10 py-10">
                                <div className="flex items-center gap-6">
                                   {record.imageUrl && (
                                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-foreground/5 border border-foreground/10 shrink-0 shadow-lg">
                                         <img src={record.imageUrl} alt="" className="w-full h-full object-cover" />
                                      </div>
                                   )}
                                   <div className="flex flex-col gap-2 max-w-sm">
                                      <span className="text-[15px] font-black tracking-tight leading-none group-hover:text-emerald-500 transition-colors">{record.title}</span>
                                      <p className="text-[12px] text-foreground/40 line-clamp-1 leading-relaxed font-medium">{record.body}</p>
                                   </div>
                                </div>
                             </td>
                             <td className="px-10 py-10">
                                <div className="flex flex-col gap-3">
                                   <div className="flex items-center gap-3">
                                      <div className={`w-2 h-2 rounded-full ${record.targetType === 'all' ? 'bg-blue-500' : 'bg-amber-500'}`} />
                                      <span className="text-[11px] font-black uppercase tracking-widest text-foreground/60">
                                         {record.targetType === 'all' ? 'GLOBAL' : record.targetType.toUpperCase()}
                                      </span>
                                   </div>
                                   {record.deepLinkType !== 'none' && (
                                      <span className="text-[10px] font-bold text-foreground/20 uppercase tracking-[0.2em] flex items-center gap-2">
                                         <LinkIcon className="w-3 h-3" /> {record.deepLinkType}
                                      </span>
                                   )}
                                </div>
                             </td>
                             <td className="px-10 py-10">
                                <div className="flex items-center justify-center gap-12">
                                   <div className="flex flex-col items-center gap-1">
                                      <span className="text-[20px] font-black italic leading-none">{record.sentCount}</span>
                                      <span className="text-[10px] font-bold text-foreground/20 uppercase tracking-widest">Sent</span>
                                   </div>
                                   <div className="flex flex-col items-center gap-1">
                                      <span className="text-[20px] font-black italic text-emerald-500 leading-none">{record.deliveredCount}</span>
                                      <span className="text-[10px] font-bold text-foreground/20 uppercase tracking-widest">DEL</span>
                                   </div>
                                </div>
                             </td>
                             <td className="px-10 py-10 text-right">
                                <div className={`inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl border ${
                                   record.status === 'sent' 
                                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.05)]' 
                                      : 'bg-foreground/5 border-foreground/10 text-foreground/30'
                                }`}>
                                   {record.status === 'sent' ? (
                                      <CheckCircle2 className="w-4 h-4" />
                                   ) : (
                                      <Clock className="w-4 h-4" />
                                   )}
                                   <span className="text-[10px] font-black uppercase tracking-widest italic">
                                      {record.status === 'sent' ? 'Success' : record.status}
                                   </span>
                                </div>
                             </td>
                          </tr>
                       ))
                    )}
                 </tbody>
              </table>
           </div>
        </div>

        <div className="flex items-center justify-between p-10 glass-card rounded-[2.5rem] border border-foreground/[0.05]">
           <p className="text-[11px] font-black uppercase tracking-[0.3em] text-foreground/20">
              Dispatched Cluster: <span className="text-foreground/60">{history.length} / {total}</span> Operations
           </p>
           <div className="flex gap-6">
              <button disabled className="px-10 py-4 rounded-2xl border border-foreground/[0.05] text-[10px] font-black opacity-30 uppercase tracking-[0.2em] transition-all">Prev</button>
              <button disabled={total <= history.length} className="px-10 py-4 rounded-2xl bg-foreground text-background text-[10px] font-black uppercase tracking-[0.2em] hover:scale-105 transition-all shadow-xl">Next Segment</button>
           </div>
        </div>
      </div>
    </div>
  );
}

export default function PushNotificationsPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <RefreshCw className="w-8 h-8 animate-spin text-foreground/40" />
        <span className="text-[10px] font-black uppercase tracking-widest text-foreground/40">Loading Dashboard...</span>
      </div>
    }>
      <PushNotificationsContent />
    </Suspense>
  );
}
