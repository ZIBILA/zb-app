/**
 * Payment-status vocabulary shared by the checkout UI, the confirmation page and
 * the server routes. Money is only "collected" in the PAID_LIKE statuses; every
 * other value means the order must NOT be shown as confirmed.
 */

export const PAID_LIKE_STATUSES = ["paid", "cod_upfront_paid", "partially_paid"] as const;

/** Statuses an order carries while a Razorpay payment is still unconfirmed. */
export const UNCONFIRMED_STATUSES = [
  "pending",
  "payment_pending",
  "awaiting_confirmation",
  "failed",
  "payment_failed",
  "cancelled",
  "canceled",
] as const;

export function isPaidLikeStatus(status: unknown): boolean {
  const s = String(status || "").trim().toLowerCase();
  return (PAID_LIKE_STATUSES as readonly string[]).includes(s);
}

/** True when the order is still waiting for (or lost) its payment confirmation. */
export function isUnconfirmedStatus(status: unknown): boolean {
  const s = String(status || "").trim().toLowerCase();
  return (UNCONFIRMED_STATUSES as readonly string[]).includes(s);
}

/**
 * Order.status values that mean "not yet a live order" and must become
 * approved / open once a capture is confirmed (webhooks, cron, completion).
 */
export const PRE_CONFIRMATION_ORDER_STATUSES = [
  "pending",
  "PENDING",
  "awaiting_approval",
  "payment_pending",
  "payment_failed",
  "failed",
  "FAILED",
  "cancelled",
  "canceled",
] as const;

export function isPreConfirmationOrderStatus(status: unknown): boolean {
  const s = String(status || "").trim();
  return (PRE_CONFIRMATION_ORDER_STATUSES as readonly string[]).includes(s) ||
    (PRE_CONFIRMATION_ORDER_STATUSES as readonly string[]).includes(s.toLowerCase());
}
