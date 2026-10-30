/**
 * Decides what the cart should contain after loading the account's DB cart (pure — unit-testable).
 *
 * The cart lives in two places: this browser's localStorage and the account's DB cart. The old logic
 * UNION-merged them on every page load, so any line still in the DB (e.g. a removal whose sync never
 * landed) came back after refresh. Now:
 *  - real login on this browser (cart owner was a guest / another user) → union-merge, as before
 *  - same user returning → the NEWER copy wins outright; nothing is merged back in
 *  - user edited the cart while the DB request was in flight → keep their edit
 */

export interface CartLine {
  id: string;
  quantity: number;
}

/**
 *  updatedAt      client ms of the last change made on this device
 *  syncedLocalAt  the updatedAt value the DB last confirmed (updatedAt > syncedLocalAt ⇒ unsynced edits)
 *  syncedServerAt server lastActivityAt returned by that sync
 *  owner          who this cart belongs to: a user key, "guest", or null (saved before this bookkeeping)
 */
export interface CartMeta {
  updatedAt: number;
  syncedLocalAt: number;
  syncedServerAt: string | null;
  owner: string | null;
}

export const EMPTY_META: CartMeta = { updatedAt: 0, syncedLocalAt: 0, syncedServerAt: null, owner: null };

export function dedupeLines<T extends CartLine>(lines: T[]): T[] {
  const map = new Map<string, T>();
  for (const line of lines) {
    const ex = map.get(line.id);
    map.set(line.id, ex ? { ...ex, quantity: Math.max(ex.quantity, line.quantity) } : line);
  }
  return Array.from(map.values());
}

export type RestoreDecision<T> =
  /** keep this device's cart; `push` = it should be synced up as a fresh change */
  | { action: 'keep'; push: boolean }
  /** replace the device cart with `items`; `push` = sync it up; `adoptedServerAt` = DB copy taken as-is */
  | { action: 'replace'; items: T[]; push: boolean; adoptedServerAt?: string | null };

export function decideCartRestore<T extends CartLine>(args: {
  meta: CartMeta;
  localItems: T[];
  dbItems: T[];
  dbUpdatedAt: string | null;
  userKey: string | null;
  requestStartedAt: number;
}): RestoreDecision<T> {
  const { meta, localItems, userKey, requestStartedAt, dbUpdatedAt } = args;
  const dbItems = dedupeLines(args.dbItems);

  if (meta.updatedAt > requestStartedAt) {
    return { action: 'keep', push: false }; // edited mid-request — the edit's own sync will push it
  }

  if (meta.owner === null) {
    // Can't tell which copy is newer. Never resurrect lines the device no longer has.
    return localItems.length > 0 ? { action: 'keep', push: true } : { action: 'replace', items: dbItems, push: true };
  }

  if (meta.owner !== userKey) {
    // Real login on this browser: guest cart + account cart. Max quantity, never summed.
    return dbItems.length > 0
      ? { action: 'replace', items: dedupeLines([...localItems, ...dbItems]), push: true }
      : { action: 'keep', push: true };
  }

  const hasUnsyncedEdits = meta.updatedAt > meta.syncedLocalAt;
  const dbIsNewer =
    Boolean(dbUpdatedAt) &&
    (!meta.syncedServerAt || new Date(dbUpdatedAt!).getTime() > new Date(meta.syncedServerAt).getTime());
  if (!hasUnsyncedEdits && dbIsNewer) {
    // Changed on another device since this one last synced.
    return { action: 'replace', items: dbItems, push: false, adoptedServerAt: dbUpdatedAt };
  }
  return { action: 'keep', push: false };
}
