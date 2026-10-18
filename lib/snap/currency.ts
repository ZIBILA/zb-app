/**
 * Currency of a Snap PURCHASE.
 *
 * A Purchase is reported in the currency the order was actually CHARGED in:
 * Order.currency, which every order writer stores next to Order.totalPrice
 * (the Razorpay order is created in that same currency). Nothing is converted
 * and no advertising market is assumed — a USD order is sent as USD, a GBP order
 * as GBP, an INR order as INR.
 *
 * Isomorphic and import-free: the browser pixel and the server Conversions API
 * event call the same function, so both always report the same currency.
 */

/**
 * ISO-4217 code of the order's charge, upper-case. A missing / malformed value
 * falls back to INR, the default of the Order.currency column (store base
 * currency) — the same rule the order tables themselves apply.
 */
export function snapPurchaseCurrency(order: { currency?: unknown } | null | undefined): string {
  const c = String(order?.currency ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : 'INR';
}

/**
 * Currencies Snap documents for conversion values (Conversions API → Parameters
 * → `currency`). Used only to WARN: an order in any other currency is still sent
 * exactly as charged, because rewriting it would misreport the sale.
 */
export const SNAP_SUPPORTED_CURRENCIES: ReadonlySet<string> = new Set([
  'USD', 'AED', 'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'COP', 'CZK', 'DKK', 'EGP', 'EUR', 'GBP',
  'GIP', 'HKD', 'HRK', 'HUF', 'IDR', 'ILS', 'INR', 'JPY', 'KRW', 'KWD', 'KZT', 'LBP', 'MXN', 'MYR', 'NGN',
  'NOK', 'NZD', 'PEN', 'PHP', 'PKR', 'PLN', 'QAR', 'RON', 'RUB', 'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'TWD',
  'TZS', 'UAH', 'VND', 'ZAR', 'ALL', 'BHD', 'DZD', 'GHS', 'IQD', 'ISK', 'JOD', 'KES', 'MAD', 'OMR', 'XOF',
]);

export function isSnapSupportedCurrency(code: unknown): boolean {
  return SNAP_SUPPORTED_CURRENCIES.has(String(code ?? '').trim().toUpperCase());
}
