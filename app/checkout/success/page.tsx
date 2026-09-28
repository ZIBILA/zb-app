"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

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
};

function CheckoutSuccessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Confirming your payment…");

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      const razorpay_payment_id = searchParams.get("razorpay_payment_id");
      const razorpay_order_id = searchParams.get("razorpay_order_id");
      const razorpay_signature = searchParams.get("razorpay_signature");

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
        try {
          const lookup = await fetch(
            `/api/orders/by-razorpay?orderId=${encodeURIComponent(razorpay_order_id)}`
          );
          if (lookup.ok) {
            const data = await lookup.json();
            if (data?.orderId) {
              sessionStorage.setItem("last_placed_order_id", data.orderId);
              sessionStorage.removeItem(PENDING_KEY);
              router.replace(`/orders/${data.orderId}/confirmation`);
              return;
            }
          }
        } catch {
          /* fall through */
        }
        setMessage(
          `Payment received (${razorpay_payment_id}). Open My Orders or contact support if you don't see it.`
        );
        setTimeout(() => router.replace("/profile?tab=orders"), 3500);
        return;
      }

      try {
        const verifyRes = await fetch("/api/checkout/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...pending,
            razorpay: {
              razorpay_payment_id,
              razorpay_order_id,
              razorpay_signature,
            },
          }),
        });
        const verifyData = await verifyRes.json().catch(() => ({}));

        if (cancelled) return;

        if (verifyRes.ok && verifyData.orderId) {
          sessionStorage.setItem("last_placed_order_id", verifyData.orderId);
          sessionStorage.removeItem(PENDING_KEY);
          router.replace(`/orders/${verifyData.orderId}/confirmation`);
          return;
        }

        // Complete failed but payment exists — try lookup
        const lookup = await fetch(
          `/api/orders/by-razorpay?orderId=${encodeURIComponent(razorpay_order_id)}`
        );
        if (lookup.ok) {
          const data = await lookup.json();
          if (data?.orderId) {
            sessionStorage.setItem("last_placed_order_id", data.orderId);
            sessionStorage.removeItem(PENDING_KEY);
            router.replace(`/orders/${data.orderId}/confirmation`);
            return;
          }
        }

        setMessage(
          verifyData?.error ||
            `Payment succeeded (${razorpay_payment_id}) but order confirmation is delayed. Check My Orders shortly.`
        );
        setTimeout(() => router.replace("/profile?tab=orders"), 4000);
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
  }, [router, searchParams]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
      <div className="h-8 w-8 border-2 border-black/20 border-t-black rounded-full animate-spin mb-4" />
      <p className="text-sm text-black/70 max-w-md">{message}</p>
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
