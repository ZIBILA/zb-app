import { NextResponse } from "next/server";

/**
 * Legacy Delhivery regenerate-pickup endpoint.
 * Reverse pickups are booked via Shiprocket only — use POST /api/admin/returns/[id]/pickup.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Direct Delhivery pickups are no longer supported. Open Select Logistics Partner and book the reverse pickup through Shiprocket.",
    },
    { status: 410 }
  );
}
