"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  MessageCircle, Send, CheckCircle2, AlertCircle, BarChart3, 
  Plus, Search, Sparkles, Image as ImageIcon, FileText, 
  RefreshCcw, ArrowRightLeft, ShieldCheck, ChevronRight,
  Trash2, ToggleLeft, ToggleRight, Database, ExternalLink
} from "lucide-react";
import { toast } from "sonner";

export default function WhatsAppHubPage() {
  const [activeTab, setActiveTab] = useState<
    "campaigns" | "quick-send" | "abandoned-carts" | "templates" | "notifications" | "logs" | "cod"
  >("campaigns");
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "disconnected" | "loading">("loading");
  const [connectionError, setConnectionError] = useState("");
  const [statusData, setStatusData] = useState<any>(null);
  const [triggerRefresh, setTriggerRefresh] = useState(0);

  useEffect(() => {
    async function checkConnection() {
      try {
        const res = await fetch("/api/whatsapp/status");
        const data = await res.json();
        if (data.connected) {
          setConnectionStatus("connected");
          setConnectionError("");
          setStatusData(data);
        } else {
          setConnectionStatus("disconnected");
          setConnectionError(data.error || "Verify token or credentials");
          setStatusData(null);
        }
      } catch (err) {
        setConnectionStatus("disconnected");
        setConnectionError("Failed to connect to API service");
        setStatusData(null);
      }
    }
    checkConnection();
  }, [triggerRefresh]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WhatsApp Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage marketing campaigns, recovering checkouts and transactional triggers.</p>
        </div>
        
        {/* Section A: Connection Status Banner */}
        <div className="flex flex-col items-end gap-1 bg-foreground/5 p-3 rounded-xl border border-foreground/10">
          <div className="flex items-center gap-3">
            {connectionStatus === "loading" && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-foreground/5 text-muted-foreground border border-foreground/10">
                <RefreshCcw className="w-3 h-3 animate-spin" />
                <span>Checking Meta Connection...</span>
              </div>
            )}
            {connectionStatus === "connected" && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Meta Connected</span>
              </div>
            )}
            {connectionStatus === "disconnected" && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-500 border border-rose-500/20">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Not Connected</span>
              </div>
            )}
            
            <button 
              onClick={() => {
                setTriggerRefresh((p: number) => p + 1);
                toast.promise(
                  fetch("/api/whatsapp/status").then(async (res) => {
                    const data = await res.json();
                    if (!data.connected) throw new Error(data.error || "Verification failed");
                    return data;
                  }),
                  {
                    loading: 'Verifying Meta Connection...',
                    success: (data) => `Connected to ${data.name} (${data.phone})`,
                    error: (err) => `Failed: ${err.message}`
                  }
                );
              }}
              className="px-3 py-1 text-xs bg-emerald-500 hover:bg-emerald-600 text-foreground font-semibold rounded-lg transition-colors"
            >
              Verify Connection
            </button>
          </div>

          {connectionStatus === "connected" && statusData && (
            <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 mt-1 font-mono justify-end">
              <span>Sender: <strong className="text-foreground">{statusData.phone}</strong></span>
              <span>WABA ID: <strong className="text-foreground">{statusData.wabaId}</strong></span>
              <span>Phone ID: <strong className="text-foreground">{statusData.phoneId}</strong></span>
              <span>Quality: <strong className={statusData.quality === 'GREEN' || statusData.quality === 'HIGH' ? 'text-emerald-500' : 'text-amber-500'}>{statusData.quality}</strong></span>
              <span>Tier: <strong className="text-foreground">{statusData.tier}</strong></span>
              <span>Webhook: <strong className={statusData.webhookSubscribed ? "text-emerald-500" : "text-rose-500"}>{statusData.webhookSubscribed ? "Active" : "Not Active"}</strong></span>
            </div>
          )}

          {connectionStatus === "disconnected" && connectionError && (
            <span className="text-[10px] text-rose-500/80 max-w-[200px] text-right truncate" title={connectionError}>
              {connectionError}
            </span>
          )}
        </div>
      </div>

      {/* Phase 2.1: Quality / Tier Warning Banner */}
      {connectionStatus === "connected" && statusData && (
        (statusData.quality && statusData.quality !== 'GREEN' && statusData.quality !== 'HIGH') ||
        (statusData.tier && statusData.tier !== 'TIER_UNLIMITED' && statusData.tier !== 'TIER_100K' && statusData.tier !== 'TIER_UNKNOWN')
      ) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-500">WhatsApp Account Health Alert</p>
            <p className="text-xs text-muted-foreground mt-1">
              {statusData.quality && statusData.quality !== 'GREEN' && statusData.quality !== 'HIGH' && (
                <span className="block">Quality Rating: <strong className="text-amber-500">{statusData.quality}</strong> — Meta may restrict your messaging. Improve by reducing template failures and ensuring user engagement.</span>
              )}
              {statusData.tier && statusData.tier !== 'TIER_UNLIMITED' && statusData.tier !== 'TIER_100K' && statusData.tier !== 'TIER_UNKNOWN' && (
                <span className="block mt-1">Messaging Tier: <strong className="text-amber-500">{statusData.tier}</strong> — Limits the number of unique users you can message per day. Increase volume gradually and maintain GREEN quality to upgrade.</span>
              )}
            </p>
            <a href="https://business.facebook.com/wa/manage/" target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-500 hover:underline mt-2 inline-flex items-center gap-1">
              Open Meta Business Manager <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}

      <div className="flex gap-4 border-b border-foreground/10 pb-1 overflow-x-auto scrollbar-hide">
        {[
          { id: "campaigns", label: "Campaigns", icon: Send },
          { id: "quick-send", label: "Quick Send", icon: MessageCircle },
          { id: "abandoned-carts", label: "Cart Recovery", icon: ArrowRightLeft },
          { id: "templates", label: "Templates", icon: FileText },
          { id: "notifications", label: "Automations", icon: ChevronRight },
          { id: "logs", label: "Logs", icon: BarChart3 },
          { id: "cod", label: "COD Operations", icon: ShieldCheck },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === tab.id ? "border-emerald-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === "campaigns" && <BroadcastCampaigns />}
          {activeTab === "quick-send" && <QuickSendMessage />}
          {activeTab === "abandoned-carts" && <CartRecovery />}
          {activeTab === "templates" && <TemplatesManager onRefresh={() => setTriggerRefresh((p: number) => p + 1)} />}
          {activeTab === "notifications" && <OrderNotifications />}
          {activeTab === "logs" && <MessageLogs />}
          {activeTab === "cod" && <CODOperations />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ==========================================================================
   SECTION B: TEMPLATE LIBRARY & CRUD — MODERN VISUAL BUILDER
   ========================================================================== */

const TEMPLATE_PRESETS = [
  {
    id: 'cart_recovery', label: '🛒 Cart Recovery', desc: 'Recover abandoned carts with product image',
    preset: { category: 'MARKETING', headerType: 'IMAGE', headerImage: '', bodyText: 'Hello {{1}}, we noticed you left some items in your cart. Complete your purchase today to get them shipped soon.', footerText: 'Reply STOP to opt out', buttons: [{ type: 'URL', text: 'Complete Purchase', url: 'https://app.zicabella.com/{{1}}' }] }
  },
  {
    id: 'new_collection', label: '✨ New Collection', desc: 'Announce a new collection with image',
    preset: { category: 'MARKETING', headerType: 'IMAGE', headerImage: '', bodyText: 'Hi {{1}}, our new {{2}} collection is live! {{3}}. Shop the latest styles before they sell out.', footerText: 'Reply STOP to opt out', buttons: [{ type: 'URL', text: 'Shop Now', url: 'https://app.zicabella.com/collections/{{1}}' }] }
  },
  {
    id: 'sale_alert', label: '🔥 Sale Alert', desc: 'Announce sales with discount % and CTA',
    preset: { category: 'MARKETING', headerType: 'IMAGE', headerImage: '', bodyText: 'Hi {{1}}, enjoy up to {{2}}% OFF on your favorites! Sale ends {{3}}. Shop now!', footerText: 'Reply STOP to opt out', buttons: [{ type: 'URL', text: 'Shop Sale', url: 'https://app.zicabella.com/collections/{{1}}' }] }
  },
  {
    id: 'order_confirmation', label: '📦 Order Confirm', desc: 'Confirm order with tracking link',
    preset: { category: 'UTILITY', headerType: 'NONE', headerImage: '', bodyText: 'Thank you for your order, {{1}}! Your order {{2}} has been confirmed successfully.', footerText: '', buttons: [{ type: 'URL', text: 'View Order', url: 'https://app.zicabella.com/orders/{{1}}' }] }
  },
  {
    id: 'welcome', label: '👋 Welcome', desc: 'Welcome new subscribers',
    preset: { category: 'MARKETING', headerType: 'NONE', headerImage: '', bodyText: 'Welcome to Zica Bella, {{1}}! Thank you for joining us. Explore our latest collections and enjoy exclusive offers.', footerText: 'Reply STOP to opt out', buttons: [{ type: 'URL', text: 'Start Shopping', url: 'https://app.zicabella.com/' }] }
  },
  {
    id: 'review_request', label: '⭐ Review Request', desc: 'Ask for product review after delivery',
    preset: { category: 'UTILITY', headerType: 'NONE', headerImage: '', bodyText: 'Hi {{1}}, we hope you love your order {{2}}! Would you mind sharing a quick review? Your feedback helps us improve.', footerText: '', buttons: [{ type: 'URL', text: 'Leave Review', url: 'https://app.zicabella.com/orders/{{1}}' }] }
  }
];

function TemplatesManager({ onRefresh }: { onRefresh: () => void }) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [testingTemplate, setTestingTemplate] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<any>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const wizardSteps = ['Basics', 'Header', 'Body', 'Footer', 'Buttons', 'Preview'];

  const [name, setName] = useState("");
  const [category, setCategory] = useState("MARKETING");
  const [language, setLanguage] = useState("en_US");
  const [headerType, setHeaderType] = useState("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerImage, setHeaderImage] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [buttons, setButtons] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState("ALL");
  const [templateStatusFilter, setTemplateStatusFilter] = useState("ALL");
  const [sendTestTemplate, setSendTestTemplate] = useState<any>(null);
  const [sendTestPhone, setSendTestPhone] = useState("+917907914512");
  const [sendTestParams, setSendTestParams] = useState<Record<string, string>>({});
  const [sendingTest, setSendingTest] = useState(false);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/templates");
      const data = await res.json();
      if (res.ok) setTemplates(data.templates || []);
      else toast.error(data.error || "Failed to load templates.");
    } catch (e) { toast.error("Network error loading templates."); }
    finally { setLoading(false); }
  };

  const filteredTemplates = templates.filter(t => {
    const s = t.name.toLowerCase().includes(templateSearch.toLowerCase());
    const c = templateCategoryFilter === "ALL" || t.category === templateCategoryFilter;
    const st = templateStatusFilter === "ALL" || t.status === templateStatusFilter;
    return s && c && st;
  });

  useEffect(() => { fetchTemplates(); }, []);

  const handleTestTemplate = async () => {
    setTestingTemplate(true);
    const toastId = toast.loading("Running WABA Integration test...");
    try {
      await fetch("/api/whatsapp/templates", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "zb_test_template" }) }).catch(() => {});
      const res = await fetch("/api/whatsapp/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "zb_test_template", category: "MARKETING", language: "en_US", components: [{ type: "BODY", text: "Hello from Zica Bella." }] }) });
      const data = await res.json();
      if (res.ok) { toast.success("WABA Integration Test Succeeded!", { id: toastId }); fetchTemplates(); }
      else toast.error(data.error || "WABA Test Failed.", { id: toastId });
    } catch (e) { toast.error("Network error during test.", { id: toastId }); }
    finally { setTestingTemplate(false); }
  };

  const handleSeed = async () => {
    setSeeding(true);
    const toastId = toast.loading("Submitting templates to Meta...");
    try {
      const res = await fetch("/api/whatsapp/templates/seed", { method: "POST" });
      const data = await res.json();
      if (res.ok) { toast.success(`Seeded ${data.seeded}/${data.total} templates!`, { id: toastId }); fetchTemplates(); onRefresh(); }
      else toast.error(data.error || "Seeding failed.", { id: toastId });
    } catch (e) { toast.error("Network error.", { id: toastId }); }
    finally { setSeeding(false); }
  };

  const handleDelete = async (tname: string) => {
    if (!confirm(`Delete template "${tname}"?`)) return;
    const toastId = toast.loading(`Deleting ${tname}...`);
    try {
      const res = await fetch("/api/whatsapp/templates", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: tname }) });
      if (res.ok) { toast.success(`Deleted ${tname}!`, { id: toastId }); fetchTemplates(); if (selectedDetail?.name === tname) setSelectedDetail(null); }
      else { const d = await res.json(); toast.error(d.error || "Delete failed.", { id: toastId }); }
    } catch (e) { toast.error("Network error.", { id: toastId }); }
  };

  const applyPreset = (preset: any) => {
    setCategory(preset.category); setHeaderType(preset.headerType); setHeaderImage(preset.headerImage || '');
    setBodyText(preset.bodyText); setFooterText(preset.footerText || ''); setButtons(preset.buttons || []);
    setWizardStep(2);
  };

  const resetForm = () => {
    setName(""); setCategory("MARKETING"); setLanguage("en_US"); setHeaderType("NONE"); setHeaderText(""); setHeaderImage("");
    setBodyText(""); setFooterText(""); setButtons([]); setWizardStep(0);
  };

  const addButton = (type: string) => {
    if (buttons.length >= 10) { toast.error("Maximum 10 buttons."); return; }
    if (type === 'URL') setButtons([...buttons, { type: 'URL', text: '', url: '' }]);
    else if (type === 'QUICK_REPLY') setButtons([...buttons, { type: 'QUICK_REPLY', text: '' }]);
    else if (type === 'PHONE_NUMBER') setButtons([...buttons, { type: 'PHONE_NUMBER', text: '', phone_number: '' }]);
    else if (type === 'CATALOG') setButtons([...buttons, { type: 'CATALOG' }]);
  };

  const updateButton = (idx: number, field: string, value: string) => setButtons(prev => prev.map((b, i) => i === idx ? { ...b, [field]: value } : b));
  const removeButton = (idx: number) => setButtons(prev => prev.filter((_, i) => i !== idx));

  const getPayloadJson = () => {
    const cl: any[] = [];
    if (headerType === "TEXT" && headerText) cl.push({ type: "HEADER", format: "TEXT", text: headerText });
    else if (headerType === "IMAGE") cl.push({ type: "HEADER", format: "IMAGE", example: { header_url: ["https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=400&auto=format&fit=crop"] } });
    else if (headerType === "VIDEO") cl.push({ type: "HEADER", format: "VIDEO", example: { header_url: ["https://www.w3schools.com/html/mov_bbb.mp4"] } });
    else if (headerType === "DOCUMENT") cl.push({ type: "HEADER", format: "DOCUMENT", example: { header_url: ["https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"] } });
    cl.push({ type: "BODY", text: bodyText });
    if (footerText) cl.push({ type: "FOOTER", text: footerText });
    if (buttons.length > 0) cl.push({ type: "BUTTONS", buttons: buttons.filter(b => b.type === 'CATALOG' || b.text) });
    return { name: name || "template_name", category, language, components: cl };
  };

  const handleSubmit = async () => {
    if (!name) { toast.error("Template name is required."); setWizardStep(0); return; }
    if (!bodyText) { toast.error("Body text is required."); setWizardStep(2); return; }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/whatsapp/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(getPayloadJson()) });
      const data = await res.json();
      if (res.ok) { toast.success("Template submitted for Meta review!"); setShowCreateModal(false); resetForm(); fetchTemplates(); }
      else toast.error(data.error || "Failed to create template.", { duration: 10000 });
    } catch (err) { toast.error("Network error creating template."); }
    finally { setIsSubmitting(false); }
  };

  const handleSendTest = async () => {
    if (!sendTestTemplate || !sendTestPhone) return;
    setSendingTest(true);
    const toastId = toast.loading("Sending test...");
    const bodyComp = sendTestTemplate.components?.find((c: any) => c.type === "BODY");
    const variables = bodyComp?.text?.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || [];
    const components: any[] = [];
    if (variables.length > 0) {
      components.push({
        type: "body",
        parameters: variables.map((v: string) => {
          const key = v.replace(/[{}]/g, "");
          const isNumeric = /^\d+$/.test(key);
          const pObj: any = { type: "text", text: sendTestParams[key] || sendTestParams[v] || `Test ${key}` };
          if (!isNumeric) {
            pObj.parameter_name = key;
          }
          return pObj;
        })
      });
    }
    const headerComp = sendTestTemplate.components?.find((c: any) => c.type === "HEADER");
    if (headerComp?.format === "IMAGE") components.unshift({ type: "header", parameters: [{ type: "image", image: { link: "https://cdn.shopify.com/s/files/1/0955/5394/5881/files/zica-bella-logo_834c1ed2-2f09-4f73-bb9f-152a03f59ad2.png?v=1773354221" } }] });
    try {
      const res = await fetch("/api/whatsapp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: sendTestPhone, templateName: sendTestTemplate.name, languageCode: sendTestTemplate.language || "en", components }) });
      const data = await res.json();
      if (res.ok && data.success) toast.success(`Test sent! ID: ${data.messageId}`, { id: toastId });
      else toast.error(data.error || "Failed to send test.", { id: toastId });
    } catch (e) { toast.error("Network error.", { id: toastId }); }
    finally { setSendingTest(false); }
  };

  const renderPreview = (text: string) => {
    if (!text) return "Hi customer, welcome to Zica Bella...";
    return text.split(/(\{\{\d+\}\})/).map((part, i) => {
      if (part.match(/^\{\{\d+\}\}$/)) return <span key={i} className="bg-emerald-500/20 text-emerald-400 px-1 py-0.5 rounded font-mono text-[10px]">{part}</span>;
      return part;
    });
  };

  const statusCounts = { APPROVED: templates.filter(t => t.status === "APPROVED").length, PENDING: templates.filter(t => t.status === "PENDING").length, REJECTED: templates.filter(t => !["APPROVED", "PENDING"].includes(t.status)).length };

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Meta Template Library</h3>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full font-semibold font-mono">{statusCounts.APPROVED} Approved</span>
            <span className="text-[10px] bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded-full font-semibold font-mono">{statusCounts.PENDING} Pending</span>
            {statusCounts.REJECTED > 0 && <span className="text-[10px] bg-rose-500/10 text-rose-500 border border-rose-500/20 px-2 py-0.5 rounded-full font-semibold font-mono">{statusCounts.REJECTED} Rejected</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={handleTestTemplate} disabled={testingTemplate} className="border border-foreground/10 hover:bg-foreground/5 text-foreground px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-2">
            {testingTemplate ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />} Test WABA
          </button>
          <button onClick={handleSeed} disabled={seeding} className="border border-foreground/10 hover:bg-foreground/5 text-foreground px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-2">
            {seeding ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-500" />} Seed Templates
          </button>
          <button onClick={fetchTemplates} className="border border-foreground/10 hover:bg-foreground/5 text-foreground px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-2">
            <RefreshCcw className="w-3.5 h-3.5" /> Sync
          </button>
          <button onClick={() => { resetForm(); setShowCreateModal(true); }} className="bg-emerald-500 hover:bg-emerald-600 text-foreground px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 shadow-lg">
            <Plus className="w-4 h-4" /> Create Template
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search templates..." value={templateSearch} onChange={(e) => setTemplateSearch(e.target.value)}
            className="w-full bg-foreground/5 border border-foreground/10 rounded-xl pl-10 pr-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm text-foreground" />
        </div>
        <div className="flex gap-2">
          <select value={templateCategoryFilter} onChange={(e) => setTemplateCategoryFilter(e.target.value)} className="bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2.5 outline-none text-xs text-foreground">
            <option value="ALL">All Categories</option><option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option><option value="AUTHENTICATION">Authentication</option>
          </select>
          <select value={templateStatusFilter} onChange={(e) => setTemplateStatusFilter(e.target.value)} className="bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2.5 outline-none text-xs text-foreground">
            <option value="ALL">All Status</option><option value="APPROVED">Approved</option><option value="PENDING">Pending</option><option value="REJECTED">Rejected</option>
          </select>
        </div>
      </div>

      {/* Template Card Grid */}
      {loading ? (
        <div className="flex justify-center py-20"><RefreshCcw className="w-8 h-8 animate-spin text-emerald-500" /></div>
      ) : filteredTemplates.length === 0 ? (
        <div className="glass-card p-16 text-center space-y-3">
          <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-semibold text-muted-foreground">No templates found.</p>
          <p className="text-xs text-muted-foreground">Click &quot;Create Template&quot; or &quot;Seed Templates&quot; to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((t, idx) => {
            const bodyComp = t.components?.find((c: any) => c.type === "BODY");
            const headerComp = t.components?.find((c: any) => c.type === "HEADER");
            const buttonsComp = t.components?.find((c: any) => c.type === "BUTTONS");
            const footerComp = t.components?.find((c: any) => c.type === "FOOTER");
            return (
              <motion.div key={t.id || idx} layout className="glass-card overflow-hidden hover:border-foreground/20 transition-all cursor-pointer group" onClick={() => setSelectedDetail(t)}>
                <div className="p-4 pb-0">
                  <div className="flex justify-between items-start gap-2 mb-3">
                    <div className="flex flex-col min-w-0">
                      <span className={`text-[9px] font-bold font-mono uppercase tracking-wider ${t.category === 'MARKETING' ? 'text-violet-400' : t.category === 'UTILITY' ? 'text-blue-400' : 'text-amber-400'}`}>{t.category}</span>
                      <h4 className="font-semibold text-sm text-foreground/90 group-hover:text-foreground mt-0.5 truncate">{t.name}</h4>
                    </div>
                    <span className={`shrink-0 flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-bold font-mono border ${t.status === 'APPROVED' ? 'border-emerald-500/20 text-emerald-500 bg-emerald-500/10' : t.status === 'PENDING' ? 'border-amber-500/20 text-amber-500 bg-amber-500/10' : 'border-rose-500/20 text-rose-500 bg-rose-500/10'}`}>
                      {t.status === 'APPROVED' && <CheckCircle2 className="w-2.5 h-2.5" />}{t.status}
                    </span>
                  </div>
                </div>
                {/* WhatsApp-style Preview */}
                <div className="px-4 pb-3">
                  <div className="bg-[#0b141a] rounded-xl p-3 space-y-2 border border-foreground/5">
                    {headerComp?.format === "IMAGE" && <div className="w-full h-16 bg-foreground/5 rounded-lg flex items-center justify-center text-[9px] text-muted-foreground gap-1 border border-foreground/5"><ImageIcon className="w-3 h-3 text-emerald-500/50" /> Image Header</div>}
                    {headerComp?.format === "TEXT" && <div className="text-[10px] font-bold text-foreground/80 border-b border-foreground/5 pb-1">{headerComp.text}</div>}
                    <div className="text-[10px] text-foreground/70 line-clamp-3 leading-relaxed whitespace-pre-wrap">{bodyComp?.text || "—"}</div>
                    {footerComp && <div className="text-[8px] text-muted-foreground/50">{footerComp.text}</div>}
                    {buttonsComp?.buttons && buttonsComp.buttons.length > 0 && (
                      <div className="space-y-1 pt-1 border-t border-foreground/5">
                        {buttonsComp.buttons.slice(0, 2).map((btn: any, bi: number) => (
                          <div key={bi} className="text-center py-1 text-[9px] text-emerald-400 font-semibold bg-foreground/5 rounded-lg flex items-center justify-center gap-1">{btn.text || btn.type}{btn.type === 'URL' && <ExternalLink className="w-2.5 h-2.5" />}</div>
                        ))}
                        {buttonsComp.buttons.length > 2 && <div className="text-[8px] text-muted-foreground text-center">+{buttonsComp.buttons.length - 2} more</div>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="px-4 py-2.5 border-t border-foreground/5 flex justify-between items-center" onClick={e => e.stopPropagation()}>
                  <span className="text-[9px] text-muted-foreground font-mono">{t.language}</span>
                  <div className="flex items-center gap-1">
                    {t.status === 'APPROVED' && <button onClick={(e) => { e.stopPropagation(); setSendTestTemplate(t); setSendTestParams({}); }} className="text-[9px] font-bold text-emerald-500 hover:bg-emerald-500/10 px-2 py-1 rounded-lg transition-colors">Send Test</button>}
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(t.name); }} className="text-rose-500/50 hover:text-rose-500 hover:bg-rose-500/10 p-1.5 rounded-lg transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Send Test Modal */}
      <AnimatePresence>
        {sendTestTemplate && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-background border border-foreground/10 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold text-sm">Send Test: <span className="font-mono text-emerald-500">{sendTestTemplate.name}</span></h3>
                <button onClick={() => setSendTestTemplate(null)} className="text-muted-foreground hover:text-foreground p-1 rounded">✕</button>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground/60 uppercase block mb-1">Phone</label>
                <input type="text" value={sendTestPhone} onChange={e => setSendTestPhone(e.target.value)} className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm font-mono" />
              </div>
              {(() => {
                const bodyVars = sendTestTemplate.components?.find((c: any) => c.type === "BODY")?.text?.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || [];
                if (bodyVars.length === 0) return null;
                return (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-foreground/60 uppercase">Parameters</label>
                    {bodyVars.map((v: string) => {
                      const key = v.replace(/[{}]/g, "");
                      return <input key={key} type="text" placeholder={`Value for {{${key}}}`} value={sendTestParams[key] || ""} onChange={e => setSendTestParams(p => ({ ...p, [key]: e.target.value }))} className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2 outline-none focus:border-emerald-500/50 text-sm" />;
                    })}
                  </div>
                );
              })()}
              <button onClick={handleSendTest} disabled={sendingTest} className="w-full bg-emerald-500 hover:bg-emerald-600 text-foreground py-2.5 rounded-xl font-medium text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {sendingTest ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send Test
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Slide-Over */}
      <AnimatePresence>
        {selectedDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-end">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedDetail(null)} className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
            <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }} className="glass-card absolute right-0 top-0 bottom-0 max-w-md w-full h-full border-l border-foreground/10 shadow-2xl flex flex-col z-10">
              <div className="flex justify-between items-center p-5 border-b border-foreground/5">
                <div className="flex flex-col min-w-0">
                  <span className={`text-[9px] font-bold font-mono uppercase tracking-wider ${selectedDetail.category === 'MARKETING' ? 'text-violet-400' : 'text-blue-400'}`}>{selectedDetail.category}</span>
                  <h3 className="font-semibold text-base truncate">{selectedDetail.name}</h3>
                </div>
                <button onClick={() => setSelectedDetail(null)} className="p-1.5 hover:bg-foreground/5 text-muted-foreground hover:text-foreground rounded-lg"><span className="text-lg">✕</span></button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="bg-foreground/[0.02] p-3 rounded-xl border border-foreground/5 text-center">
                    <span className="text-[8px] text-muted-foreground uppercase block">Status</span>
                    <span className={`font-bold text-xs ${selectedDetail.status === 'APPROVED' ? 'text-emerald-500' : selectedDetail.status === 'PENDING' ? 'text-amber-500' : 'text-rose-500'}`}>{selectedDetail.status}</span>
                  </div>
                  <div className="bg-foreground/[0.02] p-3 rounded-xl border border-foreground/5 text-center">
                    <span className="text-[8px] text-muted-foreground uppercase block">Language</span>
                    <span className="font-bold text-xs font-mono text-foreground/90">{selectedDetail.language}</span>
                  </div>
                  <div className="bg-foreground/[0.02] p-3 rounded-xl border border-foreground/5 text-center">
                    <span className="text-[8px] text-muted-foreground uppercase block">Updated</span>
                    <span className="font-bold text-[10px] text-foreground/90">{new Date(selectedDetail.updatedAt).toLocaleDateString('en-IN')}</span>
                  </div>
                </div>

                {/* WhatsApp Phone Preview */}
                <div className="flex justify-center">
                  <div className="relative w-72 h-[400px] bg-[#0c1317] rounded-[2rem] border-4 border-foreground/15 shadow-2xl overflow-hidden flex flex-col">
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-4 bg-foreground/10 rounded-full z-20 flex items-center justify-center"><div className="w-8 h-1 bg-black rounded-full" /></div>
                    <div className="bg-[#121b22] px-4 pt-6 pb-2 border-b border-foreground/5 z-10 flex items-center gap-2">
                      <div className="w-7 h-7 bg-foreground/10 text-emerald-500 rounded-full flex items-center justify-center font-bold text-xs">ZB</div>
                      <div className="flex flex-col"><span className="text-[10px] font-bold text-foreground/90 leading-tight">Zica Bella Store</span><span className="text-[8px] text-emerald-500 font-semibold leading-none mt-0.5">Online</span></div>
                    </div>
                    <div className="flex-1 p-3 overflow-y-auto flex flex-col justify-end gap-2 z-10 relative">
                      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-[#202c33] rounded-2xl rounded-tl-none p-3 shadow-lg max-w-[85%] border border-foreground/10 text-xs space-y-2 text-foreground/90">
                        {(() => {
                          const hdr = selectedDetail.components?.find((c: any) => c.type === "HEADER");
                          if (hdr?.format === "IMAGE") {
                            const isCart = selectedDetail.name.includes("cart_recovery");
                            const isCollection = selectedDetail.name.includes("collection");
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
                                  <span className="text-[9px] font-bold text-white tracking-wide truncate">Zica Bella® Limited Capsule</span>
                                </div>
                              </div>
                            );
                          }
                          if (hdr?.format === "TEXT") return <strong className="text-[11px] block font-bold text-foreground border-b border-foreground/5 pb-1">{hdr.text}</strong>;
                          if (hdr?.format === "VIDEO") return <div className="w-full h-24 bg-foreground/10 rounded-lg flex items-center justify-center text-[10px] text-muted-foreground gap-1.5 border border-foreground/5">▶ Video Component</div>;
                          return null;
                        })()}
                        <div className="whitespace-pre-wrap leading-relaxed">{renderPreview(selectedDetail.components?.find((c: any) => c.type === "BODY")?.text || "")}</div>
                        {(() => { const ftr = selectedDetail.components?.find((c: any) => c.type === "FOOTER"); return ftr ? <span className="text-[9px] text-muted-foreground block">{ftr.text}</span> : null; })()}
                        <div className="text-[8px] text-muted-foreground/50 text-right">12:00 PM ✓✓</div>
                      </motion.div>
                      {(() => {
                        const btns = selectedDetail.components?.find((c: any) => c.type === "BUTTONS")?.buttons || [];
                        if (btns.length === 0) return null;
                        return (
                          <div className="flex flex-col gap-1 max-w-[85%]">
                            {btns.map((btn: any, bi: number) => <div key={bi} className="bg-[#202c33]/90 text-emerald-400 font-semibold text-center py-2 rounded-xl text-[10px] border border-foreground/10 flex items-center justify-center gap-1">{btn.text || btn.type}{btn.type === "URL" && <ExternalLink className="w-2.5 h-2.5" />}</div>)}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Components JSON</div>
                  <pre className="bg-zinc-950 border border-foreground/10 text-zinc-400 p-3 rounded-xl font-mono text-[9px] overflow-auto max-h-[200px] scrollbar-hide select-all">{JSON.stringify(selectedDetail.components, null, 2)}</pre>
                </div>
              </div>
              <div className="p-4 border-t border-foreground/5 flex justify-between items-center gap-2">
                {selectedDetail.status === 'APPROVED' && <button onClick={() => { setSendTestTemplate(selectedDetail); setSendTestParams({}); setSelectedDetail(null); }} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-foreground py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-2"><Send className="w-3.5 h-3.5" /> Send Test</button>}
                <button onClick={() => handleDelete(selectedDetail.name)} className="px-4 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/20 hover:bg-rose-500/20 rounded-xl text-xs font-semibold">Delete</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Template Wizard Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-background border border-foreground/10 rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col md:flex-row overflow-hidden max-h-[92vh]">
              {/* Left: Form Wizard */}
              <div className="flex-1 flex flex-col overflow-hidden border-b md:border-b-0 md:border-r border-foreground/10">
                <div className="flex items-center gap-1 px-5 pt-4 pb-3 border-b border-foreground/5 overflow-x-auto scrollbar-hide">
                  {wizardSteps.map((step, i) => (
                    <button key={step} onClick={() => setWizardStep(i)} className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-all ${wizardStep === i ? 'bg-emerald-500 text-foreground shadow-lg' : i < wizardStep ? 'bg-emerald-500/10 text-emerald-500' : 'bg-foreground/5 text-muted-foreground hover:text-foreground'}`}>
                      {i + 1}. {step}
                    </button>
                  ))}
                  <div className="flex-1" />
                  <button onClick={() => { setShowCreateModal(false); resetForm(); }} className="text-muted-foreground hover:text-foreground text-sm p-1 rounded">✕</button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  <AnimatePresence mode="wait">
                    <motion.div key={wizardStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.15 }}>

                      {wizardStep === 0 && (
                        <div className="space-y-4">
                          <div><h4 className="text-sm font-semibold mb-1">Template Name & Category</h4><p className="text-xs text-muted-foreground mb-4">Choose a unique name and category for Meta approval.</p></div>
                          <div>
                            <label className="text-xs font-semibold text-foreground/60 uppercase block mb-1.5">Template Name</label>
                            <input type="text" placeholder="e.g. zb_summer_sale_2026" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm font-mono" />
                            <span className="text-[10px] text-muted-foreground mt-1 block">Lowercase letters, numbers, and underscores only.</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-semibold text-foreground/60 uppercase block mb-1.5">Category</label>
                              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2.5 outline-none text-sm"><option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option></select>
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-foreground/60 uppercase block mb-1.5">Language</label>
                              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2.5 outline-none text-sm"><option value="en_US">English (en_US)</option><option value="en">English (en)</option><option value="hi">Hindi</option></select>
                            </div>
                          </div>
                          <div className="pt-3 border-t border-foreground/5">
                            <label className="text-xs font-semibold text-foreground/60 uppercase block mb-2">Quick Start Presets</label>
                            <div className="grid grid-cols-2 gap-2">
                              {TEMPLATE_PRESETS.map(p => (
                                <button key={p.id} onClick={() => applyPreset(p.preset)} className="text-left bg-foreground/[0.02] border border-foreground/10 rounded-xl p-3 hover:bg-foreground/5 hover:border-foreground/20 transition-all group">
                                  <div className="text-xs font-semibold group-hover:text-emerald-500 transition-colors">{p.label}</div>
                                  <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{p.desc}</div>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {wizardStep === 1 && (
                        <div className="space-y-4">
                          <div><h4 className="text-sm font-semibold mb-1">Header</h4><p className="text-xs text-muted-foreground mb-4">Optional header at the top of the message.</p></div>
                          <select value={headerType} onChange={(e) => setHeaderType(e.target.value)} className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2.5 outline-none text-sm">
                            <option value="NONE">No Header</option><option value="TEXT">Text Header</option><option value="IMAGE">Image Header</option><option value="VIDEO">Video Header</option><option value="DOCUMENT">Document Header</option>
                          </select>
                          {headerType === "TEXT" && <div><label className="text-xs font-semibold text-foreground/60 uppercase block mb-1.5">Header Text</label><input type="text" placeholder="e.g. New Drop Live!" value={headerText} onChange={(e) => setHeaderText(e.target.value)} className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm" /></div>}
                          {headerType === "IMAGE" && (
                            <div className="space-y-3">
                              <label className="text-xs font-semibold text-foreground/60 uppercase block">Preview Image URL (Optional)</label>
                              <input type="text" placeholder="https://app.zicabella.com/images/collection.jpg" value={headerImage} onChange={(e) => setHeaderImage(e.target.value)} className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm" />
                              <p className="text-[10px] text-muted-foreground">The actual image is uploaded when sending. This is for preview.</p>
                              {headerImage && <div className="w-full h-32 rounded-xl border border-foreground/10 overflow-hidden bg-foreground/5"><img src={headerImage} alt="Preview" className="w-full h-full object-cover" onError={(e: any) => { e.target.style.display = 'none'; }} /></div>}
                            </div>
                          )}
                          {(headerType === "VIDEO" || headerType === "DOCUMENT") && <div className="p-4 bg-foreground/[0.02] border border-foreground/5 rounded-xl text-xs text-muted-foreground text-center"><p className="font-semibold mb-1">{headerType} Header</p><p>The {headerType.toLowerCase()} file will be uploaded when sending.</p></div>}
                        </div>
                      )}

                      {wizardStep === 2 && (
                        <div className="space-y-4">
                          <div><h4 className="text-sm font-semibold mb-1">Body Text</h4><p className="text-xs text-muted-foreground mb-4">Use {"{{1}}"}, {"{{2}}"}, etc. for dynamic variables.</p></div>
                          <div>
                            <div className="flex justify-between items-center mb-1.5">
                              <label className="text-xs font-semibold text-foreground/60 uppercase">Message Body</label>
                              <div className="flex items-center gap-1">{[1,2,3,4,5].map(n => <button key={n} onClick={() => setBodyText(prev => prev + `{{${n}}}`)} className="text-[9px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-1.5 py-0.5 rounded font-mono hover:bg-emerald-500/20">{`{{${n}}}`}</button>)}</div>
                            </div>
                            <textarea rows={6} placeholder="Hi {{1}}, welcome to Zica Bella!" value={bodyText} onChange={(e) => setBodyText(e.target.value)} className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm resize-none" />
                            <div className="flex justify-between mt-1"><span className="text-[10px] text-muted-foreground">{(bodyText.match(/\{\{\d+\}\}/g) || []).length} variables</span><span className={`text-[10px] ${bodyText.length > 1024 ? 'text-rose-500' : 'text-muted-foreground'}`}>{bodyText.length}/1024</span></div>
                          </div>
                        </div>
                      )}

                      {wizardStep === 3 && (
                        <div className="space-y-4">
                          <div><h4 className="text-sm font-semibold mb-1">Footer Text</h4><p className="text-xs text-muted-foreground mb-4">Optional small text below the message.</p></div>
                          <input type="text" placeholder="Reply STOP to opt out" value={footerText} onChange={(e) => setFooterText(e.target.value)} className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm" />
                          <span className={`text-[10px] block ${footerText.length > 60 ? 'text-rose-500' : 'text-muted-foreground'}`}>{footerText.length}/60</span>
                        </div>
                      )}

                      {wizardStep === 4 && (
                        <div className="space-y-4">
                          <div><h4 className="text-sm font-semibold mb-1">Call-to-Action Buttons</h4><p className="text-xs text-muted-foreground mb-4">Add buttons for quick actions. Maximum 10.</p></div>
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => addButton('URL')} className="text-xs bg-blue-500/10 text-blue-500 border border-blue-500/20 px-3 py-1.5 rounded-xl hover:bg-blue-500/20 flex items-center gap-1"><ExternalLink className="w-3 h-3" /> URL</button>
                            <button onClick={() => addButton('QUICK_REPLY')} className="text-xs bg-violet-500/10 text-violet-500 border border-violet-500/20 px-3 py-1.5 rounded-xl hover:bg-violet-500/20 flex items-center gap-1"><MessageCircle className="w-3 h-3" /> Quick Reply</button>
                            <button onClick={() => addButton('PHONE_NUMBER')} className="text-xs bg-amber-500/10 text-amber-500 border border-amber-500/20 px-3 py-1.5 rounded-xl hover:bg-amber-500/20 flex items-center gap-1">📞 Phone</button>
                            <button onClick={() => addButton('CATALOG')} className="text-xs bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-3 py-1.5 rounded-xl hover:bg-emerald-500/20 flex items-center gap-1">🛍 Catalog</button>
                          </div>
                          <div className="space-y-3">
                            {buttons.length === 0 && <div className="text-xs text-muted-foreground italic py-4 text-center">No buttons added.</div>}
                            {buttons.map((btn, idx) => (
                              <div key={idx} className="bg-foreground/[0.02] border border-foreground/10 rounded-xl p-3 space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className={`text-[9px] font-bold uppercase font-mono px-2 py-0.5 rounded ${btn.type === 'URL' ? 'bg-blue-500/10 text-blue-500' : btn.type === 'QUICK_REPLY' ? 'bg-violet-500/10 text-violet-500' : btn.type === 'PHONE_NUMBER' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>{btn.type}</span>
                                  <button onClick={() => removeButton(idx)} className="text-rose-500/50 hover:text-rose-500 text-xs">Remove</button>
                                </div>
                                {btn.type !== 'CATALOG' && <input type="text" placeholder="Button Label" value={btn.text || ''} onChange={(e) => updateButton(idx, 'text', e.target.value)} className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 outline-none focus:border-emerald-500/50 text-xs" />}
                                {btn.type === 'URL' && <input type="text" placeholder="https://app.zicabella.com/{{1}}" value={btn.url || ''} onChange={(e) => updateButton(idx, 'url', e.target.value)} className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 outline-none focus:border-emerald-500/50 text-xs font-mono" />}
                                {btn.type === 'PHONE_NUMBER' && <input type="text" placeholder="+919876543210" value={btn.phone_number || ''} onChange={(e) => updateButton(idx, 'phone_number', e.target.value)} className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 outline-none focus:border-emerald-500/50 text-xs font-mono" />}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {wizardStep === 5 && (
                        <div className="space-y-4">
                          <div><h4 className="text-sm font-semibold mb-1">Review & Submit</h4><p className="text-xs text-muted-foreground mb-4">{category === 'UTILITY' ? 'UTILITY templates are auto-approved by Meta.' : 'MARKETING templates require Meta review (1–48 hours).'}</p></div>
                          <div className="bg-foreground/[0.02] p-4 rounded-xl border border-foreground/5 space-y-2 text-xs">
                            <div><span className="text-muted-foreground">Name:</span> <strong className="font-mono">{name || '—'}</strong></div>
                            <div><span className="text-muted-foreground">Category:</span> <strong>{category}</strong></div>
                            <div><span className="text-muted-foreground">Language:</span> <strong className="font-mono">{language}</strong></div>
                            <div><span className="text-muted-foreground">Header:</span> <strong>{headerType === 'NONE' ? 'None' : `${headerType}${headerType === 'TEXT' ? `: ${headerText}` : ''}`}</strong></div>
                            <div><span className="text-muted-foreground">Variables:</span> <strong>{(bodyText.match(/\{\{\d+\}\}/g) || []).length}</strong></div>
                            <div><span className="text-muted-foreground">Buttons:</span> <strong>{buttons.length}</strong></div>
                          </div>
                          <div>
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-semibold mb-1">
                              <span>API Payload</span>
                              <button type="button" onClick={() => { navigator.clipboard.writeText(JSON.stringify(getPayloadJson(), null, 2)); toast.success("Copied!"); }} className="text-emerald-500 hover:text-emerald-400 font-bold lowercase">Copy JSON</button>
                            </div>
                            <pre className="bg-zinc-950 border border-foreground/10 text-zinc-300 p-2.5 rounded-xl font-mono text-[9px] overflow-auto max-h-[200px] select-all scrollbar-hide">{JSON.stringify(getPayloadJson(), null, 2)}</pre>
                          </div>
                        </div>
                      )}

                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="flex items-center justify-between p-4 border-t border-foreground/5 bg-foreground/[0.01]">
                  <button onClick={() => setWizardStep(Math.max(0, wizardStep - 1))} disabled={wizardStep === 0} className="px-4 py-2 bg-foreground/5 text-foreground rounded-xl text-xs font-medium hover:bg-foreground/10 disabled:opacity-30">Back</button>
                  {wizardStep < wizardSteps.length - 1 ? (
                    <button onClick={() => setWizardStep(wizardStep + 1)} className="px-6 py-2 bg-emerald-500 text-foreground rounded-xl text-xs font-semibold hover:bg-emerald-600 shadow-lg">Next →</button>
                  ) : (
                    <button onClick={handleSubmit} disabled={isSubmitting} className="px-6 py-2 bg-emerald-500 text-foreground rounded-xl text-xs font-semibold hover:bg-emerald-600 shadow-lg disabled:opacity-50 flex items-center gap-2">
                      {isSubmitting ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Submit to Meta
                    </button>
                  )}
                </div>
              </div>

              {/* Right: Live WhatsApp Preview */}
              <div className="hidden md:flex flex-col items-center justify-center p-6 bg-gradient-to-br from-background to-emerald-500/5 w-[340px] shrink-0 overflow-y-auto max-h-[92vh] scrollbar-hide">
                <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-3">Live Preview</div>
                <div className="w-[260px] h-[340px] border-[6px] border-foreground/10 rounded-[2rem] relative bg-background shadow-2xl flex flex-col overflow-hidden">
                  <div className="absolute top-0 inset-x-0 h-4 bg-foreground/10 z-10 rounded-t-3xl" />
                  <div className="absolute top-1 left-1/2 -translate-x-1/2 w-20 h-4 bg-background rounded-full z-20" />
                  <div className="flex-1 bg-[#0b141a] pt-8 px-2.5 flex flex-col overflow-y-auto scrollbar-hide">
                    <div className="text-center mb-2 bg-[#0b141a]/90 py-1 rounded-xl border border-foreground/5">
                      <h3 className="text-[10px] font-semibold text-foreground">Zica Bella</h3>
                      <p className="text-[8px] text-emerald-500">Business Account</p>
                    </div>
                    <div className="space-y-1.5 self-end max-w-[85%] bg-[#005c4b] text-foreground p-2 rounded-xl rounded-tr-sm shadow-md border border-foreground/5 text-[10px]">
                      {headerType === "IMAGE" && <div className="w-full h-20 bg-foreground/5 rounded-lg flex items-center justify-center overflow-hidden border border-foreground/10 mb-1">{headerImage ? <img src={headerImage} alt="Header" className="w-full h-full object-cover" /> : <ImageIcon className="w-6 h-6 text-muted-foreground/50" />}</div>}
                      {headerType === "VIDEO" && <div className="w-full h-20 bg-foreground/5 rounded-lg flex items-center justify-center border border-foreground/10 mb-1 text-muted-foreground/50">▶ Video</div>}
                      {headerType === "TEXT" && headerText && <div className="font-bold text-[10px] text-foreground/80 mb-1">{headerText}</div>}
                      <div className="whitespace-pre-wrap leading-relaxed text-foreground/90">{renderPreview(bodyText)}</div>
                      {footerText && <div className="text-[8px] text-foreground/50 mt-1 border-t border-foreground/5 pt-1">{footerText}</div>}
                      <div className="text-[7px] text-foreground/40 text-right mt-0.5">12:00 PM</div>
                    </div>
                    {buttons.filter(b => b.type === 'CATALOG' || b.text).length > 0 && (
                      <div className="mt-1 space-y-1 self-end w-[85%]">
                        {buttons.filter(b => b.type === 'CATALOG' || b.text).map((btn, bi) => <div key={bi} className="bg-zinc-800 text-blue-400 text-center py-2 rounded-xl shadow-sm text-[9px] font-semibold border border-foreground/5 flex items-center justify-center gap-1">{btn.text || btn.type}{btn.type === 'URL' && <ExternalLink className="w-2.5 h-2.5" />}</div>)}
                      </div>
                    )}
                    <div className="h-4" />
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

/* ==========================================================================
   SECTION C: QUICK SEND SINGLE MESSAGE
   ========================================================================== */
function QuickSendMessage() {
  const [phone, setPhone] = useState("+917907914512");
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [params, setParams] = useState<Record<string, string>>({});
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // Opted-in customers search
  const [optedInCustomers, setOptedInCustomers] = useState<any[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  const fetchTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch("/api/whatsapp/templates");
      const data = await res.json();
      if (res.ok && data.templates) {
        setTemplates(data.templates);
        const helloWorld = data.templates.find((t: any) => t.name === "abandoned_cart_a1");
        if (helloWorld) {
          setSelectedTemplate(helloWorld);
        } else if (data.templates.length > 0) {
          setSelectedTemplate(data.templates[0]);
        }
      }
    } catch (e) {
      console.error("Failed to load templates in Quick Send", e);
    } finally {
      setTemplatesLoading(false);
    }
  };

  const fetchOptedInCustomers = async () => {
    try {
      const res = await fetch("/api/whatsapp/recipients?audience=all_customers");
      const data = await res.json();
      if (res.ok && data.recipients) {
        setOptedInCustomers(data.recipients);
      }
    } catch (e) {
      console.error("Failed to load opted-in customers", e);
    }
  };

  useEffect(() => {
    fetchTemplates();
    fetchOptedInCustomers();
  }, []);

  const bodyText = selectedTemplate?.components?.find((c: any) => c.type === "BODY")?.text || "";
  const headerComp = selectedTemplate?.components?.find((c: any) => c.type === "HEADER");
  const footerComp = selectedTemplate?.components?.find((c: any) => c.type === "FOOTER");
  const textHeader = selectedTemplate?.components?.find((c: any) => c.type === "HEADER" && c.format === "TEXT")?.text || "";
  const buttonsComp = selectedTemplate?.components?.find((c: any) => c.type === "BUTTONS");
  const variables = bodyText.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || [];

  const handleSelectCustomer = (cust: any) => {
    setPhone(cust.phone);
    // Autofill first variable with customer name if applicable
    if (variables.length > 0) {
      const firstKey = variables[0].replace(/[{}]/g, "");
      setParams(prev => ({ ...prev, [firstKey]: cust.customerName, "1": cust.customerName }));
    }
    setCustomerSearch(cust.customerName);
    setShowCustomerDropdown(false);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) {
      toast.error("Please enter a phone number");
      return;
    }
    if (!selectedTemplate) {
      toast.error("No template selected");
      return;
    }

    setLoading(true);
    setSendSuccess(null);
    setSendError(null);
    const toastId = toast.loading("Sending message...");

    const components: any[] = [];
    if (variables.length > 0) {
      const bodyParams = variables.map((v: string) => {
        const key = v.replace(/[{}]/g, "");
        const isNumeric = /^\d+$/.test(key);
        const pObj: any = {
          type: "text",
          text: params[key] || params[v] || ""
        };
        if (!isNumeric) {
          pObj.parameter_name = key;
        }
        return pObj;
      });
      components.push({
        type: "body",
        parameters: bodyParams
      });
    }

    // Add dummy header if IMAGE template
    if (headerComp?.format === "IMAGE") {
      components.unshift({
        type: "header",
        parameters: [{ type: "image", image: { link: "https://cdn.shopify.com/s/files/1/0955/5394/5881/files/zica-bella-logo_834c1ed2-2f09-4f73-bb9f-152a03f59ad2.png?v=1773354221" } }]
      });
    }

    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phone,
          templateName: selectedTemplate.name,
          languageCode: selectedTemplate.language || "en",
          components
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSendSuccess(`Message sent! Message ID: ${data.messageId}`);
        toast.success(`Success! Message ID: ${data.messageId}`, { id: toastId });
        setParams({});
      } else {
        const errMsg = data.error || "Failed to send message.";
        setSendError(errMsg);
        toast.error(errMsg, { id: toastId });
      }
    } catch (e) {
      const errMsg = "Network error sending WhatsApp message.";
      setSendError(errMsg);
      toast.error(errMsg, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const renderLivePreview = () => {
    if (!bodyText) return "Preview will appear here...";
    let text = bodyText;
    variables.forEach((v: string) => {
      const key = v.replace(/[{}]/g, "");
      const val = params[key] || params[v] || `[Variable {{${key}}}]`;
      text = text.replace(v, val);
    });
    return text;
  };

  const filteredCustomers = optedInCustomers.filter(c =>
    c.customerName.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.phone.toLowerCase().includes(customerSearch.toLowerCase())
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
      {/* Send Input Form */}
      <div className="lg:col-span-2 glass-card p-6 space-y-6">
        <div>
          <h3 className="font-semibold text-lg">Quick Send Portal</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Send transaction or marketing notifications directly to consented numbers.</p>
        </div>

        <form onSubmit={handleSend} className="space-y-4">
          {/* Customer Lookup Search */}
          <div className="relative">
            <label className="text-xs font-semibold text-foreground/60 uppercase block mb-1.5 font-mono">1. Customer Opt-In Search (Optional)</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search opted-in customer by name or phone..."
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setShowCustomerDropdown(true);
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                className="w-full bg-foreground/5 border border-foreground/10 rounded-xl pl-10 pr-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm"
              />
            </div>

            {/* Dropdown Results */}
            {showCustomerDropdown && customerSearch && (
              <div className="absolute left-0 right-0 mt-1 bg-[#121b22] border border-foreground/10 rounded-xl shadow-2xl max-h-48 overflow-y-auto z-30 custom-scrollbar">
                {filteredCustomers.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground text-center">No consented subscribers found</div>
                ) : (
                  filteredCustomers.map((cust, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSelectCustomer(cust)}
                      className="w-full text-left p-3 text-xs hover:bg-foreground/5 border-b border-foreground/5 flex justify-between items-center transition-colors"
                    >
                      <span className="font-semibold text-foreground">{cust.customerName}</span>
                      <span className="font-mono text-muted-foreground">{cust.phone}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Phone */}
            <div>
              <label className="text-xs font-semibold text-foreground/60 uppercase block mb-1.5 font-mono">2. Recipient Phone</label>
              <input
                type="text"
                required
                placeholder="e.g. +919876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm font-mono"
              />
            </div>

            {/* Template Selector */}
            <div>
              <label className="text-xs font-semibold text-foreground/60 uppercase block mb-1.5 font-mono">3. Select Template</label>
              {templatesLoading ? (
                <div className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
                  <RefreshCcw className="w-4 h-4 animate-spin text-emerald-500" />
                  <span>Loading templates...</span>
                </div>
              ) : (
                <select
                  value={selectedTemplate?.name || ""}
                  onChange={(e) => {
                    const found = templates.find(t => t.name === e.target.value);
                    setSelectedTemplate(found || null);
                    setParams({});
                  }}
                  className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500/50 text-sm"
                >
                  {templates.length === 0 ? (
                    <option value="">No templates registered</option>
                  ) : (
                    templates.map(t => (
                      <option key={t.id} value={t.name}>
                        {t.name} ({t.status})
                      </option>
                    ))
                  )}
                </select>
              )}
            </div>
          </div>

          {/* Parameters Inputs */}
          {selectedTemplate && variables.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-foreground/5">
              <label className="text-xs font-semibold text-foreground/60 uppercase block font-mono">4. Dynamic Variables</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {variables.map((v: string) => {
                  const key = v.replace(/[{}]/g, "");
                  return (
                    <div key={key}>
                      <label className="text-[10px] text-muted-foreground block mb-1 font-mono">Placeholder {`{{${key}}}`}</label>
                      <input
                        type="text"
                        required
                        placeholder={`Value for {{${key}}}`}
                        value={params[key] || ""}
                        onChange={(e) => setParams(prev => ({ ...prev, [key]: e.target.value }))}
                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3.5 py-2.5 outline-none focus:border-emerald-500/50 text-sm"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {sendSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-semibold rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>{sendSuccess}</span>
            </div>
          )}

          {sendError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="break-words leading-relaxed">{sendError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !selectedTemplate}
            className="w-full bg-emerald-500 text-foreground py-3 rounded-xl font-semibold text-sm hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mt-4 shadow-lg"
          >
            {loading ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span>Deliver Template Message</span>
          </button>
        </form>
      </div>

      {/* Real-time WhatsApp Device Preview */}
      <div className="glass-card p-6 flex flex-col items-center justify-center bg-gradient-to-br from-background to-emerald-500/5">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Device Preview</span>

        <div className="relative w-64 h-[350px] bg-[#0c1317] rounded-[2rem] border-[6px] border-foreground/10 shadow-2xl overflow-hidden flex flex-col">
          <div className="absolute top-0 inset-x-0 h-4 bg-foreground/10 z-10 rounded-t-3xl" />
          <div className="absolute top-1 left-1/2 -translate-x-1/2 w-20 h-4 bg-background rounded-full z-20" />

          <div className="flex-1 bg-[#0b141a] pt-8 px-2.5 flex flex-col overflow-y-auto scrollbar-hide">
            <div className="text-center mb-2 bg-[#0b141a]/90 py-1 rounded-xl border border-foreground/5">
              <h3 className="text-[10px] font-semibold text-foreground">Zica Bella</h3>
              <p className="text-[8px] text-emerald-500">Business Account</p>
            </div>

            <div className="space-y-1.5 self-end max-w-[85%] bg-[#005c4b] text-foreground p-2 rounded-xl rounded-tr-sm shadow-md border border-foreground/5 text-[10px]">
              {headerComp?.format === "IMAGE" && (
                <div className="w-full h-20 bg-foreground/5 rounded-lg flex items-center justify-center overflow-hidden border border-foreground/10 mb-1">
                  <ImageIcon className="w-6 h-6 text-muted-foreground/35" />
                </div>
              )}
              {headerComp?.format === "TEXT" && textHeader && (
                <div className="font-bold text-[10px] text-foreground/80 mb-1">{textHeader}</div>
              )}
              <div className="whitespace-pre-wrap leading-relaxed text-foreground/90">{renderLivePreview()}</div>
              {footerComp && <div className="text-[8px] text-foreground/50 mt-1 border-t border-foreground/5 pt-1">{footerComp.text}</div>}
              <div className="text-[7px] text-foreground/40 text-right mt-0.5">12:00 PM</div>
            </div>

            {buttonsComp?.buttons && buttonsComp.buttons.length > 0 && (
              <div className="mt-1 space-y-1 self-end w-[85%]">
                {buttonsComp.buttons.map((btn: any, bi: number) => (
                  <div key={bi} className="bg-[#202c33]/90 text-emerald-400 font-semibold text-center py-2 rounded-xl shadow-sm text-[9px] font-semibold border border-foreground/5 flex items-center justify-center gap-1">
                    {btn.text || btn.type}
                    {btn.type === 'URL' && <ExternalLink className="w-2.5 h-2.5" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   SECTION D: BROADCAST CAMPAIGNS TAB
   ========================================================================== */
function BroadcastCampaigns() {
  const [type, setType] = useState("sale_alert");
  const [recipientsText, setRecipientsText] = useState("");
  const [payload, setPayload] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ total: number; current: number } | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [campaignName, setCampaignName] = useState("");
  const [audience, setAudience] = useState("all_customers");
  const [scheduledAt, setScheduledAt] = useState("");
  
  // Historical campaigns list
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState("all");
  
  // Campaign detail modal
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);
  const [campaignDetail, setCampaignDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Dynamic WABA templates state
  const [dbTemplates, setDbTemplates] = useState<any[]>([]);
  const [loadingDbTemplates, setLoadingDbTemplates] = useState(true);

  // Bulk confirmation popup state
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const campaignTemplates = [
    { id: "sale_alert", label: "Sale Alert", fields: ["discountPercent", "saleEndDate"] },
    { id: "new_collection", label: "New Collection Drop", fields: ["collectionName", "tagline", "imageUrl", "shopUrl"] },
    { id: "restock_alert", label: "Restock Alert", fields: ["productName", "size"] },
    { id: "welcome", label: "Welcome Subscriber", fields: [] },
    { id: "abandoned_cart", label: "Abandoned Cart Recovery", fields: ["itemCount", "cartTotal", "checkoutUrl"] },
  ];

  // Fetch templates from DB
  useEffect(() => {
    async function loadDbTemplates() {
      try {
        const res = await fetch("/api/whatsapp/templates");
        const data = await res.json();
        if (res.ok && data.templates) {
          setDbTemplates(data.templates);
        }
      } catch (err) {
        console.error("Failed to load WABA templates:", err);
      } finally {
        setLoadingDbTemplates(false);
      }
    }
    loadDbTemplates();
  }, []);

  // Merge hardcoded templates with dynamic synced ones from the DB
  const mergedTemplates = [
    ...campaignTemplates.map(t => ({ ...t, isCustom: false, text: "" })),
    ...dbTemplates.map(t => {
      const bodyComp = t.components?.find((c: any) => c.type === "BODY");
      const text = bodyComp?.text || "";
      const matches = text.match(/\{\{(\d+)\}\}/g) || [];
      const fields = matches.map((m: string) => m.replace(/[{}]/g, ""));
      return {
        id: t.name,
        label: `${t.name} (${t.category})`,
        fields: fields,
        isCustom: true,
        text: text
      };
    })
  ];

  const currentTemplate = mergedTemplates.find(c => c.id === type);

  // Compute recipients list count
  const recipients = recipientsText
    .split("\n")
    .map(line => {
      const parts = line.split(",");
      const phone = parts[0]?.trim();
      const customerName = parts[1]?.trim() || "there";
      return { phone, customerName };
    })
    .filter(r => r.phone);

  const estimatedCost = (recipients.length * 0.58).toFixed(2);

  // Fetch campaigns
  const fetchCampaigns = async () => {
    try {
      const params = new URLSearchParams();
      if (campaignStatusFilter !== "all") params.set("status", campaignStatusFilter);
      if (campaignSearch) params.set("search", campaignSearch);
      const res = await fetch(`/api/whatsapp/campaigns?${params.toString()}`);
      const data = await res.json();
      if (res.ok && data.campaigns) {
        setCampaigns(data.campaigns);
      }
    } catch (err) {
      console.error("Error loading campaigns:", err);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, [campaignStatusFilter, campaignSearch]);

  // Load campaign from URL if present
  useEffect(() => {
    if (typeof window === "undefined") return;
    const campaignIdParam = new URLSearchParams(window.location.search).get("campaignId");
    if (campaignIdParam && campaigns.length > 0) {
      const match = campaigns.find(c => c.id === campaignIdParam);
      if (match) {
        loadCampaignDetail(match);
        // Clear param from URL so it doesn't reopen on refresh
        const url = new URL(window.location.href);
        url.searchParams.delete("campaignId");
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, [campaigns]);

  // Poll active sending campaigns every 10s (was 3s); stable deps so interval is not reset each poll
  const hasActiveCampaign = campaigns.some(c => c.status === "sending" || c.status === "queued");
  useEffect(() => {
    if (!hasActiveCampaign) return;

    const interval = setInterval(async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/whatsapp/campaigns");
        const data = await res.json();
        if (res.ok && data.campaigns) {
          setCampaigns(data.campaigns);
        }
      } catch (err) {
        console.error("Polling campaigns failed:", err);
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [hasActiveCampaign]);

  // Load audience from DB
  const loadSegment = async (selectedAudience: string) => {
    const toastId = toast.loading(`Loading audience segment: ${selectedAudience}...`);
    try {
      const res = await fetch(`/api/whatsapp/recipients?audience=${selectedAudience}`);
      const data = await res.json();
      if (res.ok && data.recipients) {
        const text = data.recipients.map((r: any) => `${r.phone}, ${r.customerName}`).join("\n");
        setRecipientsText(text);
        toast.success(`Loaded ${data.recipients.length} opted-in subscribers!`, { id: toastId });
      } else {
        toast.error(data.error || "Failed to load database recipients.", { id: toastId });
      }
    } catch (e) {
      toast.error("Network error loading recipients.", { id: toastId });
    }
  };

  // CSV parsing
  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      
      const parsed = lines.map(line => {
        const parts = line.split(",");
        const phone = parts[0]?.trim() || '';
        const name = parts[1]?.trim() || '';
        return phone ? `${phone}${name ? ',' + name : ''}` : '';
      }).filter(Boolean).join("\n");

      setRecipientsText(parsed);
      setAudience("custom_csv");
      toast.success(`Successfully loaded ${lines.length} rows from CSV file!`);
    };
    reader.readAsText(file);
  };

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (recipients.length === 0) {
      toast.error("No valid recipients loaded.");
      return;
    }

    if (recipients.length > 10) {
      setShowConfirmModal(true);
    } else {
      executeBroadcast();
    }
  };

  const executeBroadcast = async () => {
    setShowConfirmModal(false);
    setLoading(true);
    setSummary(null);
    setProgress({ total: recipients.length, current: 0 });
    const toastId = toast.loading("Queuing broadcast campaign...");

    try {
      const res = await fetch("/api/whatsapp/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          recipients,
          payload,
          name: campaignName || undefined,
          scheduledAt: scheduledAt || undefined
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message || "Broadcast successfully queued in background!", { id: toastId });
        setRecipientsText("");
        setCampaignName("");
        setScheduledAt("");
        fetchCampaigns();
      } else {
        toast.error(data.error || "Broadcast campaign execution failed.", { id: toastId });
      }
    } catch (e) {
      toast.error("Network error during broadcast campaign.", { id: toastId });
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  // Campaign detail loader
  const loadCampaignDetail = async (campaign: any) => {
    setSelectedCampaign(campaign);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/whatsapp/campaigns/${campaign.id}`);
      const data = await res.json();
      if (res.ok && data.campaign) {
        setCampaignDetail(data.campaign);
      } else {
        toast.error("Failed to load campaign details.");
      }
    } catch (err) {
      toast.error("Network error loading campaign details.");
    } finally {
      setLoadingDetail(false);
    }
  };

  // Campaign actions
  const handleCampaignAction = async (campaignId: string, action: string, label: string) => {
    if (action === "delete") {
      if (!confirm(`Are you sure you want to permanently delete this campaign? This cannot be undone.`)) return;
      const toastId = toast.loading("Deleting campaign...");
      try {
        const res = await fetch("/api/whatsapp/campaigns", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: campaignId })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          toast.success("Campaign deleted successfully!", { id: toastId });
          setSelectedCampaign(null);
          setCampaignDetail(null);
          fetchCampaigns();
        } else {
          toast.error(data.error || "Failed to delete campaign.", { id: toastId });
        }
      } catch (err) {
        toast.error("Network error deleting campaign.", { id: toastId });
      }
      return;
    }

    const toastId = toast.loading(`${label}...`);
    try {
      const res = await fetch("/api/whatsapp/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: campaignId, action })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Campaign ${action}d successfully!`, { id: toastId });
        fetchCampaigns();
        if (selectedCampaign?.id === campaignId) {
          loadCampaignDetail({ ...selectedCampaign, status: data.campaign.status });
        }
      } else {
        toast.error(data.error || `Failed to ${action} campaign.`, { id: toastId });
      }
    } catch (err) {
      toast.error(`Network error during campaign ${action}.`, { id: toastId });
    }
  };

  // Duplicate campaign
  const handleDuplicate = (campaign: any) => {
    setCampaignName(`${campaign.name} (Copy)`);
    setType(campaign.templateName);
    if (campaign.templateParams) {
      try {
        setPayload(JSON.parse(campaign.templateParams));
      } catch {}
    }
    setSelectedCampaign(null);
    setCampaignDetail(null);
    toast.success("Campaign settings duplicated! Modify and send.");
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "border-emerald-500/20 text-emerald-500 bg-emerald-500/10";
      case "sending": return "border-blue-500/20 text-blue-500 bg-blue-500/10 animate-pulse";
      case "scheduled": return "border-amber-500/20 text-amber-500 bg-amber-500/10";
      case "paused": return "border-violet-500/20 text-violet-500 bg-violet-500/10";
      case "cancelled": return "border-zinc-500/20 text-zinc-500 bg-zinc-500/10";
      case "draft": return "border-foreground/10 text-foreground/50 bg-foreground/5";
      default: return "border-rose-500/20 text-rose-500 bg-rose-500/10";
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
      {/* Configuration Form */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="font-semibold text-lg">New Campaign Blast</h3>
        <form onSubmit={handleBroadcast} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-foreground/60 uppercase block mb-1.5">Campaign Name (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Summer Clearance Blast"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-foreground/60 uppercase block mb-1.5">Campaign Template</label>
            <select
              value={type}
              onChange={(e) => { setType(e.target.value); setPayload({}); }}
              className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500/50 text-sm"
            >
              {loadingDbTemplates ? (
                <option disabled>Loading dynamic templates...</option>
              ) : null}
              {mergedTemplates.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          {currentTemplate && (
            <div className="space-y-3 pt-3 border-t border-foreground/5">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-xs font-bold text-foreground/50 uppercase tracking-wider">Template Settings</h4>
                {currentTemplate.isCustom && (
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded font-mono font-semibold uppercase">Meta Approved</span>
                )}
              </div>

              {currentTemplate.text && (
                <div className="bg-foreground/5 p-3 rounded-xl border border-foreground/10 text-xs font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  <strong className="block text-[10px] text-foreground/50 uppercase mb-1">WABA Approved Body Preview:</strong>
                  {currentTemplate.text}
                </div>
              )}

              {currentTemplate.fields.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {currentTemplate.fields.map((field: string, idx: number) => {
                    const isFirst = idx === 0;
                    return (
                      <div key={field}>
                        <label className="text-xs text-muted-foreground block mb-1 font-mono">
                          {currentTemplate.isCustom ? `Variable {{${field}}}` : field}
                        </label>
                        <input
                          type="text"
                          required
                          placeholder={
                            isFirst && currentTemplate.isCustom
                              ? "First placeholder defaults to Customer Name"
                              : `Value for placeholder ${field}`
                          }
                          value={payload[field] || ""}
                          onChange={(e) => setPayload((p: any) => ({ ...p, [field]: e.target.value }))}
                          className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3.5 py-2 outline-none focus:border-emerald-500/50 text-sm"
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic py-1">
                  This template does not require any variables or placeholders.
                </div>
              )}
            </div>
          )}

          <div className="border-t border-foreground/5 pt-3 space-y-3">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-2">
              <label className="text-xs font-semibold text-foreground/60 uppercase flex items-center gap-1.5">
                <span>Target Audience</span>
                {recipients.length > 0 && (
                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.2 rounded-full font-mono text-[9px] font-bold">
                    {recipients.length} resolved
                  </span>
                )}
              </label>
              
              <div className="flex items-center gap-2">
                <select
                  value={audience}
                  onChange={(e) => {
                    setAudience(e.target.value);
                    if (e.target.value !== "custom_csv") {
                      loadSegment(e.target.value);
                    }
                  }}
                  className="bg-foreground/5 border border-foreground/10 rounded-lg px-2.5 py-1 text-xs outline-none focus:border-foreground/30 text-foreground"
                >
                  <option value="all_customers">All Opted-In Customers</option>
                  <option value="new_customers">New Customers (Signups)</option>
                  <option value="returning_customers">Returning Customers</option>
                  <option value="high_value_customers">High-Value Customers</option>
                  <option value="wishlist_customers">Wishlist Customers</option>
                  <option value="cart_abandonment">Cart Abandonment Customers</option>
                  <option value="custom_csv">Upload Custom CSV File</option>
                </select>

                {audience === "custom_csv" && (
                  <label className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer border border-emerald-500/20">
                    Upload CSV
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleCSVUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
            
            <textarea
              rows={5}
              required
              placeholder={"e.g. +919876543210, Priya\n+919988776655, Rahul"}
              value={recipientsText}
              onChange={(e) => setRecipientsText(e.target.value)}
              className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm font-mono text-xs resize-none"
            />
            <span className="text-[10px] text-muted-foreground block">Format: [phone], [name] (one per line). Empty numbers are ignored. Only opted-in numbers are allowed.</span>
          </div>

          <div>
            <label className="text-xs font-semibold text-foreground/60 uppercase block mb-1.5">Schedule Campaign (Optional)</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm text-foreground"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Leave blank to send immediately, or pick a future time to schedule.</p>
          </div>

          {/* Pricing & Estimation banner */}
          <div className="bg-foreground/5 p-3 rounded-xl border border-foreground/10 flex justify-between items-center text-xs">
            <div className="text-muted-foreground">
              <span className="font-semibold text-foreground block">{recipients.length} recipients loaded</span>
              Est. Marketing cost: ₹0.58 / message
            </div>
            <div className="text-right text-sm font-bold text-foreground">
              ₹{estimatedCost} INR
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || recipients.length === 0}
            className="w-full bg-emerald-500 text-foreground py-3 rounded-xl font-medium text-sm hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span>Send Campaign Blast</span>
          </button>
        </form>
      </div>

      {/* Campaign Dashboard Panel */}
      <div className="glass-card p-6 flex flex-col justify-between h-[700px] overflow-hidden">
        <div className="space-y-4 flex flex-col h-full">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-lg">Campaign Dashboard</h3>
            <button
              onClick={() => fetchCampaigns()}
              className="p-2 bg-foreground/5 hover:bg-foreground/10 text-foreground border border-foreground/10 rounded-lg transition-all"
              title="Refresh"
            >
              <RefreshCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search & Filter */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search campaigns..."
                value={campaignSearch}
                onChange={(e) => setCampaignSearch(e.target.value)}
                className="w-full bg-foreground/5 border border-foreground/10 rounded-lg pl-8 pr-3 py-1.5 outline-none focus:border-emerald-500/50 text-xs text-foreground"
              />
            </div>
            <select
              value={campaignStatusFilter}
              onChange={(e) => setCampaignStatusFilter(e.target.value)}
              className="bg-foreground/5 border border-foreground/10 rounded-lg px-2 py-1.5 outline-none text-xs text-foreground"
            >
              <option value="all">All Status</option>
              <option value="sending">Sending</option>
              <option value="completed">Completed</option>
              <option value="scheduled">Scheduled</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
            {loadingCampaigns ? (
              <div className="flex justify-center py-20">
                <RefreshCcw className="w-6 h-6 animate-spin text-emerald-500" />
              </div>
            ) : campaigns.length === 0 ? (
              <div className="py-20 text-center text-muted-foreground text-sm flex flex-col items-center justify-center">
                <Send className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <span>No campaigns found. Start one or adjust your filters.</span>
              </div>
            ) : (
              campaigns.map((c) => {
                const total = c.statsSent + c.statsFailed;
                const progressVal = total > 0 ? (c.statsSent / total) * 100 : 0;
                
                return (
                  <div 
                    key={c.id} 
                    className="bg-foreground/5 border border-foreground/10 rounded-xl p-4 space-y-3 hover:bg-foreground/[0.08] transition-all cursor-pointer group"
                    onClick={() => loadCampaignDetail(c)}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold text-sm text-foreground group-hover:text-emerald-500 transition-colors">{c.name}</h4>
                        <span className="text-[10px] font-mono text-muted-foreground block mt-0.5">Template: {c.templateName}</span>
                      </div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusColor(c.status)}`}>
                        {c.status.toUpperCase()}
                      </span>
                    </div>

                    {/* Stats metrics */}
                    <div className="grid grid-cols-4 gap-2 text-center text-[10px] font-semibold text-muted-foreground">
                      <div className="bg-background/40 p-1.5 rounded-lg border border-foreground/5">
                        <span className="block text-[8px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">Sent</span>
                        <strong className="text-foreground text-xs">{c.statsSent}</strong>
                      </div>
                      <div className="bg-emerald-500/5 p-1.5 rounded-lg border border-emerald-500/10">
                        <span className="block text-[8px] uppercase tracking-wider text-emerald-500/60 mb-0.5">Delivered</span>
                        <strong className="text-emerald-500 text-xs">{c.statsDelivered}</strong>
                      </div>
                      <div className="bg-blue-500/5 p-1.5 rounded-lg border border-blue-500/10">
                        <span className="block text-[8px] uppercase tracking-wider text-blue-500/60 mb-0.5">Read</span>
                        <strong className="text-blue-500 text-xs">{c.statsRead}</strong>
                      </div>
                      <div className="bg-rose-500/5 p-1.5 rounded-lg border border-rose-500/10">
                        <span className="block text-[8px] uppercase tracking-wider text-rose-500/60 mb-0.5">Failed</span>
                        <strong className="text-rose-500 text-xs">{c.statsFailed}</strong>
                      </div>
                    </div>

                    {/* Progress Bar for active campaign */}
                    {(c.status === "sending" || c.status === "queued") && (
                      <div className="space-y-1">
                        <div className="w-full bg-foreground/5 rounded-full h-1.5 overflow-hidden border border-foreground/5">
                          <div 
                            className="bg-blue-500 h-full rounded-full transition-all duration-300"
                            style={{ width: `${progressVal}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[8px] text-muted-foreground">
                          <span>Progress: {Math.round(progressVal)}%</span>
                          <span>{c.statsSent} sent</span>
                        </div>
                      </div>
                    )}

                    {/* Quick Actions Row */}
                    <div className="flex justify-between items-center pt-1 border-t border-foreground/5">
                      <div className="text-[9px] text-muted-foreground">
                        {c.scheduledAt ? (
                          <span className="text-amber-500 font-semibold font-mono">
                            Scheduled: {new Date(c.scheduledAt).toLocaleString('en-IN')}
                          </span>
                        ) : (
                          <span>{new Date(c.createdAt).toLocaleString('en-IN')}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {c.status === "sending" && (
                          <button
                            onClick={() => handleCampaignAction(c.id, "pause", "Pausing campaign")}
                            className="text-[9px] font-bold text-violet-500 hover:bg-violet-500/10 px-2 py-0.5 rounded-lg transition-colors"
                            title="Pause"
                          >
                            Pause
                          </button>
                        )}
                        {c.status === "paused" && (
                          <button
                            onClick={() => handleCampaignAction(c.id, "resume", "Resuming campaign")}
                            className="text-[9px] font-bold text-blue-500 hover:bg-blue-500/10 px-2 py-0.5 rounded-lg transition-colors"
                            title="Resume"
                          >
                            Resume
                          </button>
                        )}
                        {["sending", "paused", "scheduled", "queued"].includes(c.status) && (
                          <button
                            onClick={() => handleCampaignAction(c.id, "cancel", "Cancelling campaign")}
                            className="text-[9px] font-bold text-amber-500 hover:bg-amber-500/10 px-2 py-0.5 rounded-lg transition-colors"
                            title="Cancel"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          onClick={() => handleDuplicate(c)}
                          className="text-[9px] font-bold text-foreground/50 hover:text-foreground hover:bg-foreground/5 px-2 py-0.5 rounded-lg transition-colors"
                          title="Duplicate"
                        >
                          Duplicate
                        </button>
                        {c.status !== "sending" && (
                          <button
                            onClick={() => handleCampaignAction(c.id, "delete", "Deleting campaign")}
                            className="text-[9px] font-bold text-rose-500 hover:bg-rose-500/10 px-2 py-0.5 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Campaign Detail Modal */}
      {selectedCampaign && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-background border border-foreground/10 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh]"
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center p-5 border-b border-foreground/10">
              <div>
                <h3 className="font-semibold text-lg">{selectedCampaign.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs font-mono text-muted-foreground">Template: {selectedCampaign.templateName}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusColor(selectedCampaign.status)}`}>
                    {selectedCampaign.status.toUpperCase()}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => { setSelectedCampaign(null); setCampaignDetail(null); }}
                className="text-muted-foreground hover:text-foreground text-sm p-1 hover:bg-foreground/5 rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {loadingDetail ? (
                <div className="flex justify-center py-16">
                  <RefreshCcw className="w-8 h-8 animate-spin text-emerald-500" />
                </div>
              ) : campaignDetail ? (
                <>
                  {/* Stats Overview */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { label: "Sent", value: campaignDetail.statsSent, color: "text-foreground" },
                      { label: "Delivered", value: campaignDetail.statsDelivered, color: "text-emerald-500" },
                      { label: "Read", value: campaignDetail.statsRead, color: "text-blue-500" },
                      { label: "Replied", value: campaignDetail.statsReplied, color: "text-violet-500" },
                      { label: "Failed", value: campaignDetail.statsFailed, color: "text-rose-500" },
                    ].map(s => (
                      <div key={s.label} className="bg-foreground/5 p-3 rounded-xl border border-foreground/10 text-center">
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">{s.label}</span>
                        <strong className={`text-lg font-bold ${s.color}`}>{s.value}</strong>
                      </div>
                    ))}
                  </div>

                  {/* Campaign Metadata */}
                  <div className="grid grid-cols-2 gap-4 bg-foreground/[0.02] p-4 rounded-xl border border-foreground/5 text-xs">
                    <div>
                      <span className="text-muted-foreground uppercase font-mono text-[9px] block">Created</span>
                      <strong className="text-foreground/90">{new Date(campaignDetail.createdAt).toLocaleString('en-IN')}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground uppercase font-mono text-[9px] block">Sent At</span>
                      <strong className="text-foreground/90">{campaignDetail.sentAt ? new Date(campaignDetail.sentAt).toLocaleString('en-IN') : 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground uppercase font-mono text-[9px] block">Target Segment</span>
                      <strong className="text-foreground/90 capitalize">{campaignDetail.targetSegment}</strong>
                    </div>
                    {campaignDetail.scheduledAt && (
                      <div>
                        <span className="text-muted-foreground uppercase font-mono text-[9px] block">Scheduled</span>
                        <strong className="text-amber-500">{new Date(campaignDetail.scheduledAt).toLocaleString('en-IN')}</strong>
                      </div>
                    )}
                  </div>

                  {/* Recipients Table */}
                  {campaignDetail.recipients && campaignDetail.recipients.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-foreground/60 uppercase tracking-wider">
                        Recipients ({campaignDetail.recipients.length})
                      </h4>
                      <div className="max-h-[300px] overflow-y-auto rounded-xl border border-foreground/10">
                        <table className="w-full text-xs">
                          <thead className="bg-foreground/[0.02] sticky top-0 border-b border-foreground/10">
                            <tr>
                              <th className="text-left font-medium text-foreground/60 px-4 py-2.5">Phone</th>
                              <th className="text-left font-medium text-foreground/60 px-4 py-2.5">Name</th>
                              <th className="text-left font-medium text-foreground/60 px-4 py-2.5">Status</th>
                              <th className="text-left font-medium text-foreground/60 px-4 py-2.5">Sent At</th>
                              <th className="text-right font-medium text-foreground/60 px-4 py-2.5">Message ID</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-foreground/5">
                            {campaignDetail.recipients.map((r: any) => (
                              <tr key={r.id} className="hover:bg-foreground/[0.02] transition-colors">
                                <td className="px-4 py-2 font-mono">{r.phone}</td>
                                <td className="px-4 py-2">{r.name || "—"}</td>
                                <td className="px-4 py-2">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                                    r.status === "sent" || r.status === "delivered" || r.status === "read" 
                                      ? "border-emerald-500/20 text-emerald-500 bg-emerald-500/10"
                                      : r.status === "failed" || r.status === "cancelled"
                                      ? "border-rose-500/20 text-rose-500 bg-rose-500/10"
                                      : "border-amber-500/20 text-amber-500 bg-amber-500/10"
                                  }`}>
                                    {r.status.toUpperCase()}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-muted-foreground">
                                  {r.sentAt ? new Date(r.sentAt).toLocaleString('en-IN') : "—"}
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-muted-foreground truncate max-w-[120px]" title={r.messageId}>
                                  {r.messageId ? r.messageId.substring(0, 16) + '...' : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-16 text-center text-muted-foreground text-sm">
                  Failed to load campaign details.
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="flex items-center justify-between p-4 border-t border-foreground/10 bg-foreground/[0.02]">
              <div className="flex gap-2">
                {selectedCampaign.status === "sending" && (
                  <button
                    onClick={() => handleCampaignAction(selectedCampaign.id, "pause", "Pausing")}
                    className="px-3 py-1.5 text-xs font-semibold text-violet-500 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 rounded-lg transition-colors"
                  >
                    Pause Campaign
                  </button>
                )}
                {selectedCampaign.status === "paused" && (
                  <button
                    onClick={() => handleCampaignAction(selectedCampaign.id, "resume", "Resuming")}
                    className="px-3 py-1.5 text-xs font-semibold text-blue-500 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-lg transition-colors"
                  >
                    Resume Campaign
                  </button>
                )}
                {["sending", "paused", "scheduled"].includes(selectedCampaign.status) && (
                  <button
                    onClick={() => handleCampaignAction(selectedCampaign.id, "cancel", "Cancelling")}
                    className="px-3 py-1.5 text-xs font-semibold text-amber-500 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg transition-colors"
                  >
                    Cancel Campaign
                  </button>
                )}
                <button
                  onClick={() => handleDuplicate(selectedCampaign)}
                  className="px-3 py-1.5 text-xs font-semibold text-foreground/60 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 rounded-lg transition-colors"
                >
                  Duplicate
                </button>
              </div>
              <div className="flex gap-2">
                {selectedCampaign.status !== "sending" && (
                  <button
                    onClick={() => handleCampaignAction(selectedCampaign.id, "delete", "Deleting")}
                    className="px-3 py-1.5 text-xs font-semibold text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg transition-colors"
                  >
                    Delete Campaign
                  </button>
                )}
                <button
                  onClick={() => { setSelectedCampaign(null); setCampaignDetail(null); }}
                  className="px-3 py-1.5 text-xs font-semibold bg-foreground/5 text-foreground hover:bg-foreground/10 border border-foreground/10 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-background border border-foreground/15 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-lg font-bold flex items-center gap-2 text-amber-500">
              <AlertCircle className="w-5 h-5" />
              <span>Confirm Bulk WhatsApp Send</span>
            </h3>
            
            <p className="text-sm text-muted-foreground leading-relaxed">
              You are about to launch a marketing WhatsApp broadcast campaign to <strong>{recipients.length}</strong> recipients.
            </p>

            <div className="bg-foreground/5 p-3 rounded-xl border border-foreground/10 space-y-2 text-xs">
              <div>
                <span className="text-muted-foreground font-semibold block">Campaign Name:</span>
                <span>{campaignName || `Broadcast - ${type}`}</span>
              </div>
              <div>
                <span className="text-muted-foreground font-semibold block">Template Name:</span>
                <span className="font-mono">{type}</span>
              </div>
              <div>
                <span className="text-muted-foreground font-semibold block">Estimated Cost:</span>
                <span className="font-bold text-emerald-400">₹{estimatedCost} INR</span>
              </div>
            </div>

            <p className="text-xs text-rose-400 font-semibold leading-normal">
              ⚠ Verification is required for campaigns with more than 10 recipients to prevent accidental messaging spam.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 bg-foreground/5 text-foreground hover:bg-foreground/10 border border-foreground/10 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={executeBroadcast}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-foreground rounded-xl text-xs font-bold shadow-lg"
              >
                Confirm & Send
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}



/* ==========================================================================
   SECTION E: ABANDONED CART RECOVERY
   ========================================================================== */
function CartRecovery() {
  const [carts, setCarts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isBulkSending, setIsBulkSending] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [schedulerStats, setSchedulerStats] = useState<any>(null);
  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [selectedCart, setSelectedCart] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchStats = async () => {
    try {
      const [statsRes, schedulerRes] = await Promise.allSettled([
        fetch("/api/whatsapp/abandoned-cart/stats"),
        fetch("/api/whatsapp/scheduler-stats")
      ]);
      if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
        const data = await statsRes.value.json();
        setStats(data);
      }
      if (schedulerRes.status === 'fulfilled' && schedulerRes.value.ok) {
        const data = await schedulerRes.value.json();
        setSchedulerStats(data);
      }
    } catch (e) {
      console.error("Failed to load cart recovery stats:", e);
    }
  };

  const fetchAutomationSetting = async () => {
    try {
      const res = await fetch("/api/whatsapp/settings");
      const data = await res.json();
      if (res.ok && data.settings) {
        setAutomationEnabled(data.settings.cart_recovery_enabled !== false);
      }
    } catch (e) {
      console.error("Failed to load automation settings:", e);
    }
  };

  const toggleAutomation = async () => {
    const nextVal = !automationEnabled;
    setAutomationEnabled(nextVal);
    try {
      const res = await fetch("/api/whatsapp/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart_recovery_enabled: nextVal })
      });
      if (res.ok) {
        toast.success(`Cart Recovery automation ${nextVal ? 'enabled' : 'disabled'}.`);
      } else {
        toast.error("Failed to save automation setting.");
        setAutomationEnabled(!nextVal);
      }
    } catch (e) {
      toast.error("Network error saving automation setting.");
      setAutomationEnabled(!nextVal);
    }
  };

  const fetchCarts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/shopify/carts/abandoned");
      const data = await res.json();
      if (res.ok) {
        setCarts(data.carts || []);
      } else {
        toast.error("Failed to load abandoned carts.");
      }
    } catch (e) {
      toast.error("Network error fetching carts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCarts();
    fetchStats();
    fetchAutomationSetting();
  }, []);

  const handleSendRecoveryStep = async (cart: any, stepType: 'abandoned_cart' | 'cart_followup' | 'cart_final') => {
    const labelMap = {
      'abandoned_cart': 'Initial Reminder (Step 1)',
      'cart_followup': 'Follow-Up (Step 2)',
      'cart_final': 'Final Reminder (Step 3)'
    };
    const toastId = toast.loading(`Sending ${labelMap[stepType]} to ${cart.customer}...`);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: stepType,
          to: cart.phone,
          payload: {
            phone: cart.phone,
            customerName: cart.customer,
            checkoutUrl: cart.abandoned_checkout_url,
            productImageUrl: cart.productImageUrl,
            cartTotal: cart.cart_value.replace(/[^0-9.]/g, ''),
            itemCount: cart.itemsRaw?.length || 1
          }
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`${labelMap[stepType]} sent successfully!`, { id: toastId });
        fetchCarts();
        fetchStats();
      } else {
        toast.error(data.error || "Failed to send recovery.", { id: toastId });
      }
    } catch (e) {
      toast.error("Network error triggering recovery.", { id: toastId });
    }
  };

  const handleSendAllPending = async () => {
    const pendingCarts = carts.filter(c => c.status === "pending");
    if (pendingCarts.length === 0) {
      toast.info("No pending carts to recover.");
      return;
    }

    if (!confirm(`Are you sure you want to recover ${pendingCarts.length} pending carts?`)) return;

    setIsBulkSending(true);
    const toastId = toast.loading(`Recovering ${pendingCarts.length} checkouts...`);
    
    let sentCount = 0;
    for (const cart of pendingCarts) {
      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "abandoned_cart",
            to: cart.phone,
            payload: {
              phone: cart.phone,
              customerName: cart.customer,
              checkoutUrl: cart.abandoned_checkout_url,
              productImageUrl: cart.productImageUrl,
              cartTotal: cart.cart_value.replace(/[^0-9.]/g, ''),
              itemCount: cart.itemsRaw?.length || 1
            }
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          sentCount++;
          setCarts(prev => prev.map(c => c.id === cart.id ? { ...c, status: "sent", recovery_step: 'step1_sent' } : c));
        }
        await new Promise(r => setTimeout(r, 80));
      } catch (e) {
        console.error("Bulk cart recovery error for cart id: " + cart.id);
      }
    }

    toast.success(`Bulk recovery completed! Sent: ${sentCount}`, { id: toastId });
    setIsBulkSending(false);
    fetchStats();
  };

  const filteredCarts = carts.filter(c => 
    c.customer.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.items.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Recovery stats cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <span className="text-xs font-semibold text-foreground/50 tracking-wider uppercase block mb-1">Recovered Revenue</span>
          <span className="text-2xl font-bold tracking-tight text-emerald-500">
            ₹{(stats?.recoveredRevenue || 0).toLocaleString('en-IN')}
          </span>
        </div>
        <div className="glass-card p-5">
          <span className="text-xs font-semibold text-foreground/50 tracking-wider uppercase block mb-1">Recovered Orders</span>
          <span className="text-2xl font-bold tracking-tight">
            {stats?.recoveredOrders || 0}
          </span>
        </div>
        <div className="glass-card p-5">
          <span className="text-xs font-semibold text-foreground/50 tracking-wider uppercase block mb-1">Recovery Rate</span>
          <span className="text-2xl font-bold tracking-tight text-blue-500">
            {stats?.recoveryRate || 0}%
          </span>
        </div>
        <div className="glass-card p-5">
          <span className="text-xs font-semibold text-foreground/50 tracking-wider uppercase block mb-1">Recoveries Sent</span>
          <span className="text-2xl font-bold tracking-tight text-muted-foreground">
            {stats?.totalSent || 0}
          </span>
        </div>
      </div>

      {/* Scheduler Automation Health Banner */}
      <div className="glass-card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <div>
            <span className="text-xs font-semibold text-foreground">WhatsApp Scheduler Health</span>
            <span className="text-xs text-muted-foreground block font-mono text-[11px]">
              {schedulerStats?.lastRun ? (
                <>Last run: <strong className="text-foreground">{new Date(schedulerStats.lastRun.createdAt).toLocaleString('en-IN')}</strong> · Status: <strong className={schedulerStats.lastRun.success ? "text-emerald-500" : "text-amber-500"}>{schedulerStats.lastRun.success ? "Healthy" : "Failed"}</strong></>
              ) : (
                "Checking scheduler heartbeat..."
              )}
            </span>
          </div>
        </div>
        {schedulerStats?.sends24h && (
          <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-3 bg-foreground/5 px-3 py-1.5 rounded-xl border border-foreground/5">
            <span>24h Recovery Sends: <strong className="text-emerald-400">
              {(schedulerStats.sends24h['abandoned_cart_a1'] || 0) +
               (schedulerStats.sends24h['abandoned_cart_a2'] || 0) +
               (schedulerStats.sends24h['abandoned_cart_a3'] || 0) +
               (schedulerStats.sends24h['zica_cart_recovery_v1'] || 0) +
               (schedulerStats.sends24h['zica_cart_followup_a1'] || 0) +
               (schedulerStats.sends24h['zica_cart_final_a1'] || 0)}
            </strong></span>
          </div>
        )}
      </div>

      {/* Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Abandoned Carts (Shopify)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Track and send WhatsApp reminders to customers who left items in checkouts.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Automation Switch */}
          <div className="flex items-center gap-2 bg-foreground/5 border border-foreground/10 px-3 py-1.5 rounded-xl text-xs">
            <span className="text-muted-foreground font-medium">Auto-pilot (Multi-step):</span>
            <button onClick={toggleAutomation} className="text-emerald-500 hover:opacity-90 transition-opacity">
              {automationEnabled ? (
                <ToggleRight className="w-10 h-6 text-emerald-500 cursor-pointer" />
              ) : (
                <ToggleLeft className="w-10 h-6 text-muted-foreground cursor-pointer" />
              )}
            </button>
          </div>

          <button
            onClick={handleSendAllPending}
            disabled={loading || isBulkSending || carts.filter(c => c.status === "pending").length === 0}
            className="bg-emerald-500 hover:bg-emerald-600 text-foreground px-4 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-lg"
          >
            <Send className="w-3.5 h-3.5" />
            Send All Pending
          </button>
        </div>
      </div>

      {/* Search Filter */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input 
          type="text" 
          placeholder="Search by customer name, phone, or products..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-foreground/5 border border-foreground/10 rounded-xl pl-10 pr-4 py-2.5 outline-none focus:border-emerald-500/50 text-sm text-foreground"
        />
      </div>

      {/* Carts Table */}
      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCcw className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-foreground/[0.02] border-b border-foreground/10">
                <tr>
                  <th className="text-left font-medium text-foreground/60 px-5 py-3.5">Customer</th>
                  <th className="text-left font-medium text-foreground/60 px-5 py-3.5">Phone</th>
                  <th className="text-left font-medium text-foreground/60 px-5 py-3.5">Products Preview</th>
                  <th className="text-left font-medium text-foreground/60 px-5 py-3.5">Cart Value</th>
                  <th className="text-left font-medium text-foreground/60 px-5 py-3.5">Abandoned At</th>
                  <th className="text-left font-medium text-foreground/60 px-5 py-3.5">Recovery Step</th>
                  <th className="text-right font-medium text-foreground/60 px-5 py-3.5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/10">
                {filteredCarts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                      No matching abandoned checkouts found.
                    </td>
                  </tr>
                ) : (
                  filteredCarts.map((row) => (
                    <tr key={row.id} className="hover:bg-foreground/5 transition-colors cursor-pointer group" onClick={() => setSelectedCart(row)}>
                      <td className="px-5 py-4">
                        <span className="font-semibold text-foreground group-hover:text-emerald-500 transition-colors block">{row.customer}</span>
                        <span className="text-[10px] text-muted-foreground">ID: {row.id}</span>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-foreground/80">{row.phone || '—'}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 max-w-xs">
                          {row.productImageUrl ? (
                            <img src={row.productImageUrl} alt="Product preview" className="w-8 h-8 rounded-lg object-cover bg-foreground/5 border border-foreground/10 shrink-0" onError={(e: any) => { e.target.style.display = 'none'; }} />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-foreground/5 border border-foreground/10 flex items-center justify-center shrink-0">
                              <ImageIcon className="w-3.5 h-3.5 text-muted-foreground/45" />
                            </div>
                          )}
                          <span className="truncate text-xs text-foreground/80 font-medium" title={row.items}>{row.items}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 font-bold text-foreground">{row.cart_value}</td>
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        {new Date(row.abandoned_at).toLocaleString('en-IN', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border font-mono ${
                          row.recovery_step === 'step1_sent' ? 'border-blue-500/20 text-blue-500 bg-blue-500/10' :
                          row.recovery_step === 'step2_sent' ? 'border-purple-500/20 text-purple-500 bg-purple-500/10' :
                          row.recovery_step === 'final_sent' ? 'border-emerald-500/20 text-emerald-500 bg-emerald-500/10' :
                          'border-amber-500/20 text-amber-500 bg-amber-500/10'
                        }`}>
                          {row.recovery_step === 'step1_sent' ? 'STEP 1 SENT' :
                           row.recovery_step === 'step2_sent' ? 'STEP 2 SENT' :
                           row.recovery_step === 'final_sent' ? 'FINAL SENT' :
                           'PENDING'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {row.recovery_step === 'pending' && (
                            <button 
                              onClick={() => handleSendRecoveryStep(row, 'abandoned_cart')}
                              className="text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2.5 py-1 rounded-lg hover:bg-emerald-500 hover:text-foreground transition-all"
                            >
                              Send Step 1
                            </button>
                          )}
                          {row.recovery_step === 'step1_sent' && (
                            <button 
                              onClick={() => handleSendRecoveryStep(row, 'cart_followup')}
                              className="text-[10px] font-bold bg-blue-500/10 text-blue-500 border border-blue-500/20 px-2.5 py-1 rounded-lg hover:bg-blue-500 hover:text-foreground transition-all"
                            >
                              Send Step 2
                            </button>
                          )}
                          {row.recovery_step === 'step2_sent' && (
                            <button 
                              onClick={() => handleSendRecoveryStep(row, 'cart_final')}
                              className="text-[10px] font-bold bg-purple-500/10 text-purple-500 border border-purple-500/20 px-2.5 py-1 rounded-lg hover:bg-purple-500 hover:text-foreground transition-all"
                            >
                              Send Final
                            </button>
                          )}
                          <a 
                            href={row.abandoned_checkout_url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="p-1.5 bg-foreground/5 border border-foreground/10 rounded-lg text-muted-foreground hover:text-foreground transition-all"
                            title="Direct Recover Checkout Link"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cart Items Detail Slide-over Drawer */}
      <AnimatePresence>
        {selectedCart && (
          <div className="fixed inset-0 z-50 flex items-center justify-end">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedCart(null)} className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
            <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }} className="glass-card absolute right-0 top-0 bottom-0 max-w-md w-full h-full border-l border-foreground/10 shadow-2xl flex flex-col z-10">
              <div className="flex justify-between items-center p-5 border-b border-foreground/5">
                <div>
                  <h3 className="font-semibold text-base">Cart Details</h3>
                  <span className="text-xs text-muted-foreground">{selectedCart.customer}</span>
                </div>
                <button onClick={() => setSelectedCart(null)} className="p-1.5 hover:bg-foreground/5 text-muted-foreground hover:text-foreground rounded-lg"><span className="text-lg">✕</span></button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
                <div className="bg-foreground/5 p-4 rounded-xl border border-foreground/10 space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Phone:</span> <strong className="font-mono">{selectedCart.phone || '—'}</strong></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Status:</span> <strong>{selectedCart.status.toUpperCase()}</strong></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Step state:</span> <strong className="text-emerald-500 uppercase">{selectedCart.recovery_step.replace('_', ' ')}</strong></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Total value:</span> <strong className="text-foreground">{selectedCart.cart_value}</strong></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Abandoned at:</span> <strong>{new Date(selectedCart.abandoned_at).toLocaleString('en-IN')}</strong></div>
                </div>

                {/* Items List */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-foreground/60 uppercase">Cart Items ({selectedCart.itemsRaw?.length || 0})</h4>
                  <div className="space-y-2.5">
                    {selectedCart.itemsRaw?.map((item: any, i: number) => (
                      <div key={i} className="flex gap-3 bg-foreground/[0.02] border border-foreground/5 p-3 rounded-xl hover:bg-foreground/[0.04] transition-all">
                        {item.image ? (
                          <img src={item.image} alt={item.title} className="w-12 h-12 rounded-lg object-cover bg-foreground/5 border border-foreground/10 shrink-0" onError={(e: any) => { e.target.style.display = 'none'; }} />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-foreground/5 border border-foreground/10 flex items-center justify-center shrink-0">
                            <ImageIcon className="w-5 h-5 text-muted-foreground/30" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="font-semibold text-xs text-foreground/90 block truncate">{item.title}</span>
                          <span className="text-[10px] text-muted-foreground block mt-0.5">Quantity: {item.quantity || 1}</span>
                          <span className="text-[10px] text-muted-foreground font-semibold block">₹{parseFloat(item.price || 0).toLocaleString('en-IN')} each</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recovery actions inside drawer */}
                <div className="space-y-2.5 pt-3 border-t border-foreground/5">
                  <h4 className="text-xs font-semibold text-foreground/60 uppercase">Trigger Recovery Template</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <button 
                      onClick={() => handleSendRecoveryStep(selectedCart, 'abandoned_cart')}
                      className="px-2.5 py-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500 hover:text-foreground rounded-xl text-[10px] font-bold transition-all"
                    >
                      Step 1 (Initial)
                    </button>
                    <button 
                      onClick={() => handleSendRecoveryStep(selectedCart, 'cart_followup')}
                      className="px-2.5 py-2 bg-blue-500/10 text-blue-500 border border-blue-500/20 hover:bg-blue-500 hover:text-foreground rounded-xl text-[10px] font-bold transition-all"
                    >
                      Step 2 (Promo)
                    </button>
                    <button 
                      onClick={() => handleSendRecoveryStep(selectedCart, 'cart_final')}
                      className="px-2.5 py-2 bg-purple-500/10 text-purple-500 border border-purple-500/20 hover:bg-purple-500 hover:text-foreground rounded-xl text-[10px] font-bold transition-all"
                    >
                      Step 3 (Urgent)
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-foreground/5 bg-foreground/[0.01] flex gap-2">
                <a 
                  href={selectedCart.abandoned_checkout_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-foreground py-2.5 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-1.5 shadow-lg"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Direct Checkout Link
                </a>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ==========================================================================
   SECTION F: ORDER NOTIFICATIONS AUTOMATION
   ========================================================================== */
function OrderNotifications() {
  const [settings, setSettings] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [approvedTemplates, setApprovedTemplates] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [settingsRes, templatesRes, statsRes] = await Promise.allSettled([
          fetch("/api/whatsapp/settings"),
          fetch("/api/whatsapp/templates"),
          fetch("/api/whatsapp/scheduler-stats")
        ]);

        if (settingsRes.status === 'fulfilled' && settingsRes.value.ok) {
          const settingsData = await settingsRes.value.json();
          setSettings(settingsData.settings || {});
        } else {
          console.warn("Failed to load settings");
        }

        if (templatesRes.status === 'fulfilled' && templatesRes.value.ok) {
          const templatesData = await templatesRes.value.json();
          const approved = (templatesData.templates || []).filter(
            (t: any) => t.status === "APPROVED"
          );
          setApprovedTemplates(approved);
        } else {
          console.warn("Failed to load templates");
        }

        if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
          const statsData = await statsRes.value.json();
          setStats(statsData);
        } else {
          console.warn("Failed to load scheduler stats");
        }
      } catch (err) {
        console.error("Failed to load automation metrics:", err);
        toast.error("Failed to load automation settings.");
      } finally {
        setLoading(false);
        setStatsLoading(false);
      }
    }
    fetchAll();
  }, []);

  const handleToggle = async (key: string) => {
    const nextVal = !settings[key];
    setSettings((s: any) => ({ ...s, [key]: nextVal }));

    try {
      const res = await fetch("/api/whatsapp/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: nextVal })
      });
      if (res.ok) {
        toast.success("Settings updated successfully!");
      } else {
        toast.error("Failed to save changes.");
        setSettings((s: any) => ({ ...s, [key]: !nextVal }));
      }
    } catch {
      toast.error("Network error saving settings.");
      setSettings((s: any) => ({ ...s, [key]: !nextVal }));
    }
  };

  const handleTemplateChange = async (settingKey: string, templateName: string) => {
    const prev = settings[settingKey] || '';
    setSettings((s: any) => ({ ...s, [settingKey]: templateName }));

    try {
      const res = await fetch("/api/whatsapp/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [settingKey]: templateName })
      });
      if (res.ok) {
        toast.success("Template mapping updated!");
      } else {
        toast.error("Failed to save template mapping.");
        setSettings((s: any) => ({ ...s, [settingKey]: prev }));
      }
    } catch {
      toast.error("Network error saving template.");
      setSettings((s: any) => ({ ...s, [settingKey]: prev }));
    }
  };

  const handleDelaySave = async (key: string, value: string, unit: string) => {
    const minutes = convertToMinutes(value, unit);
    const prev = settings[key];
    setSettings((s: any) => ({ ...s, [key]: String(minutes) }));

    try {
      const res = await fetch("/api/whatsapp/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: String(minutes) })
      });
      if (res.ok) {
        toast.success("Delay timing updated!");
      } else {
        toast.error("Failed to save delay timing.");
        setSettings((s: any) => ({ ...s, [key]: prev }));
      }
    } catch {
      toast.error("Network error saving delay timing.");
      setSettings((s: any) => ({ ...s, [key]: prev }));
    }
  };

  const parseMinutes = (minutesStr: string) => {
    const mins = parseInt(minutesStr, 10) || 0;
    if (mins === 0) return { value: "0", unit: "minutes" };
    if (mins % 10080 === 0) return { value: String(mins / 10080), unit: "weeks" };
    if (mins % 1440 === 0) return { value: String(mins / 1440), unit: "days" };
    if (mins % 60 === 0) return { value: String(mins / 60), unit: "hours" };
    return { value: String(mins), unit: "minutes" };
  };

  const convertToMinutes = (val: string, unit: string) => {
    const num = parseInt(val, 10) || 0;
    if (unit === "weeks") return num * 10080;
    if (unit === "days") return num * 1440;
    if (unit === "hours") return num * 60;
    return num;
  };

  const automations = [
    { key: "order_confirmed", templateKey: "template_order_confirmed", defaultTemplate: "zica_order_confirmed_v1", title: "Order Confirmation", desc: "Auto-send on Shopify order creation (orders/create webhook)." },
    { key: "order_status", templateKey: "template_order_status", defaultTemplate: "zb_order_status", title: "Order Status Update", desc: "Auto-send on order state alterations (orders/updated webhook)." },
    { key: "order_shipped", templateKey: "template_order_shipped", defaultTemplate: "zica_order_shipped", title: "Order Shipped", desc: "Auto-send on order fulfillment containing courier tracking (orders/fulfilled webhook)." },
    { key: "out_for_delivery", templateKey: "template_out_for_delivery", defaultTemplate: "zb_out_for_delivery", title: "Out for Delivery", desc: "Auto-send when carrier status marks package as out for delivery." },
    { key: "order_delivered", templateKey: "template_order_delivered", defaultTemplate: "zica_order_delivered_v1", title: "Delivered Confirmation", desc: "Auto-send notification validating package drop-off." },
    { key: "return_confirmed", templateKey: "template_return_confirmed", defaultTemplate: "zb_return_confirmed", title: "Return Request Confirmed", desc: "Auto-send receipt validation containing credit processing status." },
    { key: "return_pickup_scheduled_enabled", templateKey: "template_return_pickup", defaultTemplate: "zb_return_pickup_scheduled", title: "Return Pickup Scheduled", desc: "Auto-send when reverse pickup is scheduled for an approved return." },
    { key: "exchange_confirmed_enabled", templateKey: "template_exchange_confirmed", defaultTemplate: "zb_exchange_confirmed", title: "Exchange Confirmed", desc: "Auto-send when an exchange request is approved." },
    { key: "exchange_pickup_scheduled_enabled", templateKey: "template_exchange_pickup", defaultTemplate: "zb_exchange_pickup_scheduled", title: "Exchange Pickup Scheduled", desc: "Auto-send when reverse pickup is scheduled for an approved exchange." },
    { key: "exchange_shipped_enabled", templateKey: "template_exchange_shipped", defaultTemplate: "zb_exchange_shipped", title: "Exchange Item Shipped", desc: "Auto-send when the replacement item ships after QC." },
    { key: "cod_confirmation_enabled", templateKey: "template_cod_confirmation", defaultTemplate: "zica_cod_confirmation_v1", title: "COD Confirmation", desc: "Auto-send confirmation request to Cash on Delivery orders." },
    { key: "cart_recovery_enabled", templateKey: "template_abandoned_cart", defaultTemplate: "abandoned_cart_a1", delayKey: "delay_abandoned_cart_step1", title: "Cart Recovery (Step 1)", desc: "Initial abandoned cart reminder sent when a cart goes inactive." },
    { key: "cart_recovery_step2_enabled", templateKey: "template_cart_followup", defaultTemplate: "abandoned_cart_a2", delayKey: "delay_abandoned_cart_step2", title: "Cart Recovery (Step 2)", desc: "Second reminder containing a discount code to recover abandoned items." },
    { key: "cart_recovery_step3_enabled", templateKey: "template_cart_final", defaultTemplate: "abandoned_cart_a3", delayKey: "delay_abandoned_cart_step3", title: "Cart Recovery (Step 3)", desc: "Final cart recovery reminder before cart expires." },
    { key: "new_collection_enabled", templateKey: "template_new_collection", defaultTemplate: "zb_new_collection", title: "New Collection Alert", desc: "Broadcast to opted-in customers when a new collection launches." },
    { key: "sale_alert_enabled", templateKey: "template_sale_alert", defaultTemplate: "zb_sale_alert", title: "Sale Alert", desc: "Broadcast sale/discount notifications to opted-in customers." },
    { key: "restock_alert_enabled", templateKey: "template_restock_alert", defaultTemplate: "zb_restock_alert", title: "Restock Alert", desc: "Notify opted-in customers when popular products are restocked." },
    { key: "welcome_enabled", templateKey: "template_welcome", defaultTemplate: "zb_welcome", title: "Welcome Message", desc: "Auto-send welcome message to new customers who opt in." },
    { key: "account_created_enabled", templateKey: "template_account_created", defaultTemplate: "account_created", title: "Account Created", desc: "Sent once when a customer logs in for the first time (or first login after feature launch). UTILITY — no marketing consent required." },
  ];

  return (
    <div className="max-w-3xl mx-auto glass-card p-6 mt-4">
      <h3 className="font-semibold text-lg mb-2">Automated Notifications</h3>
      <p className="text-xs text-muted-foreground border-b border-foreground/5 pb-4 mb-4">
        Toggle automated notifications, configure sending delays, and map events to Meta-approved templates.
      </p>

      {loading ? (
        <div className="flex justify-center py-10">
          <RefreshCcw className="w-6 h-6 animate-spin text-emerald-500" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Scheduler Health status panel */}
          <div className="p-4 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 shadow-lg relative overflow-hidden transition-all duration-300 hover:border-white/20">
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
            
            <div className="flex justify-between items-start mb-3">
              <div>
                <span className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">System Status</span>
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  WhatsApp Scheduler Health
                </h4>
              </div>
              {stats && stats.lastRun && (
                <span className="text-[10px] text-muted-foreground bg-foreground/5 px-2 py-0.5 rounded-full border border-foreground/5">
                  Last Run: {new Date(stats.lastRun.createdAt).toLocaleTimeString()}
                </span>
              )}
            </div>

            {statsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <RefreshCcw className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                Fetching scheduler health metrics...
              </div>
            ) : stats ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-foreground/5 rounded-xl p-2.5 border border-foreground/5">
                    <span className="text-muted-foreground block text-[10px]">Scheduler Heartbeat</span>
                    <span className="font-semibold text-foreground block mt-0.5">
                      {stats.lastRun ? (stats.lastRun.success ? 'Healthy' : 'Error') : 'No Heartbeat'}
                    </span>
                  </div>
                  <div className="bg-foreground/5 rounded-xl p-2.5 border border-foreground/5">
                    <span className="text-muted-foreground block text-[10px]">Carts Recovered (24h)</span>
                    <span className="font-semibold text-foreground block mt-0.5">
                      {(stats.sends24h?.['abandoned_cart_a1'] || 0) +
                       (stats.sends24h?.['abandoned_cart_a2'] || 0) +
                       (stats.sends24h?.['abandoned_cart_a3'] || 0) +
                       (stats.sends24h?.['zica_cart_recovery_v1'] || 0) + 
                       (stats.sends24h?.['zb_cart_followup'] || 0) + 
                       (stats.sends24h?.['zb_cart_final'] || 0)} sends
                    </span>
                  </div>
                </div>

                {stats.lastRun && !stats.lastRun.success && stats.lastRun.errors && (
                  <div className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5 break-all max-h-20 overflow-y-auto">
                    <span className="font-semibold block mb-0.5">Last Error Log:</span>
                    {stats.lastRun.errors}
                  </div>
                )}

                {Object.keys(stats.sends24h || {}).length > 0 && (
                  <div className="pt-2 border-t border-foreground/5">
                    <span className="text-[10px] text-muted-foreground font-semibold block mb-1.5">Template Activity (Last 24h)</span>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                      {Object.entries(stats.sends24h || {}).map(([template, count]: [string, any]) => (
                        <div key={template} className="flex justify-between items-center bg-foreground/5 px-2 py-1 rounded-lg border border-foreground/5">
                          <span className="text-muted-foreground truncate max-w-[160px]" title={template}>{template}</span>
                          <span className="font-bold text-foreground bg-foreground/10 px-1.5 py-0.5 rounded text-[10px]">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground py-2">
                No stats available. Set up the pinger worker to activate.
              </div>
            )}
          </div>

          {automations.map((a) => (
            <div key={a.key} className="p-3 rounded-xl hover:bg-foreground/5 transition-all border border-foreground/5">
              <div className="flex justify-between items-center gap-4">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold">{a.title}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{a.desc}</p>
                </div>
                <button 
                  onClick={() => handleToggle(a.key)}
                  className="shrink-0 hover:opacity-90 transition-opacity"
                >
                  {settings[a.key] ? (
                    <ToggleRight className="w-12 h-8 text-emerald-500 cursor-pointer" />
                  ) : (
                    <ToggleLeft className="w-12 h-8 text-muted-foreground cursor-pointer" />
                  )}
                </button>
              </div>

              {settings[a.key] && (
                <div className="mt-3 pt-3 border-t border-foreground/5 space-y-2.5">
                  {/* Template selector dropdown */}
                  {a.templateKey && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">Template:</span>
                      <select
                        value={settings[a.templateKey] || ''}
                        onChange={(e) => handleTemplateChange(a.templateKey!, e.target.value)}
                        className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all"
                      >
                        <option value="">Default ({a.defaultTemplate})</option>
                        {approvedTemplates.map((t: any) => (
                          <option key={t.name} value={t.name}>
                            {t.name} ({t.category})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Delay Input */}
                  {a.delayKey && (
                    <DelayInput
                      delayKey={a.delayKey}
                      defaultValue={settings[a.delayKey]}
                      onSave={handleDelaySave}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Sub-component for delay inputs
  function DelayInput({ delayKey, defaultValue, onSave }: any) {
    const [localValue, setLocalValue] = useState("");
    const [localUnit, setLocalUnit] = useState("minutes");

    useEffect(() => {
      if (defaultValue !== undefined) {
        const { value, unit } = parseMinutes(String(defaultValue));
        setLocalValue(value);
        setLocalUnit(unit);
      }
    }, [defaultValue]);

    const handleBlur = () => {
      onSave(delayKey, localValue, localUnit);
    };

    const handleUnitChange = (newUnit: string) => {
      setLocalUnit(newUnit);
      onSave(delayKey, localValue, newUnit);
    };

    return (
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[11px] text-muted-foreground whitespace-nowrap font-mono text-[10px]">Send Delay:</span>
        <input
          type="number"
          min="1"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          className="w-16 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/50 font-medium"
        />
        <select
          value={localUnit}
          onChange={(e) => handleUnitChange(e.target.value)}
          className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all font-medium"
        >
          <option value="minutes">Minutes</option>
          <option value="hours">Hours</option>
          <option value="days">Days</option>
          <option value="weeks">Weeks</option>
        </select>
      </div>
    );
  }
}

/* ==========================================================================
   SECTION G: MESSAGE LOGS TAB
   ========================================================================== */
function MessageLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/logs?page=${page}&limit=10&type=${typeFilter}`);
      const data = await res.json();
      if (res.ok) {
        setLogs(data.logs || []);
        setTotalCount(data.totalCount || 0);
      }
    } catch (e) {
      toast.error("Failed to query transaction logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, typeFilter]);

  const totalPages = Math.ceil(totalCount / 10) || 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold">Message Logs</h3>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchLogs()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-foreground/5 hover:bg-foreground/10 text-foreground font-medium rounded-xl border border-foreground/10 transition-colors disabled:opacity-50"
          >
            <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Logs
          </button>
          
          {/* Filters */}
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-1.5 outline-none focus:border-emerald-500/50 text-xs"
          >
            <option value="">All Message Types</option>
            <option value="welcome">Welcome</option>
            <option value="order_confirmed">Order Confirmed</option>
            <option value="order_status">Order Status</option>
            <option value="order_shipped">Shipped</option>
            <option value="abandoned_cart">Abandoned Cart</option>
            <option value="sale_alert">Sale Alert</option>
            <option value="new_collection">New Collection</option>
            <option value="account_created">Account Created</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCcw className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-foreground/[0.02] border-b border-foreground/10">
              <tr>
                <th className="text-left font-medium text-foreground/60 px-5 py-3.5">Recipient</th>
                <th className="text-left font-medium text-foreground/60 px-5 py-3.5">Type</th>
                <th className="text-left font-medium text-foreground/60 px-5 py-3.5">Template</th>
                <th className="text-left font-medium text-foreground/60 px-5 py-3.5">Status</th>
                <th className="text-left font-medium text-foreground/60 px-5 py-3.5">Error</th>
                <th className="text-left font-medium text-foreground/60 px-5 py-3.5">Sent At</th>
                <th className="text-right font-medium text-foreground/60 px-5 py-3.5">Message ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/10">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-muted-foreground text-sm">
                    No logs recorded.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className={`hover:bg-foreground/5 transition-colors ${log.status === 'failed' ? 'bg-rose-500/[0.03]' : ''}`}>
                    <td className="px-5 py-4 font-mono text-xs">{log.recipient_phone}</td>
                    <td className="px-5 py-4 font-semibold text-xs text-muted-foreground uppercase">{log.message_type}</td>
                    <td className="px-5 py-4 font-mono text-xs">{log.template_name}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                        log.status === 'read' ? 'border-blue-500/20 text-blue-500 bg-blue-500/10' :
                        log.status === 'delivered' ? 'border-emerald-500/20 text-emerald-500 bg-emerald-500/10' :
                        log.status === 'failed' ? 'border-rose-500/20 text-rose-500 bg-rose-500/10' :
                        'border-amber-500/20 text-amber-500 bg-amber-500/10'
                      }`}>
                        {log.status?.toUpperCase() || 'SENT'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {log.status === 'failed' ? (
                        <div className="flex flex-col gap-1 max-w-[240px]">
                          {log.error_code && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 w-fit">
                              Code {log.error_code}
                            </span>
                          )}
                          <span className="text-[11px] text-rose-300/90 break-words leading-tight" title={log.error_message || 'Send failed'}>
                            {log.error_message || (
                              log.error_code === '131049' ? 'Frequency cap — user not engaged' :
                              log.error_code === '131056' ? 'Messaging limit reached' :
                              log.error_code === '132000' ? 'Template not found on Meta' :
                              log.error_code === '131047' ? 'Outside 24hr re-engagement window' :
                              log.error_code === '133010' ? 'Number not on WhatsApp' :
                              log.error_code === '131026' ? 'Message undeliverable' :
                              'Send failed'
                            )}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-muted-foreground">
                      {new Date(log.sent_at).toLocaleString('en-IN')}
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-xs text-muted-foreground">{log.message_id || "N/A"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex justify-between items-center p-4 border-t border-foreground/10">
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p: number) => p - 1)}
                  className="px-3 py-1.5 bg-foreground/5 border border-foreground/10 rounded-lg text-xs font-semibold disabled:opacity-50 transition-all"
                >
                  Previous
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p: number) => p + 1)}
                  className="px-3 py-1.5 bg-foreground/5 border border-foreground/10 rounded-lg text-xs font-semibold disabled:opacity-50 transition-all"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CODOperations() {
  const [stats, setStats] = useState<any[]>([]);
  const [verifications, setVerifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/cod/stats");
      const data = await res.json();
      if (res.ok) {
        setStats(data.stats || []);
        setVerifications(data.verifications || []);
      }
    } catch (err) {
      toast.error("Failed to load COD verification metrics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleResend = async (orderId: string) => {
    const toastId = toast.loading("Resending COD verification...");
    try {
      const res = await fetch("/api/orders/cod-confirm-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success("Verification template sent successfully!", { id: toastId });
        fetchData();
      } else {
        toast.error(data.error || "Failed to resend verification.", { id: toastId });
      }
    } catch (err) {
      toast.error("Network error resending verification.", { id: toastId });
    }
  };

  // Filter verifications by search query
  const filteredVerifications = verifications.filter(v =>
    v.shopifyOrderId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.customerName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getIcon = (label: string) => {
    if (label === "Confirmed Today") return CheckCircle2;
    if (label === "Avg Response Time") return BarChart3;
    return AlertCircle;
  };

  return (
    <div className="space-y-6">
      {loading && stats.length === 0 ? (
        <div className="flex justify-center py-20">
          <RefreshCcw className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.map((s, i) => {
              const Icon = getIcon(s.label);
              return (
                <div key={i} className="glass-card p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <Icon className={`w-4 h-4 ${s.color || 'text-muted-foreground'}`} />
                    <span className="text-xs font-semibold text-foreground/50 tracking-wider uppercase">{s.label}</span>
                  </div>
                  <span className="text-2xl font-bold tracking-tight">{s.value}</span>
                </div>
              );
            })}
          </div>

          <div className="glass-card overflow-hidden">
            <div className="p-5 border-b border-foreground/10 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Recent COD Verifications</h3>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
                <input 
                  type="text" 
                  placeholder="Search orders..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-1.5 bg-foreground/5 border border-foreground/10 rounded-lg text-sm outline-none w-64 focus:border-foreground/30"
                />
              </div>
            </div>
            
            <table className="w-full text-sm">
              <thead className="bg-foreground/[0.02] border-b border-foreground/10">
                <tr>
                  <th className="text-left font-medium text-foreground/60 px-5 py-3">Order</th>
                  <th className="text-left font-medium text-foreground/60 px-5 py-3">Customer</th>
                  <th className="text-left font-medium text-foreground/60 px-5 py-3">Amount</th>
                  <th className="text-left font-medium text-foreground/60 px-5 py-3">Risk Score</th>
                  <th className="text-left font-medium text-foreground/60 px-5 py-3">Status</th>
                  <th className="text-right font-medium text-foreground/60 px-5 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/10">
                {filteredVerifications.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                      No COD verifications found.
                    </td>
                  </tr>
                ) : (
                  filteredVerifications.map((row) => (
                    <tr key={row.id} className="hover:bg-foreground/5 transition-colors">
                      <td className="px-5 py-4 font-medium">#{row.shopifyOrderId}</td>
                      <td className="px-5 py-4 text-foreground/80">{row.customerName}</td>
                      <td className="px-5 py-4">{row.amount}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold ${
                          row.riskScore > 70 ? 'bg-rose-500/10 text-rose-500' :
                          row.riskScore > 30 ? 'bg-amber-500/10 text-amber-500' :
                          'bg-emerald-500/10 text-emerald-500'
                        }`}>
                          {row.riskScore}/100
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                          row.status === 'confirmed' ? 'border-emerald-500/20 text-emerald-600 bg-emerald-500/10' :
                          row.status === 'cancelled' || row.status === 'cancelled_by_customer' ? 'border-rose-500/20 text-rose-600 bg-rose-500/10' :
                          'border-amber-500/20 text-amber-600 bg-amber-500/10'
                        }`}>
                          {row.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        {row.status === 'pending' && (
                          <button 
                            onClick={() => handleResend(row.id)}
                            className="text-xs font-semibold text-blue-500 hover:text-blue-600 transition-all hover:underline"
                          >
                            Resend WhatsApp
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
