'use client';
/**
 * Browser runtime for Meta consent gating (see lib/meta/consent.ts for the rules
 * and the environment variables). With no regions configured every function is a
 * no-op pass-through, so existing behaviour is unchanged.
 *
 * Two things are held while consent is pending for a visitor in a consent region:
 *   1. the Pixel — fbq('consent','revoke') is issued by the inline snippet before
 *      init (app/layout.tsx); the SDK queues events until fbq('consent','grant');
 *   2. the browser→CAPI relay — callers wrap their fetch in whenMetaConsentAllows();
 *      pending calls are queued (bounded) and flushed on grant, dropped on deny.
 */
import { getClientCookie, setClientCookie, withFbq } from '@/lib/metaPixel';
import { CONSENT_COOKIE, GEO_COUNTRY_COOKIE, parseConsentRegions, consentState, inConsentRegion, type ConsentState } from './consent';

/** Regions needing opt-in, inlined at build time. Empty = gating off. */
export const META_CONSENT_REGIONS = parseConsentRegions(process.env.NEXT_PUBLIC_META_CONSENT_REGIONS);

type Listener = (state: ConsentState) => void;
const listeners = new Set<Listener>();
const pendingRelays: Array<() => void> = [];
const pendingDrops: Array<(() => void) | undefined> = [];
const MAX_QUEUE = 50;
let countryLookup: Promise<string | null> | null = null;

export function readMetaConsentState(): ConsentState {
  return consentState({
    regions: META_CONSENT_REGIONS,
    choice: getClientCookie(CONSENT_COOKIE),
    countryCode: getClientCookie(GEO_COUNTRY_COOKIE),
  });
}

/** true when the visitor must see the consent prompt (in a consent region, no choice yet). */
export function metaConsentPromptNeeded(): boolean {
  const s = readMetaConsentState();
  return s.gated && s.status === 'pending' && inConsentRegion(META_CONSENT_REGIONS, getClientCookie(GEO_COUNTRY_COOKIE));
}

function notify() {
  const s = readMetaConsentState();
  for (const l of Array.from(listeners)) { try { l(s); } catch { /* listener error must not break tracking */ } }
}

function flushQueue(run: boolean) {
  const q = pendingRelays.splice(0);
  const drops = pendingDrops.splice(0);
  if (!run) { for (const d of drops) { try { d?.(); } catch { /* ignore */ } } return; }
  for (const fn of q) { try { fn(); } catch { /* ignore */ } }
}

/**
 * Run `send` now when tracking is allowed; queue it while consent is pending;
 * drop it when consent was denied.
 */
export function whenMetaConsentAllows(send: () => void, onDrop?: () => void): void {
  const s = readMetaConsentState();
  if (!s.gated || s.status === 'granted') { send(); return; }
  if (s.status === 'denied') { onDrop?.(); return; }
  if (pendingRelays.length < MAX_QUEUE) { pendingRelays.push(send); pendingDrops.push(onDrop); return; }
  onDrop?.();
}

export function onMetaConsentChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Visitor accepted: remember for a year, release the Pixel and the queued relay calls. */
export function grantMetaConsent(): void {
  setClientCookie(CONSENT_COOKIE, 'granted', 365);
  withFbq((fbq) => fbq('consent', 'grant'), 'consent-grant');
  flushQueue(true);
  notify();
}

/** Visitor declined: remember for a year; the Pixel stays revoked and queued calls are dropped. */
export function denyMetaConsent(): void {
  setClientCookie(CONSENT_COOKIE, 'denied', 365);
  withFbq((fbq) => fbq('consent', 'revoke'), 'consent-revoke');
  flushQueue(false);
  notify();
}

/**
 * Make sure the visitor's country is known (cookie, else one /api/geo call), then
 * release tracking automatically for visitors outside the consent regions. Safe to
 * call on every page; the lookup runs at most once per page load.
 */
export function resolveMetaConsentCountry(): Promise<string | null> {
  if (META_CONSENT_REGIONS.size === 0) return Promise.resolve(null);
  const known = getClientCookie(GEO_COUNTRY_COOKIE);
  if (known && /^[A-Za-z]{2}$/.test(known)) { settle(known.toUpperCase()); return Promise.resolve(known.toUpperCase()); }
  if (!countryLookup) {
    countryLookup = (async () => {
      let cc: string | null = null;
      try {
        const res = await fetch('/api/geo', { cache: 'no-store' });
        const data = (res.ok ? await res.json() : null) as { ok?: boolean; countryCode?: unknown } | null;
        if (data?.ok && typeof data.countryCode === 'string' && /^[A-Za-z]{2}$/.test(data.countryCode)) cc = data.countryCode.toUpperCase();
      } catch { /* unknown stays pending: tracking is held, never assumed */ }
      if (cc) setClientCookie(GEO_COUNTRY_COOKIE, cc, 1);
      settle(cc);
      return cc;
    })();
  }
  return countryLookup;
}

function settle(cc: string | null) {
  const s = readMetaConsentState();
  if (!s.gated) {
    // Outside every consent region: the inline snippet may have revoked while the
    // country was unknown — release now (no choice is recorded).
    withFbq((fbq) => fbq('consent', 'grant'), 'consent-grant');
    flushQueue(true);
  }
  void cc;
  notify();
}
