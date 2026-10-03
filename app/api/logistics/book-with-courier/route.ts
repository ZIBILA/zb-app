/**
 * POST /api/logistics/book-with-courier
 * Create Shiprocket order + assign AWB for a specific courier chosen by the operations team.
 * This replaces the old auto-AWB flow with a manual, courier-selection-driven flow.
 */

import { NextResponse } from 'next/server';
import { bookShiprocketOrderWithCourier } from '@/lib/services/logistics';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

const inFlight = new Set<string>();

export async function POST(req: Request) {
  let lockKey: string | null = null;
  try {
    await requireAdmin('LOGISTICS', 'edit');

    const body = await req.json();
    const { order_id, courier_id, courier_name, weight, length, breadth, height } = body;

    if (!order_id) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    }
    if (!courier_id || !courier_name) {
      return NextResponse.json(
        { error: 'courier_id and courier_name are required' },
        { status: 400 }
      );
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

    if (inFlight.has(order_id)) {
      return NextResponse.json(
        { error: 'Shipment booking already in progress for this order. Please wait.' },
        { status: 409 }
      );
    }
    inFlight.add(order_id);
    lockKey = order_id;

    const result = await bookShiprocketOrderWithCourier(
      order_id,
      { weight: w, length: l, breadth: b, height: h },
      Number(courier_id),
      String(courier_name)
    );

    return NextResponse.json({
      success: true,
      awb: result.awb || result.trackingNumber,
      tracking_number: result.trackingNumber,
      tracking_url: result.trackingUrl,
      courier: result.courier,
      shipment_id: result.shipmentId,
    });
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[Logistics] Book with courier error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to create shipment' },
      { status: 500 }
    );
  } finally {
    if (lockKey) inFlight.delete(lockKey);
  }
}
