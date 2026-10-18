/**
 * The value / currency a Meta funnel event reports = the money the shopper SEES.
 *
 * Cart and product prices are stored in INR. On the global store a visitor in
 * another country sees INR × multiplier × exchange rate in their currency, and
 * that is also what Razorpay charges and what the Purchase reports
 * (Order.totalPrice in Order.currency). ViewContent, AddToCart, AddToWishlist,
 * InitiateCheckout and AddPaymentInfo must describe the same money, or the
 * funnel disagrees with itself by the markup plus FX (a UK buyer looked like
 * ₹1,499 at AddToCart and £35 at Purchase).
 *
 * In India (or with the global store off) `formatPrice` is the identity, so the
 * events are byte-identical to before. Isomorphic, no React: call sites pass the
 * `formatPrice` they already have from useCountry().
 */

export interface MetaMoney {
  /** INR base amount → amount in the display currency (2 decimals). */
  amount: (inr: number) => number;
  /** ISO 4217 code of the display currency ('INR' when nothing is converted). */
  currency: string;
}

type FormatPrice = (basePriceINR: number) => { amount: number; currencyCode: string };

/** Money for Meta events from a `formatPrice` (useCountry().formatPrice or a test stub). */
const META_INR_IDENTITY: MetaMoney = { currency: 'INR', amount: (inr: number) => inr };

export function metaMoneyFrom(formatPrice?: FormatPrice | null): MetaMoney {
  if (typeof formatPrice !== 'function') return META_INR_IDENTITY;
  let currency = 'INR';
  try {
    const probe = formatPrice(1);
    if (probe && typeof probe.currencyCode === 'string' && /^[A-Z]{3}$/.test(probe.currencyCode.toUpperCase())) {
      currency = probe.currencyCode.toUpperCase();
    }
  } catch {
    return META_INR_IDENTITY;
  }
  return {
    currency,
    amount: (inr: number) => {
      const n = Number(inr);
      if (!Number.isFinite(n)) return n;
      try {
        const out = formatPrice(n)?.amount;
        return typeof out === 'number' && Number.isFinite(out) ? Math.round(out * 100) / 100 : n;
      } catch {
        return n;
      }
    },
  };
}

/** INR, no conversion (India, or when no pricing context is available). */
export const META_INR: MetaMoney = META_INR_IDENTITY;
