import { NextResponse } from 'next/server';
import { razorpay } from '@/lib/razorpay';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export async function POST(req: Request) {
  try {
    await requireAdmin('FINANCIAL', 'edit');

    const body = await req.json();
    const { paymentId, amount, currency = 'INR' } = body;

    if (!paymentId || !amount) {
      return NextResponse.json({ error: 'Missing paymentId or amount' }, { status: 400 });
    }

    if (!razorpay) {
      return NextResponse.json({ error: 'Razorpay keys not configured' }, { status: 500 });
    }

    const capture = await razorpay.payments.capture(paymentId, amount, currency);

    return NextResponse.json(capture);
  } catch (err: any) {
    if (err?.message === '401' || err?.message === '403') {
      return handleAuthError(err);
    }
    console.error('Razorpay capture failed:', err);
    return NextResponse.json(
      { error: err?.error?.description || err?.message || 'Capture failed' },
      { status: 500 }
    );
  }
}
