/**
 * Internal / test orders are never reported to Meta as a Purchase (browser Pixel
 * or Conversions API): staff QA purchases and demo-account orders would otherwise
 * count as conversions and train delivery on them.
 *
 * An order is internal when ANY of these holds:
 *   - its tags contain `test`, `internal` or `meta-exclude` (whole tag, any case);
 *   - its customer id is listed in META_INTERNAL_CUSTOMER_IDS;
 *   - its customer / shipping email is listed in META_INTERNAL_EMAILS or is a
 *     demo-account email (lib/metaPixel DEMO_EMAILS_RAW);
 *   - its customer / shipping phone matches META_INTERNAL_PHONES or a demo-account
 *     phone (last 10 digits).
 *
 * All three variables are optional, comma-separated. Nothing here changes order,
 * payment or Shopify state — only whether Meta hears about the sale. Isomorphic,
 * no database import.
 */
import { DEMO_EMAILS_RAW, DEMO_PHONES_RAW } from '@/lib/metaPixel';

export const INTERNAL_ORDER_TAGS = new Set(['test', 'internal', 'meta-exclude']);

export interface InternalOrderLists {
  customerIds: Set<string>;
  emails: Set<string>;
  phones: Set<string>; // last 10 digits
}

const splitList = (raw: string | undefined): string[] =>
  String(raw || '').split(',').map(s => s.trim()).filter(Boolean);

const emailKey = (e: unknown): string => String(e || '').trim().toLowerCase();
const phoneKey = (p: unknown): string => String(p || '').replace(/\D/g, '').slice(-10);

/** Lists from the environment (+ the demo accounts). Read per call so tests can set env. */
export function internalOrderLists(env: NodeJS.ProcessEnv = process.env): InternalOrderLists {
  return {
    customerIds: new Set(splitList(env.META_INTERNAL_CUSTOMER_IDS)),
    emails: new Set([...splitList(env.META_INTERNAL_EMAILS).map(emailKey), ...DEMO_EMAILS_RAW.map(emailKey)]),
    phones: new Set([...splitList(env.META_INTERNAL_PHONES).map(phoneKey), ...DEMO_PHONES_RAW.map(phoneKey)].filter(p => p.length >= 7)),
  };
}

function parseAddress(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try { return JSON.parse(String(raw)) || {}; } catch { return {}; }
}

/** Why the order is internal (first matching rule), or null when it is a real customer order. */
export function internalOrderReason(
  order: { tags?: unknown; customerId?: unknown; customer?: { email?: unknown; phone?: unknown } | null; shippingAddress?: unknown; customerPhone?: unknown } | null | undefined,
  lists: InternalOrderLists = internalOrderLists(),
): string | null {
  if (!order) return null;
  const tags = String(order.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const tag = tags.find(t => INTERNAL_ORDER_TAGS.has(t));
  if (tag) return `tag:${tag}`;
  const customerId = order.customerId ? String(order.customerId) : '';
  if (customerId && lists.customerIds.has(customerId)) return 'customer id';
  const addr = parseAddress(order.shippingAddress);
  for (const e of [order.customer?.email, addr.email]) {
    const k = emailKey(e);
    if (k && lists.emails.has(k)) return 'email';
  }
  for (const p of [order.customer?.phone, addr.phone, order.customerPhone]) {
    const k = phoneKey(p);
    if (k.length >= 7 && lists.phones.has(k)) return 'phone';
  }
  return null;
}

export function isInternalOrder(order: Parameters<typeof internalOrderReason>[0], lists?: InternalOrderLists): boolean {
  return internalOrderReason(order, lists) !== null;
}
