import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { retryFailedMetaPurchases } from '@/lib/meta/purchase-server';

export const dynamic = 'force-dynamic';

/**
 * Meta CAPI Purchase retry + missed-purchase recovery worker. Idempotent
 * (ledger-claimed), safe on any schedule.
 * Scheduled by .github/workflows/meta-conversions.yml (every 15 min).
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` is REQUIRED; fails closed when
 * CRON_SECRET is unset. Same contract as /api/cron/snap-conversions.
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
    // Optional manual backfill after a ledger outage: ?recoverSince=<ISO time>
    // (still limited to Meta's 7-day window; same CRON_SECRET auth).
    const sinceRaw = req.nextUrl.searchParams.get('recoverSince');
    const recoverSince = sinceRaw ? new Date(sinceRaw) : undefined;
    if (recoverSince && !Number.isFinite(recoverSince.getTime())) {
      return NextResponse.json({ ok: false, error: 'invalid recoverSince' }, { status: 400 });
    }
    const result = await retryFailedMetaPurchases(25, { recoverSince });
    // Always 200 for a completed run (so curl does not re-run the job and burn retry
    // attempts); `ok:false` + `alerts` when something needs a human. The workflow
    // fails the run on ok:false, and GitHub notifies maintainers.
    return NextResponse.json({ ok: result.healthy, result });
  } catch (err: any) {
    console.error('[Cron meta-conversions]', err?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
