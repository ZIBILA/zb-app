"use client";

import { useState, useEffect, useCallback } from 'react';
import { 
  ShoppingCart, Users, Clock, ShoppingBag, 
  RefreshCw, Loader2, Search, User, 
  ExternalLink, Calendar, Trash2, ArrowRight,
  TrendingUp, Activity, Smartphone, Monitor,
  Zap, ChevronRight, Filter, MoreHorizontal,
  XCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { cachedAdminFetch, invalidateAdminCache } from '@/lib/adminClientCache';

interface CartItem {
  id: string;
  productId: string;
  variantId: string | null;
  handle: string | null;
  title: string | null;
  price: number | null;
  image: string | null;
  quantity: number;
  size: string | null;
  createdAt: string;
}

interface Cart {
  id: string;
  customerId: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  updatedAt: string;
  customer?: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    image: string | null;
  } | null;
  items: CartItem[];
}

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={`glass-card rounded-[2.5rem] overflow-hidden relative z-10 border border-foreground/5 shadow-xl ${className}`}
    >
      {children}
    </motion.div>
  );
}

export default function LiveCartsPage() {
  const router = useRouter();
  const [carts, setCarts] = useState<Cart[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchCarts = useCallback(async (force = false) => {
    if (carts.length === 0) setLoading(true);
    setRefreshing(true);
    try {
      const data = await cachedAdminFetch<any>('/api/admin/live-carts?limit=50&days=7', { skipCache: force, ttlMs: 15_000 });
      if (Array.isArray(data)) {
        setCarts(data);
      }
    } catch (error) {
      console.error("Failed to fetch live carts:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [carts.length]);

  const handleClear = async (cartId: string) => {
    if (!confirm("Are you sure you want to clear this cart? This action cannot be undone.")) return;
    
    try {
      const res = await fetch(`/api/admin/live-carts/${cartId}`, { method: 'DELETE' });
      if (res.ok) {
        invalidateAdminCache('/api/admin/live-carts');
        toast.success("Cart cleared successfully");
        fetchCarts(true);
      } else {
        toast.error("Failed to clear cart");
      }
    } catch (err) {
      toast.error("Network error");
    }
  };

  useEffect(() => {
    fetchCarts();
    // Auto-refresh every 15 seconds when tab is active
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchCarts();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchCarts]);

  const filteredCarts = carts.filter(cart => {
    const name = cart.customer?.name?.toLowerCase() || "guest customer";
    const email = cart.customer?.email?.toLowerCase() || cart.email?.toLowerCase() || "";
    const phone = cart.phone || cart.customer?.phone || "";
    const query = searchQuery.toLowerCase();
    return name.includes(query) || email.includes(query) || phone.includes(query);
  });

  const totalCartValue = carts.reduce((acc, cart) => 
    acc + cart.items.reduce((sum, item) => sum + ((item.price || 0) * item.quantity), 0), 0
  );

  const averageCartValue = carts.length > 0 ? totalCartValue / carts.length : 0;

  return (
    <div className="max-w-[1600px] mx-auto space-y-12 pb-20 pt-10 px-4 sm:px-6 lg:px-10 animate-in fade-in duration-1000">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-10 mb-16">
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-[2rem] bg-foreground text-background flex items-center justify-center shadow-[0_20px_40px_rgba(0,0,0,0.2)] rotate-3">
              <ShoppingCart className="w-8 h-8 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                 <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                 <span className="text-[10px] font-black uppercase tracking-[0.4em] text-emerald-500/80">Real-time Telemetry</span>
              </div>
              <h1 className="text-6xl md:text-8xl font-black text-foreground uppercase tracking-tighter leading-none italic">
                LIVE<span className="text-foreground/20 not-italic">CARTS</span>
              </h1>
            </div>
          </div>
          <p className="text-[12px] text-foreground/40 font-bold uppercase tracking-[0.5em] max-w-xl leading-relaxed">
            Monitoring active commerce sessions across global nodes. <br/>
            Engagement metrics updated every 5 seconds.
          </p>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex -space-x-4">
             {carts.slice(0, 5).map((cart, i) => (
                <div key={i} className="w-12 h-12 rounded-2xl border-4 border-background bg-foreground/5 flex items-center justify-center overflow-hidden">
                   {cart.customer?.image ? <img src={cart.customer.image} className="w-full h-full object-cover" /> : <User className="w-5 h-5 opacity-20" />}
                </div>
             ))}
             {carts.length > 5 && (
                <div className="w-12 h-12 rounded-2xl border-4 border-background bg-foreground flex items-center justify-center text-[10px] font-bold text-background">
                   +{carts.length - 5}
                </div>
             )}
          </div>
          <button
            onClick={() => fetchCarts(true)}
            disabled={refreshing}
            className="flex items-center justify-center gap-4 px-10 py-5 rounded-[2rem] text-[11px] font-black tracking-[0.3em] uppercase bg-foreground text-background hover:scale-105 transition-all active:scale-95 disabled:opacity-50 shadow-2xl"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Syncing Nodes...' : 'Force Resync'}
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: "Active Sessions", value: carts.length, icon: Activity, color: "text-blue-500", bg: "bg-blue-500/10" },
          { label: "Pipeline Value", value: `₹${totalCartValue.toLocaleString()}`, icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10" },
          { label: "Average Intent", value: `₹${Math.round(averageCartValue).toLocaleString()}`, icon: Zap, color: "text-amber-500", bg: "bg-amber-500/10" },
          { label: "Last Heartbeat", value: carts.length > 0 ? new Date(carts[0].updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A', icon: Clock, color: "text-purple-500", bg: "bg-purple-500/10" },
        ].map((stat, i) => (
          <GlassCard key={i} className="p-8 group hover:bg-foreground/[0.02] transition-colors duration-700">
            <div className="flex items-center justify-between mb-6">
              <div className={`p-3 rounded-2xl ${stat.bg} ${stat.color} group-hover:scale-110 transition-transform duration-500`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div className="w-1 h-1 rounded-full bg-foreground/10" />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-foreground/30">{stat.label}</p>
              <p className="text-3xl font-black italic tracking-tighter">{stat.value}</p>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Search & Intelligence */}
      <div className="relative group">
        <div className="absolute inset-0 bg-foreground/5 blur-3xl rounded-[3rem] opacity-0 group-focus-within:opacity-100 transition-opacity duration-1000" />
        <Search className="absolute left-8 top-1/2 -translate-y-1/2 w-6 h-6 text-foreground/20 group-focus-within:text-foreground/50 transition-colors" />
        <input 
          type="text" 
          placeholder="Query by customer signature, endpoint, or metadata..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-foreground/[0.03] border border-foreground/[0.08] rounded-[2.5rem] pl-20 pr-10 py-8 text-[15px] font-bold focus:outline-none focus:bg-foreground/[0.05] focus:border-foreground/20 transition-all shadow-sm placeholder:text-foreground/10"
        />
        <div className="absolute right-8 top-1/2 -translate-y-1/2 flex items-center gap-3">
           <span className="text-[9px] font-black uppercase tracking-widest text-foreground/20 px-3 py-1 rounded-full border border-foreground/5">ESC to clear</span>
           <Filter className="w-4 h-4 text-foreground/20" />
        </div>
      </div>

      {/* Carts List */}
      <div className="space-y-8">
        {loading ? (
          <div className="py-32 flex flex-col items-center gap-6">
            <div className="relative">
               <Loader2 className="w-16 h-16 animate-spin text-foreground/5" />
               <ShoppingCart className="w-6 h-6 text-foreground/20 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.5em] text-foreground/20">Scanning Neural Carts...</p>
          </div>
        ) : filteredCarts.length > 0 ? (
          <div className="grid grid-cols-1 gap-10">
            {filteredCarts.map((cart) => (
              <GlassCard key={cart.id} className="group hover:border-foreground/10 transition-all duration-700">
                <div className="flex flex-col lg:flex-row">
                  {/* Customer Info Sidebar */}
                  <div className="lg:w-[400px] p-10 border-r border-foreground/[0.03] bg-foreground/[0.01] relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-transparent via-transparent to-foreground/[0.02] pointer-events-none" />
                    
                    <div className="relative z-10">
                      <div className="flex items-center gap-6 mb-10">
                        <div className="relative">
                            <div className="w-20 h-20 rounded-[2rem] bg-foreground/5 flex items-center justify-center border border-foreground/10 overflow-hidden shadow-2xl relative">
                              {cart.customer?.image ? (
                                <img src={cart.customer.image} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <User className="w-8 h-8 text-foreground/10" />
                              )}
                            </div>
                          <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-xl bg-emerald-500 border-4 border-background flex items-center justify-center">
                             <Activity className="w-3 h-3 text-white" />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-2xl font-black italic text-foreground tracking-tighter truncate">{cart.customer?.name || 'Anonymous Node'}</h3>
                          <p className="text-[11px] text-foreground/40 font-black uppercase tracking-[0.2em] truncate flex items-center gap-2">
                             <User className="w-3 h-3 text-foreground/20" />
                             {cart.customer?.email || cart.email || 'NO_SIGNATURE'}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-foreground/10 text-foreground/60 border border-foreground/5">
                              {cart.source === "app" ? "App" : "Web Store"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-6 mb-10">
                        <div className="p-5 rounded-[1.5rem] bg-foreground/[0.03] border border-foreground/[0.05] space-y-1">
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-foreground/30 block">Marketing Contact</span>
                          <span className="text-[13px] font-black text-foreground italic flex items-center gap-2">
                             <Smartphone className="w-3 h-3 text-foreground/20" /> 
                             {cart.phone || cart.customer?.phone || 'NO_PHONE'}
                          </span>
                        </div>
                        <div className="p-5 rounded-[1.5rem] bg-foreground/[0.03] border border-foreground/[0.05] space-y-1">
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-foreground/30 block">Session ID</span>
                          <span className="text-[10px] font-mono font-bold text-foreground/40 truncate block">
                             {cart.id.slice(0, 12)}...
                          </span>
                        </div>
                        <div className="space-y-1 pl-4">
                          <span className="text-[9px] font-black uppercase tracking-widest text-foreground/20 block">Active Since</span>
                          <span className="text-[13px] font-bold text-foreground/70">{new Date(cart.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="space-y-1 pl-4">
                          <span className="text-[9px] font-black uppercase tracking-widest text-foreground/20 block">Payload</span>
                          <span className="text-[13px] font-black italic text-foreground">{cart.items.reduce((s, i) => s + i.quantity, 0)} Units</span>
                        </div>
                      </div>

                      <div className="pt-8 border-t border-foreground/[0.05] space-y-4">
                        <div className="flex items-center justify-between">
                           <span className="text-[10px] font-black uppercase tracking-widest text-foreground/20">Protocol Status</span>
                           <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-[8px] font-black uppercase tracking-widest border border-emerald-500/10 italic">Synchronized</span>
                        </div>
                        <div className="flex items-center gap-4">
                           <button 
                             onClick={() => window.open(`tel:${cart.phone || cart.customer?.phone}`, '_blank')}
                             disabled={!cart.phone && !cart.customer?.phone}
                             className="flex-1 h-12 rounded-2xl bg-foreground/5 border border-foreground/10 text-[9px] font-black uppercase tracking-widest text-foreground/60 hover:bg-foreground/10 transition-all active:scale-95 disabled:opacity-30"
                           >
                             Call Node
                           </button>
                           <button 
                             onClick={() => handleClear(cart.id)}
                             className="w-12 h-12 rounded-2xl bg-red-500/5 border border-red-500/10 flex items-center justify-center text-red-400/60 hover:bg-red-500/10 transition-all active:scale-95"
                           >
                             <Trash2 className="w-4 h-4" />
                           </button>
                        </div>
                      </div>

                      <div className="pt-8 border-t border-foreground/[0.05]">
                        <div className="flex items-center justify-between mb-8">
                          <span className="text-[12px] font-black uppercase tracking-[0.3em] text-foreground/30 italic">Accumulated Value</span>
                          <span className="text-4xl font-black italic text-foreground leading-none">
                            ₹{cart.items.reduce((s, i) => s + ((i.price || 0) * i.quantity), 0).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex gap-3">
                           <button 
                             onClick={() => cart.customer && router.push(`/dashboard/customers/${cart.customer.id}`)}
                             disabled={!cart.customer}
                             className="flex-1 flex items-center justify-center gap-3 py-5 rounded-[1.5rem] bg-foreground text-background text-[10px] font-black uppercase tracking-[0.2em] hover:opacity-90 transition-all shadow-xl active:scale-95 group disabled:opacity-30"
                           >
                              Audit Profile <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                           </button>
                           <button 
                              onClick={() => handleClear(cart.id)}
                              className="w-14 h-14 rounded-[1.5rem] bg-red-500/5 flex items-center justify-center border border-red-500/10 hover:bg-red-500/10 transition-all text-red-500 shadow-sm"
                              title="Clear Session"
                           >
                              <Trash2 className="w-5 h-5" />
                           </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Items Grid */}
                  <div className="flex-1 p-10 bg-foreground/[0.005]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
                      <AnimatePresence>
                        {cart.items.map((item, idx) => (
                          <motion.div 
                            key={item.id} 
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: idx * 0.1 }}
                            className="flex flex-col p-6 rounded-[2.5rem] bg-foreground/[0.02] border border-foreground/[0.06] group/item hover:bg-foreground/[0.04] hover:scale-[1.02] transition-all duration-700 shadow-sm hover:shadow-2xl"
                          >
                            <div className="relative w-full aspect-[4/5] rounded-[2rem] bg-foreground/5 overflow-hidden mb-6 border border-foreground/5">
                              {item.image ? (
                                <img src={item.image} alt="" className="w-full h-full object-cover group-hover/item:scale-110 transition-transform duration-1000" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-foreground/10">
                                  <ShoppingBag className="w-8 h-8" />
                                </div>
                              )}
                              <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-xl px-4 py-2 rounded-2xl border border-white/10 shadow-2xl">
                                 <span className="text-[12px] font-black italic text-foreground">x{item.quantity}</span>
                              </div>
                            </div>
                            
                            <div className="flex-1 space-y-4">
                              <div className="space-y-1">
                                <h4 className="text-[15px] font-black text-foreground italic tracking-tight line-clamp-1 group-hover/item:text-emerald-500 transition-colors leading-tight">{item.title}</h4>
                                <div className="flex items-center gap-3">
                                   <span className="text-[10px] font-bold uppercase tracking-widest text-foreground/20">Handle:</span>
                                   <span className="text-[10px] font-black text-foreground/40 truncate w-32">{item.handle}</span>
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-4 py-4 border-y border-foreground/[0.03]">
                                 {item.size && (
                                   <div className="flex flex-col gap-0.5">
                                      <span className="text-[8px] font-black uppercase tracking-widest text-foreground/20">Config</span>
                                      <span className="text-[11px] font-black text-foreground/60">{item.size}</span>
                                   </div>
                                 )}
                                 <div className="w-px h-6 bg-foreground/[0.03]" />
                                 <div className="flex flex-col gap-0.5">
                                    <span className="text-[8px] font-black uppercase tracking-widest text-foreground/20">Vector ID</span>
                                    <span className="text-[11px] font-mono text-foreground/30">#{item.productId.slice(-6)}</span>
                                 </div>
                              </div>

                              <div className="flex items-center justify-between pt-2">
                                <span className="text-[18px] font-black italic text-foreground tracking-tighter">₹{(item.price || 0).toLocaleString()}</span>
                                <div className="w-8 h-8 rounded-full bg-foreground/[0.05] flex items-center justify-center opacity-0 group-hover/item:opacity-100 transition-opacity">
                                   <ArrowRight className="w-4 h-4 text-foreground/40" />
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        ) : (
          <div className="py-48 flex flex-col items-center justify-center gap-10">
            <div className="relative">
              <div className="w-32 h-32 rounded-[3.5rem] bg-foreground/5 flex items-center justify-center text-foreground/10 border border-foreground/5 animate-bounce">
                <ShoppingCart className="w-12 h-12" />
              </div>
              <div className="absolute -bottom-4 -right-4 w-12 h-12 rounded-[1.5rem] bg-foreground/5 flex items-center justify-center border border-foreground/5">
                 <RefreshCw className="w-5 h-5 opacity-20" />
              </div>
            </div>
            <div className="text-center space-y-4">
              <h3 className="text-[18px] font-black text-foreground/30 uppercase tracking-[0.5em] italic">No Active Vectors Found</h3>
              <p className="text-[12px] text-foreground/20 font-bold uppercase tracking-[0.2em] max-w-sm mx-auto leading-relaxed">Neural network is currently clear of active shopper signatures. Protocol standing by.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
