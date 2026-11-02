/**
 * Razorpay SDK handle shared by the reconciliation paths (sync service,
 * recovery service, reconcile job).
 *
 * The services used to each build their own `new Razorpay(creds)`; letting a
 * caller pass one in means the payment-driven job hands the same client down to
 * the existing marking functions, and the regression scripts can run those real
 * functions against a fake client without ever reaching api.razorpay.com.
 */
import Razorpay from 'razorpay';
import { resolveRazorpayCredentials } from '@/lib/razorpay-credentials';

/** The subset of the SDK the reconciliation code uses. */
export type RazorpayClientLike = {
  orders: {
    fetch(orderId: string): Promise<any>;
    fetchPayments(orderId: string): Promise<any>;
  };
  payments: {
    fetch(paymentId: string): Promise<any>;
    all(params: { from?: number; to?: number; count?: number; skip?: number }): Promise<any>;
  };
};

/** Null when Razorpay keys are not configured (callers skip their Razorpay work). */
export async function createRazorpayClient(): Promise<RazorpayClientLike | null> {
  const creds = await resolveRazorpayCredentials().catch(() => null);
  if (!creds) return null;
  return new Razorpay({ key_id: creds.key_id, key_secret: creds.key_secret }) as unknown as RazorpayClientLike;
}
