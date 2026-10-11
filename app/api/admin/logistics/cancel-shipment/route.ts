/**
 * POST /api/logistics/cancel-shipment — Cancel a shipment (admin only)
 */

import { NextResponse } from "next/server";
import { cancelShipment } from "@/lib/services/logistics";
import { requireAdmin, handleAuthError } from "@/lib/auth/rbac";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const cancelShipmentSchema = z.object({
  awb: z.string().min(1, "awb is required"),
});

export async function POST(req: Request) {
  try {
    await requireAdmin('LOGISTICS', 'edit');

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = cancelShipmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { awb } = parsed.data;
    const result = await cancelShipment(awb);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.message || 'Failed to cancel shipment', message: result.message },
        { status: 400 }
      );
    }

    await logAudit({
      action: 'SHIPMENT_CANCELLED',
      module: 'LOGISTICS',
      targetId: awb,
      metadata: { awb, result },
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error("[Logistics Cancel] Error:", error.message);
    return NextResponse.json(
      { error: "Failed to cancel shipment" },
      { status: 500 }
    );
  }
}
