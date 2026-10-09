import { NextResponse } from 'next/server';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { logAudit } from '@/lib/audit';
import { cancelReversePickupForRequest } from '@/lib/services/reversePickup';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/returns/[id]/cancel-pickup
 * Void the booked reverse pickup at Shiprocket and clear the AWB so ops can reassign a partner.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'edit');
    const result = await cancelReversePickupForRequest('return', params.id);
    await logAudit({
      action: 'RETURN_PICKUP_CANCELLED',
      module: 'RETURNS_EXCHANGES',
      targetId: params.id,
      metadata: { ...result },
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    }).catch(() => {});
    return NextResponse.json({
      success: true,
      message: 'Pickup cancelled. Select a new logistics partner to rebook.',
      ...result,
    });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') return handleAuthError(error);
    console.error('[ReversePickup] cancel failed:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to cancel pickup' }, { status: 400 });
  }
}
