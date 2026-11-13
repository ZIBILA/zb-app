import { NextRequest, NextResponse } from 'next/server';
import { runWhatsAppScheduler } from '@/lib/whatsapp/scheduler';

export const dynamic = 'force-dynamic';

/**
 * Cron: /api/cron/whatsapp-scheduler
 *
 * The server already runs this every 5 minutes (lib/background-jobs.ts); this endpoint is the external
 * backup trigger (GitHub Actions). Auth: `Authorization: Bearer ${CRON_SECRET}` or `?secret=`.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[WhatsApp Scheduler] CRON_SECRET is not set in environment variables.');
    return NextResponse.json({ error: 'Unauthorized (Config missing)' }, { status: 401 });
  }

  if (secret !== cronSecret && req.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(await runWhatsAppScheduler());
}
