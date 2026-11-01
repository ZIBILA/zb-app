"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Home, 
  ShoppingBag, 
  ScanLine, 
  BoxSelect, 
  ClipboardList, 
  TrendingUp, 
  Layers2, 
  Building2, 
  Coins, 
  BarChart3, 
  Settings, 
  Search, 
  ArrowUp, 
  CheckCircle2, 
  Info, 
  AlertTriangle,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  BookOpen,
  MousePointer2,
  Zap,
  HelpCircle,
  XCircle,
  CheckCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Neon Green Accent: #BFFF00
const ACCENT_COLOR = "#BFFF00";

const SECTIONS = [
  { id: "overview", title: "Overview", icon: Home, emoji: "🏠", category: "Core" },
  { id: "orders", title: "Orders Management", icon: ShoppingBag, emoji: "📦", category: "Core" },
  { id: "scanner", title: "Scanner Hub", icon: ScanLine, emoji: "🔍", category: "Operations" },
  { id: "inventory", title: "Inventory Management", icon: BoxSelect, emoji: "🗂️", category: "Operations" },
  { id: "tasks", title: "Pending Tasks Manager", icon: ClipboardList, emoji: "✅", category: "Operations" },
  { id: "production", title: "Production Tracker", icon: TrendingUp, emoji: "🏭", category: "Manufacturing" },
  { id: "products", title: "Products Management", icon: Layers2, emoji: "👗", category: "Storefront" },
  { id: "vendors", title: "Vendors & Suppliers", icon: Building2, emoji: "🧵", category: "Manufacturing" },
  { id: "ledger", title: "Cost Ledger", icon: Coins, emoji: "💰", category: "Finance" },
  { id: "analytics", title: "Analytics & Reports", icon: BarChart3, emoji: "📊", category: "Intelligence" },
  { id: "settings", title: "System Settings", icon: Settings, emoji: "⚙️", category: "Admin" },
];

export default function GuidePage() {
  const [activeSection, setActiveSection] = useState<string | null>("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [readSections, setReadSections] = useState<string[]>([]);
  
  const toggleSection = (id: string) => {
    setActiveSection(activeSection === id ? null : id);
    if (activeSection !== id) {
      setTimeout(() => {
        const element = document.getElementById(id);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
        }
      }, 100);
    }
  };

  const toggleRead = (id: string) => {
    setReadSections(prev => 
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const filteredSections = SECTIONS.filter(s => 
    s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const progress = (readSections.length / SECTIONS.length) * 100;

  return (
    <div className="max-w-full px-1 lg:px-4">
      {/* Header Section */}
      <div className="mb-12 space-y-4 pt-4 overflow-visible">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-3 font-bold text-[10px] tracking-[0.3em] uppercase"
          style={{ color: ACCENT_COLOR }}
        >
          <BookOpen className="w-3.5 h-3.5" />
          Internal Knowledge Base
        </motion.div>
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl lg:text-7xl font-black tracking-tight text-foreground leading-[1.1]"
        >
          Admin <span className="block lg:inline" style={{ color: ACCENT_COLOR }}>Dashboard Guide</span>
        </motion.h1>
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-base lg:text-lg text-foreground/50 max-w-3xl leading-relaxed font-medium"
        >
          Master the Zica Bella operational ecosystem. This interactive reference guide explains every workflow, from raw material procurement to final order fulfillment.
        </motion.p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start relative">
        {/* --- Sidebar TOC --- */}
        <aside className="w-full lg:w-80 shrink-0 lg:sticky lg:top-24 z-30">
          <div className="glass p-8 rounded-[2.5rem] space-y-8 border-foreground/10 shadow-2xl">
            {/* Progress Card */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-foreground/30">Module Progress</span>
                <span className="text-[10px] font-black" style={{ color: ACCENT_COLOR }}>{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 w-full bg-foreground/5 rounded-full overflow-hidden border border-foreground/5">
                <motion.div 
                  className="h-full"
                  style={{ backgroundColor: ACCENT_COLOR }}
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ type: "spring", stiffness: 50, damping: 20 }}
                />
              </div>
            </div>

            {/* Search */}
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20 group-focus-within:text-foreground transition-colors" />
              <input 
                type="text" 
                placeholder="Search modules..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-foreground/5 border border-foreground/10 rounded-2xl py-4 pl-12 pr-4 text-sm text-foreground focus:outline-none focus:ring-1 transition-all placeholder:text-foreground/20"
                style={{ "--tw-ring-color": ACCENT_COLOR } as any}
              />
            </div>

            {/* Nav List */}
            <nav className="space-y-2 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2 -mr-4">
              {filteredSections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                const isRead = readSections.includes(section.id);
                
                return (
                  <button
                    key={section.id}
                    onClick={() => toggleSection(section.id)}
                    className={`w-full flex items-center justify-between gap-3 px-5 py-4 rounded-2xl text-left transition-all duration-300 relative overflow-hidden ${
                      isActive 
                        ? "shadow-lg" 
                        : "text-foreground/40 hover:text-foreground hover:bg-foreground/5"
                    }`}
                    style={{ 
                      backgroundColor: isActive ? ACCENT_COLOR : "transparent",
                      color: isActive ? "black" : ""
                    }}
                  >
                    <div className="flex items-center gap-4 relative z-10">
                      <Icon className={`w-4 h-4 transition-colors ${isActive ? "text-background" : "text-foreground/20 group-hover:text-foreground"}`} />
                      <div className="flex flex-col">
                        <span className="text-[12px] font-bold truncate">{section.title}</span>
                        <span className={`text-[8px] uppercase tracking-widest font-black ${isActive ? "text-background/50" : "text-foreground/10"}`}>
                          {section.category}
                        </span>
                      </div>
                    </div>
                    {isRead && <CheckCircle2 className={`w-3.5 h-3.5 relative z-10 ${isActive ? "text-background/60" : "text-green-500"}`} />}
                  </button>
                );
              })}
            </nav>

            <div className="pt-6 border-t border-foreground/5">
              <div className="flex items-center gap-4 p-4 bg-foreground/5 rounded-2xl border border-foreground/5">
                <div className="w-8 h-8 rounded-xl bg-foreground/5 flex items-center justify-center shrink-0">
                  <HelpCircle className="w-4 h-4" style={{ color: ACCENT_COLOR }} />
                </div>
                <div className="text-[10px] text-foreground/30 font-bold uppercase tracking-wider leading-relaxed">
                  Support active <br />via <span className="text-foreground">Zica AI</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* --- Main Content Area --- */}
        <div className="flex-1 w-full lg:max-w-[calc(100%-340px)] space-y-6">
          {/* Golden Rules Global Card */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass rounded-[3rem] p-8 lg:p-10 border border-[#BFFF00]/20 bg-[#BFFF00]/5 space-y-6"
          >
            <div className="flex items-center gap-4">
              <Zap className="w-6 h-6" style={{ color: ACCENT_COLOR }} />
              <h2 className="text-xl font-black uppercase tracking-widest text-foreground">Operational Golden Rules</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase text-green-500 flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5" /> Do's
                </h4>
                <ul className="text-[13px] text-foreground/60 space-y-2 list-disc pl-4 font-medium">
                  <li>Use the scanner for <strong>every</strong> stage transition.</li>
                  <li>Link all expenses to a specific <strong>Order ID</strong>.</li>
                  <li>Complete <strong>Quality Check</strong> only after <strong>Wash</strong>.</li>
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase text-red-500 flex items-center gap-2">
                  <XCircle className="w-3.5 h-3.5" /> Don'ts
                </h4>
                <ul className="text-[13px] text-foreground/60 space-y-2 list-disc pl-4 font-medium">
                  <li><strong>Never</strong> scan the same item twice for the same stage.</li>
                  <li>Don't create manual orders for Shopify transactions.</li>
                  <li>Avoid deleting items; use <strong>Stock Adjustments</strong>.</li>
                </ul>
              </div>
            </div>
          </motion.div>

          <AnimatePresence mode="popLayout">
            {filteredSections.map((section) => (
              <GuideSectionCard 
                key={section.id}
                section={section}
                isOpen={activeSection === section.id}
                onToggle={() => toggleSection(section.id)}
                isRead={readSections.includes(section.id)}
                onMarkRead={() => toggleRead(section.id)}
              />
            ))}
          </AnimatePresence>

          {/* Empty State */}
          {filteredSections.length === 0 && (
            <div className="glass p-16 rounded-[3rem] text-center space-y-6 border-foreground/5">
              <div className="w-20 h-20 bg-foreground/5 rounded-full flex items-center justify-center mx-auto border border-foreground/10">
                <Search className="w-10 h-10 text-foreground/10" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-foreground">No matches found</h3>
                <p className="text-foreground/30 font-medium">Try searching for keywords like "orders" or "sync".</p>
              </div>
              <button 
                onClick={() => setSearchQuery("")}
                className="px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 transition-transform"
                style={{ backgroundColor: ACCENT_COLOR, color: "black" }}
              >
                Clear Search
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer Branding */}
      <div className="mt-32 pt-16 border-t border-foreground/5 flex flex-col md:flex-row items-center justify-between gap-8 opacity-20 hover:opacity-60 transition-opacity duration-1000 pb-16">
        <div className="flex items-center gap-6">
          <div className="w-12 h-12 bg-foreground/5 rounded-2xl flex items-center justify-center font-black text-sm" style={{ color: ACCENT_COLOR }}>ZB</div>
          <div className="text-[10px] uppercase tracking-[0.4em] font-black text-foreground">Zica Bella System v2.6</div>
        </div>
        <button 
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.3em] text-foreground hover:text-foreground transition-colors"
        >
          Return to top <ArrowUp className="w-4 h-4" style={{ color: ACCENT_COLOR }} />
        </button>
      </div>
    </div>
  );
}

// --- Detailed Section Component ---

function GuideSectionCard({ section, isOpen, onToggle, isRead, onMarkRead }: { 
  section: typeof SECTIONS[0], 
  isOpen: boolean, 
  onToggle: () => void, 
  isRead: boolean, 
  onMarkRead: () => void 
}) {
  return (
    <motion.div 
      id={section.id}
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass rounded-[3rem] overflow-hidden transition-all duration-700 border-foreground/5 ${
        isOpen ? "shadow-[0_48px_96px_-24px_rgba(0,0,0,0.1)] dark:shadow-[0_48px_96px_-24px_rgba(0,0,0,0.8)] ring-1 ring-foreground/10" : "hover:bg-foreground/[0.02] cursor-pointer"
      }`}
    >
      {/* Card Header (Toggle) */}
      <div 
        onClick={onToggle}
        className="p-8 lg:p-10 flex items-center justify-between group select-none"
      >
        <div className="flex items-center gap-8">
          <div className={`w-16 h-16 rounded-3xl flex items-center justify-center text-4xl transition-all duration-500 ${
            isOpen ? "scale-110 shadow-2xl" : "bg-foreground/5"
          }`} style={{ backgroundColor: isOpen ? ACCENT_COLOR : "" }}>
            {section.emoji}
          </div>
          <div>
            <h2 className={`text-2xl lg:text-3xl font-black tracking-tight transition-colors ${isOpen ? "text-foreground" : "text-foreground/70 group-hover:text-foreground"}`}>
              {section.title}
            </h2>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: ACCENT_COLOR }}>Module {section.id.toUpperCase()}</span>
              <div className="w-1.5 h-1.5 rounded-full bg-foreground/10" />
              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/20">{section.category}</span>
            </div>
          </div>
        </div>
        <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 border border-foreground/5 ${isOpen ? "bg-foreground/10 rotate-180" : "bg-foreground/5 group-hover:bg-foreground/10"}`}>
          <ChevronDown className={`w-6 h-6 ${isOpen ? "text-foreground" : "text-foreground/20"}`} />
        </div>
      </div>

      {/* Expandable Content */}
      <motion.div
        initial={false}
        animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="overflow-hidden"
      >
        <div className="px-8 lg:px-12 pb-12 space-y-12 border-t border-foreground/5 pt-10">
          {/* Detailed Content */}
          <div className="prose prose-invert max-w-none text-foreground/60 leading-[1.8] space-y-10 font-medium text-sm lg:text-base">
            {renderSectionContent(section.id)}
          </div>

          {/* Action Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-8 pt-12 border-t border-foreground/5">
            <div className="flex items-center gap-5">
              <div className="flex -space-x-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="w-10 h-10 rounded-full bg-foreground/10 border-2 border-background flex items-center justify-center text-[10px] font-black text-foreground/50">
                    {String.fromCharCode(64 + i)}
                  </div>
                ))}
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-foreground/20">Operational Training Record</span>
            </div>

            <button 
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead();
              }}
              className={`flex items-center justify-center gap-3 px-10 py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all duration-500 border ${
                isRead 
                  ? "bg-transparent text-green-500 border-green-500/20" 
                  : "text-background hover:scale-105 active:scale-95 shadow-2xl"
              }`}
              style={{ backgroundColor: isRead ? "transparent" : ACCENT_COLOR, borderColor: isRead ? "rgba(34, 197, 94, 0.2)" : "transparent" }}
            >
              {isRead ? (
                <>
                  <CheckCircle2 className="w-4 h-4" /> Validated
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" /> Confirm Understanding
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Content Rendering Logic ---

function renderSectionContent(id: string) {
  switch (id) {
    case "overview":
      return (
        <div className="space-y-10">
          <p className="text-xl text-foreground/80 leading-relaxed font-bold">The <strong>Command Center</strong> of Zica Bella. This page aggregates data from Shopify, our mobile app, and the manufacturing floor to give you a 360-degree view of operations.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <InfoCard title="Real-time Revenue" desc="Tracks Gross Sales vs Net Profit after production costs are deducted." icon={Coins} />
            <InfoCard title="Operational Pulse" desc="Shows items currently 'In Production' and those 'Awaiting Dispatch'." icon={TrendingUp} />
          </div>

          <DosAndDonts 
            dos={["Check alerts first thing in the morning.", "Verify date filters before reporting stats."]}
            donts={["Ignore low stock alerts in red.", "Share admin credentials with non-staff."]}
          />

          <div className="space-y-6">
            <h4 className="text-foreground text-lg font-black uppercase tracking-widest flex items-center gap-3">
              <MousePointer2 className="w-5 h-5" style={{ color: ACCENT_COLOR }} /> 
              Key Interaction Points
            </h4>
            <div className="grid grid-cols-1 gap-6">
              <ListItem num="01" title="Date Range Control" text="Located in the top right. Changes the timeframe for all metrics (Sales, Orders, Expenses). Critical for month-end reporting." />
              <ListItem num="02" title="Activity Stream" text="A chronological log of all admin actions. If an order status was changed, it shows WHO did it and WHEN." />
              <ListItem num="03" title="Alert Center" text="Automated notifications for stockouts, overdue production tasks, or failed Shopify syncs." />
            </div>
          </div>

          <TipBox>
            Use the "Quick Action" buttons for the fastest way to add a walk-in order or log a quick expense without navigating through menus.
          </TipBox>
        </div>
      );

    case "orders":
      return (
        <div className="space-y-10">
          <p className="text-lg">This module centralizes every transaction. We distinguish between <strong>Web Orders</strong> (Shopify) and <strong>Mobile App Orders</strong> (Direct).</p>
          
          <div className="space-y-6">
            <h4 className="text-foreground text-sm font-black uppercase tracking-widest">The Fulfillment Lifecycle</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatusBox status="Pending" desc="New order, payment verified." />
              <StatusBox status="Production" desc="On factory floor." color="orange" />
              <StatusBox status="QC" desc="Verifying measurements." color="purple" />
              <StatusBox status="Shipped" desc="Handed to Logistics." color="cyan" />
            </div>
          </div>

          <DosAndDonts 
            dos={["Add internal notes for custom fitting.", "Check the 'Order Timeline' for delays."]}
            donts={["Create duplicate orders manually.", "Change status to 'Shipped' without a tracking ID."]}
          />

          <div className="space-y-6">
            <h4 className="text-foreground text-sm font-black uppercase tracking-widest">Critical Workflows</h4>
            <StepList steps={[
              "Filter by 'Production' to see what needs to be manufactured today.",
              "Use internal notes to flag custom measurement requirements for the stitching team.",
              "Click the 'Order Timeline' to see exactly where a delay is occurring.",
              "Return Management: Mark as 'Returned' to trigger a refund task automatically."
            ]} />
          </div>

          <WarningBox>
            Never manually update an order to 'Delivered' unless the logistics partner API fails. The system syncs this automatically every 30 minutes.
          </WarningBox>
        </div>
      );

    case "scanner":
      return (
        <div className="space-y-10">
          <p>The <strong>Universal Scanner</strong> turns any device into a warehouse terminal. It is optimized for mobile browser use.</p>
          
          <DosAndDonts 
            dos={["Hold the camera steady for 1 second.", "Clean the lens before starting bulk scans."]}
            donts={["Scan the same item twice for one stage.", "Scan damaged QR codes (enter manually)."]}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="glass p-8 border-foreground/5 space-y-6 rounded-[2.5rem]">
              <div className="w-14 h-14 bg-foreground/5 rounded-2xl flex items-center justify-center border border-foreground/10">
                <Zap className="w-8 h-8" style={{ color: ACCENT_COLOR }} />
              </div>
              <h5 className="text-xl font-black text-foreground uppercase tracking-tight">Production Advance</h5>
              <p className="text-sm text-foreground/40 leading-relaxed font-medium">Scan a garment's unique QR code to move it from 'Stitching' to 'Quality Check' in one tap. No typing required.</p>
            </div>
            <div className="glass p-8 border-foreground/5 space-y-6 rounded-[2.5rem]">
              <div className="w-14 h-14 bg-foreground/5 rounded-2xl flex items-center justify-center border border-foreground/10">
                <Search className="w-8 h-8 text-blue-400" />
              </div>
              <h5 className="text-xl font-black text-foreground uppercase tracking-tight">Instant Lookup</h5>
              <p className="text-sm text-foreground/40 leading-relaxed font-medium">Scan any tag in the warehouse to see its current stock across all sizes, cost price, and active order history.</p>
            </div>
          </div>

          <TipBox>
            For bulk dispatching, use the scanner to scan 50+ packages in minutes to update them all to 'Shipped' status.
          </TipBox>

          <div className="p-8 bg-foreground/5 rounded-3xl border border-foreground/5 space-y-4">
            <h5 className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: ACCENT_COLOR }}>Hardware Troubleshooting</h5>
            <p className="text-xs text-foreground/40 leading-relaxed font-medium">If the camera won't start, ensure you have granted 'Camera Permissions' to the browser. In low light, use the manual 'Enter Code' feature available at the bottom of the scanner UI.</p>
          </div>
        </div>
      );

    case "inventory":
      return (
        <div className="space-y-10">
          <p className="text-lg">Zica Bella uses a <strong>Multi-Variant Inventory System</strong>. Every garment is tracked by its unique SKU (Stock Keeping Unit).</p>

          <DosAndDonts 
            dos={["Log reasons for every stock adjustment.", "Conduct a physical audit every 30 days."]}
            donts={["Delete products to 'fix' counts.", "Skip adding sizes for new products."]}
          />

          <div className="space-y-6">
            <h4 className="text-foreground text-sm font-black uppercase tracking-widest">Inventory Hierarchy</h4>
            <div className="p-8 glass rounded-[2.5rem] border-foreground/5 space-y-6">
              <div className="flex items-center gap-6">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: ACCENT_COLOR }} />
                <span className="text-sm font-black uppercase tracking-widest text-foreground">Product Type</span>
                <span className="text-[10px] text-foreground/20 font-medium">(e.g., Silk Dress)</span>
              </div>
              <div className="ml-10 flex items-center gap-6 border-l border-foreground/10 pl-6 py-2">
                <div className="w-3 h-3 rounded-full bg-foreground/20" />
                <span className="text-sm font-bold text-foreground">Color Variant</span>
                <span className="text-[10px] text-foreground/20 font-medium">(e.g., Midnight Blue)</span>
              </div>
              <div className="ml-20 flex items-center gap-6 border-l border-foreground/10 pl-6 py-2">
                <div className="w-2 h-2 rounded-full bg-foreground/10" />
                <span className="text-sm text-foreground/50">Size Variant</span>
                <span className="text-[10px] text-foreground/10 font-medium">(S, M, L, XL, XXL)</span>
              </div>
            </div>
          </div>

          <StepList steps={[
            "Audit Stock: Use 'Export CSV' for physical month-end counts.",
            "Adjustments: Log reason (Damaged, Sampling, Return to Vendor).",
            "Thresholds: Set 'Low Stock' triggers to prevent production stops.",
            "Visuals: High-res images sync automatically to Shopify storefront."
          ]} />
        </div>
      );

    case "tasks":
      return (
        <div className="space-y-8">
          <p>The <strong>Team Kanban</strong> board. Every operational bottleneck is represented here as a task.</p>
          
          <DosAndDonts 
            dos={["Assign a clear owner to every task.", "Mark as 'In Progress' when starting."]}
            donts={["Leave urgent tasks unassigned.", "Duplicate a task for the same issue."]}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 glass rounded-[2rem] border-l-8 border-foreground/10">
              <h6 className="text-[10px] font-black uppercase mb-3 tracking-widest text-foreground">Backlog</h6>
              <p className="text-xs text-foreground/30 font-medium">Automated alerts and low priority ideas.</p>
            </div>
            <div className="p-6 glass rounded-[2rem] border-l-8" style={{ borderColor: ACCENT_COLOR }}>
              <h6 className="text-[10px] font-black uppercase mb-3 tracking-widest" style={{ color: ACCENT_COLOR }}>Active</h6>
              <p className="text-xs text-foreground/30 font-medium">What the team is working on right now.</p>
            </div>
            <div className="p-6 glass rounded-[2rem] border-l-8 border-green-500">
              <h6 className="text-[10px] font-black uppercase mb-3 tracking-widest text-green-500">Done</h6>
              <p className="text-xs text-foreground/30 font-medium">Completed and archived history.</p>
            </div>
          </div>

          <div className="space-y-6 pt-6">
            <ListItem num="PRI" title="Priority System" text="Urgent tasks (Red) send push notifications to assignees. Low priority tasks stay in the backlog." />
            <ListItem num="TAG" title="Smart Tags" text="Tasks are automatically tagged by department (Fabric, Tailoring, Logistics) based on their origin." />
            <ListItem num="LNK" title="Dependencies" text="Link tasks to Order IDs so customer support knows exactly why a shipment might be delayed." />
          </div>
        </div>
      );

    case "production":
      return (
        <div className="space-y-10">
          <p className="text-lg">The <strong>Manufacturing Pipeline</strong>. This tracks the movement from raw fabric to a finished luxury garment.</p>

          <div className="relative py-6">
            <div className="flex items-center gap-4 overflow-x-auto pb-6 no-scrollbar">
              {["Ready", "Cutting", "Stitching", "Printing", "Embroidery", "Wash", "QC", "Dispatch"].map((s, i) => (
                <div key={s} className="flex items-center gap-4 shrink-0">
                  <div className="px-6 py-3 glass border border-foreground/10 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-foreground">{s}</div>
                  {i < 7 && <ChevronRight className="w-4 h-4 text-foreground/10" />}
                </div>
              ))}
            </div>
          </div>

          <DosAndDonts 
            dos={["Scan at every workstation.", "Flag defects in the 'Wash' stage."]}
            donts={["Skip the 'Wash' stage to save time.", "Dual entries for the same garment."]}
          />

          <div className="space-y-6">
            <h4 className="text-foreground text-sm font-black uppercase tracking-widest underline underline-offset-[12px]" style={{ textDecorationColor: ACCENT_COLOR }}>Operational Procedures</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
              <ListItemSmall title="Stage Gating" text="An item cannot move to 'QC' unless it has passed through 'Wash'. The system enforces this sequence." />
              <ListItemSmall title="Rework Protocol" text="If QC fails, the item moves to 'Returned'. This alerts the floor manager for immediate correction." />
              <ListItemSmall title="Efficiency Audit" text="We log hours spent in each stage. This helps identify which step is the current bottleneck." />
              <ListItemSmall title="Worker Logs" text="Every state change is logged to the worker who scanned the item for payroll accuracy." />
            </div>
          </div>

          <TipBox>
            View the 'Worker Leaderboard' in Analytics to see who has the highest output with the lowest QC failure rates.
          </TipBox>
        </div>
      );

    case "products":
      return (
        <div className="space-y-10">
          <p className="text-foreground">The <strong>Catalog Engine</strong>. This is where you define the Zica Bella brand identity through product listings.</p>

          <DosAndDonts 
            dos={["Upload at least 4 high-res angles.", "Use consistent naming (e.g., [Fabric] [Style] [Color])."]}
            donts={["Use stock photos without editing.", "Forget to sync with Shopify after price changes."]}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <ListItem num="01" title="Shopify Bridge" text="Update a price here, and it updates on zicabella.com instantly. One source of truth." />
            <ListItem num="02" title="SEO Framework" text="Product descriptions are indexed by Google. Ensure high-traffic keywords are used in titles." />
            <ListItem num="03" title="Collections" text="Group products into 'Summer 2026' or 'Bridal Couture' for the mobile app featured carousels." />
            <ListItem num="04" title="Archiving" text="Never delete old styles. Archive them to preserve historical sales data for better year-on-year forecasting." />
          </div>
        </div>
      );

    case "vendors":
      return (
        <div className="space-y-8">
          <p className="text-foreground">Manage your <strong>Supply Chain</strong>. From boutique fabric mills to international logistics partners.</p>
          
          <DosAndDonts 
            dos={["Update payment terms for new vendors.", "Grade vendors after every 5 shipments."]}
            donts={["Keep active vendors without contact info.", "Ignore partial delivery flags."]}
          />

          <div className="space-y-6">
            <div className="p-8 glass rounded-[2.5rem] border-foreground/5 space-y-6">
              <ListItemSmall title="Purchase Orders" text="Generate professional PDF POs directly and email them in one click." />
              <ListItemSmall title="Credit Terms" text="Track 'Net 30' or 'Pre-paid' terms to manage cash flow effectively." />
              <ListItemSmall title="Quality Scoring" text="Grade vendors based on raw material quality and punctuality." />
            </div>
          </div>

          <WarningBox>
            Before paying a vendor, ensure all items from the last PO are marked as 'Received' in the inventory module. Discrepancies cause ledger errors.
          </WarningBox>
        </div>
      );

    case "ledger":
      return (
        <div className="space-y-10">
          <p className="text-lg text-foreground">The <strong>Financial Heart</strong>. Every expense must be logged to calculate the 'True Cost' of our garments.</p>

          <DosAndDonts 
            dos={["Link costs to an Order or Vendor.", "Log costs on the same day they occur."]}
            donts={["Use 'Miscellaneous' for major costs.", "Duplicate entries for monthly overheads."]}
          />

          <div className="p-10 glass rounded-[3rem] border-foreground/5 space-y-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <Coins className="w-32 h-32 text-foreground" style={{ color: ACCENT_COLOR }} />
            </div>
            <h5 className="font-black text-foreground text-xl uppercase tracking-tight flex items-center gap-4">
              <Zap className="w-6 h-6" style={{ color: ACCENT_COLOR }} /> 
              The Profit Trap
            </h5>
            <p className="text-sm text-foreground/50 leading-relaxed font-medium max-w-xl">
              If you miss logging costs like thread, high-end packaging, or last-mile shipping, your 'Profit' metrics will be dangerously inflated. Accuracy here is non-negotiable.
            </p>
          </div>

          <StepList steps={[
            "Fabric Costs: Link purchase costs to specific product SKUs.",
            "Labor Costs: Log stitching and embroidery charges per garment.",
            "Overheads: Add monthly rent, electricity, and software fees.",
            "No Anonymous Edits: Every entry is tied to a specific admin login."
          ]} />
        </div>
      );

    case "analytics":
      return (
        <div className="space-y-10">
          <p className="text-foreground">Turn raw data into <strong>Business Growth</strong>. High-level insights for management and strategy.</p>
          
          <DosAndDonts 
            dos={["Export reports for board meetings.", "Analyze top-returned products monthly."]}
            donts={["Base decisions on a 1-day sample.", "Ignore production bottleneck charts."]}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-8 glass rounded-[2.5rem] border border-foreground/10 space-y-4">
              <h6 className="font-black text-foreground uppercase tracking-widest text-xs">Best Sellers</h6>
              <p className="text-sm text-foreground/40 leading-relaxed font-medium">Identifies trending sizes and colors to optimize the next production batch.</p>
            </div>
            <div className="p-8 glass rounded-[2.5rem] border border-foreground/10 space-y-4">
              <h6 className="font-black text-foreground uppercase tracking-widest text-xs">Churn Analysis</h6>
              <p className="text-sm text-foreground/40 leading-relaxed font-medium">Tracks returns to identify sizing issues or fabric quality complaints early.</p>
            </div>
          </div>

          <TipBox>
            Export the 'End of Month' report to PDF. It's designed for leadership meetings, summarizing revenue, costs, and growth in one page.
          </TipBox>
        </div>
      );

    case "settings":
      return (
        <div className="space-y-10">
          <p className="text-foreground">The <strong>System Brain</strong>. Configuration, security, and integration controls.</p>

          <DosAndDonts 
            dos={["Review user access logs weekly.", "Update store details during sales events."]}
            donts={["Leave Shopify API keys in public view.", "Disable webhooks without permission."]}
          />

          <div className="space-y-6">
            <div className="flex gap-8 p-8 glass rounded-[2.5rem] border-foreground/5">
              <div className="w-14 h-14 bg-foreground/5 rounded-2xl flex items-center justify-center shrink-0 border border-foreground/10">
                <Settings className="w-6 h-6 text-foreground/20" />
              </div>
              <div className="space-y-2">
                <p className="font-black text-foreground uppercase tracking-tight">Access Control (RBAC)</p>
                <p className="text-sm text-foreground/40 leading-relaxed font-medium">Limit warehouse staff to 'Scanner' and 'Tasks' while keeping financial data for 'Super Admins' only.</p>
              </div>
            </div>
            <div className="flex gap-8 p-8 glass rounded-[2.5rem] border-foreground/5">
              <div className="w-14 h-14 bg-foreground/5 rounded-2xl flex items-center justify-center shrink-0 border border-foreground/10">
                <Zap className="w-6 h-6" style={{ color: ACCENT_COLOR }} />
              </div>
              <div className="space-y-2">
                <p className="font-black text-foreground uppercase tracking-tight">Shopify API Webhooks</p>
                <p className="text-sm text-foreground/40 leading-relaxed font-medium">Manage the triggers that update our dashboard instantly when a customer buys something on the main site.</p>
              </div>
            </div>
            <div className="flex gap-8 p-8 glass rounded-[2.5rem] border-foreground/5">
              <div className="w-14 h-14 bg-foreground/5 rounded-2xl flex items-center justify-center shrink-0 border border-foreground/10">
                <ExternalLink className="w-6 h-6 text-foreground/20" />
              </div>
              <div className="space-y-2">
                <p className="font-black text-foreground uppercase tracking-tight">Immutable Audit Log</p>
                <p className="text-sm text-foreground/40 leading-relaxed font-medium">A permanent record of every single change made in the dashboard for high-security compliance.</p>
              </div>
            </div>
          </div>
        </div>
      );

    default:
      return <p className="text-foreground">Section content coming soon...</p>;
  }
}

// --- Helper Components ---

function InfoCard({ title, desc, icon: Icon }: { title: string, desc: string, icon: any }) {
  return (
    <div className="p-8 glass rounded-[2.5rem] border border-foreground/5 space-y-4 hover:bg-foreground/5 transition-all group">
      <div className="flex items-center gap-4">
        <Icon className="w-5 h-5 group-hover:scale-110 transition-transform" style={{ color: ACCENT_COLOR }} />
        <span className="font-black text-foreground uppercase tracking-widest text-xs">{title}</span>
      </div>
      <p className="text-sm leading-relaxed text-foreground/30 font-medium">{desc}</p>
    </div>
  );
}

function ListItem({ num, title, text }: { num: string, title: string, text: string }) {
  return (
    <div className="flex gap-6 group">
      <span className="font-black text-2xl opacity-10 group-hover:opacity-100 transition-opacity" style={{ color: ACCENT_COLOR }}>{num}</span>
      <div className="space-y-2">
        <h5 className="font-black text-foreground text-base uppercase tracking-tight">{title}</h5>
        <p className="text-sm leading-relaxed text-foreground/40 font-medium">{text}</p>
      </div>
    </div>
  );
}

function ListItemSmall({ title, text }: { title: string, text: string }) {
  return (
    <div className="space-y-2">
      <h6 className="font-black text-foreground text-xs uppercase tracking-widest">{title}</h6>
      <p className="text-xs text-foreground/40 leading-relaxed font-medium">{text}</p>
    </div>
  );
}

function StatusBox({ status, desc, color = "green" }: { status: string, desc: string, color?: string }) {
  const colors: Record<string, string> = {
    green: "border-green-500/20 bg-green-500/5 text-green-500",
    orange: "border-orange-500/20 bg-orange-500/5 text-orange-500",
    purple: "border-purple-500/20 bg-purple-500/5 text-purple-500",
    cyan: "border-cyan-500/20 bg-cyan-500/5 text-cyan-500",
  };

  return (
    <div className={`p-6 rounded-3xl border ${colors[color]} space-y-3`}>
      <span className="text-[10px] font-black uppercase tracking-[0.2em]">{status}</span>
      <p className="text-[11px] leading-snug font-bold opacity-70">{desc}</p>
    </div>
  );
}

function TipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-8 rounded-[2.5rem] glass border-l-8 flex gap-6 my-10 relative overflow-hidden group" style={{ borderLeftColor: ACCENT_COLOR }}>
      <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:scale-150 transition-transform duration-1000">
        <Lightbulb className="w-32 h-32 text-foreground" />
      </div>
      <Lightbulb className="w-8 h-8 shrink-0 mt-1" style={{ color: ACCENT_COLOR }} />
      <div className="text-base lg:text-lg text-foreground/70 font-bold leading-relaxed italic relative z-10">{children}</div>
    </div>
  );
}

function WarningBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-8 rounded-[2.5rem] glass border-l-8 border-red-500/50 flex gap-6 my-10 bg-red-500/5">
      <AlertTriangle className="w-8 h-8 text-red-500 shrink-0 mt-1" />
      <div className="text-base text-foreground/70 font-bold leading-relaxed relative z-10">{children}</div>
    </div>
  );
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-10">
      {steps.map((step, i) => (
        <div key={i} className="p-6 glass rounded-3xl flex gap-6 hover:bg-foreground/5 transition-all border border-foreground/5 group">
          <div className="flex-shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center text-[11px] font-black group-hover:scale-110 transition-transform" style={{ backgroundColor: "rgba(var(--foreground),0.05)", color: ACCENT_COLOR }}>
            {i + 1}
          </div>
          <p className="text-sm text-foreground/50 leading-relaxed font-bold pt-2">{step}</p>
        </div>
      ))}
    </div>
  );
}

function DosAndDonts({ dos, donts }: { dos: string[], donts: string[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-8">
      <div className="glass p-6 rounded-[2rem] border border-green-500/10 bg-green-500/[0.02]">
        <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-green-500 mb-4 flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5" /> Module Best Practices
        </h5>
        <ul className="space-y-2">
          {dos.map((doItem, i) => (
            <li key={i} className="text-xs text-foreground/60 font-medium flex gap-2">
              <span className="text-green-500">•</span> {doItem}
            </li>
          ))}
        </ul>
      </div>
      <div className="glass p-6 rounded-[2rem] border border-red-500/10 bg-red-500/[0.02]">
        <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-red-500 mb-4 flex items-center gap-2">
          <XCircle className="w-3.5 h-3.5" /> Common Mistakes
        </h5>
        <ul className="space-y-2">
          {donts.map((dontItem, i) => (
            <li key={i} className="text-xs text-foreground/60 font-medium flex gap-2">
              <span className="text-red-500">•</span> {dontItem}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
