import { reconcilePendingMainOrders } from '@/lib/services/razorpaySyncService';

/**
 * On-demand "is this paid?" check against Razorpay for orders a shopper is looking at.
 *
 * A UPI payment can succeed while the shopper's browser never reaches /api/checkout/complete
 * (the UPI app takes over the screen), and the webhook may be late or off. Rather than leave
 * the order as a hidden pending row until a scheduler gets to it, the places where the shopper
 * comes back (success page lookup, My Orders) call this, so the order confirms right then.
 *
 * Safe to call freely: it only changes an order when Razorpay reports a captured payment, every
 * write is compare-and-set against a still-pending status, and calls are throttled per key.
 */
const THROTTLE_MS = 8_000;
const recent = new Map<string, number>();

function throttled(key: string): boolean {
  const now = Date.now();
  if (recent.size > 2000) recent.clear();
  const last = recent.get(key) || 0;
  if (now - last < THROTTLE_MS) return true;
  recent.set(key, now);
  return false;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function confirmPaymentForRazorpayOrder(razorpayOrderId: string, timeoutMs = 8_000): Promise<void> {
  if (!razorpayOrderId || throttled(`rzp:${razorpayOrderId}`)) return;
  try {
    await withTimeout(reconcilePendingMainOrders({ razorpayOrderId, limit: 1 }), timeoutMs);
  } catch (err: unknown) {
    console.warn('[PaymentConfirmation] on-demand check failed:', err instanceof Error ? err.message : String(err));
  }
}

export async function confirmPaymentsForCustomers(customerIds: string[], timeoutMs = 6_000): Promise<void> {
  const ids = Array.from(new Set(customerIds.filter(Boolean))).sort();
  if (ids.length === 0 || throttled(`cust:${ids.join(',')}`)) return;
  try {
    await withTimeout(reconcilePendingMainOrders({ customerIds: ids, limit: 5 }), timeoutMs);
  } catch (err: unknown) {
    console.warn('[PaymentConfirmation] on-demand check failed:', err instanceof Error ? err.message : String(err));
  }
}
