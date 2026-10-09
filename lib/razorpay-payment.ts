/**
 * Read-only Razorpay payment lookups (capture amount checks, etc.).
 */

export type RazorpayPaymentEntity = {
  id: string;
  order_id?: string | null;
  status?: string | null;
  captured?: boolean | null;
  amount?: number | null;
  amount_refunded?: number | null;
  [key: string]: unknown;
};

/** Convert Razorpay minor units (paise) to rupees. */
export function paymentAmountRupees(payment: { amount?: number | null }): number {
  return Number(payment.amount || 0) / 100;
}

/**
 * True when a Razorpay payment entity is fully captured (not authorized-only / refunded)
 * and meets an optional minimum amount in rupees.
 */
export function isCapturedPaymentEntity(
  payment: RazorpayPaymentEntity | Record<string, unknown> | null | undefined,
  opts?: { minRupees?: number; orderId?: string | null; toleranceRupees?: number }
): boolean {
  if (!payment || typeof payment !== 'object') return false;
  const p = payment as RazorpayPaymentEntity;
  if (p.status !== 'captured' || p.captured !== true) return false;
  if (Number(p.amount_refunded || 0) !== 0) return false;
  // When a Razorpay order id is required, payment must be bound to that exact order.
  if (opts?.orderId) {
    if (!p.order_id || p.order_id !== opts.orderId) return false;
  }
  const min = Number(opts?.minRupees);
  if (Number.isFinite(min) && min > 0) {
    const tol = Number.isFinite(Number(opts?.toleranceRupees)) ? Number(opts!.toleranceRupees) : 1;
    if (paymentAmountRupees(p) + tol < min) return false;
  }
  return true;
}

export async function fetchCapturedPayment(
  paymentId: string,
  credentials: { key_id: string; key_secret: string },
  fetcher: typeof fetch = fetch
) {
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
    throw new Error('Invalid payment ID');
  }

  const response = await fetcher(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.key_id}:${credentials.key_secret}`).toString('base64')}`,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error('Payment verification unavailable');
  }

  const payment = await response.json();
  if (!isCapturedPaymentEntity(payment)) {
    throw new Error('Payment has not been captured');
  }
  if (payment.id !== paymentId) {
    throw new Error('Payment has not been captured');
  }

  return payment as RazorpayPaymentEntity;
}

/**
 * Confirm a COD upfront (or prepaid) payment is captured for the expected amount.
 * Throws when the payment is missing, not captured, refunded, underpaid, or order-mismatched.
 */
export async function assertCapturedCharge(opts: {
  paymentId: string;
  credentials: { key_id: string; key_secret: string };
  expectedMinRupees: number;
  orderId?: string | null;
  fetcher?: typeof fetch;
}): Promise<RazorpayPaymentEntity> {
  const payment = await fetchCapturedPayment(
    opts.paymentId,
    opts.credentials,
    opts.fetcher
  );
  if (
    !isCapturedPaymentEntity(payment, {
      minRupees: opts.expectedMinRupees,
      orderId: opts.orderId,
    })
  ) {
    throw new Error(
      `Payment ${opts.paymentId} failed capture/amount check (expected ≥ ₹${opts.expectedMinRupees})`
    );
  }
  return payment;
}
