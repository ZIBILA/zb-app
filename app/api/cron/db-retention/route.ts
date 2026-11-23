import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Retention for the unbounded event tables that filled the Supabase instance (23 Nov 2026:
 * analytics_events 1.65 GB, analytics_sessions 410 MB, cart_sessions 247 MB, whatsapp_events 194 MB,
 * RateLimitLog 26 MB — 2.5 GB of the 2.6 GB database).
 *
 *   GET  …/db-retention                       dry run: how many rows each policy would delete, table sizes
 *   POST …/db-retention                       dry run as well (nothing is deleted without mode=apply)
 *   POST …/db-retention?mode=apply            delete, in batches of `batch` rows, until every policy is
 *                                             complete or `budgetMs` has elapsed; the caller repeats the
 *                                             call while `complete` is false
 *   query: tables=a,b   restrict to some policies      batch=5000 (500–20000)      budgetMs=45000 (≤55000)
 *
 * `Authorization: Bearer <CRON_SECRET>` required (fails closed when unset). Triggered manually by
 * .github/workflows/db-retention.yml — never on a schedule, the owner decides when it runs.
 *
 * Each batch: SELECT up to `batch` ids past the cutoff → delete / detach child rows → DELETE the parents
 * by id. Children are handled explicitly rather than trusting ON DELETE clauses that may not exist on
 * tables created outside Prisma Migrate. No transaction is opened: a batch that stops half way leaves
 * nothing inconsistent (orphan-free children gone, parents picked up by the next run).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type ChildRule = { table: string; column: string; action: 'delete' | 'nullify' };

type Policy = {
  name: string;
  description: string;
  table: string;
  idColumn: string;
  idSqlType: 'text' | 'int';
  tsColumn: string;
  retentionMs: number;
  /** extra SQL condition (constant, no request input) */
  extraWhere?: string;
  children?: ChildRule[];
};

const POLICIES: Policy[] = [
  {
    name: 'analytics_events',
    description: 'storefront analytics events older than 90 days',
    table: '"analytics_events"', idColumn: '"id"', idSqlType: 'text', tsColumn: '"created_at"',
    retentionMs: 90 * DAY_MS,
  },
  {
    name: 'analytics_sessions',
    description: 'analytics sessions started more than 180 days ago',
    table: '"analytics_sessions"', idColumn: '"id"', idSqlType: 'text', tsColumn: '"started_at"',
    retentionMs: 180 * DAY_MS,
  },
  {
    name: 'cart_sessions',
    description: 'carts idle for more than 180 days that never converted to an order (their cart_items go too; whatsapp_messages keep their row and lose the cart link)',
    table: '"cart_sessions"', idColumn: '"id"', idSqlType: 'text', tsColumn: '"last_activity_at"',
    retentionMs: 180 * DAY_MS,
    extraWhere: 'AND "converted_order_id" IS NULL',
    children: [
      { table: '"cart_items"', column: '"cart_session_id"', action: 'delete' },
      { table: '"whatsapp_messages"', column: '"cart_id"', action: 'nullify' },
    ],
  },
  {
    name: 'whatsapp_events',
    description: 'WhatsApp event records older than 90 days (and their whatsapp_event_logs)',
    table: '"whatsapp_events"', idColumn: '"id"', idSqlType: 'text', tsColumn: '"created_at"',
    retentionMs: 90 * DAY_MS,
    children: [{ table: '"whatsapp_event_logs"', column: '"event_id"', action: 'delete' }],
  },
  {
    name: 'rate_limit_log',
    description: 'RateLimitLog rows older than 1 hour (the longest window any limiter uses)',
    table: '"RateLimitLog"', idColumn: '"id"', idSqlType: 'int', tsColumn: '"timestamp"',
    retentionMs: 60 * 60 * 1000,
  },
];

const DEFAULT_BATCH = 5_000;
const MAX_BATCH = 20_000;
const MIN_BATCH = 500;
const DEFAULT_BUDGET_MS = 45_000;
const MAX_BUDGET_MS = 55_000;
const DRY_RUN_COUNT_CAP = 500_000;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get('authorization') || '');
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function selectPolicies(raw: string | null): Policy[] | { error: string } {
  if (!raw || raw === 'all') return POLICIES;
  const wanted = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = wanted.filter((w) => !POLICIES.some((p) => p.name === w));
  if (unknown.length) return { error: `unknown tables: ${unknown.join(', ')}; known: ${POLICIES.map((p) => p.name).join(', ')}` };
  return POLICIES.filter((p) => wanted.includes(p.name));
}

async function tableSize(table: string): Promise<{ totalBytes: number; estimatedRows: number } | null> {
  try {
    const rows: Array<{ total_bytes: bigint | number; reltuples: number }> = await prisma.$queryRawUnsafe(
      `SELECT pg_total_relation_size($1::regclass)::bigint AS total_bytes,
              (SELECT reltuples FROM pg_class WHERE oid = $1::regclass)::float8 AS reltuples`,
      table.replace(/"/g, ''),
    );
    const r = rows[0];
    return r ? { totalBytes: Number(r.total_bytes), estimatedRows: Math.max(0, Math.round(Number(r.reltuples))) } : null;
  } catch {
    return null;
  }
}

async function countCandidates(p: Policy, cutoff: Date): Promise<{ count: number; capped: boolean }> {
  const rows: Array<{ n: number }> = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM (SELECT 1 FROM ${p.table} WHERE ${p.tsColumn} < $1 ${p.extraWhere ?? ''} LIMIT ${DRY_RUN_COUNT_CAP}) s`,
    cutoff,
  );
  const n = rows[0]?.n ?? 0;
  return { count: n, capped: n >= DRY_RUN_COUNT_CAP };
}

/** One batch: returns the number of parent rows deleted (< batch size means the policy is complete). */
async function deleteBatch(p: Policy, cutoff: Date, batch: number): Promise<number> {
  const idRows: Array<{ id: string | number }> = await prisma.$queryRawUnsafe(
    `SELECT ${p.idColumn} AS id FROM ${p.table} WHERE ${p.tsColumn} < $1 ${p.extraWhere ?? ''} LIMIT ${batch}`,
    cutoff,
  );
  if (idRows.length === 0) return 0;
  const ids = idRows.map((r) => r.id);
  const arrayType = p.idSqlType === 'int' ? 'int[]' : 'text[]';
  for (const child of p.children ?? []) {
    if (child.action === 'delete') {
      await prisma.$executeRawUnsafe(`DELETE FROM ${child.table} WHERE ${child.column} = ANY($1::${arrayType})`, ids);
    } else {
      await prisma.$executeRawUnsafe(`UPDATE ${child.table} SET ${child.column} = NULL WHERE ${child.column} = ANY($1::${arrayType})`, ids);
    }
  }
  return prisma.$executeRawUnsafe(`DELETE FROM ${p.table} WHERE ${p.idColumn} = ANY($1::${arrayType})`, ids);
}

type TableReport = {
  name: string;
  description: string;
  cutoff: string;
  size?: { totalBytes: number; totalMB: number; estimatedRows: number } | null;
  candidates?: number;
  candidatesCapped?: boolean;
  deleted?: number;
  batches?: number;
  complete?: boolean;
  ms: number;
  error?: string;
};

async function run(req: NextRequest, allowApply: boolean) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((prisma as unknown as { _isMock?: boolean })._isMock) {
    return NextResponse.json({ error: 'database unavailable' }, { status: 503 });
  }

  const url = new URL(req.url);
  const apply = allowApply && url.searchParams.get('mode') === 'apply';
  const batch = clampInt(url.searchParams.get('batch'), DEFAULT_BATCH, MIN_BATCH, MAX_BATCH);
  const budgetMs = clampInt(url.searchParams.get('budgetMs'), DEFAULT_BUDGET_MS, 1_000, MAX_BUDGET_MS);
  const selected = selectPolicies(url.searchParams.get('tables'));
  if ('error' in selected) return NextResponse.json({ error: selected.error }, { status: 400 });

  const startedAt = Date.now();
  const now = new Date(startedAt);
  const tables: TableReport[] = [];
  let complete = true;

  for (const p of selected) {
    const cutoff = new Date(now.getTime() - p.retentionMs);
    const t0 = Date.now();
    const report: TableReport = { name: p.name, description: p.description, cutoff: cutoff.toISOString(), ms: 0 };
    try {
      if (!apply) {
        const [size, candidates] = await Promise.all([tableSize(p.table), countCandidates(p, cutoff)]);
        report.size = size ? { ...size, totalMB: Math.round(size.totalBytes / 1024 / 1024) } : null;
        report.candidates = candidates.count;
        report.candidatesCapped = candidates.capped;
      } else {
        let deleted = 0;
        let batches = 0;
        let done = false;
        while (Date.now() - startedAt < budgetMs) {
          const n = await deleteBatch(p, cutoff, batch);
          deleted += n;
          batches++;
          if (n < batch) { done = true; break; }
        }
        report.deleted = deleted;
        report.batches = batches;
        report.complete = done;
        if (!done) complete = false;
      }
    } catch (err) {
      report.error = String((err as Error)?.message || err).slice(0, 300);
      complete = false;
    }
    report.ms = Date.now() - t0;
    tables.push(report);
    if (apply && Date.now() - startedAt >= budgetMs) {
      // Budget spent: remaining policies are reported as not run so the caller knows to call again.
      for (const rest of selected.slice(selected.indexOf(p) + 1)) {
        tables.push({ name: rest.name, description: rest.description, cutoff: new Date(now.getTime() - rest.retentionMs).toISOString(), deleted: 0, batches: 0, complete: false, ms: 0 });
      }
      complete = false;
      break;
    }
  }

  const summary = {
    ok: tables.every((t) => !t.error),
    mode: apply ? 'apply' : 'dry-run',
    batch: apply ? batch : undefined,
    budgetMs: apply ? budgetMs : undefined,
    complete: apply ? complete : undefined,
    elapsedMs: Date.now() - startedAt,
    tables,
  };

  console.log('[DB retention]', JSON.stringify(summary));
  if (apply) {
    try {
      await prisma.syncLog.create({
        data: {
          orderId: 'system',
          action: 'DB_RETENTION',
          status: summary.ok ? (complete ? 'COMPLETE' : 'PARTIAL') : 'ERROR',
          payload: JSON.stringify(summary).slice(0, 8_000),
        },
      });
    } catch (logErr) {
      console.warn('[DB retention] could not record SyncLog:', (logErr as Error)?.message);
    }
  }
  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
}

/** Dry run only. */
export async function GET(req: NextRequest) {
  return run(req, false);
}

/** Dry run unless `?mode=apply`. */
export async function POST(req: NextRequest) {
  return run(req, true);
}
