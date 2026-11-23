/**
 * Buffered, non-blocking writer for storefront analytics (analytics_events / analytics_sessions).
 *
 * Before this, /api/analytics/track ran one `analyticsSession.upsert` and one `analyticsEvent.upsert`
 * per event — two statements per page view, each a separate round trip, with no back-pressure. On a
 * saturated database (23 Nov 2026) those statements queued for 24–80 s each and held pool connections
 * the storefront needed.
 *
 * This module keeps everything in memory and writes in the background:
 *   - events are appended to a queue and inserted in batches (one `createMany` per up to `maxBatch`
 *     rows) every `flushIntervalMs`, or sooner when a batch is full;
 *   - sessions are written at most once per `sessionThrottleMs` per session (first sight is written on
 *     the next flush); page-view increments and the latest page / customer / location are accumulated
 *     in between and land in a single upsert;
 *   - the queue has a hard cap (`maxQueue`): when the database cannot keep up, new events are counted
 *     as dropped instead of growing memory or delaying requests;
 *   - only one flush is in flight at a time, so a slow database never multiplies connections.
 *
 * Nothing here is awaited by a request. The module has no database dependency: the `sink` performs the
 * actual writes (see analytics-writer.ts for the Prisma one), which keeps it testable offline.
 */

export type AnalyticsEventRow = { eventId: string; eventName: string } & Record<string, unknown>;

export type AnalyticsSessionCreate = { id: string; anonymousId: string } & Record<string, unknown>;

/** What changed since the session row was last written. */
export type AnalyticsSessionDelta = {
  /** page_view events seen since the last write */
  pageViews: number;
  lastActiveAt: Date;
  currentPage: string | null;
  customerId: string | null;
  /** countryCode / country / region / city / lat / lng when known */
  location: Record<string, unknown>;
};

export interface AnalyticsSink {
  /** Insert rows; duplicates on eventId must be ignored, never thrown. */
  insertEvents(rows: AnalyticsEventRow[]): Promise<void>;
  /** Create the session row if missing, otherwise apply the delta (pageViews is an increment). */
  upsertSession(create: AnalyticsSessionCreate, delta: AnalyticsSessionDelta): Promise<void>;
}

export interface AnalyticsBufferOptions {
  sink: AnalyticsSink;
  /** Background flush period. Default 3 s. */
  flushIntervalMs?: number;
  /** Rows per insert statement; a full batch triggers an early flush. Default 200. */
  maxBatch?: number;
  /** Insert statements one flush may run before yielding to the next tick. Default 5. */
  maxBatchesPerFlush?: number;
  /** Hard cap on queued rows; beyond it new events are dropped. Default 5,000. */
  maxQueue?: number;
  /** Minimum gap between two writes of the same session. Default 60 s. */
  sessionThrottleMs?: number;
  /** Session upserts one flush may run. Default 100. */
  maxSessionWritesPerFlush?: number;
  /** Sessions kept in memory; least recently seen are evicted first. Default 20,000. */
  maxSessions?: number;
  /** Forget a clean session not seen for this long. Default 30 min (the tracker's session timeout). */
  sessionIdleMs?: number;
  /** Start the interval timer. Default true; tests call flush() themselves. */
  autoFlush?: boolean;
  now?: () => number;
  log?: (message: string) => void;
}

export interface AnalyticsBufferStats {
  enqueued: number;
  written: number;
  dropped: number;
  failedBatches: number;
  sessionTouches: number;
  sessionWrites: number;
  sessionWriteFailures: number;
  flushes: number;
  pendingEvents: number;
  trackedSessions: number;
  flushInFlight: boolean;
}

type QueuedEvent = { row: AnalyticsEventRow; attempts: number };

type SessionState = {
  create: AnalyticsSessionCreate;
  pending: AnalyticsSessionDelta;
  dirty: boolean;
  /** 0 = never written from this process */
  lastWriteAt: number;
  lastSeenAt: number;
};

const MAX_ATTEMPTS = 2;

export function createAnalyticsWriteBuffer(options: AnalyticsBufferOptions) {
  const sink = options.sink;
  const flushIntervalMs = options.flushIntervalMs ?? 3_000;
  const maxBatch = options.maxBatch ?? 200;
  const maxBatchesPerFlush = options.maxBatchesPerFlush ?? 5;
  const maxQueue = options.maxQueue ?? 5_000;
  const sessionThrottleMs = options.sessionThrottleMs ?? 60_000;
  const maxSessionWritesPerFlush = options.maxSessionWritesPerFlush ?? 100;
  const maxSessions = options.maxSessions ?? 20_000;
  const sessionIdleMs = options.sessionIdleMs ?? 30 * 60_000;
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? ((message: string) => console.warn(message));

  const events: QueuedEvent[] = [];
  const sessions = new Map<string, SessionState>();
  const counters = {
    enqueued: 0,
    written: 0,
    dropped: 0,
    failedBatches: 0,
    sessionTouches: 0,
    sessionWrites: 0,
    sessionWriteFailures: 0,
    flushes: 0,
  };

  let inFlight: Promise<void> | null = null;
  let earlyFlush: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let lastDropLogAt = 0;

  function scheduleEarlyFlush() {
    if (earlyFlush || inFlight) return;
    earlyFlush = setTimeout(() => {
      earlyFlush = null;
      void flush();
    }, 0);
    if (typeof earlyFlush === 'object' && earlyFlush && 'unref' in earlyFlush) earlyFlush.unref();
  }

  function enqueueEvent(row: AnalyticsEventRow): boolean {
    counters.enqueued++;
    if (events.length >= maxQueue) {
      counters.dropped++;
      const t = now();
      if (t - lastDropLogAt > 60_000) {
        lastDropLogAt = t;
        log(`[Analytics] write queue full (${maxQueue}); dropping events (${counters.dropped} dropped so far)`);
      }
      return false;
    }
    events.push({ row, attempts: 0 });
    if (events.length >= maxBatch) scheduleEarlyFlush();
    return true;
  }

  function touchSession(
    create: AnalyticsSessionCreate,
    change: { pageView: boolean; pageUrl?: string | null; customerId?: string | null; location?: Record<string, unknown> },
  ): void {
    const t = now();
    let state = sessions.get(create.id);
    if (!state) {
      if (sessions.size >= maxSessions) evictSessions(t, true);
      state = {
        create,
        pending: { pageViews: 0, lastActiveAt: new Date(t), currentPage: null, customerId: null, location: {} },
        dirty: false,
        lastWriteAt: 0,
        lastSeenAt: t,
      };
      sessions.set(create.id, state);
    }
    state.lastSeenAt = t;
    state.dirty = true;
    state.pending.lastActiveAt = new Date(t);
    if (change.pageView) state.pending.pageViews += 1;
    if (change.pageUrl) state.pending.currentPage = change.pageUrl;
    if (change.customerId) state.pending.customerId = change.customerId;
    if (change.location) Object.assign(state.pending.location, change.location);
    counters.sessionTouches++;
    if (state.lastWriteAt === 0) scheduleEarlyFlush();
  }

  function evictSessions(t: number, force: boolean) {
    sessions.forEach((state, id) => {
      if (!state.dirty && t - state.lastSeenAt > sessionIdleMs) sessions.delete(id);
    });
    if (force && sessions.size >= maxSessions) {
      // Still full: drop the least recently seen sessions (Map keeps insertion order; re-sort by lastSeenAt).
      const byAge = Array.from(sessions.entries()).sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
      const excess = sessions.size - maxSessions + 1;
      for (let i = 0; i < excess && i < byAge.length; i++) sessions.delete(byAge[i][0]);
    }
  }

  async function flushEvents() {
    for (let n = 0; n < maxBatchesPerFlush && events.length > 0; n++) {
      const batch = events.splice(0, maxBatch);
      try {
        await sink.insertEvents(batch.map((q) => q.row));
        counters.written += batch.length;
      } catch (err) {
        counters.failedBatches++;
        const retry = batch.filter((q) => ++q.attempts < MAX_ATTEMPTS);
        const dropped = batch.length - retry.length;
        if (retry.length > 0 && events.length + retry.length <= maxQueue) {
          events.unshift(...retry);
        } else {
          counters.dropped += retry.length;
        }
        counters.dropped += dropped;
        log(`[Analytics] event batch insert failed (${batch.length} rows, ${retry.length} retained): ${(err as Error)?.message || err}`);
        return; // database is unhappy — leave the rest for the next tick
      }
    }
  }

  async function flushSessions() {
    const t = now();
    const due: SessionState[] = [];
    sessions.forEach((state) => {
      if (state.dirty && (state.lastWriteAt === 0 || t - state.lastWriteAt >= sessionThrottleMs)) due.push(state);
    });
    // Sessions never written come first so their row exists as soon as possible.
    due.sort((a, b) => a.lastWriteAt - b.lastWriteAt);
    for (const state of due.slice(0, maxSessionWritesPerFlush)) {
      const delta = state.pending;
      const create: AnalyticsSessionCreate = {
        ...state.create,
        pageViews: delta.pageViews,
        currentPage: delta.currentPage ?? state.create.currentPage ?? null,
        customerId: delta.customerId ?? state.create.customerId ?? null,
        ...delta.location,
      };
      try {
        await sink.upsertSession(create, delta);
        counters.sessionWrites++;
        state.pending = { pageViews: 0, lastActiveAt: delta.lastActiveAt, currentPage: null, customerId: null, location: {} };
        state.dirty = false;
        state.lastWriteAt = now();
      } catch (err) {
        counters.sessionWriteFailures++;
        // Back off this session for one throttle window and stop the pass; the next tick retries.
        state.lastWriteAt = now();
        log(`[Analytics] session upsert failed for ${state.create.id}: ${(err as Error)?.message || err}`);
        return;
      }
    }
    evictSessions(now(), false);
  }

  function flush(): Promise<void> {
    if (inFlight) return inFlight;
    counters.flushes++;
    inFlight = (async () => {
      try {
        await flushEvents();
        await flushSessions();
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function stats(): AnalyticsBufferStats {
    return { ...counters, pendingEvents: events.length, trackedSessions: sessions.size, flushInFlight: inFlight !== null };
  }

  function stop() {
    if (interval) clearInterval(interval);
    interval = null;
    if (earlyFlush) clearTimeout(earlyFlush);
    earlyFlush = null;
  }

  if (options.autoFlush !== false) {
    interval = setInterval(() => void flush(), flushIntervalMs);
    if (typeof interval === 'object' && interval && 'unref' in interval) interval.unref();
  }

  return { enqueueEvent, touchSession, flush, stats, stop };
}

export type AnalyticsWriteBuffer = ReturnType<typeof createAnalyticsWriteBuffer>;
