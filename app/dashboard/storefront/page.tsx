"use client";

import { useState, useEffect, useMemo } from 'react';
import {
  Save, CheckCircle, RefreshCw,
  Layout, ImageIcon, Video, Monitor, Globe, Navigation,
  Sparkles, Layers, MessageSquare, Info, Loader2, Upload, X, Link as LinkIcon,
  GripVertical, Package
} from 'lucide-react';
import { motion, Reorder } from 'framer-motion';
import Image from 'next/image';

interface SettingsData {
  id: string;
  shopDomain: string;
  heroImage: string;
  heroVideo: string;
  heroVideoMobile: string;
  heroTitle: string;
  heroSubtitle: string;
  heroButtonText: string;
  latestCurationTitle: string;
  latestCurationSubtitle: string;
  archiveTitle: string;
  archiveSubtitle: string;
  blueprintTitle: string;
  blueprintSubtitle: string;
  showProductVideo: boolean;
  showSizeChart: boolean;
  showBrand: boolean;
  showShippingReturn: boolean;
  showCare: boolean;
  showSizeFit: boolean;
  showDetails: boolean;
  pdpBackground: string;
  instagramUrl: string;
  appleUrl: string;
  spotifyUrl: string;
  youtubeUrl: string;
  showHeroText: boolean;
  showLatestCuration: boolean;
  showArchive: boolean;
  showBlueprint: boolean;
  featuredMedia: string;
  featuredMediaImage: string;
  featuredMediaMobile: string;
  featuredMediaImageMobile: string;
  featuredMediaLink: string;
  collectionsMediaLink: string;
  collectionsMedia: string;
  collectionsMediaMobile: string;
  footerVideo: string;
  footerVideoMobile: string;
  mainMenuHandle: string;
  secondaryMenuHandle: string;
  showTreeText: boolean;
  kineticMeshProducts: string;
  showCommunity: boolean;
  communityTitle: string;
  communitySubtitle: string;
  spotlightTitle: string;
  spotlightSubtitle: string;
  spotlightCollection: string;
  spotlightProducts: string;
  kineticMeshTitle: string;
  enabledCollectionsHeader: string;
  enabledCollectionsPage: string;
  enabledCollectionsMenu: string;
  feedExcludedCollections: string;
  flipbookImage: string;
  flipbookImageMobile: string;
  flipbookVideo: string;
  flipbookVideoMobile: string;
  flipbookTitle: string;
  flipbookTag: string;
  flipbookDesc: string;
  flipbookLink: string;
  showRingCarousel: boolean;
  ringCarouselTitle: string;
  ringCarouselItems: string;
  footerLogo3dUrl: string;
  homepageCollection: string;
  homepageProducts: string;
  loginBgImage: string;
  loginBgVideo: string;
  loginBgImageMobile: string;
  loginBgVideoMobile: string;
  loginBgImageLight: string;
  loginBgImageDark: string;
  loginBgImageLightMobile: string;
  loginBgImageDarkMobile: string;
}

function SettingsRow({
  label,
  children,
  icon: Icon,
  description
}: {
  label: string;
  children: React.ReactNode;
  icon?: any;
  description?: string;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between py-5 border-b border-foreground/[0.05] last:border-0 gap-4 md:gap-0">
      <div className="flex items-center gap-4">
        {Icon && (
          <div className="w-8 h-8 rounded-md bg-foreground/[0.02] flex items-center justify-center text-foreground/80 dark:text-foreground/60 border border-foreground/[0.05]">
            <Icon className="w-4 h-4" />
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-[12px] font-medium text-foreground tracking-tight mb-0.5">{label}</span>
          {description && <span className="text-[9px] text-foreground/50 uppercase tracking-widest">{description}</span>}
        </div>
      </div>
      <div className="flex-1 w-full md:max-w-md flex justify-end">
        {children}
      </div>
    </div>
  );
}

function InputField({
  value,
  onChange,
  placeholder,
  className
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-foreground/[0.02] px-3 py-2.5 rounded-md border border-foreground/10 focus:border-foreground/30 text-right text-[11px] font-medium text-foreground placeholder:text-foreground/45 outline-none transition-colors ${className}`}
    />
  );
}

function SettingsGroup({ title, children, icon: Icon }: { title?: string; children: React.ReactNode; icon?: any }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="space-y-4 relative z-10"
    >
      {title && (
        <div className="flex items-center gap-2 px-6">
           {Icon && <Icon className="w-3.5 h-3.5 text-foreground/60" />}
           <h3 className="text-[9px] font-semibold uppercase tracking-widest text-foreground/50">{title}</h3>
        </div>
      )}
      <div className="bg-background border border-foreground/[0.05] rounded-xl px-6 py-2 shadow-sm relative overflow-hidden">
        <div className="relative z-10">
           {children}
        </div>
      </div>
    </motion.div>
  );
}

function ToggleField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${checked ? 'bg-foreground' : 'bg-foreground/10'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  );
}

function MediaPicker({
  value,
  onChange,
  label,
  type = 'image'
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  type?: 'image' | 'video';
}) {
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.url) {
        onChange(data.url);
      } else {
        alert(data.error || 'Upload failed');
      }
    } catch (err) {
      alert('Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={`https://... or upload ${type}`}
          className="flex-1 bg-foreground/[0.02] px-3 py-2.5 rounded-md border border-foreground/10 focus:border-foreground/30 text-right text-[11px] font-medium text-foreground placeholder:text-foreground/45 outline-none transition-colors"
        />
        <label className="shrink-0 flex items-center justify-center w-10 h-10 rounded-md bg-foreground/5 border border-foreground/10 cursor-pointer hover:bg-foreground/10 transition-colors">
          {isUploading ? (
            <RefreshCw className="w-4 h-4 animate-spin text-foreground/60" />
          ) : (
            <Upload className="w-4 h-4 text-foreground/60" />
          )}
          <input type="file" className="hidden" accept={type === 'image' ? "image/*" : "video/*"} onChange={handleUpload} />
        </label>
      </div>
      {value && (
        <div className="relative aspect-video w-full rounded-md overflow-hidden bg-foreground/[0.03] border border-foreground/[0.05]">
          {type === 'image' ? (
            <img src={value} alt={label} className="w-full h-full object-cover" />
          ) : (
            <video src={value} className="w-full h-full object-cover" muted />
          )}
          <button 
            onClick={() => onChange('')}
            className="absolute top-1 right-1 p-1 rounded-full bg-background/50 text-white hover:bg-red-500 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

const safeParseArray = (val: any) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
};

function HomepageProductsEditor({
  value,
  onChange,
  allProducts
}: {
  value: string;
  onChange: (val: string) => void;
  allProducts: any[];
}) {
  const selectedIds = useMemo(() => {
    return value ? value.split(',').map(id => id.trim()).filter(Boolean) : [];
  }, [value]);

  const selectedProducts = useMemo(() => {
    return selectedIds
      .map(id => allProducts.find(p => String(p.id) === id))
      .filter((p): p is any => !!p);
  }, [selectedIds, allProducts]);

  const handleReorder = (newProducts: any[]) => {
    const newIds = newProducts.map(p => String(p.id)).join(',');
    onChange(newIds);
  };

  const handleRemove = (productId: string) => {
    const nextIds = selectedIds.filter(id => id !== productId).join(',');
    onChange(nextIds);
  };

  const handleAdd = (productId: string) => {
    if (selectedIds.includes(productId)) return;
    const nextIds = [...selectedIds, productId].join(',');
    onChange(nextIds);
  };

  const availableProducts = useMemo(() => {
    return allProducts.filter(p => !selectedIds.includes(String(p.id)));
  }, [allProducts, selectedIds]);

  return (
    <div className="space-y-3 w-full text-left">
      {selectedProducts.length > 0 ? (
        <Reorder.Group
          axis="y"
          values={selectedProducts}
          onReorder={handleReorder}
          className="space-y-1.5 max-h-[300px] overflow-y-auto border border-foreground/[0.05] rounded-lg p-2 bg-foreground/[0.01]"
        >
          {selectedProducts.map(product => (
            <Reorder.Item
              key={product.id}
              value={product}
              className="flex items-center gap-3 px-3 py-2 bg-background border border-foreground/[0.04] rounded-md shadow-sm select-none"
            >
              <div className="cursor-grab active:cursor-grabbing text-foreground/30 hover:text-foreground/50 transition-colors py-1 px-0.5">
                <GripVertical className="w-3.5 h-3.5" />
              </div>
              <div className="relative w-8 h-8 rounded overflow-hidden border border-foreground/[0.06] bg-foreground/[0.02] shrink-0">
                {product.images?.[0]?.src || product.image?.src ? (
                  <Image
                    src={product.images?.[0]?.src || product.image?.src}
                    alt={product.title}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Package className="w-3 h-3 text-foreground/15" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-[11px] font-semibold text-foreground truncate">{product.title}</h4>
                <p className="text-[9px] text-foreground/45 font-mono truncate">ID: {product.id}</p>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(String(product.id))}
                className="text-[10px] text-red-500 hover:text-red-600 transition-colors px-2 py-1 font-semibold hover:bg-red-500/5 rounded"
              >
                Remove
              </button>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      ) : (
        <div className="text-center py-6 border border-dashed border-foreground/[0.08] rounded-lg bg-foreground/[0.01]">
          <p className="text-[11px] text-foreground/45 font-semibold">No specific products selected. Showing newest products by default.</p>
        </div>
      )}

      {availableProducts.length > 0 && (
        <div className="flex gap-2">
          <select
            onChange={e => {
              if (e.target.value) {
                handleAdd(e.target.value);
                e.target.value = "";
              }
            }}
            className="flex-1 bg-foreground/[0.02] px-3 py-2 rounded-lg border border-foreground/[0.05] focus:border-foreground/20 text-[11px] font-medium text-foreground outline-none transition-colors"
          >
            <option value="">+ Add product to homepage...</option>
            {availableProducts.map(p => (
              <option key={p.id} value={p.id}>
                {p.title} (ID: {p.id})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export default function StorefrontSettingsPage() {
  const [settings, setSettings] = useState<Partial<SettingsData>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [allCollections, setAllCollections] = useState<any[]>([]);

  useEffect(() => {
    // Query canonical settings (defaults to 8tiahf-bk.myshopify.com)
    fetch('/api/admin/settings')
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch settings');
        return r.json();
      })
      .then(data => {
        setSettings(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading storefront settings:', err);
        setLoading(false);
      });

    fetch('/api/shopify/products?pageSize=250')
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch products');
        return r.json();
      })
      .then(data => data.products && setAllProducts(data.products))
      .catch(err => console.error('Error loading products:', err));

    fetch('/api/shopify/collections?all=true')
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch collections');
        return r.json();
      })
      .then(data => Array.isArray(data) && setAllCollections(data))
      .catch(err => console.error('Error loading collections:', err));
  }, []);

  const handleSave = async () => {
    if (saving) return; 
    setSaving(true);
    setSaveStatus('idle');

    const storefrontKeys: (keyof SettingsData)[] = [
        'heroImage', 'heroVideo', 'heroVideoMobile', 'heroTitle', 'heroSubtitle', 'heroButtonText',
        'latestCurationTitle', 'latestCurationSubtitle', 'archiveTitle', 'archiveSubtitle',
        'blueprintTitle', 'blueprintSubtitle', 'showHeroText', 'showLatestCuration',
        'showArchive', 'showBlueprint', 'showProductVideo', 'showSizeChart',
        'showBrand', 'showShippingReturn', 'showCare', 'showSizeFit', 'showDetails',
        'pdpBackground', 'instagramUrl', 'appleUrl', 'spotifyUrl', 'youtubeUrl',
        'featuredMedia', 'featuredMediaImage', 'featuredMediaMobile', 'featuredMediaImageMobile',
        'featuredMediaLink',
        'collectionsMediaLink',
        'collectionsMedia', 'collectionsMediaMobile', 'footerVideo', 'footerVideoMobile',
        'mainMenuHandle', 'secondaryMenuHandle', 'showTreeText', 'showCommunity',
        'communityTitle', 'communitySubtitle', 'spotlightTitle', 'spotlightSubtitle',
        'spotlightCollection', 'spotlightProducts',
        'kineticMeshTitle', 'kineticMeshProducts', 'enabledCollectionsHeader', 
        'enabledCollectionsPage', 'enabledCollectionsMenu', 'feedExcludedCollections',
        'flipbookImage', 'flipbookImageMobile', 'flipbookVideo', 'flipbookVideoMobile', 'flipbookTitle', 'flipbookTag', 'flipbookDesc',
        'flipbookLink',
        'showRingCarousel', 'ringCarouselTitle', 'ringCarouselItems', 'footerLogo3dUrl',
        'homepageCollection', 'homepageProducts',
        'loginBgImage', 'loginBgVideo', 'loginBgImageMobile', 'loginBgVideoMobile',
        'loginBgImageLight', 'loginBgImageDark', 'loginBgImageLightMobile', 'loginBgImageDarkMobile'
    ];

    // Pass shopDomain from loaded settings to target the correct record in PATCH (fallback to 8tiahf-bk.myshopify.com)
    const partialUpdate: any = { shopId: settings.id, shopDomain: settings.shopDomain || '8tiahf-bk.myshopify.com' };
    storefrontKeys.forEach(key => {
        if (settings[key] !== undefined) partialUpdate[key] = settings[key];
    });

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partialUpdate),
      });
      if (!res.ok) throw new Error('Update failed');
      setSaveStatus('success');
    } catch (err: any) {
      setSaveStatus('error');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus('idle'), 4000);
    }
  };

  const set = (key: keyof SettingsData) => (value: any) => setSettings(prev => ({ ...prev, [key]: value }));

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <Loader2 className="w-5 h-5 text-foreground/60 animate-spin" />
      <span className="text-[10px] font-medium uppercase tracking-widest text-foreground/60">Loading Web Storefront...</span>
    </div>
  );

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="max-w-4xl mx-auto space-y-10 pb-20 relative z-10"
    >
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2 pt-4 relative z-10">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            Web Storefront Layout Settings
          </h1>
          <p className="text-[11px] text-foreground/50 tracking-wide max-w-xl">
            Configure visual assets, campaigns, collections menus, and curated streetwear grids specifically for zicabella.com. Updates saved here will **NEVER** affect the mobile applications.
          </p>
        </div>
        
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-md text-[10px] font-medium tracking-[0.15em] uppercase transition-all ${
            saveStatus === 'success' ? 'bg-green-500 text-white' : 'bg-foreground text-background hover:opacity-90'
          } disabled:opacity-50`}
        >
          {saving ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : saveStatus === 'success' ? (
            <CheckCircle className="w-3.5 h-3.5" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {saving ? 'Saving...' : saveStatus === 'success' ? 'Saved' : 'Save Config'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8">
        
        {/* Cinematic Assets */}
        <SettingsGroup title="Media Assets" icon={Layers}>
          <SettingsRow label="Hero Image" icon={ImageIcon} description="Main landing image link">
             <MediaPicker value={settings.heroImage!} onChange={set('heroImage')} label="Hero Image" type="image" />
          </SettingsRow>
          <SettingsRow label="Hero Video" icon={Video} description="Hero background MP4 link">
             <MediaPicker value={settings.heroVideo!} onChange={set('heroVideo')} label="Hero Video" type="video" />
          </SettingsRow>
          <SettingsRow label="Mobile Hero Video" icon={Video} description="Mobile background MP4 link">
             <MediaPicker value={settings.heroVideoMobile!} onChange={set('heroVideoMobile')} label="Mobile Hero Video" type="video" />
          </SettingsRow>
          <SettingsRow label="Footer Video (Desktop)" icon={Video} description="Desktop footer video (landscape)">
             <MediaPicker value={settings.footerVideo!} onChange={set('footerVideo')} label="Footer Video (Desktop)" type="video" />
          </SettingsRow>
          <SettingsRow label="Footer Video (Mobile)" icon={Video} description="Mobile footer video (portrait)">
             <MediaPicker value={settings.footerVideoMobile!} onChange={set('footerVideoMobile')} label="Footer Video (Mobile)" type="video" />
          </SettingsRow>
          <SettingsRow label="Collections Video (Desktop)" icon={Video} description="Desktop collection background (landscape)">
             <MediaPicker value={settings.collectionsMedia!} onChange={set('collectionsMedia')} label="Collections Video (Desktop)" type="video" />
          </SettingsRow>
          <SettingsRow label="Collections Video (Mobile)" icon={Video} description="Mobile collection background (portrait)">
             <MediaPicker value={settings.collectionsMediaMobile!} onChange={set('collectionsMediaMobile')} label="Collections Video (Mobile)" type="video" />
          </SettingsRow>
          <SettingsRow label="Collections Media Link" icon={LinkIcon} description="Collection page to open on clicking above-collection section">
             <select 
               value={settings.collectionsMediaLink || ''} 
               onChange={e => set('collectionsMediaLink')(e.target.value)}
               className="w-full bg-foreground/[0.02] px-3 py-2.5 rounded-md border border-foreground/[0.05] focus:border-foreground/20 text-right text-[11px] font-medium text-foreground outline-none transition-colors"
             >
               <option value="">No link (disabled)</option>
               {allCollections.map(c => (
                 <option key={c.id} value={c.handle}>{c.title}</option>
               ))}
             </select>
          </SettingsRow>
          <SettingsRow label="Featured Media Image (Desktop)" icon={ImageIcon} description="Desktop featured image fallback">
             <MediaPicker value={settings.featuredMediaImage!} onChange={set('featuredMediaImage')} label="Featured Media Image (Desktop)" type="image" />
          </SettingsRow>
          <SettingsRow label="Featured Media Video (Desktop)" icon={Video} description="Desktop featured video (landscape)">
             <MediaPicker value={settings.featuredMedia!} onChange={set('featuredMedia')} label="Featured Media Video (Desktop)" type="video" />
          </SettingsRow>
          <SettingsRow label="Featured Media Image (Mobile)" icon={ImageIcon} description="Mobile featured image fallback">
             <MediaPicker value={settings.featuredMediaImageMobile!} onChange={set('featuredMediaImageMobile')} label="Featured Media Image (Mobile)" type="image" />
          </SettingsRow>
          <SettingsRow label="Featured Media Video (Mobile)" icon={Video} description="Mobile featured video (portrait)">
             <MediaPicker value={settings.featuredMediaMobile!} onChange={set('featuredMediaMobile')} label="Featured Media Video (Mobile)" type="video" />
          </SettingsRow>
          <SettingsRow label="Featured Media Title" description="Main overlay text">
             <InputField value={settings.blueprintTitle!} onChange={set('blueprintTitle')} placeholder="e.g. The Blueprint" />
          </SettingsRow>
          <SettingsRow label="Featured Media Subtitle" description="Secondary overlay text">
             <InputField value={settings.blueprintSubtitle!} onChange={set('blueprintSubtitle')} placeholder="e.g. Technique & Motion" />
          </SettingsRow>
          <SettingsRow label="Featured Media Link" icon={LinkIcon} description="Collection page to open on click">
             <select 
               value={settings.featuredMediaLink || ''} 
               onChange={e => set('featuredMediaLink')(e.target.value)}
               className="w-full bg-foreground/[0.02] px-3 py-2.5 rounded-md border border-foreground/[0.05] focus:border-foreground/20 text-right text-[11px] font-medium text-foreground outline-none transition-colors"
             >
               <option value="">No link (disabled)</option>
               {allCollections.map(c => (
                 <option key={c.id} value={c.handle}>{c.title}</option>
               ))}
             </select>
          </SettingsRow>
          <SettingsRow label="Footer 3D Logo" icon={Monitor} description="GLB model for footer logo">
             <InputField value={settings.footerLogo3dUrl!} onChange={set('footerLogo3dUrl')} placeholder="https://...glb" />
          </SettingsRow>
        </SettingsGroup>

        {/* Login Page Media */}
        <SettingsGroup title="Login Page Media" icon={Layers}>
          <SettingsRow label="Login Background Image (Desktop)" icon={ImageIcon} description="Desktop login background image link">
             <MediaPicker value={settings.loginBgImage!} onChange={set('loginBgImage')} label="Login Background Image (Desktop)" type="image" />
          </SettingsRow>
          <SettingsRow label="Login Background Video (Desktop)" icon={Video} description="Desktop login background MP4 link">
             <MediaPicker value={settings.loginBgVideo!} onChange={set('loginBgVideo')} label="Login Background Video (Desktop)" type="video" />
          </SettingsRow>
          <SettingsRow label="Login Background Image (Mobile)" icon={ImageIcon} description="Mobile login background image link">
             <MediaPicker value={settings.loginBgImageMobile!} onChange={set('loginBgImageMobile')} label="Login Background Image (Mobile)" type="image" />
          </SettingsRow>
          <SettingsRow label="Login Background Video (Mobile)" icon={Video} description="Mobile login background MP4 link">
             <MediaPicker value={settings.loginBgVideoMobile!} onChange={set('loginBgVideoMobile')} label="Login Background Video (Mobile)" type="video" />
          </SettingsRow>
        </SettingsGroup>

        {/* Login Page Theme Images */}
        <SettingsGroup title="Login Page Theme Images" icon={Layers}>
          <SettingsRow label="Light Theme Image (Desktop)" icon={ImageIcon} description="Login background for light mode on desktop">
             <MediaPicker value={settings.loginBgImageLight!} onChange={set('loginBgImageLight')} label="Light Theme Image (Desktop)" type="image" />
          </SettingsRow>
          <SettingsRow label="Dark Theme Image (Desktop)" icon={ImageIcon} description="Login background for dark mode on desktop">
             <MediaPicker value={settings.loginBgImageDark!} onChange={set('loginBgImageDark')} label="Dark Theme Image (Desktop)" type="image" />
          </SettingsRow>
          <SettingsRow label="Light Theme Image (Mobile)" icon={ImageIcon} description="Login background for light mode on mobile">
             <MediaPicker value={settings.loginBgImageLightMobile!} onChange={set('loginBgImageLightMobile')} label="Light Theme Image (Mobile)" type="image" />
          </SettingsRow>
          <SettingsRow label="Dark Theme Image (Mobile)" icon={ImageIcon} description="Login background for dark mode on mobile">
             <MediaPicker value={settings.loginBgImageDarkMobile!} onChange={set('loginBgImageDarkMobile')} label="Dark Theme Image (Mobile)" type="image" />
          </SettingsRow>
        </SettingsGroup>

        {/* Hero Narrative */}
        <SettingsGroup title="Hero Content" icon={MessageSquare}>
          <SettingsRow label="Main Title">
             <InputField value={settings.heroTitle!} onChange={set('heroTitle')} placeholder="e.g. Redefine The Standard" />
          </SettingsRow>
          <SettingsRow label="Subtitle">
             <InputField value={settings.heroSubtitle!} onChange={set('heroSubtitle')} placeholder="Atmospheric subtitle text" />
          </SettingsRow>
          <SettingsRow label="Button Text">
             <InputField value={settings.heroButtonText!} onChange={set('heroButtonText')} placeholder="CTA text (e.g. Discover)" />
          </SettingsRow>
          <SettingsRow label="Show Text" description="Toggle hero text visibility">
             <ToggleField checked={settings.showHeroText!} onChange={set('showHeroText')} />
          </SettingsRow>
        </SettingsGroup>

        {/* Section Headings */}
        <SettingsGroup title="Section Headings" icon={MessageSquare}>
          <SettingsRow label="Latest Curation Title" description="Heading for latest collection drop">
             <InputField value={settings.latestCurationTitle!} onChange={set('latestCurationTitle')} placeholder="e.g. Latest Curation" />
          </SettingsRow>
          <SettingsRow label="Latest Curation Subtitle" description="Sub-heading or tag (e.g. Season Drop)">
             <InputField value={settings.latestCurationSubtitle!} onChange={set('latestCurationSubtitle')} placeholder="e.g. Season Drop" />
          </SettingsRow>
          <SettingsRow label="Archive Section Title" description="Heading for past archives">
             <InputField value={settings.archiveTitle!} onChange={set('archiveTitle')} placeholder="e.g. The Archive" />
          </SettingsRow>
          <SettingsRow label="Archive Section Subtitle" description="Sub-heading for past archives">
             <InputField value={settings.archiveSubtitle!} onChange={set('archiveSubtitle')} placeholder="e.g. Organic Evolution" />
          </SettingsRow>
        </SettingsGroup>

        {/* HOMEPAGE PRODUCTS CURATION */}
        <SettingsGroup title="Homepage Products" icon={Sparkles}>
          <div className="px-4 py-3 bg-foreground/[0.02] rounded-md border border-foreground/[0.05] flex items-center gap-3 mt-1">
             <Info className="w-4 h-4 text-foreground/50 shrink-0" />
             <p className="text-[10px] font-medium text-foreground/50 uppercase tracking-widest">
                Configure the main 12-product grid shown on your web storefront homepage.
             </p>
          </div>
          <SettingsRow label="Collection Handle" description="Shopify collection to show (e.g. tshirts)">
             <select 
               value={settings.homepageCollection || ''} 
               onChange={e => set('homepageCollection')(e.target.value)}
               className="w-full bg-foreground/[0.02] px-3 py-2.5 rounded-md border border-foreground/[0.05] focus:border-foreground/20 text-right text-[11px] font-medium text-foreground outline-none transition-colors"
             >
               <option value="">Newest Products (Default)</option>
               {allCollections.map(c => (
                 <option key={c.id} value={c.handle}>{c.title}</option>
               ))}
             </select>
          </SettingsRow>
          <SettingsRow label="Specific Products" description="Search, drag to sort, and manage homepage products list">
             <HomepageProductsEditor
               value={settings.homepageProducts || ''}
               onChange={set('homepageProducts')}
               allProducts={allProducts}
             />
          </SettingsRow>
        </SettingsGroup>

        {/* SPOTLIGHT SECTION */}
        <SettingsGroup title="Spotlight Section (Streetwear)" icon={Sparkles}>
          <div className="px-4 py-3 bg-foreground/[0.02] rounded-md border border-foreground/[0.05] flex items-center gap-3 mt-1">
             <Info className="w-4 h-4 text-foreground/50 shrink-0" />
             <p className="text-[10px] font-medium text-foreground/50 uppercase tracking-widest">
                Configure the "Authentic Streetwear" grid on the web storefront.
             </p>
          </div>
          <SettingsRow label="Section Title">
             <InputField value={settings.spotlightTitle!} onChange={set('spotlightTitle')} placeholder="e.g. AUTHENTIC STREETWEAR" />
          </SettingsRow>
          <SettingsRow label="Subtitle">
             <InputField value={settings.spotlightSubtitle!} onChange={set('spotlightSubtitle')} placeholder="Supporting text..." />
          </SettingsRow>
          <SettingsRow label="Collection Handle" description="Shopify collection to show (e.g. tshirts)">
             <select 
               value={settings.spotlightCollection || ''} 
               onChange={e => set('spotlightCollection')(e.target.value)}
               className="w-full bg-foreground/[0.02] px-3 py-2.5 rounded-md border border-foreground/[0.05] focus:border-foreground/20 text-right text-[11px] font-medium text-foreground outline-none transition-colors"
             >
               <option value="">Select a collection</option>
               {allCollections.map(c => (
                 <option key={c.id} value={c.handle}>{c.title}</option>
               ))}
             </select>
          </SettingsRow>
          <SettingsRow label="Specific Products" description="Optional: Comma-separated Shopify IDs">
             <InputField value={settings.spotlightProducts!} onChange={set('spotlightProducts')} placeholder="GID1, GID2..." />
          </SettingsRow>
        </SettingsGroup>

        {/* 3D PAPER TEAR (FLIPBOOK) */}
        <SettingsGroup title="Feature Section" icon={Sparkles}>
          <div className="px-4 py-3 bg-foreground/[0.02] rounded-md border border-foreground/[0.05] flex items-center gap-3 mt-1">
             <Info className="w-4 h-4 text-foreground/50 shrink-0" />
             <p className="text-[10px] font-medium text-foreground/50 uppercase tracking-widest">
                Configure the web scroll reveal feature section.
             </p>
          </div>
          <SettingsRow label="Image URL (Desktop)" icon={ImageIcon} description="Desktop revealing image (landscape)">
             <MediaPicker value={settings.flipbookImage!} onChange={set('flipbookImage')} label="Flipbook Image (Desktop)" type="image" />
          </SettingsRow>
          <SettingsRow label="Video URL (Desktop)" icon={Video} description="Desktop revealing video (landscape)">
             <MediaPicker value={settings.flipbookVideo!} onChange={set('flipbookVideo')} label="Flipbook Video (Desktop)" type="video" />
          </SettingsRow>
          <SettingsRow label="Image URL (Mobile)" icon={ImageIcon} description="Mobile revealing image (portrait)">
             <MediaPicker value={settings.flipbookImageMobile!} onChange={set('flipbookImageMobile')} label="Flipbook Image (Mobile)" type="image" />
          </SettingsRow>
          <SettingsRow label="Video URL (Mobile)" icon={Video} description="Mobile revealing video (portrait)">
             <MediaPicker value={settings.flipbookVideoMobile!} onChange={set('flipbookVideoMobile')} label="Flipbook Video (Mobile)" type="video" />
          </SettingsRow>
          <SettingsRow label="Label Tag" description="Small tag above title">
             <InputField value={settings.flipbookTag!} onChange={set('flipbookTag')} placeholder="e.g. Core Manifest" />
          </SettingsRow>
          <SettingsRow label="Title" description="Main large heading">
             <InputField value={settings.flipbookTitle!} onChange={set('flipbookTitle')} placeholder="e.g. Archival Vision" />
          </SettingsRow>
          <SettingsRow label="Description" description="Supporting technical text">
             <InputField value={settings.flipbookDesc!} onChange={set('flipbookDesc')} placeholder="Technical description..." />
          </SettingsRow>
          <SettingsRow label="Collection Link" icon={LinkIcon} description="Collection page to open on click">
             <select 
               value={settings.flipbookLink || ''} 
               onChange={e => set('flipbookLink')(e.target.value)}
               className="w-full bg-foreground/[0.02] px-3 py-2.5 rounded-md border border-foreground/[0.05] focus:border-foreground/20 text-right text-[11px] font-medium text-foreground outline-none transition-colors"
             >
               <option value="">No link (disabled)</option>
               {allCollections.map(c => (
                 <option key={c.id} value={c.handle}>{c.title}</option>
               ))}
             </select>
          </SettingsRow>
        </SettingsGroup>

        {/* RING CAROUSEL */}
        <SettingsGroup title="Ring Collection Carousel" icon={Sparkles}>
          <div className="px-4 py-3 bg-foreground/[0.02] rounded-md border border-foreground/[0.05] flex items-center gap-3 mt-1">
             <Info className="w-4 h-4 text-foreground/50 shrink-0" />
             <p className="text-[10px] font-medium text-foreground/50 uppercase tracking-widest">
                Configure the minimal ring carousel.
             </p>
          </div>
          <SettingsRow label="Show Carousel" description="Toggle visibility on storefront">
             <ToggleField checked={settings.showRingCarousel!} onChange={set('showRingCarousel')} />
          </SettingsRow>
          <SettingsRow label="Section Title" description="Heading above carousel">
             <InputField value={settings.ringCarouselTitle!} onChange={set('ringCarouselTitle')} placeholder="e.g. RING COLLECTION" />
          </SettingsRow>
          <SettingsRow label="Items JSON" description="Array of objects {id, image, link}">
             <InputField value={settings.ringCarouselItems!} onChange={set('ringCarouselItems')} placeholder='[{"id":"1","image":"..."}]' />
          </SettingsRow>
        </SettingsGroup>

        {/* Curation Visibility */}
        <SettingsGroup title="Section Visibility" icon={Layout}>
          <SettingsRow label="Latest Collections" description="Showcase latest curation grid">
             <ToggleField checked={settings.showLatestCuration!} onChange={set('showLatestCuration')} />
          </SettingsRow>
          <SettingsRow label="Archive" description="Enable portal to past collections">
             <ToggleField checked={settings.showArchive!} onChange={set('showArchive')} />
          </SettingsRow>
          <SettingsRow label="Blueprint" description="Product anatomy visual section">
             <ToggleField checked={settings.showBlueprint!} onChange={set('showBlueprint')} />
          </SettingsRow>
          <SettingsRow label="Community" description="Enable featured community looks">
             <ToggleField checked={settings.showCommunity!} onChange={set('showCommunity')} />
          </SettingsRow>
        </SettingsGroup>

        {/* Global Connectivity */}
        <SettingsGroup title="Social Links" icon={Globe}>
          <SettingsRow label="Instagram" description="Social redirection">
             <InputField value={settings.instagramUrl!} onChange={set('instagramUrl')} placeholder="https://instagram.com/..." />
          </SettingsRow>
          <SettingsRow label="Spotify" description="Audio link">
             <InputField value={settings.spotifyUrl!} onChange={set('spotifyUrl')} placeholder="https://open.spotify..." />
          </SettingsRow>
        </SettingsGroup>

        {/* Navigation Architecture */}
        <SettingsGroup title="Navigation & Collection Placements" icon={Navigation}>
          <div className="pt-2 pb-4 space-y-6">
             {/* Header Navigation */}
             <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-foreground/[0.03] pb-2">
                   <div>
                      <p className="text-[11px] font-semibold text-foreground tracking-tight">Header Navigation</p>
                      <span className="text-[8px] text-foreground/45 uppercase tracking-widest">Links displayed in web header</span>
                   </div>
                   <span className="text-[9px] font-semibold text-foreground/50 uppercase tracking-widest">{safeParseArray(settings.enabledCollectionsHeader).length} Selected</span>
                </div>
                <div className="flex flex-wrap gap-2">
                   {allCollections.map(c => {
                      const active = safeParseArray(settings.enabledCollectionsHeader).includes(c.handle);
                      return (
                         <button 
                            key={c.id}
                            onClick={() => {
                               const current = safeParseArray(settings.enabledCollectionsHeader);
                               const next = active ? current.filter((h: any) => h !== c.handle) : [...current, c.handle];
                               set('enabledCollectionsHeader')(JSON.stringify(next));
                            }}
                            className={`px-3 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-widest transition-colors border ${active ? 'bg-foreground text-background border-transparent' : 'bg-background text-foreground/50 border-foreground/[0.05] hover:border-foreground/20'}`}
                         >
                            {c.title}
                         </button>
                      );
                   })}
                </div>
             </div>

             {/* Homepage Carousel Collections */}
             <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-foreground/[0.03] pb-2">
                   <div>
                      <p className="text-[11px] font-semibold text-foreground tracking-tight">Homepage Carousel</p>
                      <span className="text-[8px] text-foreground/45 uppercase tracking-widest">Collections displayed in homepage sliders</span>
                   </div>
                   <span className="text-[9px] font-semibold text-foreground/50 uppercase tracking-widest">{safeParseArray(settings.enabledCollectionsPage).length} Selected</span>
                </div>
                <div className="flex flex-wrap gap-2">
                   {allCollections.map(c => {
                      const active = safeParseArray(settings.enabledCollectionsPage).includes(c.handle);
                      return (
                         <button 
                            key={c.id}
                            onClick={() => {
                               const current = safeParseArray(settings.enabledCollectionsPage);
                               const next = active ? current.filter((h: any) => h !== c.handle) : [...current, c.handle];
                               set('enabledCollectionsPage')(JSON.stringify(next));
                            }}
                            className={`px-3 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-widest transition-colors border ${active ? 'bg-foreground text-background border-transparent' : 'bg-background text-foreground/50 border-foreground/[0.05] hover:border-foreground/20'}`}
                         >
                            {c.title}
                         </button>
                      );
                   })}
                </div>
             </div>

             {/* Mobile & Footer Collections */}
             <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-foreground/[0.03] pb-2">
                   <div>
                      <p className="text-[11px] font-semibold text-foreground tracking-tight">Mobile & Footer Menu</p>
                      <span className="text-[8px] text-foreground/45 uppercase tracking-widest">Quick links in sidebar and footer</span>
                   </div>
                   <span className="text-[9px] font-semibold text-foreground/50 uppercase tracking-widest">{safeParseArray(settings.enabledCollectionsMenu).length} Selected</span>
                </div>
                <div className="flex flex-wrap gap-2">
                   {allCollections.map(c => {
                      const active = safeParseArray(settings.enabledCollectionsMenu).includes(c.handle);
                      return (
                         <button 
                            key={c.id}
                            onClick={() => {
                               const current = safeParseArray(settings.enabledCollectionsMenu);
                               const next = active ? current.filter((h: any) => h !== c.handle) : [...current, c.handle];
                               set('enabledCollectionsMenu')(JSON.stringify(next));
                            }}
                            className={`px-3 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-widest transition-colors border ${active ? 'bg-foreground text-background border-transparent' : 'bg-background text-foreground/50 border-foreground/[0.05] hover:border-foreground/20'}`}
                         >
                            {c.title}
                         </button>
                      );
                   })}
                 </div>
              </div>
             {/* Product Feed Excluded Collections */}
             <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-foreground/[0.03] pb-2">
                   <div>
                      <p className="text-[11px] font-semibold text-foreground tracking-tight">Product Feed Excluded Collections</p>
                      <span className="text-[8px] text-foreground/45 uppercase tracking-widest">Selected collections will be excluded from /feed.xml and /feed.csv (Meta, Snap, Google, ChatGPT). Manage URLs and sync status in Marketing → Catalogue Feeds.</span>
                   </div>
                   <span className="text-[9px] font-semibold text-amber-500 uppercase tracking-widest">{safeParseArray(settings.feedExcludedCollections).length} Excluded</span>
                </div>
                <div className="flex flex-wrap gap-2">
                   {allCollections.map(c => {
                      const excluded = safeParseArray(settings.feedExcludedCollections).includes(c.handle);
                      return (
                         <button 
                            key={c.id}
                            onClick={() => {
                               const current = safeParseArray(settings.feedExcludedCollections);
                               const next = excluded ? current.filter((h: any) => h !== c.handle) : [...current, c.handle];
                               set('feedExcludedCollections')(JSON.stringify(next));
                            }}
                            className={`px-3 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-widest transition-colors border ${excluded ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30' : 'bg-background text-foreground/50 border-foreground/[0.05] hover:border-foreground/20'}`}
                         >
                            {excluded ? `🚫 ${c.title}` : c.title}
                         </button>
                      );
                   })}
                </div>
             </div>
          </div>
        </SettingsGroup>

      </div>

      <div className="text-center pt-8">
         <div className="inline-flex items-center gap-2 px-4 py-2 border border-foreground/[0.05] rounded-md bg-background shadow-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[9px] font-semibold uppercase tracking-widest text-foreground/50">Web Storefront Configuration Isolated</span>
         </div>
      </div>
    </motion.div>
  );
}
