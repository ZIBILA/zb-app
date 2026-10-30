import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';
import { logAudit } from '@/lib/audit';
import { startSale, validateSaleInput } from '@/lib/services/saleService';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** GET /api/admin/sales — every sale, newest first, with its variants. */
export async function GET() {
  try {
    await requirePermission('MARKETING', 'view');
    const sales = await prisma.sale.findMany({
      orderBy: { createdAt: 'desc' },
      include: { items: { orderBy: [{ productTitle: 'asc' }, { variantTitle: 'asc' }] } },
      take: 100,
    });
    return NextResponse.json({ sales });
  } catch (error) {
    return handleAuthError(error);
  }
}

/** POST /api/admin/sales { name, percent, productIds } — starts a sale now. */
export async function POST(req: Request) {
  try {
    const session = await requirePermission('MARKETING', 'edit');
    const parsed = validateSaleInput(await req.json().catch(() => ({})));
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const createdBy = (session.user as any)?.email || (session.user as any)?.id || null;
    const summary = await startSale(parsed, createdBy);

    await logAudit({
      action: 'SALE_STARTED',
      module: 'MARKETING',
      targetId: summary.saleId,
      metadata: { name: parsed.name, percent: parsed.percent, products: parsed.productIds.length, ...summary },
    });

    return NextResponse.json(summary, { status: summary.applied > 0 ? 201 : 422 });
  } catch (error) {
    return handleAuthError(error);
  }
}
