'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { BookOpen, Plus, Edit2, Trash2, Search, Loader2, Check, X, ShieldCheck, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface KBEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  keywords?: string | null;
  isActive: boolean;
  priority: number;
  updatedAt: string;
}

const CATEGORIES = [
  'SHIPPING',
  'RETURNS_EXCHANGE',
  'SIZE_GUIDE',
  'PAYMENT',
  'CONTACT_ESCALATION',
  'FAQ',
] as const;

export default function KnowledgeBaseManager() {
  const [entries, setEntries] = useState<KBEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<KBEntry | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formCategory, setFormCategory] = useState<string>('RETURNS_EXCHANGE');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formKeywords, setFormKeywords] = useState('');
  const [formPriority, setFormPriority] = useState(10);
  const [formIsActive, setFormIsActive] = useState(true);

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/support/kb');
      const data = await res.json();
      if (Array.isArray(data.entries)) {
        setEntries(data.entries);
      }
    } catch (err) {
      console.error('Failed to fetch KB entries:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const openCreateModal = () => {
    setEditingEntry(null);
    setFormCategory('RETURNS_EXCHANGE');
    setFormTitle('');
    setFormContent('');
    setFormKeywords('');
    setFormPriority(10);
    setFormIsActive(true);
    setIsModalOpen(true);
  };

  const openEditModal = (entry: KBEntry) => {
    setEditingEntry(entry);
    setFormCategory(entry.category);
    setFormTitle(entry.title);
    setFormContent(entry.content);
    setFormKeywords(entry.keywords || '');
    setFormPriority(entry.priority);
    setFormIsActive(entry.isActive);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formContent.trim()) return;

    setSaving(true);
    try {
      if (editingEntry) {
        // Update
        const res = await fetch(`/api/admin/support/kb/${editingEntry.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: formCategory,
            title: formTitle,
            content: formContent,
            keywords: formKeywords,
            priority: formPriority,
            isActive: formIsActive,
          }),
        });
        if (res.ok) {
          fetchEntries();
          setIsModalOpen(false);
        }
      } else {
        // Create
        const res = await fetch('/api/admin/support/kb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: formCategory,
            title: formTitle,
            content: formContent,
            keywords: formKeywords,
            priority: formPriority,
            isActive: formIsActive,
          }),
        });
        if (res.ok) {
          fetchEntries();
          setIsModalOpen(false);
        }
      }
    } catch (err) {
      console.error('Failed to save KB entry:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (entry: KBEntry) => {
    const nextVal = !entry.isActive;
    setEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, isActive: nextVal } : e))
    );
    try {
      await fetch(`/api/admin/support/kb/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextVal }),
      });
    } catch {
      fetchEntries();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this Knowledge Base entry?')) return;
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await fetch(`/api/admin/support/kb/${id}`, {
        method: 'DELETE',
      });
    } catch {
      fetchEntries();
    }
  };

  const filteredEntries = entries.filter((e) => {
    if (selectedCategory && e.category !== selectedCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        (e.keywords && e.keywords.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-foreground/[0.03] border border-foreground/10 backdrop-blur-md">
        <div>
          <h2 className="text-xl font-bold text-foreground tracking-wide flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            Support Knowledge Base
          </h2>
          <p className="text-xs text-foreground/60 mt-1">
            Admin-editable policies & rules injected live into Zica AI support reply context.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold text-xs transition-all shadow-lg shadow-amber-500/20"
        >
          <Plus className="w-4 h-4" />
          Add Policy Entry
        </button>
      </div>

      {/* Search & Category Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/60" />
          <input
            type="text"
            placeholder="Search policies, keywords, rules..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-foreground/[0.03] border border-foreground/10 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-4 py-2.5 rounded-xl bg-foreground/[0.03] border border-foreground/10 text-xs text-foreground/75 focus:outline-none focus:border-amber-500/50"
        >
          <option value="">All Categories ({entries.length})</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* Entries List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-amber-700 dark:text-amber-400" />
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border border-foreground/10 bg-foreground/[0.02]">
          <p className="text-sm text-foreground/60">No Knowledge Base entries found.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredEntries.map((entry) => (
            <motion.div
              key={entry.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-5 rounded-2xl border transition-all ${
                entry.isActive
                  ? 'bg-foreground/[0.03] border-foreground/10 hover:border-foreground/15'
                  : 'bg-foreground/[0.03] border-foreground/[0.06] opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                      {entry.category}
                    </span>
                    <span className="text-[10px] font-mono text-foreground/45">
                      Priority: {entry.priority}
                    </span>
                    {entry.isActive ? (
                      <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-foreground/[0.06] text-foreground/60">
                        Disabled
                      </span>
                    )}
                  </div>

                  <h3 className="text-base font-bold text-foreground">{entry.title}</h3>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggleActive(entry)}
                    title={entry.isActive ? 'Disable Entry' : 'Enable Entry'}
                    className={`p-2 rounded-lg border transition-colors ${
                      entry.isActive
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20'
                        : 'bg-foreground/[0.06] border-foreground/15 text-foreground/60 hover:bg-foreground/10'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => openEditModal(entry)}
                    className="p-2 rounded-lg bg-foreground/[0.06] border border-foreground/15 text-foreground/75 hover:bg-foreground/10 transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <p className="mt-3 text-xs text-foreground/75 leading-relaxed whitespace-pre-line font-sans">
                {entry.content}
              </p>

              {entry.keywords && (
                <div className="mt-3.5 pt-3 border-t border-foreground/10 flex items-center gap-2 text-[10px] text-foreground/45">
                  <Tag className="w-3 h-3 text-foreground/60" />
                  <span>Keywords:</span>
                  <span className="font-mono text-foreground/60">{entry.keywords}</span>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Edit / Create Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-xl p-6 rounded-2xl bg-background border border-foreground/10 shadow-2xl space-y-5"
            >
              <div className="flex items-center justify-between border-b border-foreground/10 pb-4">
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                  {editingEntry ? 'Edit Knowledge Base Entry' : 'Create Knowledge Base Entry'}
                </h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 rounded-lg text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground/60 mb-1">
                      Category
                    </label>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-background border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-amber-500/50"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-foreground/60 mb-1">
                      Priority (Higher = Priority Match)
                    </label>
                    <input
                      type="number"
                      value={formPriority}
                      onChange={(e) => setFormPriority(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-background border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-amber-500/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-foreground/60 mb-1">
                    Title / Policy Header
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Returns & Exchange Policy (Self-Pickup vs Self-Ship)"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-background border border-foreground/10 text-xs text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-amber-500/50"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-foreground/60 mb-1">
                    Policy Content / Instructions
                  </label>
                  <textarea
                    required
                    rows={6}
                    placeholder="Write complete, plain-prose rules and guidelines for Zica AI to reference..."
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-background border border-foreground/10 text-xs text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-amber-500/50 font-sans"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-foreground/60 mb-1">
                    Search Keywords (Comma-separated)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. return, exchange, pickup, self-ship, refund, 7 days"
                    value={formKeywords}
                    onChange={(e) => setFormKeywords(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-background border border-foreground/10 text-xs text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-amber-500/50"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="isActiveCheck"
                    checked={formIsActive}
                    onChange={(e) => setFormIsActive(e.target.checked)}
                    className="rounded bg-background border-foreground/10 text-amber-500 focus:ring-0"
                  />
                  <label htmlFor="isActiveCheck" className="text-xs text-foreground/75">
                    Active (Enabled for AI Retrieval)
                  </label>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-foreground/10">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs text-foreground/60 hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs shadow-lg shadow-amber-500/20 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : editingEntry ? 'Update Policy' : 'Create Policy'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
