/**
 * One cart line per variant (pure — unit-testable, isomorphic: used by the cart context, the
 * restore logic and the /api/cart routes).
 *
 * A Shopify variant id already pins the product AND the size, but the line `id` the cart builds
 * (`productId_variantId_size`) also depends on how each caller spelled the size / product id
 * (product page vs wishlist vs quick-add vs the app). The same variant could therefore end up on
 * two lines, which then showed twice in the bag and went to Meta / Snap as a repeated catalogue id.
 * Lines are matched on the normalized variant id instead; only a line with no provable variant id
 * falls back to its own `id`.
 */
import { normalizeVariantId } from '@/lib/snap/catalog-id';

export interface MergeableLine {
  id?: unknown;
  variantId?: unknown;
  quantity?: unknown;
}

/** Identity of a cart line: the normalized variant id, else the line id, else null (never merged). */
export function cartLineKey(line: { id?: unknown; variantId?: unknown } | null | undefined): string | null {
  if (!line) return null;
  const variant = normalizeVariantId(line.variantId);
  if (variant) return `variant:${variant}`;
  const id = typeof line.id === 'string' ? line.id.trim() : '';
  return id ? `line:${id}` : null;
}

/** Whole units on a line; a missing / zero / invalid quantity counts as 1, as the server stores it. */
function units(line: MergeableLine): number {
  return Math.max(1, Math.floor(Number(line.quantity)) || 1);
}

/**
 * Collapses lines of ONE cart that share a variant: quantities are summed (two lines of 1 are two
 * units), and the first line keeps its position, id and every other field. Lines that are not
 * duplicates are returned untouched (same object), so an already-clean cart comes back as-is.
 * Do not use this to combine two copies of the same cart (this device + the account's DB cart):
 * that needs the max, see dedupeLines in lib/cart-restore.ts.
 */
export function collapseVariantLines<T extends MergeableLine>(lines: T[]): T[] {
  if (!Array.isArray(lines) || lines.length < 2) return lines;
  const out: T[] = [];
  const at = new Map<string, number>();
  let changed = false;
  for (const line of lines) {
    const key = cartLineKey(line);
    const i = key === null ? undefined : at.get(key);
    if (i === undefined) {
      if (key !== null) at.set(key, out.length);
      out.push(line);
    } else {
      out[i] = { ...out[i], quantity: units(out[i]) + units(line) };
      changed = true;
    }
  }
  return changed ? out : lines;
}
