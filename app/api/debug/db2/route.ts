import { NextResponse } from "next/server";
import { requireSuperAdmin, handleAuthError } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

/** Debug endpoint — admin only. Do not expose data publicly. */
export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json(
      { error: "This debug endpoint has been disabled. Use authenticated admin tools." },
      { status: 410 }
    );
  } catch (e: any) {
    return handleAuthError(e);
  }
}

export async function POST() {
  return GET();
}
