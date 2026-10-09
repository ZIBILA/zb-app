import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { parseLinkedId } from '@/lib/linkedIds';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/linked-id?q=E_ZB718103
 * Resolve a linked return/exchange/replacement id to the correct dashboard href.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin('ORDERS', 'view');
    const q = new URL(req.url).searchParams.get('q');
    const parsed = parseLinkedId(q);
    if (!parsed) {
      return NextResponse.json({ found: false, error: 'Not a linked id (R_/E_/G_E_)' }, { status: 400 });
    }

    if (parsed.kind === 'return') {
      const row = await prisma.returnRequest.findFirst({
        where: { displayId: { equals: parsed.id, mode: 'insensitive' } },
        select: { id: true, displayId: true },
      });
      if (!row) return NextResponse.json({ found: false, kind: parsed.kind, id: parsed.id });
      return NextResponse.json({
        found: true,
        kind: 'return',
        id: row.id,
        displayId: row.displayId,
        href: `/dashboard/returns/${row.id}`,
      });
    }

    if (parsed.kind === 'exchange') {
      const row = await prisma.exchangeRequest.findFirst({
        where: { displayId: { equals: parsed.id, mode: 'insensitive' } },
        select: { id: true, displayId: true },
      });
      if (!row) return NextResponse.json({ found: false, kind: parsed.kind, id: parsed.id });
      return NextResponse.json({
        found: true,
        kind: 'exchange',
        id: row.id,
        displayId: row.displayId,
        href: `/dashboard/exchanges/${row.id}`,
      });
    }

    // replacement G_E_…
    const byReplacement = await prisma.exchangeRequest.findFirst({
      where: { replacementDisplayId: { equals: parsed.id, mode: 'insensitive' } },
      select: {
        id: true,
        displayId: true,
        replacementDisplayId: true,
        replacementOrderId: true,
      },
    });
    if (byReplacement?.replacementOrderId) {
      return NextResponse.json({
        found: true,
        kind: 'replacement',
        id: byReplacement.replacementOrderId,
        displayId: byReplacement.replacementDisplayId,
        exchangeId: byReplacement.id,
        href: `/dashboard/orders/${byReplacement.replacementOrderId}`,
      });
    }
    if (byReplacement) {
      return NextResponse.json({
        found: true,
        kind: 'exchange',
        id: byReplacement.id,
        displayId: byReplacement.displayId,
        href: `/dashboard/exchanges/${byReplacement.id}`,
      });
    }

    const order = await prisma.order.findFirst({
      where: { internalOrderNumber: { equals: parsed.id, mode: 'insensitive' } },
      select: { id: true, internalOrderNumber: true },
    });
    if (order) {
      return NextResponse.json({
        found: true,
        kind: 'replacement',
        id: order.id,
        displayId: order.internalOrderNumber,
        href: `/dashboard/orders/${order.id}`,
      });
    }

    return NextResponse.json({ found: false, kind: parsed.kind, id: parsed.id });
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[linked-id] resolve failed:', error?.message || error);
    return NextResponse.json({ error: 'Failed to resolve linked id' }, { status: 500 });
  }
}
