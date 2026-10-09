import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * One-time, idempotent schema fix for production: applies EXACTLY the reviewed,
 * additive migrations that were never run on the production database:
 *   - prisma/migrations/20261009010000_snap_delivery_and_newsletter
 *   - prisma/migrations/20261009033000_store_credit_idempotency
 * Every statement is IF NOT EXISTS; nothing existing is altered, locked for long
 * or deleted. Statements are fixed constants (no request input reaches SQL).
 *
 * POST only, `Authorization: Bearer <CRON_SECRET>` required (fails closed when
 * unset). Triggered manually by .github/workflows/db-ensure-ad-ledger.yml.
 * Returns a read-only verification of the resulting tables / columns / indexes.
 */
const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "ad_conversion_deliveries" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "eventTime" TIMESTAMP(3),
    "context" JSONB,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ad_conversion_deliveries_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ad_conversion_deliveries_platform_eventName_orderId_key"
    ON "ad_conversion_deliveries"("platform", "eventName", "orderId")`,
  `CREATE INDEX IF NOT EXISTS "ad_conversion_deliveries_status_updatedAt_idx"
    ON "ad_conversion_deliveries"("status", "updatedAt")`,
  `CREATE TABLE IF NOT EXISTS "newsletter_subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'subscribed',
    "source" TEXT NOT NULL DEFAULT 'storefront_footer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscribers_email_key"
    ON "newsletter_subscribers"("email")`,
  `ALTER TABLE "StoreCredit" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "StoreCredit_idempotencyKey_key"
    ON "StoreCredit"("idempotencyKey")`,
];

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get('authorization') || '');
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function verify() {
  const columns: any[] = await prisma.$queryRawUnsafe(
    `SELECT table_name, count(*)::int AS columns FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name IN ('ad_conversion_deliveries', 'newsletter_subscribers')
      GROUP BY 1 ORDER BY 1`,
  );
  const storeCreditKey: any[] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'StoreCredit' AND column_name = 'idempotencyKey'`,
  );
  const indexes: any[] = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()
      AND indexname IN ('ad_conversion_deliveries_platform_eventName_orderId_key',
                        'ad_conversion_deliveries_status_updatedAt_idx',
                        'newsletter_subscribers_email_key', 'StoreCredit_idempotencyKey_key')
      ORDER BY 1`,
  );
  const tables = Object.fromEntries(columns.map(r => [r.table_name, r.columns]));
  const ok = tables.ad_conversion_deliveries === 14 && tables.newsletter_subscribers === 6
    && storeCreditKey[0]?.n === 1 && indexes.length === 4;
  return { ok, tables, storeCreditIdempotencyKey: storeCreditKey[0]?.n === 1, indexes: indexes.map(r => r.indexname) };
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await prisma.$transaction(STATEMENTS.map(sql => prisma.$executeRawUnsafe(sql)));
    const result = await verify();
    console.log('[DB ensure ad ledger]', JSON.stringify(result));
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err: any) {
    console.error('[DB ensure ad ledger] failed:', err?.message);
    return NextResponse.json({ ok: false, error: String(err?.message || 'error').slice(0, 300) }, { status: 500 });
  }
}

/** Read-only check (same auth). */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await verify();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || 'error').slice(0, 300) }, { status: 500 });
  }
}
