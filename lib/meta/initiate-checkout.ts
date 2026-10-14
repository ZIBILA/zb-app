/**
 * One Meta InitiateCheckout per checkout attempt.
 *
 * `/checkout` renders once for a guest (InitiateCheckout fires, then the page
 * redirects to /login), and once more after the hard redirect back from login —
 * a remount with fresh React state, so the same shopper and the same cart
 * produced a second InitiateCheckout with a new event_id that Meta cannot
 * deduplicate. The marker below lives in sessionStorage (survives the remount,
 * dies with the tab) and is keyed by the cart's variant ids and units: a changed
 * cart, a new tab or a visit more than 30 minutes later is a new attempt.
 *
 * Isomorphic and dependency-free; the store is injected so it can be unit-tested
 * (scripts/verify-meta-initiate-checkout.ts).
 */

export const META_IC_MARKER_KEY = 'zb_meta_ic';
/** A checkout attempt older than this is a new attempt. */
export const META_IC_MARKER_TTL_MS = 30 * 60 * 1000;

export interface MarkerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Stable cart key from the lines Meta will report: `id:qty` pairs, sorted. */
export function initiateCheckoutCartKey(lines: Array<{ id: string; quantity?: number }> | undefined, ids?: string[]): string {
  const pairs = (lines && lines.length ? lines : (ids || []).map(id => ({ id, quantity: 1 })))
    .filter(l => l && l.id)
    .map(l => `${l.id}:${Math.max(1, Number(l.quantity) || 1)}`)
    .sort();
  return pairs.join('|');
}

function defaultStore(): MarkerStore | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch { /* private mode / disabled */ }
  return null;
}

/**
 * Claim this checkout attempt. Returns the event_id to use: the one stored for
 * this cart when the marker is fresh (so the caller knows it was already sent and
 * must NOT fire), or `null` when it was already fired. Concretely:
 *   - fresh marker for the same cart → { fire: false, eventId: <stored> }
 *   - otherwise → { fire: true, eventId } and the marker is written.
 * Without any store (SSR, storage blocked) it always fires — the in-memory 1 s
 * dedup in useMetaEvents still covers React double-invocation.
 */
export function claimInitiateCheckout(
  cartKey: string,
  eventId: string,
  opts: { nowMs?: number; store?: MarkerStore | null; ttlMs?: number } = {},
): { fire: boolean; eventId: string } {
  const store = opts.store === undefined ? defaultStore() : opts.store;
  const now = opts.nowMs ?? Date.now();
  const ttl = opts.ttlMs ?? META_IC_MARKER_TTL_MS;
  if (!store) return { fire: true, eventId };
  try {
    const raw = store.getItem(META_IC_MARKER_KEY);
    if (raw) {
      const m = JSON.parse(raw) as { eventId?: string; cartKey?: string; at?: number };
      if (m && m.cartKey === cartKey && typeof m.at === 'number' && now - m.at >= 0 && now - m.at < ttl && m.eventId) {
        return { fire: false, eventId: m.eventId };
      }
    }
  } catch { /* corrupt marker: treat as absent */ }
  try {
    store.setItem(META_IC_MARKER_KEY, JSON.stringify({ eventId, cartKey, at: now }));
  } catch { /* quota / disabled: fire anyway */ }
  return { fire: true, eventId };
}
