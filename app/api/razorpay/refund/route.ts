import { NextResponse } from 'next/server';
import { razorpay } from '@/lib/razorpay';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export async function POST(req: Request) {
  try {
    await requireAdmin('FINANCIAL', 'edit');

    const body = await req.json();
    const { paymentId, amount, notes } = body;

    if (!paymentId) {
      return NextResponse.json({ error: 'Missing paymentId' }, { status: 400 });
    }

    if (!razorpay) {
      return NextResponse.json({ error: 'Razorpay keys not configured' }, { status: 500 });
    }

    const refund = await razorpay.payments.refund(paymentId, {
      amount,
      notes: notes || {},
    });

    return NextResponse.json(refund);
  } catch (err: any) {
    if (err?.message === '401' || err?.message === '403') {
      return handleAuthError(err);
    }
    console.error('Razorpay refund failed:', err);
    return NextResponse.json(
      { error: err?.error?.description || err?.message || 'Refund failed' },
      { status: 500 }
    );
  }
}
