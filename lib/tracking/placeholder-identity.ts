/**
 * Synthetic placeholder emails created by the order/customer code when a real
 * email is missing. They are not customer identities and must never be hashed
 * and sent to ad platforms as em (they collide across thousands of customers).
 *
 * Explicit patterns only — a real person can have a legitimate @zicabella.com
 * address, so the domain itself is NOT blocked.
 *
 * Sources (keep in sync when adding a new fallback email):
 *   guest@zicabella.com       app/api/app/orders/route.ts, app/api/app/orders/create/route.ts,
 *                             app/api/app/payment/create-order/route.ts
 *   customer@zicabella.com    app/api/app/payment/process/route.ts (Razorpay request only)
 *   guest_<ts>@zicabella.com  lib/services/customerService.ts
 *   guest_<ts>@zicabella.in   app/api/pay/[cartId]/route.ts
 *   recovered_<ts>@zicabella.com  lib/services/razorpayRecoveryService.ts
 *   unresolved@zicabella.com  lib/services/razorpayRecoveryService.ts (WebStoreOrder)
 *
 * Isomorphic (browser + server), no crypto import.
 */

const PLACEHOLDER_EMAIL_RE =
  /^(?:(?:guest|customer|unresolved)@zicabella\.(?:com|in)|(?:guest|recovered)_\d+@zicabella\.(?:com|in))$/;

/** True for a raw (unhashed) synthetic placeholder email. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return PLACEHOLDER_EMAIL_RE.test(email.trim().toLowerCase());
}

/**
 * SHA-256 of the fixed placeholders above (timestamped ones cannot be listed),
 * for values that arrive already hashed from the zb_guest_email cookie.
 */
export const PLACEHOLDER_EMAIL_HASHES: readonly string[] = [
  '8b4e6c3672085cb08bd46f0e1f1682454467bead491ea70e97095f3aee147ebc', // guest@zicabella.com
  'd934c0111fd4890bccb72ed3db382fb4343bed9118bd6a476462d20d7c95c3f2', // customer@zicabella.com
  '0ff0f5da52e3d6cd0bc54eb9859ef06eac5d3451bb5889f71f002d802ee59b61', // guest@zicabella.in
  '8f06fa63024521a199f7d194d5e78816d5c58ffae40265fe4594fcc3b9cc6955', // customer@zicabella.in
  'fb2612a3ef880f50bd71ea8b7585921ac98a11598a43a93ba934a93d16712b24', // unresolved@zicabella.com
];

export function isPlaceholderEmailHash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  return PLACEHOLDER_EMAIL_HASHES.includes(hash.trim().toLowerCase());
}
