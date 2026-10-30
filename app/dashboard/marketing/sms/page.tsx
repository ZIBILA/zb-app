"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Send, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function SMSHubPage() {
  const [body, setBody] = useState("");
  const [targetAudience, setTargetAudience] = useState("all");
  const [templateId, setTemplateId] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const res = await fetch("/api/marketing/send-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "sms",
          targetAudience,
          messageBody: body,
          templateId: templateId || undefined
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(`Success! SMS queued for ${data.sent} customers.`);
        setBody("");
        setTemplateId("");
      } else {
        toast.error(data.error || "Failed to send SMS campaign.");
      }
    } catch (err) {
      toast.error("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SMS Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage transactional and marketing SMS</p>
        </div>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex gap-3 mb-6 text-amber-600">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <div className="text-sm">
          <span className="font-semibold block mb-1">DLT Registration Required</span>
          SMS marketing in India requires mandatory DLT registration. Ensure your message templates are approved on your DLT portal before sending bulk campaigns to avoid delivery failures.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <form onSubmit={handleSend} className="space-y-5">
            <div>
              <label className="text-xs font-semibold tracking-wider text-foreground/50 uppercase mb-2 block">
                Target Audience
              </label>
              <select
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-3 outline-none focus:border-foreground/30 transition-colors appearance-none"
              >
                <option value="all">All Subscribers</option>
                <option value="vip">VIP Customers (&gt;2 orders)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold tracking-wider text-foreground/50 uppercase mb-2 block">
                DLT Template ID (Optional)
              </label>
              <input
                type="text"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                placeholder="120516... (Leave blank if using US numbers)"
                className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-3 outline-none focus:border-foreground/30 transition-colors"
              />
            </div>

            <div>
              <label className="text-xs font-semibold tracking-wider text-foreground/50 uppercase mb-2 block">
                SMS Message
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Zica Bella: The new Drop is Live. Shop now at [URL]"
                rows={5}
                className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-3 outline-none focus:border-foreground/30 transition-colors resize-none"
                required
              />
              <div className="text-right mt-1">
                <span className={`text-[10px] font-medium ${body.length > 160 ? 'text-rose-500' : 'text-foreground/40'}`}>
                  {body.length} / 160 characters
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-4 bg-foreground text-background font-medium py-3 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
            >
              {loading ? (
                <span className="animate-pulse">Queuing Messages...</span>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Launch SMS Campaign</span>
                </>
              )}
            </button>
          </form>
        </motion.div>

        {/* Live Preview */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-6 flex flex-col items-center justify-center bg-gradient-to-br from-background to-purple-500/5">
          <div className="w-[280px] h-[550px] border-[8px] border-foreground/10 rounded-[3rem] relative bg-background shadow-2xl flex flex-col overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-6 bg-foreground/10 z-10 rounded-t-3xl" />
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-6 bg-black rounded-full z-20" />

            <div className="flex-1 bg-gradient-to-b from-purple-900/10 to-background pt-16 px-4 flex flex-col">
              <div className="text-center mb-6">
                <div className="w-12 h-12 rounded-full bg-foreground/10 flex items-center justify-center mx-auto mb-2">
                  <span className="text-[12px] font-bold">ZB</span>
                </div>
                <h3 className="text-xs font-semibold">Zica Bella</h3>
              </div>

              {body && (
                <div className="bg-foreground text-background p-3.5 rounded-2xl rounded-tr-sm shadow-md text-sm self-end max-w-[85%] whitespace-pre-wrap">
                  {body}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
