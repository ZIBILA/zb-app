/**
 * GET /api/logistics/label?order_id=… — Generate / return Shiprocket label PDF URL
 */

import { NextResponse } from 'next/server';
import { generateShiprocketLabel } from '@/lib/services/logistics';
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

    const { labelUrl } = await generateShiprocketLabel(orderId);
    return NextResponse.redirect(labelUrl);
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[Logistics] Label error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to generate label' },
      { status: 500 }
    );
  }
}
