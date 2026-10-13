"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Calendar,
  Loader2,
  Banknote,
  ShieldCheck,
  ShoppingBag,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { useMetaEvents, ga4Purchase } from "@/hooks/useMetaEvents";
import { useSnapEvents } from "@/hooks/useSnapEvents";
import { snapCatalogIdFromOrderItem } from "@/lib/snap/catalog-id";
import { pickRealEmail, pickRealName, pickRealPhone } from "@/lib/tracking/placeholder-identity";
import {
  decideMetaBrowserPurchase,
  buildMetaBrowserPurchaseArgs,
  dispatchMetaBrowserPurchaseOnce,
  hasMetaBrowserPurchaseBeenSent,
  waitForFbq,
  decideSnapBrowserPurchase,
  dispatchSnapBrowserPurchaseOnce,
  hasSnapBrowserPurchaseBeenSent,
  waitForSnaptr,
  fetchOrderServerFacts,
  hasPaymentFacts,
  orderForTracking,
  META_PENDING_POLL_INTERVAL_MS,
  META_PENDING_POLL_MAX,
} from "@/lib/meta/browser-purchase";
import { snapPurchaseCurrency } from "@/lib/snap/currency";
import { snapPurchasePhone } from "@/lib/snap/identity";
import { useOpenAiEvents } from "@/hooks/useOpenAiEvents";
import { toMinorUnits } from "@/lib/openaiPixel";
import { trackStorefrontEvent } from "@/lib/track-client";
import { trackPurchase as zbTrackPurchase } from "@/lib/analytics-tracker";
import { formatPriceString } from "@/lib/global-pricing-client";
import { resetGuestIdentity } from "@/lib/metaPixel";
import { postCheckoutComplete } from "@/lib/checkout-complete-client";

type RegistrationStatus = "confirming" | "confirmed" | "failed";

export default function OrderConfirmationPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<"not_found" | "unauthorized" | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<RegistrationStatus>("confirmed");
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [purchasedPixel, setPurchasedPixel] = useState(false);
  const completeStartedRef = useRef(false);
  const guestResetDeferredRef = useRef(false);
  const { trackPurchase } = useMetaEvents();
  const { trackPurchase: trackSnapPurchase } = useSnapEvents();
  const { trackOrderCreated: trackOpenAiOrderCreated } = useOpenAiEvents();

  // The order as the ad pixels must see it: the server's payment state, charged
  // total, currency and items (order.serverFacts) on top of the displayed copy.
  // What the shopper sees keeps coming from `order` itself.
  const trackingOrder = useMemo(() => orderForTracking(order), [order]);

  // Attach freshly fetched server facts to the order on screen (and to its cached
  // copy, so a refresh keeps them). Ignored if the page now shows another order.
  const applyServerFacts = (forOrderId: string, facts: any) => {
    setOrder((prev: any) => {
      if (!prev || String(prev.id) !== String(forOrderId)) return prev;
      const next = { ...prev, serverFacts: facts };
      try {
        sessionStorage.setItem(`zb_confirmation_${forOrderId}`, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Non-Meta analytics on first confirmed visit; Meta/Snap Purchase wait for capture.
  useEffect(() => {
    if (!order || registrationStatus !== "confirmed") return;

    const storageKey = `meta_purchase_fired_${order.id}`;
    const alreadyFired =
      typeof window !== "undefined"
        ? localStorage.getItem(storageKey) === "true" || sessionStorage.getItem(storageKey) === "true"
        : false;
    const orderAgeHours = order.createdAt
      ? (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60)
      : 0;
    const isFreshOrder = orderAgeHours < 24;

    if (!alreadyFired && isFreshOrder) {
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(storageKey, "true");
          sessionStorage.setItem(storageKey, "true");
        } catch {}
      }

      const val = parseFloat(order.totalPrice || "0");
      const orderCurrency = (order.currency || "INR").toUpperCase();

      const toSnapId = (item: any): string => {
        const raw = item.sku || item.variantId || item.productId || "";
        const s = String(raw);
        const stripped = s.startsWith("variant:") ? s.slice(8) : s;
        const m = stripped.match(/(\d+)\s*$/);
        return m ? m[1] : stripped;
      };
      const contentIds = order.items?.map(toSnapId) || [];

      let userData: any = undefined;
      try {
        const addr = order.shippingAddress
          ? typeof order.shippingAddress === "string"
            ? JSON.parse(order.shippingAddress)
            : order.shippingAddress
          : null;

        const cust = order.customer || {};
        const nameToUse = pickRealName(cust.name, addr?.name) || "";
        const nameParts = nameToUse.trim().split(/\s+/);
        userData = {
          country: addr?.country || undefined,
          st: addr?.state || undefined,
          ct: addr?.city || undefined,
          zp: addr?.zip || undefined,
          fn: nameParts[0] || undefined,
          ln: nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined,
          em: pickRealEmail(cust.email, addr?.email),
          ph: pickRealPhone(cust.phone, addr?.phone),
        };
      } catch (e) {
        console.error("Error parsing shippingAddress in confirmation page", e);
      }

      let storedCategory = undefined;
      if (typeof window !== "undefined") {
        storedCategory = sessionStorage.getItem(`order_categories_${order.id}`) || undefined;
      }

      ga4Purchase(
        order.id,
        val,
        orderCurrency,
        contentIds,
        storedCategory,
        order.items?.map((item: any) => ({
          id: toSnapId(item),
          quantity: item.quantity || 1,
          item_price: parseFloat(item.price || "0"),
          title: item.title,
        })) || []
      );

      const openAiContents =
        order.items?.map((item: any) => ({
          id: toSnapId(item),
          name: item.title,
          content_type: "product" as const,
          quantity: item.quantity || 1,
          amount: toMinorUnits(parseFloat(item.price || "0"), orderCurrency),
          currency: orderCurrency,
        })) || [];
      trackOpenAiOrderCreated(order.id, val, orderCurrency, openAiContents, userData);

      zbTrackPurchase(order.id, val, { num_items: contentIds.length, currency: orderCurrency });

      if (!session?.user) {
        if (
          decideMetaBrowserPurchase(trackingOrder, {
            alreadySent: hasMetaBrowserPurchaseBeenSent(order.id),
          }).action !== "done"
        ) {
          guestResetDeferredRef.current = true;
        } else {
          resetGuestIdentity();
        }
      }
    }

    if (!purchasedPixel) {
      setPurchasedPixel(true);
      const val = parseFloat(order.totalPrice || "0");
      const orderCurrency = (order.currency || "INR").toUpperCase();
      const isCod = order.isCod || (order.paymentMethod || "").toUpperCase() === "COD";
      trackStorefrontEvent(isCod ? "COD Order Placed" : "Purchase Completed", {
        customerId: order.customerId || null,
        customerPhone: order.customerPhone || order.customer?.phone || null,
        orderId: order.id,
        metadata: {
          value: val,
          currency: orderCurrency,
          content_ids: order.items?.map((item: any) => item.productId || item.variantId) || [],
          num_items: order.items?.length || 0,
          paymentMethod: order.paymentMethod,
        },
      });
    }
  }, [order, trackingOrder, purchasedPixel, registrationStatus, session?.user]);

  // Meta browser Pixel Purchase: once per order, only after confirmed payment.
  useEffect(() => {
    if (!order?.id || registrationStatus !== "confirmed") return;
    const decision = decideMetaBrowserPurchase(trackingOrder, {
      alreadySent: hasMetaBrowserPurchaseBeenSent(order.id),
    });
    const finishGuestReset = () => {
      if (guestResetDeferredRef.current && !session?.user) {
        guestResetDeferredRef.current = false;
        resetGuestIdentity();
      }
    };
    if (decision.action === "wait") return;
    if (decision.action === "done") {
      finishGuestReset();
      return;
    }
    const args = buildMetaBrowserPurchaseArgs(trackingOrder);
    if (!args) {
      finishGuestReset();
      return;
    }
    let storedCategory: string | undefined;
    try {
      storedCategory = sessionStorage.getItem(`order_categories_${order.id}`) || undefined;
    } catch {}
    dispatchMetaBrowserPurchaseOnce(order.id, async () => {
      if (!(await waitForFbq())) return false;
      trackPurchase(
        args.orderId,
        args.value,
        args.currency,
        args.contentIds,
        args.userData,
        storedCategory,
        args.contents,
        { ga: false }
      );
      return true;
    }).finally(finishGuestReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, registrationStatus]);

  useEffect(() => {
    const flush = () => {
      if (guestResetDeferredRef.current) {
        guestResetDeferredRef.current = false;
        resetGuestIdentity();
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  // Snap browser Pixel PURCHASE: once per order, only after confirmed payment.
  // Value, currency and item ids are the stored order's (the same the server
  // Conversions API Purchase reports): the charged total in the charged currency.
  useEffect(() => {
    if (!order?.id || registrationStatus !== "confirmed") return;
    if (
      decideSnapBrowserPurchase(trackingOrder, {
        alreadySent: hasSnapBrowserPurchaseBeenSent(order.id),
      }).action !== "fire"
    ) {
      return;
    }
    const val = Number(trackingOrder.totalPrice) || 0;
    const orderCurrency = snapPurchaseCurrency(trackingOrder);
    let addr: any = null;
    try {
      addr = order.shippingAddress
        ? typeof order.shippingAddress === "string"
          ? JSON.parse(order.shippingAddress)
          : order.shippingAddress
        : null;
    } catch {
      addr = null;
    }
    const cust = order.customer || {};
    const nameParts = (pickRealName(cust.name, addr?.name) || "").trim().split(/\s+/).filter(Boolean);
    const userData = {
      country: addr?.countryCode || addr?.country_code || addr?.country || undefined,
      st: addr?.state || undefined,
      ct: addr?.city || undefined,
      zp: addr?.zip || undefined,
      fn: nameParts[0] || undefined,
      ln: nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined,
      em: pickRealEmail(cust.email, addr?.email),
      ph: snapPurchasePhone(cust.phone, addr?.phone), // same rule as the server event
    };
    const snapContents = (trackingOrder.items || []).map((item: any) => ({
      id: snapCatalogIdFromOrderItem(item) || "",
      quantity: Number(item.quantity) || 1,
      item_price: parseFloat(item.price || "0") || undefined,
    }));
    let storedCategory: string | undefined;
    try {
      storedCategory = sessionStorage.getItem(`order_categories_${order.id}`) || undefined;
    } catch {}
    dispatchSnapBrowserPurchaseOnce(order.id, async () => {
      if (!(await waitForSnaptr())) return false;
      trackSnapPurchase(
        order.id,
        val,
        orderCurrency,
        snapContents.map((c: any) => c.id).filter(Boolean),
        userData,
        storedCategory,
        snapContents
      );
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, registrationStatus]);

  // Poll while payment capture is still pending so Purchase can fire once paid.
  // Only the server facts are refreshed (light tracking view); the displayed order is untouched.
  useEffect(() => {
    if (!id || !order?.id || registrationStatus !== "confirmed") return;
    const metaWaits =
      decideMetaBrowserPurchase(trackingOrder, {
        alreadySent: hasMetaBrowserPurchaseBeenSent(order.id),
      }).action === "wait";
    const snapWaits =
      decideSnapBrowserPurchase(trackingOrder, {
        alreadySent: hasSnapBrowserPurchaseBeenSent(order.id),
      }).action === "wait";
    if (!metaWaits && !snapWaits) return;
    const polledOrderId = String(order.id);
    const knownStatus = String(trackingOrder?.paymentStatus || "");
    let polls = 0;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (++polls > META_PENDING_POLL_MAX) {
        clearInterval(timer);
        if (guestResetDeferredRef.current && !session?.user) {
          guestResetDeferredRef.current = false;
          resetGuestIdentity();
        }
        return;
      }
      if (typeof document !== "undefined" && document.hidden) return;
      const facts = await fetchOrderServerFacts(polledOrderId);
      if (!facts || cancelled) return; // transient — next tick retries
      if (String(facts.paymentStatus || "") !== knownStatus) {
        applyServerFacts(polledOrderId, facts);
      }
    }, META_PENDING_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, order?.id, trackingOrder?.paymentStatus, registrationStatus]);

  useEffect(() => {
    if (!id) return;
    const orderId = String(id);

    // 1) Paint optimistic / cached confirmation immediately
    let painted = false;
    let paintedOrder: any = null;
    try {
      const cached = sessionStorage.getItem(`zb_confirmation_${orderId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.id) {
          setOrder(parsed);
          setLoading(false);
          setFetchError(null);
          painted = true;
          paintedOrder = parsed;
          const status = (parsed.registrationStatus as RegistrationStatus) || "confirmed";
          setRegistrationStatus(status === "confirming" ? "confirming" : "confirmed");
          sessionStorage.setItem("last_placed_order_id", orderId);
        }
      }
    } catch {
      /* ignore */
    }

    // 2) If checkout left a pending complete payload, run it in the background.
    //    Resolves true when there was a payload to process (whatever the outcome).
    const runPendingComplete = async (): Promise<boolean> => {
      if (completeStartedRef.current) return true;
      let pendingRaw: string | null = null;
      try {
        pendingRaw = sessionStorage.getItem(`zb_complete_pending_${orderId}`);
      } catch {
        pendingRaw = null;
      }
      if (!pendingRaw) return false;

      completeStartedRef.current = true;
      setRegistrationStatus("confirming");

      let pending: { body: any; paymentId?: string | null } | null = null;
      try {
        pending = JSON.parse(pendingRaw);
      } catch {
        pending = null;
      }
      if (!pending?.body) {
        try {
          sessionStorage.removeItem(`zb_complete_pending_${orderId}`);
        } catch {}
        return true;
      }

      try {
        const completion = await postCheckoutComplete(pending.body);
        if (completion.pendingCapture) {
          // Keep confirming UI; capture webhook will make a later visit succeed.
          setRegistrationStatus("confirming");
          setRegistrationError(null);
          return true;
        }
        const verifyRes = completion.res!;
        const verifyData = completion.data || {};

        if (verifyRes.ok && (verifyData.orderId || verifyData.order)) {
          let baseOptimistic: any = null;
          try {
            const raw = sessionStorage.getItem(`zb_confirmation_${orderId}`);
            if (raw) baseOptimistic = JSON.parse(raw);
          } catch {}
          const confirmedId = String(verifyData.order?.id || verifyData.orderId || orderId);
          // The order is registered: read what the server stored (payment state,
          // charged total + currency, items) BEFORE the page turns "confirmed", so
          // the Snap / Meta browser Purchase can fire on that first confirmed
          // render. Bounded wait; without an answer the page behaves as before
          // (the server-side Purchase does not depend on this).
          const serverFacts = hasPaymentFacts(verifyData.order)
            ? null
            : await fetchOrderServerFacts(confirmedId);
          const confirmed = verifyData.order
            ? { ...verifyData.order, registrationStatus: "confirmed" }
            : {
                ...(baseOptimistic || {}),
                id: verifyData.orderId || orderId,
                registrationStatus: "confirmed",
              };
          if (serverFacts) confirmed.serverFacts = serverFacts;
          setOrder(confirmed);
          setRegistrationStatus("confirmed");
          setRegistrationError(null);
          try {
            sessionStorage.setItem(`zb_confirmation_${orderId}`, JSON.stringify(confirmed));
            if (verifyData.orderId && verifyData.orderId !== orderId) {
              sessionStorage.setItem(`zb_confirmation_${verifyData.orderId}`, JSON.stringify(confirmed));
              sessionStorage.setItem("last_placed_order_id", verifyData.orderId);
            }
            sessionStorage.removeItem(`zb_complete_pending_${orderId}`);
            sessionStorage.removeItem("zb_pending_checkout");
          } catch {}
          return true;
        }

        // Recovery by Razorpay order id
        const rzpOrderId = pending.body?.razorpay?.razorpay_order_id;
        if (rzpOrderId) {
          try {
            const lookup = await fetch(
              `/api/orders/by-razorpay?orderId=${encodeURIComponent(rzpOrderId)}`
            );
            if (lookup.ok) {
              const data = await lookup.json();
              if (data?.orderId) {
                const slim = await fetch(
                  `/api/orders/${encodeURIComponent(data.orderId)}/confirmation?bypass_auth=true`
                );
                const slimData = await slim.json().catch(() => ({}));
                if (slim.ok && (slimData.order || slimData)) {
                  const confirmed = {
                    ...(slimData.order || slimData),
                    registrationStatus: "confirmed",
                  };
                  setOrder(confirmed);
                  setRegistrationStatus("confirmed");
                  try {
                    sessionStorage.setItem(
                      `zb_confirmation_${data.orderId}`,
                      JSON.stringify(confirmed)
                    );
                    sessionStorage.setItem("last_placed_order_id", data.orderId);
                    sessionStorage.removeItem(`zb_complete_pending_${orderId}`);
                  } catch {}
                  if (data.orderId !== orderId) {
                    router.replace(`/orders/${data.orderId}/confirmation`);
                  }
                  return true;
                }
              }
            }
          } catch {
            /* fall through */
          }
        }

        setRegistrationStatus("failed");
        setRegistrationError(
          verifyData?.error ||
            `Payment ${pending.paymentId || "received"} succeeded, but we could not finish registering your order. Please do NOT pay again — contact support@zicabella.com with your payment ID.`
        );
      } catch {
        setRegistrationStatus("failed");
        setRegistrationError(
          `Payment succeeded, but we hit a connection issue finishing your order. Please do NOT pay again — contact support@zicabella.com with your payment ID.`
        );
      }
      return true;
    };

    // 3) No cache: fetch slim confirmation (refresh / shared link)
    const fetchOrder = async () => {
      try {
        const res = await fetch(
          `/api/orders/${encodeURIComponent(orderId)}/confirmation?bypass_auth=true`
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          const fetched = { ...(data.order || data), registrationStatus: "confirmed" };
          setOrder(fetched);
          setRegistrationStatus("confirmed");
          setFetchError(null);
          try {
            sessionStorage.setItem("last_placed_order_id", orderId);
            sessionStorage.setItem(`zb_confirmation_${orderId}`, JSON.stringify(fetched));
          } catch {}
        } else if (!painted) {
          if (res.status === 401 || res.status === 403) setFetchError("unauthorized");
          else setFetchError("not_found");
        }
      } catch (e) {
        console.error("Error fetching order", e);
        if (!painted) setFetchError("not_found");
      } finally {
        setLoading(false);
      }
    };

    void (async () => {
      const completedHere = await runPendingComplete();
      // If we painted optimistic UI, skip blocking fetch. Revalidate only when no paint.
      if (!painted) {
        await fetchOrder();
      } else {
        setLoading(false);
        // A cached copy from before the order's payment state was known (e.g. a
        // refresh): fetch the server facts in the background so the browser
        // Purchase can still fire once. Nothing on screen changes.
        const cachedId = String(paintedOrder?.id || orderId);
        if (
          !completedHere &&
          !hasPaymentFacts(paintedOrder) &&
          !(hasMetaBrowserPurchaseBeenSent(cachedId) && hasSnapBrowserPurchaseBeenSent(cachedId))
        ) {
          const facts = await fetchOrderServerFacts(cachedId);
          if (facts) applyServerFacts(cachedId, facts);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-foreground/40 dark:text-foreground/20" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center space-y-4">
        <h1 className="text-xl font-bold tracking-tight">
          {fetchError === "unauthorized" ? "Sign in to view this order" : "Order not found"}
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          {fetchError === "unauthorized"
            ? "Your payment went through. Log in with the account/email used at checkout to see the confirmation."
            : "We couldn’t load this confirmation link."}
        </p>
        <div className="flex flex-col gap-3 items-center">
          {fetchError === "unauthorized" && (
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(`/orders/${id}/confirmation`)}`}
              className="text-[12px] font-bold uppercase tracking-widest text-foreground hover:opacity-80 transition-colors underline"
            >
              Sign in
            </Link>
          )}
          <Link
            href="/profile?tab=orders"
            className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors underline"
          >
            My Orders
          </Link>
          <Link
            href="/"
            className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors underline"
          >
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  const arrivalDate = new Date();
  arrivalDate.setDate(arrivalDate.getDate() + 5);

  const rawMethod = (order.paymentMethod || "").toLowerCase();
  const isCod = order.isCod || rawMethod === "cod" || rawMethod.includes("cash");
  const totalPrice = Number(order.totalPrice || 0);
  const upfrontPaid = isCod ? Number(order.codUpfrontPaid) || 0 : totalPrice;
  const balanceDue = isCod ? Math.max(0, totalPrice - upfrontPaid) : 0;
  const currency = order.currency || "INR";

  const subtotalPrice = Number(
    order.subtotalPrice ||
      (order.items || []).reduce(
        (sum: number, item: any) => sum + Number(item.price) * (item.quantity || 1),
        0
      )
  );
  const discountAmount = Number(order.discountAmount || 0);
  const storeCreditAmount = Number(order.storeCreditAmount || 0);

  const displayOrderNumber = order.orderNumber
    ? order.orderNumber.startsWith("#")
      ? order.orderNumber
      : `#${order.orderNumber}`
    : registrationStatus === "confirming"
      ? "Confirming…"
      : `#ZB${String(order.id).slice(-6).toUpperCase()}`;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground px-4 pt-16 pb-16 font-sans flex flex-col items-center justify-center">
      <div className="w-full max-w-lg space-y-6 flex flex-col">
        <div className="text-center space-y-3">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: "backOut" }}
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl apple-glass-capsule text-emerald-500 mb-1 border border-foreground/10"
          >
            <CheckCircle2 className="w-7 h-7" />
          </motion.div>
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tight">
              {registrationStatus === "failed" ? "Payment Received" : "Order Confirmed!"}
            </h1>
            <p className="text-foreground/50 text-[11px] font-bold tracking-[0.1em] uppercase font-mono inline-flex items-center justify-center gap-1.5">
              {displayOrderNumber}
              {registrationStatus === "confirming" && (
                <Loader2 className="w-3 h-3 animate-spin text-foreground/40" />
              )}
            </p>
          </div>
          <p className="text-foreground/60 text-[12px] font-medium leading-relaxed max-w-[300px] mx-auto">
            {registrationStatus === "failed"
              ? "Your payment went through. We’re finishing order registration — please don’t pay again."
              : registrationStatus === "confirming"
                ? "Payment received. Finalizing your order details…"
                : "Thank you! Your order has been placed successfully and is being prepared."}
          </p>
        </div>

        {registrationStatus === "confirming" && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-foreground/10 bg-foreground/[0.02] text-[11px] text-foreground/60">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            Confirming payment with our servers…
          </div>
        )}

        {registrationStatus === "failed" && registrationError && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] text-[11px] text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <div className="space-y-1">
              <p className="font-semibold text-amber-400">Do not try paying again</p>
              <p className="text-amber-200/80 leading-relaxed">{registrationError}</p>
            </div>
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="apple-glass-capsule px-6 py-5 rounded-2xl border border-foreground/5"
        >
          <div className="flex items-center justify-between pb-3 border-b border-foreground/10">
            <div className="flex items-center gap-2">
              {isCod ? (
                <Banknote className="w-4 h-4 text-foreground/60" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-foreground/60" />
              )}
              <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                {isCod ? "Cash on Delivery" : "Prepaid Order"}
              </span>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-foreground/10 text-foreground border border-foreground/10">
              {isCod ? "Partial COD" : "Paid"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-5 pt-3.5">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-foreground/40">
                Amount Paid Online
              </p>
              <p className="text-lg font-black text-foreground tracking-tight mt-0.5">
                {formatPriceString(upfrontPaid, currency, "en-US")}
              </p>
              <p className="text-[8px] font-semibold text-emerald-500 mt-0.5 inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {registrationStatus === "confirming"
                  ? "Payment received — confirming…"
                  : "Payment Confirmed"}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-foreground/40">
                {isCod ? "Pay at Delivery" : "Remaining Balance"}
              </p>
              <p className="text-lg font-black tracking-tight mt-0.5 text-foreground/70">
                {formatPriceString(balanceDue, currency, "en-US")}
              </p>
              <p className="text-[8px] font-semibold text-foreground/40 mt-0.5">
                {isCod ? "Cash / UPI on Delivery" : "Settled in Full"}
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="apple-glass-capsule p-4 rounded-2xl flex items-center gap-4 border border-foreground/5"
        >
          <div className="w-10 h-10 rounded-xl bg-foreground/[0.03] border border-foreground/5 flex items-center justify-center shrink-0">
            <Calendar className="w-4 h-4 text-foreground/50" />
          </div>
          <div>
            <p className="text-[8px] uppercase tracking-[0.1em] text-foreground/40 font-black mb-0.5">
              Estimated Delivery
            </p>
            <p className="font-bold text-[13px] tracking-tight">
              {arrivalDate.toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        </motion.div>

        <div className="apple-glass-capsule p-5 rounded-2xl space-y-4 border border-foreground/5">
          <div className="flex items-center justify-between border-b border-foreground/5 pb-2.5">
            <h2 className="text-[11px] font-black uppercase tracking-[0.1em] text-foreground/80 flex items-center gap-1.5">
              <ShoppingBag className="w-3.5 h-3.5 text-foreground/50" /> Items & Billing Summary
            </h2>
            <Link
              href="/orders"
              className="text-[8px] text-foreground/50 hover:text-foreground transition-colors font-bold uppercase tracking-widest underline underline-offset-4"
            >
              View All Orders
            </Link>
          </div>

          <div className="space-y-2.5">
            {order.items?.map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center text-[11px] font-medium py-1">
                <span className="text-foreground/75 truncate max-w-[220px]">
                  {item.quantity}x {item.title} {item.size ? `(Size: ${item.size})` : ""}
                </span>
                <span className="font-bold text-foreground">
                  {formatPriceString(Number(item.price) * (item.quantity || 1), currency, "en-US")}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-foreground/5 space-y-2 text-[11px]">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-foreground/70">Subtotal</span>
              <span className="font-bold text-foreground">{formatPriceString(subtotalPrice, currency, "en-US")}</span>
            </div>

            {discountAmount > 0 && (
              <div className="flex justify-between items-center">
                <span className="font-semibold text-foreground/70">Discount {order.discountCode ? `(${order.discountCode})` : ""}</span>
                <span className="font-semibold text-emerald-500">-{formatPriceString(discountAmount, currency, "en-US")}</span>
              </div>
            )}

            {storeCreditAmount > 0 && (
              <div className="flex justify-between items-center">
                <span className="font-semibold text-foreground/70">Store Credit Applied</span>
                <span className="font-semibold text-emerald-500">-{formatPriceString(storeCreditAmount, currency, "en-US")}</span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <span className="font-semibold text-foreground/70">Shipping</span>
              <span className="text-foreground font-bold uppercase text-[9px] tracking-wider">FREE</span>
            </div>

            <div className="pt-2 border-t border-foreground/10 flex justify-between items-center text-xs">
              <span className="font-bold uppercase tracking-widest text-foreground">
                Total
              </span>
              <span className="text-base font-black tracking-tight text-foreground">
                {formatPriceString(totalPrice, currency, "en-US")}
              </span>
            </div>

            {Number(order.storeCreditEarned || 0) > 0 && (
              <div className="flex justify-between items-center pt-1 border-t border-foreground/5">
                <span className="font-semibold text-foreground">
                  Store Credit Earned
                  {order.discountCode ? ` (${order.discountCode})` : ""}
                </span>
                <span className="font-semibold text-emerald-500">+{formatPriceString(Number(order.storeCreditEarned), currency, "en-US")}</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2.5 pt-1">
          <Link
            href="/"
            className="block w-full py-3.5 bg-foreground text-background text-center rounded-xl text-[10px] font-bold uppercase tracking-[0.15em] hover:opacity-90 active:scale-[0.98] transition-all shadow-md"
          >
            Continue Shopping
          </Link>
          <button
            onClick={() => router.push("/orders")}
            className="w-full py-3 border border-dashed border-foreground/20 rounded-xl text-[9px] font-bold uppercase tracking-[0.1em] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.02] transition-all"
          >
            Track Order Status
          </button>
        </div>
      </div>
    </div>
  );
}
