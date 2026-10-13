import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { retryPendingSnapPurchases } from '@/lib/snap/purchase-server';
import { retryPendingSnapAppPurchases } from '@/lib/snap/app-purchase-server';
import { probeSnapCapi } from '@/lib/snap-capi';
import { snapDeliveryAlerts } from '@/lib/snap/health';
import { getClientIP, isPrivateIP } from '@/lib/ip-geo';

export const dynamic = 'force-dynamic';

/**
 * Snap CAPI PURCHASE retry + recovery worker. Idempotent (ledger-claimed), safe
 * on any schedule. Scheduled by .github/workflows/snap-conversions.yml (every 15 min).
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` is REQUIRED; the route fails closed
 * when CRON_SECRET is unset. (No ?secret= query param: URLs end up in logs.)
 *
 * Answer: always HTTP 200 for a completed run (so curl does not re-run the job),
 * with `ok: false` and `result.alerts` when something needs a human — access
 * token missing or refused, Purchases that could not be delivered, ledger
 * problems. The workflow fails the run on `ok: false`, and GitHub notifies.
 *
 * `?probe=1` additionally checks the pixel id + access token live against Snap's
 * VALIDATE endpoint (records nothing). Used by manual workflow runs.
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
    let probe;
    if (req.nextUrl.searchParams.get('probe') === '1') {
      const ip = getClientIP(req);
      probe = await probeSnapCapi({ ipAddress: ip && !isPrivateIP(ip) ? ip : undefined });
    }
    const alerts = snapDeliveryAlerts({ web, app, probe });
    return NextResponse.json({ ok: alerts.length === 0, result: { alerts, web, app, ...(probe ? { probe } : {}) } });
  } catch (err: any) {
    console.error('[Cron snap-conversions]', err?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
