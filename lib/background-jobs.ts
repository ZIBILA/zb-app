/**
 * In-process job runner for the money-critical reconcilers and the customer-messaging schedulers.
 *
 * These used to be triggered only by GitHub Actions schedules set to every 15 minutes. GitHub throttles scheduled
 * workflows, and over the last 72 h the 15-minute job actually ran about every 5 hours (longest
 * gap 7 h). A paid order the browser and the Razorpay webhook both missed therefore waited hours
 * to be confirmed, and failed Shopify syncs waited as long to be retried.
 *
 * The server is a long-running Node process, so it runs the same service functions itself on a
 * real timer. This is safe with several instances and with the GitHub / cron endpoints still
 * calling the same code: every write the jobs make is a compare-and-set on a still-pending
 * status, and the Shopify sync takes an atomic claim.
 *
 * Disable all with DISABLE_INTERNAL_JOBS=true, or only some with DISABLED_JOBS=whatsapp-scheduler,customer-events
 * (comma-separated job names; takes effect on the next restart). Started from instrumentation.ts (production only).
 */
type Job = {
  name: string;
  everyMs: number;
  firstRunMs: number;
  run: () => Promise<void>;
};

const SHOPIFY_ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const shopifyAlertedAt = new Map<string, number>();

async function alertAdmins(subject: string, html: string) {
  try {
    const { notifyAdminTeam } = await import('@/lib/services/zohoMailService');
    await notifyAdminTeam(subject, html);
  } catch (err: unknown) {
    console.warn('[jobs] admin alert failed:', err instanceof Error ? err.message : String(err));
  }
}

/** Orders still unconfirmed after a minute and a half: confirm them against Razorpay. */
async function paymentReconcile() {
  const { reconcilePendingMainOrders } = await import('@/lib/services/razorpaySyncService');
  const r = await reconcilePendingMainOrders({
    minAgeMs: 90_000,
    throttleOlderOrders: true,
    budgetMs: 90_000,
  });
  if (r.markedPaid.length > 0) {
    console.warn(`[jobs] payment-reconcile confirmed ${r.markedPaid.length} paid order(s) the browser/webhook had not: ${r.markedPaid.join(', ')}`);
  }
}

/**
 * Starts from Razorpay's captured payments (not from our pending rows): finds captures with no
 * local order, finishes verified /complete requests that failed to save, and emails the team when
 * the webhook looks dead (lib/services/razorpayReconcileService.ts; it throttles its own emails).
 */
async function razorpayPaymentScan() {
  const { reconcileRazorpayPayments } = await import('@/lib/services/razorpayReconcileService');
  const r = await reconcileRazorpayPayments();
  if (r.recovered + r.orphanRecovered + r.mismatched + r.unresolved > 0 || r.webhookDead) {
    console.warn(`[jobs] razorpay-payment-scan recovered=${r.recovered} orphan=${r.orphanRecovered} mismatch=${r.mismatched} unresolved=${r.unresolved}${r.webhookDead ? ' WEBHOOK-SILENT' : ''}`);
  }
}

async function webStorePaymentSync() {
  const { syncPendingWebStoreOrders } = await import('@/lib/services/razorpaySyncService');
  const r = await syncPendingWebStoreOrders();
  if (r.updatedCount > 0) console.warn(`[jobs] webstore-payment-sync updated ${r.updatedCount} order(s)`);
}

async function shopifySyncRetry() {
  const { retryFailedPaidShopifySyncs } = await import('@/lib/services/orderLifecycleService');
  const batch = await retryFailedPaidShopifySyncs(25);
  const failed = batch.results.filter((r) => !r.success && !r.skippedUnpaid && !(r as { skippedDuplicate?: boolean }).skippedDuplicate);
  if (batch.processed > 0) {
    console.log(`[jobs] shopify-sync-retry processed=${batch.processed} ok=${batch.results.filter((r) => r.success).length} failed=${failed.length}`);
  }
  if (failed.length === 0) return;

  // A paid order still missing from Shopify after an hour needs a human: tell the team once per order.
  const { default: prisma } = await import('@/lib/db');
  const stuck = await prisma.order.findMany({
    where: { id: { in: failed.map((f) => f.id) }, createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
    select: { id: true, internalOrderNumber: true, shopifySyncError: true },
  });
  const now = Date.now();
  const toAlert = stuck.filter((o: { id: string }) => now - (shopifyAlertedAt.get(o.id) || 0) > SHOPIFY_ALERT_COOLDOWN_MS);
  if (toAlert.length === 0) return;
  if (shopifyAlertedAt.size > 500) shopifyAlertedAt.clear();
  toAlert.forEach((o: { id: string }) => shopifyAlertedAt.set(o.id, now));
  await alertAdmins(
    `⚠️ ${toAlert.length} paid order(s) still not in Shopify`,
    `<div style="font-family:sans-serif;padding:20px;"><p>These paid orders have failed to sync to Shopify for over an hour and keep being retried:</p><ul>${toAlert
      .map((o: { internalOrderNumber: string | null; id: string; shopifySyncError: string | null }) => `<li><b>${o.internalOrderNumber || o.id}</b> — ${String(o.shopifySyncError || 'unknown error').slice(0, 300)}</li>`)
      .join('')}</ul></div>`
  );
}

/** Abandoned-cart sequence, campaign sends and the failed-message retry queue (lib/whatsapp/scheduler.ts). */
async function whatsappScheduler() {
  const { runWhatsAppScheduler } = await import('@/lib/whatsapp/scheduler');
  const r = await runWhatsAppScheduler();
  const sent = (r.results.abandonedCartStep1Sent || 0) + (r.results.abandonedCartStep2Sent || 0) + (r.results.abandonedCartStep3Sent || 0);
  if (sent > 0 || r.results.errors?.length) {
    console.log(`[jobs] whatsapp-scheduler cart-recovery sent=${sent} retried=${r.results.messagesRetried || 0} errors=${r.results.errors?.length || 0}`);
  }
}

/** Lifecycle emails + WhatsApp (cancelled, refund, out for delivery, delivered, store credit...). */
async function customerEvents() {
  const { runCustomerEventsCycle } = await import('@/lib/notifications/run-customer-events');
  const r = await runCustomerEventsCycle();
  const wa = r.whatsapp as { sent?: number; failed?: number; error?: string };
  if (r.sent > 0 || (wa.sent || 0) > 0 || (wa.failed || 0) > 0 || wa.error || r.cashbackIssued > 0) {
    console.log(`[jobs] customer-events email=${r.sent} whatsapp=${wa.sent || 0} whatsappFailed=${wa.failed || 0} cashback=${r.cashbackIssued}${wa.error ? ` error=${wa.error}` : ''}`);
  }
}

/** Shiprocket status for in-flight shipments: drives out-for-delivery / delivered everywhere. */
async function shipmentSync() {
  const { pollActiveShipments } = await import('@/lib/services/shipmentPollService');
  const r = await pollActiveShipments();
  if (r.updated > 0 || r.errors > 0) console.log(`[jobs] shipment-sync updated=${r.updated} errors=${r.errors} scanned=${r.scanned}`);
}

/** Failed / interrupted refunds of cancelled orders, with backoff (lib/services/refundService.ts). */
async function refundRetry() {
  const { retryFailedRefunds } = await import('@/lib/services/refundService');
  const r = await retryFailedRefunds();
  if (r.processed > 0) {
    console.log(`[jobs] refund-retry processed=${r.processed} ok=${r.results.filter((x) => x.success).length}`);
  }
}

/** Fulfillment + tracking, delivery, COD paid and cancellation pushed to Shopify (lib/services/shopifyLifecycleSync.ts). */
async function shopifyLifecycleSync() {
  const { syncRecentOrderLifecyclesToShopify } = await import('@/lib/services/shopifyLifecycleSync');
  const r = await syncRecentOrderLifecyclesToShopify();
  if (r.changed > 0 || r.failed > 0) {
    console.log(`[jobs] shopify-lifecycle-sync changed=${r.changed} failed=${r.failed} ${JSON.stringify(r.actions)}`);
  }
}

/**
 * Nightly retention for the tracking / log tables (lib/services/dataRetention.ts). Counts only
 * (dry run) until DATA_RETENTION_ENABLED=true; batched deletes under an advisory lock after that.
 */
async function dataRetention() {
  const { runDataRetention, formatRetentionSummary } = await import('@/lib/services/dataRetention');
  const r = await runDataRetention();
  console.log(`[jobs] data-retention ${formatRetentionSummary(r)}`);
}

/** Delay until the next HH:MM in IST (UTC+5:30), for the once-a-day jobs. */
function msUntilNextIst(hour: number, minute: number): number {
  const IST_OFFSET_MS = 5.5 * 60 * 60_000;
  const DAY_MS = 24 * 60 * 60_000;
  const nowIst = Date.now() + IST_OFFSET_MS;
  const todayIst = Math.floor(nowIst / DAY_MS) * DAY_MS;
  let target = todayIst + (hour * 60 + minute) * 60_000;
  if (target <= nowIst) target += DAY_MS;
  return target - nowIst;
}

/** Rejects if `work` has not settled in `ms`. The abandoned promise is left to finish on its own. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

const JOBS: Job[] = [
  { name: 'payment-reconcile', everyMs: 2 * 60_000, firstRunMs: 45_000, run: paymentReconcile },
  { name: 'razorpay-payment-scan', everyMs: 5 * 60_000, firstRunMs: 75_000, run: razorpayPaymentScan },
  { name: 'webstore-payment-sync', everyMs: 10 * 60_000, firstRunMs: 120_000, run: webStorePaymentSync },
  { name: 'shopify-sync-retry', everyMs: 5 * 60_000, firstRunMs: 90_000, run: shopifySyncRetry },
  // These three used to depend only on GitHub schedules (throttled to every few hours) or, for shipment sync,
  // on nothing at all, so abandoned-cart reminders, store-credit / delivery messages and carrier statuses lagged
  // by hours or never happened.
  { name: 'whatsapp-scheduler', everyMs: 5 * 60_000, firstRunMs: 100_000, run: whatsappScheduler },
  { name: 'customer-events', everyMs: 5 * 60_000, firstRunMs: 140_000, run: customerEvents },
  { name: 'shipment-sync', everyMs: 15 * 60_000, firstRunMs: 160_000, run: shipmentSync },
  { name: 'refund-retry', everyMs: 10 * 60_000, firstRunMs: 180_000, run: refundRetry },
  { name: 'shopify-lifecycle-sync', everyMs: 10 * 60_000, firstRunMs: 200_000, run: shopifyLifecycleSync },
  // Once a day at 03:30 IST (quietest hour). Several instances all fire then; the job's advisory lock lets one run.
  { name: 'data-retention', everyMs: 24 * 60 * 60_000, firstRunMs: msUntilNextIst(3, 30), run: dataRetention },
];

const g = globalThis as unknown as { __zbJobsStarted?: boolean };

export function startBackgroundJobs() {
  if (g.__zbJobsStarted) return;
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.DISABLE_INTERNAL_JOBS === 'true') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  g.__zbJobsStarted = true;

  const disabled = new Set((process.env.DISABLED_JOBS || '').split(',').map((s) => s.trim()).filter(Boolean));
  const active = JOBS.filter((j) => !disabled.has(j.name));
  if (disabled.size > 0) console.log(`[jobs] disabled by DISABLED_JOBS: ${JOBS.filter((j) => disabled.has(j.name)).map((j) => j.name).join(', ') || '(no matching job names)'}`);

  for (const job of active) {
    let running = false;
    const tick = async () => {
      if (running) return; // never overlap a slow run
      running = true;
      const t0 = Date.now();
      try {
        // A hung HTTP call must not leave `running` true forever (the job would silently stop).
        await withTimeout(job.run(), Math.max(job.everyMs * 2, 5 * 60_000));
      } catch (err: unknown) {
        console.error(`[jobs] ${job.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        running = false;
        const took = Date.now() - t0;
        if (took > job.everyMs) console.warn(`[jobs] ${job.name} took ${Math.round(took / 1000)}s (longer than its ${Math.round(job.everyMs / 1000)}s interval)`);
      }
    };
    setTimeout(() => {
      void tick();
      const timer = setInterval(() => void tick(), job.everyMs);
      timer.unref?.();
    }, job.firstRunMs).unref?.();
  }
  console.log(`[jobs] background jobs started: ${active.map((j) => `${j.name}/${Math.round(j.everyMs / 60000)}m`).join(', ')}`);
}
