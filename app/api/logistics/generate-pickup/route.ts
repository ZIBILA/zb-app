/**
 * POST /api/logistics/generate-pickup — Schedule Shiprocket courier pickup
 */

import { NextResponse } from 'next/server';
import { generateShiprocketPickup } from '@/lib/services/logistics';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    await requireAdmin('LOGISTICS', 'edit');
    const body = await req.json();
    const orderId = body?.order_id || body?.orderId;
    if (!orderId) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    }

    const result = await generateShiprocketPickup(String(orderId));
    return NextResponse.json({
      success: result.success,
      message: result.message,
      pickup_scheduled_date: result.pickup_scheduled_date || null,
    });
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[Logistics] Generate pickup error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to schedule pickup' },
      { status: 500 }
    );
  }
}
