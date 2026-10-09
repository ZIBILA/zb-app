"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { 
  CheckCircle2, 
  Package, 
  Truck, 
  Calendar, 
  ArrowLeft, 
  Loader2, 
  Banknote, 
  CreditCard, 
  ShieldCheck, 
  DollarSign, 
  Tag, 
  ShoppingBag,
  Sparkles
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
  META_PENDING_POLL_INTERVAL_MS,
  META_PENDING_POLL_MAX,
} from "@/lib/meta/browser-purchase";
import { useOpenAiEvents } from "@/hooks/useOpenAiEvents";
import { toMinorUnits } from "@/lib/openaiPixel";
import { trackStorefrontEvent } from "@/lib/track-client";
import { trackPurchase as zbTrackPurchase } from "@/lib/analytics-tracker";
import { formatPriceString } from "@/lib/global-pricing-client";
import { resetGuestIdentity } from "@/lib/metaPixel";

export default function OrderConfirmationPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<"not_found" | "unauthorized" | null>(null);
  const [purchasedPixel, setPurchasedPixel] = useState(false);
  const { trackPurchase } = useMetaEvents();
  const { trackPurchase: trackSnapPurchase } = useSnapEvents();
  const { trackOrderCreated: trackOpenAiOrderCreated } = useOpenAiEvents();
  const guestResetDeferredRef = useRef(false);

  useEffect(() => {
    if (order) {
      const storageKey = `meta_purchase_fired_${order.id}`;
      // Prevent duplicate events across sessions/tabs and prevent re-firing on stale order receipts
      const alreadyFired = typeof window !== 'undefined'
        ? (localStorage.getItem(storageKey) === 'true' || sessionStorage.getItem(storageKey) === 'true')
        : false;
      const orderAgeHours = order.createdAt
        ? (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60)
        : 0;
      const isFreshOrder = orderAgeHours < 24;

      if (!alreadyFired && isFreshOrder) {
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(storageKey, 'true');
            sessionStorage.setItem(storageKey, 'true');
          } catch {}
        }

        const val = parseFloat(order.totalPrice || "0");
        const orderCurrency = (order.currency || "INR").toUpperCase();

        // FIX 2: Prefer Shopify variant ID for Snap catalog/DPA matching.
        // OrderItem.sku often holds 'variant:NUMERIC_ID' or the raw Shopify variant ID.
        // Strip prefixes/GIDs to extract the trailing numeric ID.
        const toSnapId = (item: any): string => {
          const raw = item.sku || item.variantId || item.productId || '';
          const s = String(raw);
          // Strip 'variant:' prefix if present
          const stripped = s.startsWith('variant:') ? s.slice(8) : s;
          // Strip gid://shopify/ProductVariant/ prefix and extract trailing numeric ID
          const m = stripped.match(/(\d+)\s*$/);
          return m ? m[1] : stripped;
        };
        const contentIds = order.items?.map(toSnapId) || [];

        let userData: any = undefined;
        try {
          const addr = order.shippingAddress
            ? (typeof order.shippingAddress === 'string'
              ? JSON.parse(order.shippingAddress)
              : order.shippingAddress)
            : null;

          const cust = order.customer || {};
          // Placeholder names / emails / dummy phones are skipped for the next real value.
          const nameToUse = pickRealName(cust.name, addr?.name) || "";
          const nameParts = nameToUse.trim().split(/\s+/);
          const fn = nameParts[0] || undefined;
          const ln = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;

          userData = {
            country: addr?.country || undefined,
            st: addr?.state || undefined,
            ct: addr?.city || undefined,
            zp: addr?.zip || undefined,
            fn,
            ln,
            em: pickRealEmail(cust.email, addr?.email),
            ph: pickRealPhone(cust.phone, addr?.phone),
          };
        } catch (e) {
          console.error("Error parsing shippingAddress in confirmation page", e);
        }

        let storedCategory = undefined;
        if (typeof window !== 'undefined') {
          storedCategory = sessionStorage.getItem(`order_categories_${order.id}`) || undefined;
        }

        // Meta: the browser Pixel Purchase is decided separately (effect below) so a
        // pending payment never consumes its once-only marker.
        // GA4 purchase stays exactly as on main: fired here, on the first visit to a
        // fresh order, with the same value / currency / items, independent of Meta.
        ga4Purchase(order.id, val, orderCurrency, contentIds, storedCategory,
          order.items?.map((item: any) => ({
            id: toSnapId(item),
            quantity: item.quantity || 1,
            item_price: parseFloat(item.price || "0"),
            title: item.title
          })) || []);

        // Snap: the browser Pixel PURCHASE is decided separately (effect below), like
        // Meta, so a visit while the payment is pending never loses it.

        // OpenAI Ads — order_created with minor-unit amounts
        const openAiContents = order.items?.map((item: any) => ({
          id: toSnapId(item),
          name: item.title,
          content_type: 'product' as const,
          quantity: item.quantity || 1,
          amount: toMinorUnits(parseFloat(item.price || '0'), orderCurrency),
          currency: orderCurrency,
        })) || [];
        trackOpenAiOrderCreated(order.id, val, orderCurrency, openAiContents, userData);

        zbTrackPurchase(order.id, val, { num_items: contentIds.length, currency: orderCurrency });

        // FIX 1b: After a guest purchase, reset identity so the next guest
        // on this device gets a fresh external_id and no stale PII cookies.
        // While the Meta Purchase is still to fire (now, or once payment capture is
        // confirmed), the reset is deferred until after it, so the Pixel event keeps
        // the shopper's own external_id.
        if (!session?.user) {
          if (decideMetaBrowserPurchase(order, { alreadySent: hasMetaBrowserPurchaseBeenSent(order.id) }).action !== 'done') {
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
        const eventName = isCod ? "COD Order Placed" : "Purchase Completed";

        trackStorefrontEvent(eventName, {
          customerId: order.customerId || null,
          customerPhone: order.customerPhone || order.customer?.phone || null,
          orderId: order.id,
          metadata: {
            value: val,
            currency: orderCurrency,
            content_ids: order.items?.map((item: any) => item.productId || item.variantId) || [],
            num_items: order.items?.length || 0,
            paymentMethod: order.paymentMethod
          }
        });
      }
    }
  }, [order, purchasedPixel]);

  // Meta browser Pixel Purchase: fires once per order, only for a confirmed payment.
  // The once-only marker is written AFTER the Pixel call (lib/meta/browser-purchase),
  // so a visit while the payment is pending never suppresses the later paid event.
  useEffect(() => {
    if (!order?.id) return;
    const decision = decideMetaBrowserPurchase(order, { alreadySent: hasMetaBrowserPurchaseBeenSent(order.id) });
    const finishGuestReset = () => {
      if (guestResetDeferredRef.current && !session?.user) {
        guestResetDeferredRef.current = false;
        resetGuestIdentity();
      }
    };
    if (decision.action === 'wait') return;
    if (decision.action === 'done') { finishGuestReset(); return; }
    const args = buildMetaBrowserPurchaseArgs(order);
    if (!args) { finishGuestReset(); return; }
    let storedCategory: string | undefined;
    try { storedCategory = sessionStorage.getItem(`order_categories_${order.id}`) || undefined; } catch {}
    dispatchMetaBrowserPurchaseOnce(order.id, async () => {
      // Wait (≤ 3 s, like withFbq) for the Pixel to load. If it never does (blocked by
      // an extension, failed to load) the order is NOT marked as sent, so a later
      // visit can retry. The server CAPI Purchase is sent regardless.
      if (!(await waitForFbq())) return false;
      // { ga: false }: GA4 purchase is fired by the legacy block above, as on main.
      trackPurchase(args.orderId, args.value, args.currency, args.contentIds, args.userData, storedCategory, args.contents, { ga: false });
      return true;
    }).finally(finishGuestReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  // A guest reset postponed for a pending Meta Purchase must still happen if the
  // shopper leaves first (tab closed, navigated away), so a shared device never
  // keeps the previous shopper's identity cookies.
  useEffect(() => {
    const flush = () => {
      if (guestResetDeferredRef.current) {
        guestResetDeferredRef.current = false;
        resetGuestIdentity();
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  // Snap browser Pixel PURCHASE: fires once per order, only for a confirmed payment
  // (also after pending → paid). The CAPI PURCHASE is sent once by the server
  // (lib/snap/purchase.ts); client_dedup_id = order id dedups the pair.
  useEffect(() => {
    if (!order?.id) return;
    if (decideSnapBrowserPurchase(order, { alreadySent: hasSnapBrowserPurchaseBeenSent(order.id) }).action !== 'fire') return;
    const val = parseFloat(order.totalPrice || "0");
    const orderCurrency = (order.currency || "INR").toUpperCase();
    let addr: any = null;
    try {
      addr = order.shippingAddress
        ? (typeof order.shippingAddress === 'string' ? JSON.parse(order.shippingAddress) : order.shippingAddress)
        : null;
    } catch { addr = null; }
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
      ph: pickRealPhone(cust.phone, addr?.phone),
    };
    const snapContents = (order.items || []).map((item: any) => ({
      id: snapCatalogIdFromOrderItem(item) || "",
      quantity: Number(item.quantity) || 1,
      item_price: parseFloat(item.price || "0") || undefined,
    }));
    let storedCategory: string | undefined;
    try { storedCategory = sessionStorage.getItem(`order_categories_${order.id}`) || undefined; } catch {}
    dispatchSnapBrowserPurchaseOnce(order.id, async () => {
      // Snap pixel never loaded (blocked / failed): not marked, a later visit can retry.
      if (!(await waitForSnaptr())) return false;
      trackSnapPurchase(
        order.id, val, orderCurrency,
        snapContents.map((c: any) => c.id).filter(Boolean),
        userData, storedCategory, snapContents
      );
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  // Payment still awaiting capture (e.g. Razorpay webhook not processed yet):
  // re-check the stored order for a few minutes so the Purchase can fire once paid.
  useEffect(() => {
    if (!id || !order?.id) return;
    const metaWaits = decideMetaBrowserPurchase(order, { alreadySent: hasMetaBrowserPurchaseBeenSent(order.id) }).action === 'wait';
    const snapWaits = decideSnapBrowserPurchase(order, { alreadySent: hasSnapBrowserPurchaseBeenSent(order.id) }).action === 'wait';
    if (!metaWaits && !snapWaits) return;
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
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch(`/api/orders/${id}?bypass_auth=true`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json().catch(() => null);
        const next = data?.order || data;
        if (next?.id && String(next.paymentStatus || '') !== String(order.paymentStatus || '')) setOrder(next);
      } catch {
        /* transient — next tick retries */
      }
    }, META_PENDING_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, order?.id, order?.paymentStatus]);

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        // Always request confirmation bypass — Razorpay callbacks / new contexts
        // often lack last_placed_order_id in sessionStorage.
        const res = await fetch(`/api/orders/${id}?bypass_auth=true`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setOrder(data.order || data);
          setFetchError(null);
          try {
            sessionStorage.setItem("last_placed_order_id", String(id));
          } catch {
            /* ignore */
          }
        } else if (res.status === 401 || res.status === 403) {
          setFetchError("unauthorized");
        } else {
          setFetchError("not_found");
        }
      } catch (e) {
        console.error("Error fetching order", e);
        setFetchError("not_found");
      } finally {
        setLoading(false);
      }
    };

    if (id) fetchOrder();
  }, [id]);

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
          <Link href="/profile?tab=orders" className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors underline">
            My Orders
          </Link>
          <Link href="/" className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors underline">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  const arrivalDate = new Date();
  arrivalDate.setDate(arrivalDate.getDate() + 5);

  const rawMethod = (order.paymentMethod || '').toLowerCase();
  const isCod = order.isCod || rawMethod === 'cod' || rawMethod.includes('cash');
  const totalPrice = Number(order.totalPrice || 0);
  const upfrontPaid = isCod ? (Number(order.codUpfrontPaid) || 0) : totalPrice;
  const balanceDue = isCod ? Math.max(0, totalPrice - upfrontPaid) : 0;
  const currency = order.currency || "INR";

  const subtotalPrice = Number(order.subtotalPrice || (order.items || []).reduce((sum: number, item: any) => sum + (Number(item.price) * (item.quantity || 1)), 0));
  const discountAmount = Number(order.discountAmount || 0);
  const storeCreditAmount = Number(order.storeCreditAmount || 0);

  const displayOrderNumber = order.orderNumber 
    ? (order.orderNumber.startsWith('#') ? order.orderNumber : `#${order.orderNumber}`)
    : (order.shopifyOrderId && !order.shopifyOrderId.startsWith('app_pending_') 
        ? (order.shopifyOrderId.startsWith('#') ? order.shopifyOrderId : `#${order.shopifyOrderId}`)
        : `#ZB${order.id.slice(-6).toUpperCase()}`);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground px-4 pt-16 pb-16 font-sans flex flex-col items-center justify-center">
      <div className="w-full max-w-lg space-y-6 flex flex-col">
        {/* Hero Success */}
        <div className="text-center space-y-3">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: "backOut" }}
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-500 mb-1 border border-emerald-500/20 shadow-lg shadow-emerald-500/10"
          >
            <CheckCircle2 className="w-7 h-7" />
          </motion.div>
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tight">Order Confirmed!</h1>
            <p className="text-foreground/50 text-[11px] font-bold tracking-[0.1em] uppercase font-mono">
              {displayOrderNumber}
            </p>
          </div>
          <p className="text-foreground/60 text-[12px] font-medium leading-relaxed max-w-[300px] mx-auto">
            Thank you! Your order has been placed successfully and is being prepared.
          </p>
        </div>

        {/* Payment & Amount Summary Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-5 rounded-2xl border shadow-sm ${
            isCod 
              ? "bg-amber-500/[0.04] border-amber-500/20" 
              : "bg-emerald-500/[0.04] border-emerald-500/20"
          }`}
        >
          <div className="flex items-center justify-between pb-3 border-b border-foreground/10">
            <div className="flex items-center gap-2">
              {isCod ? (
                <Banknote className="w-4 h-4 text-amber-500" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
              )}
              <span className="text-[11px] font-bold uppercase tracking-wider">
                {isCod ? "Cash on Delivery" : "Prepaid Order"}
              </span>
            </div>
            <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full ${
              isCod ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-500"
            }`}>
              {isCod ? "Partial COD" : "Paid"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-3.5">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-foreground/40">Amount Paid Online</p>
              <p className="text-lg font-black text-emerald-500 tracking-tight mt-0.5">
                {formatPriceString(upfrontPaid, currency, "en-US")}
              </p>
              <p className="text-[8px] font-semibold text-emerald-500/80 mt-0.5">✓ Payment Confirmed</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-foreground/40">
                {isCod ? "Pay at Delivery" : "Remaining Balance"}
              </p>
              <p className={`text-lg font-black tracking-tight mt-0.5 ${
                isCod ? "text-amber-500" : "text-foreground/50"
              }`}>
                {formatPriceString(balanceDue, currency, "en-US")}
              </p>
              <p className="text-[8px] font-semibold text-foreground/40 mt-0.5">
                {isCod ? "Cash / UPI on Delivery" : "Settled in Full"}
              </p>
            </div>
          </div>
        </motion.div>

        {/* ETA Section */}
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
            <p className="text-[8px] uppercase tracking-[0.1em] text-foreground/40 font-black mb-0.5">Estimated Delivery</p>
            <p className="font-bold text-[13px] tracking-tight">{arrivalDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </motion.div>

        {/* Order Details & Full Billing Breakdown */}
        <div className="apple-glass-capsule p-5 rounded-2xl space-y-4 border border-foreground/5">
          <div className="flex items-center justify-between border-b border-foreground/5 pb-2.5">
            <h2 className="text-[11px] font-black uppercase tracking-[0.1em] text-foreground/80 flex items-center gap-1.5">
              <ShoppingBag className="w-3.5 h-3.5 text-amber-500" /> Items & Billing Summary
            </h2>
            <Link href="/orders" className="text-[8px] text-foreground/50 hover:text-foreground transition-colors font-bold uppercase tracking-widest underline underline-offset-4">View All Orders</Link>
          </div>
          
          {/* Line items */}
          <div className="space-y-2.5">
            {order.items?.map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center text-[11px] font-medium py-1">
                <span className="text-foreground/75 truncate max-w-[220px]">
                  {item.quantity}x {item.title} {item.size ? `(Size: ${item.size})` : ''}
                </span>
                <span className="font-bold text-foreground">
                  {formatPriceString(Number(item.price) * (item.quantity || 1), currency, "en-US")}
                </span>
              </div>
            ))}
          </div>

          {/* Pricing Breakdown */}
          <div className="pt-3 border-t border-foreground/5 space-y-2 text-[11px]">
            <div className="flex justify-between items-center text-foreground/60">
              <span>Subtotal</span>
              <span className="font-bold">{formatPriceString(subtotalPrice, currency, "en-US")}</span>
            </div>

            {discountAmount > 0 && (
              <div className="flex justify-between items-center text-emerald-500 font-semibold">
                <span>Discount {order.discountCode ? `(${order.discountCode})` : ''}</span>
                <span>-{formatPriceString(discountAmount, currency, "en-US")}</span>
              </div>
            )}

            {storeCreditAmount > 0 && (
              <div className="flex justify-between items-center text-purple-400 font-semibold">
                <span>Store Credit Applied</span>
                <span>-{formatPriceString(storeCreditAmount, currency, "en-US")}</span>
              </div>
            )}

            <div className="flex justify-between items-center text-foreground/60">
              <span>Shipping</span>
              <span className="text-emerald-500 font-bold uppercase text-[9px] tracking-wider">FREE</span>
            </div>

            <div className="pt-2 border-t border-foreground/10 flex justify-between items-center text-xs">
              <span className="font-black uppercase tracking-widest text-foreground">Total Order Amount</span>
              <span className="text-base font-black tracking-tight text-foreground">{formatPriceString(totalPrice, currency, "en-US")}</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
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
