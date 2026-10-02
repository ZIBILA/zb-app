/**
 * POST /api/logistics/assign-awb — Assign AWB for an existing Shiprocket shipment
 */

import { NextResponse } from 'next/server';
import { assignShiprocketAwb } from '@/lib/services/logistics';
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

    const result = await assignShiprocketAwb(String(orderId));
    return NextResponse.json({
      success: true,
      awb: result.awb,
      tracking_number: result.trackingNumber,
      courier: result.courier,
      tracking_url: result.trackingUrl,
    });
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[Logistics] Assign AWB error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to assign AWB' },
      { status: 500 }
    );
  }
}
