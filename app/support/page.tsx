'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense, memo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Mail,
  MapPin,
  Send,
  MessageSquare,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  Clock,
  HelpCircle,
  FileText,
  ChevronRight,
  Headphones,
  Sparkles
} from 'lucide-react';

/* ──────────────────────────────────────────────
   Performance Notes:
   - Removed framer-motion entirely → saves ~40KB from bundle
   - CSS animations used instead (GPU-accelerated, no JS overhead)
   - Reduced backdrop-filter blur on mobile (28px → 16px)
   - Background blobs only animate on desktop (prefers-reduced-motion aware)
   - Optimistic UI for instant chat feedback
   - will-change hints for scroll containers
   ────────────────────────────────────────────── */

function getStoredClientGeo() {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem('zb_geo_data');
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/* ──────────────────────────────────────────────
   Quick Action Card Component (memoized)
   ────────────────────────────────────────────── */
const QuickActionCard = memo(function QuickActionCard({ icon: Icon, title, subtitle, onClick }: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="support-quick-action w-full p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/5 hover:bg-foreground/[0.05] hover:border-foreground/10 transition-all duration-300 text-left group active:scale-[0.98]"
    >
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/5 text-foreground/50 group-hover:text-foreground/70 transition-colors shrink-0">
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground/80 truncate">{title}</p>
          <p className="text-[10px] text-foreground/40 mt-0.5 truncate">{subtitle}</p>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-foreground/20 group-hover:text-foreground/40 group-hover:translate-x-0.5 transition-all shrink-0" />
      </div>
    </button>
  );
});

/* ──────────────────────────────────────────────
   Online Status Badge (pure CSS animation)
   ────────────────────────────────────────────── */
const OnlineStatusBadge = memo(function OnlineStatusBadge() {
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/15">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Online</span>
    </div>
  );
});

/* ──────────────────────────────────────────────
   Chat Message Bubble (memoized for list perf)
   ────────────────────────────────────────────── */
const ChatBubble = memo(function ChatBubble({ msg, index }: { msg: any; index: number }) {
  const isUser = msg.senderType === 'USER';
  const isAi = msg.senderType === 'ZICA_AI';
  const displayName = isAi ? (msg.senderName || 'Zica AI') : (msg.senderType === 'AGENT' ? (msg.senderName || 'Zica Support') : 'You');

  return (
    <div
      className={`flex support-msg-enter ${isUser ? 'justify-end' : 'justify-start'}`}
      style={{ animationDelay: `${Math.min(index * 40, 200)}ms` }}
    >
      <div className="flex flex-col gap-1 max-w-[85%] md:max-w-[80%]">
        <div className="flex items-center gap-1.5 px-1">
          {!isUser ? (
            isAi ? (
              <>
                <Sparkles className="w-3 h-3 text-purple-400 animate-pulse" />
                <span className="text-[8px] font-bold text-purple-400 uppercase tracking-widest">{displayName}</span>
              </>
            ) : (
              <>
                <span className="text-[8px] font-bold text-foreground/40 uppercase tracking-widest">{displayName}</span>
                <ShieldCheck className="w-3 h-3 text-blue-500" />
              </>
            )
          ) : (
            <span className="text-[8px] font-bold text-foreground/30 uppercase tracking-widest">You</span>
          )}
        </div>
        <div
          className={`px-3.5 py-2.5 md:px-4 md:py-3 rounded-2xl transition-colors duration-200 ${
            msg._optimistic
              ? 'bg-foreground/[0.08] text-foreground/55 border border-dashed border-foreground/15 rounded-tr-md'
              : isUser
              ? 'bg-foreground text-background rounded-tr-md font-medium'
              : isAi
              ? 'bg-purple-950/40 text-purple-100 border border-purple-500/20 rounded-tl-md font-medium'
              : 'bg-foreground text-background rounded-tl-md font-medium'
          }`}
        >
          <p className="text-[11px] md:text-xs leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
        </div>
        <p className={`text-[8px] font-bold text-foreground/20 uppercase tracking-tighter ${isUser ? 'text-right' : 'text-left'}`}>
          {msg._optimistic ? 'Sending…' : new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
});

/* ──────────────────────────────────────────────
   Main Support Page Content
   ────────────────────────────────────────────── */
function SupportPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'form' | 'chat'>('form');
  const [loading, setLoading] = useState(false);
  const [fetchingTicket, setFetchingTicket] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isMobileApp, setIsMobileApp] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);
  const forceScrollRef = useRef(true);
  const prevMsgSigRef = useRef('');
  const vvHeightRef = useRef<number | null>(null);

  const messagesSignature = useCallback((list: any[]) => {
    return list
      .map((m) => `${m.id}:${m.senderType}:${String(m.content || '').length}`)
      .join('|');
  }, []);

  const measureNearBottom = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  const scrollToBottom = useCallback((force = true) => {
    if (!force && !isNearBottomRef.current) return;
    const container = chatContainerRef.current;
    // Never use scrollIntoView — on mobile Safari it scrolls the page and causes the jump-down glitch.
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      isNearBottomRef.current = true;
    });
  }, []);

  // Trigger mount animation
  useEffect(() => {
    // Use rAF to defer mount animation to after paint — prevents jank on first load
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Consolidated init effect — single effect instead of 3 separate ones
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);

    // Detect mobile app
    if (params.get('platform') === 'mobile' || params.get('app') === 'true') {
      setIsMobileApp(true);
    }

    // Parse URL params and set tab
    const tab = params.get('tab');
    const orderId = params.get('orderId');
    if (tab === 'chat') setActiveTab('chat');

    // Store params for ticket loading
    setUrlParams({ tab, orderId });
  }, []);

  // Prefill details if user is logged in
  useEffect(() => {
    if (status === 'authenticated' && session?.user) {
      setFormData(prev => ({
        ...prev,
        name: session.user?.name || '',
        email: session.user?.email || ''
      }));
    }
  }, [status, session]);

  const [urlParams, setUrlParams] = useState<{ tab: string | null; orderId: string | null }>({ tab: null, orderId: null });

  // Load session or handle tab parameter
  useEffect(() => {
    if (status === 'authenticated' && session?.user) {
      const customerId = (session as any)?.customer?.id || (session?.user as any)?.id;
      if (customerId) {
        handleLoadOrCreateTicket(customerId, urlParams.orderId, urlParams.tab);
      }
    } else if (status === 'unauthenticated') {
      if (typeof window !== 'undefined') {
        const savedTicketId = localStorage.getItem('zb_support_ticket_id');
        if (savedTicketId) {
          fetchTicketById(savedTicketId);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session, urlParams]);

  // Fetch active messages polling for chat — with visibility check
  useEffect(() => {
    if (activeTab !== 'chat' || !ticketId) return;

    forceScrollRef.current = true;
    scrollToBottom(true);

    const poll = () => {
      if (!document.hidden) fetchMessages();
    };

    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, ticketId]);

  // Keep pin-to-bottom only when the soft keyboard opens/closes — ignore Safari URL-bar resizes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;

    vvHeightRef.current = vv.height;
    const handleResize = () => {
      if (activeTab !== 'chat' || !ticketId) return;
      const prev = vvHeightRef.current ?? vv.height;
      const next = vv.height;
      vvHeightRef.current = next;
      // Keyboard open/close is a large height change; chrome show/hide is small.
      if (Math.abs(prev - next) < 120) return;
      scrollToBottom(false);
    };

    vv.addEventListener('resize', handleResize);
    return () => vv.removeEventListener('resize', handleResize);
  }, [activeTab, ticketId, scrollToBottom]);

  // After message list updates: follow only if pinned or we just forced scroll (send / open).
  useEffect(() => {
    if (activeTab !== 'chat' || chatMessages.length === 0) return;
    const sig = messagesSignature(chatMessages);
    const changed = sig !== prevMsgSigRef.current;
    prevMsgSigRef.current = sig;
    if (!changed) return;

    if (forceScrollRef.current) {
      forceScrollRef.current = false;
      scrollToBottom(true);
      return;
    }
    if (isNearBottomRef.current) {
      scrollToBottom(true);
    }
  }, [chatMessages, activeTab, messagesSignature, scrollToBottom]);

  const fetchTicketById = async (tId: string) => {
    setFetchingTicket(true);
    try {
      const res = await fetch(`/api/support/tickets?ticketId=${tId}`);
      const data = await res.json();
      if (data.tickets && data.tickets[0]) {
        setTicketId(data.tickets[0].id);
        setChatMessages(data.tickets[0].messages || []);
      }
    } catch (e) {
      console.error('Failed to fetch ticket by ID:', e);
    } finally {
      setFetchingTicket(false);
    }
  };

  const handleLoadOrCreateTicket = async (
    customerId: string,
    orderIdParam: string | null,
    tabParam: string | null = null
  ) => {
    setFetchingTicket(true);
    try {
      const res = await fetch(`/api/support/tickets?customerId=${customerId}&status=OPEN`);
      const data = await res.json();
      if (data.tickets && data.tickets.length > 0) {
        const activeTicket = data.tickets[0];
        setTicketId(activeTicket.id);
        setChatMessages(activeTicket.messages || []);
        if (typeof window !== 'undefined') localStorage.setItem('zb_support_ticket_id', activeTicket.id);
      } else {
        const shouldAutoCreate = tabParam === 'chat' || orderIdParam || activeTab === 'chat';
        if (shouldAutoCreate) {
          const subject = orderIdParam
            ? `Order Support #${orderIdParam.slice(-8).toUpperCase()}`
            : 'Live Chat Support';

          const createRes = await fetch('/api/support/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerId,
              guestName: session?.user?.name || 'Customer',
              guestEmail: session?.user?.email || 'Logged-in User',
              subject,
              content: `Live chat session initiated by user${orderIdParam ? ` for order #${orderIdParam}` : ''}.`,
              priority: orderIdParam ? 'HIGH' : 'MEDIUM',
              clientGeo: getStoredClientGeo()
            })
          });
          const createData = await createRes.json();
          if (createRes.ok && createData.ticket) {
            setTicketId(createData.ticket.id);
            setChatMessages(createData.ticket.messages || []);
            if (typeof window !== 'undefined') localStorage.setItem('zb_support_ticket_id', createData.ticket.id);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load or create ticket:', e);
    } finally {
      setFetchingTicket(false);
    }
  };

  const fetchMessages = async () => {
    if (!ticketId) return;
    try {
      const res = await fetch(`/api/support/tickets?ticketId=${ticketId}`);
      const data = await res.json();
      if (data.tickets && data.tickets[0]) {
        const next = data.tickets[0].messages || [];
        setChatMessages((prev) => {
          const pending = prev.filter((m) => m._optimistic);
          const unresolved = pending.filter(
            (p) =>
              !next.some(
                (n: any) =>
                  n.senderType === 'USER' &&
                  n.content === p.content
              )
          );
          const merged = unresolved.length ? [...next, ...unresolved] : next;
          if (messagesSignature(prev) === messagesSignature(merged)) return prev;
          return merged;
        });
      }
    } catch {
      console.error('Failed to fetch messages');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const customerId = (session as any)?.customer?.id || (session?.user as any)?.id || null;

    try {
      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          guestName: formData.name,
          guestEmail: formData.email,
          subject: formData.subject,
          content: formData.message,
          priority: 'MEDIUM',
          clientGeo: getStoredClientGeo()
        })
      });

      const data = await res.json();
      if (res.ok) {
        setTicketId(data.ticket.id);
        setChatMessages(data.ticket.messages);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 5000);
        setActiveTab('chat');
      } else {
        alert(data.error || 'Failed to submit ticket');
      }
    } catch {
      alert('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !ticketId || sendingMessage) return;

    const messageContent = newMessage.trim();
    setNewMessage('');
    setSendingMessage(true);

    // Optimistic UI — instant feedback
    const optimisticMessage = {
      id: `temp-${Date.now()}`,
      content: messageContent,
      senderType: 'USER',
      senderName: session?.user?.name || formData.name || 'You',
      createdAt: new Date().toISOString(),
      _optimistic: true
    };
    setChatMessages(prev => [...prev, optimisticMessage]);
    forceScrollRef.current = true;
    scrollToBottom(true);

    try {
      const senderName = session?.user?.name || formData.name || 'User';
      const res = await fetch('/api/support/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          content: messageContent,
          senderType: 'USER',
          senderName,
          clientGeo: getStoredClientGeo()
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.message) {
        // Promote grey pending bubble → confirmed solid bubble in place.
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticMessage.id
              ? { ...data.message, _optimistic: false }
              : m
          )
        );
        // AI may have replied in the same request — refresh to append it without dropping ours.
        if (data.aiReply?.replied) {
          await fetchMessages();
        }
      } else {
        setChatMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id));
        setNewMessage(messageContent);
        console.error('Failed to send message:', data.error || 'unknown');
      }
    } catch {
      setChatMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id));
      setNewMessage(messageContent);
      console.error('Failed to send message');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleChatTabClick = () => {
    setActiveTab('chat');
    if (status === 'authenticated' && session?.user && !ticketId && !fetchingTicket) {
      const customerId = (session as any)?.customer?.id || (session?.user as any)?.id;
      if (customerId) {
        handleLoadOrCreateTicket(customerId, null, 'chat');
      }
    }
  };

  // CSS class for entrance animations
  const enterClass = mounted ? 'support-mounted' : 'support-pre-mount';

  return (
    <div className="min-h-[100dvh] bg-background text-foreground font-sans relative overflow-x-hidden support-page-root">

      {/* Background Gradient Blobs — GPU-layered, no animation on mobile */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0 support-bg-layer">
        <div className="support-blob support-blob-1" />
        <div className="support-blob support-blob-2" />
      </div>

      <main className={`relative z-10 max-w-7xl mx-auto px-4 md:px-8 ${isMobileApp ? 'pt-4 pb-12' : 'pt-20 md:pt-32 pb-24 pb-safe-nav'}`}>

        {/* Title Identity — CSS animation, no framer-motion */}
        {!isMobileApp && (
          <div className={`text-center mb-6 md:mb-12 ${enterClass}`} style={{ animationDelay: '0ms' }}>
            <div className="inline-flex items-center gap-2 mb-4">
              <OnlineStatusBadge />
            </div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tighter mb-2 bg-gradient-to-b from-foreground to-foreground/45 bg-clip-text text-transparent">
              SUPPORT CENTER
            </h1>
            <p className="text-foreground/50 text-[10px] md:text-sm uppercase tracking-[0.25em]">
              How can we assist you today?
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">

          {/* ──── Interaction Card Area ──── */}
          <div className={`lg:col-span-2 order-1 lg:order-2 ${enterClass}`} style={{ animationDelay: '60ms' }}>
            <div
              className="support-glass-card flex flex-col relative overflow-hidden support-live-chat-shell"
              style={{ height: 'min(640px, calc(100dvh - 200px))', maxHeight: 'calc(100dvh - 160px)' }}
            >

              {/* Tab Navigation */}
              <div className="flex border-b border-foreground/5 p-1.5 md:p-2 bg-foreground/[0.01] relative z-10 gap-1 md:gap-1.5 shrink-0">
                <button
                  onClick={() => setActiveTab('form')}
                  className={`flex-1 py-2.5 md:py-3 px-3 md:px-4 rounded-lg md:rounded-xl text-[9px] md:text-[10px] font-bold uppercase tracking-widest transition-all tap-target ${activeTab === 'form'
                      ? 'bg-foreground/10 text-foreground shadow-sm border border-foreground/10'
                      : 'text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.02]'
                    }`}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <Mail className="w-3 h-3 md:w-3.5 md:h-3.5" />
                    Message Us
                  </span>
                </button>
                <button
                  onClick={handleChatTabClick}
                  className={`flex-1 py-2.5 md:py-3 px-3 md:px-4 rounded-lg md:rounded-xl text-[9px] md:text-[10px] font-bold uppercase tracking-widest transition-all tap-target ${activeTab === 'chat'
                      ? 'bg-foreground/10 text-foreground shadow-sm border border-foreground/10'
                      : 'text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.02]'
                    }`}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <MessageSquare className="w-3 h-3 md:w-3.5 md:h-3.5" />
                    Live Chat
                    {ticketId && (
                      <span className="relative flex h-1.5 w-1.5 ml-0.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                      </span>
                    )}
                  </span>
                </button>
              </div>

              {/* Interaction Content Area */}
              <div className="flex-1 p-3 md:p-6 lg:p-8 flex flex-col relative z-10 min-h-0">

                {/* TAB 1: Support Message Form */}
                {activeTab === 'form' && (
                  <div className="support-tab-enter space-y-3 md:space-y-4 max-w-xl mx-auto w-full overflow-y-auto custom-scrollbar ios-scroll">
                    {success && (
                      <div className="p-3 md:p-4 rounded-xl md:rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center gap-3 text-green-600 dark:text-green-400">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span className="text-[10px] md:text-xs font-semibold">Message sent! Switching to live support chat...</span>
                      </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-3 md:space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                        <div className="space-y-1">
                          <label htmlFor="support-name" className="text-[9px] text-foreground/30 uppercase tracking-widest ml-2">Name</label>
                          <input
                            id="support-name"
                            required
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="glass-input w-full px-4 py-3 md:px-5 md:py-3.5 focus:border-foreground/20 transition-all text-xs md:text-sm text-foreground"
                            placeholder="Enter your name"
                            autoComplete="name"
                          />
                        </div>

                        <div className="space-y-1">
                          <label htmlFor="support-email" className="text-[9px] text-foreground/30 uppercase tracking-widest ml-2">Email Address</label>
                          <input
                            id="support-email"
                            required
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="glass-input w-full px-4 py-3 md:px-5 md:py-3.5 focus:border-foreground/20 transition-all text-xs md:text-sm text-foreground"
                            placeholder="Enter your email"
                            autoComplete="email"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="support-subject" className="text-[9px] text-foreground/30 uppercase tracking-widest ml-2">Subject</label>
                        <input
                          id="support-subject"
                          required
                          type="text"
                          value={formData.subject}
                          onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                          className="glass-input w-full px-4 py-3 md:px-5 md:py-3.5 focus:border-foreground/20 transition-all text-xs md:text-sm text-foreground"
                          placeholder="Reason for inquiry"
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="support-message" className="text-[9px] text-foreground/30 uppercase tracking-widest ml-2">Message Description</label>
                        <textarea
                          id="support-message"
                          required
                          rows={3}
                          value={formData.message}
                          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                          className="glass-input w-full px-4 py-3 md:px-5 md:py-3 focus:border-foreground/20 transition-all text-xs md:text-sm text-foreground resize-none"
                          placeholder="Detail your request..."
                        />
                      </div>

                      <button
                        disabled={loading}
                        type="submit"
                        id="support-submit-btn"
                        className="w-full py-3 md:py-4 rounded-xl md:rounded-2xl bg-foreground text-background font-bold text-[10px] md:text-xs uppercase tracking-widest hover:bg-foreground/90 transition-all active:scale-[0.98] disabled:opacity-50 flex justify-center items-center gap-2 mt-1 md:mt-2 shadow-lg shadow-black/5 tap-target"
                      >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-3.5 h-3.5" /> Submit Support Request</>}
                      </button>
                    </form>
                  </div>
                )}

                {/* TAB 2: Live Chat */}
                {activeTab === 'chat' && (
                  <div className="support-tab-enter flex-1 flex flex-col w-full min-h-0">
                    {fetchingTicket ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center py-8 md:py-12 gap-3">
                        <div className="relative">
                          <div className="w-12 h-12 rounded-2xl bg-foreground/[0.03] border border-foreground/5 flex items-center justify-center">
                            <Loader2 className="w-5 h-5 text-foreground/35 animate-spin" />
                          </div>
                          <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
                          </span>
                        </div>
                        <p className="text-[10px] text-foreground/40 uppercase tracking-[0.2em] font-bold">Connecting to support session...</p>
                      </div>
                    ) : status === 'unauthenticated' && !ticketId ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center py-8 md:py-12 space-y-4">
                        <div className="w-14 h-14 rounded-2xl bg-foreground/[0.02] border border-foreground/5 flex items-center justify-center mb-2">
                          <MessageSquare className="w-6 h-6 text-foreground/30" />
                        </div>
                        <h3 className="text-sm md:text-base font-semibold">Active Session Required</h3>
                        <p className="text-foreground/40 text-[11px] md:text-xs max-w-xs mx-auto leading-relaxed">
                          Sign in to access your persistent live chat and ticket history.
                        </p>
                        <button
                          onClick={() => router.push(`/login?callbackUrl=/support?tab=chat`)}
                          className="mt-2 px-6 py-2.5 rounded-full bg-foreground text-background hover:bg-foreground/90 transition-all text-[10px] font-bold uppercase tracking-wider shadow-lg active:scale-95 tap-target"
                        >
                          Sign In
                        </button>
                        <div className="pt-3 md:pt-4 text-foreground/25 text-[9px] uppercase tracking-[0.3em] font-semibold">Or guest chat</div>
                        <p className="text-foreground/45 text-[10px] md:text-[11px] max-w-xs mx-auto">
                          Submit a ticket in the <button onClick={() => setActiveTab('form')} className="text-blue-500/85 hover:text-blue-500 font-semibold underline decoration-dotted">Message Us</button> tab to start a guest chat session immediately.
                        </p>
                      </div>
                    ) : !ticketId ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center py-8 md:py-12 space-y-4">
                        <div className="w-14 h-14 rounded-2xl bg-foreground/[0.02] border border-foreground/5 flex items-center justify-center mb-2">
                          <Headphones className="w-6 h-6 text-foreground/30" />
                        </div>
                        <h3 className="text-sm md:text-base font-semibold">Live Chat Support</h3>
                        <p className="text-foreground/40 text-[11px] md:text-xs max-w-xs mx-auto leading-relaxed">
                          No active support ticket found. Click below to initialize a live support chat session with an agent.
                        </p>
                        <button
                          onClick={() => {
                            const customerId = (session as any)?.customer?.id || (session?.user as any)?.id;
                            if (customerId) {
                              handleLoadOrCreateTicket(customerId, null, 'chat');
                            }
                          }}
                          className="mt-2 px-6 py-2.5 rounded-full bg-foreground text-background hover:bg-foreground/90 transition-all text-[10px] font-bold uppercase tracking-wider shadow-lg active:scale-95 tap-target"
                        >
                          Start Live Session
                        </button>
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col min-h-0">
                        {/* Chat header with ticket info */}
                        <div className="flex items-center justify-between pb-3 mb-3 border-b border-foreground/5 shrink-0">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-xl bg-foreground/[0.04] border border-foreground/5 flex items-center justify-center">
                              <Headphones className="w-3.5 h-3.5 text-foreground/50" />
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-foreground/80 uppercase tracking-wider">Zica Support</p>
                              <div className="flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <p className="text-[8px] text-foreground/40 uppercase tracking-widest">Available</p>
                              </div>
                            </div>
                          </div>
                          <div className="text-[8px] text-foreground/25 uppercase tracking-widest font-mono">
                            #{ticketId.slice(-6)}
                          </div>
                        </div>

                        {/* Messages list — GPU-promoted scroll container */}
                        <div
                          ref={chatContainerRef}
                          onScroll={() => {
                            isNearBottomRef.current = measureNearBottom();
                          }}
                          className="flex-1 space-y-3 md:space-y-4 overflow-y-auto overscroll-contain pr-1 md:pr-2 custom-scrollbar ios-scroll min-h-0 support-chat-scroll"
                        >
                          {chatMessages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full min-h-[100px] text-center py-6 gap-2">
                              <div className="w-10 h-10 rounded-xl bg-foreground/[0.03] border border-foreground/5 flex items-center justify-center">
                                <MessageSquare className="w-4 h-4 text-foreground/25" />
                              </div>
                              <p className="text-foreground/35 text-[11px] font-medium">Support session initialized.</p>
                              <p className="text-foreground/25 text-[10px]">How can we help you today?</p>
                            </div>
                          ) : (
                            chatMessages.map((msg, idx) => (
                              <ChatBubble key={msg.id || idx} msg={msg} index={idx} />
                            ))
                          )}
                          <div ref={chatEndRef} />
                        </div>

                        {/* Message Input form */}
                        <form onSubmit={handleSendMessage} className="mt-3 md:mt-4 relative shrink-0 pb-safe">
                          <input
                            ref={inputRef}
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Type a message..."
                            className="glass-input w-full pl-4 md:pl-5 pr-12 md:pr-14 py-3 md:py-4 focus:border-foreground/20 transition-all text-xs text-foreground placeholder:text-foreground/30"
                            autoComplete="off"
                            enterKeyHint="send"
                            id="support-chat-input"
                          />
                          <button
                            type="submit"
                            disabled={!newMessage.trim() || sendingMessage}
                            id="support-send-btn"
                            className="absolute right-1.5 md:right-2 top-1/2 -translate-y-1/2 w-9 h-9 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-foreground text-background flex items-center justify-center hover:bg-foreground/90 transition-all active:scale-95 disabled:opacity-50 tap-target"
                          >
                            {sendingMessage ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ──── Sidebar Panel ──── */}
          <div className={`lg:col-span-1 space-y-3 md:space-y-4 order-2 lg:order-1 ${enterClass}`} style={{ animationDelay: '120ms' }}>
            {/* Contact Info Card */}
            <div className="support-glass-card p-5 md:p-6 lg:p-8 relative overflow-hidden">
              <h2 className="text-xs md:text-sm font-bold mb-5 md:mb-6 uppercase tracking-widest text-foreground/85">Get In Touch</h2>

              <div className="space-y-5 md:space-y-6">
                <div className="flex items-start gap-3 md:gap-4">
                  <div className="p-2.5 md:p-3 rounded-xl bg-foreground/[0.03] border border-foreground/5 text-foreground/70 shrink-0">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] text-foreground/30 uppercase tracking-widest mb-0.5">Email Support</p>
                    <p className="text-foreground/80 text-sm font-medium truncate">support@zicabella.com</p>
                    <p className="text-foreground/40 text-[10px] md:text-xs mt-1">Average response within 01h</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 md:gap-4">
                  <div className="p-2.5 md:p-3 rounded-xl bg-foreground/[0.03] border border-foreground/5 text-foreground/70 shrink-0">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] text-foreground/30 uppercase tracking-widest mb-0.5">HQ Location</p>
                    <p className="text-foreground/80 text-sm font-medium">Noida, India</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 md:gap-4">
                  <div className="p-2.5 md:p-3 rounded-xl bg-foreground/[0.03] border border-foreground/5 text-foreground/70 shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] text-foreground/30 uppercase tracking-widest mb-0.5">Business Hours</p>
                    <p className="text-foreground/80 text-sm font-medium">Mon – Sat, 10 AM – 7 PM IST</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions Card */}
            <div className="support-glass-card p-5 md:p-6 lg:p-8 relative overflow-hidden">
              <h2 className="text-xs md:text-sm font-bold mb-4 md:mb-5 uppercase tracking-widest text-foreground/85">Quick Actions</h2>
              <div className="space-y-2">
                <QuickActionCard
                  icon={HelpCircle}
                  title="FAQ & Help Center"
                  subtitle="Find answers to common questions"
                  onClick={() => router.push('/faq')}
                />
                <QuickActionCard
                  icon={FileText}
                  title="Track Your Order"
                  subtitle="Check delivery status and updates"
                  onClick={() => router.push('/orders')}
                />
                <QuickActionCard
                  icon={MessageSquare}
                  title="Start Live Chat"
                  subtitle="Chat with our support team now"
                  onClick={handleChatTabClick}
                />
              </div>
            </div>

            {/* Knowledge Base Card */}
            <div className="support-glass-card p-5 md:p-6 relative overflow-hidden">
              <div className="p-4 md:p-5 rounded-2xl bg-blue-500/[0.03] border border-blue-500/10">
                <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1">Knowledge Base</p>
                <p className="text-foreground/50 text-[11px] md:text-xs leading-relaxed">
                  Have quick queries? Look at our <a href="/faq" className="text-foreground border-b border-foreground/20 hover:border-foreground transition-colors">FAQ section</a> first.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-foreground/50" />
          <p className="text-[10px] text-foreground/30 uppercase tracking-widest font-bold">Loading Support Center</p>
        </div>
      </div>
    }>
      <SupportPageContent />
    </Suspense>
  );
}
