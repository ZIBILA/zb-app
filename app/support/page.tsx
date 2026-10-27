'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense, memo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Loader2, Sparkles, ShieldCheck, Package, RefreshCw, Ruler, Headphones } from 'lucide-react';

/* ──────────────────────────────────────────────
   Support = a single full-screen live chat (ChatGPT-style):
   conversation fills the screen, input pinned to the bottom, nothing else on the page.
   ────────────────────────────────────────────── */

const LIVE_CHAT_SUBJECT = 'Live Chat Support';
const GUEST_TICKET_KEY = 'zb_support_ticket_id';

/** Server-side receipt shown on ticket creation — noise in a chat view (the AI skips it too). */
const isReceiptMessage = (m: any) =>
  m.senderType === 'ZICA_AI' && String(m.content || '').startsWith('Hello! We have received your support request');

const SUGGESTIONS = [
  { icon: Package, label: 'Where is my order?' },
  { icon: RefreshCw, label: 'I want to exchange a size' },
  { icon: Ruler, label: 'Help me pick the right size' },
  { icon: Headphones, label: 'I want to talk to a human' },
];

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
   Message row — user in a bubble on the right, support as plain text on the left
   ────────────────────────────────────────────── */
const MessageRow = memo(function MessageRow({ msg }: { msg: any }) {
  const isUser = msg.senderType === 'USER';
  const isAi = msg.senderType === 'ZICA_AI';
  const time = msg._optimistic
    ? 'Sending…'
    : new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isUser) {
    return (
      <div className="flex justify-end support-msg-enter">
        <div className="max-w-[85%] md:max-w-[75%]">
          <div
            className={`px-4 py-2.5 rounded-3xl rounded-br-lg text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
              msg._optimistic ? 'bg-foreground/10 text-foreground/60' : 'bg-foreground/[0.08] text-foreground'
            }`}
          >
            {msg.content}
          </div>
          <p className="mt-1 pr-2 text-right text-[10px] text-foreground/35">{time}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 support-msg-enter">
      <div
        className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center ${
          isAi ? 'bg-purple-500/15 text-purple-600 dark:text-purple-300' : 'bg-blue-500/15 text-blue-600 dark:text-blue-300'
        }`}
      >
        {isAi ? <Sparkles className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-foreground/70 mb-1">
          {isAi ? msg.senderName || 'Zica AI' : msg.senderName || 'Zica Support'}
        </p>
        <div className="text-[15px] leading-relaxed text-foreground whitespace-pre-wrap break-words">{msg.content}</div>
        <p className="mt-1 text-[10px] text-foreground/35">{time}</p>
      </div>
    </div>
  );
});

/* ──────────────────────────────────────────────
   Page
   ────────────────────────────────────────────── */
function SupportPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [isMobileApp, setIsMobileApp] = useState(false);
  const [orderIdParam, setOrderIdParam] = useState<string | null>(null);
  const [fetchingTicket, setFetchingTicket] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [ticketId, setTicketId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  // false once the ticket is handed to a human (AI stops replying) — shown to the customer
  const [aiAutoReply, setAiAutoReply] = useState(true);
  const [newMessage, setNewMessage] = useState('');

  const loadedForCustomerRef = useRef<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isNearBottomRef = useRef(true);
  const forceScrollRef = useRef(true);
  const prevMsgSigRef = useRef('');

  const isLoggedIn = status === 'authenticated';
  const sessionCustomerId: string | undefined =
    (session as any)?.customer?.id || (session?.user as any)?.id || undefined;
  const visibleMessages = chatMessages.filter((m) => !isReceiptMessage(m));

  const messagesSignature = useCallback(
    (list: any[]) => list.map((m) => `${m.id}:${m.senderType}:${String(m.content || '').length}`).join('|'),
    []
  );

  const scrollToBottom = useCallback(() => {
    const container = chatContainerRef.current;
    // Never use scrollIntoView — on mobile Safari it scrolls the page and causes the jump-down glitch.
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      isNearBottomRef.current = true;
    });
  }, []);

  // URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('platform') === 'mobile' || params.get('app') === 'true') setIsMobileApp(true);
    setOrderIdParam(params.get('orderId'));
  }, []);

  const applyTicket = useCallback((t: any) => {
    setTicketId(t.id);
    setChatMessages(t.messages || []);
    setAiAutoReply(t.aiAutoReply !== false);
    try {
      localStorage.setItem(GUEST_TICKET_KEY, t.id);
    } catch {}
  }, []);

  // Resume an existing conversation. Keyed on the customer id, not the session object: NextAuth returns
  // a new session object on every window-focus refetch, which used to reload and wipe the chat.
  useEffect(() => {
    if (status === 'loading') return;
    const key = isLoggedIn ? sessionCustomerId || '' : 'guest';
    if (!key || loadedForCustomerRef.current === key) return;
    loadedForCustomerRef.current = key;

    (async () => {
      setFetchingTicket(true);
      try {
        if (isLoggedIn) {
          // A chat started as a guest in this browser: attach it to the account so it continues here
          let guestTicketId: string | null = null;
          try {
            guestTicketId = localStorage.getItem(GUEST_TICKET_KEY);
          } catch {}
          if (guestTicketId) {
            const claim = await fetch('/api/support/tickets/claim', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ticketId: guestTicketId }),
            }).catch(() => null);
            if (claim && (claim.status === 403 || claim.status === 404)) {
              // Belongs to another account (shared device) or no longer exists — don't reuse it
              guestTicketId = null;
              try {
                localStorage.removeItem(GUEST_TICKET_KEY);
              } catch {}
            }
          }

          // Resume the guest chat if still open, else the latest unfinished ticket.
          // Handed-off tickets are IN_PROGRESS and must be resumed, not replaced.
          const res = await fetch(`/api/support/tickets?customerId=${sessionCustomerId}`);
          const data = await res.json();
          const isActive = (t: any) => t.status === 'OPEN' || t.status === 'IN_PROGRESS';
          const tickets: any[] = data.tickets || [];
          const active =
            tickets.find((t) => t.id === guestTicketId && isActive(t)) || tickets.find(isActive);
          if (active) applyTicket(active);
        } else {
          const savedId = localStorage.getItem(GUEST_TICKET_KEY);
          if (savedId) {
            const res = await fetch(`/api/support/tickets?ticketId=${savedId}`);
            const data = await res.json();
            const t = data.tickets?.[0];
            // A ticket already attached to an account (e.g. after logout on a shared device) isn't resumed as a guest
            if (t && !t.customerId && t.status !== 'CLOSED' && t.status !== 'RESOLVED') applyTicket(t);
            else localStorage.removeItem(GUEST_TICKET_KEY);
          }
        }
      } catch (e) {
        console.error('Failed to load support chat:', e);
      } finally {
        setFetchingTicket(false);
      }
    })();
  }, [status, isLoggedIn, sessionCustomerId, applyTicket]);

  const fetchMessages = useCallback(async () => {
    if (!ticketId) return;
    try {
      const res = await fetch(`/api/support/tickets?ticketId=${ticketId}`);
      const data = await res.json();
      const t = data.tickets?.[0];
      if (!t) return;
      setAiAutoReply(t.aiAutoReply !== false);
      const next = t.messages || [];
      setChatMessages((prev) => {
        // Keep optimistic bubbles the server hasn't confirmed yet
        const unresolved = prev
          .filter((m) => m._optimistic)
          .filter((p) => !next.some((n: any) => n.senderType === 'USER' && n.content === p.content));
        const merged = unresolved.length ? [...next, ...unresolved] : next;
        return messagesSignature(prev) === messagesSignature(merged) ? prev : merged;
      });
    } catch {
      console.error('Failed to fetch messages');
    }
  }, [ticketId, messagesSignature]);

  // Poll for agent / AI replies while the tab is visible
  useEffect(() => {
    if (!ticketId) return;
    forceScrollRef.current = true;
    scrollToBottom();
    const interval = setInterval(() => {
      if (!document.hidden) fetchMessages();
    }, 3000);
    return () => clearInterval(interval);
  }, [ticketId, fetchMessages, scrollToBottom]);

  // Follow new messages only when pinned to the bottom (or right after sending / opening)
  useEffect(() => {
    const sig = messagesSignature(chatMessages);
    if (sig === prevMsgSigRef.current) return;
    prevMsgSigRef.current = sig;
    if (forceScrollRef.current || isNearBottomRef.current) {
      forceScrollRef.current = false;
      scrollToBottom();
    }
  }, [chatMessages, messagesSignature, scrollToBottom]);

  // Keep the newest message visible when the mobile keyboard opens/closes
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let prev = vv.height;
    const onResize = () => {
      const changed = Math.abs(prev - vv.height) >= 120; // keyboard, not Safari's URL bar
      prev = vv.height;
      if (changed && isNearBottomRef.current) scrollToBottom();
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [scrollToBottom]);

  // Auto-grow the input up to ~6 lines
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [newMessage]);

  const sendMessage = async (text: string) => {
    const content = text.trim();
    if (!content || sendingMessage) return;

    setSendError(null);
    setNewMessage('');
    setSendingMessage(true);

    const optimistic = {
      id: `temp-${Date.now()}`,
      content,
      senderType: 'USER',
      createdAt: new Date().toISOString(),
      _optimistic: true,
    };
    setChatMessages((prev) => [...prev, optimistic]);
    forceScrollRef.current = true;

    const restore = (error: string) => {
      setChatMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setNewMessage(content);
      setSendError(error);
    };

    try {
      if (!ticketId) {
        // First message starts the conversation (the server replies with the AI answer inline)
        const res = await fetch('/api/support/tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: sessionCustomerId || null,
            guestName: isLoggedIn ? session?.user?.name || 'Customer' : 'Guest',
            guestEmail: isLoggedIn ? session?.user?.email || 'Logged-in User' : undefined,
            subject: orderIdParam ? `Order Support #${orderIdParam.slice(-8).toUpperCase()}` : LIVE_CHAT_SUBJECT,
            content,
            priority: orderIdParam ? 'HIGH' : 'MEDIUM',
            clientGeo: getStoredClientGeo(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ticket) {
          applyTicket(data.ticket);
          forceScrollRef.current = true;
        } else {
          restore(data.error || 'Could not start the chat. Please try again.');
        }
        return;
      }

      const res = await fetch('/api/support/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          content,
          senderType: 'USER',
          senderName: session?.user?.name || 'Guest',
          clientGeo: getStoredClientGeo(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.message) {
        setChatMessages((prev) => prev.map((m) => (m.id === optimistic.id ? data.message : m)));
        // The AI reply is saved in the same request — pull it in right away
        await fetchMessages();
      } else {
        restore(data.error || 'Message not sent. Please try again.');
      }
    } catch {
      restore('Network error. Please check your connection and try again.');
    } finally {
      setSendingMessage(false);
      inputRef.current?.focus();
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(newMessage);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends on desktop; Shift+Enter (and the mobile keyboard's return) adds a new line
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      sendMessage(newMessage);
    }
  };

  const showEmptyState = !fetchingTicket && visibleMessages.length === 0;
  const awaitingReply =
    sendingMessage && aiAutoReply && visibleMessages[visibleMessages.length - 1]?.senderType === 'USER';

  return (
    <div
      className={`flex flex-col h-[100dvh] bg-background text-foreground ${
        isMobileApp ? 'pt-[env(safe-area-inset-top)]' : 'pt-[72px] md:pt-[76px]'
      }`}
    >
      {/* Conversation */}
      <div
        ref={chatContainerRef}
        onScroll={() => {
          const el = chatContainerRef.current;
          if (el) isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain support-chat-scroll"
      >
        <div className="max-w-3xl mx-auto w-full px-4 md:px-6 py-6 space-y-6">
          {fetchingTicket && visibleMessages.length === 0 ? (
            <div className="flex justify-center py-24">
              <Loader2 className="w-5 h-5 animate-spin text-foreground/40" />
            </div>
          ) : showEmptyState ? (
            <div className="flex flex-col items-center text-center pt-[8vh] md:pt-[14vh]">
              <div className="w-12 h-12 rounded-2xl bg-purple-500/15 text-purple-600 dark:text-purple-300 flex items-center justify-center mb-4">
                <Sparkles className="w-5 h-5" />
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">How can we help you today?</h1>
              <p className="mt-2 text-sm text-foreground/55">
                Ask about orders, returns, sizing or anything else. Zica AI replies instantly and our team steps in when needed.
              </p>
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
                {SUGGESTIONS.map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => sendMessage(label)}
                    disabled={sendingMessage}
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-foreground/10 hover:bg-foreground/[0.04] text-left text-sm text-foreground/80 transition-colors disabled:opacity-50"
                  >
                    <Icon className="w-4 h-4 text-foreground/50 shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            visibleMessages.map((msg, idx) => <MessageRow key={msg.id || idx} msg={msg} />)
          )}

          {awaitingReply && (
            <div className="flex gap-3 items-center text-foreground/50">
              <div className="w-7 h-7 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-300 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.2s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.1s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" />
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Composer — pinned to the bottom */}
      <div className="shrink-0 bg-background pb-[max(env(safe-area-inset-bottom),12px)]">
        <div className="max-w-3xl mx-auto w-full px-4 md:px-6">
          {!aiAutoReply && (
            <p className="pb-2 text-center text-xs text-foreground/55">
              Our support team has been notified and will reply here shortly.
            </p>
          )}

          <form
            onSubmit={onSubmit}
            className="flex items-end gap-2 p-2 pl-4 rounded-[26px] bg-foreground/[0.05] border border-foreground/10 focus-within:border-foreground/25 transition-colors"
          >
            <textarea
              ref={inputRef}
              id="support-chat-input"
              rows={1}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message Zica Support…"
              enterKeyHint="send"
              autoComplete="off"
              className="flex-1 resize-none bg-transparent py-2 text-[16px] leading-6 text-foreground placeholder:text-foreground/40 outline-none max-h-40"
            />
            <button
              type="submit"
              id="support-send-btn"
              disabled={!newMessage.trim() || sendingMessage}
              aria-label="Send message"
              className="w-9 h-9 shrink-0 rounded-full bg-foreground text-background flex items-center justify-center transition-opacity disabled:opacity-30 active:scale-95"
            >
              {sendingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
            </button>
          </form>

          <p className="pt-2 text-center text-[11px] text-foreground/45">
            {sendError ? (
              <span className="text-red-600 dark:text-red-400">{sendError}</span>
            ) : status === 'unauthenticated' ? (
              <>
                <button
                  type="button"
                  onClick={() => router.push('/login?callbackUrl=/support')}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Sign in
                </button>{' '}
                for order status and account help. This chat continues after you log in.
              </>
            ) : (
              'Zica AI can make mistakes. Our team reviews every conversation.'
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense
      fallback={
        <div className="h-[100dvh] flex items-center justify-center bg-background">
          <Loader2 className="w-6 h-6 animate-spin text-foreground/40" />
        </div>
      }
    >
      <SupportPageContent />
    </Suspense>
  );
}
