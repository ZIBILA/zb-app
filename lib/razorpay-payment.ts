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
