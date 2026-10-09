import { NextResponse } from "next/server";
import { createExchangeReplacementOrder } from "@/lib/services/exchangeReplacementOrder";
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

/**
 * POST /api/admin/exchanges/[id]/create-order
 * Creates the G_E_ replacement Shopify+local order after QC pass.
 */
async function POST_impl(_req: Request, { params }: { params: { id: string } }) {
  try {
    const result = await createExchangeReplacementOrder(params.id);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Create Exchange Replacement Order Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: any) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'edit');
  } catch (authError) {
    return handleAuthError(authError);
  }
  return (POST_impl as any)(req, ctx);
}
