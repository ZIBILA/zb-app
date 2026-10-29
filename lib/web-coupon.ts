/**
 * Server-side web-store coupon resolution.
 *
 * The checkout routes used to take the discount and cashback AMOUNTS from the
 * browser and only checked that the code was active (PAYMENT_AUDIT.md P1): a
 * shopper could post `couponDiscount = subtotal` and get a ₹0 "paid" order, or
 * any `cashbackAmount` as store credit. This recomputes both from the coupon row
 * with the same rules as /api/storefront/coupons/validate (dates, usage limit,
 * minimum order, applicability, CUSTOM_RATES, cashback, store-credit mode) so the
 * client amounts are never used.
 */
import prisma from '@/lib/db';

export type WebCouponResolution = {
  /** Normalised code when valid, else null (invalid codes are silently dropped). */
  code: string | null;
  /** Discount that reduces the payable total (0 for store-credit-mode coupons). */
  payableDiscount: number;
  /** Store credit to mint after the order (cashback, or the store-credit-mode discount). */
  cashback: number;
  applyAsStoreCredit: boolean;
  valid: boolean;
  reason?: string;
};

const NONE: WebCouponResolution = { code: null, payableDiscount: 0, cashback: 0, applyAsStoreCredit: false, valid: false };

export async function resolveWebCoupon(opts: {
  code?: string | null;
  /** Server-verified subtotal in the checkout currency. */
  subtotal: number;
  isCod: boolean;
}): Promise<WebCouponResolution> {
  const code = String(opts.code || '').trim().toUpperCase();
  if (!code) return NONE;
  const subtotal = Math.max(0, Number(opts.subtotal) || 0);

  const coupon = await prisma.webStoreCoupon.findFirst({ where: { code, isActive: true } });
  if (!coupon) return { ...NONE, reason: 'unknown_or_inactive' };

  const now = new Date();
  if (coupon.validFrom && new Date(coupon.validFrom) > now) return { ...NONE, reason: 'not_yet_active' };
  if (coupon.validUntil && new Date(coupon.validUntil) < now) return { ...NONE, reason: 'expired' };
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) return { ...NONE, reason: 'usage_limit' };
  const minOrder = Number(coupon.minOrderValue || 0);
  if (minOrder > 0 && subtotal < minOrder) return { ...NONE, reason: 'min_order' };

  const isPrepaidCode =
    coupon.applicability === 'PREPAID_ONLY' || code.includes('PREPAID') || /^PREPAID/i.test(code);
  if (isPrepaidCode && opts.isCod) return { ...NONE, reason: 'prepaid_only' };
  if (coupon.applicability === 'COD_ONLY' && !opts.isCod) return { ...NONE, reason: 'cod_only' };

  let discountType = coupon.discountType;
  let discountValue = Number(coupon.discountValue);
  if (coupon.applicability === 'CUSTOM_RATES') {
    discountType = opts.isCod ? coupon.codDiscountType : coupon.prepaidDiscountType;
    discountValue = Number(opts.isCod ? coupon.codDiscountValue : coupon.prepaidDiscountValue);
    if (opts.isCod && discountValue <= 0) return { ...NONE, reason: 'no_cod_rate' };
  }

  if (!Number.isFinite(discountValue) || discountValue < 0) discountValue = 0;
  let discount = 0;
  if (discountType === 'percentage') discount = Math.round((subtotal * discountValue) / 100);
  else discount = Math.min(discountValue, subtotal);
  discount = Math.max(0, Math.min(discount, subtotal));

  let cashbackEarned = 0;
  if (coupon.cashbackEnabled) {
    const paidBase = Math.max(0, subtotal - discount);
    const cbVal = Number(coupon.cashbackValue || 0);
    cashbackEarned = coupon.cashbackType === 'percentage' ? Math.round((paidBase * cbVal) / 100) : Math.min(cbVal, paidBase);
    cashbackEarned = Math.max(0, cashbackEarned);
  }

  // Same three modes as the checkout page applies from the validate response.
  if (coupon.cashbackEnabled && cashbackEarned > 0) {
    return { code, payableDiscount: discount, cashback: cashbackEarned, applyAsStoreCredit: false, valid: true };
  }
  if (coupon.applyAsStoreCredit) {
    return { code, payableDiscount: 0, cashback: discount, applyAsStoreCredit: true, valid: true };
  }
  return { code, payableDiscount: discount, cashback: 0, applyAsStoreCredit: false, valid: true };
}
