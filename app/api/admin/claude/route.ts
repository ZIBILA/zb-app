// Admin-dashboard Zica AI chat removed (Developer Brief item #26).
// Customer-facing Zica AI (/api/zica-ai) is unchanged.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: "Admin dashboard AI has been removed." },
    { status: 410 }
  );
}

export async function GET() {
  return NextResponse.json(
    { error: "Admin dashboard AI has been removed." },
    { status: 410 }
  );
}
