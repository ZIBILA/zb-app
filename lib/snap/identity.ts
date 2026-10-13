/**
 * Which phone number identifies the buyer of an order, for Snap matching.
 * Isomorphic: used by the server Purchase builders and the confirmation page.
 *
 * Snap matches on the number WITH its country calling code. A number written
 * without one ("07700 900123") can only be completed with the country it was
 * typed for — the order's shipping country. Reading a customer's old national
 * number with a different country's code would produce a number that belongs to
 * nobody (or to somebody else). So:
 *   1. the customer's own number when it carries its country code ("+…" / "00…";
 *      OTP-login numbers are stored that way): the buyer, right in any country;
 *   2. otherwise the number typed with this order's address (same country as it);
 *   3. otherwise the customer's national-format number (best effort).
 * Placeholder / dummy numbers are skipped throughout.
 */
import { pickRealPhone } from '@/lib/tracking/placeholder-identity';

export function snapPurchasePhone(customerPhone: unknown, addressPhone: unknown): string | undefined {
  const own = pickRealPhone(customerPhone);
  if (own && /^(\+|00)\s*\d/.test(own)) return own;
  return pickRealPhone(addressPhone) || own;
}
