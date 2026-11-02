/**
 * In-process job runner for the money-critical reconcilers.
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
 * Disable with DISABLE_INTERNAL_JOBS=true. Started from instrumentation.ts (production only).
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

const JOBS: Job[] = [
  { name: 'payment-reconcile', everyMs: 2 * 60_000, firstRunMs: 45_000, run: paymentReconcile },
  { name: 'razorpay-payment-scan', everyMs: 5 * 60_000, firstRunMs: 75_000, run: razorpayPaymentScan },
  { name: 'webstore-payment-sync', everyMs: 10 * 60_000, firstRunMs: 120_000, run: webStorePaymentSync },
  { name: 'shopify-sync-retry', everyMs: 5 * 60_000, firstRunMs: 90_000, run: shopifySyncRetry },
];

const g = globalThis as unknown as { __zbJobsStarted?: boolean };

export function startBackgroundJobs() {
  if (g.__zbJobsStarted) return;
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.DISABLE_INTERNAL_JOBS === 'true') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  g.__zbJobsStarted = true;

  for (const job of JOBS) {
    let running = false;
    const tick = async () => {
      if (running) return; // never overlap a slow run
      running = true;
      const t0 = Date.now();
      try {
        await job.run();
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
  console.log(`[jobs] background jobs started: ${JOBS.map((j) => `${j.name}/${Math.round(j.everyMs / 60000)}m`).join(', ')}`);
}
