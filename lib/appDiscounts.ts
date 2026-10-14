/**
 * App (mobile) discount helpers — mirrors web storefront coupon rules so
 * COD / prepaid / CUSTOM_RATES auto-apply works the same on OrderReview.
 */

import prisma from '@/lib/db';

export type AppPaymentMethod = 'COD' | 'PREPAID';

export type AppDiscountResult = {
  code: string;
  type: string;
  value: number;
  discountAmount: number;
  autoApply: boolean;
  isSecure: boolean;
  applicability: string;
  source: 'discount' | 'webstore';
};

function isCodPayment(paymentMethod?: string | null): boolean {
  const pm = String(paymentMethod || '').toUpperCase().trim();
  return pm === 'COD' || pm.includes('COD');
}

export function normalizeAppPaymentMethod(paymentMethod?: string | null): AppPaymentMethod {
  return isCodPayment(paymentMethod) ? 'COD' : 'PREPAID';
}

function calcAmount(
  orderAmount: number,
  type: string,
  value: number,
  maxDiscount?: number | null
): number {
  let amount = 0;
  if (String(type).toLowerCase() === 'percentage') {
    amount = (orderAmount * Number(value || 0)) / 100;
    if (maxDiscount != null && amount > Number(maxDiscount)) {
      amount = Number(maxDiscount);
    }
  } else {
    amount = Math.min(Number(value || 0), orderAmount);
  }
  return Math.max(0, Math.min(Math.round(amount), orderAmount));
}

function prepaidNamed(code: string, applicability?: string | null): boolean {
  const upper = code.toUpperCase();
  return (
    applicability === 'PREPAID_ONLY' ||
    upper.includes('PREPAID') ||
    /^PREPAID/i.test(upper)
  );
}

type ValidateOk = { ok: true; discount: AppDiscountResult };
type ValidateFail = { ok: false; error: string; status: number };
export type ValidateOutcome = ValidateOk | ValidateFail;

/** Validate a single code for app checkout (Discount table, then WebStoreCoupon). */
export async function validateAppDiscount(opts: {
  code: string;
  orderAmount: number;
  paymentMethod?: string | null;
}): Promise<ValidateOutcome> {
  const code = String(opts.code || '').toUpperCase().trim();
  const orderAmount = Number(opts.orderAmount || 0);
  const isCOD = isCodPayment(opts.paymentMethod);

  if (!code) {
    return { ok: false, error: 'Discount code is required', status: 400 };
  }

  // 1) Legacy / app Discount table
  const discount = await prisma.discount.findUnique({ where: { code } });
  if (discount) {
    if (!discount.isActive) {
      return { ok: false, error: 'Discount code is no longer active', status: 400 };
    }
    const now = new Date();
    if (discount.startDate > now) {
      return { ok: false, error: 'Discount code is not yet active', status: 400 };
    }
    if (discount.endDate && discount.endDate < now) {
      return { ok: false, error: 'Discount code has expired', status: 400 };
    }
    if (discount.usageLimit !== null && discount.usageCount >= discount.usageLimit) {
      return { ok: false, error: 'Discount code usage limit reached', status: 400 };
    }
    if (orderAmount < discount.minOrderAmount) {
      return {
        ok: false,
        error: `Minimum order amount for this code is ₹${discount.minOrderAmount}`,
        status: 400,
      };
    }
    if (prepaidNamed(code) && isCOD) {
      return {
        ok: false,
        error: 'This coupon is only valid for prepaid orders',
        status: 400,
      };
    }

    const discountAmount = calcAmount(
      orderAmount,
      discount.type,
      discount.value,
      discount.maxDiscount
    );
    return {
      ok: true,
      discount: {
        code: discount.code,
        type: discount.type,
        value: discount.value,
        discountAmount,
        autoApply: !!discount.autoApply,
        isSecure: !!discount.isSecure,
        applicability: prepaidNamed(code) ? 'PREPAID_ONLY' : 'ALL',
        source: 'discount',
      },
    };
  }

  // 2) Web store coupons (same campaigns as website — COD_ONLY / CUSTOM_RATES etc.)
  const coupon = await prisma.webStoreCoupon.findFirst({
    where: { code, isActive: true },
  });
  if (!coupon) {
    return { ok: false, error: 'Invalid discount code', status: 404 };
  }

  const now = new Date();
  if (coupon.validFrom && new Date(coupon.validFrom) > now) {
    return { ok: false, error: 'Discount code is not yet active', status: 400 };
  }
  if (coupon.validUntil && new Date(coupon.validUntil) < now) {
    return { ok: false, error: 'Discount code has expired', status: 400 };
  }
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    return { ok: false, error: 'Discount code usage limit reached', status: 400 };
  }
  const minOrder = Number(coupon.minOrderValue || 0);
  if (orderAmount < minOrder) {
    return {
      ok: false,
      error: `Minimum order amount for this code is ₹${minOrder}`,
      status: 400,
    };
  }

  if (prepaidNamed(code, coupon.applicability) && isCOD) {
    return {
      ok: false,
      error: 'This coupon is only valid for prepaid orders',
      status: 400,
    };
  }
  if (coupon.applicability === 'COD_ONLY' && !isCOD) {
    return {
      ok: false,
      error: 'This coupon is only valid for COD orders',
      status: 400,
    };
  }

  let type = coupon.discountType;
  let value = Number(coupon.discountValue);
  if (coupon.applicability === 'CUSTOM_RATES') {
    if (isCOD) {
      type = coupon.codDiscountType;
      value = Number(coupon.codDiscountValue);
    } else {
      type = coupon.prepaidDiscountType;
      value = Number(coupon.prepaidDiscountValue);
    }
  }

  if (value <= 0) {
    return {
      ok: false,
      error: isCOD
        ? 'This coupon has no discount for COD orders'
        : 'This coupon has no discount for prepaid orders',
      status: 400,
    };
  }

  const discountAmount = calcAmount(orderAmount, type, value, null);
  return {
    ok: true,
    discount: {
      code: coupon.code,
      type,
      value,
      discountAmount,
      autoApply: !!coupon.autoApply,
      isSecure: !!coupon.isSecure,
      applicability: coupon.applicability || 'ALL',
      source: 'webstore',
    },
  };
}

/** Best auto-apply coupon for the current payment method + cart subtotal. */
export async function pickBestAutoApplyDiscount(opts: {
  orderAmount: number;
  paymentMethod?: string | null;
}): Promise<AppDiscountResult | null> {
  const orderAmount = Number(opts.orderAmount || 0);
  if (orderAmount <= 0) return null;

  const now = new Date();
  const [discounts, coupons] = await Promise.all([
    prisma.discount.findMany({
      where: {
        isActive: true,
        autoApply: true,
        isSecure: false,
        startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
    }),
    prisma.webStoreCoupon.findMany({
      where: {
        isActive: true,
        autoApply: true,
        isSecure: false,
        validFrom: { lte: now },
        validUntil: { gte: now },
      },
    }),
  ]);

  const codes = new Set<string>();
  const candidates: string[] = [];
  for (const d of discounts) {
    if (d.usageLimit != null && d.usageCount >= d.usageLimit) continue;
    codes.add(d.code.toUpperCase());
    candidates.push(d.code);
  }
  for (const c of coupons) {
    if (c.usageLimit != null && c.usedCount >= c.usageLimit) continue;
    const upper = c.code.toUpperCase();
    if (codes.has(upper)) continue; // prefer Discount row if both exist
    candidates.push(c.code);
  }

  const validated: AppDiscountResult[] = [];
  for (const code of candidates) {
    const result = await validateAppDiscount({
      code,
      orderAmount,
      paymentMethod: opts.paymentMethod,
    });
    if (result.ok && result.discount.discountAmount > 0) {
      validated.push(result.discount);
    }
  }

  validated.sort((a, b) => b.discountAmount - a.discountAmount);
  return validated[0] || null;
}
