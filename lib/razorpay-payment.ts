/**
 * Read-only Razorpay payment lookups (capture amount checks, etc.).
 */

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
  if (
    payment.id !== paymentId ||
    payment.status !== 'captured' ||
    payment.captured !== true ||
    Number(payment.amount_refunded || 0) !== 0
  ) {
    throw new Error('Payment has not been captured');
  }

  return payment;
}

export type CaptureCheck =
  | { captured: true; payment: any }
  | { captured: false; reason: string };

/**
 * Server-side proof that a Razorpay payment is CAPTURED (money collected).
 * A valid checkout signature only proves the payment was authorized; an
 * `authorized` payment is not collected and is auto-refunded if never captured.
 *
 * Retries briefly because auto-capture can land a moment after the client's
 * success callback. Never throws. When this returns captured:false the caller
 * must keep the order pending — the payment.captured / order.paid webhook
 * completes it.
 */
export async function confirmRazorpayCapture(
  paymentId: string,
  credentials: { key_id: string; key_secret: string },
  opts: { expectedOrderId?: string | null; attempts?: number; delayMs?: number; fetcher?: typeof fetch } = {},
): Promise<CaptureCheck> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const delayMs = opts.delayMs ?? 1500;
  let reason = 'not captured';
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, delayMs * i));
    try {
      const payment = await fetchCapturedPayment(paymentId, credentials, opts.fetcher);
      if (opts.expectedOrderId && payment.order_id && payment.order_id !== opts.expectedOrderId) {
        return { captured: false, reason: 'payment belongs to a different Razorpay order' };
      }
      return { captured: true, payment };
    } catch (err: any) {
      reason = err?.message || 'capture check failed';
      if (reason === 'Invalid payment ID') break;
    }
  }
  return { captured: false, reason };
}
