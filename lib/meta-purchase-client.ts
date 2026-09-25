import { trackEvent } from './metaPixel';

const inFlight = new Map<string, Promise<boolean>>();

/** A browser page is not payment evidence. Only the server can supply this payload. */
export function trackVerifiedPurchase(orderId: string): Promise<boolean> {
  const existing = inFlight.get(orderId);
  if (existing) return existing;
  const run = async () => {
    const key = `meta_purchase_queued_v3_${orderId}`;
    try { if (sessionStorage.getItem(key)) return true; } catch {}
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(`/api/meta/purchase/${encodeURIComponent(orderId)}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          const payload = await response.json();
          if (payload.eventId === orderId && Number.isFinite(payload.customData?.value) && payload.customData.value > 0) {
            const queued = await trackEvent('Purchase', payload.customData, payload.eventId);
            if (queued) {
              // This marks SDK queueing, not proof of delivery to Meta. CAPI retries independently.
              try { sessionStorage.setItem(key, 'true'); } catch {}
              return true;
            }
          }
        }
      } catch { /* transient failure: retry the same verified order, never another cart's value */ }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
    }
    return false;
  };
  const promise = run().finally(() => inFlight.delete(orderId));
  inFlight.set(orderId, promise);
  return promise;
}
