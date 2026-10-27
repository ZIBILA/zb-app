/**
 * Commission rate helpers shared by the admin affiliate pages (client-safe: no DB imports).
 * Rates are stored as fractions (0.125) and shown/entered as percentages (12.5%).
 */

/** "12.5%" — up to 2 decimals, no trailing zeros. */
export function formatCommissionRate(rate: number | null | undefined): string {
  return `${Number(((rate || 0) * 100).toFixed(2))}%`;
}
