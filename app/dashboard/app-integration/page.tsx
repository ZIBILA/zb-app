"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Smartphone, Wifi, WifiOff, CheckCircle, XCircle, RefreshCw, Loader2,
  ShoppingBag, Users, Package, ShoppingCart, Globe, Zap, Database,
  ArrowRight, Activity, Server, Code, Eye, Settings, Link2, BarChart3,
  Image as ImageIcon, Undo2, ArrowLeftRight, FileText, User, Layers,
  Monitor, Heart, Palette, Navigation, MessageCircle, Shield, Clock,
  ChevronRight, Search, Filter, Save, Info, Sparkles, ChevronDown,
  Plus, Trash2, GripVertical,
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import {
  DEFAULT_PDP_INCL_TAXES_TEXT,
  DEFAULT_PDP_MODEL_INFO,
  DEFAULT_PDP_TRUST_BOXES,
  parsePdpTrustBoxes,
  type PdpTrustBox,
} from '@/lib/pdp-trust-defaults';

interface EndpointStatus {
  name: string;
  path: string;
  method: string;
  status: 'ok' | 'error' | 'loading';
  responseTime?: number;
  dataCount?: number;
  icon: any;
}

interface SyncStats {
  productsCount: number;
  collectionsCount: number;
  customersCount: number;
  ordersCount: number;
  returnsCount: number;
  exchangesCount: number;
  lastChecked: string;
}

type SettingsTab = 'hero' | 'layout' | 'pdp' | 'collections' | 'social' | 'community' | 'advanced';

interface Collection {
  id: string;
  title: string;
  handle: string;
  image: string | null;
}

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className={`glass-card rounded-[2rem] overflow-hidden relative z-10 ${className}`}
    >
      {children}
    </motion.div>
  );
}

function StatBlock({ icon: Icon, label, value, sublabel }: { icon: any; label: string; value: string | number; sublabel?: string }) {
  return (
    <div className="flex items-center gap-5 px-8 py-7 border-b border-foreground/5 last:border-0 group/stat hover:bg-foreground/[0.02] transition-all duration-500">
      <div className="w-12 h-12 rounded-2xl bg-foreground/5 flex items-center justify-center text-foreground/30 border border-foreground/5 group-hover/stat:bg-foreground group-hover/stat:text-background transition-all duration-700 shadow-xl">
        <Icon className="w-5 h-5" strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[22px] font-bold text-foreground tracking-tight leading-none mb-1.5">{value}</div>
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/25">{label}</div>
      </div>
      {sublabel && (
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-foreground/15 hidden md:block">{sublabel}</span>
      )}
    </div>
  );
}

function EndpointRow({ ep }: { ep: any }) {
  const Icon = ep.icon;
  return (
    <div className="flex flex-col border-b border-foreground/5 last:border-0 hover:bg-foreground/[0.02] transition-all duration-500">
      <div className="flex items-center gap-5 px-8 py-5 group/row">
        <div className="w-10 h-10 rounded-xl bg-foreground/5 flex items-center justify-center text-foreground/30 border border-foreground/5 group-hover/row:bg-foreground group-hover/row:text-background transition-all duration-700">
          <Icon className="w-4 h-4" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              ep.method === 'GET' ? 'bg-blue-500/10 text-blue-400' : 'bg-amber-500/10 text-amber-400'
            }`}>{ep.method}</span>
            <span className="text-[13px] font-bold text-foreground/80">{ep.name}</span>
          </div>
          <div className="text-[10px] font-mono text-foreground/25 tracking-tight truncate">{ep.path}</div>
        </div>
        <div className="flex items-center gap-3">
          {ep.responseTime !== undefined && (
            <span className="text-[10px] font-bold font-mono text-foreground/25">{ep.responseTime}ms</span>
          )}
          {ep.dataCount !== undefined && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-foreground/15 bg-foreground/5 px-2.5 py-1 rounded-lg">
              {ep.dataCount} items
            </span>
          )}
          {ep.status === 'loading' ? (
            <Loader2 className="w-4 h-4 text-foreground/25 animate-spin" />
          ) : ep.status === 'ok' ? (
            <CheckCircle className="w-4 h-4 text-emerald-500" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
        </div>
      </div>
      {ep.error && (
        <div className="px-8 pb-4 -mt-1">
          <div className="bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-1.5 text-[9px] font-mono text-red-400/80 break-all">
             ERR: {ep.error}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsInput({ label, value, onChange, placeholder, mono, hint, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; hint?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/60 mb-2">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-all ${mono ? 'font-mono' : ''}`}
        placeholder={placeholder}
      />
      {hint && <p className="text-[10px] text-foreground/30 mt-1.5 ml-1">{hint}</p>}
    </div>
  );
}

function SettingsSelect({ label, value, onChange, options, hint }: {
  label: string; value: string; onChange: (v: string) => void; options: { label: string, value: string }[]; hint?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/60 mb-2">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-all appearance-none"
      >
        <option value="">Select...</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {hint && <p className="text-[10px] text-foreground/30 mt-1.5 ml-1">{hint}</p>}
    </div>
  );
}

function SettingsMultiSelect({ label, value, onChange, options, hint }: {
  label: string; value: string; onChange: (v: string) => void; options: { label: string, value: string }[]; hint?: string;
}) {
  let currentValues: string[] = [];
  try { currentValues = JSON.parse(value || '[]'); } catch { currentValues = []; }
  
  const toggleValue = (val: string) => {
    let newValues = [...currentValues];
    if (newValues.includes(val)) {
      newValues = newValues.filter(v => v !== val);
    } else {
      newValues.push(val);
    }
    onChange(JSON.stringify(newValues));
  };

  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/60 mb-2">{label}</label>
      <div className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-3 text-sm max-h-[150px] overflow-y-auto custom-scrollbar space-y-1">
        {options.map(opt => (
          <label key={opt.value} className="flex items-center gap-2 cursor-pointer hover:bg-foreground/5 p-1 rounded">
            <input 
              type="checkbox" 
              checked={currentValues.includes(opt.value)} 
              onChange={() => toggleValue(opt.value)}
              className="accent-foreground"
            />
            <span className="text-xs truncate">{opt.label}</span>
          </label>
        ))}
        {options.length === 0 && <span className="text-xs text-foreground/40">No items available</span>}
      </div>
      {hint && <p className="text-[10px] text-foreground/30 mt-1.5 ml-1">{hint}</p>}
    </div>
  );
}

function SettingsToggle({ label, checked, onChange, hint }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-3 cursor-pointer group">
        <div 
          onClick={() => onChange(!checked)}
          className={`w-10 h-5 rounded-full transition-all duration-500 relative ${checked ? 'bg-foreground' : 'bg-foreground/10'}`}
        >
          <div className={`absolute top-1 w-3 h-3 rounded-full transition-all duration-500 ${checked ? 'left-6 bg-background' : 'left-1 bg-foreground/40'}`} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/60 group-hover:text-foreground transition-colors">{label}</span>
      </label>
      {hint && <p className="text-[9px] text-foreground/20 ml-13">{hint}</p>}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, description }: { icon: any; title: string; description?: string }) {
  return (
    <div className="mb-6 pb-2 border-b border-foreground/5">
      <h4 className="flex items-center gap-2 text-[12px] font-bold text-foreground/80 uppercase tracking-widest">
        <Icon className="w-4 h-4" /> {title}
      </h4>
      {description && <p className="text-[10px] text-foreground/30 mt-1 font-medium">{description}</p>}
    </div>
  );
}

function ProductMultiPicker({
  label,
  value,
  onChange,
  allProducts,
  hint,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  allProducts: any[];
  hint?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedKeys = useMemo(() => {
    if (!value) return [];
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }, [value]);

  const selectedProducts = useMemo(() => {
    return selectedKeys.map(key => {
      const match = allProducts.find(p => p.handle === key || p.id === key || String(p.id).endsWith(key));
      return match || { id: key, handle: key, title: key, featuredImage: null, price: null };
    });
  }, [selectedKeys, allProducts]);

  const toggleSelect = (handleOrId: string) => {
    let next: string[];
    if (selectedKeys.includes(handleOrId)) {
      next = selectedKeys.filter(k => k !== handleOrId);
    } else {
      next = [...selectedKeys, handleOrId];
    }
    onChange(next.join(', '));
  };

  const removeKey = (keyToRemove: string) => {
    const next = selectedKeys.filter(k => k !== keyToRemove);
    onChange(next.join(', '));
  };

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return allProducts;
    const q = search.toLowerCase();
    return allProducts.filter(p => p.title?.toLowerCase().includes(q) || p.handle?.toLowerCase().includes(q));
  }, [allProducts, search]);

  return (
    <div className="space-y-3">
      <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/60">{label}</label>
      
      {/* Selected Products Badges Grid */}
      {selectedProducts.length > 0 && (
        <div className="flex flex-wrap gap-2 p-3 rounded-2xl bg-foreground/[0.03] border border-foreground/10 max-h-36 overflow-y-auto custom-scrollbar">
          {selectedProducts.map((prod) => (
            <div key={prod.handle || prod.id} className="flex items-center gap-2 bg-foreground/10 hover:bg-foreground/15 border border-foreground/10 pl-1.5 pr-2 py-1 rounded-xl text-xs transition-all">
              {prod.featuredImage || prod.images?.[0]?.url ? (
                <img src={prod.featuredImage || prod.images?.[0]?.url} alt="" className="w-6 h-6 rounded-lg object-cover" />
              ) : (
                <div className="w-6 h-6 rounded-lg bg-foreground/10 flex items-center justify-center text-[9px] font-bold">
                  {(prod.title || 'P')[0]}
                </div>
              )}
              <span className="font-semibold text-foreground/80 max-w-[140px] truncate">{prod.title || prod.handle}</span>
              <button
                type="button"
                onClick={() => removeKey(prod.handle || prod.id)}
                className="w-4 h-4 rounded-full bg-foreground/20 hover:bg-red-500 hover:text-white flex items-center justify-center text-[10px] ml-1 transition-colors"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Select Products Trigger */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between bg-foreground/5 hover:bg-foreground/[0.07] border border-foreground/10 rounded-2xl px-4 py-3.5 text-xs font-semibold text-left transition-all"
        >
          <span className="text-foreground/70">
            {selectedKeys.length > 0 ? `${selectedKeys.length} Product(s) Selected` : "Click to select products from catalog..."}
          </span>
          <ChevronDown className={`w-4 h-4 text-foreground/40 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute z-50 mt-2 w-full bg-background/95 backdrop-blur-2xl border border-foreground/15 rounded-2xl shadow-2xl p-3 space-y-3 max-h-80 overflow-hidden flex flex-col">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
              <input
                type="text"
                placeholder="Search products by title or handle..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-foreground/5 border border-foreground/10 rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-foreground/20"
              />
            </div>

            <div className="overflow-y-auto flex-1 space-y-1 pr-1 custom-scrollbar">
              {filteredProducts.length === 0 ? (
                <p className="text-xs text-foreground/40 text-center py-4">No products found</p>
              ) : (
                filteredProducts.map(p => {
                  const key = p.handle || p.id;
                  const isSelected = selectedKeys.includes(key);
                  const img = p.featuredImage || p.images?.[0]?.url;

                  return (
                    <button
                      key={p.id || p.handle}
                      type="button"
                      onClick={() => toggleSelect(key)}
                      className={`w-full flex items-center gap-3 p-2 rounded-xl text-left transition-colors ${isSelected ? 'bg-foreground/15 border border-foreground/20' : 'hover:bg-foreground/5'}`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-foreground/10 overflow-hidden shrink-0 flex items-center justify-center">
                        {img ? (
                          <img src={img} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ShoppingBag className="w-4 h-4 text-foreground/30" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-foreground/80 truncate">{p.title}</p>
                        <p className="text-[10px] text-foreground/40 font-mono truncate">{p.handle} {p.price ? `• ₹${p.price}` : ''}</p>
                      </div>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center text-[10px] font-bold">
                          ✓
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {hint && <p className="text-[10px] text-foreground/30 font-medium">{hint}</p>}
    </div>
  );
}

export default function AppIntegrationPage() {
  const [endpoints, setEndpoints] = useState<EndpointStatus[]>([
    { name: 'Products', path: '/api/app/products', method: 'GET', status: 'loading', icon: ShoppingBag },
    { name: 'Collections', path: '/api/app/collections', method: 'GET', status: 'loading', icon: Package },
    { name: 'Search', path: '/api/app/search?q=tees', method: 'GET', status: 'loading', icon: Globe },
    { name: 'App Config', path: '/api/app/config', method: 'GET', status: 'loading', icon: Settings },
    { name: 'Customers', path: '/api/app/customers?all=true&limit=5', method: 'GET', status: 'loading', icon: Users },
    { name: 'Cart API', path: '/api/app/cart', method: 'GET', status: 'loading', icon: ShoppingCart },
    { name: 'Orders API', path: '/api/app/orders', method: 'GET', status: 'loading', icon: FileText },
    { name: 'Profile API', path: '/api/app/profile', method: 'GET', status: 'loading', icon: User },
    { name: 'Returns API', path: '/api/app/returns', method: 'GET', status: 'loading', icon: Undo2 },
    { name: 'Exchanges API', path: '/api/app/exchanges', method: 'GET', status: 'loading', icon: ArrowLeftRight },
    { name: 'Public Settings', path: '/api/app/settings', method: 'GET', status: 'loading', icon: Shield },
    { name: 'Wishlist API', path: '/api/wishlist', method: 'GET', status: 'loading', icon: Heart },
  ]);

  const [syncStats, setSyncStats] = useState<SyncStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [testing, setTesting] = useState(false);

  const [settings, setSettings] = useState<any>(null);
  const [allCollections, setAllCollections] = useState<Collection[]>([]);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('hero');
  const [searchQuery, setSearchQuery] = useState("");

  const testEndpoints = useCallback(async () => {
    setTesting(true);
    
    // Helper to test a single endpoint
    const testOne = async (ep: EndpointStatus) => {
      const start = Date.now();
      try {
        const res = await fetch(ep.path);
        const elapsed = Date.now() - start;
        let count: number | undefined;
        let errorMessage: string | undefined;

        try {
          const data = await res.json();
          count = data.total || data.dataCount || (data.products ? data.products.length : undefined) || (data.collections ? data.collections.length : undefined) || (Array.isArray(data) ? data.length : undefined);
          if (data.error && res.status >= 500) errorMessage = data.error;
        } catch { /* non-json response */ }

        // Endpoint is healthy and responding if HTTP status is < 500
        const isOk = res.status < 500;

        return { 
          ...ep, 
          status: isOk ? 'ok' as const : 'error' as const, 
          responseTime: elapsed, 
          dataCount: count,
          error: errorMessage
        };
      } catch (err: any) {
        return { ...ep, status: 'error' as const, responseTime: Date.now() - start, error: err.message };
      }
    };

    setEndpoints(prev => {
      // Run test asynchronously and update
      Promise.all(prev.map(testOne)).then(results => {
        setEndpoints(results);
        setTesting(false);
      });
      return prev;
    });
  }, []);

  const fetchSyncStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      // Use the new centralized sync-stats API for maximum speed
      const res = await fetch('/api/admin/sync-stats');
      const data = await res.json();
      
      if (data.success && data.stats) {
        setSyncStats({
          productsCount: data.stats.productsCount,
          collectionsCount: 0, // Will fetch separately
          customersCount: data.stats.customersCount,
          ordersCount: data.stats.ordersCount,
          returnsCount: data.stats.returnsCount,
          exchangesCount: data.stats.exchangesCount,
          lastChecked: new Date().toLocaleTimeString(),
        });
      }

      // Fetch collections separately as they are relatively small and needed for the UI
      const collRes = await fetch('/api/app/collections?all=true');
      const collData = await collRes.json();
      if (collData.collections) {
        setAllCollections(collData.collections);
        setSyncStats(prev => prev ? { ...prev, collectionsCount: collData.collections.length } : null);
      }

      const prodRes = await fetch('/api/app/products?all=true');
      const prodData = await prodRes.json();
      if (prodData.products) {
        setAllProducts(prodData.products);
      }
    } catch (err) {
      console.error('Error fetching sync stats:', err);
    } finally {
      setLoadingStats(false);
      setLoadingCollections(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings');
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  }, []);

  useEffect(() => {
    testEndpoints();
    fetchSyncStats();
    fetchSettings();
  }, []);

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    setSaveStatus('idle');
    setSaveMessage('');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: settings.id,
          ...settings,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSaveStatus('success');
        setSaveMessage('Settings saved — app will update within 10 seconds');
        testEndpoints();
      } else {
        setSaveStatus('error');
        setSaveMessage(data.error || 'Failed to save settings.');
      }
    } catch (err: any) {
      setSaveStatus('error');
      setSaveMessage(`Save failed: ${err.message}`);
    } finally {
      setSavingSettings(false);
      setTimeout(() => { setSaveStatus('idle'); setSaveMessage(''); }, 4000);
    }
  };

  const updateSetting = (key: string, value: any) => {
    setSettings((prev: any) => {
      const updated = { ...prev, [key]: value };

      if (key === 'featuredMedia') {
        const val = typeof value === 'string' ? value.trim() : '';
        const isImage = /\.(jpg|jpeg|png|gif|webp|svg|png|PNG)(\?|$)/i.test(val);
        
        if (val === '') {
          updated.featuredMedia = '';
          updated.featuredMediaImage = '';
        } else if (isImage) {
          updated.featuredMedia = '';
          updated.featuredMediaImage = val;
        } else {
          updated.featuredMedia = val;
          updated.featuredMediaImage = '';
        }
      }

      if (key === 'flipbookVideo') {
        const val = typeof value === 'string' ? value.trim() : '';
        const isImage = /\.(jpg|jpeg|png|gif|webp|svg|png|PNG)(\?|$)/i.test(val);
        
        if (val === '') {
          updated.flipbookVideo = '';
          updated.flipbookImage = '';
        } else if (isImage) {
          updated.flipbookVideo = '';
          updated.flipbookImage = val;
        } else {
          updated.flipbookVideo = val;
          updated.flipbookImage = '';
        }
      }

      return updated;
    });
  };

  const toggleCollection = (handle: string, location: 'Header' | 'Page' | 'Menu') => {
    const key = `enabledCollections${location}`;
    const current = JSON.parse(settings[key] || '[]');
    let updated;
    if (current.includes(handle)) {
      updated = current.filter((h: string) => h !== handle);
    } else {
      updated = [...current, handle];
    }
    updateSetting(key, JSON.stringify(updated));
  };

  const allHealthy = endpoints.every(ep => ep.status === 'ok');
  const healthyCount = endpoints.filter(e => e.status === 'ok').length;
  const avgResponse = endpoints.filter(ep => ep.responseTime).reduce((sum, ep) => sum + (ep.responseTime || 0), 0) / (endpoints.filter(ep => ep.responseTime).length || 1);

  const filteredCollections = useMemo(() => {
    return allCollections.filter(c => 
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      c.handle.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allCollections, searchQuery]);

  const pdpTrustBoxes = useMemo(
    () => parsePdpTrustBoxes(settings?.pdpTrustBoxes),
    [settings?.pdpTrustBoxes]
  );

  const setPdpTrustBoxes = (next: PdpTrustBox[]) => {
    updateSetting('pdpTrustBoxes', JSON.stringify(next));
  };

  const tabs: { key: SettingsTab; label: string; icon: any }[] = [
    { key: 'hero', label: 'Hero', icon: Smartphone },
    { key: 'layout', label: 'Home Layout', icon: Layers },
    { key: 'collections', label: 'Collections', icon: Package },
    { key: 'pdp', label: 'Product Page', icon: Eye },
    { key: 'social', label: 'Social', icon: Globe },
    { key: 'community', label: 'Community', icon: MessageCircle },
    { key: 'advanced', label: 'System', icon: Settings },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="max-w-6xl mx-auto space-y-10 pb-20 relative z-10"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-10 px-4 pt-10 mb-16 relative z-10">
        <div className="space-y-4">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-foreground/5 flex items-center justify-center text-foreground/30 border border-foreground/5 shadow-2xl">
              <Smartphone className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-4xl md:text-5xl font-bold text-foreground uppercase tracking-tighter leading-none">
                App Integration
              </h1>
              <p className="text-[11px] text-foreground/30 font-bold uppercase tracking-[0.4em] mt-2">
                Zica Bella Mobile Dashboard
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => { testEndpoints(); fetchSyncStats(); }}
            disabled={testing}
            className="flex items-center justify-center gap-3 px-8 py-3 rounded-2xl text-[10px] font-bold tracking-[0.3em] uppercase bg-foreground/5 text-foreground/60 border border-foreground/10 hover:bg-foreground/10 transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} strokeWidth={2.5} />
            {testing ? 'Testing...' : 'Check Status'}
          </button>

          {settings && (
            <button
              onClick={saveSettings}
              disabled={savingSettings}
              className="flex items-center justify-center gap-3 px-10 py-3 rounded-2xl text-[10px] font-bold tracking-[0.3em] uppercase bg-foreground text-background shadow-2xl shadow-foreground/20 hover:opacity-95 transition-all active:scale-95 disabled:opacity-50"
            >
              {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {savingSettings ? 'Saving...' : 'Publish Changes'}
            </button>
          )}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Sidebar: Status & Sync */}
        <div className="lg:col-span-4 space-y-8">
          {/* Health Banner */}
          <GlassCard className="!bg-foreground/[0.02]">
            <div className="px-8 py-8">
              <div className="flex items-center justify-between mb-6">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${
                  allHealthy ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-amber-500/10 border-amber-500/20 text-amber-500'
                }`}>
                  {allHealthy ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
                </div>
                <div className={`px-3 py-1 rounded-full text-[8px] font-bold tracking-widest uppercase ${
                  allHealthy ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                }`}>
                  {allHealthy ? 'Online' : 'Limited'}
                </div>
              </div>
              <h2 className="text-[18px] font-bold text-foreground tracking-tight mb-2">
                {allHealthy ? 'Systems Operational' : 'Connection Issues'}
              </h2>
              <p className="text-[11px] text-foreground/30 font-medium leading-relaxed">
                {healthyCount} of {endpoints.length} endpoints are responding. Avg: {Math.round(avgResponse)}ms
              </p>
            </div>
          </GlassCard>

          {/* Sync Stats */}
          <div className="space-y-4">
            <h3 className="px-6 text-[10px] font-bold uppercase tracking-[0.4em] text-foreground/25">Live Data Sync</h3>
            <GlassCard>
              {loadingStats ? (
                <div className="flex items-center justify-center py-16 gap-3">
                  <Loader2 className="w-5 h-5 text-foreground/25 animate-spin" />
                </div>
              ) : syncStats ? (
                <>
                  <StatBlock icon={ShoppingBag} label="Products" value={syncStats.productsCount} />
                  <StatBlock icon={Package} label="Collections" value={syncStats.collectionsCount} />
                  <StatBlock icon={Users} label="Customers" value={syncStats.customersCount} />
                  <StatBlock icon={FileText} label="Orders" value={syncStats.ordersCount} />
                  <div className="px-8 py-4 bg-foreground/[0.02]">
                    <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-foreground/15">
                      Syncing every 10 seconds
                    </span>
                  </div>
                </>
              ) : null}
            </GlassCard>
          </div>

          {/* Endpoint List */}
          <div className="space-y-4">
            <h3 className="px-6 text-[10px] font-bold uppercase tracking-[0.4em] text-foreground/25">API Registry</h3>
            <GlassCard className="max-h-[400px] overflow-y-auto custom-scrollbar">
              {endpoints.map((ep, i) => (
                <EndpointRow key={i} ep={ep} />
              ))}
            </GlassCard>
          </div>
        </div>

        {/* Right Content: Settings */}
        <div className="lg:col-span-8 space-y-8">
          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 px-2 overflow-x-auto pb-4 no-scrollbar">
            {tabs.map(tab => {
              const TabIcon = tab.icon;
              const isActive = settingsTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setSettingsTab(tab.key)}
                  className={`flex items-center gap-3 px-6 py-3.5 rounded-2xl text-[10px] font-bold uppercase tracking-[0.2em] whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-foreground text-background shadow-2xl shadow-foreground/20'
                      : 'text-foreground/40 hover:bg-foreground/5 hover:text-foreground/60'
                  }`}
                >
                  <TabIcon className={`w-4 h-4 ${isActive ? 'text-background' : 'text-foreground/20'}`} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Success/Error Message */}
          <AnimatePresence>
            {saveStatus !== 'idle' && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`px-8 py-4 rounded-[1.5rem] mb-6 flex items-center gap-3 ${
                  saveStatus === 'success' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                }`}
              >
                {saveStatus === 'success' ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                <span className="text-[11px] font-bold uppercase tracking-wider">{saveMessage}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <GlassCard className="min-h-[600px]">
            {settings ? (
              <div className="p-10 space-y-12">
                
                {/* ── Hero Tab ── */}
                {settingsTab === 'hero' && (
                  <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <SectionHeader 
                      icon={Smartphone} 
                      title="Landing Experience" 
                      description="Configure the primary hero section of the mobile application."
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <SettingsInput label="Hero Title" value={settings.heroTitle || ''} onChange={v => updateSetting('heroTitle', v)} placeholder="ZICA BELLA" />
                      <SettingsInput label="Button Text" value={settings.heroButtonText || ''} onChange={v => updateSetting('heroButtonText', v)} placeholder="Discover" />
                      <div className="md:col-span-2">
                        <SettingsInput label="Subtitle" value={settings.heroSubtitle || ''} onChange={v => updateSetting('heroSubtitle', v)} placeholder="Enter subtitle..." />
                      </div>
                      <SettingsInput label="Video URL" value={settings.heroVideo || ''} onChange={v => updateSetting('heroVideo', v)} placeholder="https://..." hint="Primary background video (MP4)" />
                      <SettingsInput label="Fallback Image" value={settings.heroImage || ''} onChange={v => updateSetting('heroImage', v)} placeholder="https://..." hint="Shown while video loads" />
                      <div className="md:col-span-2 py-4">
                        <SettingsToggle label="Overlay Text Visibility" checked={settings.showHeroText ?? true} onChange={v => updateSetting('showHeroText', v)} hint="Enable or disable the text overlay on the hero video" />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Layout Tab ── */}
                {settingsTab === 'layout' && (
                  <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    {/* Latest Curation */}
                    <div className="space-y-8 pt-8 border-t border-foreground/5">
                      <SectionHeader icon={Package} title="Latest Curation" description="The first product grid section on home." />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <SettingsInput label="Section Title" value={settings.latestCurationTitle || ''} onChange={v => updateSetting('latestCurationTitle', v)} placeholder="LATEST CURATION" />
                        <SettingsInput label="Section Subtitle" value={settings.latestCurationSubtitle || ''} onChange={v => updateSetting('latestCurationSubtitle', v)} placeholder="SEASON DROP" />
                      </div>
                    </div>

                    {/* The Archive */}
                    <div className="space-y-8 pt-8 border-t border-foreground/5">
                      <SectionHeader icon={Layers} title="The Archive" description="The horizontal collection carousel section." />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <SettingsInput label="Archive Title" value={settings.archiveTitle || ''} onChange={v => updateSetting('archiveTitle', v)} placeholder="THE ARCHIVE" />
                        <SettingsInput label="Archive Subtitle" value={settings.archiveSubtitle || ''} onChange={v => updateSetting('archiveSubtitle', v)} placeholder="SUSTAINABLE EVOLUTION" />
                        <div className="md:col-span-2">
                           <SettingsInput label="Featured Video URL" value={settings.collectionsMedia || ''} onChange={v => updateSetting('collectionsMedia', v)} placeholder="https://..." hint="Video shown above the archive carousel" />
                        </div>
                      </div>
                    </div>

                    {/* Ring Carousel */}
                    <div className="space-y-8 pt-8 border-t border-foreground/5">
                      <SectionHeader icon={BarChart3} title="Accessories Carousel" description="The 'Ring Carousel' section for accessories." />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <SettingsInput label="Carousel Title" value={settings.ringCarouselTitle || ''} onChange={v => updateSetting('ringCarouselTitle', v)} />
                        <div className="flex items-end pb-2">
                          <SettingsToggle label="Show Section" checked={settings.showRingCarousel ?? true} onChange={v => updateSetting('showRingCarousel', v)} />
                        </div>
                        <div className="md:col-span-2">
                          <SettingsMultiSelect 
                            label="Featured Products" 
                            value={settings.ringCarouselItems || '[]'} 
                            onChange={v => updateSetting('ringCarouselItems', v)} 
                            options={allProducts.map(p => ({ label: p.title, value: p.handle }))}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Flipbook */}
                    <div className="space-y-8 pt-8 border-t border-foreground/5">
                      <SectionHeader icon={ImageIcon} title="Feature Flipbook" description="Full-width visual feature section." />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <SettingsInput label="Feature Title" value={settings.flipbookTitle || ''} onChange={v => updateSetting('flipbookTitle', v)} />
                        <SettingsInput label="Feature Tag" value={settings.flipbookTag || ''} onChange={v => updateSetting('flipbookTag', v)} />
                        <div className="md:col-span-2">
                          <SettingsInput label="Description" value={settings.flipbookDesc || ''} onChange={v => updateSetting('flipbookDesc', v)} />
                        </div>
                        <SettingsInput label="Media URL" value={settings.flipbookVideo || settings.flipbookImage || ''} onChange={v => updateSetting('flipbookVideo', v)} placeholder="https://..." hint="Supports Video (MP4) or Image" />
                      </div>
                    </div>

                    {/* Featured Media */}
                    <div className="space-y-8 pt-8 border-t border-foreground/5">
                      <SectionHeader icon={ImageIcon} title="Featured Media Section" description="Full-screen editorial image/video shown above the Spotlight section." />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <SettingsInput 
                          label="Overlay Title" 
                          value={settings.blueprintTitle || ''} 
                          onChange={v => updateSetting('blueprintTitle', v)} 
                          placeholder="e.g. THE BLUEPRINT"
                          hint="Main heading displayed at the bottom of the media"
                        />
                        <SettingsInput 
                          label="Overlay Subtitle" 
                          value={settings.blueprintSubtitle || ''} 
                          onChange={v => updateSetting('blueprintSubtitle', v)} 
                          placeholder="e.g. Technique & Motion"
                          hint="Secondary caption below the title"
                        />
                        <div className="md:col-span-2">
                          <SettingsInput 
                            label="Media URL (Video / Image)" 
                            value={settings.featuredMedia || settings.featuredMediaImage || ''} 
                            onChange={v => updateSetting('featuredMedia', v)} 
                            placeholder="https://... (MP4 or image URL)"
                            hint="Full-screen media displayed above Spotlight. Supports video (MP4) or image."
                          />
                        </div>
                      </div>
                    </div>

                    {/* Homepage Products Curation */}
                    <div className="space-y-8 pt-8 border-t border-foreground/5">
                      <SectionHeader icon={Sparkles} title="Homepage Products Curation" description="Configure the main 12-product listing grid on your mobile application." />
                      <div className="p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.05] flex items-start gap-3 mb-2">
                        <Info className="w-4 h-4 text-foreground/30 mt-0.5 shrink-0" />
                        <p className="text-[10px] text-foreground/40 leading-relaxed">
                          Configure which collection or specific products appear as the main listing on the mobile app home screen.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <SettingsSelect 
                          label="Collection" 
                          value={settings.homepageCollection || ''} 
                          onChange={v => updateSetting('homepageCollection', v)}
                          options={[
                            { label: 'Newest Products (Default)', value: '' },
                            ...allCollections.map(c => ({ label: c.title, value: c.handle }))
                          ]}
                          hint="Shopify collection to display on homepage"
                        />
                        <div className="md:col-span-2">
                          <ProductMultiPicker 
                            label="Specific Homepage Products Grid" 
                            value={settings.homepageProducts || ''} 
                            onChange={v => updateSetting('homepageProducts', v)}
                            allProducts={allProducts}
                            hint="Select specific products to feature at the top of the main homepage grid"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Spotlight */}
                    <div className="space-y-8 pt-8 border-t border-foreground/5">
                      <SectionHeader icon={Eye} title="Spotlight Section (Authentic Streetwear)" description="The featured collection grid section — editable title, subtitle and collection." />
                      <div className="p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.05] flex items-start gap-3 mb-2">
                        <Info className="w-4 h-4 text-foreground/30 mt-0.5 shrink-0" />
                        <p className="text-[10px] text-foreground/40 leading-relaxed">
                          The &quot;AUTHENTIC STREETWEAR&quot; heading and subtitle are fully editable below. Changes will reflect in the app within seconds after saving.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <SettingsInput 
                          label="Section Title" 
                          value={settings.spotlightTitle || ''} 
                          onChange={v => updateSetting('spotlightTitle', v)}
                          placeholder="e.g. AUTHENTIC STREETWEAR"
                          hint="Displayed in Rocaston brand font — two lines"
                        />
                        <SettingsSelect 
                          label="Collection" 
                          value={settings.spotlightCollection || ''} 
                          onChange={v => updateSetting('spotlightCollection', v)}
                          options={allCollections.map(c => ({ label: c.title, value: c.handle }))}
                          hint="Shopify collection to display products from"
                        />
                        <div className="md:col-span-2">
                          <SettingsInput 
                            label="Section Subtitle" 
                            value={settings.spotlightSubtitle || ''} 
                            onChange={v => updateSetting('spotlightSubtitle', v)}
                            placeholder="e.g. Luxury Indian streetwear for modern men."
                          />
                        </div>
                        <div className="md:col-span-2">
                          <ProductMultiPicker 
                            label="Specific Products (Authentic Streetwear)" 
                            value={settings.spotlightProducts || ''} 
                            onChange={v => updateSetting('spotlightProducts', v)}
                            allProducts={allProducts}
                            hint="Select specific products to feature in the Authentic Streetwear section"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Collections Tab ── */}
                {settingsTab === 'collections' && (
                  <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <div className="flex items-center justify-between">
                      <SectionHeader 
                        icon={Package} 
                        title="Shopify Collections" 
                        description="Manage which collections appear in different parts of the app."
                      />
                    </div>

                    <div className="relative mb-6">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20" />
                      <input 
                        type="text" 
                        placeholder="Search collections..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-foreground/5 border border-foreground/10 rounded-2xl pl-12 pr-4 py-4 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-all"
                      />
                    </div>

                    <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                      {loadingCollections ? (
                        <div className="py-20 flex flex-col items-center gap-4">
                          <Loader2 className="w-6 h-6 animate-spin text-foreground/10" />
                        </div>
                      ) : filteredCollections.length > 0 ? (
                        filteredCollections.map((c) => {
                          const inHeader = JSON.parse(settings.enabledCollectionsHeader || '[]').includes(c.handle);
                          const inPage = JSON.parse(settings.enabledCollectionsPage || '[]').includes(c.handle);
                          const inMenu = JSON.parse(settings.enabledCollectionsMenu || '[]').includes(c.handle);

                          return (
                            <div key={c.id} className="flex items-center gap-6 p-4 rounded-2xl hover:bg-foreground/[0.02] border border-transparent hover:border-foreground/5 transition-all group">
                              <div className="w-12 h-12 rounded-xl bg-foreground/5 overflow-hidden flex-shrink-0">
                                {c.image ? (
                                  <img src={c.image} alt="" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-foreground/10">
                                    <Package className="w-5 h-5" />
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h5 className="text-[13px] font-bold text-foreground/80">{c.title}</h5>
                                <p className="text-[10px] font-mono text-foreground/25">{c.handle}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                {[
                                  { label: 'Header', active: inHeader },
                                  { label: 'Page', active: inPage },
                                  { label: 'Menu', active: inMenu }
                                ].map((loc) => (
                                  <button
                                    key={loc.label}
                                    onClick={() => toggleCollection(c.handle, loc.label as any)}
                                    className={`px-4 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all border ${
                                      loc.active 
                                        ? 'bg-foreground text-background border-foreground shadow-lg shadow-foreground/10' 
                                        : 'bg-transparent text-foreground/20 border-foreground/10 hover:border-foreground/20'
                                    }`}
                                  >
                                    {loc.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="py-20 text-center">
                          <p className="text-[11px] text-foreground/20 font-bold uppercase tracking-widest">No collections found</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── PDP Tab ── */}
                {settingsTab === 'pdp' && (
                  <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <SectionHeader icon={Eye} title="Product Detail Page" description="Manage visibility of sections on product pages." />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                      <div className="space-y-8">
                         <SettingsInput label="Global Background Media" value={settings.pdpBackground || ''} onChange={v => updateSetting('pdpBackground', v)} placeholder="https://..." hint="Subtle background for product pages" />
                         <div className="pt-4 space-y-4">
                           <h5 className="text-[10px] font-bold uppercase tracking-widest text-foreground/40">Section Visibility</h5>
                           <div className="grid grid-cols-1 gap-4">
                             <SettingsToggle label="Auto-play Product Videos" checked={settings.showProductVideo ?? true} onChange={v => updateSetting('showProductVideo', v)} />
                             <SettingsToggle label="Size Charts & Tables" checked={settings.showSizeChart ?? true} onChange={v => updateSetting('showSizeChart', v)} />
                             <SettingsToggle label="Brand Story Section" checked={settings.showBrand ?? true} onChange={v => updateSetting('showBrand', v)} />
                             <SettingsToggle label="Care Instructions" checked={settings.showCare ?? true} onChange={v => updateSetting('showCare', v)} />
                           </div>
                         </div>
                      </div>
                      <div className="space-y-8 pt-10">
                        <div className="p-8 rounded-[2rem] bg-foreground/5 border border-foreground/5">
                           <div className="flex items-start gap-4 mb-6">
                             <Info className="w-5 h-5 text-foreground/20" />
                             <div>
                               <h6 className="text-[12px] font-bold text-foreground/60 mb-2">Display Mode</h6>
                               <p className="text-[10px] text-foreground/25 leading-relaxed">
                                 The product page uses a vertical scroll layout. Toggling these sections will instantly hide/show them in the mobile app.
                               </p>
                             </div>
                           </div>
                           <div className="space-y-4">
                             <SettingsToggle label="Technical Details" checked={settings.showDetails ?? true} onChange={v => updateSetting('showDetails', v)} />
                             <SettingsToggle label="Size & Fit Guide" checked={settings.showSizeFit ?? true} onChange={v => updateSetting('showSizeFit', v)} />
                             <SettingsToggle label="Shipping Info" checked={settings.showShippingReturn ?? true} onChange={v => updateSetting('showShippingReturn', v)} />
                           </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6 pt-4 border-t border-foreground/5">
                      <SectionHeader
                        icon={Layers}
                        title="Price & Model Line"
                        description="Tax label under price, and default model/fit copy when a product has no custom.model_info metafield."
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                          <SettingsToggle
                            label="Show “Incl. taxes” under price"
                            checked={settings.pdpShowInclTaxes !== false}
                            onChange={(v) => updateSetting('pdpShowInclTaxes', v)}
                          />
                          <SettingsInput
                            label="Incl. taxes label"
                            value={settings.pdpInclTaxesText ?? DEFAULT_PDP_INCL_TAXES_TEXT}
                            onChange={(v) => updateSetting('pdpInclTaxesText', v)}
                            placeholder={DEFAULT_PDP_INCL_TAXES_TEXT}
                          />
                        </div>
                        <SettingsInput
                          label="Default model / fit line"
                          value={settings.pdpModelInfoDefault ?? DEFAULT_PDP_MODEL_INFO}
                          onChange={(v) => updateSetting('pdpModelInfoDefault', v)}
                          placeholder={DEFAULT_PDP_MODEL_INFO}
                          hint="Override per product via metafield custom.model_info"
                        />
                      </div>
                    </div>

                    <div className="space-y-6 pt-4 border-t border-foreground/5">
                      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                        <SectionHeader
                          icon={Sparkles}
                          title="Trust / Offer Boxes"
                          description="2×2 grid under Add to Bag / Buy Now. Highlight = black tile (prepaid). Drag to reorder."
                        />
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setPdpTrustBoxes(DEFAULT_PDP_TRUST_BOXES.map((b) => ({ ...b })))}
                            className="px-3 py-2 rounded-xl text-[9px] font-bold uppercase tracking-widest border border-foreground/10 text-foreground/50 hover:text-foreground"
                          >
                            Reset defaults
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPdpTrustBoxes([
                                ...pdpTrustBoxes,
                                {
                                  id: `box_${Date.now().toString(36)}`,
                                  icon: 'information-circle-outline',
                                  title: 'New benefit',
                                  subtitle: 'Editable subtext',
                                  variant: 'default',
                                },
                              ])
                            }
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-bold uppercase tracking-widest bg-foreground text-background"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add box
                          </button>
                        </div>
                      </div>

                      <Reorder.Group
                        axis="y"
                        values={pdpTrustBoxes}
                        onReorder={setPdpTrustBoxes}
                        className="space-y-3"
                      >
                        {pdpTrustBoxes.map((box) => (
                          <Reorder.Item
                            key={box.id}
                            value={box}
                            className={`rounded-2xl border p-4 ${
                              box.variant === 'highlight'
                                ? 'bg-foreground text-background border-foreground'
                                : 'bg-foreground/[0.03] border-foreground/10'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`mt-2 cursor-grab active:cursor-grabbing ${box.variant === 'highlight' ? 'text-background/50' : 'text-foreground/30'}`}>
                                <GripVertical className="w-4 h-4" />
                              </div>
                              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label className={`block text-[9px] font-bold uppercase tracking-widest mb-1.5 ${box.variant === 'highlight' ? 'text-background/50' : 'text-foreground/40'}`}>
                                    Icon (Ionicons name or image URL)
                                  </label>
                                  <input
                                    value={box.icon}
                                    onChange={(e) =>
                                      setPdpTrustBoxes(
                                        pdpTrustBoxes.map((b) =>
                                          b.id === box.id ? { ...b, icon: e.target.value } : b
                                        )
                                      )
                                    }
                                    className={`w-full rounded-xl px-3 py-2.5 text-[12px] outline-none border ${
                                      box.variant === 'highlight'
                                        ? 'bg-background/10 border-background/20 text-background placeholder:text-background/40'
                                        : 'bg-background border-foreground/10 text-foreground'
                                    }`}
                                    placeholder="cash-outline"
                                  />
                                </div>
                                <div>
                                  <label className={`block text-[9px] font-bold uppercase tracking-widest mb-1.5 ${box.variant === 'highlight' ? 'text-background/50' : 'text-foreground/40'}`}>
                                    Style
                                  </label>
                                  <select
                                    value={box.variant}
                                    onChange={(e) =>
                                      setPdpTrustBoxes(
                                        pdpTrustBoxes.map((b) =>
                                          b.id === box.id
                                            ? {
                                                ...b,
                                                variant:
                                                  e.target.value === 'highlight' ? 'highlight' : 'default',
                                              }
                                            : b
                                        )
                                      )
                                    }
                                    className={`w-full rounded-xl px-3 py-2.5 text-[12px] outline-none border appearance-none ${
                                      box.variant === 'highlight'
                                        ? 'bg-background/10 border-background/20 text-background'
                                        : 'bg-background border-foreground/10 text-foreground'
                                    }`}
                                  >
                                    <option value="default">Grey (default)</option>
                                    <option value="highlight">Black / white (prepaid)</option>
                                  </select>
                                </div>
                                <div>
                                  <label className={`block text-[9px] font-bold uppercase tracking-widest mb-1.5 ${box.variant === 'highlight' ? 'text-background/50' : 'text-foreground/40'}`}>
                                    Title
                                  </label>
                                  <input
                                    value={box.title}
                                    onChange={(e) =>
                                      setPdpTrustBoxes(
                                        pdpTrustBoxes.map((b) =>
                                          b.id === box.id ? { ...b, title: e.target.value } : b
                                        )
                                      )
                                    }
                                    className={`w-full rounded-xl px-3 py-2.5 text-[12px] font-semibold outline-none border ${
                                      box.variant === 'highlight'
                                        ? 'bg-background/10 border-background/20 text-background'
                                        : 'bg-background border-foreground/10 text-foreground'
                                    }`}
                                  />
                                </div>
                                <div>
                                  <label className={`block text-[9px] font-bold uppercase tracking-widest mb-1.5 ${box.variant === 'highlight' ? 'text-background/50' : 'text-foreground/40'}`}>
                                    Subtext
                                  </label>
                                  <input
                                    value={box.subtitle}
                                    onChange={(e) =>
                                      setPdpTrustBoxes(
                                        pdpTrustBoxes.map((b) =>
                                          b.id === box.id ? { ...b, subtitle: e.target.value } : b
                                        )
                                      )
                                    }
                                    className={`w-full rounded-xl px-3 py-2.5 text-[12px] outline-none border ${
                                      box.variant === 'highlight'
                                        ? 'bg-background/10 border-background/20 text-background'
                                        : 'bg-background border-foreground/10 text-foreground'
                                    }`}
                                  />
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setPdpTrustBoxes(pdpTrustBoxes.filter((b) => b.id !== box.id))
                                }
                                className={`mt-2 p-2 rounded-lg ${
                                  box.variant === 'highlight'
                                    ? 'text-background/50 hover:bg-background/10'
                                    : 'text-foreground/30 hover:bg-foreground/5 hover:text-rose-500'
                                }`}
                                aria-label="Remove box"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </Reorder.Item>
                        ))}
                      </Reorder.Group>
                    </div>
                  </div>
                )}

                {/* ── Social Tab ── */}
                {settingsTab === 'social' && (
                  <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <SectionHeader icon={Globe} title="Social Connections" description="Configure links for the app footer and community sections." />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <SettingsInput 
                        label="Instagram URL" 
                        value={settings.instagramUrl || ''} 
                        onChange={v => updateSetting('instagramUrl', v)} 
                        placeholder="https://instagram.com/zica.bella"
                        hint="Primary social channel"
                      />
                      <SettingsInput 
                        label="Spotify URL" 
                        value={settings.spotifyUrl || ''} 
                        onChange={v => updateSetting('spotifyUrl', v)} 
                        placeholder="https://open.spotify.com/..."
                        hint="Music curation channel"
                      />
                      <SettingsInput 
                        label="Apple Music URL" 
                        value={settings.appleUrl || ''} 
                        onChange={v => updateSetting('appleUrl', v)} 
                        placeholder="https://music.apple.com/..."
                        hint="Secondary music channel"
                      />
                      <SettingsInput 
                        label="YouTube URL" 
                        value={settings.youtubeUrl || ''} 
                        onChange={v => updateSetting('youtubeUrl', v)} 
                        placeholder="https://youtube.com/@zicabella"
                        hint="Video archive channel"
                      />
                    </div>
                  </div>
                )}

                {/* ── Community Tab ── */}
                {settingsTab === 'community' && (
                  <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
                      <div className="md:col-span-2">
                        <SectionHeader icon={Users} title="Community Feed" description="Configure the social proof section." />
                      </div>
                      <SettingsInput label="Section Title" value={settings.communityTitle || ''} onChange={v => updateSetting('communityTitle', v)} />
                      <SettingsInput label="Section Subtitle" value={settings.communitySubtitle || ''} onChange={v => updateSetting('communitySubtitle', v)} />
                      <div className="md:col-span-2">
                        <SettingsToggle label="Show Community Section on Homepage" checked={settings.showCommunity ?? true} onChange={v => updateSetting('showCommunity', v)} />
                      </div>

                      <div className="md:col-span-2 pt-8 border-t border-foreground/5">
                        <SectionHeader icon={Shield} title="Membership Rules" />
                      </div>
                      <div className="space-y-8">
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/60 mb-3">Min Orders for Community Badge</label>
                          <input
                            type="number"
                            min={0}
                            value={settings.communityMinOrders ?? 1}
                            onChange={e => updateSetting('communityMinOrders', parseInt(e.target.value) || 0)}
                            className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-all"
                          />
                        </div>
                        <SettingsToggle label="Age Restricted Content" checked={settings.communityAgeRestricted ?? true} onChange={v => updateSetting('communityAgeRestricted', v)} />
                        <SettingsToggle label="WhatsApp Direct Access" checked={settings.communityWhatsAppEnabled ?? true} onChange={v => updateSetting('communityWhatsAppEnabled', v)} />
                      </div>
                      <div className="p-8 rounded-[2rem] bg-foreground/5 border border-foreground/5">
                        <h6 className="text-[11px] font-bold text-foreground/40 uppercase tracking-widest mb-4">Chat Visibility</h6>
                        <div className="space-y-6">
                           <div>
                              <label className="block text-[9px] font-bold text-foreground/30 uppercase tracking-wider mb-2">Access Level</label>
                              <select
                                value={settings.chatAccessMode || 'open'}
                                onChange={e => updateSetting('chatAccessMode', e.target.value)}
                                className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-3 text-xs focus:outline-none"
                              >
                                <option value="open">Open Access</option>
                                <option value="members">Verified Members Only</option>
                                <option value="disabled">Hide Chat Globally</option>
                              </select>
                           </div>
                           <p className="text-[9px] text-foreground/20 leading-relaxed italic">
                             * Verified members are customers with at least {settings.communityMinOrders} orders.
                           </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Advanced Tab ── */}
                {settingsTab === 'advanced' && (
                  <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <SectionHeader icon={Settings} title="System Configuration" description="Sensitive keys and core Shopify configuration." />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <SettingsInput label="Shopify Admin Domain" value={settings.shopDomain || ''} onChange={v => updateSetting('shopDomain', v)} mono />
                      <SettingsInput label="Shopify Webhook Secret" value={settings.webhookSecret || ''} onChange={v => updateSetting('webhookSecret', v)} mono type="password" />
                      
                      <div className="md:col-span-2 pt-6 border-t border-foreground/5">
                        <SectionHeader icon={Navigation} title="Global Menu Handles" />
                      </div>
                      <SettingsInput label="Main Navigation" value={settings.mainMenuHandle || 'main-menu'} onChange={v => updateSetting('mainMenuHandle', v)} mono />
                      <SettingsInput label="Footer Navigation" value={settings.secondaryMenuHandle || 'footer'} onChange={v => updateSetting('secondaryMenuHandle', v)} mono />

                      <div className="md:col-span-2 pt-6 border-t border-foreground/5">
                        <SectionHeader icon={Shield} title="Integration Keys" />
                      </div>
                      <SettingsInput label="Razorpay Key ID" value={settings.razorpayKeyId || ''} onChange={v => updateSetting('razorpayKeyId', v)} mono />
                      <SettingsInput label="Razorpay Secret" value={settings.razorpayKeySecret || ''} onChange={v => updateSetting('razorpayKeySecret', v)} mono type="password" />
                      <SettingsInput label="Shiprocket Token" value={settings.shiprocketToken || ''} onChange={v => updateSetting('shiprocketToken', v)} mono type="password" />
                      <SettingsInput label="WhatsApp API Token" value={settings.whatsappToken || ''} onChange={v => updateSetting('whatsappToken', v)} mono type="password" />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-[600px] flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-8 h-8 text-foreground/10 animate-spin" />
                <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-foreground/20">Initializing...</span>
              </div>
            )}
          </GlassCard>
        </div>
      </div>

      {/* Footer Branding */}
      <div className="text-center pt-20">
        <div className="inline-flex flex-col items-center gap-4">
          <div className="w-12 h-[1px] bg-foreground/10" />
          <p className="text-[9px] font-bold uppercase tracking-[0.5em] text-foreground/15">
            Zica Bella Archival Engine v1.2.0
          </p>
        </div>
      </div>
    </motion.div>
  );
}
