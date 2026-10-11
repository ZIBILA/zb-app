import { NextResponse } from 'next/server';

/** Legacy Delhivery-only endpoint — logistics now runs exclusively through Shiprocket. */
export async function GET() {
  return NextResponse.json({ error: 'Direct Delhivery labels are no longer available. Use Shiprocket label download from the order page.' }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: 'Direct Delhivery labels are no longer available. Use Shiprocket label download from the order page.' }, { status: 410 });
}
