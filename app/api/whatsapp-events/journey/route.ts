import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch (authErr) { return handleAuthError(authErr); }
  try {
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone');
    const customerId = searchParams.get('customerId');

    if (!phone && !customerId) {
      return NextResponse.json({ error: 'Missing phone or customerId parameter' }, { status: 400 });
    }

    const whereClause: any = {};
    if (customerId) {
      whereClause.customerId = customerId;
    } else if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      const last10 = cleanPhone.slice(-10);
      if (last10) {
        whereClause.customerPhone = { contains: last10 };
      } else {
        whereClause.customerPhone = phone;
      }
    }

    const events = await db.whatsAppEvent.findMany({
      where: whereClause,
      orderBy: { createdAt: 'asc' }
    });

    // Also fetch basic customer details for display
    let customer = null;
    if (customerId) {
      customer = await db.customer.findUnique({ where: { id: customerId } });
    } else if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      const last10 = cleanPhone.slice(-10);
      if (last10) {
        customer = await db.customer.findFirst({
          where: { phone: { contains: last10 } }
        });
      }
    }

    return NextResponse.json({
      customer: customer ? {
        id: customer.id,
        name: customer.name || 'Valued Customer',
        phone: customer.phone,
        email: customer.email,
        createdAt: customer.createdAt
      } : null,
      events
    });
  } catch (error: any) {
    console.error('[Get Customer Journey Error]:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
