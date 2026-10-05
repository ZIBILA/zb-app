/**
 * GET /api/logistics/invoice?order_id=… — Generate / return Shiprocket invoice PDF URL
 */

import { NextResponse } from 'next/server';
import { generateShiprocketInvoice } from '@/lib/services/logistics';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requireAdmin('LOGISTICS', 'view');
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get('order_id') || searchParams.get('orderId');
    if (!orderId) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    }

    const { invoiceUrl } = await generateShiprocketInvoice(orderId);
    return NextResponse.redirect(invoiceUrl);
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[Logistics] Invoice error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to generate invoice' },
      { status: 500 }
    );
  }
}
