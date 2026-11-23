import prisma from '@/lib/db';
import {
  createAnalyticsWriteBuffer,
  type AnalyticsSink,
  type AnalyticsWriteBuffer,
  type AnalyticsEventRow,
  type AnalyticsSessionCreate,
  type AnalyticsSessionDelta,
} from './write-buffer';

/**
 * The process-wide analytics writer (see write-buffer.ts). One instance per server process, kept on
 * globalThis so Next's dev-mode module reloads do not start a second timer.
 */
const prismaSink: AnalyticsSink = {
  async insertEvents(rows: AnalyticsEventRow[]) {
    // One INSERT ... ON CONFLICT DO NOTHING for the whole batch; duplicate eventIds are skipped silently.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.analyticsEvent.createMany({ data: rows as any, skipDuplicates: true });
  },
  async upsertSession(create: AnalyticsSessionCreate, delta: AnalyticsSessionDelta) {
    try {
      await prisma.analyticsSession.upsert({
        where: { id: create.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: create as any,
        update: {
          lastActiveAt: delta.lastActiveAt,
          currentPage: delta.currentPage ?? undefined,
          pageViews: delta.pageViews > 0 ? { increment: delta.pageViews } : undefined,
          customerId: delta.customerId ?? undefined,
          ...delta.location,
        },
      });
    } catch (err) {
      // Two instances creating the same session at once: the row exists, nothing to do.
      if ((err as { code?: string })?.code !== 'P2002') throw err;
    }
  },
};

declare const globalThis: { __zb_analytics_writer?: AnalyticsWriteBuffer } & typeof global;

export const analyticsWriter: AnalyticsWriteBuffer =
  globalThis.__zb_analytics_writer ?? (globalThis.__zb_analytics_writer = createAnalyticsWriteBuffer({ sink: prismaSink }));
