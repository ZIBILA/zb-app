/**
 * Browser helper for POST /api/checkout/complete.
 *
 * The route answers `paymentState: 'pending_capture'` (HTTP 202) when Razorpay has
 * only AUTHORIZED the payment: the order is saved as pending and nothing
 * "order confirmed" happens yet. This helper re-sends the same request until the
 * route reports a confirmed order (it then runs the normal completion path once),
 * or gives up after `maxWaitMs` and returns `pendingCapture: true` so the page can
 * tell the shopper to wait instead of showing success.
 *
 * Each send is itself retried (2 s / 5 s / 10 s) on a dropped connection, HTTP 5xx
 * or 429: the route answers 503 `{ retry: true }` when it verified the payment but
 * could not write the order, and a flaky mobile network looks the same from here.
 * The payment is already taken at this point, so giving up after one attempt
 * strands a paid order (2 Nov: ZBPP82722 sat pending for 4.5 h). 4xx answers are
 * final (bad signature, missing details) and are never retried.
 */
export type CheckoutCompleteResult = {
  res: Response | null;
  data: any;
  pendingCapture: boolean;
};

export const COMPLETE_RETRY_DELAYS_MS = [2000, 5000, 10000];

export function isRetryableCompleteStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function postCheckoutComplete(
  body: unknown,
  opts: {
    pollMs?: number;
    maxWaitMs?: number;
    isCancelled?: () => boolean;
    /** Test hooks: replace fetch / the backoff sleep. */
    fetchImpl?: typeof fetch;
    retryDelaysMs?: number[];
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<CheckoutCompleteResult> {
  const pollMs = opts.pollMs ?? 4000;
  const deadline = Date.now() + (opts.maxWaitMs ?? 3 * 60_000);
  const payload = JSON.stringify(body);
  const doFetch = opts.fetchImpl ?? fetch;
  const delays = opts.retryDelaysMs ?? COMPLETE_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const sendOnce = async () => {
    const res = await doFetch('/api/checkout/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };

  // One logical send = up to 1 + delays.length attempts. The last response seen
  // is returned even if it was a 5xx (the page then falls back to the by-Razorpay
  // lookup); only when every attempt failed to connect is the error thrown.
  const send = async (): Promise<{ res: Response; data: any }> => {
    let last: { res: Response; data: any } | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (attempt > 0) {
        if (opts.isCancelled?.()) break;
        await sleep(delays[attempt - 1]);
      }
      try {
        last = await sendOnce();
        lastErr = null;
        if (!isRetryableCompleteStatus(last.res.status)) return last;
      } catch (err) {
        lastErr = err;
      }
    }
    if (last) return last;
    throw lastErr ?? new Error('checkout/complete unreachable');
  };

  let { res, data } = await send();
  while (data?.paymentState === 'pending_capture' && Date.now() < deadline) {
    await sleep(pollMs);
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
