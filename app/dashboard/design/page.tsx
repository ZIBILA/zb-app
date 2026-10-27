"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  RefreshCw,
  Search,
  Loader2,
  Check,
  X,
  Palette,
  ImageIcon,
  FolderOpen,
  ExternalLink,
  MoreVertical,
  Trash2,
  Eye,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type DesignTask = {
  id: string;
  title: string;
  description: string | null;
  orderId: string | null;
  status: string;
  workdriveFolderId: string | null;
  workdriveFolderName: string | null;
  approvedFileId: string | null;
  approvedBy: { id: string; name: string | null; email: string } | null;
  approvedAt: string | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  draft: { bg: "bg-foreground/30", text: "text-foreground/60", border: "border-foreground/30", label: "Draft" },
  in_review: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/15", label: "In Review" },
  approved: { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/15", label: "Approved" },
  rejected: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/15", label: "Rejected" },
};

export default function DesignStudioPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<DesignTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  // New task modal
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newOrderId, setNewOrderId] = useState("");
  const [creating, setCreating] = useState(false);

  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/admin/design-tasks", window.location.origin);
      if (statusFilter !== "all") url.searchParams.set("status", statusFilter);
      const res = await fetch(url.toString(), { credentials: "same-origin" });
      if (!res.ok) throw new Error("Failed to load design tasks");
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch (e: any) {
      showToast(e.message, "err");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const createTask = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/design-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          title: newTitle,
          description: newDesc || null,
          orderId: newOrderId || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to create design task");
      showToast("Design task created");
      setNewOpen(false);
      setNewTitle("");
      setNewDesc("");
      setNewOrderId("");
      loadTasks();
    } catch (e: any) {
      showToast(e.message, "err");
    } finally {
      setCreating(false);
    }
  };

  const deleteTask = async (id: string) => {
    if (!confirm("Delete this design task?")) return;
    try {
      const res = await fetch(`/api/admin/design-tasks?id=${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed to delete");
      showToast("Design task deleted");
      loadTasks();
    } catch (e: any) {
      showToast(e.message, "err");
    }
  };

  const filteredTasks = tasks.filter(t =>
    t.title.toLowerCase().includes(q.toLowerCase()) ||
    t.description?.toLowerCase().includes(q.toLowerCase())
  );

  const statusCounts = {
    all: tasks.length,
    draft: tasks.filter(t => t.status === "draft").length,
    in_review: tasks.filter(t => t.status === "in_review").length,
    approved: tasks.filter(t => t.status === "approved").length,
    rejected: tasks.filter(t => t.status === "rejected").length,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="pb-20 space-y-6 relative z-10 overflow-hidden"
    >
      {/* Background */}
      <div className="absolute -right-24 -top-24 w-96 h-96 bg-purple-500/5 blur-3xl rounded-full pointer-events-none" />
      <div className="absolute -left-24 top-1/2 w-72 h-72 bg-foreground/5 blur-3xl rounded-full pointer-events-none" />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className={`fixed top-8 left-1/2 z-[200] max-w-[90vw] w-max px-4 py-3 rounded-2xl text-[12px] font-bold shadow-2xl flex items-center justify-center gap-2 border backdrop-blur-xl ${
              toast.type === "ok"
                ? "bg-background/90 text-foreground border-foreground/10"
                : "bg-rose-500 text-white border-rose-500/20"
            }`}
          >
            {toast.type === "ok" && <Check className="w-4 h-4 text-emerald-500" />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/10 shadow-inner shrink-0">
            <Palette className="w-5 h-5 text-purple-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg lg:text-xl font-bold text-foreground tracking-tight leading-none truncate uppercase">
              Design Studio
            </h1>
            <p className="text-[9px] text-foreground/40 font-bold uppercase tracking-[0.2em] mt-0.5">
              Design Management &middot; {tasks.length} tasks
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadTasks}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-background border border-foreground/[0.08] text-foreground rounded-xl text-[9px] font-bold uppercase tracking-[0.15em] hover:bg-foreground/[0.02] disabled:opacity-50 transition-all active:scale-95"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-2 px-5 py-2 bg-foreground text-background rounded-xl text-[9px] font-bold uppercase tracking-[0.15em] hover:opacity-90 transition-all active:scale-95 shadow-lg shadow-foreground/15"
          >
            <Plus className="w-3.5 h-3.5" />
            New Design Task
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 justify-between items-stretch md:items-center px-1">
        <div className="flex gap-1 p-1 bg-foreground/[0.03] rounded-xl border border-foreground/5 overflow-x-auto custom-scrollbar">
          {(["all", "draft", "in_review", "approved", "rejected"] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest whitespace-nowrap transition-all flex items-center gap-1.5 ${
                statusFilter === s ? "bg-background text-foreground shadow-sm" : "text-foreground/40 hover:text-foreground"
              }`}
            >
              {s === "all" ? "All" : STATUS_STYLES[s]?.label || s}
              <span className="text-[9px] font-mono text-foreground/30">
                {statusCounts[s]}
              </span>
            </button>
          ))}
        </div>

        <div className="relative w-full md:max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/20" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search design tasks..."
            className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl pl-10 pr-4 py-2 text-[12px] font-medium text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-foreground/10 transition-all shadow-inner"
          />
        </div>
      </div>

      {/* Tasks Grid */}
      <div className="px-1">
        {loading && tasks.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-foreground/10" />
            <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-foreground/20">Loading designs</span>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center text-center gap-4 bg-foreground/[0.01] rounded-[2rem] border border-dashed border-foreground/10">
            <Palette className="w-12 h-12 text-foreground/10" />
            <div className="space-y-1">
              <p className="text-[13px] font-bold text-foreground/40 uppercase tracking-widest">No Design Tasks</p>
              <p className="text-[11px] text-foreground/20 font-medium max-w-xs mx-auto">Create a new design task to start managing design versions and approvals.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredTasks.map((task, i) => {
              const ss = STATUS_STYLES[task.status] || STATUS_STYLES.draft;
              return (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="group glass-card rounded-[1.5rem] border border-foreground/[0.06] hover:border-foreground/15 hover:shadow-xl transition-all duration-300 overflow-hidden"
                >
                  <div className="p-5 space-y-4">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider border ${ss.bg} ${ss.text} ${ss.border}`}>
                        {ss.label}
                      </span>
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="p-1.5 rounded-lg text-foreground/20 hover:text-rose-500 hover:bg-rose-500/10 transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Title */}
                    <div>
                      <h3 className="text-lg font-bold text-foreground tracking-tight leading-tight">
                        {task.title}
                      </h3>
                      {task.description && (
                        <p className="text-[11px] text-foreground/35 font-medium mt-1 line-clamp-2 leading-relaxed">
                          {task.description}
                        </p>
                      )}
                    </div>

                    {/* Preview images - 2x2 grid */}
                    {task.workdriveFolderId && (
                      <DesignPreviewGrid folderId={task.workdriveFolderId} />
                    )}

                    {/* Meta */}
                    <div className="flex items-center justify-between pt-2 border-t border-foreground/5">
                      <div className="flex items-center gap-3 text-[10px] text-foreground/30 font-medium">
                        <span>{new Date(task.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                        {task.createdBy && (
                          <span>by {task.createdBy.name || task.createdBy.email.split("@")[0]}</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => router.push(`/dashboard/design/${task.id}`)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-foreground/5 border border-foreground/10 rounded-xl text-[10px] font-bold uppercase tracking-wider text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-all"
                      >
                        <ImageIcon className="w-3 h-3" />
                        Open Gallery
                      </button>
                      <button
                        onClick={() => router.push(`/dashboard/design/${task.id}`)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-foreground text-background rounded-xl text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition-all shadow-sm"
                      >
                        <Eye className="w-3 h-3" />
                        Review & Approve
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Design Task Modal */}
      <AnimatePresence>
        {newOpen && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-lg glass-card rounded-[2.5rem] border border-foreground/10 shadow-3xl p-8 space-y-6"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground uppercase">New Design Task</h2>
                  <p className="text-[11px] text-foreground/40 mt-1 font-medium">A WorkDrive folder will be auto-created for images.</p>
                </div>
                <button onClick={() => setNewOpen(false)} className="p-2 rounded-full hover:bg-foreground/5 text-foreground/40 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/40 ml-1">Title *</label>
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Summer Crop Top Collection"
                    className="w-full bg-background border border-foreground/10 rounded-xl px-4 py-3 text-[13px] font-medium text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-foreground/30 shadow-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/40 ml-1">Description</label>
                  <textarea
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Design brief, requirements, notes..."
                    rows={3}
                    className="w-full bg-background border border-foreground/10 rounded-xl px-4 py-3 text-[13px] font-medium text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-foreground/30 shadow-sm resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/40 ml-1">Order ID (optional)</label>
                  <input
                    value={newOrderId}
                    onChange={(e) => setNewOrderId(e.target.value)}
                    placeholder="Link to an order..."
                    className="w-full bg-background border border-foreground/10 rounded-xl px-4 py-3 text-[13px] font-medium text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-foreground/30 shadow-sm"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setNewOpen(false)}
                  className="flex-1 px-4 py-3 bg-background border border-foreground/10 text-foreground/60 rounded-2xl text-[11px] font-bold uppercase tracking-wider hover:bg-foreground/5 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={createTask}
                  disabled={!newTitle.trim() || creating}
                  className="flex-1 px-4 py-3 bg-foreground text-background rounded-2xl text-[11px] font-bold uppercase tracking-wider hover:opacity-90 shadow-lg disabled:opacity-40 transition-all"
                >
                  {creating ? "Creating..." : "Create Task"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Preview Grid (2x2 thumbnails) ────────────
function DesignPreviewGrid({ folderId }: { folderId: string }) {
  const [files, setFiles] = useState<{ id: string; name: string; isImage: boolean }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/workdrive/files?folderId=${folderId}`, {
          credentials: "same-origin",
        });
        if (res.ok) {
          const data = await res.json();
          setFiles((data.files || []).filter((f: any) => f.isImage).slice(0, 5));
        }
      } catch {} finally {
        setLoading(false);
      }
    };
    load();
  }, [folderId]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-xl bg-foreground/5 animate-pulse" />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex items-center gap-2 py-4 justify-center rounded-xl border border-dashed border-foreground/10">
        <ImageIcon className="w-4 h-4 text-foreground/15" />
        <span className="text-[10px] text-foreground/20 font-medium">No images uploaded yet</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {files.slice(0, 4).map((file) => (
        <div key={file.id} className="aspect-square rounded-xl overflow-hidden bg-foreground/5 border border-foreground/5">
          <img
            src={`/api/workdrive/image?fileId=${file.id}`}
            alt={file.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      ))}
      {files.length > 4 && (
        <div className="absolute bottom-1 right-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[9px] font-bold">
          +{files.length - 4}
        </div>
      )}
    </div>
  );
}
