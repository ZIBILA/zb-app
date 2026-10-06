"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ShieldCheck, AlertCircle, Play, Eye, ShoppingCart, 
  ShoppingBag, User, CheckCircle2, ChevronRight, HelpCircle, 
  Settings, RefreshCcw, Info, ArrowUpRight, Terminal
} from "lucide-react";
import { toast } from "sonner";

export default function MetaReviewPage() {
  const [phone, setPhone] = useState("919876543210");
  const [name, setName] = useState("Meta App Reviewer");
  const [settings, setSettings] = useState<any>({
    enable_meta_events: false,
    whatsapp_dataset_id: "",
    whatsapp_page_id: ""
  });
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [triggeringEvent, setTriggeringEvent] = useState<string | null>(null);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/whatsapp-events/settings");
        const data = await res.json();
        if (res.ok) {
          setSettings(data);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingSettings(false);
      }
    }
    loadSettings();
  }, []);

  const triggerEvent = async (eventType: string) => {
    setTriggeringEvent(eventType);
    const toastId = toast.loading(`Triggering event "${eventType}"...`);

    const logEntry: any = {
      timestamp: new Date().toLocaleTimeString(),
      eventType,
      status: "pending",
      details: `Sending request with name: "${name}", phone: "${phone}"`
    };

    setLogs(prev => [logEntry, ...prev]);

    try {
      const res = await fetch("/api/whatsapp-events/meta-review-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType,
          customerPhone: phone,
          customerName: name
        })
      });
      const data = await res.json();

      if (res.ok) {
        toast.success(`"${eventType}" triggered successfully!`, { id: toastId });
        setLogs(prev => {
          const updated = [...prev];
          updated[0].status = "success";
          updated[0].response = data;
          return updated;
        });
      } else {
        toast.error(data.error || "Failed to trigger event.", { id: toastId });
        setLogs(prev => {
          const updated = [...prev];
          updated[0].status = "failed";
          updated[0].error = data.error || "API error";
          updated[0].response = data;
          return updated;
        });
      }
    } catch (e: any) {
      toast.error("Network connection error.", { id: toastId });
      setLogs(prev => {
        const updated = [...prev];
        updated[0].status = "failed";
        updated[0].error = e.message || "Network error";
        return updated;
      });
    } finally {
      setTriggeringEvent(null);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    toast.success("Simulation console logs cleared.");
  };

  const simulationActions = [
    {
      name: "Product Viewed",
      description: "Simulates a user landing on a PDP (Product Details Page). Logs item name and categories.",
      icon: Eye,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20"
    },
    {
      name: "Add To Cart",
      description: "Simulates adding a product item to the checkout cart. Tracks quantity, sizes, and pricing metrics.",
      icon: ShoppingCart,
      color: "text-violet-500",
      bg: "bg-violet-500/10",
      border: "border-violet-500/20"
    },
    {
      name: "Purchase Completed",
      description: "Simulates completing payment successfully. Fires conversions analytics & updates revenue tracking.",
      icon: ShoppingBag,
      color: "text-teal-500",
      bg: "bg-teal-500/10",
      border: "border-teal-500/20"
    },
    {
      name: "Lead Created",
      description: "Simulates customer signups, mobileOTP verification, or ad campaign opt-in leads.",
      icon: User,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meta Review Simulation Panel</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sandbox tool to simulate storefront conversions and review server responses.
          </p>
        </div>

        <div className="flex items-center gap-2.5 bg-foreground/5 px-4 py-2 rounded-xl border border-foreground/10">
          <ShieldCheck className={`w-5 h-5 ${settings.enable_meta_events ? "text-emerald-500" : "text-amber-500"}`} />
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-foreground/90 uppercase tracking-wide">Meta Hook Config</span>
            <span className="text-[10px] text-muted-foreground">
              {loadingSettings ? "Loading..." : settings.enable_meta_events ? "Sync Forwarding Active" : "Local Sync Only"}
            </span>
          </div>
        </div>
      </div>

      {/* Meta App Review Guidelines Card */}
      <div className="bg-gradient-to-r from-violet-500/10 to-indigo-500/10 border border-violet-500/20 rounded-2xl p-5 space-y-3 flex items-start gap-4">
        <div className="p-3 bg-violet-500/20 text-violet-400 rounded-xl shrink-0 mt-0.5">
          <Info className="w-5 h-5 animate-pulse" />
        </div>
        <div className="space-y-2">
          <h2 className="font-bold text-base text-foreground/90">Meta App Review Instructions</h2>
          <p className="text-sm text-foreground/80 leading-relaxed">
            Use this panel to simulate user activity for the <strong>whatsapp_business_manage_events</strong> app review process. 
            By triggering simulated events below, you can record demo videos proving the platform tracks conversions, formats them to the Conversions API standards, and logs responses securely in real-time.
          </p>
          <div className="flex flex-wrap gap-4 pt-1">
            <a 
              href="/dashboard/whatsapp-events/events" 
              target="_blank" 
              className="flex items-center gap-1 text-xs text-violet-400 font-bold hover:underline"
            >
              <span>Open Events Feed in new tab</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
            <a 
              href="/dashboard/whatsapp-events/customer-journeys" 
              target="_blank" 
              className="flex items-center gap-1 text-xs text-violet-400 font-bold hover:underline"
            >
              <span>Open Customer Journeys timeline</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Input Overrides for Reviewers */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="font-semibold text-base border-b border-foreground/5 pb-2.5">
          Reviewer Simulation Details
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground/60 uppercase block">Simulator Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Meta Reviewer"
              className="glass-input w-full"
            />
            <p className="text-[10px] text-muted-foreground">Mock customer name assigned to events.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground/60 uppercase block">Simulator Phone Number</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 919876543210"
              className="glass-input w-full"
            />
            <p className="text-[10px] text-muted-foreground">Must be a valid digits string. Used for hashing comparisons in Conversions API payloads.</p>
          </div>
        </div>
      </div>

      {/* Action Simulation Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Event Simulator List */}
        <div className="space-y-4">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Play className="w-4 h-4 text-emerald-500" />
            <span>Interactive Simulator</span>
          </h3>

          <div className="space-y-4">
            {simulationActions.map((action) => {
              const ActionIcon = action.icon;
              const isPending = triggeringEvent === action.name;
              return (
                <div 
                  key={action.name}
                  className="glass-card p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-foreground/15 transition-all"
                >
                  <div className="flex items-start gap-3.5">
                    <div className={`p-3 rounded-xl ${action.bg} ${action.color} ${action.border} shrink-0 mt-0.5`}>
                      <ActionIcon className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-bold text-sm text-foreground/90">{action.name}</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">{action.description}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => triggerEvent(action.name)}
                    disabled={triggeringEvent !== null}
                    className="glass-cta py-2 text-xs font-bold shrink-0 w-full sm:w-auto text-center"
                  >
                    {isPending ? "Simulating..." : "Trigger Event"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Console / Response Logger Panel */}
        <div className="space-y-4 flex flex-col h-full">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold text-base flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-500" />
              <span>Simulation Console Log</span>
            </h3>
            
            {logs.length > 0 && (
              <button 
                onClick={clearLogs}
                className="text-xs text-rose-400 hover:text-rose-500 font-semibold"
              >
                Clear Console
              </button>
            )}
          </div>

          <div className="flex-1 bg-black/40 border border-foreground/10 rounded-2xl p-5 font-mono text-[11px] leading-relaxed overflow-y-auto max-h-[500px] min-h-[300px] custom-scrollbar text-emerald-300">
            {logs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center text-muted-foreground p-8">
                <div>
                  <Terminal className="w-6 h-6 mx-auto mb-2 text-foreground/20 animate-pulse" />
                  <p>Console Idle. Trigger an event on the left to see payload sync details in real-time.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {logs.map((log, idx) => (
                  <div key={idx} className="border-b border-foreground/5 pb-3 last:border-b-0 last:pb-0">
                    <div className="flex justify-between items-center text-muted-foreground mb-1">
                      <span>[{log.timestamp}] Event Simulation</span>
                      <span className={`px-1.5 py-0.2 rounded font-bold capitalize ${
                        log.status === "success" ? "bg-emerald-500/25 text-emerald-400" :
                        log.status === "failed" ? "bg-rose-500/25 text-rose-400" :
                        "bg-amber-500/25 text-amber-400 animate-pulse"
                      }`}>
                        {log.status}
                      </span>
                    </div>

                    <p className="text-foreground/90 font-bold mb-1">Type: {log.eventType}</p>
                    <p className="text-muted-foreground mb-2">{log.details}</p>

                    {log.error && (
                      <p className="text-rose-400 font-bold mb-2">Error: {log.error}</p>
                    )}

                    {log.response && (
                      <pre className="bg-black/60 p-3 rounded-lg border border-foreground/5 overflow-x-auto text-[10px] text-emerald-400 max-h-48 custom-scrollbar">
                        {JSON.stringify(log.response, null, 2)}
                      </pre>
                    )}
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
