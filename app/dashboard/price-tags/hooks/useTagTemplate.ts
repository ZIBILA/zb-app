'use client'

import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_TAG_TEMPLATE, normalizeTagTemplate, type TagTemplate } from '../utils/tagTemplate'

/** The saved default price tag template (shared), with save. */
export function useTagTemplate() {
  const [template, setTemplate] = useState<TagTemplate>(DEFAULT_TAG_TEMPLATE)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/price-tags/template')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.template) setTemplate(normalizeTagTemplate(data.template))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const saveTemplate = useCallback(async (next: TagTemplate) => {
    const res = await fetch('/api/admin/price-tags/template', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: next }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Could not save the template')
    const saved = normalizeTagTemplate(data.template)
    setTemplate(saved)
    return saved
  }, [])

  return { template, isLoaded, saveTemplate }
}
