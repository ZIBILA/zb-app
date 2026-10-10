/**
 * Browser helper for POST /api/checkout/complete.
 *
 * The route answers `paymentState: 'pending_capture'` (HTTP 202) when Razorpay has
 * only AUTHORIZED the payment: the order is saved as pending and nothing
 * "order confirmed" happens yet. This helper re-sends the same request until the
 * route reports a confirmed order (it then runs the normal completion path once),
 * or gives up after `maxWaitMs` and returns `pendingCapture: true` so the page can
 * tell the shopper to wait instead of showing success.
 */
export type CheckoutCompleteResult = {
  res: Response | null;
  data: any;
  pendingCapture: boolean;
};

export async function postCheckoutComplete(
  body: unknown,
  opts: { pollMs?: number; maxWaitMs?: number; isCancelled?: () => boolean } = {},
): Promise<CheckoutCompleteResult> {
  const pollMs = opts.pollMs ?? 4000;
  const deadline = Date.now() + (opts.maxWaitMs ?? 3 * 60_000);
  const payload = JSON.stringify(body);
  const send = async () => {
    const res = await fetch('/api/checkout/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };

  let { res, data } = await send();
  while (data?.paymentState === 'pending_capture' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (opts.isCancelled?.()) break;
    try {
      ({ res, data } = await send());
    } catch {
      // network blip — keep waiting for capture
    }
  }
  return { res, data, pendingCapture: data?.paymentState === 'pending_capture' };
}

export const CAPTURE_PENDING_MESSAGE =
  'Your bank has authorised the payment but has not confirmed it yet. Please do NOT pay again — your order will be confirmed automatically once the payment is captured. You can check My Orders shortly.';
