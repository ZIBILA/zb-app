/**
 * Durable, idempotent delivery ledger for server-side Snap conversions.
 * Backed by the AdConversionDelivery table: one row per (platform, eventName, orderId).
 *
 *   pending ──claim──▶ sending (leased) ──Snap OK──▶ sent      (sentAt set only here)
 *                                     └──Snap error─▶ failed    (retryable, same event_id/time)
 *                                     └──too old────▶ skipped   (never re-dated)
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
  | { status: 'failed'; reason: string };

export type SendResult = { success: boolean; error?: any; skipped?: boolean };

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
      const claimed = await db.adConversionDelivery.updateMany({
        where: {
          id: row.id,
          attempts: { lt: MAX_ATTEMPTS },
          OR: [
            { status: { in: ['pending', 'failed'] } },
            { status: 'sending', leaseUntil: { lt: now } },
          ],
        },
        data: { status: 'sending', leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
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
      if (res.success) {
        await db.adConversionDelivery.update({
          where: key, data: { status: 'sent', sentAt: new Date(), leaseUntil: null, lastError: null },
        });
        return { status: 'sent' };
      }
      const reason = typeof res.error === 'string' ? res.error : JSON.stringify(res.error ?? 'unknown').slice(0, 500);
      await db.adConversionDelivery.update({
        where: key, data: { status: res.skipped ? 'skipped' : 'failed', leaseUntil: null, lastError: reason },
      });
      return res.skipped ? { status: 'skipped', reason } : { status: 'failed', reason };
    } catch (err: any) {
      console.error(`${logTag} delivery error:`, isMissingTable(err) ? 'ledger table missing — apply the migration' : err?.message);
      return { status: 'failed', reason: err?.message || 'error' };
    }
  }

  /** Order ids whose delivery failed or whose lease expired (for the retry cron). */
  async function retryable(platform: string, eventName: string, limit: number): Promise<string[]> {
    const rows = await db.adConversionDelivery.findMany({
      where: {
        platform, eventName, attempts: { lt: MAX_ATTEMPTS },
        // "pending" rows only become sendable through the payment paths themselves.
        OR: [{ status: 'failed' }, { status: 'sending', leaseUntil: { lt: new Date() } }],
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { orderId: true },
    });
    return rows.map((r: any) => r.orderId);
  }

  /**
   * PENDING rows whose order may have completed without any path sending it
   * (e.g. capture unconfirmed at checkout AND the captured webhook was missed).
   * Only rows older than `minAgeMs` (live paths get first go) and younger than
   * Snap's 7-day window are returned. The caller MUST verify payment before sending.
   */
  async function recoverablePending(platform: string, eventName: string, limit: number, minAgeMs = 15 * 60_000): Promise<string[]> {
    const now = Date.now();
    const rows = await db.adConversionDelivery.findMany({
      where: {
        platform, eventName, status: 'pending', attempts: { lt: MAX_ATTEMPTS },
        createdAt: { lt: new Date(now - minAgeMs), gt: new Date(now - PENDING_MAX_AGE_MS) },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { orderId: true },
    });
    return rows.map((r: any) => r.orderId);
  }

  /** Pending rows past Snap's window can never be sent: mark them so they stop being scanned. */
  async function expireStalePending(platform: string, eventName: string): Promise<number> {
    const res = await db.adConversionDelivery.updateMany({
      where: { platform, eventName, status: 'pending', createdAt: { lt: new Date(Date.now() - PENDING_MAX_AGE_MS) } },
      data: { status: 'skipped', lastError: 'expired: no confirmed payment within Snap 7-day window' },
    });
    return res?.count || 0;
  }

  return { recordContext, deliver, retryable, recoverablePending, expireStalePending };
}
