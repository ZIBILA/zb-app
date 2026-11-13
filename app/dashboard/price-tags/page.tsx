/**
 * Price Tag Generator — /dashboard/price-tags
 * 
 * Auto-generates printable price tags for Zica Bella products.
 * Features: SKU generation, QR codes, PDF export, print, batch history.
 * 
 * Key business rules:
 * - Generated price tags do NOT add products to inventory
 * - Products are added to inventory ONLY when scanned via the Scanner (STOCK_IN)
 * - Each SKU is unique and can only be stocked in once (duplicate scan rejection)
 * - Batch deletion is restricted to SUPER_ADMIN role only
 */

'use client'

import React, { useEffect, useCallback, useRef, useState } from 'react'
import { Tag, RefreshCw, History, Sparkles, ScanLine, BarChart3, Shield, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { useSession } from 'next-auth/react'

import TagGeneratorForm from './components/TagGeneratorForm'
import TagPreviewPanel from './components/TagPreviewPanel'
import BatchHistory from './components/BatchHistory'
import { usePriceTags, type GenerateParams, type BatchRecord } from './hooks/usePriceTags'
import { downloadTagsPDF } from './utils/pdfExport'
import TemplateEditor from './components/TemplateEditor'
import { useTagTemplate } from './hooks/useTagTemplate'

type ActiveTab = 'generator' | 'history'

export default function PriceTagsPage() {
  const { data: session } = useSession()
  const userRole = (session?.user as any)?.role || 'ADMIN'
  const isSuperAdmin = userRole === 'SUPER_ADMIN'

  const {
    products,
    tags,
    batches,
    filters,
    isLoadingProducts,
    isGenerating,
    isLoadingBatches,
    isDeleting,
    error,
    fetchProducts,
    fetchBatches,
    generateTags,
    loadBatchTags,
    deleteBatch,
    setError,
    updateFilters,
    clearFilters,
  } = usePriceTags()

  const previewRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('generator')
  // Default tag design (logo, fonts, sizes, positions), editable and shared.
  const { template, saveTemplate } = useTagTemplate()
  const [editingTemplate, setEditingTemplate] = useState(false)

  // Load products and batch history on mount
  useEffect(() => {
    fetchProducts()
    fetchBatches()
  }, [fetchProducts, fetchBatches])

  // Show error toast
  useEffect(() => {
    if (error) {
      toast.error(error)
      setError(null)
    }
  }, [error, setError])

  const handleGenerate = useCallback(async (params: GenerateParams) => {
    try {
      const generatedTags = await generateTags(params)
      toast.success(`${generatedTags.length} price tags generated!`)
      // Scroll to preview
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch {
      // Error already handled in hook
    }
  }, [generateTags])

  const handleViewBatch = useCallback(async (batch: BatchRecord) => {
    try {
      await loadBatchTags(batch)
      toast.success(`Loaded ${batch.quantity} tags from batch #${String(batch.batch_number).padStart(2, '0')}`)
      // Switch to generator tab and scroll to preview
      setActiveTab('generator')
      setTimeout(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    } catch (err: any) {
      toast.error(`Failed to load batch: ${err.message}`)
    }
  }, [loadBatchTags])

  const handleRedownload = useCallback(async (batch: BatchRecord) => {
    try {
      // Load tags from batch data
      const loadedTags = await loadBatchTags(batch)
      toast.info('Preparing PDF...')

      // Use the batch's stored tag data directly — no DOM needed
      const tagsToExport = loadedTags || batch.tags_generated || []
      if (tagsToExport.length === 0) {
        toast.error('No tags found in this batch')
        return
      }

      await downloadTagsPDF(tagsToExport, `zicabella-batch-${batch.batch_number}-${Date.now()}.pdf`, 'thermal', template)
      toast.success('PDF downloaded!')
    } catch (err: any) {
      toast.error(`Failed to download: ${err.message}`)
    }
  }, [loadBatchTags, template])

  const handleDeleteBatch = useCallback(async (batch: BatchRecord) => {
    try {
      await deleteBatch(batch.id)
      toast.success(`Batch #${String(batch.batch_number).padStart(2, '0')} deleted — ${batch.quantity} SKU records removed.`)
    } catch (err: any) {
      toast.error(`Failed to delete batch: ${err.message}`)
    }
  }, [deleteBatch])

  const handleApplyFilters = useCallback(() => {
    fetchBatches()
  }, [fetchBatches])

  // Stats
  const totalTags = batches.reduce((sum, b) => sum + b.quantity, 0)
  const totalBatches = batches.length

  const tabs = [
    { id: 'generator' as const, label: 'Generator', icon: Sparkles },
    { id: 'history' as const, label: 'History', icon: History },
  ]

  return (
    <>
      {/* Print CSS — proper paginated full-page layout (optimized for 50mm × 100mm Thermal Label) */}
      <style jsx global>{`
        @media print {
          /* Hide everything except the tag print area */
          body > *:not(#__next),
          #__next > * > *:not(#price-tags-print-area) {
            display: none !important;
          }
          .no-print,
          nav, header, footer, aside,
          button, form, table, [class*="border-foreground"] {
            display: none !important;
          }
          
          /* Setup main print area container */
          #price-tags-print-area {
            display: block !important;
            width: 50mm !important;
            height: 100mm !important;
            margin: 0 auto !important;
            padding: 0 !important;
            position: static !important;
            box-sizing: border-box !important;
          }
          
          #price-tags-print-area * {
            visibility: visible !important;
          }
          
          /* Checkbox overlay hidden in print */
          .price-tag-card label,
          .price-tag-card input[type="checkbox"] {
            display: none !important;
          }

          /* ── Thermal Label (50mm × 100mm) ── */
          .price-tag-card {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            width: 44mm !important;
            height: 94mm !important;
            margin: 3mm auto !important; /* Margins to fit the 50x100 label bounds */
            padding: 3mm 3mm 2mm 3mm !important;
            box-sizing: border-box !important;
            border: none !important;
            border-radius: 0 !important;
            background-color: #ffffff !important;
            box-shadow: none !important;
            page-break-after: always !important;
            break-after: page !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          
          .price-tag-card .logo-container {
            margin-bottom: 2.5mm !important;
            text-align: center !important;
            display: flex !important;
            justify-content: center !important;
          }
          .price-tag-card .logo-image {
            height: 8mm !important;
            width: 8mm !important;
            max-height: 8mm !important;
            max-width: 8mm !important;
          }
          
          .price-tag-card .mrp-section {
            padding: 2.5mm 0 !important;
            border-top: 0.15mm solid #dddddd !important;
            margin-bottom: 2.5mm !important;
          }
          .price-tag-card .mrp-title,
          .price-tag-card .mrp-value {
            font-size: 7.5pt !important;
            font-weight: 700 !important;
            letter-spacing: 0.2px !important;
          }
          .price-tag-card .mrp-taxes {
            font-size: 3.5pt !important;
            color: #888888 !important;
            margin-top: 0.5mm !important;
            letter-spacing: 0.2px !important;
          }
          
          .price-tag-card .tag-divider {
            height: 0.15mm !important;
            background-color: #dddddd !important;
            margin-bottom: 2.5mm !important;
          }
          
          .price-tag-card .info-rows {
            width: 100% !important;
          }
          .price-tag-card .info-row {
            padding: 0.8mm 0 !important;
            gap: 2mm !important;
          }
          .price-tag-card .info-row-label {
            font-size: 4.2pt !important;
            font-weight: 700 !important;
            color: #555555 !important;
            letter-spacing: 0.1px !important;
          }
          .price-tag-card .info-row-value {
            font-size: 4.2pt !important;
            font-weight: 500 !important;
            color: #111111 !important;
          }
          
          .price-tag-card .qr-section {
            margin-top: auto !important;
            padding-top: 2mm !important;
            border-top: 0.15mm solid #eeeeee !important;
            width: 100% !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
          }
          .price-tag-card .qr-image {
            width: 20mm !important;
            height: 20mm !important;
          }
          
          .price-tag-card .sku-text {
            margin-top: 1mm !important;
            font-size: 4.2pt !important;
            font-weight: 600 !important;
            color: #333333 !important;
            letter-spacing: 0.2px !important;
          }
          
          @page {
            size: 50mm 100mm;
            margin: 0;
          }
        }
      `}</style>


      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col md:flex-row md:items-end justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="px-2 py-0.5 bg-foreground/[0.03] rounded-md text-[7px] font-normal text-foreground/30 uppercase tracking-[0.3em] w-fit">
                Print Center
              </div>
              {isSuperAdmin && (
                <div className="px-2 py-0.5 bg-amber-500/10 rounded-md text-[7px] font-semibold text-amber-500 uppercase tracking-[0.2em] w-fit flex items-center gap-1">
                  <Shield className="w-2.5 h-2.5" />
                  Super Admin
                </div>
              )}
            </div>
            <h1 className="text-lg font-normal text-foreground uppercase tracking-[0.2em] leading-none mt-1 flex items-center gap-3">
              <Tag className="w-5 h-5 text-foreground/40" strokeWidth={1.5} />
              Price Tags
            </h1>
            <p className="text-[9px] text-foreground/30 font-normal uppercase tracking-[0.2em] mt-1">
              Generate · Preview · Print · Manage
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Stats Badges */}
            <div className="hidden sm:flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground/[0.03] border border-foreground/[0.05] rounded-lg">
                <BarChart3 className="w-3 h-3 text-foreground/30" strokeWidth={1.5} />
                <span className="text-[9px] text-foreground/40 font-semibold tabular-nums">{totalBatches}</span>
                <span className="text-[8px] text-foreground/25 uppercase tracking-wider">batches</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground/[0.03] border border-foreground/[0.05] rounded-lg">
                <ScanLine className="w-3 h-3 text-foreground/30" strokeWidth={1.5} />
                <span className="text-[9px] text-foreground/40 font-semibold tabular-nums">{totalTags}</span>
                <span className="text-[8px] text-foreground/25 uppercase tracking-wider">tags</span>
              </div>
            </div>

            <button
              onClick={() => setEditingTemplate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.05] rounded-lg text-[8px] font-normal uppercase tracking-[0.2em] text-foreground/50 transition-all active:scale-95"
            >
              <Pencil className="w-3 h-3" strokeWidth={1.5} />
              Edit Template
            </button>

            <button
              onClick={() => { fetchProducts(); fetchBatches(); }}
              className="flex items-center gap-2 px-4 py-2 bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.05] rounded-lg text-[8px] font-normal uppercase tracking-[0.2em] text-foreground/50 transition-all active:scale-95"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingProducts ? 'animate-spin' : ''}`} strokeWidth={1.5} />
              Refresh
            </button>
          </div>
        </motion.div>

        {/* ── Tab Switcher ── */}
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="flex items-center gap-1 p-1 bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl w-fit"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 px-5 py-2.5 rounded-lg text-[10px] font-semibold uppercase tracking-[0.15em] transition-all ${
                  isActive
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-foreground/40 hover:text-foreground/60 hover:bg-foreground/[0.03]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
                {tab.label}
                {tab.id === 'history' && totalBatches > 0 && (
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${
                    isActive ? 'bg-background/20 text-background' : 'bg-foreground/[0.06] text-foreground/30'
                  }`}>
                    {totalBatches}
                  </span>
                )}
              </button>
            )
          })}
        </motion.div>

        {/* ── Generator Tab ── */}
        {activeTab === 'generator' && (
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
            {/* Left Panel — Generator Form */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="bg-foreground/[0.015] border border-foreground/[0.06] rounded-2xl p-6"
            >
              <div className="mb-5">
                <h2 className="text-[11px] font-semibold text-foreground uppercase tracking-[0.15em]">
                  Tag Generator
                </h2>
                <p className="text-[8px] text-foreground/30 mt-0.5 uppercase tracking-[0.1em]">
                  Configure and generate price tags
                </p>
              </div>

              <TagGeneratorForm
                products={products}
                isLoadingProducts={isLoadingProducts}
                isGenerating={isGenerating}
                onGenerate={handleGenerate}
              />
            </motion.div>

            {/* Right Panel — Tag Preview */}
            <motion.div
              ref={previewRef}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="bg-foreground/[0.015] border border-foreground/[0.06] rounded-2xl p-6 min-h-[400px]"
            >
              <div className="mb-5">
                <h2 className="text-[11px] font-semibold text-foreground uppercase tracking-[0.15em]">
                  Tag Preview
                </h2>
                <p className="text-[8px] text-foreground/30 mt-0.5 uppercase tracking-[0.1em]">
                  Preview, download, and print generated tags
                </p>
              </div>

              <TagPreviewPanel tags={tags} template={template} />
            </motion.div>
          </div>
        )}

        {/* ── History Tab ── */}
        {activeTab === 'history' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="bg-foreground/[0.015] border border-foreground/[0.06] rounded-2xl p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-[11px] font-semibold text-foreground uppercase tracking-[0.15em] flex items-center gap-2">
                  <History className="w-4 h-4 text-foreground/30" strokeWidth={1.5} />
                  Batch History
                </h2>
                <p className="text-[8px] text-foreground/30 mt-0.5 uppercase tracking-[0.1em]">
                  All generated tag batches — view, download, or manage
                </p>
              </div>
              <button
                onClick={() => fetchBatches()}
                disabled={isLoadingBatches}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.05] rounded-lg text-[8px] font-normal uppercase tracking-[0.2em] text-foreground/40 transition-all"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingBatches ? 'animate-spin' : ''}`} strokeWidth={1.5} />
              </button>
            </div>

            <BatchHistory
              batches={batches}
              isLoading={isLoadingBatches}
              isDeleting={isDeleting}
              isSuperAdmin={isSuperAdmin}
              filters={filters}
              onViewBatch={handleViewBatch}
              onRedownload={handleRedownload}
              onDeleteBatch={handleDeleteBatch}
              onUpdateFilters={updateFilters}
              onClearFilters={clearFilters}
              onApplyFilters={handleApplyFilters}
            />
          </motion.div>
        )}

        {editingTemplate && (
          <TemplateEditor
            initial={template}
            sampleTag={tags[0] || null}
            onSave={saveTemplate}
            onClose={() => setEditingTemplate(false)}
          />
        )}

        {/* ── Info Banner ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex items-start gap-3 px-5 py-4 bg-foreground/[0.015] border border-foreground/[0.04] rounded-2xl"
        >
          <ScanLine className="w-4 h-4 text-foreground/20 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
          <div>
            <p className="text-[9px] text-foreground/40 font-medium leading-relaxed">
              <span className="font-bold text-foreground/50">Important:</span> Generated price tags do <span className="font-bold">not</span> add products to inventory.
              Products are only added to inventory when scanned via the{' '}
              <span className="font-semibold text-foreground/50">Logistics Scanner → Stock In</span> mode.
              Each SKU is unique and cannot be scanned twice.
            </p>
          </div>
        </motion.div>
      </div>
    </>
  )
}
