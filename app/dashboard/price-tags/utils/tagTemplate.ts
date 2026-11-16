/**
 * Editable price tag template (50 × 100 mm thermal label).
 *
 * Sizes are in points (pt) and positions in millimetres, as printed. The defaults are the layout that was hard-coded
 * before, so an unchanged template prints the same tag. Saved as the shared default through
 * /api/admin/price-tags/template.
 */

export type TagFontFamily = 'helvetica' | 'times' | 'courier'

export interface TagTextStyle {
  /** Font size in points. */
  size: number
  bold: boolean
}

export interface TagTemplate {
  logo: {
    show: boolean
    /** Uploaded image as a data URL; null = the standard Zica Bella logo. */
    src: string | null
    /** Width and height in mm (square). */
    size: number
    offsetX: number
    offsetY: number
  }
  fontFamily: TagFontFamily
  mrp: TagTextStyle
  taxes: TagTextStyle
  infoLabel: TagTextStyle
  infoValue: TagTextStyle
  sku: TagTextStyle
  /** Moves the whole text block (MRP + details) in mm. */
  textOffsetX: number
  textOffsetY: number
  qr: {
    /** Width and height in mm. */
    size: number
    offsetX: number
    offsetY: number
  }
}

export const DEFAULT_LOGO_SRC = '/zb-price-tag-logo.png'

export const DEFAULT_TAG_TEMPLATE: TagTemplate = {
  logo: { show: true, src: null, size: 8, offsetX: 0, offsetY: 0 },
  fontFamily: 'helvetica',
  mrp: { size: 7.5, bold: true },
  taxes: { size: 3.5, bold: false },
  infoLabel: { size: 4.2, bold: true },
  infoValue: { size: 4.2, bold: false },
  sku: { size: 4.2, bold: true },
  textOffsetX: 0,
  textOffsetY: 0,
  qr: { size: 20, offsetX: 0, offsetY: 0 },
}

/** Allowed ranges for the editor and for anything loaded from the server. */
export const TEMPLATE_LIMITS = {
  fontSize: { min: 2.5, max: 16 },
  logoSize: { min: 4, max: 30 },
  qrSize: { min: 10, max: 32 },
  offset: { min: -20, max: 20 },
}

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10))
}

const style = (v: any, d: TagTextStyle): TagTextStyle => ({
  size: clamp(v?.size, TEMPLATE_LIMITS.fontSize.min, TEMPLATE_LIMITS.fontSize.max, d.size),
  bold: typeof v?.bold === 'boolean' ? v.bold : d.bold,
})

/** Any stored / edited value → a complete, in-range template (missing fields take the defaults). */
export function normalizeTagTemplate(raw: any): TagTemplate {
  const d = DEFAULT_TAG_TEMPLATE
  const o = TEMPLATE_LIMITS.offset
  const src = typeof raw?.logo?.src === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(raw.logo.src) ? raw.logo.src : null
  return {
    logo: {
      show: typeof raw?.logo?.show === 'boolean' ? raw.logo.show : d.logo.show,
      src,
      size: clamp(raw?.logo?.size, TEMPLATE_LIMITS.logoSize.min, TEMPLATE_LIMITS.logoSize.max, d.logo.size),
      offsetX: clamp(raw?.logo?.offsetX, o.min, o.max, 0),
      offsetY: clamp(raw?.logo?.offsetY, o.min, o.max, 0),
    },
    fontFamily: ['helvetica', 'times', 'courier'].includes(raw?.fontFamily) ? raw.fontFamily : d.fontFamily,
    mrp: style(raw?.mrp, d.mrp),
    taxes: style(raw?.taxes, d.taxes),
    infoLabel: style(raw?.infoLabel, d.infoLabel),
    infoValue: style(raw?.infoValue, d.infoValue),
    sku: style(raw?.sku, d.sku),
    textOffsetX: clamp(raw?.textOffsetX, o.min, o.max, 0),
    textOffsetY: clamp(raw?.textOffsetY, o.min, o.max, 0),
    qr: {
      size: clamp(raw?.qr?.size, TEMPLATE_LIMITS.qrSize.min, TEMPLATE_LIMITS.qrSize.max, d.qr.size),
      offsetX: clamp(raw?.qr?.offsetX, o.min, o.max, 0),
      offsetY: clamp(raw?.qr?.offsetY, o.min, o.max, 0),
    },
  }
}

/** CSS font stack for the on-screen preview card. */
export const CSS_FONT: Record<TagFontFamily, string> = {
  helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
}
