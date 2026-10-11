import { NextResponse } from 'next/server';

/** Legacy Delhivery-only endpoint — logistics now runs exclusively through Shiprocket. */
export async function GET() {
  return NextResponse.json({ error: 'Delhivery TAT is no longer available. Use Shiprocket serviceability from the order booking panel.' }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: 'Delhivery TAT is no longer available. Use Shiprocket serviceability from the order booking panel.' }, { status: 410 });
}
