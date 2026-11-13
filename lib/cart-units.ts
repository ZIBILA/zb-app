/**
 * One display row per unit.
 *
 * Shoppers added the same product in the same size twice without noticing, because the cart merged it into one
 * row showing "QTY: 2", and paid for both. The cart is still STORED merged (one line, quantity N), so prices,
 * inventory, Razorpay and the Shopify order are unchanged; only the cart, checkout and payment summary show the
 * line as N separate rows of quantity 1, which makes a duplicate impossible to miss.
 */
export type CartUnitRow<T> = T & {
  /** Stable React key for this unit row. */
  unitKey: string;
  /** The stored cart line this unit belongs to. */
  lineId: string;
  /** Quantity of the stored line (how many rows it expands to). */
  lineQuantity: number;
  /** Always 1: every row is one unit. */
  quantity: 1;
};

export function expandCartUnits<T extends { id: string; quantity: number }>(items: T[]): CartUnitRow<T>[] {
  const rows: CartUnitRow<T>[] = [];
  for (const item of items) {
    const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
    for (let i = 0; i < qty; i++) {
      rows.push({ ...item, unitKey: `${item.id}#${i}`, lineId: item.id, lineQuantity: qty, quantity: 1 });
    }
  }
  return rows;
}
