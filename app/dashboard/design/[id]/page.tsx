"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  X,
  Loader2,
  Palette,
  FolderOpen,
  Link2,
  CheckCircle2,
  XCircle,
  FileText,
  MessageSquare,
  RefreshCw,
  ImageIcon,
  Send,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import WorkDriveGallery from "@/components/workdrive/WorkDriveGallery";

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

export default function DesignTaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [task, setTask] = useState<DesignTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [showRevisionInput, setShowRevisionInput] = useState(false);

  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadTask = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/design-tasks?status=all`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed to load task");
      const data = await res.json();
      const found = (data as DesignTask[]).find(t => t.id === id);
      if (!found) throw new Error("Design task not found");
      setTask(found);
      if (found.approvedFileId) setSelectedFileId(found.approvedFileId);
    } catch (e: any) {
      showToast(e.message, "err");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

  const updateTask = async (updates: Record<string, any>) => {
    try {
      const res = await fetch("/api/admin/design-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id, ...updates }),
      });
      if (!res.ok) throw new Error("Failed to update task");
      const data = await res.json();
      if (data.task) setTask(data.task);
      return data;
    } catch (e: any) {
      showToast(e.message, "err");
      throw e;
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setActionLoading(newStatus);
    try {
      if (newStatus === "approved" && !selectedFileId) {
        showToast("Select an image to approve first", "err");
        return;
      }
      if (newStatus === "rejected") {
        await updateTask({
          status: "rejected",
          rejectionNotes: revisionNotes,
        });
        setShowRevisionInput(false);
        setRevisionNotes("");
        showToast("Revision requested");
      } else if (newStatus === "approved") {
        await updateTask({
          status: "approved",
          approvedFileId: selectedFileId,
        });
        showToast("Design approved!");
      } else {
        await updateTask({ status: newStatus });
        showToast(`Status changed to ${newStatus}`);
      }
      loadTask();
    } catch {} finally {
      setActionLoading(null);
    }
  };

  if (loading && !task) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-foreground/10" />
        <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-foreground/20">Loading design task</span>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Palette className="w-12 h-12 text-foreground/10" />
        <p className="text-[13px] font-bold text-foreground/40 uppercase tracking-widest">Task Not Found</p>
        <button
          onClick={() => router.push("/dashboard/design")}
          className="px-4 py-2 bg-foreground/5 border border-foreground/10 rounded-xl text-[11px] font-bold uppercase tracking-wider text-foreground/60 hover:bg-foreground/10 transition-all"
        >
          Back to Design Studio
        </button>
      </div>
    );
  }

  const ss = STATUS_STYLES[task.status] || STATUS_STYLES.draft;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="pb-20 relative z-10"
    >
      {/* Background */}
      <div className="absolute -right-24 -top-24 w-96 h-96 bg-purple-500/5 blur-3xl rounded-full pointer-events-none" />

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

      {/* Top nav */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => router.push("/dashboard/design")}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Design Studio
        </button>
        <button
          onClick={loadTask}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold text-foreground/40 hover:text-foreground hover:bg-foreground/5 transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Split layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* LEFT — Gallery (60%) */}
        <div className="lg:col-span-3 space-y-4">
          <div className="glass-card rounded-[1.5rem] border border-foreground/[0.06] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-foreground/40" />
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-foreground/50">
                  Design Gallery
                </h2>
              </div>
              {task.workdriveFolderName && (
                <span className="text-[10px] font-mono text-foreground/30">{task.workdriveFolderName}</span>
              )}
            </div>
            <WorkDriveGallery
              folderId={task.workdriveFolderId}
              folderName={task.workdriveFolderName || task.title}
              allowUpload={task.status !== "approved"}
              onFileSelect={task.status !== "approved" ? (fileId, fileName) => {
                setSelectedFileId(fileId === selectedFileId ? null : fileId);
              } : undefined}
              selectedFileId={selectedFileId || undefined}
            />
          </div>
        </div>

        {/* RIGHT — Details & Actions (40%) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Title & Status */}
          <div className="glass-card rounded-[1.5rem] border border-foreground/[0.06] p-5 space-y-4">
            <span className={`inline-flex px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider border ${ss.bg} ${ss.text} ${ss.border}`}>
              {ss.label}
            </span>

            <h1 className="text-xl font-bold text-foreground tracking-tight leading-tight">
              {task.title}
            </h1>

            {task.description && (
              <p className="text-[12px] text-foreground/40 font-medium leading-relaxed">
                {task.description}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="bg-foreground/[0.02] rounded-xl p-3 border border-foreground/5">
                <div className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest mb-1">Created</div>
                <span className="text-[11px] font-bold text-foreground">
                  {new Date(task.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
              {task.createdBy && (
                <div className="bg-foreground/[0.02] rounded-xl p-3 border border-foreground/5">
                  <div className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest mb-1">Created By</div>
                  <span className="text-[11px] font-bold text-foreground truncate block">
                    {task.createdBy.name || task.createdBy.email.split("@")[0]}
                  </span>
                </div>
              )}
              {task.orderId && (
                <div className="bg-foreground/[0.02] rounded-xl p-3 border border-foreground/5">
                  <div className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest mb-1">Order</div>
                  <span className="text-[11px] font-mono font-bold text-foreground">{task.orderId}</span>
                </div>
              )}
              {task.workdriveFolderId && (
                <div className="bg-foreground/[0.02] rounded-xl p-3 border border-foreground/5 flex flex-col justify-between">
                  <div>
                    <div className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest mb-1">Folder</div>
                    <span className="text-[10px] font-mono text-foreground/60 truncate block">{task.workdriveFolderId.slice(0, 12)}...</span>
                  </div>
                  <a
                    href={`https://workdrive.zoho.in/${process.env.NEXT_PUBLIC_ZOHO_WD_TEAM_ID || "f48vv99d2b514c3a14d4faf3d5813eb13c454"}/ws/${process.env.NEXT_PUBLIC_ZOHO_WD_WORKSPACE_ID || "1egko45e1b49a70d2401fad5e5650485e18e1"}/folders/${task.workdriveFolderId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 flex items-center gap-1.5 text-[9px] font-bold text-indigo-400 hover:text-indigo-300 uppercase tracking-wider transition-colors"
                  >
                    <FolderOpen className="w-3 h-3" />
                    Open in WorkDrive
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Approved design preview */}
          {task.status === "approved" && task.approvedFileId && (
            <div className="glass-card rounded-[1.5rem] border border-green-500/15 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-green-400">Approved Design</h3>
              </div>
              <div className="rounded-xl overflow-hidden border border-foreground/5">
                <img
                  src={`/api/workdrive/image?fileId=${task.approvedFileId}`}
                  alt="Approved design"
                  className="w-full h-48 object-cover"
                />
              </div>
              {task.approvedBy && (
                <p className="text-[10px] text-foreground/40 font-medium">
                  Approved by {task.approvedBy.name || task.approvedBy.email.split("@")[0]}
                  {task.approvedAt && ` on ${new Date(task.approvedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                </p>
              )}
            </div>
          )}

          {/* Status flow & Actions */}
          <div className="glass-card rounded-[1.5rem] border border-foreground/[0.06] p-5 space-y-4">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-foreground/50">Actions</h3>

            {/* Workflow status flow */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {["draft", "in_review", "approved"].map((s, i) => {
                const si = STATUS_STYLES[s];
                const isCurrent = task.status === s;
                const isPast = ["draft", "in_review", "approved"].indexOf(task.status) > i;
                return (
                  <div key={s} className="flex items-center gap-2 shrink-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${
                      isCurrent
                        ? `${si.bg} ${si.border} ${si.text}`
                        : isPast
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        : "bg-foreground/[0.02] border-foreground/10 text-foreground/20"
                    }`}>
                      {isPast ? <Check className="w-3.5 h-3.5" /> : <span className="text-[9px] font-bold">{i + 1}</span>}
                    </div>
                    {i < 2 && <div className={`w-8 h-0.5 rounded-full ${isPast ? "bg-emerald-500/20" : "bg-foreground/5"}`} />}
                  </div>
                );
              })}
            </div>

            {/* Action buttons */}
            <div className="space-y-2">
              {task.status === "draft" && (
                <button
                  onClick={() => handleStatusChange("in_review")}
                  disabled={actionLoading === "in_review"}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl text-[11px] font-bold uppercase tracking-wider hover:bg-blue-500/20 transition-all disabled:opacity-50"
                >
                  {actionLoading === "in_review" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Submit for Review
                </button>
              )}

              {task.status === "in_review" && (
                <>
                  <button
                    onClick={() => handleStatusChange("approved")}
                    disabled={actionLoading === "approved" || !selectedFileId}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-[11px] font-bold uppercase tracking-wider hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                  >
                    {actionLoading === "approved" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {selectedFileId ? "Approve Selected Design" : "Select an image first"}
                  </button>

                  {!showRevisionInput ? (
                    <button
                      onClick={() => setShowRevisionInput(true)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-[11px] font-bold uppercase tracking-wider hover:bg-rose-500/20 transition-all"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Request Revision
                    </button>
                  ) : (
                    <div className="space-y-2 p-3 rounded-xl border border-rose-500/15 bg-rose-500/5">
                      <textarea
                        value={revisionNotes}
                        onChange={(e) => setRevisionNotes(e.target.value)}
                        placeholder="What changes are needed?"
                        rows={2}
                        className="w-full bg-background border border-foreground/10 rounded-lg px-3 py-2 text-[12px] text-foreground placeholder:text-foreground/20 focus:outline-none resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setShowRevisionInput(false); setRevisionNotes(""); }}
                          className="flex-1 px-3 py-2 bg-background border border-foreground/10 text-foreground/60 rounded-lg text-[10px] font-bold uppercase tracking-wider"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleStatusChange("rejected")}
                          disabled={actionLoading === "rejected"}
                          className="flex-1 px-3 py-2 bg-rose-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
                        >
                          {actionLoading === "rejected" ? "Sending..." : "Send Feedback"}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {task.status === "rejected" && (
                <button
                  onClick={() => handleStatusChange("draft")}
                  disabled={actionLoading === "draft"}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-foreground/5 border border-foreground/10 text-foreground/60 rounded-xl text-[11px] font-bold uppercase tracking-wider hover:bg-foreground/10 transition-all disabled:opacity-50"
                >
                  Reset to Draft
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
