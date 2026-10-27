/**
 * Durable, idempotent delivery ledger for server-side Snap conversions.
 * Backed by the AdConversionDelivery table: one row per (platform, eventName, orderId).
 *
 *   pending ──claim──▶ sending (leased) ──Snap OK──▶ sent      (sentAt set only here)
 *                                     └──Snap error─▶ failed    (retryable, same event_id/time)
 *                                     └──blocked────▶ failed    (retryable, attempt NOT counted)
 *                                     └──too old────▶ skipped   (never re-dated)
 *
 * "blocked" = the sender could not even try (access token missing or refused,
 * validation-only mode). That is a problem with our setup, not with the
 * conversion, so it never uses up the row's retry attempts.
 *
 * The claim is a single conditional UPDATE, so two processes can never both send.
 * No database import: the Prisma client (or a fake in tests) is injected.
 */
import { isEventTimeSendable } from '@/lib/snap-capi';

export const MAX_ATTEMPTS = 5;
const LEASE_MS = 60_000;
/** Snap rejects events older than 7 days; pending rows older than this are expired. */
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type LedgerContext = Record<string, string | number | boolean>;
export type DeliveryResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  /** `blocked` names a setup problem (see SendResult); `asset` the Snap asset it concerns (app jobs). */
  | { status: 'failed'; reason: string; blocked?: string; asset?: string };

/**
 * What a sender reports back. `blocked` (any non-empty string naming the cause)
 * means nothing could be attempted with the current setup: the row stays
 * retryable and the attempt is given back.
 */
export type SendResult = { success: boolean; error?: any; skipped?: boolean; blocked?: string };

/** A ledger row as the retry / recovery jobs see it. */
export interface LedgerRowSummary {
  id: string;
  orderId: string;
  status: string;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
  /** The conversion's own time, pinned at the first delivery attempt (null before that). */
  eventTime?: Date | null;
  lastError: string | null;
}

export function cleanContext(ctx: unknown): LedgerContext {
  const out: LedgerContext = {};
  if (!ctx || typeof ctx !== 'object') return out;
  for (const [k, v] of Object.entries(ctx as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 1024);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** Values already stored win; a later request only fills gaps. */
export function mergeContext(existing: unknown, incoming: LedgerContext): LedgerContext {
  return { ...incoming, ...cleanContext(existing) };
}

export function isMissingTable(err: any): boolean {
  const msg = String(err?.message || '');
  return err?.code === 'P2021' || (/ad_conversion_deliveries/.test(msg) && /does not exist/i.test(msg));
}

export function createDeliveryLedger(db: any, logTag = '[Snap Ledger]') {
  const keyOf = (platform: string, eventName: string, orderId: string) =>
    ({ platform_eventName_orderId: { platform, eventName, orderId } });

  /** Store context (click ids / device info) before the conversion exists. Never throws. */
  async function recordContext(platform: string, eventName: string, orderId: string, ctx: unknown): Promise<void> {
    try {
      const incoming = cleanContext(ctx);
      if (!orderId || Object.keys(incoming).length === 0) return;
      const key = keyOf(platform, eventName, orderId);
      const existing = await db.adConversionDelivery.findUnique({ where: key, select: { context: true } });
      if (existing) {
        await db.adConversionDelivery.update({ where: key, data: { context: mergeContext(existing.context, incoming) as any } });
      } else {
        await db.adConversionDelivery.create({
          data: { platform, eventName, orderId, eventId: orderId, context: incoming as any },
        }).catch((e: any) => { if (e?.code !== 'P2002') throw e; });
      }
    } catch (err: any) {
      console.warn(`${logTag} could not record context:`, isMissingTable(err) ? 'ledger table missing' : err?.message);
    }
  }

  /**
   * Deliver once. `defaultEventTime` is used only the first time; afterwards the
   * stored conversion time is reused so retries carry identical event_time.
   */
  async function deliver(args: {
    platform: string;
    eventName: string;
    orderId: string;
    ctx?: unknown;
    defaultEventTime: Date;
    build: (context: LedgerContext, eventTimeMs: number) => any;
    send: (payload: any) => Promise<SendResult>;
  }): Promise<DeliveryResult> {
    const { platform, eventName, orderId } = args;
    const key = keyOf(platform, eventName, orderId);
    try {
      const incoming = cleanContext(args.ctx);
      let row = await db.adConversionDelivery.findUnique({ where: key });
      if (!row) {
        try {
          row = await db.adConversionDelivery.create({
            data: { platform, eventName, orderId, eventId: orderId, context: incoming as any },
          });
        } catch (e: any) {
          if (e?.code !== 'P2002') throw e;
          row = await db.adConversionDelivery.findUnique({ where: key });
        }
      } else if (Object.keys(incoming).length) {
        await db.adConversionDelivery.update({ where: key, data: { context: mergeContext(row.context, incoming) as any } });
      }
      if (!row) return { status: 'failed', reason: 'ledger row missing' };
      if (row.status === 'sent' || row.status === 'skipped') return { status: 'skipped', reason: `already ${row.status}` };

      const now = new Date();
      const leaseUntil = new Date(now.getTime() + LEASE_MS);
      const claimed = await db.adConversionDelivery.updateMany({
        where: {
          id: row.id,
          attempts: { lt: MAX_ATTEMPTS },
          OR: [
            { status: { in: ['pending', 'failed'] } },
            { status: 'sending', leaseUntil: { lt: now } },
          ],
        },
        data: { status: 'sending', leaseUntil, attempts: { increment: 1 } },
      });
      if (claimed.count !== 1) return { status: 'skipped', reason: 'claimed by another process or max attempts' };

      const fresh = await db.adConversionDelivery.findUnique({ where: key });
      const context = mergeContext(fresh?.context, incoming);
      const eventTime: Date = fresh?.eventTime || args.defaultEventTime || now;
      if (!fresh?.eventTime) await db.adConversionDelivery.update({ where: key, data: { eventTime } });

      if (!isEventTimeSendable(eventTime.getTime())) {
        await db.adConversionDelivery.update({
          where: key, data: { status: 'skipped', leaseUntil: null, lastError: 'event older than Snap 7-day window' },
        });
        console.warn(`${logTag} ${platform} ${orderId} skipped: event older than 7 days`);
        return { status: 'skipped', reason: 'event too old' };
      }

      const res = await args.send(args.build(context, eventTime.getTime()));
      // Every final write below is conditioned on OUR lease (status 'sending' with
      // the leaseUntil we set). If the lease expired mid-send and another process
      // re-claimed the row, that process owns the outcome; writing 'failed' over its
      // 'sent' would make the cron send the same PURCHASE again.
      const ours = { id: row.id, status: 'sending', leaseUntil };
      if (res.success) {
        const done = await db.adConversionDelivery.updateMany({
          where: ours, data: { status: 'sent', sentAt: new Date(), leaseUntil: null, lastError: null },
        });
        if ((done?.count || 0) !== 1) console.warn(`${logTag} ${platform} ${orderId} sent, but the row was re-claimed by another process before it could be marked`);
        return { status: 'sent' };
      }
      const reason = typeof res.error === 'string' ? res.error : JSON.stringify(res.error ?? 'unknown').slice(0, 500);
      if (res.blocked) {
        // Our setup stopped the send (no token, token refused, validation-only
        // mode): keep the conversion retryable and return the attempt, so an
        // outage on our side can never exhaust the row. Only OUR lease is given
        // back: if it had expired and another process re-claimed the row, that
        // process's attempt must stay counted.
        await db.adConversionDelivery.updateMany({
          where: { id: row.id, status: 'sending', leaseUntil },
          data: { status: 'failed', leaseUntil: null, lastError: reason.slice(0, 500), attempts: { increment: -1 } },
        });
        return { status: 'failed', reason, blocked: res.blocked };
      }
      await db.adConversionDelivery.updateMany({
        where: ours, data: { status: res.skipped ? 'skipped' : 'failed', leaseUntil: null, lastError: reason },
      });
      return res.skipped ? { status: 'skipped', reason } : { status: 'failed', reason };
    } catch (err: any) {
      console.error(`${logTag} delivery error:`, isMissingTable(err) ? 'ledger table missing — apply the migration' : err?.message);
      return { status: 'failed', reason: err?.message || 'error' };
    }
  }

  /** Rows whose delivery failed or whose lease expired, least recently touched first. */
  async function retryableRows(platform: string, eventName: string, limit: number): Promise<LedgerRowSummary[]> {
    return db.adConversionDelivery.findMany({
      where: {
        platform, eventName, attempts: { lt: MAX_ATTEMPTS },
        // "pending" rows only become sendable through the payment paths themselves.
        OR: [{ status: 'failed' }, { status: 'sending', leaseUntil: { lt: new Date() } }],
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { id: true, orderId: true, status: true, attempts: true, createdAt: true, updatedAt: true, eventTime: true, lastError: true },
    });
  }

  /** Order ids whose delivery failed or whose lease expired (for the retry cron). */
  async function retryable(platform: string, eventName: string, limit: number): Promise<string[]> {
    return (await retryableRows(platform, eventName, limit)).map((r: any) => r.orderId);
  }

  /**
   * Rows that used up MAX_ATTEMPTS and can never be claimed again: failed ones,
   * and "sending" ones whose lease expired because the process died mid-send.
   */
  async function exhaustedRows(platform: string, eventName: string, limit: number): Promise<LedgerRowSummary[]> {
    return db.adConversionDelivery.findMany({
      where: {
        platform, eventName, attempts: { gte: MAX_ATTEMPTS },
        OR: [{ status: 'failed' }, { status: 'sending', leaseUntil: { lt: new Date() } }],
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { id: true, orderId: true, status: true, attempts: true, createdAt: true, updatedAt: true, eventTime: true, lastError: true },
    });
  }

  /** Close a row that can never be sent (status → skipped, lastError kept). Never throws; true when it was closed. */
  async function closeRow(id: string, lastError: string): Promise<boolean> {
    try {
      const res = await db.adConversionDelivery.updateMany({
        where: { id, status: { in: ['failed', 'sending'] } },
        data: { status: 'skipped', leaseUntil: null, lastError: lastError.slice(0, 500) },
      });
      return (res?.count || 0) > 0;
    } catch (err: any) {
      console.warn(`${logTag} could not close row ${id}:`, isMissingTable(err) ? 'ledger table missing' : err?.message);
      return false;
    }
  }

  /** Ledger rows of the given orders (looked up through the unique index, in chunks). */
  async function rowsForOrders(platform: string, eventName: string, orderIds: string[]): Promise<Map<string, LedgerRowSummary>> {
    const out = new Map<string, LedgerRowSummary>();
    for (let i = 0; i < orderIds.length; i += 1000) {
      const rows: LedgerRowSummary[] = await db.adConversionDelivery.findMany({
        where: { platform, eventName, orderId: { in: orderIds.slice(i, i + 1000) } },
        select: { id: true, orderId: true, status: true, attempts: true, createdAt: true, updatedAt: true, lastError: true },
      });
      for (const r of rows) out.set(r.orderId, r);
    }
    return out;
  }

  /** When the first row of this platform was written (rows are never deleted), or null. */
  async function firstRowCreatedAt(platform: string, eventName: string): Promise<Date | null> {
    const first = await db.adConversionDelivery.findFirst({
      where: { platform, eventName },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return first?.createdAt ? new Date(first.createdAt) : null;
  }

  /**
   * Record that the recovery job looked at an order and could not send it yet
   * (capture not verified, order not reportable …). Touching the row moves it to
   * the back of the recovery queue, so orders that can never be sent cannot keep
   * newer ones waiting. The row stays "pending": the live payment paths can still
   * deliver it. Never throws.
   */
  async function noteRecoveryCheck(platform: string, eventName: string, orderId: string, rowId: string | undefined, note: string): Promise<void> {
    const lastError = note.slice(0, 500);
    try {
      if (rowId) {
        await db.adConversionDelivery.updateMany({ where: { id: rowId, status: 'pending' }, data: { lastError } });
        return;
      }
      await db.adConversionDelivery.create({
        data: { platform, eventName, orderId, eventId: orderId, lastError },
      }).catch((e: any) => { if (e?.code !== 'P2002') throw e; });
    } catch (err: any) {
      console.warn(`${logTag} could not note recovery check:`, isMissingTable(err) ? 'ledger table missing' : err?.message);
    }
  }

  /** Pending rows past Snap's window can never be sent: mark them so they stop being scanned. */
  async function expireStalePending(platform: string, eventName: string): Promise<number> {
    const res = await db.adConversionDelivery.updateMany({
      where: { platform, eventName, status: 'pending', createdAt: { lt: new Date(Date.now() - PENDING_MAX_AGE_MS) } },
      data: { status: 'skipped', lastError: 'expired: no confirmed payment within Snap 7-day window' },
    });
    return res?.count || 0;
  }

  return { recordContext, deliver, retryable, retryableRows, exhaustedRows, closeRow, rowsForOrders, firstRowCreatedAt, noteRecoveryCheck, expireStalePending };
}
