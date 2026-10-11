"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { 
  Send, User, Plus, Image as ImageIcon, X, Heart, SmilePlus,
  ArrowLeft, ChevronDown
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface ChatMessage {
  id: string;
  content: string;
  imageUrl?: string;
  createdAt: string;
  customer: {
    id: string;
    name: string;
    image?: string;
  };
  reactions: {
    id: string;
    emoji: string;
    customerId: string;
  }[];
}

const REACTION_EMOJIS = ["❤️", "🔥", "👏", "✨", "💯", "😍"];

export default function ChatPage() {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showImageInput, setShowImageInput] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [activeReactionMsg, setActiveReactionMsg] = useState<string | null>(null);
  const [profileCard, setProfileCard] = useState<ChatMessage["customer"] | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);
  const forceScrollRef = useRef(true); // initial load + after send
  const prevCountRef = useRef(0);
  const [unreadWhileUp, setUnreadWhileUp] = useState(0);

  const customerId = (session as any)?.customer?.id;
  const userEmail = session?.user?.email || (session as any)?.customer?.email;

  const NEAR_BOTTOM_PX = 120;

  const measureNearBottom = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const container = chatContainerRef.current;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    } else {
      chatEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    }
    isNearBottomRef.current = true;
    setShowScrollBtn(false);
    setUnreadWhileUp(0);
  }, []);

  const messagesFingerprint = (list: ChatMessage[]) =>
    list
      .map((m) => `${m.id}:${m.reactions.map((r) => r.id).join(",")}`)
      .join("|");

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch('/api/community/chat');
      const data = await res.json();
      const next: ChatMessage[] = data.messages || [];
      setMessages((prev) => {
        if (messagesFingerprint(prev) === messagesFingerprint(next)) return prev;
        return next;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchMessages();
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Auto-scroll only on first load, after the user sends, or when already near the bottom.
  // Polling must never yank the viewport while reading older messages.
  useEffect(() => {
    const prevCount = prevCountRef.current;
    const grew = messages.length > prevCount;
    prevCountRef.current = messages.length;

    if (messages.length === 0) return;

    if (forceScrollRef.current) {
      forceScrollRef.current = false;
      // Instant on first paint; smooth after send.
      scrollToBottom(prevCount > 0);
      return;
    }

    if (grew && isNearBottomRef.current) {
      scrollToBottom(true);
      return;
    }

    if (grew && !isNearBottomRef.current) {
      setUnreadWhileUp((n) => n + (messages.length - prevCount));
      setShowScrollBtn(true);
    }
  }, [messages, scrollToBottom]);

  // Track scroll position for "scroll to bottom" button
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const near = measureNearBottom();
      isNearBottomRef.current = near;
      setShowScrollBtn(!near);
      if (near) setUnreadWhileUp(0);
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [measureNearBottom, loading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !imageUrl) || !userEmail) return;

    setSending(true);
    const content = input;
    const img = imageUrl;
    setInput("");
    setImageUrl("");
    setShowImageInput(false);

    try {
      const res = await fetch('/api/community/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, content, imageUrl: img || undefined })
      });
      
      if (res.ok) {
        forceScrollRef.current = true;
        fetchMessages();
      } else {
        const data = await res.json();
        setInput(content);
        alert(data.error || "Failed to send");
      }
    } catch (e) {
      setInput(content);
    } finally {
      setSending(false);
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    if (!userEmail) return;
    setActiveReactionMsg(null);

    try {
      await fetch('/api/community/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, messageId, emoji })
      });
      // Keep reading position — reaction updates must not jump the thread.
      fetchMessages();
    } catch (e) {
      console.error(e);
    }
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Group messages by date
  const groupedMessages: { date: string; msgs: ChatMessage[] }[] = [];
  messages.forEach((msg) => {
    const date = formatDate(msg.createdAt);
    const lastGroup = groupedMessages[groupedMessages.length - 1];
    if (lastGroup && lastGroup.date === date) {
      lastGroup.msgs.push(msg);
    } else {
      groupedMessages.push({ date, msgs: [msg] });
    }
  });

  return (
    <main className="fixed inset-0 z-[60] bg-[#F2F2F7] dark:bg-black text-black dark:text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 z-30 pt-[env(safe-area-inset-top)] bg-white/80 dark:bg-black/80 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
        <div className="max-w-xl mx-auto flex items-center justify-between px-5 h-14">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-1 -ml-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5 text-[#007AFF]" />
            </Link>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight">Community</h1>
              <p className="text-[11px] text-[#8E8E93] font-medium">
                {messages.length} messages
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#34C759]/10">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34C759] animate-pulse" />
            <span className="text-[9px] font-bold text-[#34C759] uppercase tracking-widest">Live</span>
          </div>
        </div>
      </div>

      {/* Messages Area — must be the only scrollport so polls never yank the page */}
      <div 
        ref={chatContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-4 pb-36"
        onClick={() => setActiveReactionMsg(null)}
      >
        <div className="max-w-xl mx-auto space-y-1">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-6 h-6 border-2 border-[#007AFF]/20 border-t-[#007AFF] rounded-full animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-[#8E8E93]">
              <div className="w-16 h-16 rounded-full bg-[#007AFF]/10 flex items-center justify-center mb-4">
                <Send className="w-6 h-6 text-[#007AFF]" />
              </div>
              <p className="text-[14px] font-semibold">No messages yet</p>
              <p className="text-[12px] mt-1">Be the first to share your look!</p>
            </div>
          ) : (
            groupedMessages.map((group) => (
              <div key={group.date}>
                {/* Date Separator */}
                <div className="flex justify-center my-4">
                  <span className="px-3 py-1 rounded-full bg-black/5 dark:bg-white/5 text-[10px] font-semibold text-[#8E8E93] uppercase tracking-wider">
                    {group.date}
                  </span>
                </div>

                {group.msgs.map((msg) => {
                  const isMe = msg.customer.id === customerId;
                  const reactionCounts: Record<string, { count: number; hasOwn: boolean }> = {};
                  msg.reactions.forEach((r) => {
                    if (!reactionCounts[r.emoji]) reactionCounts[r.emoji] = { count: 0, hasOwn: false };
                    reactionCounts[r.emoji].count++;
                    if (r.customerId === customerId) reactionCounts[r.emoji].hasOwn = true;
                  });

                  return (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={msg.id}
                      className={`flex gap-2 mb-3 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                      {/* Avatar */}
                      {!isMe && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setProfileCard(msg.customer); }}
                          className="flex-shrink-0 mt-auto mb-6"
                        >
                          <div className="w-7 h-7 rounded-full bg-white dark:bg-[#1C1C1E] border border-black/5 dark:border-white/10 flex items-center justify-center overflow-hidden shadow-sm">
                            {msg.customer.image ? (
                              <img src={msg.customer.image} alt={msg.customer.name} className="w-full h-full object-cover" />
                            ) : (
                              <img 
                                src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${msg.customer.name}`} 
                                className="w-full h-full rounded-full" 
                                alt={msg.customer.name}
                              />
                            )}
                          </div>
                        </button>
                      )}

                      <div className={`flex flex-col gap-0.5 max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                        {!isMe && (
                          <span className="text-[10px] font-semibold text-[#8E8E93] px-2 mb-0.5">{msg.customer.name}</span>
                        )}
                        
                        {/* Message Bubble */}
                        <div
                          className="relative group"
                          onDoubleClick={() => handleReaction(msg.id, '❤️')}
                          onContextMenu={(e) => { e.preventDefault(); setActiveReactionMsg(msg.id); }}
                        >
                          <div className={`relative px-3.5 py-2.5 text-[15px] leading-relaxed shadow-sm ${
                            isMe 
                            ? 'bg-[#007AFF] text-white rounded-[20px] rounded-br-[6px]' 
                            : 'bg-white dark:bg-[#1C1C1E] rounded-[20px] rounded-bl-[6px] border border-black/[0.04] dark:border-white/[0.06]'
                          }`}>
                            {msg.content && <p>{msg.content}</p>}
                            {msg.imageUrl && (
                              <img 
                                src={msg.imageUrl} 
                                alt="Shared" 
                                className="rounded-xl mt-1.5 max-w-full max-h-[240px] object-cover"
                              />
                            )}
                          </div>

                          {/* Reaction Picker */}
                          <AnimatePresence>
                            {activeReactionMsg === msg.id && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.8, y: 8 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.8, y: 8 }}
                                className={`absolute ${isMe ? 'right-0' : 'left-0'} -top-12 z-20 flex gap-1 px-2 py-1.5 bg-white dark:bg-[#2C2C2E] rounded-full shadow-2xl border border-black/10 dark:border-white/10`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {REACTION_EMOJIS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    onClick={() => handleReaction(msg.id, emoji)}
                                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 active:scale-90 transition-all text-[18px]"
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Show Reaction button on hover / tap */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setActiveReactionMsg(msg.id); }}
                            className={`absolute ${isMe ? '-left-6' : '-right-6'} top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white dark:bg-[#2C2C2E] border border-black/10 dark:border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm`}
                          >
                            <SmilePlus className="w-2.5 h-2.5 text-[#8E8E93]" />
                          </button>
                        </div>

                        {/* Reactions Display */}
                        {Object.keys(reactionCounts).length > 0 && (
                          <div className={`flex gap-1 px-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                            {Object.entries(reactionCounts).map(([emoji, { count, hasOwn }]) => (
                              <button
                                key={emoji}
                                onClick={() => handleReaction(msg.id, emoji)}
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] transition-all ${
                                  hasOwn 
                                    ? 'bg-[#007AFF]/15 border border-[#007AFF]/30' 
                                    : 'bg-black/5 dark:bg-white/5 border border-transparent'
                                }`}
                              >
                                <span>{emoji}</span>
                                {count > 1 && <span className="text-[9px] font-bold text-[#8E8E93]">{count}</span>}
                              </button>
                            ))}
                          </div>
                        )}

                        <span className="text-[9px] text-[#8E8E93] font-medium px-2">
                          {formatTime(msg.createdAt)}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Scroll to Bottom Button */}
      <AnimatePresence>
        {showScrollBtn && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => scrollToBottom(true)}
            aria-label={unreadWhileUp > 0 ? `${unreadWhileUp} new messages` : "Scroll to bottom"}
            className="fixed bottom-36 right-6 z-30 min-w-9 h-9 px-2 rounded-full bg-white dark:bg-[#2C2C2E] shadow-xl border border-black/10 dark:border-white/10 flex items-center justify-center gap-1"
          >
            <ChevronDown className="w-4 h-4 text-[#8E8E93]" />
            {unreadWhileUp > 0 && (
              <span className="text-[10px] font-bold text-[#007AFF] tabular-nums">
                {unreadWhileUp > 99 ? "99+" : unreadWhileUp}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Profile Card Modal */}
      <AnimatePresence>
        {profileCard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-8"
            onClick={() => setProfileCard(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white dark:bg-[#1C1C1E] rounded-3xl p-8 max-w-[280px] w-full text-center shadow-2xl border border-black/5 dark:border-white/5"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setProfileCard(null)}
                className="absolute top-4 right-4 w-7 h-7 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5 text-[#8E8E93]" />
              </button>
              <div className="w-20 h-20 rounded-full mx-auto mb-4 bg-[#F2F2F7] dark:bg-[#2C2C2E] overflow-hidden border-2 border-black/5 dark:border-white/5 shadow-lg">
                {profileCard.image ? (
                  <img src={profileCard.image} alt={profileCard.name} className="w-full h-full object-cover" />
                ) : (
                  <img 
                    src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${profileCard.name}`} 
                    className="w-full h-full" 
                    alt={profileCard.name}
                  />
                )}
              </div>
              <h3 className="text-[17px] font-semibold tracking-tight mb-1">{profileCard.name}</h3>
              <p className="text-[12px] text-[#8E8E93] font-medium">Community Member</p>
              <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5">
                <p className="text-[11px] text-[#8E8E93]">
                  {messages.filter(m => m.customer.id === profileCard.id).length} messages in community
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl border-t border-black/5 dark:border-white/5" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="max-w-xl mx-auto">
          {/* Image URL input */}
          <AnimatePresence>
            {showImageInput && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="px-4 pt-3 overflow-hidden"
              >
                <div className="flex items-center gap-2 p-2 bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-xl">
                  <ImageIcon className="w-4 h-4 text-[#8E8E93] flex-shrink-0 ml-1" />
                  <input
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="Paste image URL..."
                    className="flex-1 bg-transparent text-[14px] font-medium placeholder:text-[#8E8E93]/50 outline-none"
                  />
                  <button onClick={() => { setShowImageInput(false); setImageUrl(""); }} className="p-1">
                    <X className="w-3.5 h-3.5 text-[#8E8E93]" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          
          <form onSubmit={handleSend} className="flex items-center gap-2 px-4 py-3">
            <button
              type="button"
              onClick={() => setShowImageInput(!showImageInput)}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors active:scale-90 ${
                showImageInput ? 'bg-[#007AFF] text-white' : 'text-[#007AFF] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <Plus className="w-5 h-5" />
            </button>
            <div className="flex-1 relative">
              <input 
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message..."
                className="w-full bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-full px-4 py-2.5 text-[16px] font-medium placeholder:text-[#8E8E93]/50 outline-none focus:ring-2 focus:ring-[#007AFF]/20 transition-all border border-transparent focus:border-[#007AFF]/20"
              />
            </div>
            <button 
              type="submit"
              disabled={(!input.trim() && !imageUrl) || sending}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                (input.trim() || imageUrl) ? 'bg-[#007AFF] text-white shadow-sm' : 'bg-[#E9E9EB] dark:bg-white/5 text-[#C7C7CC]'
              }`}
            >
              {sending ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5 ml-0.5" />
              )}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
