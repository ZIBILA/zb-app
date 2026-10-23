import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin('FINANCIAL', 'view');

    const payments = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        order: { select: { shopifyOrderId: true } },
        customer: { select: { name: true, email: true } },
      }
    });

    const formatted = payments.map((p: any) => ({
      id: p.id,
      amount: p.amount,
      type: p.type,
      status: p.status,
      gateway: p.gateway,
      createdAt: p.createdAt,
      orderId: p.order?.shopifyOrderId || p.orderId,
      customerName: p.customer?.name,
      customerEmail: p.customer?.email,
    }));

    return NextResponse.json({ payments: formatted });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('Razorpay payments list error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
