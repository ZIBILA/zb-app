import { NextResponse } from "next/server";
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

/**
 * Legacy Delhivery regenerate-pickup endpoint.
 * Reverse pickups are booked via Shiprocket only — use POST /api/admin/returns/[id]/pickup.
 */
async function POST_impl() {
  return NextResponse.json(
    {
      error:
        "Direct Delhivery pickups are no longer supported. Open Select Logistics Partner and book the reverse pickup through Shiprocket.",
    },
    { status: 410 }
  );
}

export async function POST(req: Request, ctx: any) {
  try {
    await requirePermission('RETURNS_EXCHANGES', 'edit');
  } catch (authError) {
    return handleAuthError(authError);
  }
  return (POST_impl as any)(req, ctx);
}
