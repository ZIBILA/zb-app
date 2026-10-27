'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Send, AlertCircle, Loader2, ArrowLeft, User, ShieldCheck, Sparkles, MapPin, Globe } from 'lucide-react';

interface SupportMessage {
  id: string;
  ticketId: string;
  senderType: string;
  senderId?: string | null;
  senderName?: string | null;
  content: string;
  createdAt: string;
  ip?: string | null;
  geoSource?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  countryCode?: string | null;
  zip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface SupportTicketDetail {
  id: string;
  customerId?: string | null;
  guestName?: string | null;
  guestEmail?: string | null;
  displayName?: string | null;
  displayEmail?: string | null;
  displayPhone?: string | null;
  subject: string;
  status: string;
  priority: string;
  aiAutoReply: boolean;
  createdAt: string;
  updatedAt: string;
  messages: SupportMessage[];
  ip?: string | null;
  geoSource?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  countryCode?: string | null;
  zip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export default function TicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [deleting, setDeleting] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef<number>(0);
  const justSentRef = useRef<boolean>(false);

  const isNearBottom = () => {
    if (!scrollContainerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    return scrollHeight - scrollTop - clientHeight < 150;
  };

  const scrollToBottom = (behavior: 'auto' | 'smooth' = 'auto') => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior });
    }
  };

  const shortId = ticket ? ticket.id.slice(-8).toUpperCase() : '';

  useEffect(() => {
    if (ticket) {
      document.title = `Ticket #${shortId} — ${ticket.subject}`;
    }
  }, [ticket, shortId]);

  const toggleAiAutoReply = async () => {
    if (!ticket) return;
    const nextVal = ticket.aiAutoReply === false ? true : false;
    try {
      const res = await fetch('/api/support/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: ticket.id,
          aiAutoReply: nextVal,
        }),
      });
      if (res.ok) {
        setTicket((prev) => (prev ? { ...prev, aiAutoReply: nextVal } : null));
      }
    } catch (err) {
      console.error('Failed to toggle AI Auto-Reply:', err);
    }
  };

  const handleApproveDeletion = async () => {
    if (!ticket || !ticket.customerId) {
      alert("Error: This ticket doesn't have an associated Customer ID.");
      return;
    }
    const displayName = ticket.displayName || ticket.guestName || 'Registered Customer';
    const confirmed = confirm(
      `WARNING: Are you absolutely sure you want to approve this account deletion request?\n\nThis will permanently delete the customer "${displayName}" and ALL of their associated data (orders, address, messages, payments). This cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const res = await fetch('/api/admin/support/delete-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: ticket.customerId,
          ticketId: ticket.id,
        }),
      });

      if (res.ok) {
        alert('Account deletion request has been approved and user data completely purged.');
        router.push('/dashboard/support');
      } else {
        const data = await res.json();
        alert('Failed to delete customer: ' + (data.error || 'Unknown error'));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert('Error: ' + msg);
    } finally {
      setDeleting(false);
    }
  };

  const fetchTicket = useCallback(async (isInitial = false) => {
    try {
      const res = await fetch(`/api/support/tickets?ticketId=${params.id}`);
      const data = await res.json();
      if (data.tickets && data.tickets[0]) {
        const fetchedTicket: SupportTicketDetail = data.tickets[0];

        setTicket((prevTicket) => {
          if (!prevTicket) {
            prevCountRef.current = fetchedTicket.messages?.length || 0;
            setTimeout(() => scrollToBottom('auto'), 50);
            return fetchedTicket;
          }

          const newMsgs = fetchedTicket.messages || [];

          if (newMsgs.length > prevCountRef.current) {
            const wasSent = justSentRef.current;
            const nearBottom = isNearBottom();

            justSentRef.current = false;
            prevCountRef.current = newMsgs.length;

            if (wasSent || nearBottom || isInitial) {
              setTimeout(() => scrollToBottom(wasSent ? 'smooth' : 'auto'), 50);
            }

            return fetchedTicket;
          }

          // If message count is identical, preserve messages reference to avoid re-rendering chat world
          if (
            prevTicket.status !== fetchedTicket.status ||
            prevTicket.priority !== fetchedTicket.priority ||
            prevTicket.aiAutoReply !== fetchedTicket.aiAutoReply ||
            prevTicket.displayName !== fetchedTicket.displayName
          ) {
            return {
              ...fetchedTicket,
              messages: prevTicket.messages,
            };
          }

          return prevTicket;
        });
      }
    } catch {
      console.error('Failed to fetch ticket');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchTicket(true);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchTicket(false);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchTicket]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !ticket) return;

    const content = newMessage.trim();
    setNewMessage('');
    setSending(true);

    // Optimistic append
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: SupportMessage = {
      id: tempId,
      ticketId: ticket.id,
      content,
      senderType: 'AGENT',
      senderId: 'admin',
      senderName: 'Zica Support',
      createdAt: new Date().toISOString(),
    };

    setTicket((prev) => {
      if (!prev) return prev;
      const updatedMsgs = [...(prev.messages || []), optimisticMessage];
      prevCountRef.current = updatedMsgs.length;
      return {
        ...prev,
        messages: updatedMsgs,
      };
    });

    justSentRef.current = true;
    setTimeout(() => scrollToBottom('smooth'), 50);

    try {
      const res = await fetch('/api/support/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: ticket.id,
          content,
          senderType: 'AGENT',
          senderName: 'Zica Support',
        }),
      });

      if (res.ok) {
        await fetchTicket(false);
      }
    } catch {
      console.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const updateStatus = async (status: string) => {
    if (!ticket) return;
    try {
      const res = await fetch('/api/support/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: ticket.id,
          status,
        }),
      });

      if (res.ok) {
        setTicket((prev) => (prev ? { ...prev, status } : null));
      } else {
        const err = await res.json();
        alert('Failed to update status: ' + (err.error || 'Unknown error'));
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      alert('Error updating status: ' + msg);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-4 h-4 text-foreground/40 animate-spin" />
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/40">Loading Ticket Details...</span>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <AlertCircle className="w-8 h-8 text-rose-500 mb-4" />
        <h2 className="text-xl font-bold uppercase tracking-tighter mb-2">Ticket Not Found</h2>
        <button onClick={() => router.back()} className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest hover:text-foreground">Go Back</button>
      </div>
    );
  }

  const displayName = ticket.displayName || ticket.guestName || (ticket.customerId ? 'Registered Customer' : 'Guest');
  const displayEmail = ticket.displayEmail || (ticket.guestEmail && ticket.guestEmail !== 'Logged-in User' ? ticket.guestEmail : null);
  const displayPhone = ticket.displayPhone || null;

  return (
    <div className="pb-20 space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <button 
            onClick={() => router.back()}
            className="w-12 h-12 rounded-2xl bg-foreground/[0.03] border border-foreground/[0.08] flex items-center justify-center hover:bg-foreground hover:text-background transition-all active:scale-90"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground uppercase tracking-tighter leading-none mb-2">
              {ticket.subject}
            </h1>
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-bold px-3 py-0.5 rounded-full border border-foreground/[0.1] bg-foreground/[0.03] text-foreground/60 uppercase tracking-widest">
                Ticket #{shortId}
              </span>
              <span className={`text-[9px] font-bold px-3 py-0.5 rounded-full border uppercase tracking-widest ${
                ticket.status === 'OPEN' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
              }`}>
                {ticket.status}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={toggleAiAutoReply}
            className={`px-4 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-[0.15em] flex items-center gap-2 transition-all ${
              ticket.aiAutoReply !== false
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20'
                : 'bg-foreground/[0.03] border-foreground/[0.1] text-foreground/40 hover:bg-foreground/[0.08]'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${ticket.aiAutoReply !== false ? 'text-purple-400 animate-pulse' : 'text-foreground/30'}`} />
            <span>Zica AI Auto-Reply: {ticket.aiAutoReply !== false ? 'ON' : 'OFF'}</span>
          </button>

          <select 
            className="bg-foreground/[0.03] border border-foreground/[0.08] rounded-xl px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] focus:outline-none"
            value={ticket.status}
            onChange={(e) => updateStatus(e.target.value)}
          >
            <option value="OPEN">MARK AS OPEN</option>
            <option value="IN_PROGRESS">IN PROGRESS</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Info */}
        <div className="lg:col-span-1 space-y-6">
          <div className="glass-card p-8 rounded-[2.5rem] border border-foreground/[0.05] bg-foreground/[0.01]">
            <h3 className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.3em] mb-6">Customer Info</h3>
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-foreground/5 flex items-center justify-center">
                  <User className="w-5 h-5 text-foreground/40" />
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-foreground uppercase truncate">{displayName}</p>
                  <p className="text-[9px] text-foreground/40 font-medium truncate lowercase">{displayEmail || 'No Email'}</p>
                  {displayPhone && (
                    <p className="text-[9px] text-foreground/40 font-medium truncate">{displayPhone}</p>
                  )}
                </div>
              </div>
              
              <div className="pt-6 border-t border-foreground/[0.05] space-y-4">
                <div>
                  <p className="text-[8px] font-bold text-foreground/20 uppercase tracking-[0.3em] mb-1.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-foreground/40" />
                    Requester Location
                  </p>
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-bold text-foreground/80 flex items-center gap-1.5 flex-wrap">
                      <span>📍 {[ticket.city, ticket.region, ticket.country].filter(Boolean).join(", ") || (ticket.ip ? "IP Location Unresolved" : "No Location Data")}</span>
                      {ticket.latitude != null && ticket.longitude != null && (
                        <a
                          href={`https://www.google.com/maps?q=${ticket.latitude},${ticket.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[9px] font-bold uppercase tracking-wider text-emerald-500 hover:text-emerald-400 hover:underline"
                        >
                          View Map ↗
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {ticket.geoSource === "GPS" ? (
                        <span className="px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                          GPS Verified
                        </span>
                      ) : ticket.geoSource === "IP" ? (
                        <span className="px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/20">
                          IP Geolocation
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-foreground/5 text-foreground/40 border border-foreground/10">
                          No Geo
                        </span>
                      )}
                      {ticket.ip && (
                        <span className="text-[9px] font-mono text-foreground/40 flex items-center gap-1">
                          <Globe className="w-2.5 h-2.5" />
                          {ticket.ip}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-[8px] font-bold text-foreground/20 uppercase tracking-[0.3em] mb-1">Created At</p>
                  <p className="text-[11px] font-bold text-foreground/60 uppercase">
                    {new Date(ticket.createdAt).toLocaleDateString('en-GB')}
                  </p>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-foreground/20 uppercase tracking-[0.3em] mb-1">Priority</p>
                  <span className="text-[9px] font-bold text-rose-500 uppercase tracking-widest">{ticket.priority}</span>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-foreground/20 uppercase tracking-[0.3em] mb-1">AI Auto-Reply</p>
                  <span className={`text-[9px] font-bold uppercase tracking-widest ${ticket.aiAutoReply !== false ? 'text-purple-400' : 'text-foreground/30'}`}>
                    {ticket.aiAutoReply !== false ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Account Deletion approval box */}
          {ticket.subject?.startsWith('[ACCOUNT_DELETION]') && (
            <div className="glass-card p-8 rounded-[2.5rem] border border-rose-500/20 bg-rose-500/[0.02] space-y-4">
              <h3 className="text-[10px] font-bold text-rose-500 uppercase tracking-[0.3em]">Account Deletion</h3>
              <p className="text-[11px] text-foreground/60 leading-relaxed uppercase tracking-wider">
                This is a formal request to permanently delete this customer account and purge all data.
              </p>
              <button
                disabled={deleting}
                onClick={handleApproveDeletion}
                className="w-full py-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[9px] font-bold uppercase tracking-[0.2em] transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-rose-950/20"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Approve & Purge Data'}
              </button>
            </div>
          )}
        </div>

        {/* Chat Area */}
        <div className="lg:col-span-3">
          <div className="h-[600px] flex flex-col glass-card rounded-[2.5rem] border border-foreground/[0.05] bg-foreground/[0.01] overflow-hidden">
            <div className="px-8 py-5 border-b border-foreground/[0.05] flex items-center justify-between bg-foreground/[0.01]">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-bold text-foreground/60 uppercase tracking-[0.3em]">Live Support Session</span>
              </div>
              {ticket.aiAutoReply !== false && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400">
                  <Sparkles className="w-3 h-3 animate-pulse" />
                  <span className="text-[8px] font-bold uppercase tracking-wider">Zica AI Auto-Reply Active</span>
                </div>
              )}
            </div>

            <div ref={scrollContainerRef} className="flex-1 p-8 overflow-y-auto custom-scrollbar space-y-8">
              {(ticket.messages || []).map((msg) => {
                const isAgent = msg.senderType === 'AGENT';
                const isAi = msg.senderType === 'ZICA_AI';

                return (
                  <div key={msg.id} className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
                    <div className="flex flex-col gap-2 max-w-[80%]">
                      <div className="flex items-center gap-2 mb-1 px-1">
                        {isAgent ? (
                          <>
                            <span className="text-[8px] font-bold text-foreground/40 uppercase tracking-widest">{msg.senderName || 'Support Agent'}</span>
                            <ShieldCheck className="w-3 h-3 text-blue-500" />
                          </>
                        ) : isAi ? (
                          <>
                            <Sparkles className="w-3 h-3 text-purple-400" />
                            <span className="text-[8px] font-bold text-purple-400 uppercase tracking-widest">{msg.senderName || 'Zica AI'}</span>
                            <span className="text-[7px] font-extrabold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 uppercase tracking-wider">AUTOREPLY</span>
                          </>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[8px] font-bold text-foreground/40 uppercase tracking-widest">{displayName}</span>
                            {(msg.city || msg.region || msg.ip) && (
                              <span className="inline-flex items-center gap-1 text-[7.5px] font-medium px-1.5 py-0.5 rounded bg-foreground/[0.03] border border-foreground/[0.06] text-foreground/50">
                                <span>📍</span>
                                {msg.latitude != null && msg.longitude != null ? (
                                  <a
                                    href={`https://www.google.com/maps?q=${msg.latitude},${msg.longitude}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:text-emerald-400 hover:underline"
                                    title={`Coordinates: ${msg.latitude}, ${msg.longitude}`}
                                  >
                                    {[msg.city, msg.region].filter(Boolean).join(", ") || msg.ip}
                                  </a>
                                ) : (
                                  <span>{[msg.city, msg.region].filter(Boolean).join(", ") || msg.ip}</span>
                                )}
                                <span className={`font-bold ${msg.geoSource === 'GPS' ? 'text-emerald-500' : 'text-amber-500'}`}>
                                  • {msg.geoSource === 'GPS' ? 'GPS' : 'IP'}
                                </span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className={`p-4 rounded-3xl ${
                        isAgent 
                          ? 'bg-foreground text-background rounded-tr-none' 
                          : isAi
                          ? 'bg-purple-500/10 text-purple-950 dark:bg-purple-950/40 dark:text-purple-100 border border-purple-500/20 rounded-tl-none font-medium'
                          : 'bg-foreground/[0.05] text-foreground border border-foreground/[0.05] rounded-tl-none'
                      }`}>
                        <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      </div>
                      <p className={`text-[8px] font-bold text-foreground/20 uppercase tracking-tighter ${isAgent ? 'text-right' : 'text-left'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            <div className="p-6 border-t border-foreground/[0.05] bg-foreground/[0.01]">
              <form onSubmit={handleSendMessage} className="relative">
                <textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="TYPE YOUR RESPONSE..."
                  rows={1}
                  className="w-full bg-foreground/[0.03] border border-foreground/[0.08] rounded-2xl pl-6 pr-20 py-5 text-[12px] font-medium focus:outline-none focus:border-foreground/20 transition-all resize-none overflow-hidden"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                />
                <button
                  type="submit"
                  disabled={sending || !newMessage.trim()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-xl bg-foreground text-background flex items-center justify-center hover:opacity-90 transition-all active:scale-95 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
