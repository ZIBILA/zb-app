import { NextResponse } from 'next/server';
import { browserPurchase } from '@/lib/meta-purchases';

export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const purchase = await browserPurchase(req, params.id);
  return NextResponse.json(purchase || { ready: false }, {
    status: purchase ? 200 : 404,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
