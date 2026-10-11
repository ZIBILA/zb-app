import { NextResponse } from 'next/server';

/** Legacy Delhivery-only endpoint — logistics now runs exclusively through Shiprocket. */
export async function GET() {
  return NextResponse.json({ error: 'Direct Delhivery waybill fetch is no longer available. Book through Shiprocket.' }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: 'Direct Delhivery waybill fetch is no longer available. Book through Shiprocket.' }, { status: 410 });
}
