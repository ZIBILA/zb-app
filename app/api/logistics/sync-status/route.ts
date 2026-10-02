/**
 * POST /api/logistics/sync-status — Pull Shiprocket tracking into local order/shipment
 */

import { NextResponse } from 'next/server';
import { syncOrderLogisticsStatus } from '@/lib/services/logistics';
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

    const result = await syncOrderLogisticsStatus(String(orderId));
    if (!result.success) {
      return NextResponse.json(result, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[Logistics] Sync status error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to sync status' },
      { status: 500 }
    );
  }
}
