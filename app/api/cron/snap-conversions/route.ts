import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { retryPendingSnapPurchases } from '@/lib/snap/purchase-server';
import { retryPendingSnapAppPurchases } from '@/lib/snap/app-purchase-server';

export const dynamic = 'force-dynamic';

/**
 * Snap CAPI PURCHASE retry worker. Idempotent (ledger-claimed), safe on any schedule.
 * Scheduled by .github/workflows/snap-conversions.yml (every 15 min).
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` is REQUIRED; the route fails closed
 * when CRON_SECRET is unset. (No ?secret= query param: URLs end up in logs.)
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const web = await retryPendingSnapPurchases(25);
    const app = await retryPendingSnapAppPurchases(25);
    return NextResponse.json({ ok: true, result: { web, app } });
  } catch (err: any) {
    console.error('[Cron snap-conversions]', err?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
