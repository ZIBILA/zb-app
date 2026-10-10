/**
 * Order checks shared by the Meta and Snap server Purchase senders.
 * Isomorphic, no database import.
 */
import { snapCatalogIdFromOrderItem } from '@/lib/snap/catalog-id';

/**
 * Orders created by the Razorpay webhook recovery path when no order existed:
 * the items are an unknown placeholder and the amount is only what Razorpay
 * captured (for COD, just the upfront). Not a reportable sale until staff fill
 * in the real items — reporting it would send a wrong value with no products,
 * and the ledger would then refuse the corrected Purchase as "already sent".
 */
export function isUnresolvedRecoveryOrder(order: any): boolean {
  const tags = String(order?.tags || '').toLowerCase();
  if (!tags.includes('webhook-recovered')) return false;
  return !(order?.items || []).some((it: any) => snapCatalogIdFromOrderItem(it));
}
