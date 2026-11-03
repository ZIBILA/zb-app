"use client";

import { useEffect, useState, useRef } from "react";
import { 
  ShieldCheck, 
  Zap, 
  X,
  Upload,
  Sparkles,
  Globe
} from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useSession } from "next-auth/react";
import FeaturedUsersSection from "@/components/FeaturedUsersSection";

// --- Types ---
interface CommunityUpdate {
  id: string;
  type: 'EVENT' | 'ACTIVITY' | 'OFFER';
  title: string;
  description: string;
}

export default function CommunityPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [updates, setUpdates] = useState<CommunityUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<any>(null);
  
  const isMember = !!(session as any)?.customer?.communityMember?.isVerified;
  const userEmail = session?.user?.email || (session as any)?.customer?.email;

  // Submission Form State
  const [showSubForm, setShowSubForm] = useState(false);
  const [subForm, setSubForm] = useState({ name: '', email: '', imageUrl: '', instagramUrl: '', quote: '' });
  const [subStatus, setSubStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error', msg: string }>({ type: 'idle', msg: '' });
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    fetchCommunityData();
    fetchShopSettings();
  }, [session]);

  useEffect(() => {
    if (status === "unauthenticated" && !loading) {
      window.location.href = `/login?callbackUrl=/community`;
    }
  }, [status, loading]);

  const fetchCommunityData = async () => {
    try {
      const res = await fetch('/api/community/updates');
      const data = await res.json();
      setUpdates(data.updates || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchShopSettings = async () => {
    try {
      const res = await fetch('/api/admin/settings');
      const data = await res.json();
      setSettings(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/community/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        setSubForm(prev => ({ ...prev, imageUrl: data.url }));
      } else {
        alert("Upload failed: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Error uploading file");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmission = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubStatus({ type: 'loading', msg: '' });
    try {
      const res = await fetch('/api/community/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: subForm.imageUrl,
          instagramUrl: subForm.instagramUrl,
          styleDescription: subForm.quote,
        })
      });
      if (res.ok) {
        setSubStatus({ type: 'success', msg: 'Your fit has been queued for moderation.' });
        setTimeout(() => {
          setSubForm({ name: '', email: '', imageUrl: '', instagramUrl: '', quote: '' });
          setSubStatus({ type: 'idle', msg: '' });
          setShowSubForm(false);
        }, 3000);
      } else {
        const err = await res.json().catch(() => ({}));
        setSubStatus({ type: 'error', msg: err?.error || 'Submission failed. Please try again.' });
      }
    } catch (e) {
      setSubStatus({ type: 'error', msg: 'Network error. Try again.' });
    }
  };

  return (
    <main
      className="min-h-screen bg-background overflow-hidden relative"
      style={{
        paddingTop: 'max(5.5rem, calc(env(safe-area-inset-top) + 4.5rem))',
        paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))'
      }}
    >
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden>
        <div className="absolute top-[-10%] right-[-10%] w-[80vw] h-[80vw] bg-foreground/[0.03] rounded-full blur-[200px]" />
        <div className="absolute bottom-[-5%] left-[-5%] w-[60vw] h-[60vw] bg-foreground/[0.02] rounded-full blur-[150px]" />
      </div>

      <div className="max-w-xl mx-auto px-4 relative z-10">

        {/* ── Header ── */}
        <header className="mb-10 flex flex-col items-center text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex flex-col items-center"
          >
            <div className="px-3 py-1.5 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] backdrop-blur-md mb-4 inline-flex items-center gap-2">
              <Globe className="w-3 h-3 text-foreground/60 dark:text-foreground/40" />
              <span className="text-[8px] font-black text-foreground/80 dark:text-foreground/60 uppercase tracking-[0.2em] leading-none">Global Network</span>
            </div>
          </motion.div>

          <h1 className="text-[28px] font-light tracking-tight text-foreground leading-[1.15] mb-3">
            The Inner{" "}
            <span className="text-foreground/50 dark:text-foreground/30 italic font-serif">Circle</span>
          </h1>
          <p className="text-foreground/70 dark:text-foreground/50 text-[11px] font-medium max-w-[260px] leading-relaxed tracking-wide mb-5">
            Exclusive access for verified Zica Bella customers.
          </p>

          <AnimatePresence>
            {isMember && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => setShowSubForm(true)}
                className="h-11 px-6 rounded-full bg-foreground text-background text-[11px] font-bold tracking-wide flex items-center gap-2 transition-all active:scale-95"
              >
                <Upload className="w-3.5 h-3.5" />
                Publish Your Look
              </motion.button>
            )}
          </AnimatePresence>
        </header>

        {/* ── Featured Section ── */}
        <div className="mb-10">
          <FeaturedUsersSection
            showCommunity={true}
            title="The Visual Collective"
            subtitle="User Showcase"
            allFeatured={true}
            onUploadClick={() => setShowSubForm(true)}
          />
        </div>

        {/* ── Live Updates ── */}
        {updates.length > 0 && (
          <section className="mb-10">
            <div className="flex items-center gap-3 mb-4 px-1">
              <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <h2 className="text-[12px] font-bold tracking-tight text-foreground">Live Updates</h2>
            </div>
            <div className="space-y-3">
              {updates.map((update) => (
                <motion.div
                  key={update.id}
                  whileHover={{ scale: 1.01 }}
                  className="p-5 bg-white/40 dark:bg-white/[0.02] border border-foreground/[0.05] rounded-2xl backdrop-blur-xl shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase ${
                      update.type === 'EVENT' ? 'bg-blue-500/10 text-blue-500' : 'bg-emerald-500/10 text-emerald-500'
                    }`}>
                      {update.type}
                    </div>
                    <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  <h3 className="text-[14px] font-semibold tracking-tight text-foreground mb-1">{update.title}</h3>
                  <p className="text-[11px] text-foreground/55 leading-relaxed">{update.description}</p>
                </motion.div>
              ))}
            </div>
          </section>
        )}



      </div>

      {/* ══ SUBMISSION BOTTOM SHEET (mobile-first) ══ */}
      <AnimatePresence>
        {showSubForm && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSubForm(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-xl"
            />

            {/* Sheet */}
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative w-full sm:max-w-lg bg-background border-t sm:border border-foreground/10 sm:rounded-[2rem] rounded-t-[2rem] shadow-2xl"
              style={{ maxHeight: "92dvh" }}
            >
              {/* Drag handle - mobile only */}
              <div className="flex justify-center pt-3 pb-0 sm:hidden">
                <div className="w-9 h-1 rounded-full bg-foreground/15" />
              </div>

              {/* Scrollable content */}
              <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: "89dvh" }}>
                {/* Sheet header */}
                <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-foreground/[0.06] sticky top-0 bg-background z-10">
                  <div>
                    <h4 className="text-[17px] font-semibold text-foreground tracking-tight">Publish Look</h4>
                    <p className="text-[11px] text-foreground/45 mt-0.5">Share your fit with the community</p>
                  </div>
                  <button
                    onClick={() => setShowSubForm(false)}
                    className="w-8 h-8 rounded-full bg-foreground/[0.06] flex items-center justify-center active:scale-90 transition-all"
                  >
                    <X className="w-4 h-4 text-foreground/80 dark:text-foreground/60" />
                  </button>
                </div>

                {/* Form body */}
                <div className="px-5 py-5">
                  {subStatus.type === 'success' ? (
                    <div className="py-14 flex flex-col items-center justify-center text-center">
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mb-4">
                        <Sparkles className="w-14 h-14 text-blue-500" />
                      </motion.div>
                      <span className="text-[15px] font-light tracking-tight text-foreground leading-snug max-w-[220px]">
                        {subStatus.msg}
                      </span>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmission} className="space-y-4">

                      {/* ─ Image Upload ─ */}
                      <div>
                        <p className="text-[9px] font-bold text-foreground/60 dark:text-foreground/40 uppercase tracking-widest mb-2 ml-1">
                          Photo <span className="text-foreground/40 dark:text-foreground/20 font-normal normal-case">(required)</span>
                        </p>
                        {/* Upload zone */}
                        <div className="relative group/up h-44 rounded-[1.25rem] bg-foreground/[0.03] border border-dashed border-foreground/10 overflow-hidden flex flex-col items-center justify-center transition-all hover:bg-foreground/[0.05] hover:border-foreground/20">
                          {subForm.imageUrl ? (
                            <>
                              <img src={subForm.imageUrl} className="w-full h-full object-cover opacity-90" alt="Preview" />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/up:opacity-100 sm:flex hidden items-center justify-center backdrop-blur-sm transition-opacity">
                                <label className="cursor-pointer px-4 py-2 bg-white text-black rounded-full text-[11px] font-bold uppercase shadow-xl active:scale-95 transition-all">
                                  Change
                                  <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                                </label>
                              </div>
                              {/* Mobile always-visible change button */}
                              <div className="absolute bottom-3 right-3 sm:hidden">
                                <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 bg-black/60 text-white rounded-full text-[10px] font-bold uppercase backdrop-blur-md active:scale-95 transition-all">
                                  <Upload className="w-3 h-3" />
                                  Change
                                  <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                                </label>
                              </div>
                            </>
                          ) : (
                            <label className="flex flex-col items-center gap-3 cursor-pointer w-full h-full justify-center">
                              <div className="w-11 h-11 rounded-full bg-foreground/5 flex items-center justify-center">
                                {isUploading ? (
                                  <div className="w-5 h-5 rounded-full border-2 border-foreground/20 border-t-foreground animate-spin" />
                                ) : (
                                  <Upload className="w-5 h-5 text-foreground/35" />
                                )}
                              </div>
                              <div className="text-center px-4">
                                <p className="text-[11px] font-bold text-foreground/35 uppercase tracking-widest">
                                  {isUploading ? 'Uploading…' : 'Tap to Upload Photo'}
                                </p>
                                <p className="text-[9px] text-foreground/22 mt-1">JPG, PNG, WEBP</p>
                              </div>
                              <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                            </label>
                          )}
                        </div>
                        {/* URL fallback */}
                        <input
                          placeholder="Or paste image URL…"
                          value={subForm.imageUrl}
                          onChange={(e) => setSubForm({ ...subForm, imageUrl: e.target.value })}
                          className="w-full mt-2 bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl px-4 py-3 text-[12px] text-foreground/70 placeholder:text-foreground/22 focus:border-foreground/20 transition-all outline-none font-mono"
                        />
                      </div>

                      {/* ─ Name + Email row ─ */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[9px] font-bold text-foreground/60 dark:text-foreground/40 uppercase tracking-widest mb-1.5 ml-1">Name</p>
                          <input
                            required
                            placeholder="Your name"
                            value={subForm.name}
                            onChange={(e) => setSubForm({ ...subForm, name: e.target.value })}
                            className="w-full bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl px-4 py-3 text-[13px] text-foreground placeholder:text-foreground/28 focus:border-foreground/20 transition-all outline-none"
                          />
                        </div>
                        <div>
                          <p className="text-[9px] font-bold text-foreground/60 dark:text-foreground/40 uppercase tracking-widest mb-1.5 ml-1">Email</p>
                          <input
                            required
                            type="email"
                            placeholder="you@email.com"
                            value={subForm.email}
                            onChange={(e) => setSubForm({ ...subForm, email: e.target.value })}
                            className="w-full bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl px-4 py-3 text-[13px] text-foreground placeholder:text-foreground/28 focus:border-foreground/20 transition-all outline-none"
                          />
                        </div>
                      </div>

                      {/* ─ Instagram ─ */}
                      <div>
                        <p className="text-[9px] font-bold text-foreground/60 dark:text-foreground/40 uppercase tracking-widest mb-1.5 ml-1">
                          Instagram <span className="text-foreground/40 dark:text-foreground/20 font-normal normal-case">(optional)</span>
                        </p>
                        <input
                          placeholder="https://instagram.com/p/…"
                          value={subForm.instagramUrl}
                          onChange={(e) => setSubForm({ ...subForm, instagramUrl: e.target.value })}
                          className="w-full bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl px-4 py-3 text-[13px] text-foreground placeholder:text-foreground/28 focus:border-foreground/20 transition-all outline-none"
                        />
                      </div>

                      {/* ─ Style Narrative ─ */}
                      <div>
                        <p className="text-[9px] font-bold text-foreground/60 dark:text-foreground/40 uppercase tracking-widest mb-1.5 ml-1">Style Narrative</p>
                        <textarea
                          required
                          placeholder="Describe your curation…"
                          value={subForm.quote}
                          onChange={(e) => setSubForm({ ...subForm, quote: e.target.value })}
                          className="w-full min-h-[80px] bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl px-4 py-3 text-[13px] text-foreground placeholder:text-foreground/28 focus:border-foreground/20 transition-all outline-none resize-none"
                        />
                      </div>

                      {/* ─ Error ─ */}
                      {subStatus.type === 'error' && (
                        <motion.p
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-[11px] font-semibold text-red-500 text-center py-2 bg-red-500/10 rounded-xl"
                        >
                          {subStatus.msg}
                        </motion.p>
                      )}

                      {/* ─ Submit ─ */}
                      <div className="pb-safe">
                        <p className="text-[9px] text-foreground/28 text-center mb-3">
                          All submissions undergo editorial review.
                        </p>
                        <button
                          disabled={subStatus.type === 'loading' || !subForm.imageUrl}
                          className="w-full py-4 rounded-2xl bg-foreground text-background text-[13px] font-bold tracking-wide active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-xl hover:opacity-90 disabled:opacity-40"
                        >
                          {subStatus.type === 'loading' ? (
                            <>
                              <div className="w-4 h-4 border-2 border-background/20 border-t-background rounded-full animate-spin" />
                              Submitting…
                            </>
                          ) : 'Submit to Editor'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}
