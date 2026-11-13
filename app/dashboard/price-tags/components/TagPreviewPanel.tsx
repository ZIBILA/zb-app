'use client'

import React, { useRef, useState, useCallback } from 'react'
import { Printer, CheckSquare, Square, Loader2, Wifi, FileText } from 'lucide-react'
import PriceTagCard from './PriceTagCard'
import { printTagsPDF, type PDFLayoutType } from '../utils/pdfExport'
import type { TagData } from '../utils/skuGenerator'
import type { TagTemplate } from '../utils/tagTemplate'
import { toast } from 'sonner'

interface TagPreviewPanelProps {
  tags: TagData[]
  /** Saved default design; printing uses it. */
  template?: TagTemplate
}

export default function TagPreviewPanel({ tags, template }: TagPreviewPanelProps) {
  const printAreaRef = useRef<HTMLDivElement>(null)
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set())
  const [isPrinting, setIsPrinting] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [pdfLayout] = useState<PDFLayoutType>('thermal')

  const toggleSelect = useCallback((index: number) => {
    setSelectedIndexes((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIndexes(new Set(tags.map((_, i) => i)))
  }, [tags])

  const deselectAll = useCallback(() => {
    setSelectedIndexes(new Set())
  }, [])


  // ── Print via browser: generates PDF and opens in new tab ──
  const handlePrint = useCallback(async () => {
    setIsPrinting(true)
    try {
      toast.info('Generating printable PDF...')
      await printTagsPDF(tags, pdfLayout, template)
      toast.success('Print-ready PDF opened in new tab')
    } catch (err: any) {
      toast.error(`Print failed: ${err.message}`)
    } finally {
      setIsPrinting(false)
    }
  }, [tags, pdfLayout, template])

  // ── Direct Print (Connect Printer) — same as print but with guidance ──
  const handleConnectPrinter = useCallback(async () => {
    setIsPrinting(true)
    try {
      toast.info(
        'Generating PDF for your printer. Select your printer in the dialog that follows.',
        { duration: 5000 }
      )
      await printTagsPDF(tags, pdfLayout, template)
    } catch (err: any) {
      toast.error(`Printer connection failed: ${err.message}`)
    } finally {
      setIsPrinting(false)
    }
  }, [tags, pdfLayout, template])

  // ── Page count calculation ──
  // A4 layout fits 1 tag per page, thermal also fits 1 tag per page
  const totalPages = tags.length

  if (tags.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center py-20">
        <div className="w-20 h-20 rounded-3xl bg-foreground/[0.03] border border-foreground/[0.05] flex items-center justify-center mb-6">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-foreground/15">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h3 className="text-[13px] font-semibold text-foreground/60 mb-1">No Tags Generated</h3>
        <p className="text-[10px] text-foreground/30 max-w-[250px]">
          Select a product and generate tags to see them here. Each tag will include a unique SKU and QR code.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-foreground/[0.06]">
        <button
          onClick={handlePrint}
          disabled={isPrinting}
          className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-[10px] font-semibold uppercase tracking-[0.1em] transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40"
        >
          {isPrinting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
          Print Tags
        </button>

        <button
          onClick={handleConnectPrinter}
          disabled={isPrinting}
          className="flex items-center gap-2 px-4 py-2 bg-foreground/[0.06] border border-foreground/[0.08] text-foreground rounded-lg text-[10px] font-semibold uppercase tracking-[0.1em] transition-all hover:bg-foreground/[0.1] active:scale-[0.97] disabled:opacity-40"
        >
          <Wifi className="w-3.5 h-3.5" />
          Connect Printer
        </button>

        <div className="flex-1" />

        {/* Select controls */}
        <button
          onClick={() => {
            setSelectMode(!selectMode)
            if (selectMode) deselectAll()
          }}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[9px] font-semibold uppercase tracking-[0.1em] transition-all ${
            selectMode
              ? 'bg-foreground/10 text-foreground border border-foreground/20'
              : 'bg-foreground/[0.03] text-foreground/50 border border-foreground/[0.05] hover:bg-foreground/[0.06]'
          }`}
        >
          {selectMode ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
          Select
        </button>

        {selectMode && (
          <button
            onClick={selectedIndexes.size === tags.length ? deselectAll : selectAll}
            className="px-3 py-2 bg-foreground/[0.03] border border-foreground/[0.05] text-foreground/60 rounded-lg text-[9px] font-semibold uppercase tracking-[0.1em] hover:bg-foreground/[0.06] transition-all"
          >
            {selectedIndexes.size === tags.length ? 'Deselect All' : 'Select All'}
          </button>
        )}
      </div>

      {/* Tag count + page count */}
      <div className="flex items-center gap-3">
        <p className="text-[9px] text-foreground/40 uppercase tracking-[0.15em] font-medium">
          {tags.length} tag{tags.length !== 1 ? 's' : ''} generated
          {tags.length > 0 && ` • SKU: ${tags[0].sku} → ${tags[tags.length - 1].sku}`}
        </p>
        <div className="flex items-center gap-1 px-2 py-0.5 bg-foreground/[0.04] rounded-md">
          <FileText className="w-3 h-3 text-foreground/30" strokeWidth={1.5} />
          <span className="text-[8px] text-foreground/40 uppercase tracking-[0.15em] font-semibold">
            {totalPages} page{totalPages !== 1 ? 's' : ''} in PDF
          </span>
        </div>
      </div>

      {/* Tag Grid */}
      <div
        id="price-tags-print-area"
        ref={printAreaRef}
        className={`flex flex-wrap gap-3 justify-start ${pdfLayout === 'a4' ? 'print-a4' : 'print-thermal'}`}
      >
        {tags.map((tag, i) => (
          <PriceTagCard
            key={tag.sku}
            tag={tag}
            index={i}
            selected={selectedIndexes.has(i)}
            onToggleSelect={() => toggleSelect(i)}
            showCheckbox={selectMode}
            template={template}
          />
        ))}
      </div>
    </div>
  )
}
