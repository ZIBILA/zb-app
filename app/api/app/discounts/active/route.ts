import { NextResponse } from 'next/server';
import { pickBestAutoApplyDiscount, normalizeAppPaymentMethod } from '@/lib/appDiscounts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/app/discounts/active?orderAmount=…&paymentMethod=COD|PREPAID|razorpay|cod
 * Returns the best auto-apply promo for the current cart + payment method.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const orderAmount = Number(url.searchParams.get('orderAmount') || 0);
    const paymentMethod = normalizeAppPaymentMethod(url.searchParams.get('paymentMethod'));

    const best = await pickBestAutoApplyDiscount({ orderAmount, paymentMethod });

    return NextResponse.json({
      success: true,
      paymentMethod,
      best,
    });
  } catch (error: any) {
    console.error('[App Discounts Active] error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal server error', best: null },
      { status: 500 }
    );
  }
}
