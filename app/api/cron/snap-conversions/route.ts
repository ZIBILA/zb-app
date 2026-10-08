import { NextRequest, NextResponse } from 'next/server';
import { retryPendingSnapPurchases } from '@/lib/snap/purchase-server';

export const dynamic = 'force-dynamic';

/**
 * Retries Snap CAPI PURCHASE deliveries that failed or whose sending lease
 * expired. Idempotent (ledger-claimed), so it is safe to run on any schedule.
 * Not yet scheduled — add it to the cron runner when ready.
 * Auth: CRON_SECRET is REQUIRED (fails closed when unset).
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const secret = new URL(req.url).searchParams.get('secret');
  if (!cronSecret || (secret !== cronSecret && req.headers.get('Authorization') !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await retryPendingSnapPurchases(25);
    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    console.error('[Cron snap-conversions]', err?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
