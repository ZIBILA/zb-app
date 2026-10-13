/**
 * Recovery scan shared by the website (lib/snap/purchase.ts) and native-app
 * (lib/snap/app-purchase.ts) Snap PURCHASE retry jobs: find PAID orders whose
 * Purchase no live path has delivered.
 *
 * Why it starts from orders, not from the ledger: every checkout attempt leaves
 * a "pending" ledger row and most of them are abandoned. The previous job took
 * the 25 OLDEST pending rows on every run, so it only ever looked at abandoned
 * checkouts and a paid order still waiting behind them was never reached. Paid
 * orders are few and are read through the [paymentStatus, createdAt] index;
 * their ledger rows come from the unique (platform, eventName, orderId) index.
 *
 * No database import: the Prisma client (or a fake in tests) is injected.
 */
import { MAX_ATTEMPTS, type LedgerRowSummary } from '@/lib/snap/ledger';

/** Snap accepts events up to 7 days old; anything older is never scanned. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Live paths (checkout, webhooks) get this long before the job steps in. */
export const RECOVERY_PENDING_MIN_AGE_MS = 15 * 60_000;
export const RECOVERY_MISSING_MIN_AGE_MS = 20 * 60_000;
/** Upper bound of one scan (ids only). A store beyond this is reported, not silently cut. */
const SCAN_LIMIT = 5000;

export interface RecoveryCandidate {
  orderId: string;
  /** Ledger row id when the order has a (pending) row; undefined when it has none at all. */
  rowId?: string;
  kind: 'pending' | 'missing';
  /** When the job last looked at it (row.updatedAt), or the order's creation for a first look. */
  lastTouchedMs: number;
}

export interface RecoveryLedger {
  rowsForOrders(platform: string, eventName: string, orderIds: string[]): Promise<Map<string, LedgerRowSummary>>;
  firstRowCreatedAt(platform: string, eventName: string): Promise<Date | null>;
}

export interface RecoveryScanOptions {
  platform: string;
  eventName: string;
  paidStatuses: string[];
  /** Which order types this platform reports (upper-cased order type). */
  acceptsOrderType: (orderType: string) => boolean;
  /**
   * Paid orders with NO ledger row are candidates only when this returns true.
   * They are also limited to orders placed after the platform's first ledger
   * row ("cutover"): older ones were handled by the pre-ledger code and left no
   * row, so re-sending them could count a sale twice.
   */
  acceptsMissingRow?: (orderType: string) => boolean;
  /** Per-process memo of the cutover lookup (it never changes once set). */
  cutoverMemo?: { value?: number | null };
  now?: number;
}

/**
 * Candidates, least recently looked-at first. `truncated` is true when the store
 * had more paid orders in the window than one scan reads.
 */
export async function findRecoveryCandidates(
  db: any,
  ledger: RecoveryLedger,
  opts: RecoveryScanOptions,
): Promise<{ candidates: RecoveryCandidate[]; truncated: boolean }> {
  const now = opts.now ?? Date.now();
  const orders: Array<{ id: string; orderType?: string | null; createdAt: Date }> = await db.order.findMany({
    where: {
      paymentStatus: { in: opts.paidStatuses },
      createdAt: { gt: new Date(now - WINDOW_MS) },
    },
    orderBy: { createdAt: 'asc' }, // oldest first: closest to Snap's 7-day limit
    take: SCAN_LIMIT,
    select: { id: true, orderType: true, createdAt: true },
  });
  const typeOf = (o: { orderType?: string | null }) => String(o.orderType || '').trim().toUpperCase();
  const eligible = orders.filter(o => opts.acceptsOrderType(typeOf(o)));
  if (!eligible.length) return { candidates: [], truncated: orders.length >= SCAN_LIMIT };

  const rows = await ledger.rowsForOrders(opts.platform, opts.eventName, eligible.map(o => o.id));
  const candidates: RecoveryCandidate[] = [];
  const missing: Array<{ id: string; createdMs: number }> = [];
  for (const o of eligible) {
    const row = rows.get(o.id);
    const createdMs = new Date(o.createdAt).getTime();
    if (row) {
      // sent / failed / sending / skipped rows belong to the delivery + retry steps.
      if (row.status !== 'pending' || row.attempts >= MAX_ATTEMPTS) continue;
      if (now - new Date(row.createdAt).getTime() < RECOVERY_PENDING_MIN_AGE_MS) continue;
      candidates.push({ orderId: o.id, rowId: row.id, kind: 'pending', lastTouchedMs: new Date(row.updatedAt).getTime() });
    } else if (opts.acceptsMissingRow?.(typeOf(o)) && now - createdMs >= RECOVERY_MISSING_MIN_AGE_MS) {
      missing.push({ id: o.id, createdMs });
    }
  }

  if (missing.length) {
    let cutover = opts.cutoverMemo?.value ?? null;
    if (cutover === null) {
      const first = await ledger.firstRowCreatedAt(opts.platform, opts.eventName);
      cutover = first ? first.getTime() : null;
      if (opts.cutoverMemo && cutover !== null) opts.cutoverMemo.value = cutover; // only a found date is final
    }
    // No row was ever written for this platform → this code has missed nothing yet.
    if (cutover !== null) {
      for (const m of missing) {
        if (m.createdMs > cutover) candidates.push({ orderId: m.id, kind: 'missing', lastTouchedMs: m.createdMs });
      }
    }
  }

  candidates.sort((a, b) => a.lastTouchedMs - b.lastTouchedMs);
  return { candidates, truncated: orders.length >= SCAN_LIMIT };
}
