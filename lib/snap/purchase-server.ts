/**
 * Production binding of the Snap PURCHASE delivery (Prisma + live Snap CAPI).
 * See lib/snap/purchase.ts for the logic.
 */
import prisma from '@/lib/db';
import { sendSnapEvent } from '@/lib/snap-capi';
import { createSnapPurchaseDelivery } from '@/lib/snap/purchase';
import { resolveRazorpayCredentials } from '@/lib/razorpay-credentials';
import { fetchCapturedPayment } from '@/lib/razorpay-payment';

export { snapContextFromRequest } from '@/lib/snap/purchase';
export type { SnapClickContext } from '@/lib/snap/purchase';

/**
 * Capture proof for recovering stranded pending rows: Razorpay must report the
 * payment captured with nothing refunded (fetchCapturedPayment throws otherwise).
 * 100% store-credit web orders have no gateway payment to check.
 */
async function verifyCapture(order: { paymentMethod?: string | null; razorpayPaymentId?: string | null }): Promise<boolean> {
  if (String(order.paymentMethod || '').toLowerCase() === 'store_credit') return true;
  if (!order.razorpayPaymentId) return false;
  try {
    const creds = await resolveRazorpayCredentials();
    await fetchCapturedPayment(order.razorpayPaymentId, { key_id: creds.key_id, key_secret: creds.key_secret });
    return true;
  } catch {
    return false;
  }
}

const delivery = createSnapPurchaseDelivery({ db: prisma, send: sendSnapEvent, verifyCapture });

export const emitSnapPurchase = delivery.emitSnapPurchase;
export const recordSnapPurchaseContext = delivery.recordSnapPurchaseContext;
export const retryPendingSnapPurchases = delivery.retryPendingSnapPurchases;
