'use client'

import React, { useEffect, useRef, useState } from 'react'
import { X, Upload, RotateCcw, Save, Loader2, AlertTriangle, ImageOff, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { buildTagsPDF } from '../utils/pdfExport'
import { DEFAULT_TAG_TEMPLATE, TEMPLATE_LIMITS, normalizeTagTemplate, type TagTemplate, type TagTextStyle } from '../utils/tagTemplate'
import type { TagData } from '../utils/skuGenerator'

interface TemplateEditorProps {
  initial: TagTemplate
  /** A real generated tag to preview with; a sample is used when none was generated yet. */
  sampleTag?: TagData | null
  onSave: (template: TagTemplate) => Promise<unknown>
  onClose: () => void
}

const SAMPLE_TAG: TagData = {
  sku: 'ZB0000-M-0001',
  mrp: 4799,
  size: 'M',
  genericName: 'JEANS',
  productName: 'Sample',
  mfgDate: '11/2026',
  qrDataUrl: '',
  netQuantity: '1 Pc',
}

const MAX_LOGO_BYTES = 400 * 1024

export default function TemplateEditor({ initial, sampleTag, onSave, onClose }: TemplateEditorProps) {
  const [tpl, setTpl] = useState<TagTemplate>(initial)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [overflow, setOverflow] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Live preview: the exact PDF that will be printed.
  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    const timer = setTimeout(async () => {
      try {
        const { pdf, overflow: over } = await buildTagsPDF([sampleTag || SAMPLE_TAG], 'thermal', tpl)
        if (cancelled) return
        url = URL.createObjectURL(pdf.output('blob'))
        setPreviewUrl(url)
        setOverflow(over)
      } catch (err) {
        console.warn('[Template preview]', err)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
      if (url) URL.revokeObjectURL(url)
    }
  }, [tpl, sampleTag])

  const update = (patch: Partial<TagTemplate>) => setTpl((t) => normalizeTagTemplate({ ...t, ...patch }))
  const updateStyle = (key: 'mrp' | 'taxes' | 'infoLabel' | 'infoValue' | 'sku', patch: Partial<TagTextStyle>) =>
    setTpl((t) => normalizeTagTemplate({ ...t, [key]: { ...t[key], ...patch } }))

  const handleLogoFile = (file?: File | null) => {
    if (!file) return
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error('Please choose a PNG, JPG or WebP image')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error('The image is too large. Please use an image under 400 KB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setTpl((t) => normalizeTagTemplate({ ...t, logo: { ...t.logo, show: true, src: String(reader.result) } }))
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(tpl)
      toast.success('Saved as the default price tag design')
      onClose()
    } catch (err: any) {
      toast.error(err?.message || 'Could not save the template')
    } finally {
      setSaving(false)
    }
  }

  const fs = TEMPLATE_LIMITS.fontSize
  const off = TEMPLATE_LIMITS.offset

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Edit price tag template">
      <div className="bg-background border border-foreground/10 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-foreground/[0.06]">
          <div>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.15em] text-foreground">Edit Template</h2>
            <p className="text-[9px] text-foreground/40 uppercase tracking-[0.1em] mt-0.5">50 × 100 mm thermal label · preview is the printed PDF</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-foreground/[0.06]">
            <X className="w-4 h-4 text-foreground/60" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-[1fr_300px] gap-6 p-6">
          {/* Controls */}
          <div className="space-y-6">
            <Section title="Logo">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} className={btn}>
                  <Upload className="w-3 h-3" /> Replace logo
                </button>
                {tpl.logo.src && (
                  <button type="button" onClick={() => update({ logo: { ...tpl.logo, src: null, show: true } })} className={btn}>
                    <ImageIcon className="w-3 h-3" /> Use standard logo
                  </button>
                )}
                <button type="button" onClick={() => update({ logo: { ...tpl.logo, show: !tpl.logo.show } })} className={btn}>
                  {tpl.logo.show ? <ImageOff className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                  {tpl.logo.show ? 'Remove logo' : 'Show logo'}
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { handleLogoFile(e.target.files?.[0]); e.target.value = '' }} />
              </div>
              {tpl.logo.show && (
                <>
                  <Slider label="Logo size" unit="mm" value={tpl.logo.size} min={TEMPLATE_LIMITS.logoSize.min} max={TEMPLATE_LIMITS.logoSize.max} step={0.5} onChange={(v) => update({ logo: { ...tpl.logo, size: v } })} />
                  <Slider label="Logo left / right" unit="mm" value={tpl.logo.offsetX} min={off.min} max={off.max} step={0.5} onChange={(v) => update({ logo: { ...tpl.logo, offsetX: v } })} />
                  <Slider label="Logo up / down" unit="mm" value={tpl.logo.offsetY} min={off.min} max={off.max} step={0.5} onChange={(v) => update({ logo: { ...tpl.logo, offsetY: v } })} />
                </>
              )}
            </Section>

            <Section title="Text">
              <label className="flex items-center justify-between gap-3 text-[10px] text-foreground/70">
                Font style
                <select
                  value={tpl.fontFamily}
                  onChange={(e) => update({ fontFamily: e.target.value as TagTemplate['fontFamily'] })}
                  className="bg-background border border-foreground/10 rounded-md px-2 py-1 text-[11px]"
                >
                  <option value="helvetica">Helvetica (sans-serif)</option>
                  <option value="times">Times (serif)</option>
                  <option value="courier">Courier (monospace)</option>
                </select>
              </label>
              <StyleRow label="MRP + price" style={tpl.mrp} min={fs.min} max={fs.max} onChange={(p) => updateStyle('mrp', p)} />
              <StyleRow label="“Inclusive of all taxes”" style={tpl.taxes} min={fs.min} max={fs.max} onChange={(p) => updateStyle('taxes', p)} />
              <StyleRow label="Detail labels" style={tpl.infoLabel} min={fs.min} max={fs.max} onChange={(p) => updateStyle('infoLabel', p)} />
              <StyleRow label="Detail values" style={tpl.infoValue} min={fs.min} max={fs.max} onChange={(p) => updateStyle('infoValue', p)} />
              <StyleRow label="SKU" style={tpl.sku} min={fs.min} max={fs.max} onChange={(p) => updateStyle('sku', p)} />
              <Slider label="Text left / right" unit="mm" value={tpl.textOffsetX} min={off.min} max={off.max} step={0.5} onChange={(v) => update({ textOffsetX: v })} />
              <Slider label="Text up / down" unit="mm" value={tpl.textOffsetY} min={off.min} max={off.max} step={0.5} onChange={(v) => update({ textOffsetY: v })} />
            </Section>

            <Section title="QR code">
              <Slider label="QR size" unit="mm" value={tpl.qr.size} min={TEMPLATE_LIMITS.qrSize.min} max={TEMPLATE_LIMITS.qrSize.max} step={0.5} onChange={(v) => update({ qr: { ...tpl.qr, size: v } })} />
              <Slider label="QR left / right" unit="mm" value={tpl.qr.offsetX} min={off.min} max={off.max} step={0.5} onChange={(v) => update({ qr: { ...tpl.qr, offsetX: v } })} />
              <Slider label="QR up / down" unit="mm" value={tpl.qr.offsetY} min={off.min} max={off.max} step={0.5} onChange={(v) => update({ qr: { ...tpl.qr, offsetY: v } })} />
            </Section>
          </div>

          {/* Preview */}
          <div className="space-y-3">
            <div className="rounded-xl border border-foreground/10 bg-foreground/[0.02] overflow-hidden" style={{ aspectRatio: '1 / 2' }}>
              {previewUrl ? (
                <iframe title="Price tag preview" src={`${previewUrl}#toolbar=0&navpanes=0&view=Fit`} className="w-full h-full bg-white" />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-foreground/40" /></div>
              )}
            </div>
            {overflow && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[10px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                The content runs past the bottom of the label. Make the text, logo or QR code smaller, or move them up.
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-t border-foreground/[0.06]">
          <button type="button" onClick={() => setTpl(DEFAULT_TAG_TEMPLATE)} className={btn}>
            <RotateCcw className="w-3 h-3" /> Reset to original design
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btn}>Cancel</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-[10px] font-semibold uppercase tracking-[0.1em] hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save as default
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const btn =
  'flex items-center gap-1.5 px-3 py-2 bg-foreground/[0.04] border border-foreground/[0.08] text-foreground/80 rounded-lg text-[9px] font-semibold uppercase tracking-[0.1em] hover:bg-foreground/[0.08] transition-colors'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-foreground/40">{title}</h3>
      {children}
    </div>
  )
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-[10px] text-foreground/70">
      <span className="w-36 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-foreground" />
      <span className="w-14 text-right tabular-nums text-foreground/50">{value} {unit}</span>
    </label>
  )
}

function StyleRow({ label, style, min, max, onChange }: { label: string; style: TagTextStyle; min: number; max: number; onChange: (p: Partial<TagTextStyle>) => void }) {
  return (
    <div className="flex items-center gap-3 text-[10px] text-foreground/70">
      <span className="w-36 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={0.1} value={style.size} onChange={(e) => onChange({ size: Number(e.target.value) })} className="flex-1 accent-foreground" />
      <span className="w-12 text-right tabular-nums text-foreground/50">{style.size} pt</span>
      <label className="flex items-center gap-1 cursor-pointer select-none">
        <input type="checkbox" checked={style.bold} onChange={(e) => onChange({ bold: e.target.checked })} className="accent-foreground" />
        Bold
      </label>
    </div>
  )
}
