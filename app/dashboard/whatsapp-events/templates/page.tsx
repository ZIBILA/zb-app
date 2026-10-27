"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  FileText, Search, RefreshCcw, CheckCircle2, AlertCircle, X,
  ArrowRight, Phone, MessageCircle, Clock, Eye, Sparkles, Filter
} from "lucide-react";
import { toast } from "sonner";

export default function TemplatesManagerPage() {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, { count: number; lastUsed: string }>>({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    async function fetchTemplatesAndStats() {
      setLoading(true);
      try {
        const templatesRes = await fetch("/api/whatsapp/templates");
        const templatesData = await templatesRes.json();
        
        const statsRes = await fetch("/api/whatsapp-events/stats");
        const statsData = await statsRes.json();

        if (templatesRes.ok) {
          setTemplates(templatesData.templates || []);
        } else {
          toast.error(templatesData.error || "Failed to fetch templates.");
        }

        // Map template usage metrics
        const metricsMap: Record<string, { count: number; lastUsed: string }> = {};
        if (statsRes.ok && statsData.templates) {
          for (const t of statsData.templates) {
            metricsMap[t.templateName] = {
              count: t.sent,
              lastUsed: new Date().toLocaleDateString('en-IN') // Mock last used or fallback
            };
          }
        }
        setAnalytics(metricsMap);
      } catch (err) {
        toast.error("Network error sync template data.");
      } finally {
        setLoading(false);
      }
    }
    fetchTemplatesAndStats();
  }, [refreshTrigger]);

  const handleSyncMeta = async () => {
    setLoading(true);
    const toastId = toast.loading("Syncing templates with Meta Business Account...");
    try {
      const res = await fetch("/api/whatsapp/templates");
      const data = await res.json();
      if (res.ok) {
        setTemplates(data.templates || []);
        toast.success("Templates synced successfully!", { id: toastId });
      } else {
        toast.error(data.error || "Sync failed.", { id: toastId });
      }
    } catch (e) {
      toast.error("Network error during sync.", { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    if (status === "APPROVED") {
      return (
        <span className="flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full font-semibold font-mono">
          <CheckCircle2 className="w-3 h-3" />
          <span>APPROVED</span>
        </span>
      );
    }
    if (status === "PENDING") {
      return (
        <span className="flex items-center gap-1 text-[10px] bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded-full font-semibold font-mono">
          <Clock className="w-3 h-3" />
          <span>PENDING</span>
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-[10px] bg-rose-500/10 text-rose-500 border border-rose-500/20 px-2 py-0.5 rounded-full font-semibold font-mono">
        <AlertCircle className="w-3 h-3" />
        <span>{status}</span>
      </span>
    );
  };

  const filteredTemplates = templates.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "all" || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Replaces placeholder variables like {{1}} with highlight elements
  const renderPreviewBody = (components: any[]) => {
    const bodyComp = components?.find(c => c.type === "BODY");
    if (!bodyComp) return "No body component found";

    let text = bodyComp.text || "";
    // Regex to match {{1}}, {{2}} etc.
    const regex = /\{\{(\d+)\}\}/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const index = match.index;
      // Add text before match
      if (index > lastIndex) {
        parts.push(text.substring(lastIndex, index));
      }
      // Add placeholder
      parts.push(
        <span key={match[0]} className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 font-mono text-[10px] rounded border border-emerald-500/30">
          var_{match[1]}
        </span>
      );
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return <div className="whitespace-pre-wrap">{parts}</div>;
  };

  const getHeaderComponent = (components: any[]) => {
    return components?.find(c => c.type === "HEADER");
  };

  const getButtonsComponent = (components: any[]) => {
    return components?.find(c => c.type === "BUTTONS")?.buttons || [];
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WABA Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and sync approved WhatsApp templates, usage stats, and previews.</p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setRefreshTrigger(p => p + 1)}
            className="p-2.5 bg-foreground/5 hover:bg-foreground/10 text-foreground border border-foreground/10 rounded-xl transition-all"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
          
          <button
            onClick={handleSyncMeta}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-foreground font-semibold rounded-xl transition-colors border border-emerald-500/10 shadow-lg text-sm"
          >
            <RefreshCcw className="w-4 h-4 animate-spin" />
            <span>Sync templates from Meta</span>
          </button>
        </div>
      </div>

      {/* Toolbar Filters */}
      <div className="glass-card p-4 flex flex-col md:flex-row gap-4 justify-between items-center">
        {/* Search */}
        <div className="relative w-full md:max-w-xs">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glass-input pl-10 w-full text-sm"
          />
        </div>

        {/* Category Filters */}
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto">
          {[
            { id: "all", label: "All Categories" },
            { id: "MARKETING", label: "Marketing" },
            { id: "UTILITY", label: "Utility" },
            { id: "AUTHENTICATION", label: "Authentication" }
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
                categoryFilter === cat.id 
                  ? "bg-foreground/10 text-foreground border-foreground/20 shadow-md"
                  : "bg-transparent text-muted-foreground border-transparent hover:text-foreground hover:bg-foreground/5"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main content grid */}
      {loading && templates.length === 0 ? (
        <div className="p-12 flex items-center justify-center">
          <RefreshCcw className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="glass-card p-16 text-center space-y-3">
          <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-semibold text-muted-foreground">No templates found matching filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredTemplates.map((template) => {
            const stats = analytics[template.name] || { count: 0, lastUsed: "Never" };
            return (
              <motion.div
                key={template.id}
                layout
                className="glass-card p-5 flex flex-col justify-between hover:border-foreground/20 transition-all cursor-pointer group"
                onClick={() => setSelectedTemplate(template)}
              >
                <div className="space-y-4">
                  {/* Top info row */}
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">{template.category}</span>
                      <h4 className="font-semibold text-sm text-foreground/90 group-hover:text-foreground mt-0.5 truncate max-w-[150px]">{template.name}</h4>
                    </div>
                    {getStatusBadge(template.status)}
                  </div>

                  {/* Preview block preview */}
                  <div className="bg-background/40 border border-foreground/5 p-3.5 rounded-xl text-xs text-muted-foreground line-clamp-3 font-mono leading-relaxed h-16 overflow-hidden">
                    {template.components?.find((c: any) => c.type === "BODY")?.text || ""}
                  </div>
                </div>

                {/* Usage metrics summary */}
                <div className="mt-5 pt-3 border-t border-foreground/5 flex justify-between items-center text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Last used: {stats.lastUsed}</span>
                  </div>
                  <div className="flex items-center gap-1 bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded border border-emerald-500/20 font-bold font-mono">
                    Sent: {stats.count}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Simulated Device Preview Drawer */}
      <AnimatePresence>
        {selectedTemplate && (
          <div className="fixed inset-0 z-50 flex items-center justify-end">
            {/* Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTemplate(null)}
              className="absolute inset-0 bg-background/60 backdrop-blur-sm"
            />

            {/* Slide-over panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="glass-card absolute right-0 top-0 bottom-0 max-w-md w-full h-full border-l border-foreground/10 shadow-2xl flex flex-col z-10 p-6 space-y-6"
            >
              {/* Drawer header */}
              <div className="flex justify-between items-center border-b border-foreground/5 pb-3">
                <div className="flex flex-col">
                  <span className="text-[10px] text-emerald-500 uppercase font-mono font-bold tracking-wider">{selectedTemplate.category}</span>
                  <h3 className="font-semibold text-lg">{selectedTemplate.name}</h3>
                </div>
                <button
                  onClick={() => setSelectedTemplate(null)}
                  className="p-1 hover:bg-foreground/5 text-muted-foreground hover:text-foreground rounded-lg transition-colors border border-transparent hover:border-foreground/10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Content */}
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-2">
                
                {/* Meta details list */}
                <div className="grid grid-cols-2 gap-4 text-xs bg-foreground/[0.02] p-4 rounded-xl border border-foreground/5">
                  <div>
                    <span className="text-muted-foreground uppercase font-mono text-[9px] block">Language</span>
                    <strong className="text-foreground/90 font-mono">{selectedTemplate.language}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground uppercase font-mono text-[9px] block">Total Dispatches</span>
                    <strong className="text-foreground/90 font-mono">{analytics[selectedTemplate.name]?.count || 0} times</strong>
                  </div>
                </div>

                {/* Simulated Phone Frame */}
                <div className="flex justify-center pt-2">
                  <div className="relative w-72 h-[420px] bg-[#0c1317] rounded-[2rem] border-4 border-foreground/15 shadow-2xl overflow-hidden flex flex-col">
                    {/* Speaker notch */}
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-4 bg-foreground/10 rounded-full z-20 flex items-center justify-center">
                      <div className="w-8 h-1 bg-black rounded-full" />
                    </div>

                    {/* Chat background wallpaper */}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.05)_0%,transparent_100%)] opacity-30 z-0" />

                    {/* WhatsApp mock header */}
                    <div className="bg-[#121b22] px-4 pt-6 pb-2 border-b border-foreground/5 z-10 flex items-center gap-2">
                      <div className="w-7 h-7 bg-foreground/10 text-emerald-500 rounded-full flex items-center justify-center font-bold text-xs">ZB</div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-foreground/90 leading-tight">Zica Bella Store</span>
                        <span className="text-[8px] text-emerald-500 font-semibold leading-none mt-0.5">Online</span>
                      </div>
                    </div>

                    {/* Chat Bubble Area */}
                    <div className="flex-1 p-3 overflow-y-auto flex flex-col justify-end gap-2 z-10 relative">
                      
                      {/* Frosted template bubble */}
                      <motion.div 
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="bg-[#202c33] rounded-2xl rounded-tl-none p-3 shadow-lg max-w-[85%] border border-foreground/10 text-xs space-y-2 text-foreground/90"
                      >
                        {/* Header preview if image */}
                        {getHeaderComponent(selectedTemplate.components)?.format === "IMAGE" && (() => {
                          const isCart = selectedTemplate.name.includes("cart_recovery");
                          const isCollection = selectedTemplate.name.includes("collection");
                          const imgUrl = isCart 
                            ? "https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=400&auto=format&fit=crop"
                            : isCollection
                            ? "https://images.unsplash.com/photo-1578587018452-892bacefd3f2?q=80&w=400&auto=format&fit=crop"
                            : "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?q=80&w=400&auto=format&fit=crop";
                          return (
                            <div className="w-full h-28 bg-foreground/10 rounded-lg overflow-hidden border border-foreground/5 mb-1 shrink-0 relative group">
                              <img src={imgUrl} alt="Template Header Product" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex flex-col justify-end p-2">
                                <span className="text-[7px] text-emerald-400 font-bold uppercase tracking-wider font-mono">Premium Heavyweight Fit</span>
                                <span className="text-[9px] font-bold text-foreground tracking-wide truncate">Zica Bella® Limited Capsule</span>
                              </div>
                            </div>
                          );
                        })()}
                        {getHeaderComponent(selectedTemplate.components)?.format === "TEXT" && (
                          <strong className="text-[11px] block font-bold text-foreground border-b border-foreground/5 pb-1">
                            {getHeaderComponent(selectedTemplate.components)?.text}
                          </strong>
                        )}

                        {/* Body Text */}
                        {renderPreviewBody(selectedTemplate.components)}

                        {/* Footer text */}
                        {(() => {
                          const footerComp = selectedTemplate.components?.find((c: any) => c.type === "FOOTER");
                          return footerComp ? (
                            <span className="text-[9px] text-muted-foreground block">{footerComp.text}</span>
                          ) : null;
                        })()}
                      </motion.div>

                      {/* Mock bubble button actions */}
                      {getButtonsComponent(selectedTemplate.components).length > 0 && (
                        <div className="flex flex-col gap-1 max-w-[85%]">
                          {getButtonsComponent(selectedTemplate.components).map((btn: any, btnIdx: number) => (
                            <div 
                              key={btnIdx}
                              className="bg-[#202c33]/90 hover:bg-[#202c33] active:bg-[#202c33] text-emerald-400 font-semibold text-center py-2.5 rounded-xl text-[10px] cursor-pointer border border-foreground/10 flex items-center justify-center gap-1"
                            >
                              <span>{btn.text}</span>
                              {btn.type === "URL" && <ArrowRight className="w-3 h-3 text-emerald-400" />}
                            </div>
                          ))}
                        </div>
                      )}

                    </div>
                  </div>
                </div>

              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
