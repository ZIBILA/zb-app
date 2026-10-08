/**
 * Linked order / return / exchange ids.
 *
 *   Original order          ZB718103
 *   Return request          R_ZB718103      (2nd on same order: R_ZB718103_2)
 *   Exchange request        E_ZB718103      (2nd on same order: E_ZB718103_2)
 *   Replacement shipment    G_E_ZB718103    (always G_ + the exchange id)
 *
 * Everything stays traceable to the original order and is searchable by any of the ids.
 * Pure helpers + DB allocation that works with either `prisma` or a transaction client.
 */

export type LinkedKind = 'return' | 'exchange' | 'replacement';

export const LINKED_PREFIX: Record<LinkedKind, string> = {
  return: 'R_',
  exchange: 'E_',
  replacement: 'G_E_',
};

type OrderRefLike = {
  id?: string | null;
  internalOrderNumber?: string | null;
  shopifyOrderName?: string | null;
  shopifyOrderId?: string | null;
};

/** The customer-facing number of an order without any "#" (e.g. ZB718103). */
export function orderBaseNumber(order: OrderRefLike): string {
  const candidates = [order.internalOrderNumber, order.shopifyOrderName, order.shopifyOrderId];
  for (const raw of candidates) {
    const cleaned = String(raw || '').replace(/^#+/, '').trim();
    if (cleaned && !cleaned.startsWith('app_')) return cleaned;
  }
  const id = String(order.id || '').trim();
  return id ? `ZB${id.slice(-6).toUpperCase()}` : 'ZBUNKNOWN';
}

type Db = {
  returnRequest: { findUnique: (args: any) => Promise<unknown> };
  exchangeRequest: { findUnique: (args: any) => Promise<unknown> };
};

async function isTaken(db: Db, kind: LinkedKind, candidate: string): Promise<boolean> {
  const hit =
    kind === 'return'
      ? await db.returnRequest.findUnique({ where: { displayId: candidate }, select: { id: true } })
      : kind === 'exchange'
        ? await db.exchangeRequest.findUnique({ where: { displayId: candidate }, select: { id: true } })
        : await db.exchangeRequest.findUnique({ where: { replacementDisplayId: candidate }, select: { id: true } });
  return Boolean(hit);
}

/** Next free id for a return / exchange on this order (R_ZB…, R_ZB…_2, …). */
export async function allocateLinkedId(
  db: Db,
  kind: Exclude<LinkedKind, 'replacement'>,
  order: OrderRefLike
): Promise<string> {
  const base = orderBaseNumber(order);
  const prefix = LINKED_PREFIX[kind];
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? `${prefix}${base}` : `${prefix}${base}_${n}`;
    if (!(await isTaken(db, kind, candidate))) return candidate;
  }
  // Practically unreachable; keeps the unique constraint satisfied.
  return `${prefix}${base}_${Date.now().toString(36).toUpperCase()}`;
}

/** Replacement id derived from the exchange id: E_ZB718103 → G_E_ZB718103. */
export function replacementIdForExchange(exchangeDisplayId: string): string {
  return `G_${exchangeDisplayId}`;
}

export interface ParsedLinkedId {
  kind: LinkedKind;
  /** The original order number portion, e.g. ZB718103 */
  baseNumber: string;
  /** The full normalized id as typed, upper-cased */
  id: string;
}

/** Parse a search string like "E_ZB718103", "g_e_zb718103" or "R_ZB718103_2". */
export function parseLinkedId(input: string | null | undefined): ParsedLinkedId | null {
  const q = String(input || '').trim().toUpperCase().replace(/^#+/, '');
  const m = /^(G_E_|E_|R_)(.+)$/.exec(q);
  if (!m) return null;
  const kind: LinkedKind = m[1] === 'G_E_' ? 'replacement' : m[1] === 'E_' ? 'exchange' : 'return';
  const baseNumber = m[2].replace(/_\d+$/, '');
  if (!baseNumber) return null;
  return { kind, baseNumber, id: q };
}
