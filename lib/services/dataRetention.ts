/**
 * Retention for the tracking / log tables that grow without bound.
 *
 * The database is ~2.7 GB on a 1 GB Supabase instance while the business data is ~40 MB; the
 * rest is analytics_events (1.65 GB), analytics_sessions, empty cart_sessions, web copies of
 * whatsapp_events, and heartbeat/log rows. This job trims ONLY the eight tables in
 * RETENTION_ALLOWED_TABLES, under the rules in RULES below. Business data is never touched:
 * every rule keeps purchases, orders, anything with contact details or WhatsApp history, and
 * the refund audit rows, forever.
 *
 * Safety:
 * - DRY RUN BY DEFAULT. Unless DATA_RETENTION_ENABLED === 'true' the job only counts the rows
 *   each rule would remove and reports them. Nothing is deleted.
 * - Deletes run in batches of BATCH_SIZE ids (select ids, then DELETE ... WHERE id = ANY(ids) AND
 *   <the same predicate again>), each batch in its own short transaction with
 *   SET LOCAL statement_timeout / lock_timeout, a pause between batches, and a time budget per
 *   run. Never one giant delete, never a full-table vacuum, truncate or drop. A backlog may take
 *   several nights; that is intended.
 * - Only one instance runs at a time: a Postgres advisory lock (pg_try_advisory_lock) taken on a
 *   dedicated connection; if it is held elsewhere the run is skipped.
 * - Table names come from the hard-coded allow-list; SQL is built only from constants here.
 * - Day thresholds come from env with defaults and safe minimums; a value below the minimum (or
 *   not a number) is rejected and the default is used.
 *
 * Reads of protected tables ("Order", cart_items, whatsapp_messages, whatsapp_event_logs) appear
 * ONLY inside NOT EXISTS sub-selects of the WHERE clauses, so that a delete can never cascade into
 * (cart_items → ON DELETE CASCADE, whatsapp_event_logs → CASCADE) or modify (whatsapp_messages.
 * cart_id → ON DELETE SET NULL) protected data. No statement here deletes from or updates them.
 *
 * Runs: nightly at 06:30 IST (after the Supabase daily backup) from lib/background-jobs.ts, or on demand through
 * GET /api/cron/data-retention (Bearer CRON_SECRET; fails closed).
 */
import { Client } from 'pg';

// ───────────────────────────── allow-list and constants ─────────────────────────────

/** The only tables this service may ever delete from. Everything else is protected. */
export const RETENTION_ALLOWED_TABLES = [
  'analytics_events',
  'analytics_sessions',
  'cart_sessions',
  'whatsapp_events',
  'RateLimitLog',
  'whatsapp_webhook_events',
  'SyncLog',
  'whatsapp_scheduler_runs',
] as const;
export type RetentionTable = (typeof RETENTION_ALLOWED_TABLES)[number];

/**
 * Copied verbatim from WEBSITE_PIXEL_TRACKED_EVENTS in lib/services/eventTracker.ts (that
 * constant is not exported and that file must not change). These are the storefront events the
 * website Meta Pixel + CAPI already report, so their `event_source = 'web'` copies in
 * whatsapp_events are never forwarded to Meta (status 'processed').
 */
export const WEBSITE_PIXEL_TRACKED_EVENTS_COPY = [
  'Product Viewed', 'Category Viewed', 'Search Performed', 'Add To Wishlist', 'Add To Cart',
  'Remove From Cart', 'Checkout Started', 'Payment Initiated', 'Purchase Completed', 'COD Order Placed',
] as const;

/**
 * Pixel-tracked names that are nevertheless KEPT FOREVER: app/api/whatsapp-events/stats sums
 * all-time revenue and the funnel's purchase step from these rows (stricter than the original rule).
 */
export const WHATSAPP_PURCHASE_EVENTS = ['Purchase Completed', 'COD Order Placed'] as const;

/** Web whatsapp_events names that rule (d) may delete = pixel-tracked set minus the purchase names. */
export const DELETABLE_WEB_WHATSAPP_EVENTS: readonly string[] = WEBSITE_PIXEL_TRACKED_EVENTS_COPY.filter(
  (name) => !(WHATSAPP_PURCHASE_EVENTS as readonly string[]).includes(name),
);

/** analytics_events names kept forever (order attribution in app/api/admin/marketing/stats). */
export const KEPT_ANALYTICS_EVENT_NAMES = ['purchase', 'order_created'] as const;

/** SyncLog actions kept forever: the only persisted audit trail of refunds (stricter than the original rule). */
export const KEPT_SYNCLOG_ACTIONS = ['RAZORPAY_REFUND', 'SHOPIFY_REFUND_SYNC'] as const;

export const BATCH_SIZE = 2_000;
export const PAUSE_BETWEEN_BATCHES_MS = 250;
/** A rule stops after this many batches per run so one huge table cannot starve the others. */
export const MAX_BATCHES_PER_RULE = 150;
export const DEFAULT_BUDGET_MS = 10 * 60_000;
export const MAX_BUDGET_MS = 10 * 60_000;
export const BATCH_STATEMENT_TIMEOUT = '30s';
export const COUNT_STATEMENT_TIMEOUT = '120s';
export const LOCK_TIMEOUT = '5s';
/** Arbitrary constant; the same key on every instance is what makes the lock exclusive. */
export const ADVISORY_LOCK_KEY = 823471190;

export const RETENTION_DEFAULT_DAYS = {
  analyticsDays: 90,
  waEventsDays: 60,
  cartDays: 14,
  rateLimitDays: 2,
  webhookDays: 30,
  syncLogDays: 30,
  schedulerRunsDays: 30,
} as const;

/** Values below these are rejected (the default is used instead). */
export const RETENTION_MIN_DAYS = {
  analyticsDays: 30,
  waEventsDays: 30,
  cartDays: 7,
} as const;

export type RetentionDays = { -readonly [K in keyof typeof RETENTION_DEFAULT_DAYS]: number };

export interface RetentionConfig {
  enabled: boolean;
  days: RetentionDays;
  warnings: string[];
}

// ───────────────────────────── configuration ─────────────────────────────

function readDays(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  warnings: string[],
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < minimum) {
    warnings.push(`${name}="${raw}" rejected (minimum ${minimum} days); using default ${fallback}`);
    return fallback;
  }
  return n;
}

/** Env-driven settings. Only the first three thresholds are configurable; the rest are fixed. */
export function getRetentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  const warnings: string[] = [];
  const d = RETENTION_DEFAULT_DAYS;
  const m = RETENTION_MIN_DAYS;
  return {
    enabled: env.DATA_RETENTION_ENABLED === 'true',
    days: {
      analyticsDays: readDays(env, 'RETENTION_ANALYTICS_DAYS', d.analyticsDays, m.analyticsDays, warnings),
      waEventsDays: readDays(env, 'RETENTION_WA_EVENTS_DAYS', d.waEventsDays, m.waEventsDays, warnings),
      cartDays: readDays(env, 'RETENTION_CART_DAYS', d.cartDays, m.cartDays, warnings),
      rateLimitDays: d.rateLimitDays,
      webhookDays: d.webhookDays,
      syncLogDays: d.syncLogDays,
      schedulerRunsDays: d.schedulerRunsDays,
    },
    warnings,
  };
}

// ───────────────────────────── rules ─────────────────────────────

interface RuleDef {
  /** Short name used in logs and the JSON summary. */
  rule: string;
  table: RetentionTable;
  /** Postgres type of the primary key, for the `= ANY($2::<type>[])` delete. */
  idType: 'text' | 'int';
  daysKey: keyof RetentionDays;
  /** WHERE clause; `t` is the target table, `$1` the cutoff timestamp. */
  predicate: string;
  /** What is kept, in plain words (for the summary and the PR). */
  keeps: string;
}

function sqlList(values: readonly string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
}

const KEPT_ANALYTICS_EVENT = `(e.event_name IN (${sqlList(KEPT_ANALYTICS_EVENT_NAMES)}) OR e.order_id IS NOT NULL)`;

export const RULES: readonly RuleDef[] = [
  {
    rule: 'analytics_events',
    table: 'analytics_events',
    idType: 'text',
    daysKey: 'analyticsDays',
    predicate:
      `t.created_at < $1 ` +
      `AND t.event_name NOT IN (${sqlList(KEPT_ANALYTICS_EVENT_NAMES)}) ` +
      `AND t.order_id IS NULL`,
    keeps: "every 'purchase' / 'order_created' event and every event with an order_id, forever",
  },
  {
    rule: 'analytics_sessions',
    table: 'analytics_sessions',
    idType: 'text',
    daysKey: 'analyticsDays',
    predicate:
      `t.last_active_at < $1 ` +
      `AND NOT EXISTS (SELECT 1 FROM "analytics_events" e WHERE e.anonymous_id = t.anonymous_id AND ${KEPT_ANALYTICS_EVENT}) ` +
      `AND NOT EXISTS (SELECT 1 FROM "analytics_events" e WHERE e.session_id = t.id AND ${KEPT_ANALYTICS_EVENT}) ` +
      `AND (t.customer_id IS NULL OR (` +
      `NOT EXISTS (SELECT 1 FROM "analytics_events" e WHERE e.customer_id = t.customer_id AND ${KEPT_ANALYTICS_EVENT}) ` +
      `AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = t.customer_id)))`,
    keeps:
      'sessions whose anonymous_id, customer_id or id appears in a kept purchase/order event, and sessions of any customer who has an Order, forever',
  },
  {
    rule: 'cart_sessions',
    table: 'cart_sessions',
    idType: 'text',
    daysKey: 'cartDays',
    predicate:
      `t.last_activity_at < $1 ` +
      `AND t.customer_id IS NULL AND t.phone_number IS NULL AND t.phone_last_10 IS NULL AND t.email IS NULL ` +
      `AND t.status <> 'converted' AND t.converted_order_id IS NULL AND t.abandoned_at IS NULL ` +
      `AND NOT EXISTS (SELECT 1 FROM "cart_items" i WHERE i.cart_session_id = t.id) ` +
      `AND NOT EXISTS (SELECT 1 FROM "whatsapp_messages" m WHERE m.cart_id = t.id)`,
    keeps: 'any cart with items, a customer, phone, email, conversion, abandonment marker or WhatsApp message, forever',
  },
  {
    rule: 'whatsapp_events',
    table: 'whatsapp_events',
    idType: 'text',
    daysKey: 'waEventsDays',
    predicate:
      `t.created_at < $1 ` +
      `AND t.event_source = 'web' ` +
      `AND t.event_name IN (${sqlList(DELETABLE_WEB_WHATSAPP_EVENTS)}) ` +
      `AND t.status IN ('processed', 'pending') ` +
      `AND t.order_id IS NULL ` +
      `AND NOT EXISTS (SELECT 1 FROM "whatsapp_event_logs" l WHERE l.event_id = t.id)`,
    keeps:
      "all non-web events, every 'forwarded' / 'failed' event, 'Purchase Completed' / 'COD Order Placed', anything with an order_id or a whatsapp_event_logs row, forever",
  },
  {
    rule: 'RateLimitLog',
    table: 'RateLimitLog',
    idType: 'int',
    daysKey: 'rateLimitDays',
    predicate: `t."timestamp" < $1`,
    keeps: 'the last 2 days (the longest rate-limit window in the app is 1 hour)',
  },
  {
    rule: 'whatsapp_webhook_events',
    table: 'whatsapp_webhook_events',
    idType: 'text',
    daysKey: 'webhookDays',
    predicate: `t."createdAt" < $1`,
    keeps: 'the last 30 days (readers only look at the newest 200 rows)',
  },
  {
    rule: 'SyncLog',
    table: 'SyncLog',
    idType: 'text',
    daysKey: 'syncLogDays',
    predicate: `t."createdAt" < $1 AND t.action NOT IN (${sqlList(KEPT_SYNCLOG_ACTIONS)})`,
    keeps: 'the last 30 days of heartbeats/sync logs, and every RAZORPAY_REFUND / SHOPIFY_REFUND_SYNC row forever',
  },
  {
    rule: 'whatsapp_scheduler_runs',
    table: 'whatsapp_scheduler_runs',
    idType: 'text',
    daysKey: 'schedulerRunsDays',
    predicate: `t.created_at < $1`,
    keeps: 'the last 30 days (only the newest row is ever read)',
  },
];

// ───────────────────────────── SQL construction ─────────────────────────────

function assertAllowedTable(table: string): RetentionTable {
  if (!(RETENTION_ALLOWED_TABLES as readonly string[]).includes(table)) {
    throw new Error(`[data-retention] refusing to touch table "${table}": not in the allow-list`);
  }
  return table as RetentionTable;
}

function quoteIdent(table: RetentionTable): string {
  return `"${table.replace(/"/g, '""')}"`;
}

export interface RuleSql {
  rule: string;
  table: RetentionTable;
  days: number;
  keeps: string;
  countSql: string;
  selectSql: string;
  deleteSql: string;
}

/** The exact statements a rule runs. `$1` = cutoff timestamp, `$2` = the batch of ids. */
export function buildRuleSql(def: RuleDef, days: number): RuleSql {
  const table = quoteIdent(assertAllowedTable(def.table));
  return {
    rule: def.rule,
    table: def.table,
    days,
    keeps: def.keeps,
    countSql: `SELECT count(*)::int AS n FROM ${table} t WHERE ${def.predicate}`,
    selectSql: `SELECT t.id FROM ${table} t WHERE ${def.predicate} LIMIT ${BATCH_SIZE}`,
    deleteSql: `DELETE FROM ${table} t WHERE t.id = ANY($2::${def.idType}[]) AND ${def.predicate}`,
  };
}

/** For review: every rule's SQL with the thresholds the current env resolves to. */
export function describeRetentionRules(config: RetentionConfig = getRetentionConfig()): RuleSql[] {
  return RULES.map((def) => buildRuleSql(def, config.days[def.daysKey]));
}

// ───────────────────────────── run ─────────────────────────────

export interface RetentionRuleResult {
  rule: string;
  table: RetentionTable;
  days: number;
  cutoff: string;
  /** Dry run: rows the rule matches right now. Live: not counted (null). */
  matched: number | null;
  deleted: number;
  batches: number;
  backlogRemaining: boolean;
  countError?: string;
  error?: string;
  skipped?: 'budget';
}

export interface RetentionRunSummary {
  mode: 'dry-run' | 'live';
  enabledByEnv: boolean;
  startedAt: string;
  durationMs: number;
  budgetMs: number;
  budgetExhausted: boolean;
  lock: 'acquired' | 'held-elsewhere' | 'not-attempted';
  lockWarning?: string;
  rules: RetentionRuleResult[];
  backlogRemaining: boolean;
  days: RetentionDays;
  warnings: string[];
  error?: string;
}

export interface RunOptions {
  /** Force a dry run even when DATA_RETENTION_ENABLED=true. There is no option in the other direction. */
  forceDryRun?: boolean;
  /** Wall-clock budget for this run; clamped to [5 s, MAX_BUDGET_MS]. */
  budgetMs?: number;
  /** For tests: "now". */
  now?: Date;
}

/** Same resolution order and TLS fix-up as lib/db.ts, without importing it (this module must load with no DB). */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const dbUrl = env.DATABASE_URL || '';
  let url =
    env.SUPABASE_DATABASE_URL ||
    env.POSTGRES_PRISMA_URL ||
    env.POSTGRES_URL ||
    (dbUrl && !dbUrl.startsWith('file:') ? dbUrl : '');
  if (!url || url.includes('placeholder') || url.includes('(not available)')) return null;
  if (/sslmode=(require|verify-ca|verify-full)/.test(url)) {
    url = url.replace(/sslmode=(require|verify-ca|verify-full)/g, 'sslmode=no-verify');
  } else if (!url.includes('sslmode=')) {
    url += (url.includes('?') ? '&' : '?') + 'sslmode=no-verify';
  }
  return url;
}

/** A transaction-mode pooler hands each statement to a different server session, so a session lock is not exclusive there. */
function poolerWarning(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.port === '6543' || u.searchParams.get('pgbouncer') === 'true') {
      return 'database URL looks like a transaction-mode pooler: the advisory lock cannot be guaranteed exclusive';
    }
  } catch {
    /* not a URL we can parse: nothing to say */
  }
  return undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The cutoff travels as a UTC ISO string, not a Date: node-postgres would format a Date in the
 * process's local zone, and for `timestamp` (no tz) columns Postgres ignores the offset. Prisma
 * stores UTC, so the UTC string compares exactly, and the untyped parameter keeps the index usable.
 */
const cutoffParam = (cutoff: Date): string => cutoff.toISOString();

async function countRule(client: Client, sql: RuleSql, cutoff: Date): Promise<number> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL statement_timeout = '${COUNT_STATEMENT_TIMEOUT}'`);
    const res = await client.query<{ n: number }>(sql.countSql, [cutoffParam(cutoff)]);
    await client.query('COMMIT');
    return res.rows[0]?.n ?? 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

/** One batch: select up to BATCH_SIZE ids, delete exactly those ids (re-checking the predicate), commit. */
async function deleteBatch(client: Client, sql: RuleSql, cutoff: Date): Promise<{ selected: number; deleted: number }> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL statement_timeout = '${BATCH_STATEMENT_TIMEOUT}'`);
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const picked = await client.query<{ id: string | number }>(sql.selectSql, [cutoffParam(cutoff)]);
    const ids = picked.rows.map((r) => r.id);
    let deleted = 0;
    if (ids.length > 0) {
      const res = await client.query(sql.deleteSql, [cutoffParam(cutoff), ids]);
      deleted = res.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return { selected: ids.length, deleted };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

/**
 * Runs every rule once. Dry run (the default) only counts; live mode deletes in batches until the
 * rule is drained, MAX_BATCHES_PER_RULE is reached, or the time budget is spent.
 */
export async function runDataRetention(opts: RunOptions = {}): Promise<RetentionRunSummary> {
  const config = getRetentionConfig();
  const dryRun = opts.forceDryRun === true || !config.enabled;
  const budgetMs = Math.min(MAX_BUDGET_MS, Math.max(5_000, opts.budgetMs ?? DEFAULT_BUDGET_MS));
  const now = opts.now ?? new Date();
  const t0 = Date.now();
  const deadline = t0 + budgetMs;

  const summary: RetentionRunSummary = {
    mode: dryRun ? 'dry-run' : 'live',
    enabledByEnv: config.enabled,
    startedAt: now.toISOString(),
    durationMs: 0,
    budgetMs,
    budgetExhausted: false,
    lock: 'not-attempted',
    rules: [],
    backlogRemaining: false,
    days: config.days,
    warnings: [...config.warnings],
  };
  const finish = () => {
    summary.durationMs = Date.now() - t0;
    summary.backlogRemaining = summary.rules.some((r) => r.backlogRemaining);
    return summary;
  };

  const url = resolveDatabaseUrl();
  if (!url) {
    summary.error = 'no database URL configured';
    return finish();
  }
  const lockWarning = poolerWarning(url);
  if (lockWarning) summary.lockWarning = lockWarning;

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 8_000,
    application_name: 'zb-data-retention',
  });
  try {
    await client.connect();
  } catch (err) {
    summary.error = `connect failed: ${errorMessage(err)}`;
    return finish();
  }

  try {
    const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_KEY]);
    if (!lock.rows[0]?.locked) {
      summary.lock = 'held-elsewhere';
      return finish();
    }
    summary.lock = 'acquired';

    try {
      for (const def of RULES) {
        const days = config.days[def.daysKey];
        const cutoff = new Date(now.getTime() - days * 24 * 60 * 60_000);
        const sql = buildRuleSql(def, days);
        const result: RetentionRuleResult = {
          rule: def.rule,
          table: def.table,
          days,
          cutoff: cutoff.toISOString(),
          matched: null,
          deleted: 0,
          batches: 0,
          backlogRemaining: false,
        };
        summary.rules.push(result);

        if (Date.now() >= deadline) {
          result.skipped = 'budget';
          result.backlogRemaining = true;
          summary.budgetExhausted = true;
          continue;
        }

        if (dryRun) {
          try {
            result.matched = await countRule(client, sql, cutoff);
            result.backlogRemaining = result.matched > 0;
          } catch (err) {
            result.countError = errorMessage(err);
            result.backlogRemaining = true; // unknown → assume there is work
          }
          continue;
        }

        // Live: batched deletes.
        while (true) {
          if (Date.now() >= deadline) {
            result.backlogRemaining = true;
            summary.budgetExhausted = true;
            break;
          }
          if (result.batches >= MAX_BATCHES_PER_RULE) {
            result.backlogRemaining = true;
            break;
          }
          let batch: { selected: number; deleted: number };
          try {
            batch = await deleteBatch(client, sql, cutoff);
          } catch (err) {
            result.error = errorMessage(err);
            result.backlogRemaining = true;
            break;
          }
          result.batches += 1;
          result.deleted += batch.deleted;
          if (batch.selected < BATCH_SIZE) break; // drained
          await sleep(PAUSE_BETWEEN_BATCHES_MS);
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    }
  } catch (err) {
    summary.error = errorMessage(err);
  } finally {
    await client.end().catch(() => {});
  }
  return finish();
}

/** One log line for lib/background-jobs.ts. */
export function formatRetentionSummary(s: RetentionRunSummary): string {
  const rules = s.rules
    .map((r) => {
      if (r.skipped) return `${r.rule}=skipped(${r.skipped})`;
      if (s.mode === 'dry-run') return `${r.rule}=${r.countError ? `count-failed(${r.countError})` : `would-delete:${r.matched}`}`;
      return `${r.rule}=deleted:${r.deleted}/${r.batches}b${r.backlogRemaining ? '+' : ''}${r.error ? `(error:${r.error})` : ''}`;
    })
    .join(' ');
  const extra = [
    s.error ? `error="${s.error}"` : '',
    s.lockWarning ? `lockWarning="${s.lockWarning}"` : '',
    s.warnings.length ? `warnings="${s.warnings.join('; ')}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `mode=${s.mode} lock=${s.lock} duration=${(s.durationMs / 1000).toFixed(1)}s backlog=${s.backlogRemaining ? 'yes' : 'no'}${s.budgetExhausted ? ' budget-exhausted' : ''} ${rules}${extra ? ` ${extra}` : ''}`;
}
