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
  Upload,
  ExternalLink,
  Search,
  CheckCircle2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

interface GalleryImageItem {
  id: string;
  title?: string | null;
  subtitle?: string | null;
  imageUrl: string;
  altText?: string | null;
  linkUrl?: string | null;
  position: number;
  isActive: boolean;
  createdAt: string;
}

export default function WebStoreGalleryCMS() {
  const [images, setImages] = useState<GalleryImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GalleryImageItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Form states
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [altText, setAltText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [position, setPosition] = useState<number | undefined>(undefined);
  
  // Upload states
  const [uploading, setUploading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);

  const fetchImages = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/web-store/gallery?admin=true");
      if (!res.ok) throw new Error("Failed to load gallery images");
      const data = await res.json();
      setImages(data.images || []);
    } catch (err: any) {
      toast.error(err.message || "Error fetching gallery images");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, []);

  const openAddModal = () => {
    setEditingItem(null);
    setTitle("");
    setSubtitle("");
    setImageUrl("");
    setAltText("");
    setLinkUrl("");
    setIsActive(true);
    setPosition(images.length > 0 ? Math.max(...images.map(i => i.position)) + 1 : 1);
    setIsModalOpen(true);
  };

  const openEditModal = (item: GalleryImageItem) => {
    setEditingItem(item);
    setTitle(item.title || "");
    setSubtitle(item.subtitle || "");
    setImageUrl(item.imageUrl);
    setAltText(item.altText || "");
    setLinkUrl(item.linkUrl || "");
    setIsActive(item.isActive);
    setPosition(item.position);
    setIsModalOpen(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/admin/upload-image", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Image upload failed");

      setImageUrl(data.url);
      if (!altText && file.name) {
        const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        setAltText(cleanName);
      }
      toast.success("Image uploaded successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const handleToggleActive = async (item: GalleryImageItem) => {
    try {
      const res = await fetch(`/api/web-store/gallery/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !item.isActive }),
      });

      if (!res.ok) throw new Error("Failed to toggle status");
      toast.success(`Image ${!item.isActive ? "activated" : "deactivated"}`);
      fetchImages();
    } catch (err: any) {
      toast.error(err.message || "Error toggling status");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this gallery image?")) return;
    try {
      const res = await fetch(`/api/web-store/gallery/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete image");
      toast.success("Image deleted successfully");
      fetchImages();
    } catch (err: any) {
      toast.error(err.message || "Error deleting image");
    }
  };

  const handleMove = async (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= images.length) return;

    const newImages = [...images];
    const tempPos = newImages[index].position;
    newImages[index].position = newImages[targetIndex].position;
    newImages[targetIndex].position = tempPos;

    const tempItem = newImages[index];
    newImages[index] = newImages[targetIndex];
    newImages[targetIndex] = tempItem;

    setImages(newImages);

    try {
      const res = await fetch("/api/web-store/gallery/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: newImages.map((img) => ({ id: img.id, position: img.position })),
        }),
      });

      if (!res.ok) throw new Error("Failed to save reordered positions");
      toast.success("Order updated");
    } catch (err: any) {
      toast.error(err.message || "Error saving order");
      fetchImages();
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrl) {
      toast.error("Image is required (upload or provide URL)");
      return;
    }

    setSubmitLoading(true);
    try {
      const method = editingItem ? "PATCH" : "POST";
      const endpoint = editingItem ? `/api/web-store/gallery/${editingItem.id}` : "/api/web-store/gallery";

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || null,
          subtitle: subtitle.trim() || null,
          imageUrl,
          altText: altText.trim() || null,
          linkUrl: linkUrl.trim() || null,
          position: position ?? 0,
          isActive,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save image");

      toast.success(editingItem ? "Gallery image updated" : "Gallery image added");
      setIsModalOpen(false);
      fetchImages();
    } catch (err: any) {
      toast.error(err.message || "Error saving gallery image");
    } finally {
      setSubmitLoading(false);
    }
  };

  const filteredImages = images.filter((img) => {
    const q = searchQuery.toLowerCase();
    return (
      (img.title && img.title.toLowerCase().includes(q)) ||
      (img.altText && img.altText.toLowerCase().includes(q)) ||
      (img.subtitle && img.subtitle.toLowerCase().includes(q)) ||
      (img.linkUrl && img.linkUrl.toLowerCase().includes(q))
    );
  });

  const activeCount = images.filter((i) => i.isActive).length;
  const linkedCount = images.filter((i) => !!i.linkUrl).length;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass rounded-2xl p-6 border border-foreground/10">
        <div>
          <div className="flex text-amber-500 text-xs font-semibold uppercase tracking-wider mb-1 gap-2 items-center">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>PUBLIC STOREFRONT CMS</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Public Gallery Management</h1>
          <p className="text-foreground/60 text-xs mt-1">
            Upload and manage public gallery photos, alt names, titles, and clickable links for <code className="bg-foreground/10 px-2 py-0.5 rounded text-amber-500 font-mono text-[11px]">/gallery</code> page.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-black font-bold px-5 py-3 rounded-xl transition-all shadow-md text-xs shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Gallery Image
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass rounded-xl p-5 border border-foreground/10">
          <div className="flex items-center justify-between text-foreground/60 mb-2">
            <span className="text-xs uppercase tracking-wider font-semibold">Total Images</span>
            <ImageIcon className="w-4 h-4 text-foreground/40" />
          </div>
          <div className="text-3xl font-bold text-foreground">{images.length}</div>
        </div>
        <div className="glass rounded-xl p-5 border border-foreground/10">
          <div className="flex items-center justify-between text-foreground/60 mb-2">
            <span className="text-xs uppercase tracking-wider font-semibold">Active Visible</span>
            <Eye className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-3xl font-bold text-emerald-500">{activeCount}</div>
        </div>
        <div className="glass rounded-xl p-5 border border-foreground/10">
          <div className="flex items-center justify-between text-foreground/60 mb-2">
            <span className="text-xs uppercase tracking-wider font-semibold">With Clickable Link</span>
            <LinkIcon className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-3xl font-bold text-amber-500">{linkedCount}</div>
        </div>
      </div>

      {/* Search & Actions Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-foreground/40" />
          <input
            type="text"
            placeholder="Search title, alt text, link..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-foreground/5 border border-foreground/10 rounded-xl text-foreground placeholder-foreground/40 text-sm focus:outline-none focus:border-amber-500"
          />
        </div>
        <a
          href="/gallery"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs font-semibold text-amber-500 hover:underline bg-foreground/5 border border-amber-500/30 px-4 py-2.5 rounded-xl"
        >
          <span>View Live Gallery Page (/gallery)</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Gallery Grid */}
      {loading ? (
        <div className="py-20 text-center text-foreground/50 space-y-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs">Loading gallery images...</p>
        </div>
      ) : filteredImages.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-foreground/15 rounded-2xl bg-foreground/[0.02]">
          <ImageIcon className="w-12 h-12 text-foreground/20 mx-auto mb-3" />
          <h3 className="text-base font-bold text-foreground">No gallery images found</h3>
          <p className="text-foreground/50 text-xs mt-1 max-w-md mx-auto">
            {searchQuery ? "No results match your search query." : "Start by adding gallery images to showcase on the public gallery page."}
          </p>
          {!searchQuery && (
            <button
              onClick={openAddModal}
              className="mt-4 bg-amber-500 hover:bg-amber-600 text-black font-bold px-4 py-2 rounded-xl text-xs transition-all"
            >
              Upload First Image
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredImages.map((img, idx) => (
            <motion.div
              key={img.id}
              layout
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className={`group relative glass border rounded-2xl overflow-hidden flex flex-col justify-between transition-all ${
                img.isActive ? "border-foreground/10 hover:border-amber-500/30" : "border-red-500/30 opacity-60"
              }`}
            >
              <div>
                {/* Thumbnail Container */}
                <div className="relative aspect-[4/3] w-full bg-black/40 overflow-hidden">
                  <img
                    src={img.imageUrl}
                    alt={img.altText || img.title || "Gallery preview"}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  
                  {/* Status & Position Badge */}
                  <div className="absolute top-3 left-3 flex items-center gap-2">
                    <span className="bg-black/70 backdrop-blur-md text-white text-xs font-bold px-2.5 py-1 rounded-lg border border-white/10">
                      #{img.position}
                    </span>
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-lg border backdrop-blur-md ${
                        img.isActive
                          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                          : "bg-red-500/20 border-red-500/40 text-red-400"
                      }`}
                    >
                      {img.isActive ? "Active" : "Hidden"}
                    </span>
                  </div>

                  {/* Quick Move Buttons */}
                  <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 backdrop-blur-md p-1 rounded-lg border border-white/15">
                    <button
                      onClick={() => handleMove(idx, "up")}
                      disabled={idx === 0}
                      title="Move Up"
                      className="p-1 text-zinc-300 hover:text-white disabled:opacity-30"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleMove(idx, "down")}
                      disabled={idx === filteredImages.length - 1}
                      title="Move Down"
                      className="p-1 text-zinc-300 hover:text-white disabled:opacity-30"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Details */}
                <div className="p-5 space-y-2">
                  <h3 className="text-sm font-bold text-foreground truncate">
                    {img.title || <span className="italic text-foreground/40">Untitled Image</span>}
                  </h3>
                  
                  {img.subtitle && (
                    <p className="text-xs text-foreground/60 line-clamp-2">{img.subtitle}</p>
                  )}

                  <div className="pt-2 border-t border-foreground/10 space-y-1 text-xs text-foreground/60">
                    {img.altText && (
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-foreground/40 font-semibold shrink-0">Alt Name:</span>
                        <span className="text-foreground/80 truncate">{img.altText}</span>
                      </div>
                    )}
                    
                    {img.linkUrl ? (
                      <div className="flex items-center gap-1.5 text-amber-500 font-medium truncate">
                        <LinkIcon className="w-3 h-3 shrink-0" />
                        <a
                          href={img.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline truncate"
                        >
                          {img.linkUrl}
                        </a>
                      </div>
                    ) : (
                      <div className="text-foreground/40 italic">No link specified</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer Controls */}
              <div className="p-4 border-t border-foreground/10 bg-foreground/[0.02] flex items-center justify-between">
                <button
                  onClick={() => handleToggleActive(img)}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                    img.isActive
                      ? "bg-foreground/5 text-foreground/70 border-foreground/10 hover:bg-foreground/10"
                      : "bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/20"
                  }`}
                >
                  {img.isActive ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>Hide</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" />
                      <span>Show</span>
                    </>
                  )}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEditModal(img)}
                    className="p-2 text-foreground/70 hover:text-foreground hover:bg-foreground/10 rounded-lg transition-all"
                    title="Edit Image"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(img.id)}
                    className="p-2 text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded-lg transition-all"
                    title="Delete Image"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto text-foreground"
            >
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div className="flex items-center gap-2 text-foreground font-bold text-lg">
                  <Sparkles className="w-5 h-5 text-amber-500" />
                  <span>{editingItem ? "Edit Gallery Image" : "Add New Gallery Image"}</span>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 text-foreground/50 hover:text-foreground rounded-lg hover:bg-foreground/10 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-4">
                {/* Image Upload / URL Input */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-foreground/70 uppercase tracking-wider">
                    Image File / URL <span className="text-red-500">*</span>
                  </label>

                  {/* Upload Box */}
                  <div className="border-2 border-dashed border-border hover:border-amber-500/50 rounded-xl p-4 bg-foreground/[0.02] transition-all text-center relative">
                    {imageUrl ? (
                      <div className="relative aspect-[16/9] w-full max-h-48 rounded-lg overflow-hidden border border-border bg-black">
                        <img src={imageUrl} alt="Preview" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setImageUrl("")}
                          className="absolute top-2 right-2 p-1.5 bg-black/80 text-white rounded-full hover:bg-red-500 transition-all"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <label className="cursor-pointer flex flex-col items-center justify-center py-6 space-y-2">
                        <Upload className="w-8 h-8 text-amber-500" />
                        <span className="text-xs font-bold text-foreground">
                          {uploading ? "Uploading to storage..." : "Click to Upload Image File"}
                        </span>
                        <span className="text-[11px] text-foreground/40">JPG, PNG, WebP, GIF up to 10MB</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileUpload}
                          disabled={uploading}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>

                  {/* Or Manual URL Input */}
                  <div className="pt-2">
                    <span className="text-xs text-foreground/50">Or paste image URL directly:</span>
                    <input
                      type="url"
                      placeholder="https://..."
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      className="w-full mt-1 px-3.5 py-2.5 bg-foreground/5 border border-border rounded-xl text-foreground placeholder-foreground/40 text-xs focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                {/* Title & Subtitle */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-foreground/70 uppercase tracking-wider">
                      Title / Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Acid Wash Campaign"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-foreground/5 border border-border rounded-xl text-foreground placeholder-foreground/40 text-xs focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-foreground/70 uppercase tracking-wider">
                      Subtitle / Tagline
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Summer '26 Drop"
                      value={subtitle}
                      onChange={(e) => setSubtitle(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-foreground/5 border border-border rounded-xl text-foreground placeholder-foreground/40 text-xs focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                {/* Alt Name & Link URL */}
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-foreground/70 uppercase tracking-wider">
                      Alt Name / SEO Description
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Zica Bella Boxy Heavyweight Hoodie Acid Black"
                      value={altText}
                      onChange={(e) => setAltText(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-foreground/5 border border-border rounded-xl text-foreground placeholder-foreground/40 text-xs focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-foreground/70 uppercase tracking-wider">
                      Target Clickable Link URL
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. /collections/all or /products/boxy-tee or https://..."
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-foreground/5 border border-border rounded-xl text-foreground placeholder-foreground/40 text-xs focus:outline-none focus:border-amber-500"
                    />
                    <div className="flex flex-wrap gap-2 pt-1">
                      <span className="text-[11px] text-foreground/40">Quick presets:</span>
                      <button
                        type="button"
                        onClick={() => setLinkUrl("/collections/all")}
                        className="text-[11px] text-amber-500 hover:underline font-semibold"
                      >
                        /collections/all
                      </button>
                      <button
                        type="button"
                        onClick={() => setLinkUrl("/collections/tshirts")}
                        className="text-[11px] text-amber-500 hover:underline font-semibold"
                      >
                        /collections/tshirts
                      </button>
                      <button
                        type="button"
                        onClick={() => setLinkUrl("/story")}
                        className="text-[11px] text-amber-500 hover:underline font-semibold"
                      >
                        /story
                      </button>
                    </div>
                  </div>
                </div>

                {/* Position & Active Status */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-foreground/70 uppercase tracking-wider">
                      Display Position Order
                    </label>
                    <input
                      type="number"
                      value={position ?? 1}
                      onChange={(e) => setPosition(parseInt(e.target.value) || 0)}
                      className="w-full px-3.5 py-2.5 bg-foreground/5 border border-border rounded-xl text-foreground text-xs focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="flex items-center justify-between sm:justify-start gap-3 sm:pt-6">
                    <label className="text-xs text-foreground font-bold">Visible on Public Gallery:</label>
                    <button
                      type="button"
                      onClick={() => setIsActive(!isActive)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        isActive ? "bg-emerald-500" : "bg-foreground/20"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          isActive ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Form Actions */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl border border-border text-foreground/70 hover:text-foreground text-xs font-semibold hover:bg-foreground/5 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitLoading || uploading}
                    className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-black font-bold px-5 py-2.5 rounded-xl transition-all shadow-md text-xs disabled:opacity-50"
                  >
                    {submitLoading ? (
                      <span>Saving...</span>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>Save Gallery Image</span>
                      </>
                    )}
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
