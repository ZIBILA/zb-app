import { NextResponse } from 'next/server';
import { validateAppDiscount } from '@/lib/appDiscounts';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { code, orderAmount, paymentMethod } = body;

    const result = await validateAppDiscount({
      code,
      orderAmount: Number(orderAmount || 0),
      paymentMethod,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      discount: result.discount,
    });
  } catch (error: any) {
    console.error('Discount validation error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
