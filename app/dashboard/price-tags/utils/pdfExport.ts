/**
 * PDF Export Utility for Price Tags
 * 
 * Uses jsPDF native drawing API to generate print-ready A4 PDFs or Thermal Labels.
 * Each tag is drawn directly (text, lines, images) for crisp output.
 * 
 * Layouts:
 * 1. A4 Portrait (210mm × 297mm) - Fits standard A4 sheet with 10mm margins.
 * 2. Thermal Label (50mm × 100mm) - Fits thermal labels (e.g. Toshiba BA400) with 3mm margins.
 */

import jsPDF from 'jspdf'
import type { TagData } from './skuGenerator'
import { DEFAULT_LOGO_SRC, DEFAULT_TAG_TEMPLATE, type TagTemplate } from './tagTemplate'

// ── Layout constants ──────────────────────────────────────────
export type PDFLayoutType = 'a4' | 'thermal'

// ── Helper: load image as base64 data URL ─────────────────────
// SVG files are rasterized onto a high-res 512x512 canvas for crisp PDF rendering.
async function loadImageAsDataURL(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const size = 512
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    img.src = src
  })
}

// ── Helper: Draw vector Indian Rupee symbol next to MRP ───────
function drawRupeeVector(pdf: jsPDF, x: number, y: number, h: number) {
  const w = h * 0.70 // width is 70% of height
  const thick = h * 0.125 // bold line thickness (12.5% of height)
  
  pdf.setLineWidth(thick)
  pdf.setDrawColor(17, 17, 17)
  
  // 1. Vertical stem (located at 30% of width, only in upper half)
  const stemX = x + w * 0.3
  const stemEndY = y + h * 0.52
  pdf.line(stemX, y, stemX, stemEndY)
  
  // 2. Top horizontal bar
  pdf.line(x, y + thick/2, x + w, y + thick/2)
  
  // 3. Middle horizontal bar
  pdf.line(x, y + h * 0.30, x + w * 0.85, y + h * 0.30)
  
  // 4. Curved loop (upper-right loop)
  const loopTopY = y
  const loopBotY = stemEndY
  const loopRightX = x + w
  
  pdf.moveTo(stemX, loopTopY)
  pdf.curveTo(loopRightX, loopTopY, loopRightX, loopBotY, stemX, loopBotY)
  
  // 5. Diagonal leg (starts at bottom of loop and goes to bottom right)
  pdf.moveTo(stemX, loopBotY)
  pdf.lineTo(x + w * 0.85, y + h)
  
  pdf.stroke()
}

/** 1 pt in mm. */
const PT = 0.3528

/**
 * Thermal label (50 × 100 mm) drawn from the editable template. DEFAULT_TAG_TEMPLATE prints the layout that was
 * hard-coded before (same text, positions within 0.1 mm). Returns the bottom of the drawn content (mm) so the editor can warn
 * when larger text no longer fits on the label.
 */
function drawThermalTag(pdf: jsPDF, tag: TagData, x: number, y: number, logoDataUrl: string | null, tpl: TagTemplate): number {
  const tagW = 44
  const pad = 3
  const contentX = x + pad
  const contentW = tagW - 2 * pad
  const rightX = x + tagW - pad
  const font = (style: { bold: boolean }, family: string = tpl.fontFamily) => pdf.setFont(family, style.bold ? 'bold' : 'normal')

  let curY = y + pad + 1.5

  // ── Logo ──
  if (tpl.logo.show) {
    const size = tpl.logo.size
    const logoX = x + (tagW - size) / 2 + tpl.logo.offsetX
    const logoY = curY + tpl.logo.offsetY
    let drawn = false
    if (logoDataUrl) {
      try {
        pdf.addImage(logoDataUrl, 'PNG', logoX, logoY, size, size)
        drawn = true
      } catch {
        /* text fallback below */
      }
    }
    if (!drawn) {
      pdf.setFontSize(8)
      pdf.setFont(tpl.fontFamily, 'bold')
      pdf.setTextColor(30, 30, 30)
      pdf.text('ZICA BELLA', x + tagW / 2 + tpl.logo.offsetX, logoY + 4, { align: 'center' })
    }
    curY += size + 2.5
  }

  // ── Text block (MRP + details), moved together by textOffsetX / textOffsetY ──
  const tx = tpl.textOffsetX
  const ty = tpl.textOffsetY
  pdf.setDrawColor(220, 220, 220)
  pdf.setLineWidth(0.15)
  pdf.line(contentX + tx, curY + ty, rightX + tx, curY + ty)
  curY += 2.5

  const mrpSize = tpl.mrp.size
  const mrpBase = curY + mrpSize * PT * 0.75
  pdf.setFontSize(mrpSize)
  font(tpl.mrp)
  pdf.setTextColor(17, 17, 17)
  pdf.text('MRP', contentX + tx, mrpBase + ty)
  const priceValStr = tag.mrp.toLocaleString('en-IN')
  const priceW = pdf.getTextWidth(priceValStr)
  const rupeeH = mrpSize * 0.24
  const rupeeW = rupeeH * 0.7
  drawRupeeVector(pdf, rightX + tx - priceW - rupeeW - rupeeH * 0.33, mrpBase + ty - rupeeH, rupeeH)
  pdf.text(priceValStr, rightX + tx, mrpBase + ty, { align: 'right' })
  curY += mrpSize * PT * 1.7

  const taxSize = tpl.taxes.size
  pdf.setFontSize(taxSize)
  font(tpl.taxes)
  pdf.setTextColor(140, 140, 140)
  pdf.text('INCLUSIVE OF ALL TAXES', contentX + tx, curY + taxSize * PT * 0.4 + ty)
  curY += taxSize * PT * 2

  pdf.setDrawColor(220, 220, 220)
  pdf.line(contentX + tx, curY + ty, rightX + tx, curY + ty)
  curY += 3.5

  const infoRows = [
    ['NET QUANTITY', tag.netQuantity || '1 Pc'],
    ['SIZE', tag.size],
    ['MFG & MKT BY', 'ZICA BELLA PVT. LTD.'],
    ['GENERIC NAME', tag.genericName],
    ['COUNTRY OF ORIGIN', 'INDIA'],
    ['CC', 'care@zicabella.com'],
    ['MFG ON', tag.mfgDate],
    ['EMAIL', 'support@zicabella.com'],
  ]
  const rowFont = Math.max(tpl.infoLabel.size, tpl.infoValue.size)
  const rowH = rowFont * PT * 2.09
  const rowBase = rowFont * PT * 1.01
  for (const [label, value] of infoRows) {
    pdf.setFontSize(tpl.infoLabel.size)
    font(tpl.infoLabel)
    pdf.setTextColor(80, 80, 80)
    pdf.text(label, contentX + tx, curY + rowBase + ty)
    const labelWidth = pdf.getTextWidth(label)

    pdf.setFontSize(tpl.infoValue.size)
    font(tpl.infoValue)
    pdf.setTextColor(17, 17, 17)
    const maxValW = contentW - labelWidth - 2
    let displayVal = String(value ?? '')
    while (pdf.getTextWidth(displayVal) > maxValW && displayVal.length > 3) {
      displayVal = displayVal.slice(0, -1)
    }
    pdf.text(displayVal, rightX + tx, curY + rowBase + ty, { align: 'right' })
    curY += rowH
  }
  curY += 1.5

  // ── QR separator ──
  pdf.setDrawColor(220, 220, 220)
  pdf.setLineWidth(0.15)
  pdf.line(contentX, curY, rightX, curY)
  curY += 2.5

  // ── QR code + SKU, moved together by qr.offsetX / qr.offsetY ──
  const qx = tpl.qr.offsetX
  const qy = tpl.qr.offsetY
  if (tag.qrDataUrl && tag.qrDataUrl.startsWith('data:')) {
    const qrSize = tpl.qr.size
    try {
      pdf.addImage(tag.qrDataUrl, 'PNG', x + (tagW - qrSize) / 2 + qx, curY + qy, qrSize, qrSize)
    } catch {
      // Skip if QR fails
    }
    curY += qrSize + 1.5
  } else {
    curY += 3
  }

  const skuSize = tpl.sku.size
  pdf.setFontSize(skuSize)
  pdf.setFont('courier', tpl.sku.bold ? 'bold' : 'normal')
  pdf.setTextColor(50, 50, 50)
  pdf.text(tag.sku, x + tagW / 2 + qx, curY + skuSize * PT * 0.67 + qy, { align: 'center' })
  return Math.max(curY + skuSize * PT + qy, curY + ty)
}

// ── Draw a single price tag ──────────────────────────────────
function drawTag(
  pdf: jsPDF,
  tag: TagData,
  x: number,
  y: number,
  logoDataUrl: string | null,
  layout: PDFLayoutType = 'a4',
  template: TagTemplate = DEFAULT_TAG_TEMPLATE
) {
  if (layout === 'thermal') {
    drawThermalTag(pdf, tag, x, y, logoDataUrl, template)
    return
  }
  const isThermal = false
  
  // Dimensions based on page layout
  const tagW = isThermal ? 44 : 190
  const tagH = isThermal ? 94 : 277
  const pad = isThermal ? 3 : 12
  const contentX = x + pad
  const contentW = tagW - 2 * pad
  const rightX = x + tagW - pad

  // ── No outer border for a clean full-page minimal look.
  let curY = y + pad + (isThermal ? 1.5 : 6)

  // ── Logo ──
  // Brand logo is 1:1 ratio. Render at 26mm × 26mm (A4) or 8mm × 8mm (Thermal).
  if (logoDataUrl) {
    const logoSize = isThermal ? 8 : 26
    const logoX = x + (tagW - logoSize) / 2
    try {
      pdf.addImage(logoDataUrl, 'PNG', logoX, curY, logoSize, logoSize)
    } catch {
      pdf.setFontSize(isThermal ? 8 : 24)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(30, 30, 30)
      pdf.text('ZICA BELLA', x + tagW / 2, curY + (isThermal ? 4 : 12), { align: 'center' })
    }
    curY += logoSize + (isThermal ? 2.5 : 10)
  } else {
    pdf.setFontSize(isThermal ? 8 : 24)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(30, 30, 30)
    pdf.text('ZICA BELLA', x + tagW / 2, curY + (isThermal ? 4 : 12), { align: 'center' })
    curY += isThermal ? 8 : 30
  }

  // ── MRP section with top border ──
  pdf.setDrawColor(220, 220, 220)
  pdf.setLineWidth(isThermal ? 0.15 : 0.3)
  pdf.line(contentX, curY, rightX, curY)
  curY += isThermal ? 2.5 : 8

  pdf.setFontSize(isThermal ? 7.5 : 24)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(17, 17, 17)
  pdf.text('MRP', contentX, curY + (isThermal ? 2 : 6))

  // Align custom Rupee vector symbol with the baseline of text
  const priceValStr = tag.mrp.toLocaleString('en-IN')
  const priceW = pdf.getTextWidth(priceValStr)

  const rupeeH = isThermal ? 1.8 : 6.0
  const rupeeW = rupeeH * 0.70
  const gap = isThermal ? 0.6 : 2.0

  const rupeeX = rightX - priceW - rupeeW - gap
  const rupeeY = curY + (isThermal ? 2 : 6) - rupeeH

  drawRupeeVector(pdf, rupeeX, rupeeY, rupeeH)
  pdf.text(priceValStr, rightX, curY + (isThermal ? 2 : 6), { align: 'right' })
  curY += isThermal ? 4.5 : 14

  // "Inclusive of All Taxes"
  pdf.setFontSize(isThermal ? 3.5 : 10.5)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(140, 140, 140)
  pdf.text('INCLUSIVE OF ALL TAXES', contentX, curY + (isThermal ? 0.5 : 2))
  curY += isThermal ? 2.5 : 8

  // Bottom divider
  pdf.setDrawColor(220, 220, 220)
  pdf.line(contentX, curY, rightX, curY)
  curY += isThermal ? 3.5 : 12

  // ── Info rows ──
  const infoRows = [
    ['NET QUANTITY', tag.netQuantity || '1 Pc'],
    ['SIZE', tag.size],
    ['MFG & MKT BY', 'ZICA BELLA PVT. LTD.'],
    ['GENERIC NAME', tag.genericName],
    ['COUNTRY OF ORIGIN', 'INDIA'],
    ['CC', 'care@zicabella.com'],
    ['MFG ON', tag.mfgDate],
    ['EMAIL', 'support@zicabella.com'],
  ]

  const rowH = isThermal ? 3.1 : 11.5
  pdf.setFontSize(isThermal ? 4.2 : 12.5)

  for (const [label, value] of infoRows) {
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(80, 80, 80)
    pdf.text(label, contentX, curY + (isThermal ? 1.5 : 5))

    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(17, 17, 17)
    
    // Truncate long values to fit
    const labelWidth = pdf.getTextWidth(label)
    const maxValW = contentW - labelWidth - (isThermal ? 2 : 6)
    let displayVal = value
    while (pdf.getTextWidth(displayVal) > maxValW && displayVal.length > 3) {
      displayVal = displayVal.slice(0, -1)
    }
    pdf.text(displayVal, rightX, curY + (isThermal ? 1.5 : 5), { align: 'right' })
    curY += rowH
  }

  curY += isThermal ? 1.5 : 4

  // ── QR separator ──
  pdf.setDrawColor(220, 220, 220)
  pdf.setLineWidth(isThermal ? 0.15 : 0.3)
  pdf.line(contentX, curY, rightX, curY)
  curY += isThermal ? 2.5 : 10

  // ── QR Code ──
  if (tag.qrDataUrl && tag.qrDataUrl.startsWith('data:')) {
    const qrSize = isThermal ? 20 : 52
    const qrX = x + (tagW - qrSize) / 2
    try {
      pdf.addImage(tag.qrDataUrl, 'PNG', qrX, curY, qrSize, qrSize)
    } catch {
      // Skip if QR fails
    }
    curY += qrSize + (isThermal ? 1.5 : 6)
  } else {
    curY += isThermal ? 3 : 10
  }

  // ── SKU ──
  pdf.setFontSize(isThermal ? 4.2 : 13)
  pdf.setFont('courier', 'bold')
  pdf.setTextColor(50, 50, 50)
  pdf.text(tag.sku, x + tagW / 2, curY + (isThermal ? 1 : 3), { align: 'center' })
}

// ── Build the PDF (shared by download, print and the template editor preview) ──
async function loadTemplateLogo(template: TagTemplate): Promise<string | null> {
  if (!template.logo.show) return null
  try {
    return await loadImageAsDataURL(template.logo.src || DEFAULT_LOGO_SRC)
  } catch {
    console.warn('Could not load logo for PDF, using text fallback')
    return null
  }
}

export async function buildTagsPDF(
  tags: TagData[],
  layout: PDFLayoutType = 'thermal',
  template: TagTemplate = DEFAULT_TAG_TEMPLATE
): Promise<{ pdf: jsPDF; overflow: boolean }> {
  const isThermal = layout === 'thermal'
  const pageFormat = isThermal ? [50, 100] : 'a4'
  const pdf = new jsPDF({ unit: 'mm', format: pageFormat, orientation: 'portrait' })
  const logoDataUrl = await loadTemplateLogo(template)
  const marginX = isThermal ? 3 : 10
  const marginY = isThermal ? 3 : 10
  let overflow = false
  for (let i = 0; i < tags.length; i++) {
    if (i > 0) pdf.addPage(pageFormat, 'portrait')
    if (isThermal) {
      const bottom = drawThermalTag(pdf, tags[i], marginX, marginY, logoDataUrl, template)
      if (bottom > 99) overflow = true
    } else {
      drawTag(pdf, tags[i], marginX, marginY, logoDataUrl, layout, template)
    }
  }
  return { pdf, overflow }
}

// ── Main export function ──────────────────────────────────────
export async function downloadTagsPDF(
  tags: TagData[],
  filename?: string,
  layout: PDFLayoutType = 'a4',
  template: TagTemplate = DEFAULT_TAG_TEMPLATE
): Promise<void> {
  if (tags.length === 0) return
  const { pdf } = await buildTagsPDF(tags, layout, template)
  pdf.save(filename || `zicabella-price-tags-${Date.now()}.pdf`)
}

// ── Print helper: open printable PDF in new tab ───────────────
export async function printTagsPDF(
  tags: TagData[],
  layout: PDFLayoutType = 'a4',
  template: TagTemplate = DEFAULT_TAG_TEMPLATE
): Promise<void> {
  if (tags.length === 0) return
  const { pdf } = await buildTagsPDF(tags, layout, template)

  // Open in new tab for printing
  const pdfBlob = pdf.output('blob')
  const pdfUrl = URL.createObjectURL(pdfBlob)
  const printWindow = window.open(pdfUrl, '_blank')
  if (printWindow) {
    printWindow.addEventListener('load', () => {
      setTimeout(() => {
        printWindow.print()
      }, 500)
    })
  }
}
