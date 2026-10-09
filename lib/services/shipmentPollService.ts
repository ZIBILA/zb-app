/**
 * Scheduled polling of Shiprocket for every in-flight shipment (forward + reverse).
 *
 * Used by /api/cron/sync-shipments so the dashboard, returns/exchanges and customer
 * tracking stay current without anyone pressing "Sync Status" and without webhooks.
 *
 * All updates flow through refreshShipmentFromCarrier → applyShipmentStatusUpdate, the same
 * path as the manual sync and webhook, so status monotonicity, RTO tagging, COD settlement and
 * reverse-request syncing behave identically.
 */
import prisma from '@/lib/db';
import { refreshShipmentFromCarrier } from '@/lib/services/shipmentStatusService';

export const REVERSE_SHIPMENT_TYPES = ['reverse_pickup', 'reverse', 'return', 'exchange_pickup'];

const FORWARD_TERMINAL = ['delivered', 'rto_delivered', 'cancelled', 'canceled', 'lost'];
const REVERSE_TERMINAL = ['delivered', 'cancelled', 'canceled', 'lost', 'rto_delivered'];
const ORDER_TERMINAL = ['delivered', 'cancelled', 'returned_to_origin', 'lost'];

export interface PollOptions {
  /** Max forward shipments per run. */
  forwardLimit?: number;
  /** Max reverse (return / exchange) shipments per run. */
  reverseLimit?: number;
  /** Parallel Shiprocket calls. Keep small to stay under rate limits. */
  concurrency?: number;
  /** Stop starting new calls after this many ms (leave headroom for the function timeout). */
  budgetMs?: number;
}

export interface PollSummary {
  scanned: number;
  forward: number;
  reverse: number;
  updated: number;
  unchanged: number;
  errors: number;
  timedOut: boolean;
  durationMs: number;
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  deadline: number,
  fn: (item: T) => Promise<void>
): Promise<boolean> {
  let next = 0;
  let timedOut = false;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      if (Date.now() > deadline) {
        timedOut = true;
        return;
      }
      const idx = next++;
      if (idx >= items.length) return;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return timedOut;
}

export async function pollActiveShipments(opts: PollOptions = {}): Promise<PollSummary> {
  const started = Date.now();
  const forwardLimit = opts.forwardLimit ?? 200;
  const reverseLimit = opts.reverseLimit ?? 100;
  const concurrency = opts.concurrency ?? 4;
  const deadline = started + (opts.budgetMs ?? 45_000);

  // Least-recently-updated first, so a backlog larger than the limit rotates fairly.
  const forward = await prisma.shipment.findMany({
    where: {
      NOT: { type: { in: REVERSE_SHIPMENT_TYPES } },
      status: { notIn: FORWARD_TERMINAL },
      // AWB-less drafts can't be tracked; cancellation-in-progress rows are checked at order level.
      OR: [{ awb: { not: null } }, { status: 'cancellation_requested' }],
      order: { deliveryStatus: { notIn: ORDER_TERMINAL } },
    },
    orderBy: { updatedAt: 'asc' },
    take: forwardLimit,
    select: { id: true },
  });

  const reverse = await prisma.shipment.findMany({
    where: {
      type: { in: REVERSE_SHIPMENT_TYPES },
      awb: { not: null },
      createdAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
      status: { notIn: REVERSE_TERMINAL },
    },
    orderBy: { updatedAt: 'asc' },
    take: reverseLimit,
    select: { id: true },
  });

  const summary: PollSummary = {
    scanned: 0,
    forward: forward.length,
    reverse: reverse.length,
    updated: 0,
    unchanged: 0,
    errors: 0,
    timedOut: false,
    durationMs: 0,
  };

  const refreshOne = async ({ id }: { id: string }) => {
    summary.scanned += 1;
    try {
      const { result } = await refreshShipmentFromCarrier(id);
      if (result?.applied) {
        summary.updated += 1;
      } else {
        summary.unchanged += 1;
        // Bump updatedAt so an unchanged shipment moves to the back of the queue.
        await prisma.shipment
          .update({ where: { id }, data: { updatedAt: new Date() } })
          .catch(() => undefined);
      }
    } catch (err) {
      summary.errors += 1;
      console.error(`[ShipmentPoll] refresh failed for shipment ${id}:`, err instanceof Error ? err.message : err);
    }
  };

  // Reverse shipments first: customers are waiting on returns/exchanges and the set is small.
  const reverseTimedOut = await runPool(reverse, concurrency, deadline, refreshOne);
  const forwardTimedOut = await runPool(forward, concurrency, deadline, refreshOne);

  summary.timedOut = reverseTimedOut || forwardTimedOut;
  summary.durationMs = Date.now() - started;
  return summary;
}
