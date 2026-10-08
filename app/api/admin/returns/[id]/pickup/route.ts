import { NextResponse } from 'next/server';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { logAudit } from '@/lib/audit';
import {
  bookReversePickupForRequest,
  getReversePickupOptions,
  normalizeParcel,
} from '@/lib/services/reversePickup';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/returns/[id]/pickup?weight=0.5&length=30&breadth=20&height=5
 *   → logistics partners / couriers available for the reverse pickup.
 * POST /api/admin/returns/[id]/pickup
 *   body { provider: 'shiprocket' | 'delhivery', courier_id?, courier_name?, weight?, length?, breadth?, height? }
 *   → creates the reverse order, assigns the AWB and requests pickup.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'edit');
    const sp = new URL(req.url).searchParams;
    const parcel = normalizeParcel({
      weight: Number(sp.get('weight')),
      length: Number(sp.get('length')),
      breadth: Number(sp.get('breadth')),
      height: Number(sp.get('height')),
    });
    const options = await getReversePickupOptions('return', params.id, parcel);
    return NextResponse.json({ success: true, parcel, ...options });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') return handleAuthError(error);
    return NextResponse.json({ error: error?.message || 'Failed to load pickup options' }, { status: 400 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'edit');
    const body = await req.json().catch(() => ({}));
    const provider = body.provider === 'delhivery' ? 'delhivery' : 'shiprocket';
    const result = await bookReversePickupForRequest('return', params.id, {
      provider,
      courierId: body.courier_id != null ? Number(body.courier_id) : undefined,
      courierName: typeof body.courier_name === 'string' ? body.courier_name : undefined,
      parcel: {
        weight: Number(body.weight),
        length: Number(body.length),
        breadth: Number(body.breadth),
        height: Number(body.height),
      },
    });
    await logAudit({
      action: 'RETURN_PICKUP_BOOKED',
      module: 'RETURNS_EXCHANGES',
      targetId: params.id,
      metadata: { ...result },
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    }).catch(() => {});
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') return handleAuthError(error);
    console.error('[ReversePickup] book failed:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to book pickup' }, { status: 400 });
  }
}
