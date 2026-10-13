/**
 * Which phone number identifies the buyer of an order, for Snap matching.
 * Isomorphic: used by the server Purchase builders and the confirmation page.
 *
 * Snap matches on the number WITH its country calling code. A number written
 * without one ("07700 900123") can only be completed with the country it was
 * typed for — the order's shipping country. Reading a customer's old national
 * number with a different country's code would produce a number that belongs to
 * nobody (or to somebody else). So:
 *   1. the customer's own number when it really carries its country code
 *      ("+…" / "00…" / "919876543210" that reads as a possible number that way;
 *      OTP-login numbers are stored like this): the buyer, right in any country.
 *      A "+" alone is not proof — the old checkout stored "+<national digits>"
 *      for every non-Indian customer (lib/tracking/phone.ts);
 *   2. otherwise the number typed with this order's address (same country as it);
 *   3. otherwise the customer's national-format number (best effort).
 * The chosen number is then normalized with the order's country
 * (lib/tracking/identity-normalize.ts normalizePhone).
 * Placeholder / dummy numbers are skipped throughout.
 */
import { pickRealPhone } from '@/lib/tracking/placeholder-identity';
import { carriesCountryCode } from '@/lib/tracking/phone';

export function snapPurchasePhone(customerPhone: unknown, addressPhone: unknown): string | undefined {
  const own = pickRealPhone(customerPhone);
  if (own && carriesCountryCode(own)) return own;
  return pickRealPhone(addressPhone) || own;
}
