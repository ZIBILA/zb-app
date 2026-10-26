"use client";

import { useState, useEffect } from "react";
import {
  Image as ImageIcon,
  Plus,
  Trash2,
  Edit2,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Link as LinkIcon,
  X,
  Save,
  Monitor,
  Smartphone
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

interface Banner {
  id: string;
  title: string;
  subtitle?: string | null;
  imageUrl: string;
  mobileImageUrl?: string | null;
  ctaLabel?: string | null;
  ctaLink?: string | null;
  position: number;
  isActive: boolean;
}

export default function WebStoreBannersCMS() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);

  // Form states
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [mobileImageUrl, setMobileImageUrl] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaLink, setCtaLink] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);

  const fetchBanners = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/web-store/banners");
      if (!res.ok) throw new Error("Failed to load banners");
      const data = await res.json();
      setBanners(data.banners || []);
    } catch (err: any) {
      toast.error(err.message || "Error fetching banners");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBanners();
  }, []);

  const openAddModal = () => {
    setEditingBanner(null);
    setTitle("");
    setSubtitle("");
    setImageUrl("");
    setMobileImageUrl("");
    setCtaLabel("");
    setCtaLink("");
    setIsActive(true);
    setIsModalOpen(true);
  };

  const openEditModal = (banner: Banner) => {
    setEditingBanner(banner);
    setTitle(banner.title);
    setSubtitle(banner.subtitle || "");
    setImageUrl(banner.imageUrl);
    setMobileImageUrl(banner.mobileImageUrl || "");
    setCtaLabel(banner.ctaLabel || "");
    setCtaLink(banner.ctaLink || "");
    setIsActive(banner.isActive);
    setIsModalOpen(true);
  };

  const handleToggleActive = async (banner: Banner) => {
    try {
      const res = await fetch(`/api/web-store/banners/${banner.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          isActive: !banner.isActive,
        }),
      });

      if (!res.ok) throw new Error("Failed to toggle status");
      toast.success(`Banner ${!banner.isActive ? "activated" : "deactivated"}`);
      fetchBanners();
    } catch (err: any) {
      toast.error(err.message || "Error toggling status");
    }
  };

  const handleDeleteBanner = async (id: string) => {
    if (!confirm("Are you sure you want to delete this banner?")) return;
    try {
      const res = await fetch(`/api/web-store/banners/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete banner");
      toast.success("Banner deleted successfully");
      fetchBanners();
    } catch (err: any) {
      toast.error(err.message || "Error deleting banner");
    }
  };

  const handleSaveBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !imageUrl) {
      toast.error("Title and Desktop Image URL are required");
      return;
    }

    setSubmitLoading(true);
    try {
      const method = editingBanner ? "PATCH" : "POST";
      const endpoint = editingBanner ? `/api/web-store/banners/${editingBanner.id}` : "/api/web-store/banners";

      const res = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          subtitle: subtitle || null,
          imageUrl,
          mobileImageUrl: mobileImageUrl || null,
          ctaLabel: ctaLabel || null,
          ctaLink: ctaLink || null,
          isActive,
        }),
      });

      if (!res.ok) throw new Error("Failed to save banner");
      toast.success(editingBanner ? "Banner updated successfully" : "Banner created successfully");
      setIsModalOpen(false);
      fetchBanners();
    } catch (err: any) {
      toast.error(err.message || "Error saving banner");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleMovePosition = async (index: number, direction: "up" | "down") => {
    const list = [...banners];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;

    // Swap elements in list
    const temp = list[index];
    list[index] = list[targetIndex];
    list[targetIndex] = temp;

    // Fast local state update
    setBanners(list);

    try {
      const res = await fetch("/api/web-store/banners/reorder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ids: list.map((b) => b.id),
        }),
      });

      if (!res.ok) throw new Error("Failed to save banner position changes");
      toast.success("Banner layout order updated");
    } catch (err: any) {
      toast.error(err.message || "Error updating order position");
      fetchBanners();
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-inter flex items-center gap-2">
            Homepage CMS & Banners <Sparkles className="w-5 h-5 text-amber-500" />
          </h1>
          <p className="text-[12px] text-foreground/50 mt-1">
            Configure desktop and mobile full-viewport hero banners, CTA buttons, and ordering priorities.
          </p>
        </div>
        
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 py-3 px-5 rounded-2xl bg-amber-500 text-black text-xs font-bold hover:opacity-95 transition-all shadow-lg shadow-amber-500/10 shrink-0"
        >
          <Plus className="w-4 h-4" /> Add Hero Banner
        </button>
      </div>

      {/* Main content list */}
      <div className="space-y-4">
        {loading ? (
          <div className="p-12 space-y-4 animate-pulse">
            {[...Array(3)].map((_, idx) => (
              <div key={idx} className="h-28 bg-foreground/5 rounded-[2rem] w-full" />
            ))}
          </div>
        ) : banners.length === 0 ? (
          <div className="glass rounded-[2rem] border border-foreground/5 py-24 text-center flex flex-col items-center">
            <ImageIcon className="w-16 h-16 text-foreground/15 mb-4" />
            <h3 className="text-sm font-bold text-foreground mb-1">No Banners Configured</h3>
            <p className="text-xs text-foreground/45 max-w-xs mb-6">Start building your storefront homepage by adding desktop and mobile hero campaigns.</p>
            <button
              onClick={openAddModal}
              className="flex items-center gap-2 py-2.5 px-5 rounded-xl bg-foreground text-background text-xs font-bold hover:opacity-90 transition-all"
            >
              <Plus className="w-4 h-4" /> Create First Banner
            </button>
          </div>
        ) : (
          <motion.div layout className="space-y-6">
            {banners.map((banner, index) => (
              <motion.div
                key={banner.id}
                layout
                className={`glass rounded-[2rem] border overflow-hidden p-6 md:p-8 flex flex-col md:flex-row gap-6 items-center justify-between group transition-all duration-300 ${!banner.isActive ? "opacity-60 border-foreground/5" : "border-foreground/5 hover:border-amber-500/20"}`}
              >
                {/* Visual Banner Preview thumbnail */}
                <div className="w-full md:w-48 h-28 rounded-2xl bg-foreground/5 border border-foreground/10 overflow-hidden relative shrink-0">
                  <img
                    src={banner.imageUrl}
                    alt={banner.title}
                    className="object-cover w-full h-full"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent p-3 flex items-end">
                    <span className="text-[10px] font-bold text-white bg-black/45 px-2 py-0.5 rounded backdrop-blur-md uppercase tracking-wider">
                      Position {index + 1}
                    </span>
                  </div>
                </div>

                {/* Text details info */}
                <div className="flex-1 min-w-0 space-y-2 text-center md:text-left">
                  <div>
                    <h3 className="text-[14px] font-bold text-foreground truncate">{banner.title}</h3>
                    {banner.subtitle && <p className="text-[11px] text-foreground/40 mt-1 truncate">{banner.subtitle}</p>}
                  </div>
                  
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-[10px] font-semibold text-foreground/50">
                    {banner.mobileImageUrl && (
                      <span className="flex items-center gap-1.5 bg-foreground/5 px-2 py-0.5 rounded border border-foreground/5 text-amber-500">
                        <Smartphone className="w-3.5 h-3.5" /> Mobile Image Enabled
                      </span>
                    )}
                    {banner.ctaLabel && (
                      <span className="flex items-center gap-1 bg-foreground/5 px-2 py-0.5 rounded border border-foreground/5 text-foreground/75 font-mono">
                        <LinkIcon className="w-3 h-3" /> CTA: {banner.ctaLabel} ({banner.ctaLink || "#"})
                      </span>
                    )}
                  </div>
                </div>

                {/* Operations & ordering actions */}
                <div className="flex items-center gap-2 md:gap-3 shrink-0">
                  {/* Reorder priority buttons */}
                  <div className="flex flex-col gap-1.5">
                    <button
                      disabled={index === 0}
                      onClick={() => handleMovePosition(index, "up")}
                      className="w-8 h-8 rounded-xl flex items-center justify-center bg-foreground/5 border border-foreground/5 text-foreground/40 hover:text-foreground hover:bg-foreground/10 disabled:opacity-20 transition-all"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      disabled={index === banners.length - 1}
                      onClick={() => handleMovePosition(index, "down")}
                      className="w-8 h-8 rounded-xl flex items-center justify-center bg-foreground/5 border border-foreground/5 text-foreground/40 hover:text-foreground hover:bg-foreground/10 disabled:opacity-20 transition-all"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Operational status action pills */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(banner)}
                      className={`w-10 h-10 rounded-2xl flex items-center justify-center border transition-all ${banner.isActive ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/25" : "bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/25"}`}
                    >
                      {banner.isActive ? <Eye className="w-4.5 h-4.5" /> : <EyeOff className="w-4.5 h-4.5" />}
                    </button>
                    <button
                      onClick={() => openEditModal(banner)}
                      className="w-10 h-10 rounded-2xl flex items-center justify-center bg-foreground/5 text-foreground/60 border border-foreground/10 hover:bg-foreground/10 hover:text-foreground transition-all"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteBanner(banner.id)}
                      className="w-10 h-10 rounded-2xl flex items-center justify-center bg-rose-500/10 text-rose-500 border border-rose-500/20 hover:bg-rose-500 hover:text-black transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Add / Edit Banner Popup Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Modal backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-background/80 backdrop-blur-md"
            />

            {/* Modal Box */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="glass max-w-xl w-full rounded-[2.5rem] border border-foreground/10 shadow-3xl overflow-hidden relative z-10 flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="p-6 md:p-8 border-b border-foreground/5 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-foreground font-inter">
                    {editingBanner ? "Edit Homepage Banner" : "Add New Homepage Banner"}
                  </h3>
                  <p className="text-[10px] text-foreground/40 mt-1">Configure layout, assets, and buttons for landing hero.</p>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center bg-foreground/5 text-foreground/45 hover:text-foreground hover:bg-foreground/10 transition-colors"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              {/* Form content */}
              <form onSubmit={handleSaveBanner} className="p-6 md:p-8 space-y-4 overflow-y-auto custom-scrollbar flex-1 text-xs font-semibold">
                
                {/* Title */}
                <div className="space-y-1.5">
                  <label className="text-foreground/45 text-[10px] font-bold uppercase tracking-wider block">Banner Main Title</label>
                  <input
                    type="text"
                    placeholder="e.g. CORE ARCHIVAL drop"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-amber-500/30 transition-all"
                    required
                  />
                </div>

                {/* Subtitle */}
                <div className="space-y-1.5">
                  <label className="text-foreground/45 text-[10px] font-bold uppercase tracking-wider block">Banner Subtitle / Description</label>
                  <input
                    type="text"
                    placeholder="e.g. Season drop styled for modern streets."
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-amber-500/30 transition-all"
                  />
                </div>

                {/* Image URL desktop */}
                <div className="space-y-1.5">
                  <label className="text-foreground/45 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Monitor className="w-3.5 h-3.5" /> Desktop Image URL
                  </label>
                  <input
                    type="url"
                    placeholder="e.g. https://cdn.shopify.com/images/desktop-hero.jpg"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-amber-500/30 transition-all"
                    required
                  />
                </div>

                {/* Image URL mobile */}
                <div className="space-y-1.5">
                  <label className="text-foreground/45 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5" /> Mobile Image URL (Optional)
                  </label>
                  <input
                    type="url"
                    placeholder="e.g. https://cdn.shopify.com/images/mobile-hero.jpg"
                    value={mobileImageUrl}
                    onChange={(e) => setMobileImageUrl(e.target.value)}
                    className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-amber-500/30 transition-all"
                  />
                </div>

                {/* CTA Label & Link */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-foreground/45 text-[10px] font-bold uppercase tracking-wider block">CTA Label</label>
                    <input
                      type="text"
                      placeholder="e.g. SHOP NOW"
                      value={ctaLabel}
                      onChange={(e) => setCtaLabel(e.target.value)}
                      className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-amber-500/30 transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-foreground/45 text-[10px] font-bold uppercase tracking-wider block">CTA Link</label>
                    <input
                      type="text"
                      placeholder="e.g. /collections/all"
                      value={ctaLink}
                      onChange={(e) => setCtaLink(e.target.value)}
                      className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-amber-500/30 transition-all"
                    />
                  </div>
                </div>

                {/* Active Toggle status */}
                <div className="flex items-center justify-between p-4 bg-foreground/[0.02] border border-foreground/5 rounded-2xl">
                  <div>
                    <span className="text-[12px] font-bold text-foreground">Make Banner Live</span>
                    <p className="text-[10px] text-foreground/40 mt-1">If enabled, this banner will render in the homepage slideshow.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded text-amber-500 bg-transparent border-foreground/20 focus:ring-0 focus:ring-offset-0 w-5 h-5 cursor-pointer"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-foreground/5">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-5 py-3 rounded-xl text-foreground/60 bg-foreground/5 hover:bg-foreground/10 transition-colors font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitLoading}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl bg-amber-500 text-black hover:opacity-95 transition-opacity font-bold"
                  >
                    <Save className="w-4 h-4" /> {submitLoading ? "Saving Banner..." : "Save Configuration"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
