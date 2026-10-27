'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { MessageSquare, Clock, Search, Loader2, ArrowUpRight, Sparkles, ChevronLeft, ChevronRight, Filter, RefreshCw, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';
import KnowledgeBaseManager from '@/components/support/KnowledgeBaseManager';

interface SupportTicketDisplay {
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
  messages: Array<{
    id: string;
    content: string;
    senderType: string;
    senderName?: string | null;
    createdAt: string;
  }>;
}

const TICKETS_PER_PAGE = 50;

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Open', value: 'OPEN' },
  { label: 'In Progress', value: 'IN_PROGRESS' },
  { label: 'Resolved', value: 'RESOLVED' },
  { label: 'Closed', value: 'CLOSED' },
] as const;

const PRIORITY_FILTERS = [
  { label: 'All Priorities', value: '' },
  { label: 'High', value: 'HIGH' },
  { label: 'Medium', value: 'MEDIUM' },
  { label: 'Low', value: 'LOW' },
] as const;

export default function SupportDashboard() {
  const [activeTab, setActiveTab] = useState<'tickets' | 'kb'>('tickets');
  const [tickets, setTickets] = useState<SupportTicketDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [zicaAiEnabled, setZicaAiEnabled] = useState(true);

  const fetchTickets = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/support/tickets');
      const data = await res.json();
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
      setTickets([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchAiSettings = async () => {
    try {
      const res = await fetch('/api/admin/ai/settings');
      const data = await res.json();
      if (res.ok && typeof data.zicaAiSupportEnabled === 'boolean') {
        setZicaAiEnabled(data.zicaAiSupportEnabled);
      }
    } catch (err) {
      console.error('Failed to fetch AI settings:', err);
    }
  };

  const handleToggleGlobalAi = async () => {
    const nextVal = !zicaAiEnabled;
    setZicaAiEnabled(nextVal);
    try {
      const res = await fetch('/api/admin/ai/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zicaAiSupportEnabled: nextVal })
      });
      if (!res.ok) setZicaAiEnabled(!nextVal);
    } catch {
      setZicaAiEnabled(!nextVal);
    }
  };

  useEffect(() => {
    fetchTickets();
    fetchAiSettings();
  }, [fetchTickets]);

  // Background refresh every 15 seconds when tab is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchTickets();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchTickets]);

  // De-duplicate tickets by (customerId || guestEmail) + subject, keeping most recent
  const dedupedTickets = useMemo(() => {
    const map = new Map<string, SupportTicketDisplay>();
    for (const t of tickets) {
      const email = t.displayEmail || (t.guestEmail && t.guestEmail !== 'Logged-in User' ? t.guestEmail : '');
      const identity = t.customerId || email || (t.displayName && t.displayName !== 'Guest' ? t.displayName : '') || t.guestName || 'guest';
      const subj = (t.subject || '').trim().toLowerCase();
      const key = `${identity.toLowerCase()}_${subj}`;
      if (!map.has(key)) {
        map.set(key, t);
      } else {
        const existing = map.get(key)!;
        if (new Date(t.updatedAt) > new Date(existing.updatedAt)) {
          map.set(key, t);
        }
      }
    }
    // Sort by updatedAt descending (latest first)
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [tickets]);

  // Apply filters (status, priority, search)
  const filteredTickets = useMemo(() => {
    return dedupedTickets.filter(t => {
      // Status filter
      if (statusFilter && t.status !== statusFilter) return false;
      // Priority filter
      if (priorityFilter && t.priority !== priorityFilter) return false;
      // Search filter
      if (search) {
        const name = (t.displayName || t.guestName || '').toLowerCase();
        const email = (t.displayEmail || t.guestEmail || '').toLowerCase();
        const phone = (t.displayPhone || '').toLowerCase();
        const subject = (t.subject || '').toLowerCase();
        const id = (t.id || '').toLowerCase();
        const q = search.toLowerCase();
        if (
          !subject.includes(q) &&
          !name.includes(q) &&
          !email.includes(q) &&
          !phone.includes(q) &&
          !id.includes(q)
        ) return false;
      }
      return true;
    });
  }, [dedupedTickets, statusFilter, priorityFilter, search]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / TICKETS_PER_PAGE));
  const paginatedTickets = useMemo(() => {
    const start = (currentPage - 1) * TICKETS_PER_PAGE;
    return filteredTickets.slice(start, start + TICKETS_PER_PAGE);
  }, [filteredTickets, currentPage]);

  // Reset to page 1 whenever filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, priorityFilter, search]);

  // Stat counts (computed from full deduped set, not filtered)
  const statCounts = useMemo(() => ({
    total: dedupedTickets.length,
    open: dedupedTickets.filter(t => t.status === 'OPEN').length,
    inProgress: dedupedTickets.filter(t => t.status === 'IN_PROGRESS').length,
    resolved: dedupedTickets.filter(t => t.status === 'RESOLVED').length,
    closed: dedupedTickets.filter(t => t.status === 'CLOSED').length,
  }), [dedupedTickets]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN': return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
      case 'IN_PROGRESS': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'RESOLVED': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'CLOSED': return 'bg-foreground/5 text-foreground/40 border-foreground/10';
      default: return 'bg-foreground/30 text-foreground/50 border-foreground/30';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'HIGH': return 'text-rose-500';
      case 'MEDIUM': return 'text-amber-500';
      case 'LOW': return 'text-foreground/40';
      default: return 'text-foreground/40';
    }
  };

  const formatRelativeTime = (dateStr: string) => {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-4 h-4 text-foreground/40 animate-spin" />
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/40">Loading Tickets...</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="pb-20 space-y-8"
    >
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground uppercase tracking-tighter leading-none">
            Support Center
          </h1>
          <p className="text-[10px] text-foreground/40 font-bold uppercase tracking-[0.3em]">
            Manage customer inquiries and live chat requests.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleGlobalAi}
            className={`px-4 py-3 rounded-xl border text-[10px] font-bold uppercase tracking-[0.15em] flex items-center gap-2 transition-all ${
              zicaAiEnabled
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20'
                : 'bg-foreground/[0.03] border-foreground/[0.1] text-foreground/40 hover:bg-foreground/[0.08]'
            }`}
          >
            <Sparkles className={`w-4 h-4 ${zicaAiEnabled ? 'text-purple-400 animate-pulse' : 'text-foreground/30'}`} />
            <span>Global Zica AI: {zicaAiEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <button
            onClick={() => fetchTickets(true)}
            disabled={refreshing}
            className="w-11 h-11 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] flex items-center justify-center hover:bg-foreground/[0.08] transition-all active:scale-90 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-foreground/40 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Module Tabs */}
      <div className="flex items-center gap-2 border-b border-foreground/[0.08] pb-3">
        <button
          onClick={() => setActiveTab('tickets')}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all ${
            activeTab === 'tickets'
              ? 'bg-foreground text-background shadow-lg'
              : 'bg-foreground/[0.03] text-foreground/40 hover:text-foreground hover:bg-foreground/[0.06]'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          Support Tickets
        </button>

        <button
          onClick={() => setActiveTab('kb')}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all ${
            activeTab === 'kb'
              ? 'bg-amber-500 text-neutral-950 shadow-lg shadow-amber-500/20'
              : 'bg-foreground/[0.03] text-foreground/40 hover:text-amber-400 hover:bg-foreground/[0.06]'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          Knowledge Base
        </button>
      </div>

      {activeTab === 'kb' ? (
        <KnowledgeBaseManager />
      ) : (
        <>
          {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total', count: statCounts.total, color: 'text-foreground', bg: '' },
          { label: 'Open', count: statCounts.open, color: 'text-rose-500', bg: 'border-rose-500/10' },
          { label: 'In Progress', count: statCounts.inProgress, color: 'text-amber-500', bg: 'border-amber-500/10' },
          { label: 'Resolved', count: statCounts.resolved, color: 'text-emerald-500', bg: 'border-emerald-500/10' },
          { label: 'Closed', count: statCounts.closed, color: 'text-foreground/40', bg: '' },
        ].map((stat) => (
          <div key={stat.label} className={`glass-card p-6 rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] ${stat.bg}`}>
            <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-[0.4em] mb-3">{stat.label}</p>
            <p className={`text-3xl font-bold tracking-tighter ${stat.color}`}>{stat.count}</p>
          </div>
        ))}
      </div>

      {/* Filters Row */}
      <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
        {/* Status filter tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-foreground/[0.03] border border-foreground/[0.06]">
          <Filter className="w-3.5 h-3.5 text-foreground/20 ml-2 mr-1" />
          {STATUS_FILTERS.map((sf) => (
            <button
              key={sf.value}
              onClick={() => setStatusFilter(sf.value)}
              className={`px-3.5 py-2 rounded-lg text-[9px] font-bold uppercase tracking-[0.15em] transition-all ${
                statusFilter === sf.value
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.04]'
              }`}
            >
              {sf.label}
              {sf.value === 'OPEN' && statCounts.open > 0 ? ` (${statCounts.open})` : ''}
              {sf.value === 'IN_PROGRESS' && statCounts.inProgress > 0 ? ` (${statCounts.inProgress})` : ''}
            </button>
          ))}
        </div>

        {/* Priority filter */}
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="bg-foreground/[0.03] border border-foreground/[0.08] rounded-xl px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.2em] focus:outline-none focus:border-foreground/20 transition-all"
        >
          {PRIORITY_FILTERS.map((pf) => (
            <option key={pf.value} value={pf.value}>{pf.label}</option>
          ))}
        </select>

        {/* Search */}
        <div className="relative group flex-1 min-w-0 w-full md:max-w-xs ml-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/20 group-focus-within:text-foreground/60 transition-colors" />
          <input
            type="text"
            placeholder="SEARCH NAME, EMAIL, SUBJECT..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-foreground/[0.03] border border-foreground/[0.08] rounded-xl pl-11 pr-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.15em] focus:outline-none focus:border-foreground/20 transition-all"
          />
        </div>
      </div>

      {/* Results count + pagination info */}
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-bold text-foreground/30 uppercase tracking-[0.3em]">
          {filteredTickets.length === dedupedTickets.length
            ? `${filteredTickets.length} tickets`
            : `${filteredTickets.length} of ${dedupedTickets.length} tickets`}
          {filteredTickets.length > TICKETS_PER_PAGE && ` • Page ${currentPage} of ${totalPages}`}
        </p>
        {filteredTickets.length > TICKETS_PER_PAGE && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="w-8 h-8 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] flex items-center justify-center hover:bg-foreground/[0.06] transition-all disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-foreground/50" />
            </button>
            <span className="text-[9px] font-bold text-foreground/40 uppercase tracking-wider tabular-nums min-w-[60px] text-center">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="w-8 h-8 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] flex items-center justify-center hover:bg-foreground/[0.06] transition-all disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronRight className="w-3.5 h-3.5 text-foreground/50" />
            </button>
          </div>
        )}
      </div>

      {/* Ticket Table */}
      <div className="glass-card rounded-[2rem] border border-foreground/[0.05] bg-foreground/[0.01] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-foreground/[0.05] bg-foreground/[0.02]">
                <th className="px-6 py-4 text-[9px] font-bold text-foreground/40 uppercase tracking-[0.3em]">Customer</th>
                <th className="px-6 py-4 text-[9px] font-bold text-foreground/40 uppercase tracking-[0.3em]">Subject</th>
                <th className="px-6 py-4 text-[9px] font-bold text-foreground/40 uppercase tracking-[0.3em]">Status</th>
                <th className="px-6 py-4 text-[9px] font-bold text-foreground/40 uppercase tracking-[0.3em]">Priority</th>
                <th className="px-6 py-4 text-[9px] font-bold text-foreground/40 uppercase tracking-[0.3em]">AI</th>
                <th className="px-6 py-4 text-[9px] font-bold text-foreground/40 uppercase tracking-[0.3em]">Updated</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/[0.03]">
              {paginatedTickets.map((ticket) => {
                const displayName = ticket.displayName || ticket.guestName || (ticket.customerId ? 'Registered Customer' : 'Guest');
                const displayEmail = ticket.displayEmail || (ticket.guestEmail && ticket.guestEmail !== 'Logged-in User' ? ticket.guestEmail : null);
                const displayPhone = ticket.displayPhone || null;
                const avatarLetter = (displayName || 'G')[0].toUpperCase();
                const lastMessage = ticket.messages?.[ticket.messages.length - 1];
                const msgCount = ticket.messages?.length || 0;

                return (
                  <tr key={ticket.id} className="hover:bg-foreground/[0.015] transition-colors group">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3.5">
                        <div className="w-9 h-9 rounded-full bg-foreground/5 flex items-center justify-center text-[11px] font-bold shrink-0">
                          {avatarLetter}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[12px] font-bold text-foreground uppercase leading-none mb-1 truncate max-w-[160px]">{displayName}</p>
                          <p className="text-[9px] text-foreground/35 font-medium lowercase tracking-wider truncate max-w-[160px]">
                            {displayEmail || displayPhone || 'Guest User'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <p className="text-[12px] font-bold text-foreground truncate max-w-[220px] uppercase leading-none mb-1">{ticket.subject}</p>
                      <p className="text-[9px] text-foreground/35 font-medium truncate max-w-[220px] tracking-wider">
                        {lastMessage?.content?.substring(0, 60)}{lastMessage?.content && lastMessage.content.length > 60 ? '…' : ''}
                        {msgCount > 0 && <span className="text-foreground/20 ml-1.5">({msgCount})</span>}
                      </p>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`text-[8px] font-bold px-2.5 py-1 rounded-full border uppercase tracking-widest whitespace-nowrap ${getStatusColor(ticket.status)}`}>
                        {ticket.status === 'IN_PROGRESS' ? 'IN PROGRESS' : ticket.status}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`text-[9px] font-bold uppercase tracking-widest ${getPriorityColor(ticket.priority)}`}>
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider ${
                        ticket.aiAutoReply !== false ? 'text-purple-400' : 'text-foreground/20'
                      }`}>
                        <Sparkles className="w-3 h-3" />
                        {ticket.aiAutoReply !== false ? 'ON' : 'OFF'}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-1.5 text-foreground/35">
                        <Clock className="w-3 h-3" />
                        <span className="text-[9px] font-bold uppercase tracking-wider whitespace-nowrap">
                          {formatRelativeTime(ticket.updatedAt)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <Link
                        href={`/dashboard/support/${ticket.id}`}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-foreground text-background rounded-lg text-[8px] font-bold uppercase tracking-[0.15em] hover:opacity-90 transition-all active:scale-95 shadow-sm opacity-60 group-hover:opacity-100"
                      >
                        View <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredTickets.length === 0 && (
          <div className="py-24 flex flex-col items-center justify-center text-center">
            <MessageSquare className="w-10 h-10 text-foreground/5 mb-4" />
            <p className="text-[11px] font-bold text-foreground/20 uppercase tracking-[0.3em] mb-1">No tickets found</p>
            <p className="text-[9px] text-foreground/15 font-medium uppercase tracking-wider">
              {search || statusFilter || priorityFilter ? 'Try adjusting your filters' : 'No support tickets yet'}
            </p>
          </div>
        )}
      </div>

      {/* Bottom Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-[9px] font-bold text-foreground/25 uppercase tracking-[0.2em]">
            Showing {((currentPage - 1) * TICKETS_PER_PAGE) + 1}–{Math.min(currentPage * TICKETS_PER_PAGE, filteredTickets.length)} of {filteredTickets.length}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage <= 1}
              className="px-3 py-1.5 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] text-[8px] font-bold uppercase tracking-wider text-foreground/40 hover:bg-foreground/[0.06] transition-all disabled:opacity-20 disabled:pointer-events-none"
            >
              First
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="w-8 h-8 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] flex items-center justify-center hover:bg-foreground/[0.06] transition-all disabled:opacity-20 disabled:pointer-events-none"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-foreground/50" />
            </button>

            {/* Page number buttons */}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
              .reduce<(number | 'ellipsis')[]>((acc, p, i, arr) => {
                if (i > 0 && arr[i - 1] !== undefined && p - (arr[i - 1] as number) > 1) {
                  acc.push('ellipsis');
                }
                acc.push(p);
                return acc;
              }, [])
              .map((item, i) =>
                item === 'ellipsis' ? (
                  <span key={`e-${i}`} className="text-[9px] text-foreground/20 px-1">…</span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setCurrentPage(item as number)}
                    className={`w-8 h-8 rounded-lg text-[9px] font-bold transition-all ${
                      currentPage === item
                        ? 'bg-foreground text-background'
                        : 'border border-foreground/[0.06] bg-foreground/[0.02] text-foreground/40 hover:bg-foreground/[0.06]'
                    }`}
                  >
                    {item}
                  </button>
                )
              )}

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="w-8 h-8 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] flex items-center justify-center hover:bg-foreground/[0.06] transition-all disabled:opacity-20 disabled:pointer-events-none"
            >
              <ChevronRight className="w-3.5 h-3.5 text-foreground/50" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] text-[8px] font-bold uppercase tracking-wider text-foreground/40 hover:bg-foreground/[0.06] transition-all disabled:opacity-20 disabled:pointer-events-none"
            >
              Last
            </button>
          </div>
        </div>
      )}
        </>
      )}
    </motion.div>
  );
}
