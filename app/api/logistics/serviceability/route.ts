/**
 * GET /api/logistics/serviceability — Pincode serviceability check.
 *
 * Previously called Delhivery directly. Logistics now runs through Shiprocket;
 * without a dedicated Shiprocket serviceability call here we return a soft default
 * so checkout is not blocked. Shiprocket serviceability is checked at booking time.
 */

import { NextResponse, NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const pincode = req.nextUrl.searchParams.get("pincode");

    if (!pincode || !/^\d{6}$/.test(pincode)) {
      return NextResponse.json(
        { error: "Valid 6-digit pincode is required" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      serviceable: true,
      tat_days: 5,
      source: "default",
    });
  } catch (error: any) {
    console.error("[Serviceability] Error:", error);
    return NextResponse.json({ serviceable: true, tat_days: 7, source: "fallback" });
  }
}
