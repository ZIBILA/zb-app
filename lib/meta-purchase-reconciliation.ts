import prisma from './db';
import { resolveRazorpayCredentials } from './razorpay-credentials';
import { fetchCapturedPayment } from './meta-payment-verification';
import { recordCapturedPurchase } from './meta-purchases';
import { snapshotMatchesOrder } from './meta-purchase-policy';

/** Worker-only GET verification repairs missed observations without changing payments. */
export async function reconcileGatewayPurchase(orderId: string, db: any = prisma,
  resolveCredentials = resolveRazorpayCredentials, fetchPayment = fetchCapturedPayment): Promise<boolean> {
  const row = await db.metaPurchase.findUnique({ where: { orderId } });
  if (!row || row.status !== 'awaiting_payment' || !row.razorpayOrderId) return false;
  if (!row.createdAt || Date.now() - new Date(row.createdAt).getTime() >= 47 * 3600000) return false;
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order?.razorpayPaymentId || order.razorpayOrderId !== row.razorpayOrderId || !snapshotMatchesOrder(row.snapshot, order)) return false;
  const credentials = await resolveCredentials();
  if (credentials.key_id.startsWith('rzp_live_') !== row.live) return false;
  const payment = await fetchPayment(order.razorpayPaymentId, credentials);
  // Prefer the existing server's payment timestamp; never mint a fresh event time
  // merely because a worker retries. recordCapturedPurchase retains the first proof.
  const capturedAt = new Date(order.paymentCapturedAt || Number(payment.created_at) * 1000);
  return (await recordCapturedPurchase(payment, capturedAt, db)) === orderId;
}
