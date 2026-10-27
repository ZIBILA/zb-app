"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Image, Film, Music, FileText, Search, Trash2, Edit3, Download,
  ExternalLink, Filter, RefreshCcw, Eye, ArrowDownLeft, ArrowUpRight,
  User, Calendar, Clock, Check, X, Loader2, AlertCircle, ShieldAlert, Sparkles
} from "lucide-react";
import { toast } from "sonner";

interface MediaItem {
  id: string;
  waMessageId: string | null;
  phoneNumber: string;
  customerName: string;
  customerEmail: string | null;
  direction: "inbound" | "outbound";
  body: string | null;
  mediaUrl: string;
  mediaType: string;
  status: string;
  createdAt: string;
}

export default function WhatsAppMediaManagerPage() {
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [mediaTypeFilter, setMediaTypeFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modals & Lightbox State
  const [previewMedia, setPreviewMedia] = useState<MediaItem | null>(null);
  const [editingMedia, setEditingMedia] = useState<MediaItem | null>(null);
  const [editCaptionText, setEditCaptionText] = useState<string>("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [failedMediaIds, setFailedMediaIds] = useState<Record<string, boolean>>({});

  const fetchMedia = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "24",
        type: mediaTypeFilter,
        direction: directionFilter,
        search: searchQuery
      });

      const res = await fetch(`/api/whatsapp/chat/media-manager?${params.toString()}`);
      const data = await res.json();

      if (res.ok && data.success) {
        setMediaList(data.media || []);
        setTotalCount(data.total || 0);
        setTotalPages(data.totalPages || 1);
      } else {
        toast.error(data.error || "Failed to load WhatsApp media records.");
      }
    } catch (err) {
      toast.error("Network error connecting to WhatsApp Media API.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMedia();
  }, [page, mediaTypeFilter, directionFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchMedia();
  };

  const handleDeleteMedia = async (id: string) => {
    setActionLoading(true);
    const toastId = toast.loading("Deleting WhatsApp media record...");
    try {
      const res = await fetch(`/api/whatsapp/chat/media-manager?id=${id}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success("Media deleted successfully!", { id: toastId });
        setMediaList(prev => prev.filter(m => m.id !== id));
        setDeletingId(null);
        if (previewMedia?.id === id) setPreviewMedia(null);
      } else {
        toast.error(data.error || "Failed to delete media record.", { id: toastId });
      }
    } catch (err) {
      toast.error("Network error deleting media record.", { id: toastId });
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateCaption = async () => {
    if (!editingMedia) return;
    setActionLoading(true);
    const toastId = toast.loading("Updating media caption...");
    try {
      const res = await fetch(`/api/whatsapp/chat/media-manager`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingMedia.id,
          body: editCaptionText
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success("Caption updated successfully!", { id: toastId });
        setMediaList(prev => prev.map(m => m.id === editingMedia.id ? { ...m, body: editCaptionText } : m));
        setEditingMedia(null);
      } else {
        toast.error(data.error || "Failed to update caption.", { id: toastId });
      }
    } catch (err) {
      toast.error("Network error updating caption.", { id: toastId });
    } finally {
      setActionLoading(false);
    }
  };

  const getMediaIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "image":
        return <Image className="w-4 h-4 text-emerald-400" />;
      case "video":
        return <Film className="w-4 h-4 text-sky-400" />;
      case "audio":
      case "voice":
        return <Music className="w-4 h-4 text-violet-400" />;
      default:
        return <FileText className="w-4 h-4 text-amber-400" />;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 lg:p-8 space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-foreground/[0.03] border border-foreground/10 p-6 rounded-2xl backdrop-blur-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
              <Image className="w-6 h-6" />
            </span>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-foreground flex items-center gap-2">
                <span>WhatsApp Live Chat Media Manager</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono">
                  {totalCount} Items
                </span>
              </h1>
              <p className="text-xs text-foreground/60 mt-0.5">
                View, filter, manage, and delete all customer and agent media attachments across WhatsApp live chat threads.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={fetchMedia}
          disabled={loading}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-foreground/[0.06] hover:bg-foreground/10 text-foreground font-semibold text-xs rounded-xl border border-foreground/10 transition-all shrink-0"
        >
          <RefreshCcw className={`w-4 h-4 text-emerald-400 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh Media</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-foreground/[0.03] border border-foreground/5 p-4 rounded-2xl">
        {/* Media Type Tabs */}
        <div className="md:col-span-6 flex flex-wrap items-center gap-1.5">
          {[
            { label: "All Media", value: "all", icon: Image },
            { label: "Photos", value: "image", icon: Image },
            { label: "Videos", value: "video", icon: Film },
            { label: "Audio Notes", value: "audio", icon: Music },
            { label: "Documents", value: "document", icon: FileText }
          ].map(tab => {
            const IconComp = tab.icon;
            const active = mediaTypeFilter === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => { setMediaTypeFilter(tab.value); setPage(1); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  active 
                    ? "bg-emerald-500 text-zinc-950 shadow-md font-bold" 
                    : "bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-white/5"
                }`}
              >
                <IconComp className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Direction Filter */}
        <div className="md:col-span-3 flex items-center gap-1.5 bg-background border border-foreground/5 p-1 rounded-xl">
          <button
            onClick={() => { setDirectionFilter("all"); setPage(1); }}
            className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all text-center ${
              directionFilter === "all" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            All Threads
          </button>
          <button
            onClick={() => { setDirectionFilter("inbound"); setPage(1); }}
            className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1 ${
              directionFilter === "inbound" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <ArrowDownLeft className="w-3 h-3" />
            <span>Inbound</span>
          </button>
          <button
            onClick={() => { setDirectionFilter("outbound"); setPage(1); }}
            className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1 ${
              directionFilter === "outbound" ? "bg-sky-500/20 text-sky-400 border border-sky-500/30" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <ArrowUpRight className="w-3 h-3" />
            <span>Outbound</span>
          </button>
        </div>

        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="md:col-span-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-foreground/50 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search phone or body..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-background border border-foreground/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-foreground outline-none focus:border-emerald-500/50"
            />
          </div>
        </form>
      </div>

      {/* Media Grid */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
          <p className="text-xs text-foreground/60">Loading WhatsApp Media items...</p>
        </div>
      ) : mediaList.length === 0 ? (
        <div className="py-20 bg-foreground/[0.03] border border-foreground/5 rounded-2xl flex flex-col items-center justify-center text-center p-8">
          <Image className="w-12 h-12 text-foreground/30 mb-3" />
          <h3 className="text-sm font-bold text-foreground/80">No Media Found</h3>
          <p className="text-xs text-foreground/50 max-w-sm mt-1">
            No media attachments match your filter criteria. When customers send photos, videos, or files in WhatsApp live chat, they will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {mediaList.map(item => {
            const isInbound = item.direction === "inbound";
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-foreground/[0.03] border border-foreground/10 rounded-2xl overflow-hidden flex flex-col justify-between group hover:border-emerald-500/30 transition-all shadow-sm"
              >
                {/* Media Content Preview */}
                <div className="relative aspect-video bg-background flex items-center justify-center overflow-hidden">
                  {failedMediaIds[item.id] ? (
                    <div className="flex flex-col items-center justify-center gap-1.5 text-foreground/50 p-4 text-center">
                      <AlertCircle className="w-8 h-8 text-rose-500/80 mb-1" />
                      <span className="text-xs font-semibold text-foreground/80">Media Unavailable</span>
                      <span className="text-[10px] text-foreground/50">Expired or deleted from storage</span>
                    </div>
                  ) : item.mediaType === "image" || (!item.mediaType && (item.mediaUrl.startsWith("data:image/") || /\.(jpeg|jpg|png|webp|gif)/i.test(item.mediaUrl))) ? (
                    <img 
                      src={item.mediaUrl} 
                      alt="Attachment Preview"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (item.waMessageId && !target.dataset.triedFallback) {
                          target.dataset.triedFallback = "true";
                          target.src = `/api/whatsapp/chat/media?mediaId=${item.waMessageId}`;
                        } else {
                          setFailedMediaIds(prev => ({ ...prev, [item.id]: true }));
                        }
                      }}
                    />
                  ) : item.mediaType === "video" || /\.(mp4|mov|webm)/i.test(item.mediaUrl) ? (
                    <video 
                      src={item.mediaUrl} 
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (item.waMessageId && !target.dataset.triedFallback) {
                          target.dataset.triedFallback = "true";
                          target.src = `/api/whatsapp/chat/media?mediaId=${item.waMessageId}`;
                        } else {
                          setFailedMediaIds(prev => ({ ...prev, [item.id]: true }));
                        }
                      }}
                    />
                  ) : item.mediaType === "audio" || /\.(mp3|ogg|wav)/i.test(item.mediaUrl) ? (
                    <div className="flex flex-col items-center gap-2 text-violet-400">
                      <Music className="w-8 h-8 animate-pulse" />
                      <span className="text-[10px] font-mono text-foreground/60">Audio Clip</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-amber-400">
                      <FileText className="w-8 h-8" />
                      <span className="text-[10px] font-mono text-foreground/60">Document File</span>
                    </div>
                  )}

                  {/* Direction Badge */}
                  <div className="absolute top-2 left-2 flex items-center gap-1 bg-foreground/[0.03] backdrop-blur-md px-2 py-1 rounded-lg text-[10px] font-mono border border-foreground/10">
                    {isInbound ? (
                      <span className="text-emerald-400 flex items-center gap-1"><ArrowDownLeft className="w-3 h-3" /> Customer</span>
                    ) : (
                      <span className="text-sky-400 flex items-center gap-1"><ArrowUpRight className="w-3 h-3" /> Outbound</span>
                    )}
                  </div>

                  {/* View Lightbox Hover Overlay */}
                  <div className="absolute inset-0 bg-foreground/[0.03] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-sm">
                    <button
                      onClick={() => setPreviewMedia(item)}
                      className="p-2.5 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-bold rounded-xl text-xs transition-transform hover:scale-105 flex items-center gap-1 shadow-lg"
                    >
                      <Eye className="w-4 h-4" />
                      <span>Preview</span>
                    </button>
                  </div>
                </div>

                {/* Card Info & Caption */}
                <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs text-foreground truncate">{item.customerName}</span>
                      <span className="text-[10px] font-mono text-foreground/50">+{item.phoneNumber}</span>
                    </div>
                    {item.body && (
                      <p className="text-[11px] text-foreground/60 line-clamp-2 leading-relaxed font-sans">
                        {item.body}
                      </p>
                    )}
                  </div>

                  {/* Footer Meta & Actions */}
                  <div className="pt-2 border-t border-foreground/5 flex items-center justify-between text-[10px] text-foreground/50">
                    <span>{new Date(item.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</span>
                    
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { setEditingMedia(item); setEditCaptionText(item.body || ""); }}
                        className="p-1.5 hover:bg-foreground/5 rounded-lg text-foreground/60 hover:text-emerald-400 transition-colors"
                        title="Edit Caption"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeletingId(item.id)}
                        className="p-1.5 hover:bg-rose-500/10 rounded-lg text-foreground/60 hover:text-rose-400 transition-colors"
                        title="Delete Media"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-xl bg-background border border-foreground/10 text-xs text-foreground/80 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs font-mono text-foreground/60">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 rounded-xl bg-background border border-foreground/10 text-xs text-foreground/80 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {/* Lightbox / Preview Modal */}
      <AnimatePresence>
        {previewMedia && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-foreground/[0.03] backdrop-blur-xl flex items-center justify-center p-4 lg:p-8"
          >
            <div className="relative max-w-4xl w-full bg-background border border-foreground/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
              {/* Modal Header */}
              <div className="p-4 border-b border-foreground/10 flex items-center justify-between bg-foreground/[0.03]">
                <div className="flex items-center gap-2">
                  {getMediaIcon(previewMedia.mediaType)}
                  <span className="font-bold text-sm text-foreground">{previewMedia.customerName} (+{previewMedia.phoneNumber})</span>
                </div>
                <button
                  onClick={() => setPreviewMedia(null)}
                  className="p-1 rounded-lg hover:bg-foreground/10 text-foreground/60 hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 flex-1 overflow-y-auto flex flex-col items-center justify-center bg-foreground/[0.03]">
                {previewMedia.mediaType === "image" || previewMedia.mediaUrl.startsWith("data:image/") || /\.(jpeg|jpg|png|webp|gif)/i.test(previewMedia.mediaUrl) ? (
                  <img
                    src={previewMedia.mediaUrl}
                    alt="Full Preview"
                    className="max-h-[60vh] max-w-full rounded-2xl object-contain border border-foreground/10 shadow-lg"
                  />
                ) : previewMedia.mediaType === "video" || /\.(mp4|mov|webm)/i.test(previewMedia.mediaUrl) ? (
                  <video src={previewMedia.mediaUrl} controls className="max-h-[60vh] rounded-2xl border border-foreground/10" />
                ) : (
                  <audio src={previewMedia.mediaUrl} controls className="w-full max-w-md my-8" />
                )}

                {previewMedia.body && (
                  <div className="mt-4 p-3 bg-background border border-foreground/5 rounded-xl text-xs text-foreground/80 max-w-xl text-center">
                    {previewMedia.body}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-foreground/10 bg-background flex items-center justify-between">
                <span className="text-xs font-mono text-foreground/50">
                  ID: {previewMedia.id}
                </span>
                <a
                  href={previewMedia.mediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md"
                >
                  <Download className="w-4 h-4" />
                  <span>Download File</span>
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Caption Modal */}
      <AnimatePresence>
        {editingMedia && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-foreground/[0.03] backdrop-blur-md flex items-center justify-center p-4"
          >
            <div className="w-full max-w-md bg-background border border-foreground/10 rounded-2xl p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-emerald-400" />
                  <span>Edit Media Caption</span>
                </h3>
                <button onClick={() => setEditingMedia(null)} className="text-foreground/60 hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-foreground/60 font-mono">Caption / Message Text</label>
                <textarea
                  value={editCaptionText}
                  onChange={e => setEditCaptionText(e.target.value)}
                  rows={4}
                  className="w-full bg-foreground/[0.06] border border-foreground/10 rounded-xl p-3 text-xs text-foreground outline-none focus:border-emerald-500/50"
                  placeholder="Enter custom text message for this media item..."
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setEditingMedia(null)}
                  className="flex-1 py-2 bg-foreground/[0.06] hover:bg-foreground/10 text-foreground/80 font-semibold rounded-xl text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateCaption}
                  disabled={actionLoading}
                  className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-bold rounded-xl text-xs flex items-center justify-center gap-1 shadow-md disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Save Caption</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-foreground/[0.03] backdrop-blur-md flex items-center justify-center p-4"
          >
            <div className="w-full max-w-sm bg-background border border-rose-500/30 rounded-2xl p-6 space-y-4 shadow-2xl text-center">
              <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-full flex items-center justify-center mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-foreground">Delete WhatsApp Media?</h3>
                <p className="text-xs text-foreground/60 mt-1">
                  This action will permanently delete this media attachment record from the database.
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setDeletingId(null)}
                  className="flex-1 py-2 bg-foreground/[0.06] hover:bg-foreground/10 text-foreground/80 font-semibold rounded-xl text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteMedia(deletingId)}
                  disabled={actionLoading}
                  className="flex-1 py-2 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1 shadow-md disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  <span>Confirm Delete</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
