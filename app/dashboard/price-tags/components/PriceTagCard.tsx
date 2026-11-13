'use client'

import React from 'react'
import type { TagData } from '../utils/skuGenerator'
import { CSS_FONT, DEFAULT_LOGO_SRC, DEFAULT_TAG_TEMPLATE, type TagTemplate } from '../utils/tagTemplate'

/** On-screen scale of the printed template: font pt → px and mm → px (calibrated so the default looks as before). */
const PX_PER_MM = 190 / 44
const fontPx = (pt: number, ratio: number, scale: number) => `${Math.round(pt * ratio * scale * 10) / 10}px`
const shift = (xMm: number, yMm: number, scale: number) =>
  xMm || yMm ? `translate(${Math.round(xMm * PX_PER_MM * scale)}px, ${Math.round(yMm * PX_PER_MM * scale)}px)` : undefined

interface PriceTagCardProps {
  tag: TagData
  index?: number
  selected?: boolean
  onToggleSelect?: () => void
  showCheckbox?: boolean
  /** Renders a slightly larger version for the live preview panel */
  isPreview?: boolean
  /** Saved default design (logo, fonts, sizes, positions). */
  template?: TagTemplate
}

export default function PriceTagCard({
  tag,
  index,
  selected,
  onToggleSelect,
  showCheckbox,
  isPreview = false,
  template = DEFAULT_TAG_TEMPLATE,
}: PriceTagCardProps) {
  const scale = isPreview ? 1.35 : 1
  const t = template

  return (
    <div
      className="price-tag-card relative"
      data-tag-index={index}
      style={{
        width: `${Math.round(190 * scale)}px`,
        backgroundColor: '#FFFFFF',
        border: '0.5px solid #d0d0d0',
        borderRadius: '3px',
        padding: `${Math.round(10 * scale)}px ${Math.round(8 * scale)}px ${Math.round(8 * scale)}px`,
        fontFamily: t.fontFamily === 'helvetica' ? "'Inter', 'Helvetica Neue', Arial, sans-serif" : CSS_FONT[t.fontFamily],
        color: '#111',
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        fontSize: `${Math.round(8 * scale)}px`,
        lineHeight: '1.35',
        pageBreakInside: 'avoid' as const,
        boxShadow: isPreview ? '0 2px 12px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      {/* Checkbox for selection */}
      {showCheckbox && (
        <label
          className="absolute top-1.5 left-1.5 z-10 cursor-pointer no-print"
          style={{ position: 'absolute', top: '4px', left: '4px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            style={{ width: '14px', height: '14px', accentColor: '#000', cursor: 'pointer' }}
          />
        </label>
      )}

      {/* Logo — rendered in square 1:1 ratio */}
      {t.logo.show && (
      <div 
        className="logo-container"
        style={{ 
          marginBottom: `${Math.round(6 * scale)}px`, 
          textAlign: 'center' as const,
          display: 'flex',
          justifyContent: 'center',
          width: '100%',
          transform: shift(t.logo.offsetX, t.logo.offsetY, scale),
        }}
      >
        <img
          className="logo-image"
          src={t.logo.src || DEFAULT_LOGO_SRC}
          alt="Zica Bella"
          style={{
            height: `${Math.round(t.logo.size * 5.5 * scale)}px`,
            width: `${Math.round(t.logo.size * 5.5 * scale)}px`,
            objectFit: 'contain' as const,
            filter: 'grayscale(100%) contrast(200%)',
          }}
          crossOrigin="anonymous"
        />
      </div>
      )}

      <div style={{ width: '100%', transform: shift(t.textOffsetX, t.textOffsetY, scale) }}>

      {/* MRP Section */}
      <div 
        className="mrp-section"
        style={{
          width: '100%',
          padding: `${Math.round(4 * scale)}px 0`,
          borderTop: '0.5px solid #ccc',
          marginBottom: `${Math.round(3 * scale)}px`,
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          width: '100%',
        }}>
          <span 
            className="mrp-title"
            style={{
              fontWeight: t.mrp.bold ? 700 : 400,
              fontSize: fontPx(t.mrp.size, 1.333, scale),
              letterSpacing: '0.5px',
              textTransform: 'uppercase' as const,
            }}
          >
            MRP
          </span>
          <span 
            className="mrp-value"
            style={{
              fontWeight: t.mrp.bold ? 700 : 400,
              fontSize: fontPx(t.mrp.size, 1.333, scale),
              letterSpacing: '0.3px',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                width: `${Math.round(8.5 * scale)}px`,
                height: `${Math.round(8.5 * scale)}px`,
                marginRight: `${Math.round(1 * scale)}px`,
                display: 'inline-block',
              }}
            >
              <path d="M6 3h12" />
              <path d="M6 8h12" />
              <path d="M6 3a5 5 0 0 1 5 5H6" />
              <path d="M6 8a5 5 0 0 1 5 5H6" />
              <path d="M6 13h5l4 7" />
            </svg>
            {tag.mrp.toLocaleString('en-IN')}
          </span>
        </div>
        <div 
          className="mrp-taxes"
          style={{
            fontSize: fontPx(t.taxes.size, 1.571, scale),
            fontWeight: t.taxes.bold ? 700 : 400,
            color: '#888',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.6px',
            marginTop: `${Math.round(1 * scale)}px`,
          }}
        >
          Inclusive of All Taxes
        </div>
      </div>

      {/* Divider */}
      <div 
        className="tag-divider"
        style={{ width: '100%', height: '0.5px', backgroundColor: '#ccc', marginBottom: `${Math.round(4 * scale)}px` }} 
      />

      {/* Info Rows */}
      <div 
        className="info-rows"
        style={{ width: '100%' }}
      >
        {([
          ['NET QUANTITY', tag.netQuantity],
          ['SIZE', tag.size],
          ['MFG & MKT BY', 'ZICA BELLA PVT. LTD.'],
          ['GENERIC NAME', tag.genericName],
          ['COUNTRY OF ORIGIN', 'INDIA'],
          ['CC', 'care@zicabella.com'],
          ['MFG ON', tag.mfgDate],
          ['EMAIL', 'support@zicabella.com'],
        ] as const).map(([label, value]) => (
          <InfoRow key={label} label={label} value={value} scale={scale} template={t} />
        ))}
      </div>
      </div>

      {/* QR Code — always at the bottom */}
      <div style={{ width: '100%', transform: shift(t.qr.offsetX, t.qr.offsetY, scale) }}>
      <div 
        className="qr-section"
        style={{
          marginTop: `${Math.round(6 * scale)}px`,
          textAlign: 'center' as const,
          paddingTop: `${Math.round(4 * scale)}px`,
          borderTop: '0.5px solid #e0e0e0',
          width: '100%',
          display: 'flex',
          flexDirection: 'column' as const,
          alignItems: 'center',
        }}
      >
        {tag.qrDataUrl && tag.qrDataUrl.startsWith('data:') ? (
          <img
            className="qr-image"
            src={tag.qrDataUrl}
            alt={`QR: ${tag.sku}`}
            style={{
              width: `${Math.round(t.qr.size * 3 * scale)}px`,
              height: `${Math.round(t.qr.size * 3 * scale)}px`,
              imageRendering: 'pixelated' as const,
            }}
          />
        ) : (
          <div style={{
            width: `${Math.round(60 * scale)}px`,
            height: `${Math.round(60 * scale)}px`,
            border: '1px dashed #ccc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: `${Math.round(5 * scale)}px`,
            color: '#aaa',
          }}>
            QR Code
          </div>
        )}
      </div>

      {/* SKU — at the very bottom */}
      <div 
        className="sku-text"
        style={{
          marginTop: `${Math.round(3 * scale)}px`,
          fontSize: fontPx(t.sku.size, 1.548, scale),
          fontWeight: t.sku.bold ? 600 : 400,
          letterSpacing: '0.4px',
          textAlign: 'center' as const,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          color: '#333',
          wordBreak: 'break-all' as const,
        }}
      >
        {tag.sku}
      </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value, scale = 1, template = DEFAULT_TAG_TEMPLATE }: { label: string; value: string; scale?: number; template?: TagTemplate }) {
  return (
    <div 
      className="info-row"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: `${Math.round(1.5 * scale)}px 0`,
        gap: `${Math.round(6 * scale)}px`,
      }}
    >
      <span 
        className="info-row-label"
        style={{
          fontWeight: template.infoLabel.bold ? 600 : 400,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.2px',
          color: '#333',
          whiteSpace: 'nowrap' as const,
          flexShrink: 0,
          fontSize: fontPx(template.infoLabel.size, 1.548, scale),
        }}
      >
        {label}
      </span>
      <span 
        className="info-row-value"
        style={{
          textAlign: 'right' as const,
          fontWeight: template.infoValue.bold ? 700 : 500,
          color: '#111',
          wordBreak: 'break-word' as const,
          fontSize: fontPx(template.infoValue.size, 1.548, scale),
        }}
      >
        {value}
      </span>
    </div>
  )
}
