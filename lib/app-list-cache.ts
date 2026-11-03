/**
 * Response cache for the mobile app's product list endpoint.
 *
 * The list (`/api/app/products`) re-read the whole catalogue, fetched every product's metafields and flattened ~90
 * products on EVERY request (3.5 to 6 seconds), and the home screen waits for it. Now the finished JSON is kept in
 * memory: served instantly while fresh, served instantly while stale (and rebuilt in the background), and rebuilt once
 * (not once per shopper) when nothing is cached. If a rebuild fails the last good copy keeps being served.
 *
 * Catalogue / CMS changes clear it through refreshStorefront() (lib/storefrontRefresh.ts).
 */

const FRESH_MS = 60_000; // served as is
const STALE_MS = 10 * 60_000; // served immediately, rebuilt in the background
const MAX_ENTRIES = 50;

interface Entry {
  json: string;
  at: number;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

export type CacheState = 'hit' | 'stale' | 'miss';

function rebuild(key: string, build: () => Promise<unknown>): Promise<Entry> {
  let run = inflight.get(key);
  if (!run) {
    run = build()
      .then((body) => {
        const entry: Entry = { json: JSON.stringify(body), at: Date.now() };
        if (store.size >= MAX_ENTRIES && !store.has(key)) store.delete(store.keys().next().value as string);
        store.set(key, entry);
        return entry;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, run);
  }
  return run;
}

export async function cachedAppList(
  key: string,
  build: () => Promise<unknown>,
): Promise<{ json: string; state: CacheState; ageMs: number }> {
  const now = Date.now();
  const entry = store.get(key);
  if (entry && now - entry.at < FRESH_MS) return { json: entry.json, state: 'hit', ageMs: now - entry.at };
  if (entry && now - entry.at < STALE_MS) {
    rebuild(key, build).catch((err) => console.warn('[App List Cache] background refresh failed:', err?.message || err));
    return { json: entry.json, state: 'stale', ageMs: now - entry.at };
  }
  try {
    const fresh = await rebuild(key, build);
    return { json: fresh.json, state: 'miss', ageMs: 0 };
  } catch (err) {
    // Shopify hiccup: an old copy is better than an empty home screen.
    if (entry) return { json: entry.json, state: 'stale', ageMs: now - entry.at };
    throw err;
  }
}

export function clearAppListCache() {
  store.clear();
  inflight.clear();
}
