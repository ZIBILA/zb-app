/**
 * POST /api/logistics/couriers
 * Fetch available Shiprocket courier options for an order + parcel dimensions.
 * Used by the dashboard to let the team choose which courier to use before booking AWB.
 */

import { NextResponse } from 'next/server';
import { getShiprocketCouriers } from '@/lib/services/logistics';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    await requireAdmin('LOGISTICS', 'edit');

    const body = await req.json();
    const { order_id, weight, length, breadth, height } = body;

    if (!order_id) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    }
    const w = Number(weight);
    const l = Number(length);
    const b = Number(breadth);
    const h = Number(height);
    if (!w || !l || !b || !h) {
      return NextResponse.json(
        { error: 'weight, length, breadth, and height are required and must be non-zero numbers' },
        { status: 400 }
      );
    }

    const result = await getShiprocketCouriers(order_id, {
      weight: w,
      length: l,
      breadth: b,
      height: h,
    });

    return NextResponse.json({
      success: true,
      available_couriers: result.available_courier_companies,
      recommended_courier_id: result.shiprocket_recommended_courier_id,
      message: result.message,
    });
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[Logistics] Get couriers error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch available couriers' },
      { status: 500 }
    );
  }
}
