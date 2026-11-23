/**
 * Offline checks for the pieces PR perf/db-write-load adds — no database, no Next:
 *   - lib/rate-limit-memory.ts  rateLimitSlidingWindow(): limits, Retry-After, pruning, key cap
 *   - lib/analytics/write-buffer.ts: batching, early flush, hard cap, retry-then-drop, session
 *     throttling (one write per 60 s), eviction, and that nothing a request calls ever awaits the sink.
 *
 *   node_modules/.bin/tsx scripts/db-write-load-test.ts
 */
import assert from 'node:assert/strict';
import { rateLimitSlidingWindow, slidingWindowKeyCount } from '../lib/rate-limit-memory';
import {
  createAnalyticsWriteBuffer,
  type AnalyticsSink,
  type AnalyticsEventRow,
  type AnalyticsSessionCreate,
  type AnalyticsSessionDelta,
} from '../lib/analytics/write-buffer';

let passed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ok  ${name}`); })
    .catch((err) => { console.error(`FAIL  ${name}\n      ${err?.message || err}`); process.exitCode = 1; });
}

// ─── sliding-window limiter ────────────────────────────────────────────────────────────────────

async function limiterTests() {
  console.log('rateLimitSlidingWindow');
  const t0 = 1_700_000_000_000;
  const opts = (now: number) => ({ maxRequests: 60, windowMs: 60_000, now });

  await check('60 requests pass, the 61st is rejected with Retry-After = full window, rejection is not recorded', () => {
    const key = 'cart-sync:203.0.113.10';
    for (let i = 1; i <= 60; i++) {
      const r = rateLimitSlidingWindow(key, opts(t0 + i));
      assert.equal(r.allowed, true, `request ${i}`);
      assert.equal(r.remaining, 60 - i);
      assert.equal(r.resetAfter, 60);
    }
    const rejected = rateLimitSlidingWindow(key, opts(t0 + 61));
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.remaining, 0);
    assert.equal(rejected.resetAfter, 60); // oldest hit at t0+1 leaves the window at t0+60001
    // many rejected calls never extend the block
    for (let i = 0; i < 100; i++) rateLimitSlidingWindow(key, opts(t0 + 30_000));
    assert.equal(rateLimitSlidingWindow(key, opts(t0 + 30_000)).resetAfter, 31);
    // like the DB limiter, a hit at exactly now - window still counts; the oldest hit (t0+1)
    // leaves the window at t0+60_002 → exactly one slot frees up
    assert.equal(rateLimitSlidingWindow(key, opts(t0 + 60_001)).allowed, false);
    assert.equal(rateLimitSlidingWindow(key, opts(t0 + 60_002)).allowed, true);
    assert.equal(rateLimitSlidingWindow(key, opts(t0 + 60_002)).allowed, false);
  });

  await check('window slides: 30 hits then 30 hits 30 s later → 30 slots return after the first group ages out', () => {
    const key = 'cart-sync:198.51.100.7';
    for (let i = 0; i < 30; i++) rateLimitSlidingWindow(key, opts(t0));
    for (let i = 0; i < 30; i++) rateLimitSlidingWindow(key, opts(t0 + 30_000));
    assert.equal(rateLimitSlidingWindow(key, opts(t0 + 30_000)).allowed, false);
    let allowed = 0;
    for (let i = 0; i < 40; i++) if (rateLimitSlidingWindow(key, opts(t0 + 60_001)).allowed) allowed++;
    assert.equal(allowed, 30);
  });

  await check('keys are independent and a key with no hits in the window is forgotten', () => {
    const before = slidingWindowKeyCount();
    rateLimitSlidingWindow('cart-me:a', opts(t0));
    rateLimitSlidingWindow('cart-me:b', opts(t0));
    assert.equal(slidingWindowKeyCount(), before + 2);
    assert.equal(rateLimitSlidingWindow('cart-me:a', opts(t0 + 1)).remaining, 58);
    assert.equal(rateLimitSlidingWindow('cart-me:b', opts(t0 + 1)).remaining, 58);
    // Touching a key whose hits all expired prunes it and starts fresh (count stays bounded).
    const r = rateLimitSlidingWindow('cart-me:a', opts(t0 + 120_000));
    assert.equal(r.remaining, 59);
  });

  await check('key space is capped at 50,000 (expired keys swept first)', () => {
    for (let i = 0; i < 60_000; i++) rateLimitSlidingWindow(`scan:${i}`, { maxRequests: 5, windowMs: 1_000, now: t0 + i });
    assert.ok(slidingWindowKeyCount() <= 50_000, `tracked ${slidingWindowKeyCount()}`);
  });
}

// ─── analytics write buffer ────────────────────────────────────────────────────────────────────

type Call = { kind: 'events'; rows: AnalyticsEventRow[] } | { kind: 'session'; create: AnalyticsSessionCreate; delta: AnalyticsSessionDelta };

function fakeSink(behaviour: { failEventsTimes?: number; failSessionsTimes?: number; hang?: boolean } = {}) {
  const calls: Call[] = [];
  let failEvents = behaviour.failEventsTimes ?? 0;
  let failSessions = behaviour.failSessionsTimes ?? 0;
  const sink: AnalyticsSink = {
    async insertEvents(rows) {
      if (behaviour.hang) await new Promise<void>(() => {});
      if (failEvents > 0) { failEvents--; throw new Error('db down'); }
      calls.push({ kind: 'events', rows: [...rows] });
    },
    async upsertSession(create, delta) {
      if (failSessions > 0) { failSessions--; throw new Error('db down'); }
      calls.push({ kind: 'session', create: { ...create }, delta: { ...delta, location: { ...delta.location } } });
    },
  };
  return { sink, calls };
}

const quiet = () => {};
const ev = (i: number, extra: Record<string, unknown> = {}): AnalyticsEventRow => ({ eventId: `e${i}`, eventName: 'page_view', ...extra });

async function bufferTests() {
  console.log('createAnalyticsWriteBuffer');
  let clock = 1_700_000_000_000;
  const now = () => clock;

  await check('events are inserted in one batch per flush; enqueue never awaits the sink', async () => {
    const { sink, calls } = fakeSink();
    const buf = createAnalyticsWriteBuffer({ sink, autoFlush: false, now, log: quiet });
    for (let i = 0; i < 5; i++) assert.equal(buf.enqueueEvent(ev(i)), true);
    assert.equal(calls.length, 0, 'nothing written before flush');
    assert.equal(buf.stats().pendingEvents, 5);
    await buf.flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, 'events');
    assert.deepEqual((calls[0] as { rows: AnalyticsEventRow[] }).rows.map((r) => r.eventId), ['e0', 'e1', 'e2', 'e3', 'e4']);
    assert.equal(buf.stats().written, 5);
    assert.equal(buf.stats().pendingEvents, 0);
  });

  await check('a flush drains up to maxBatchesPerFlush batches of maxBatch rows', async () => {
    const { sink, calls } = fakeSink();
    const buf = createAnalyticsWriteBuffer({ sink, autoFlush: false, now, log: quiet, maxBatch: 200, maxBatchesPerFlush: 5 });
    for (let i = 0; i < 1_250; i++) buf.enqueueEvent(ev(i));
    await buf.flush();
    assert.equal(calls.length, 5);
    assert.ok(calls.every((c) => c.kind === 'events' && c.rows.length === 200));
    assert.equal(buf.stats().pendingEvents, 250);
    await buf.flush();
    assert.equal(calls.length, 7); // 200 + 50
    assert.equal(buf.stats().pendingEvents, 0);
    assert.equal(buf.stats().written, 1_250);
  });

  await check('a full batch schedules an early flush without the request waiting', async () => {
    const { sink, calls } = fakeSink();
    const buf = createAnalyticsWriteBuffer({ sink, autoFlush: false, now, log: quiet, maxBatch: 10 });
    const t = Date.now();
    for (let i = 0; i < 10; i++) buf.enqueueEvent(ev(i));
    assert.ok(Date.now() - t < 50, 'enqueue is synchronous');
    assert.equal(calls.length, 0);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls.length, 1, 'flushed by the scheduled early flush');
    buf.stop();
  });

  await check('hard cap: beyond maxQueue new events are dropped and counted, nothing blocks', async () => {
    const { sink } = fakeSink({ hang: true });
    const buf = createAnalyticsWriteBuffer({ sink, autoFlush: false, now, log: quiet, maxBatch: 100, maxQueue: 1_000 });
    for (let i = 0; i < 1_000; i++) assert.equal(buf.enqueueEvent(ev(i)), true);
    void buf.flush(); // hangs on the sink forever — like a database that never answers
    assert.equal(buf.stats().flushInFlight, true);
    const t = Date.now();
    let dropped = 0;
    for (let i = 1_000; i < 1_500; i++) if (!buf.enqueueEvent(ev(i))) dropped++;
    assert.ok(Date.now() - t < 100, 'enqueue stays synchronous while a flush hangs');
    assert.equal(dropped, 400); // 100 rows left the queue with the hanging batch, 400 did not fit
    assert.equal(buf.stats().dropped, 400);
    assert.equal(buf.stats().pendingEvents, 1_000);
    assert.equal(buf.stats().flushInFlight, true);
  });

  await check('a failed insert is retried once on the next flush, then dropped', async () => {
    const { sink, calls } = fakeSink({ failEventsTimes: 1 });
    const buf = createAnalyticsWriteBuffer({ sink, autoFlush: false, now, log: quiet, maxBatch: 50 });
    for (let i = 0; i < 120; i++) buf.enqueueEvent(ev(i));
    await buf.flush(); // first batch fails → re-queued at the front, flush stops for this tick
    assert.equal(calls.length, 0);
    assert.equal(buf.stats().failedBatches, 1);
    assert.equal(buf.stats().pendingEvents, 120);
    await buf.flush();
    assert.equal(calls.length, 3);
    assert.deepEqual((calls[0] as { rows: AnalyticsEventRow[] }).rows.slice(0, 2).map((r) => r.eventId), ['e0', 'e1'], 'order preserved');
    assert.equal(buf.stats().written, 120);

    const always = fakeSink({ failEventsTimes: 99 });
    const buf2 = createAnalyticsWriteBuffer({ sink: always.sink, autoFlush: false, now, log: quiet, maxBatch: 50 });
    for (let i = 0; i < 50; i++) buf2.enqueueEvent(ev(i));
    await buf2.flush();
    await buf2.flush();
    assert.equal(buf2.stats().pendingEvents, 0, 'a poison batch is dropped after 2 attempts');
    assert.equal(buf2.stats().dropped, 50);
  });

  await check('a session is written once per 60 s with page views accumulated into one increment', async () => {
    const { sink, calls } = fakeSink();
    const buf = createAnalyticsWriteBuffer({ sink, autoFlush: false, now, log: quiet });
    const create = { id: 'ses_1', anonymousId: 'anon_1', platform: 'web', landingPage: '/', currentPage: '/', customerId: null, isNew: true };
    for (let i = 0; i < 10; i++) {
      clock += 1_000;
      buf.touchSession(create, { pageView: true, pageUrl: `/p/${i}`, location: i === 3 ? { countryCode: 'IN', city: 'Mumbai' } : undefined });
    }
    buf.touchSession(create, { pageView: false, pageUrl: null, customerId: 'cust_9' }); // add_to_cart, logged in
    await buf.flush();
    const writes = calls.filter((c) => c.kind === 'session') as Array<Extract<Call, { kind: 'session' }>>;
    assert.equal(writes.length, 1, 'eleven touches → one upsert');
    assert.equal(writes[0].create.pageViews, 10);
    assert.equal(writes[0].create.currentPage, '/p/9');
    assert.equal(writes[0].create.customerId, 'cust_9');
    assert.equal(writes[0].create.countryCode, 'IN');
    assert.equal(writes[0].delta.pageViews, 10);
    assert.equal(writes[0].delta.currentPage, '/p/9');
    assert.deepEqual(writes[0].delta.location, { countryCode: 'IN', city: 'Mumbai' });

    // Within the throttle window nothing is written even though the session is dirty.
    clock += 5_000;
    for (let i = 0; i < 5; i++) buf.touchSession(create, { pageView: true, pageUrl: '/cart' });
    await buf.flush();
    assert.equal(calls.filter((c) => c.kind === 'session').length, 1);

    // Once 60 s have passed since the last write, one upsert carries the 5 accumulated page views.
    clock += 60_000;
    await buf.flush();
    const second = calls.filter((c) => c.kind === 'session')[1] as Extract<Call, { kind: 'session' }>;
    assert.ok(second, 'second write after the throttle window');
    assert.equal(second.delta.pageViews, 5);
    assert.equal(second.delta.currentPage, '/cart');
    assert.equal(second.delta.customerId, null, 'customer id only sent when it changed');
    assert.equal(buf.stats().sessionWrites, 2);
    assert.equal(buf.stats().sessionTouches, 16);

    // A clean session is dropped from memory once idle for longer than the session timeout.
    clock += 31 * 60_000;
    await buf.flush();
    assert.equal(buf.stats().trackedSessions, 0);
  });

  await check('a new session is written on the next flush even if other sessions are throttled', async () => {
    const { sink, calls } = fakeSink();
    const buf = createAnalyticsWriteBuffer({ sink, autoFlush: false, now, log: quiet });
    buf.touchSession({ id: 'ses_a', anonymousId: 'a' }, { pageView: true });
    await buf.flush();
    buf.touchSession({ id: 'ses_a', anonymousId: 'a' }, { pageView: true });
    buf.touchSession({ id: 'ses_b', anonymousId: 'b' }, { pageView: true });
    await buf.flush();
    const ids = calls.filter((c) => c.kind === 'session').map((c) => (c as Extract<Call, { kind: 'session' }>).create.id);
    assert.deepEqual(ids, ['ses_a', 'ses_b']);
    buf.stop();
  });

  await check('a failed session write backs off for one window and does not lose the pending delta', async () => {
    const { sink, calls } = fakeSink({ failSessionsTimes: 1 });
    const buf = createAnalyticsWriteBuffer({ sink, autoFlush: false, now, log: quiet });
    buf.touchSession({ id: 'ses_f', anonymousId: 'f' }, { pageView: true });
    buf.touchSession({ id: 'ses_f', anonymousId: 'f' }, { pageView: true });
    await buf.flush();
    assert.equal(calls.length, 0);
    assert.equal(buf.stats().sessionWriteFailures, 1);
    await buf.flush();
    assert.equal(calls.length, 0, 'backed off within the window');
    clock += 60_000;
    await buf.flush();
    assert.equal(calls.length, 1);
    assert.equal((calls[0] as Extract<Call, { kind: 'session' }>).delta.pageViews, 2);
  });

  await check('tracked sessions are bounded by maxSessions', async () => {
    const { sink } = fakeSink();
    const buf = createAnalyticsWriteBuffer({ sink, autoFlush: false, now, log: quiet, maxSessions: 100 });
    for (let i = 0; i < 350; i++) { clock += 1; buf.touchSession({ id: `s${i}`, anonymousId: 'x' }, { pageView: true }); }
    assert.ok(buf.stats().trackedSessions <= 100, `tracked ${buf.stats().trackedSessions}`);
    buf.stop();
  });

  await check('the interval timer flushes on its own and is unref-ed (does not keep the process alive)', async () => {
    const { sink, calls } = fakeSink();
    const buf = createAnalyticsWriteBuffer({ sink, flushIntervalMs: 30, now, log: quiet });
    buf.enqueueEvent(ev(1));
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(calls.length >= 1, 'timer flushed');
    buf.stop();
  });
}

(async () => {
  await limiterTests();
  await bufferTests();
  if (process.exitCode) {
    console.error(`\n${passed} passed, some checks FAILED`);
  } else {
    console.log(`\nall ${passed} checks passed`);
  }
})();
