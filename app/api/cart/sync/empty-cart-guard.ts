/**
 * Decides whether POST /api/cart/sync may skip creating a cart_sessions row.
 *
 * The storefront syncs the cart once per page load even when it is empty, and the mobile app
 * syncs `[]` on logout and after an order. Until now every such request from a visitor without
 * a cart row created one (401k rows for 10.6k cart items). An empty cart that does not exist
 * yet has nothing worth storing, so it is not created; the first sync that carries items still
 * creates it.
 *
 * Kept exactly as before (the guard only fires when BOTH conditions hold):
 * - a visitor with items and no cart → the cart is created;
 * - an EXISTING cart synced with `[]` (shopper emptied it, mobile clearCart, logout) → the row is
 *   still updated to empty, so the abandoned-carts page and recovery flows see it;
 * - everything that finds an existing cart (logged-in restore across devices, guest token,
 *   identity merge, ?recover= links, checkout contact enrichment, source/geo fields, the
 *   15-minute converted-cart duplicate guard) runs before this check and is unchanged.
 */
export function shouldSkipEmptyCartCreation(existingCart: unknown, items: unknown): boolean {
  return !existingCart && Array.isArray(items) && items.length === 0;
}
