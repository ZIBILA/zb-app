import { NextResponse } from 'next/server';
import { retryFailedRefunds } from '@/lib/services/refundService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Cron: /api/cron/retry-refunds — retries failed / interrupted refunds of cancelled orders.
 * The server already runs this every 10 minutes (lib/background-jobs.ts); this is the external backup trigger.
 * Auth: `Authorization: Bearer ${CRON_SECRET}` or `?token=` (production).
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  const cronSecret = process.env.CRON_SECRET;
  const authorized = !!cronSecret && (token === cronSecret || req.headers.get('authorization') === `Bearer ${cronSecret}`);
  if (process.env.NODE_ENV === 'production' && !authorized) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const r = await retryFailedRefunds();
    return NextResponse.json({ success: true, ...r });
  } catch (error: any) {
    console.error('[Cron Refund Retry API] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
