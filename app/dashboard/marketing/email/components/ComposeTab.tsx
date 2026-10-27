'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import VariableSubstitutionPanel from './VariableSubstitutionPanel';
import ImageManager from './ImageManager';
import { findUnresolvedVariables } from '@/lib/email-templates/variables';
function extractVariables(html: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = html.match(regex);
  if (!matches) return [];
  const uniqueVars = Array.from(new Set(matches.map(m => m.slice(2, -2).trim())));
  return uniqueVars;
}

const DRAFT_KEY = 'zb_email_draft';

export default function ComposeTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateIdParam = searchParams.get('templateId');

  const [templates, setTemplates] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerCount, setCustomerCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Form State
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [recipientType, setRecipientType] = useState<'all' | 'specific' | 'paste'>('all');
  const [specificUsers, setSpecificUsers] = useState<string[]>([]);
  const [pastedEmails, setPastedEmails] = useState('');
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const [variables, setVariables] = useState<string[]>([]);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  
  const [isSending, setIsSending] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop');

  // Load basic data
  useEffect(() => {
    Promise.all([
      fetch('/api/email/templates').then(r => r.json()),
      fetch('/api/email/customers').then(r => r.json())
    ]).then(([templatesData, customersData]) => {
      setTemplates(templatesData.templates || []);
      setCustomers(customersData.customers || []);
      setCustomerCount(customersData.count || 0);
      setLoading(false);
    });
  }, []);

  // Load from localStorage or URL param
  useEffect(() => {
    if (loading) return;

    if (templateIdParam) {
      const t = templates.find(t => t.id === templateIdParam);
      if (t) {
        handleTemplateSelect(t.id, t);
      }
      // Remove param
      const params = new URLSearchParams(searchParams.toString());
      params.delete('templateId');
      router.replace(`?${params.toString()}`);
    } else {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        try {
          const draft = JSON.parse(saved);
          setSelectedTemplateId(draft.selectedTemplateId || '');
          setRecipientType(draft.recipientType || 'all');
          setSpecificUsers(draft.specificUsers || []);
          setPastedEmails(draft.pastedEmails || '');
          setSubject(draft.subject || '');
          setHtmlBody(draft.htmlBody || '');
          setVariableValues(draft.variableValues || {});
        } catch (e) {}
      }
    }
  }, [loading, templateIdParam]); // eslint-disable-line

  // Save to localStorage
  useEffect(() => {
    const draft = { selectedTemplateId, recipientType, specificUsers, pastedEmails, subject, htmlBody, variableValues };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [selectedTemplateId, recipientType, specificUsers, pastedEmails, subject, htmlBody, variableValues]);

  // Update variables list when htmlBody changes
  useEffect(() => {
    setVariables(extractVariables(htmlBody));
  }, [htmlBody]);

  const handleTemplateSelect = (id: string, templateObj?: any) => {
    setSelectedTemplateId(id);
    if (!id) return;
    const template = templateObj || templates.find(t => t.id === id);
    if (template) {
      setSubject(template.subject || '');
      setHtmlBody(template.htmlBody || '');
      const vars = extractVariables(template.htmlBody || '');
      setVariables(vars);
      const newVals: Record<string, string> = {};
      vars.forEach(v => { newVals[v] = ''; });
      setVariableValues(newVals);
    }
  };

  const substitutedHtml = useMemo(() => {
    let finalHtml = htmlBody;
    Object.entries(variableValues).forEach(([key, val]) => {
      finalHtml = finalHtml.replaceAll(`{{${key}}}`, val || '');
    });
    // Strip any unresolved remaining variables
    finalHtml = finalHtml.replace(/\{\{([^}]+)\}\}/g, '');
    // Ensure DOCTYPE wrapper for proper iframe rendering
    if (finalHtml && !finalHtml.includes('<!DOCTYPE html>')) {
      finalHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#000;">${finalHtml}</body></html>`;
    }
    return finalHtml;
  }, [htmlBody, variableValues]);

  // Detect unresolved variables that would be sent as literal {{...}} to recipients.
  // customerName and customerEmail are auto-substituted per-recipient server-side,
  // so they don't count as "unresolved" here.
  const unresolvedVars = useMemo(() => {
    const autoResolved: Record<string, string> = {
      customerName: '(auto)',
      customerEmail: '(auto)',
      ...variableValues,
    };
    return findUnresolvedVariables(htmlBody, autoResolved);
  }, [htmlBody, variableValues]);

  const handleProductSelected = (product: any, imageUrl: string) => {
    // 1. Auto-fill subject if empty or generic
    if (!subject || subject.toLowerCase().includes('scratch') || subject.toLowerCase().includes('subject')) {
      setSubject(`Introducing our latest: ${product.title}`);
    }

    // 2. Scan variableValues and auto-fill any that match product keys
    setVariableValues(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(key => {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('title') || lowerKey.includes('name')) {
          if (!updated[key]) updated[key] = product.title || '';
        } else if (lowerKey.includes('price')) {
          if (!updated[key]) {
            const price = product.variants?.[0]?.price || '';
            updated[key] = price ? `INR ${price}` : '';
          }
        } else if (lowerKey.includes('link') || lowerKey.includes('url')) {
          if (!updated[key]) updated[key] = `https://zicabella.com/products/${product.handle || ''}`;
        } else if (lowerKey.includes('image') || lowerKey.includes('img') || lowerKey.includes('src')) {
          if (!updated[key]) updated[key] = imageUrl || '';
        } else if (lowerKey.includes('desc')) {
          if (!updated[key]) updated[key] = product.body_html?.replace(/<[^>]*>/g, '') || '';
        }
      });
      return updated;
    });
    toast.success(`Loaded product "${product.title}" variables into Compose!`);
  };


  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const resolvedCount = useMemo(() => {
    if (recipientType === 'all') return customerCount;
    if (recipientType === 'paste') {
      return pastedEmails.split(',').map(e => e.trim()).filter(Boolean).length;
    }
    if (recipientType === 'specific') {
      return specificUsers.length;
    }
    return 0;
  }, [recipientType, customerCount, pastedEmails, specificUsers]);

  const handleSend = async () => {
    if (!subject) return toast.error('Subject is required');
    if (recipientType === 'paste' && !pastedEmails.trim()) return toast.error('Please enter at least one email');
    if (recipientType === 'specific' && specificUsers.length === 0) return toast.error('Please select at least one user');
    if (!htmlBody) return toast.error('HTML Body cannot be empty');

    if (resolvedCount > 10) {
      setShowConfirmModal(true);
    } else {
      executeSend();
    }
  };

  const executeSend = async () => {
    setShowConfirmModal(false);
    
    let recipients: string[] | 'all' = [];
    if (recipientType === 'all') recipients = 'all';
    else if (recipientType === 'paste') {
      recipients = pastedEmails.split(',').map(e => e.trim()).filter(Boolean);
    } else if (recipientType === 'specific') {
      recipients = specificUsers;
    }

    if (substitutedHtml.includes('unsplash.com')) {
      if (!confirm('One or more images are still placeholders. Are you sure you want to send?')) {
        return;
      }
    }

    setIsSending(true);
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplateId || undefined,
          subject,
          htmlBody: substitutedHtml,
          recipients,
          scheduledAt: isScheduled ? new Date(scheduledAt).toISOString() : undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Email ${isScheduled ? 'scheduled for' : 'sent to'} ${data.sentCount} recipients`);
        localStorage.removeItem(DRAFT_KEY);
        if (!isScheduled) {
          router.push('?tab=sent');
        }
      } else {
        toast.error('Failed to send — ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      toast.error('Failed to send email');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-140px)]">
      {/* Editor Panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-black/10 dark:border-white/10 flex justify-between items-center bg-gray-50 dark:bg-[#161616]">
          <h2 className="text-base font-medium text-black dark:text-white">Compose</h2>
          <div className="flex gap-2">
            <span className="text-xs text-foreground/50 mr-2 flex items-center">
              {subject.length} chars (Recommended: &lt;60)
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From Template (Optional)</label>
            <select
              value={selectedTemplateId}
              onChange={e => handleTemplateSelect(e.target.value)}
              className="w-full bg-white dark:bg-[#1a1a1a] border border-black/10 dark:border-white/10 rounded-lg p-2 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 outline-none"
            >
              <option value="">-- Start from scratch --</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">To</label>
            <div className="flex gap-4 mb-3">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="radio" checked={recipientType === 'all'} onChange={() => setRecipientType('all')} />
                All Users ({customerCount})
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="radio" checked={recipientType === 'specific'} onChange={() => setRecipientType('specific')} />
                Specific Users
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="radio" checked={recipientType === 'paste'} onChange={() => setRecipientType('paste')} />
                Paste Emails
              </label>
            </div>

            {recipientType === 'paste' && (
              <textarea
                rows={3}
                value={pastedEmails}
                onChange={e => setPastedEmails(e.target.value)}
                placeholder="email1@example.com, email2@example.com"
                className="w-full bg-black/[0.02] dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-3 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 outline-none"
              />
            )}
            
            {recipientType === 'specific' && (
              <select
                multiple
                value={specificUsers}
                onChange={e => setSpecificUsers(Array.from(e.target.selectedOptions, option => option.value))}
                className="w-full bg-white dark:bg-[#1a1a1a] border border-black/10 dark:border-white/10 rounded-lg p-2 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 outline-none h-32"
              >
                {customers.map(c => (
                  <option key={c.id} value={c.email}>{c.name || c.email} ({c.email})</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subject</label>
            <input
              required
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full bg-black/[0.02] dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-2 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 outline-none"
              placeholder="Email subject..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">HTML Body</label>
            <textarea
              required
              rows={12}
              value={htmlBody}
              onChange={e => setHtmlBody(e.target.value)}
              className="w-full bg-black/[0.02] dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-3 text-black dark:text-white text-sm font-mono focus:border-black/30 dark:focus:border-white/30 outline-none"
              placeholder="Raw HTML..."
            />
          </div>

          <VariableSubstitutionPanel
            variables={variables}
            values={variableValues}
            onChange={(k, v) => setVariableValues(prev => ({ ...prev, [k]: v }))}
          />

          <ImageManager
            htmlBody={htmlBody}
            onChange={(newHtml) => setHtmlBody(newHtml)}
            onProductSelected={handleProductSelected}
          />

          <div className="border-t border-black/10 dark:border-white/10 pt-4 mt-4">
            <h3 className="text-sm font-medium text-black dark:text-white mb-3">Send Settings</h3>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="radio" checked={!isScheduled} onChange={() => setIsScheduled(false)} />
                Send Now
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="radio" checked={isScheduled} onChange={() => setIsScheduled(true)} />
                Schedule for Later
              </label>
            </div>
            
            {isScheduled && (
              <div className="mt-3">
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                  className="bg-white dark:bg-[#1a1a1a] border border-black/10 dark:border-white/10 rounded-lg p-2 text-black dark:text-white text-sm outline-none"
                />
                <span className="text-xs text-foreground/50 ml-2">(IST Timezone)</span>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-black/10 dark:border-white/10 bg-gray-50 dark:bg-[#161616] space-y-3">
          {unresolvedVars.length > 0 && (
            <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-1.5 flex items-center gap-1.5">
                <span>⚠</span> Unresolved Template Variables
              </p>
              <p className="text-[11px] text-amber-600 dark:text-amber-400/80 leading-relaxed mb-2">
                The following variables have no value and would appear as literal {'{{...}}'} in customer inboxes. Fill them in the Variables panel above or remove them from the HTML.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unresolvedVars.map(v => (
                  <span key={v} className="text-[10px] font-mono bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded">
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          )}
          <button
            disabled={isSending || unresolvedVars.length > 0}
            onClick={handleSend}
            className="w-full bg-black dark:bg-white text-white dark:text-black px-6 py-3 rounded-lg font-bold text-sm disabled:opacity-50 hover:bg-black/80 dark:hover:bg-gray-200 transition shadow-md"
          >
            {isSending ? 'Processing...' : unresolvedVars.length > 0 ? `Resolve ${unresolvedVars.length} Variable${unresolvedVars.length > 1 ? 's' : ''} to Send` : (isScheduled ? 'Schedule Email' : 'Send Email')}
          </button>
        </div>
      </div>

      {/* Live Preview Panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-black/10 dark:border-white/10 flex justify-between items-center bg-gray-50 dark:bg-[#161616]">
          <h2 className="text-base font-medium text-black dark:text-white">Live Preview</h2>
          <div className="flex bg-gray-200 dark:bg-black rounded-lg p-1 border border-black/10 dark:border-white/10">
            <button
              onClick={() => setPreviewWidth('desktop')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${previewWidth === 'desktop' ? 'bg-white dark:bg-white/20 text-black dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'}`}
            >
              Desktop
            </button>
            <button
              onClick={() => setPreviewWidth('mobile')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${previewWidth === 'mobile' ? 'bg-white dark:bg-white/20 text-black dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'}`}
            >
              Mobile
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto bg-gray-100 dark:bg-black p-4 flex justify-center">
          <div 
            className="bg-white shadow-2xl transition-all duration-300 ease-in-out flex flex-col h-full"
            style={{ width: previewWidth === 'desktop' ? '600px' : '380px', maxWidth: '100%' }}
          >
            <iframe
              srcDoc={substitutedHtml}
              style={{ width: '100%', height: '640px', border: 'none', display: 'block', borderRadius: '4px' }}
              title="Live Preview"
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      </div>
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1a1a1a] border border-black/10 dark:border-white/15 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-red-500 dark:text-red-400">Confirm Bulk Email Blast</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              You are about to launch an email marketing campaign to <strong>{resolvedCount}</strong> recipients.
            </p>
            <div className="bg-black/5 dark:bg-white/5 p-3 rounded-xl border border-black/10 dark:border-white/10 space-y-2 text-xs text-gray-700 dark:text-gray-300">
              <div>
                <span className="font-semibold block text-[10px] uppercase text-foreground/50">Subject:</span>
                <span>{subject}</span>
              </div>
              {selectedTemplateId && (
                <div>
                  <span className="font-semibold block text-[10px] uppercase text-foreground/50">Template ID:</span>
                  <span>{selectedTemplateId}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-400 leading-normal">
              ⚠ Bulk validation popup is active because you are sending to more than 10 recipients. Please confirm to proceed.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={executeSend}
                className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-xl text-xs font-bold shadow-lg hover:opacity-90"
              >
                Confirm & Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
