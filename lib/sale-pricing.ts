/**
 * Pure sale-price helpers shared by the Sale Management dashboard (live preview) and the sale service
 * (what actually gets written to Shopify), so the preview always matches the applied price.
 */

export const MIN_SALE_PERCENT = 1;
export const MAX_SALE_PERCENT = 90;

/** Discounted price in whole rupees (never below ₹1), formatted the way Shopify stores prices. */
export function computeSalePrice(originalPrice: string | number, percent: number): string {
  const base = Number(originalPrice);
  if (!Number.isFinite(base) || base <= 0) throw new Error(`Invalid price "${originalPrice}"`);
  const discounted = Math.max(1, Math.round((base * (100 - percent)) / 100));
  return discounted.toFixed(2);
}

export function samePrice(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  if (a == null || b == null || a === '' || b === '') return (a ?? '') === (b ?? '');
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

export function validateSaleInput(input: { name?: unknown; percent?: unknown; productIds?: unknown }) {
  const name = String(input.name ?? '').trim();
  const percent = Number(input.percent);
  const productIds = Array.isArray(input.productIds)
    ? Array.from(new Set(input.productIds.map((id) => String(id).split('/').pop() || '').filter(Boolean)))
    : [];
  if (!name) return { error: 'Give the sale a name (e.g. "Diwali Sale").' } as const;
  if (!Number.isFinite(percent) || percent < MIN_SALE_PERCENT || percent > MAX_SALE_PERCENT) {
    return { error: `Discount must be between ${MIN_SALE_PERCENT}% and ${MAX_SALE_PERCENT}%.` } as const;
  }
  if (productIds.length === 0) return { error: 'Select at least one product.' } as const;
  return { name, percent: Math.round(percent * 100) / 100, productIds } as const;
}
