'use client';
/**
 * Consent prompt for Meta tracking in the regions named by
 * NEXT_PUBLIC_META_CONSENT_REGIONS (lib/meta/consent.ts). Renders nothing when no
 * region is configured, on admin routes, outside the consent regions, or once the
 * visitor has chosen. Until the visitor accepts, the Pixel is held revoked (inline
 * snippet in app/layout.tsx) and the browser→CAPI relay is queued
 * (lib/meta/consent-client.ts).
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  META_CONSENT_REGIONS,
  resolveMetaConsentCountry,
  metaConsentPromptNeeded,
  grantMetaConsent,
  denyMetaConsent,
  onMetaConsentChange,
} from '@/lib/meta/consent-client';

export default function MetaConsentGate() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (META_CONSENT_REGIONS.size === 0) return;
    if (pathname.startsWith('/dashboard') || pathname.startsWith('/admin') || pathname.startsWith('/web-store')) return;
    let cancelled = false;
    const refresh = () => { if (!cancelled) setShow(metaConsentPromptNeeded()); };
    const off = onMetaConsentChange(refresh);
    resolveMetaConsentCountry().then(refresh).catch(refresh);
    return () => { cancelled = true; off(); };
  }, [pathname]);

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[90] border-t border-foreground/10 bg-background/95 backdrop-blur px-4 py-4 sm:px-6"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-foreground/80">
          We use cookies and similar technologies to measure our advertising and personalise it. You can accept or decline;
          essential site features work either way.{' '}
          <Link href="/policies/privacy-policy" className="underline underline-offset-2 hover:text-foreground">
            Privacy policy
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => { denyMetaConsent(); setShow(false); }}
            className="rounded-full border border-foreground/20 px-4 py-2 text-sm text-foreground/80 hover:bg-foreground/5"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => { grantMetaConsent(); setShow(false); }}
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
