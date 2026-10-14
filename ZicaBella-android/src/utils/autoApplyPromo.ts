/**
 * Auto-apply promo for OrderReview — works against production today
 * (storefront coupons + validate), and preferred /api/app/discounts/active after deploy.
 */

export type AutoApplyDiscount = {
  code: string;
  type: string;
  value: number;
  discountAmount: number;
  autoApply?: boolean;
};

type Ranked = {
  code: string;
  type: string;
  value: number;
  discount: number;
  cashback: number;
  autoApply: boolean;
};

function isCod(paymentMethod: string): boolean {
  const pm = String(paymentMethod || '').toUpperCase();
  return pm === 'COD' || pm.includes('COD');
}

function rankStorefrontCoupon(coupon: any, subtotal: number, paymentMethod: string): Ranked | null {
  if (!coupon?.autoApply || coupon?.isSecure) return null;
  if (subtotal < Number(coupon.minOrderValue || 0)) return null;

  const cod = isCod(paymentMethod);
  const code = String(coupon.code || '').toUpperCase();
  const applicability = String(coupon.applicability || 'ALL');
  const prepaidNamed =
    applicability === 'PREPAID_ONLY' || code.includes('PREPAID') || /^PREPAID/i.test(code);

  if (prepaidNamed && cod) return null;
  if (applicability === 'COD_ONLY' && !cod) return null;

  let type = coupon.discountType || 'percentage';
  let value = Number(coupon.discountValue || 0);
  if (applicability === 'CUSTOM_RATES') {
    if (cod) {
      type = coupon.codDiscountType || type;
      value = Number(coupon.codDiscountValue || 0);
    } else {
      type = coupon.prepaidDiscountType || type;
      value = Number(coupon.prepaidDiscountValue || 0);
    }
  }

  let discount = 0;
  if (String(type).toLowerCase() === 'percentage') {
    discount = Math.round((subtotal * value) / 100);
  } else {
    discount = Math.min(value, subtotal);
  }

  let cashback = 0;
  if (coupon.cashbackEnabled) {
    const paidBase = Math.max(0, subtotal - discount);
    const cbVal = Number(coupon.cashbackValue || 0);
    cashback =
      coupon.cashbackType === 'percentage'
        ? Math.round((paidBase * cbVal) / 100)
        : Math.min(cbVal, paidBase);
  }

  if (discount <= 0 && cashback <= 0) return null;

  return {
    code: coupon.code,
    type,
    value,
    discount,
    cashback,
    autoApply: true,
  };
}

/**
 * Pick best auto-apply promo for the current payment method.
 * Prefer new app endpoint when deployed; fall back to storefront + PREPAID10 validate.
 */
export async function fetchBestAutoApplyPromo(opts: {
  appUrl: string;
  subtotal: number;
  paymentMethod: 'COD' | 'PREPAID' | string;
}): Promise<AutoApplyDiscount | null> {
  const { appUrl, subtotal } = opts;
  const paymentMethod = isCod(opts.paymentMethod) ? 'COD' : 'PREPAID';
  if (subtotal <= 0) return null;

  // 1) Preferred (post-deploy) app endpoint
  try {
    const res = await fetch(
      `${appUrl}/api/app/discounts/active?orderAmount=${encodeURIComponent(String(subtotal))}&paymentMethod=${paymentMethod}`
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.best?.code && Number(data.best.discountAmount) > 0) {
        return {
          code: data.best.code,
          type: data.best.type,
          value: data.best.value,
          discountAmount: data.best.discountAmount,
          autoApply: true,
        };
      }
      // Endpoint exists and says nothing applies — trust it (don't force PREPAID10 on COD).
      if (data?.success) return null;
    }
  } catch {
    // fall through
  }

  // 2) Production-safe: storefront active coupons (already live)
  try {
    const res = await fetch(`${appUrl}/api/storefront/coupons/active`);
    if (res.ok) {
      const data = await res.json();
      const coupons = Array.isArray(data?.coupons) ? data.coupons : [];
      const ranked = coupons
        .map((c: any) => rankStorefrontCoupon(c, subtotal, paymentMethod))
        .filter(Boolean) as Ranked[];
      ranked.sort((a, b) => {
        if (a.discount !== b.discount) return b.discount - a.discount;
        return b.cashback - a.cashback;
      });
      const best = ranked[0];
      if (best && best.discount > 0) {
        return {
          code: best.code,
          type: best.type,
          value: best.value,
          discountAmount: best.discount,
          autoApply: true,
        };
      }
    }
  } catch {
    // fall through
  }

  // 3) Legacy prepaid fallback — PREPAID10 via validate (old Android behavior)
  if (paymentMethod === 'PREPAID') {
    try {
      const res = await fetch(`${appUrl}/api/app/discounts/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'PREPAID10',
          orderAmount: subtotal,
          paymentMethod: 'PREPAID',
        }),
      });
      const data = await res.json();
      if (data?.success && data.discount) {
        return { ...data.discount, autoApply: true };
      }
    } catch {
      // ignore
    }
  }

  return null;
}
