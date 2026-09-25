import { checkoutBrowserToken, prepareMetaPurchase, prepareStoreCreditPurchase, recordCapturedPurchase, setPurchaseCookie } from './meta-purchases';

async function boundedObservation<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('meta_observer_timeout')), 1000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

// These observers never change payment acceptance, amounts, gateway credentials,
// order reuse, fulfillment, or the existing response. Advertising storage is optional
// for checkout; only a successfully persisted and verified snapshot may be advertised.
export async function attachMetaCheckoutContext<T>(req: Request, response: T, context: {
  orderId: string | null;
  gateway: { id: string; amount: number; currency: string; live: boolean };
}): Promise<T> {
  if (!context.orderId) return response;
  try {
    const token = checkoutBrowserToken(req);
    await boundedObservation(() => prepareMetaPurchase(req, context.orderId!, context.gateway, token));
    setPurchaseCookie(response, token);
  } catch {
    console.warn('[Meta Purchase] Checkout context unavailable; checkout response preserved');
  }
  return response;
}

export async function observeMetaWalletCheckout(req: Request, orderId: string, customerId: string | null): Promise<string | undefined> {
  if (!customerId) return undefined;
  try {
    const token = checkoutBrowserToken(req);
    await boundedObservation(() => prepareStoreCreditPurchase(req, orderId, customerId, token));
    return token;
  } catch {
    console.warn('[Meta Purchase] Wallet context unavailable; checkout continues');
    return undefined;
  }
}

export function attachMetaWalletCookie<T>(response: T, token: string | undefined): T {
  if (token) {
    try { setPurchaseCookie(response, token); }
    catch { console.warn('[Meta Purchase] Browser cookie unavailable'); }
  }
  return response;
}

/** Called only after the existing webhook signature check. Delivery runs in the worker. */
export async function observeMetaCapture(payment: unknown, capturedAt: Date): Promise<void> {
  try { await boundedObservation(() => recordCapturedPurchase(payment, capturedAt)); }
  catch {
    // The worker can independently fetch proof for a saved snapshot. A Meta DB
    // failure must not interrupt the existing signed webhook's payment processing.
    console.warn('[Meta Purchase] Capture observation deferred; webhook processing continues');
  }
}
