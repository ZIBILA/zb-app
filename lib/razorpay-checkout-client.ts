/**
 * Browser-only helpers for Razorpay Standard Checkout.
 * Keeps checkout page logic resilient: SDK wait, option validation, safe open.
 */

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: unknown) => void) => void;
    };
  }
}

const CHECKOUT_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/** Wait until window.Razorpay is available (or inject the script once). */
export async function waitForRazorpaySdk(timeoutMs = 12_000): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Razorpay can only load in the browser");
  }
  if (typeof window.Razorpay === "function") return;

  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${CHECKOUT_SCRIPT_SRC}"]`
  );
  if (!existing) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CHECKOUT_SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Razorpay checkout script"));
      document.head.appendChild(script);
    });
  }

  const start = Date.now();
  while (typeof window.Razorpay !== "function") {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Payment gateway is still loading. Please wait a moment and try again.");
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

export type RazorpayOpenOptions = {
  key: string;
  amount: number; // paise
  currency: string;
  order_id: string;
  name?: string;
  description?: string;
  handler: (response: unknown) => void;
  prefill?: Record<string, string | undefined>;
  theme?: Record<string, string>;
  modal?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Validate the minimum fields Razorpay needs before opening the modal. */
export function validateRazorpayOpenOptions(opts: {
  key?: string | null;
  orderId?: string | null;
  amountPaise?: number | null;
}): string | null {
  const key = String(opts.key || "").trim();
  if (!key || !key.startsWith("rzp_")) {
    return "Payment could not start (invalid gateway key). Please refresh and try again.";
  }
  const orderId = String(opts.orderId || "").trim();
  if (!orderId || !orderId.startsWith("order_")) {
    return "Payment could not start (missing order). Please refresh and try again.";
  }
  const amount = Number(opts.amountPaise);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Payment could not start (invalid amount). Please refresh and try again.";
  }
  return null;
}

/**
 * Open Standard Checkout. Throws if SDK/options invalid.
 * Caller owns lock/loading UI; use onOpened to clear "opening" state once modal is up.
 *
 * Do not inject a custom `config.display` here — that replaces Razorpay's native
 * "Recommended" + "All Payment Options" layout with a stripped category list.
 */
export async function openRazorpayStandardCheckout(
  options: RazorpayOpenOptions,
  hooks?: {
    onPaymentFailed?: (response: unknown) => void;
    onOpened?: () => void;
  }
): Promise<void> {
  await waitForRazorpaySdk();

  const validationError = validateRazorpayOpenOptions({
    key: options.key as string,
    orderId: options.order_id as string,
    amountPaise: Number(options.amount),
  });
  if (validationError) throw new Error(validationError);

  // Soft backdrop — heavy rgba overlays have been reported to steal clicks from Pay
  const safeOptions: RazorpayOpenOptions = {
    ...options,
    theme: {
      color: "#000000",
      ...(options.theme || {}),
      // Prefer Razorpay default backdrop; avoid ultra-opaque custom overlays
      backdrop_color: options.theme?.backdrop_color || "rgba(0,0,0,0.6)",
    },
    modal: {
      confirm_close: true,
      animation: true,
      ...(options.modal || {}),
    },
  };

  console.log("[Razorpay] Opening Standard Checkout", {
    order_id: safeOptions.order_id,
    amount_paise: safeOptions.amount,
    currency: safeOptions.currency,
    key_prefix: String(safeOptions.key).slice(0, 10),
  });

  const RazorpayCtor = window.Razorpay!;
  const rzp = new RazorpayCtor(safeOptions as Record<string, unknown>);

  if (hooks?.onPaymentFailed) {
    rzp.on("payment.failed", hooks.onPaymentFailed);
  }

  try {
    rzp.open();
    hooks?.onOpened?.();
  } catch (err) {
    console.error("[Razorpay] rzp.open() failed:", err);
    throw new Error("Could not open the payment window. Please try again.");
  }
}
