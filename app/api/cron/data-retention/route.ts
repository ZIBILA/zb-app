import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { runDataRetention, MAX_BUDGET_MS } from '@/lib/services/dataRetention';

export const dynamic = 'force-dynamic';

/**
 * Backup trigger for the nightly data-retention job (lib/services/dataRetention.ts); the primary
 * run is the 06:30 IST job in lib/background-jobs.ts (after the Supabase daily backup). Dry run unless DATA_RETENTION_ENABLED=true.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` is REQUIRED; fails closed (401, nothing runs) when
 * CRON_SECRET is unset. No ?secret= query param: URLs end up in logs.
 *
 * Query params (both only make a run safer / shorter, never the reverse):
 *   ?dryRun=1          force a dry run (counts only) even when deletes are enabled
 *   ?budget=<seconds>  time budget, default 55 s (a dry-run count of the big tables can take
 *                      longer; pass up to 600)
 */
const DEFAULT_ROUTE_BUDGET_MS = 55_000;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const params = req.nextUrl.searchParams;
  const dry = params.get('dryRun');
  const forceDryRun = dry === '1' || dry === 'true';
  const budgetSeconds = Number(params.get('budget'));
  const budgetMs =
    Number.isFinite(budgetSeconds) && budgetSeconds > 0
      ? Math.min(budgetSeconds * 1000, MAX_BUDGET_MS)
      : DEFAULT_ROUTE_BUDGET_MS;
  try {
    const summary = await runDataRetention({ forceDryRun, budgetMs });
    return NextResponse.json({ ok: !summary.error, ...summary });
  } catch (err: any) {
    console.error('[Cron data-retention]', err?.message);
    return NextResponse.json({ ok: false, error: 'run failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
