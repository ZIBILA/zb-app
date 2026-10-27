'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import TemplatePreviewModal from './TemplatePreviewModal';
import VariableInsertPanel from './VariableInsertPanel';
import { renderPreviewHtml } from '@/lib/email-templates/variables';
import { AUTOMATION_TRIGGERS } from '@/lib/email-templates/triggers';

/** Extract {{...}} variable keys from an HTML string. */
function extractVariablesFromHtml(html: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = html.match(regex);
  if (!matches) return [];
  return Array.from(new Set(matches.map(m => m.slice(2, -2).trim())));
}

/** Inline display of auto-detected variables from HTML code. */
function DetectedVariables({ htmlBody }: { htmlBody: string }) {
  const vars = useMemo(() => extractVariablesFromHtml(htmlBody), [htmlBody]);
  if (vars.length === 0) return null;
  return (
    <div className="border border-black/10 dark:border-white/10 rounded-xl bg-black/[0.01] dark:bg-white/[0.03] overflow-hidden">
      <div className="px-4 py-2 border-b border-black/10 dark:border-white/10 bg-gray-50 dark:bg-black/30 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-[2px]">
          Detected Variables
        </span>
        <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded">
          {vars.length} found
        </span>
      </div>
      <div className="p-3 flex flex-wrap gap-1.5">
        {vars.map(v => (
          <span
            key={v}
            className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-mono bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/50 dark:border-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          >
            {'{{'}​{v}​{'}}'}
          </span>
        ))}
      </div>
      <div className="px-4 py-1.5 border-t border-black/5 dark:border-white/5">
        <p className="text-[10px] text-gray-400 dark:text-gray-500">These variables will be auto-saved with the template and substituted at send time.</p>
      </div>
    </div>
  );
}

const PREDEFINED_TEMPLATES = [
  { slug: 'order-confirmation', name: 'Order Confirmation', type: 'Auto' },
  { slug: 'order-shipped', name: 'Order Shipped', type: 'Auto' },
  { slug: 'order-delivered', name: 'Order Delivered', type: 'Auto' },
  { slug: 'order-cancelled', name: 'Order Cancelled', type: 'Auto' },
  { slug: 'payment-failed', name: 'Payment Failed', type: 'Auto' },
  { slug: 'return-refund', name: 'Return Update', type: 'Auto' },
  { slug: 'new-drop', name: 'Collection Spotlight', type: 'Manual' },
];

function buildProductsGrid(products: any[]): string {
  const pairs = [];
  for (let i = 0; i < products.length; i += 2) {
    const left = products[i];
    const right = products[i + 1];
    pairs.push(`
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px;">
      <tr>
        <td width="50%" valign="top" style="padding-right:10px;">
          ${left ? `
          <img src="${left.image ?? ''}" width="220" height="280" alt="${left.title}"
               style="display:block; width:100%; border-radius:1px; object-fit:cover; background:#1a1a1a;" />
          <p style="margin:10px 0 2px; font-family:'DM Mono','Courier New',monospace; font-size:10px; color:rgba(255,255,255,0.75); letter-spacing:0.5px;">${left.title}</p>
          <p style="margin:0 0 8px; font-family:'DM Mono','Courier New',monospace; font-size:10px; color:rgba(255,255,255,0.35);">₹${left.price}</p>
          <a href="https://zicabella.com/products/${left.handle}" style="font-family:'DM Mono','Courier New',monospace; font-size:9px; letter-spacing:2px; color:rgba(255,255,255,0.4); text-transform:uppercase; text-decoration:none;">Shop →</a>
          ` : ''}
        </td>
        <td width="50%" valign="top" style="padding-left:10px;">
          ${right ? `
          <img src="${right.image ?? ''}" width="220" height="280" alt="${right.title}"
               style="display:block; width:100%; border-radius:1px; object-fit:cover; background:#1a1a1a;" />
          <p style="margin:10px 0 2px; font-family:'DM Mono','Courier New',monospace; font-size:10px; color:rgba(255,255,255,0.75); letter-spacing:0.5px;">${right.title}</p>
          <p style="margin:0 0 8px; font-family:'DM Mono','Courier New',monospace; font-size:10px; color:rgba(255,255,255,0.35);">₹${right.price}</p>
          <a href="https://zicabella.com/products/${right.handle}" style="font-family:'DM Mono','Courier New',monospace; font-size:9px; letter-spacing:2px; color:rgba(255,255,255,0.4); text-transform:uppercase; text-decoration:none;">Shop →</a>
          ` : ''}
        </td>
      </tr>
    </table>`);
  }
  return pairs.join('');
}

export default function TemplatesTab() {
  const router = useRouter();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewTemplate, setPreviewTemplate] = useState<any>(null);
  
  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'transactional', subject: '', htmlBody: '', automationTrigger: '' });
  const [isSaving, setIsSaving] = useState(false);
  const createTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ id: '', name: '', category: 'transactional', subject: '', htmlBody: '', automationTrigger: '' });
  const [isUpdating, setIsUpdating] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Collection Builder State
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [collections, setCollections] = useState<any[]>([]);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [editorialLine, setEditorialLine] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [collectionProducts, setCollectionProducts] = useState<any[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleResetTemplates = async () => {
    if (!confirm('Are you sure you want to reset all database templates to brand defaults? Any custom templates and triggers will be overwritten.')) return;
    setIsResetting(true);
    const toastId = toast.loading('Resetting templates to default brand themes...');
    try {
      const res = await fetch('/api/email/templates', {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Templates successfully reset to default brand themes', { id: toastId });
        setTemplates(data.templates || []);
      } else {
        toast.error(data.error || 'Failed to reset templates', { id: toastId });
      }
    } catch (error) {
      toast.error('Failed to reset templates', { id: toastId });
    } finally {
      setIsResetting(false);
    }
  };

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/email/templates');
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (error) {
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
    fetch('/api/shopify/collections?all=true')
      .then(r => r.json())
      .then(data => setCollections(data || []))
      .catch(e => console.error(e));
  }, []);

  const handleUseTemplate = (id: string) => {
    router.push(`?tab=compose&templateId=${id}`);
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await fetch('/api/email/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Template saved');
        setShowCreateModal(false);
        setForm({ name: '', category: 'transactional', subject: '', htmlBody: '', automationTrigger: '' });
        fetchTemplates();
      } else {
        toast.error(data.error || 'Failed to save template');
      }
    } catch (error) {
      toast.error('Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdating(true);
    try {
      const res = await fetch(`/api/email/templates/${editForm.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Template updated successfully');
        setShowEditModal(false);
        fetchTemplates();
      } else {
        toast.error(data.error || 'Failed to update template');
      }
    } catch (error) {
      toast.error('Failed to update template');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const template = templates.find(t => t.id === id);
      if (!template) return;
      const res = await fetch(`/api/email/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...template,
          isActive: !currentActive
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Template ${!currentActive ? 'activated' : 'deactivated'}`);
        fetchTemplates();
      } else {
        toast.error(data.error || 'Failed to toggle template');
      }
    } catch (error) {
      toast.error('Failed to toggle template status');
    }
  };

  const handleDeleteTemplate = async (id: string, name: string) => {
    if (!confirm(`Delete template "${name}"? This action cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/email/templates/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Template deleted');
        fetchTemplates();
      } else {
        toast.error(data.error || 'Failed to delete template');
      }
    } catch (error) {
      toast.error('Failed to delete template');
    }
  };

  const handlePreviewPredefined = async (slug: string, name: string) => {
    try {
      const res = await fetch(`/api/mail/preview?template=${slug}`);
      const htmlBody = await res.text();
      setPreviewTemplate({ name, subject: name, htmlBody });
    } catch (error) {
      toast.error('Failed to load preview');
    }
  };

  const handleSendTestPredefined = async (slug: string) => {
    try {
      const res = await fetch(`/api/mail/preview?template=${slug}`);
      const htmlBody = await res.text();
      
      const sendRes = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: ['admin@zicabella.com'],
          subject: 'Test Email Preview',
          htmlBody,
        })
      });
      
      if (sendRes.ok) {
        toast.success('Test email sent to admin@zicabella.com');
      } else {
        toast.error('Failed to send test email');
      }
    } catch (e) {
      toast.error('Error sending test email');
    }
  };

  const handleCollectionSelect = async (colId: string) => {
    setSelectedCollection(colId);
    if (!colId) {
      setCollectionProducts([]);
      return;
    }
    try {
      const res = await fetch(`/api/shopify/collections/${colId}/products`);
      const data = await res.json();
      setCollectionProducts(data.products || []);
    } catch (error) {
      toast.error('Failed to load collection products');
    }
  };

  const handlePreviewSpotlight = async () => {
    const col = collections.find(c => String(c.id) === selectedCollection);
    if (!col) return toast.error('Select a collection first');
    
    try {
      const res = await fetch('/api/mail/preview?template=new-drop');
      let htmlText = await res.text();
      const productsGrid = buildProductsGrid(collectionProducts);
      
      htmlText = htmlText
        .replaceAll('{{collectionName}}', col.title)
        .replaceAll('{{collectionEditorialLine}}', editorialLine)
        .replaceAll('{{collectionUrl}}', `https://zicabella.com/collections/${col.handle}`)
        .replaceAll('{{productsGrid}}', productsGrid);
      
      setPreviewTemplate({ name: 'Collection Spotlight Preview', subject: emailSubject, htmlBody: htmlText });
    } catch (e) {
      toast.error('Failed to preview spotlight');
    }
  };

  const handleSendSpotlight = async () => {
    if (!confirm('Are you sure you want to send this to all subscribers?')) return;
    setIsSending(true);
    try {
      const col = collections.find(c => String(c.id) === selectedCollection);
      const res = await fetch('/api/mail/preview?template=new-drop');
      let htmlText = await res.text();
      const productsGrid = buildProductsGrid(collectionProducts);
      
      htmlText = htmlText
        .replaceAll('{{collectionName}}', col?.title || '')
        .replaceAll('{{collectionEditorialLine}}', editorialLine)
        .replaceAll('{{collectionUrl}}', `https://zicabella.com/collections/${col?.handle || ''}`)
        .replaceAll('{{productsGrid}}', productsGrid);

      const sendRes = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: ['admin@zicabella.com'], // using admin for now as requested by scope constraint
          subject: emailSubject,
          htmlBody: htmlText,
        })
      });
      if (sendRes.ok) {
        toast.success('Campaign sent to subscribers (admin test)');
      } else {
        toast.error('Failed to send campaign');
      }
    } catch (e) {
      toast.error('Error sending campaign');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Template Preview Cards */}
      <div>
        <h2 className="text-lg font-medium text-black dark:text-white mb-4">Core Brand Templates</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PREDEFINED_TEMPLATES.map(t => (
            <div key={t.slug} className="bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-5 flex flex-col shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-mono text-[10px] tracking-[2px] uppercase text-black dark:text-white truncate">{t.name}</h3>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide shrink-0 ${t.type === 'Auto' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400'}`}>
                  {t.type}
                </span>
              </div>
              <div className="mt-auto flex gap-2">
                <button
                  onClick={() => {
                    if (t.slug === 'new-drop') {
                      setExpandedCard(expandedCard === t.slug ? null : t.slug);
                    } else {
                      handlePreviewPredefined(t.slug, t.name);
                    }
                  }}
                  className="flex-1 border border-black/20 dark:border-white/20 hover:bg-black/[0.02] dark:hover:bg-white/5 text-gray-700 dark:text-white text-xs py-2 rounded transition font-medium"
                >
                  {t.slug === 'new-drop' ? (expandedCard === t.slug ? 'Close Builder' : 'Open Builder') : 'Preview'}
                </button>
                <button
                  onClick={() => handleSendTestPredefined(t.slug)}
                  className="flex-1 border border-black/20 dark:border-white/20 hover:bg-black/[0.02] dark:hover:bg-white/5 text-gray-700 dark:text-white text-xs py-2 rounded transition font-medium"
                >
                  Send Test
                </button>
              </div>

              {/* Collection Spotlight Builder */}
              {t.slug === 'new-drop' && expandedCard === 'new-drop' && (
                <div className="mt-4 pt-4 border-t border-black/10 dark:border-white/10 flex flex-col gap-3">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-foreground/50 mb-1">Collection</label>
                    <select
                      value={selectedCollection}
                      onChange={(e) => handleCollectionSelect(e.target.value)}
                      className="w-full bg-black/5 dark:bg-white/10 border-none rounded p-2 text-xs outline-none"
                    >
                      <option value="">Select a collection...</option>
                      {collections.map(c => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                  {collectionProducts.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {collectionProducts.slice(0, 6).map(p => (
                        <div key={p.id} className="aspect-[3/4] bg-black/10 dark:bg-white/10 rounded overflow-hidden">
                          {p.image && <img src={p.image} className="w-full h-full object-cover opacity-80" alt={p.title} />}
                        </div>
                      ))}
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-foreground/50 mb-1">Editorial Line</label>
                    <input
                      value={editorialLine}
                      onChange={e => setEditorialLine(e.target.value)}
                      placeholder="e.g. Effortless warmth, considered detail."
                      className="w-full bg-black/5 dark:bg-white/10 border-none rounded p-2 text-xs outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-foreground/50 mb-1">Email Subject</label>
                    <input
                      value={emailSubject}
                      onChange={e => setEmailSubject(e.target.value)}
                      placeholder="e.g. The Summer Edit is here"
                      className="w-full bg-black/5 dark:bg-white/10 border-none rounded p-2 text-xs outline-none"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handlePreviewSpotlight}
                      className="flex-1 bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 text-xs py-2 rounded transition font-medium"
                    >
                      Preview Email
                    </button>
                    <button
                      onClick={handleSendSpotlight}
                      disabled={isSending || !selectedCollection || !emailSubject}
                      className="flex-1 bg-black dark:bg-white text-white dark:text-black hover:bg-black/80 dark:hover:bg-gray-200 text-xs py-2 rounded transition font-medium disabled:opacity-50"
                    >
                      {isSending ? 'Sending...' : 'Send to All'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium text-black dark:text-white">Database Templates</h2>
        <div className="flex gap-2">
          <button
            onClick={handleResetTemplates}
            disabled={isResetting}
            className="border border-red-500/30 dark:border-red-500/20 hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 px-4 py-2 rounded-md font-medium text-sm transition shadow-sm disabled:opacity-50"
          >
            {isResetting ? 'Resetting...' : 'Reset to Defaults'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-md font-medium text-sm hover:bg-black/80 dark:hover:bg-gray-200 transition shadow-sm"
          >
            + Add Template
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 bg-black/[0.02] dark:bg-white/5 animate-pulse rounded-xl border border-black/10 dark:border-white/10" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map(t => (
            <div key={t.id} className={`bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-5 flex flex-col justify-between shadow-sm transition-opacity ${t.isActive === false ? 'opacity-50' : ''}`}>
              <div>
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-base font-medium text-black dark:text-white truncate">{t.name}</h3>
                    {t.isActive === false && (
                      <span className="text-[9px] bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide shrink-0">Inactive</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${t.category === 'marketing' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300' : 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'}`}>
                      {t.category}
                    </span>
                    {/* Active Toggle */}
                    <button
                      onClick={() => handleToggleActive(t.id, t.isActive !== false)}
                      title={t.isActive !== false ? 'Deactivate template' : 'Activate template'}
                      className={`relative w-9 h-5 rounded-full transition-colors ${t.isActive !== false ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${t.isActive !== false ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate mb-4">{t.subject}</p>
                
                {t.automationTrigger && (
                  <div className="mb-4">
                    <span className="text-[10px] bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 px-2 py-1 rounded-full font-medium inline-flex items-center gap-1 border border-emerald-200/50 dark:border-transparent">
                      ⚡ Trigger: {t.automationTrigger}
                    </span>
                  </div>
                )}

                {t.variables && t.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-4">
                    {t.variables.map((v: string) => (
                      <span key={v} className="text-[10px] bg-black/5 dark:bg-white/10 px-2 py-0.5 rounded text-gray-600 dark:text-gray-300 font-mono">
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => handleUseTemplate(t.id)}
                  className="flex-1 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-black dark:text-white text-sm py-2 rounded transition font-medium border border-black/[0.05] dark:border-none"
                >
                  Use
                </button>
                <button
                  onClick={() => {
                    setEditForm({
                      id: t.id,
                      name: t.name,
                      category: t.category || 'transactional',
                      subject: t.subject || '',
                      htmlBody: t.htmlBody || '',
                      automationTrigger: t.automationTrigger || ''
                    });
                    setShowEditModal(true);
                  }}
                  className="flex-1 border border-black/20 dark:border-white/20 hover:bg-black/[0.02] dark:hover:bg-white/5 text-gray-700 dark:text-white text-sm py-2 rounded transition font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={() => setPreviewTemplate(t)}
                  className="flex-1 border border-black/20 dark:border-white/20 hover:bg-black/[0.02] dark:hover:bg-white/5 text-gray-700 dark:text-white text-sm py-2 rounded transition font-medium"
                >
                  Preview
                </button>
                <button
                  onClick={() => handleDeleteTemplate(t.id, t.name)}
                  title="Delete template"
                  className="px-2.5 border border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 text-sm py-2 rounded transition font-medium"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <TemplatePreviewModal 
          template={previewTemplate} 
          onClose={() => setPreviewTemplate(null)} 
          onUse={() => handleUseTemplate(previewTemplate.id)}
        />
      )}

      {/* Create Modal (Side-by-Side with Live Preview) */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/85 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-white dark:bg-[#0c0c0c] border border-black/15 dark:border-white/15 rounded-2xl w-full max-w-7xl h-[92vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-black/10 dark:border-white/10 flex justify-between items-center bg-gray-50 dark:bg-black/30">
              <div>
                <h2 className="text-xl font-semibold text-black dark:text-white">Add Custom Template</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Create a new email template with live preview</p>
              </div>
              <button 
                onClick={() => setShowCreateModal(false)} 
                className="text-gray-400 hover:text-black dark:hover:text-white bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 p-2 rounded-full transition"
              >
                ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
              {/* Left Column - Form (50%) */}
              <form onSubmit={handleCreateTemplate} className="w-full md:w-1/2 p-6 overflow-y-auto space-y-4 border-r border-black/10 dark:border-white/10">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Name</label>
                  <input
                    required
                    value={form.name}
                    onChange={e => setForm({...form, name: e.target.value})}
                    className="w-full bg-black/[0.02] dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 focus:ring-1 focus:ring-black/20 outline-none transition"
                    placeholder="e.g. Black Friday Sale"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Type</label>
                    <select
                      value={form.category}
                      onChange={e => setForm({...form, category: e.target.value})}
                      className="w-full bg-white dark:bg-[#151515] border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 outline-none transition"
                    >
                      <option value="transactional">Transactional</option>
                      <option value="marketing">Marketing</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Automation Trigger</label>
                    <select
                      value={form.automationTrigger}
                      onChange={e => setForm({...form, automationTrigger: e.target.value})}
                      className="w-full bg-white dark:bg-[#151515] border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 outline-none transition"
                    >
                      {AUTOMATION_TRIGGERS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Subject</label>
                  <input
                    required
                    value={form.subject}
                    onChange={e => setForm({...form, subject: e.target.value})}
                    className="w-full bg-black/[0.02] dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 focus:ring-1 focus:ring-black/20 outline-none transition"
                    placeholder="e.g. Your exclusive access"
                  />
                </div>

                <div className="flex-1 flex flex-col min-h-[250px]">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">HTML Code</label>
                    <span className="text-[10px] text-foreground/60 font-mono">Real-time Sandbox Enabled</span>
                  </div>
                  <textarea
                    ref={createTextareaRef}
                    required
                    value={form.htmlBody}
                    onChange={e => setForm({...form, htmlBody: e.target.value})}
                    className="w-full flex-1 bg-black/[0.02] dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-3 text-black dark:text-white text-xs font-mono focus:border-black/30 dark:focus:border-white/30 outline-none min-h-[250px] resize-y"
                    placeholder="Write or paste your custom HTML template body here..."
                  />
                </div>

                <DetectedVariables htmlBody={form.htmlBody} />

                <VariableInsertPanel
                  textareaRef={createTextareaRef}
                  onInsert={(newValue) => setForm({...form, htmlBody: newValue})}
                />
                
                <div className="pt-4 flex justify-end gap-3 border-t border-black/10 dark:border-white/10 sticky bottom-0 bg-white dark:bg-[#0c0c0c] z-10">
                  <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition">Cancel</button>
                  <button disabled={isSaving} type="submit" className="bg-black dark:bg-white text-white dark:text-black px-6 py-2.5 rounded-lg font-bold text-sm disabled:opacity-50 hover:bg-black/80 dark:hover:bg-gray-200 transition shadow-lg flex items-center gap-2">
                    {isSaving ? 'Saving...' : 'Save Template'}
                  </button>
                </div>
              </form>

              {/* Right Column - Live sandboxed iframe preview (50%) */}
              <div className="w-full md:w-1/2 bg-gray-50 dark:bg-black/45 p-6 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Live Sandbox Preview</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-[10px] text-foreground/60 font-semibold uppercase tracking-wider">Active Render</span>
                  </div>
                </div>
                <div className="flex-1 bg-white rounded-xl border border-black/10 dark:border-white/15 overflow-hidden shadow-sm flex">
                  {form.htmlBody ? (
                    <iframe
                      title="Email Live Preview"
                      sandbox="allow-same-origin"
                      srcDoc={renderPreviewHtml(form.htmlBody)}
                      className="w-full h-full border-none bg-white"
                    />
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-foreground/60 gap-2">
                      <svg className="w-12 h-12 stroke-current opacity-40" fill="none" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      <span className="text-xs font-medium uppercase tracking-wider">Type HTML to start previewing</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal (Side-by-Side Premium Live Editor) */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/85 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-white dark:bg-[#0c0c0c] border border-black/15 dark:border-white/15 rounded-2xl w-full max-w-7xl h-[92vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-black/10 dark:border-white/10 flex justify-between items-center bg-gray-50 dark:bg-black/30">
              <div>
                <h2 className="text-xl font-semibold text-black dark:text-white">Edit Template</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Refine and map your automation template in real-time</p>
              </div>
              <button 
                onClick={() => setShowEditModal(false)} 
                className="text-gray-400 hover:text-black dark:hover:text-white bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 p-2 rounded-full transition"
              >
                ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
              {/* Left Column - Form Control (50%) */}
              <form onSubmit={handleUpdateTemplate} className="w-full md:w-1/2 p-6 overflow-y-auto space-y-4 border-r border-black/10 dark:border-white/10">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Name</label>
                    <input
                      required
                      value={editForm.name}
                      onChange={e => setEditForm({...editForm, name: e.target.value})}
                      className="w-full bg-black/[0.02] dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 focus:ring-1 focus:ring-black/20 outline-none transition"
                      placeholder="e.g. Order Confirmation Template"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Category</label>
                    <select
                      value={editForm.category}
                      onChange={e => setEditForm({...editForm, category: e.target.value})}
                      className="w-full bg-white dark:bg-[#151515] border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 outline-none transition"
                    >
                      <option value="transactional">Transactional</option>
                      <option value="marketing">Marketing</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Automation Trigger</label>
                  <select
                    value={editForm.automationTrigger}
                    onChange={e => setEditForm({...editForm, automationTrigger: e.target.value})}
                    className="w-full bg-white dark:bg-[#151515] border border-black/15 dark:border-white/15 rounded-lg p-2.5 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 outline-none transition font-medium"
                  >
                    {AUTOMATION_TRIGGERS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-foreground/60 mt-1">Mapping a trigger replaces any previously mapped template for that trigger.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Subject</label>
                  <input
                    required
                    value={editForm.subject}
                    onChange={e => setEditForm({...editForm, subject: e.target.value})}
                    className="w-full bg-black/[0.02] dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 focus:ring-1 focus:ring-black/20 outline-none transition"
                    placeholder="Subject line"
                  />
                </div>

                <div className="flex-1 flex flex-col min-h-[350px]">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">HTML Code</label>
                    <span className="text-[10px] text-foreground/60 font-mono">Real-time Sandbox Enabled</span>
                  </div>
                  <textarea
                    ref={editTextareaRef}
                    required
                    value={editForm.htmlBody}
                    onChange={e => setEditForm({...editForm, htmlBody: e.target.value})}
                    className="w-full flex-1 bg-black/[0.02] dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-3 text-black dark:text-white text-xs font-mono focus:border-black/30 dark:focus:border-white/30 outline-none min-h-[350px] resize-y"
                    placeholder="Write or paste your custom HTML template body here..."
                  />
                </div>

                <DetectedVariables htmlBody={editForm.htmlBody} />

                <VariableInsertPanel
                  textareaRef={editTextareaRef}
                  onInsert={(newValue) => setEditForm({...editForm, htmlBody: newValue})}
                />
                
                <div className="pt-4 flex justify-end gap-3 border-t border-black/10 dark:border-white/10 sticky bottom-0 bg-white dark:bg-[#0c0c0c] z-10">
                  <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition">Cancel</button>
                  <button disabled={isUpdating} type="submit" className="bg-black dark:bg-white text-white dark:text-black px-6 py-2.5 rounded-lg font-bold text-sm disabled:opacity-50 hover:bg-black/80 dark:hover:bg-gray-200 transition shadow-lg flex items-center gap-2">
                    {isUpdating ? 'Saving Changes...' : 'Save & Map Trigger'}
                  </button>
                </div>
              </form>

              {/* Right Column - Live sandboxed iframe preview (50%) */}
              <div className="w-full md:w-1/2 bg-gray-50 dark:bg-black/45 p-6 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Live Sandbox Preview</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-[10px] text-foreground/60 font-semibold uppercase tracking-wider">Active Render</span>
                  </div>
                </div>
                <div className="flex-1 bg-white rounded-xl border border-black/10 dark:border-white/15 overflow-hidden shadow-sm flex">
                  {editForm.htmlBody ? (
                    <iframe
                      title="Email Live Preview"
                      sandbox="allow-same-origin"
                      srcDoc={renderPreviewHtml(editForm.htmlBody)}
                      className="w-full h-full border-none bg-white"
                    />
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-foreground/60 gap-2">
                      <svg className="w-12 h-12 stroke-current opacity-40" fill="none" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      <span className="text-xs font-medium uppercase tracking-wider">Type HTML to start previewing</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
