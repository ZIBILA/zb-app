"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { postCheckoutComplete, CAPTURE_PENDING_MESSAGE } from "@/lib/checkout-complete-client";
import { isPaidLikeStatus } from "@/lib/payment-status";
import { useCart } from "@/lib/cart-context";

const PENDING_KEY = "zb_pending_checkout";

type PendingCheckout = {
  address: Record<string, unknown>;
  paymentMethod: string;
  items: unknown[];
  total: number;
  subtotal: number;
  currency: string;
  displayCountry?: string;
  codFee?: number;
  couponCode?: string | null;
  couponDiscount?: number;
  applyAsStoreCredit?: boolean;
  cashbackAmount?: number;
  storeCreditAmount?: number;
  guestId?: string | null;
  localOrderId?: string | null;
};

/**
 * Razorpay callback_url landing page (redirect flow: in-app browsers, and the
 * fallback when the JS handler never fires after a UPI app switch).
 *
 * Rules:
 *  - the cart is cleared only once an order is known to be PAID;
 *  - a pending / failed registration is never presented as "confirmed" — the
 *    shopper is sent to the confirmation page in its "payment not confirmed yet"
 *    state (which keeps polling) or told not to pay again;
 *  - a gateway failure POSTed here (redirect mode) returns the shopper to
 *    checkout with the reason, cart intact.
 */
function CheckoutSuccessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { clear: clearCart } = useCart();
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("Confirming your payment…");

  useEffect(() => {
    let cancelled = false;

    const goToConfirmation = (orderId: string, opts: { paid: boolean; pendingBody?: unknown; paymentId?: string | null }) => {
      try {
        sessionStorage.setItem("last_placed_order_id", orderId);
        sessionStorage.removeItem(PENDING_KEY);
        if (!opts.paid && opts.pendingBody) {
          // Hand the completion payload to the confirmation page so it keeps
          // re-sending / polling in its "payment not confirmed yet" state.
          sessionStorage.setItem(
            `zb_complete_pending_${orderId}`,
            JSON.stringify({ body: opts.pendingBody, paymentId: opts.paymentId || null })
          );
        }
      } catch {
        /* ignore */
      }
      if (opts.paid) clearCart();
      router.replace(`/orders/${orderId}/confirmation`);
    };

    async function lookupByRazorpayOrder(razorpayOrderId: string): Promise<{ orderId: string; paymentStatus: string } | null> {
      try {
        const lookup = await fetch(`/api/orders/by-razorpay?orderId=${encodeURIComponent(razorpayOrderId)}`);
        if (!lookup.ok) return null;
        const data = await lookup.json();
        if (!data?.orderId) return null;
        return { orderId: String(data.orderId), paymentStatus: String(data.paymentStatus || "") };
      } catch {
        return null;
      }
    }

    async function finish() {
      const razorpay_payment_id = searchParams.get("razorpay_payment_id");
      const razorpay_order_id = searchParams.get("razorpay_order_id");
      const razorpay_signature = searchParams.get("razorpay_signature");
      const gatewayErrorReason = searchParams.get("rzp_error_reason") || "";
      const gatewayErrorDescription = searchParams.get("rzp_error_description") || "";

      // Redirect-mode failure: Razorpay POSTs error[...] fields instead of the ids.
      if (!razorpay_payment_id && (gatewayErrorReason || gatewayErrorDescription)) {
        setFailed(true);
        const friendly =
          gatewayErrorReason === "payment_cancelled"
            ? "Payment was cancelled."
            : gatewayErrorDescription || "Payment was not completed.";
        setMessage(`${friendly} Your cart is intact — taking you back to checkout to try again.`);
        setTimeout(() => router.replace("/checkout"), 2500);
        return;
      }

      if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
        setMessage("Missing payment details. Checking your account for the order…");
        // Soft recovery: send user to profile orders
        setTimeout(() => router.replace("/profile?tab=orders"), 2500);
        return;
      }

      let pending: PendingCheckout | null = null;
      try {
        const raw = sessionStorage.getItem(PENDING_KEY);
        if (raw) pending = JSON.parse(raw);
      } catch {
        pending = null;
      }

      if (!pending?.address || !pending?.items?.length) {
        // Payment succeeded but we lost checkout payload — try lookup by Razorpay order id
        const found = await lookupByRazorpayOrder(razorpay_order_id);
        if (cancelled) return;
        if (found && isPaidLikeStatus(found.paymentStatus)) {
          goToConfirmation(found.orderId, { paid: true });
          return;
        }
        if (found) {
          // The webhook / reconciliation will confirm it; never show it as confirmed now.
          setMessage(CAPTURE_PENDING_MESSAGE);
          setTimeout(() => router.replace("/profile?tab=orders"), 6000);
          return;
        }
        setMessage(
          `Payment received (${razorpay_payment_id}). Open My Orders or contact support if you don't see it.`
        );
        setTimeout(() => router.replace("/profile?tab=orders"), 3500);
        return;
      }

      const completeBody = {
        ...pending,
        razorpay: {
          razorpay_payment_id,
          razorpay_order_id,
          razorpay_signature,
        },
      };

      try {
        // Re-sends while the payment is only authorized (paymentState "pending_capture").
        const completion = await postCheckoutComplete(completeBody, { isCancelled: () => cancelled });

        if (cancelled) return;

        if (completion.pendingCapture) {
          const pendingOrderId = completion.data?.orderId ? String(completion.data.orderId) : "";
          if (pendingOrderId) {
            // Continue on the confirmation page in its "not confirmed yet" state.
            goToConfirmation(pendingOrderId, { paid: false, pendingBody: completeBody, paymentId: razorpay_payment_id });
            return;
          }
          setMessage(CAPTURE_PENDING_MESSAGE);
          setTimeout(() => router.replace("/profile?tab=orders"), 6000);
          return;
        }
        const verifyRes = completion.res!;
        const verifyData = completion.data;

        if (verifyRes.ok && verifyData.orderId) {
          if (verifyData.order) {
            try {
              sessionStorage.setItem(
                `zb_confirmation_${verifyData.orderId}`,
                JSON.stringify(verifyData.order)
              );
            } catch { /* ignore */ }
          }
          goToConfirmation(String(verifyData.orderId), { paid: true });
          return;
        }

        // Complete failed but payment exists — try lookup, but trust only a paid row
        const found = await lookupByRazorpayOrder(razorpay_order_id);
        if (cancelled) return;
        if (found && isPaidLikeStatus(found.paymentStatus)) {
          goToConfirmation(found.orderId, { paid: true });
          return;
        }

        setMessage(
          verifyData?.error
            ? `${verifyData.error} Your payment (${razorpay_payment_id}) is recorded — please do NOT pay again. Check My Orders shortly or contact support@zicabella.com with this payment ID.`
            : `Payment succeeded (${razorpay_payment_id}) but order confirmation is delayed. Please do NOT pay again — check My Orders shortly.`
        );
        setTimeout(() => router.replace("/profile?tab=orders"), 6000);
      } catch {
        if (!cancelled) {
          setMessage("Connection issue confirming your order. Check My Orders — do not pay again.");
          setTimeout(() => router.replace("/profile?tab=orders"), 4000);
        }
      }
    }

    finish();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, searchParams]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center bg-background text-foreground">
      <div className="h-8 w-8 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin mb-4" />
      <p className="text-sm font-semibold text-foreground mb-1">
        {failed ? "Payment not completed" : "Payment successful"}
      </p>
      <p className="text-sm text-foreground/60 max-w-md">{message}</p>
      {!failed && (
        <p className="text-[11px] text-foreground/40 mt-3">Please don’t refresh or pay again.</p>
      )}
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center text-sm text-black/60">
          Confirming your payment…
        </div>
      }
    >
      <CheckoutSuccessInner />
    </Suspense>
  );
}
