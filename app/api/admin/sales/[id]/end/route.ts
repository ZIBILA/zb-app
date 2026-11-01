import { NextResponse } from 'next/server';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { logAudit } from '@/lib/audit';
import { endSale } from '@/lib/services/saleService';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** POST /api/admin/sales/:id/end — restores pre-sale prices on every product in the sale. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission('MARKETING', 'edit');
    const summary = await endSale(params.id);
    await logAudit({ action: 'SALE_ENDED', module: 'MARKETING', targetId: params.id, metadata: summary });
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof Error && error.message === 'Sale not found') {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }
    return handleAuthError(error);
  }
}
