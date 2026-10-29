# Payment System Audit — zicabella.com (Razorpay Standard Checkout)

**Date:** 2026-10-29 · **Code audited:** `a658403c` on `perf-audit` (identical content to `origin/main` `088c4786`, i.e. the code that is live) · **Hosting:** DigitalOcean App Platform behind Cloudflare, `zicabella.com` and `app.zicabella.com` both resolve to the same app.

**Gateway correction:** the brief names Cashfree. The codebase contains **no Cashfree integration at all** (zero references). The live gateway is **Razorpay Standard Checkout** (`checkout.razorpay.com/v1/checkout.js`), so every "Cashfree" item in the brief was audited against Razorpay and its official documentation.

**What this audit is based on**

| Evidence source | Status |
|---|---|
| Full code trace of the web checkout, pre-create, completion, cancel, recovery, both webhook endpoints, crons, Shopify sync, pay-link and native-app routes | Done (read-only) |
| Razorpay official documentation (65 pages: orders, checkout options, callback/redirect, in-app browsers, signature, capture, late authorisation, webhooks, errors, test mode) | Done |
| Executed tests through the **real route handlers** with an in-memory database and faked Razorpay/Shopify HTTP (existing harness `scripts/payment-e2e/run.ts` + 10 new audit scenarios) | Done — results in §11 |
| Live, non-destructive probes of the production site (page fetch timings, CSP, Razorpay script tag, webhook endpoints with an unsigned empty body, Lighthouse) | Done — §7, §8 |
| Production database, DigitalOcean logs, Razorpay Dashboard (transactions, webhook config, capture setting) | **No access** — every claim that needs them is marked SUSPECTED / UNVERIFIED and comes with the exact query or dashboard check to run (§4, §5, §13) |
| Real payments, test-mode keys, logged-in session on localhost | Not used / not available (no real charges were made) |

**Evidence legend:** `CONFIRMED (test)` = reproduced by executing the real handler · `CONFIRMED (code)` = unambiguous in the source · `CONFIRMED (live)` = observed on production without side effects · `SUSPECTED` = mechanism shown, frequency/live state unknown · `UNVERIFIED` = cannot be established without the missing evidence.

---

## Direct answers to the key questions

**1. Is there any confirmed technical issue preventing customers from completing payments?**
No single confirmed defect blocks *all* payments: the happy path (pre-create → modal → `/api/checkout/complete` → capture check → order → Shopify) works end-to-end in the executed tests, the live pre-create/complete/webhook endpoints respond, the Razorpay script is preloaded, and the CSP allows every Razorpay origin. What is confirmed is a set of defects that block or silently break payment for **subsets** of customers:
- **Per-IP rate limits on the two checkout APIs (30/min) with prefetch-on-every-change and 4-second pending-capture polling** (`CONFIRMED (code)`, frequency `UNVERIFIED`). Shoppers behind a shared mobile-carrier IP (CGNAT, very common on Indian mobile networks) share one bucket; the shopper sees "Too many requests" on Pay or the post-payment poll dies.
- **A failed attempt followed by a successful retry leaves the order `paid` but `status FAILED`, which the customer's order list hides** (`CONFIRMED (test)` S3). The customer paid, Shopify got the order, "My Orders" shows nothing → reported as "payment failed".
- **The confirmation page reports "Order Confirmed" for orders that were never paid or never registered** (`CONFIRMED (test)` S7) — the opposite failure: customers who did *not* pay are told they did.
- **Critical error messages auto-dismiss after 4 seconds, including "do NOT pay again"** (`CONFIRMED (code)`), and the Pay button then looks enabled while a lock keeps it dead.
- **No in-app-browser handling (Instagram / Facebook / WebView).** The checkout always opens the modal with `redirect: false`; Razorpay's documentation states those browsers do not support the iframe flow and require the callback-URL redirect flow, and that only UPI Intent and Cards are shown there. This is the single most likely explanation for "some customers cannot pay" given the store's Meta/Snap ad traffic, but it is `SUSPECTED` — it needs a real device check (§6, §12).

**2. Is there evidence that some customers are failing to pay even though others can?**
There is no historical data available to this audit (no DB/logs/Razorpay dashboard), so there is no *measured* evidence. The code gives four channel-/situation-specific mechanisms that would produce exactly that pattern: in-app browsers (above), shared-IP rate limiting, a possible key-source mismatch between pre-create (environment keys) and verification (dashboard-stored keys preferred) which would fail **every web** payment at verification while the **mobile app** keeps working (`SUSPECTED`, §3), and international/currency handling (`SUSPECTED`). §4 gives the queries that turn these into numbers.

**3. Are customers potentially being charged without receiving a properly created order?**
Yes — confirmed paths exist, all with money captured:
- Prefetch/Pay race: the paid Razorpay order is not the one the local order points at; `/complete` never re-points it; the later webhook's recovery crashes on the unique `razorpayPaymentId` (`CONFIRMED (test)` S8: HTTP 500, "CRITICAL: order recovery failed", Razorpay would retry for 24 h generating repeated alerts).
- Any exception in `/complete` after the capture check returns a raw 500 and the customer is told "payment successful but there was an issue registering your order" (`CONFIRMED (code)`); recovery then depends on the webhook/cron.
- Webhook arrives with no local order (WebStoreOrder insert failure is swallowed at pre-create, pay-link flow, race above): a placeholder order with a dummy address and a "WEBHOOK-RECOVERED-PLACEHOLDER" line item is created and the **customer is emailed/WhatsApped a confirmation for an "Unresolved order"** (`CONFIRMED (code)`).
- Webhook-first completion (UPI commonly) syncs the **pre-create snapshot with client-sent prices** to Shopify as `paid` (`CONFIRMED (test)` S9).

**4. Are any failed or pending payments being incorrectly handled?**
Yes:
- Unpaid orders are surfaced as confirmed (S7); paid orders are hidden as failed (S3).
- Captured amount is never compared with the order total in either webhook: ₹100 captured on a ₹3,797 order → `paid`, Shopify `paid` (`CONFIRMED (test)` S4/S4b).
- `/api/checkout/cancel` is unauthenticated and flips any unpaid order by Razorpay order id (`CONFIRMED (test)` S6).
- Concurrent duplicate webhook deliveries are both processed (two `Payment` rows) because de-duplication is check-then-insert on a LIKE scan with no unique key (`CONFIRMED (test)` S5).
- The second webhook endpoint swallows processing errors and still answers 200, so Razorpay never retries and nothing replays the event (`CONFIRMED (code)`).
- Authorised-but-never-captured payments leave the local order `payment_pending` forever; the cron only closes the `WebStoreOrder` row, never the `Order` (`CONFIRMED (code)`).
- Razorpay API outage during `/complete` → 202 "pending capture", customer polls 3 minutes, then the page stalls on a spinner with no instruction (`CONFIRMED (test)` S10 + code).
- Correctly handled (verified): `payment.authorized` never marks paid; late `payment.failed` never downgrades a paid order; signature uses the server's order id with a constant-time compare; capture + order binding + refund check before "paid"; one Shopify order per internal number via claim + `Idempotency-Key`.

**5. What evidence do we have about the actual payment success rate?**
None inside this audit. The code persists enough to compute it (`Order`, `web_store_orders`, `WebhookEvent`, `AnalyticsEvent` "Checkout Started"/"Payment Initiated", `RateLimitLog`, `EmailLog`), and §4/§5 give the 14 read-only SQL queries plus the Razorpay-dashboard checks. Note two blind spots: attempts that fail before a webhook (wrong key, in-app browser, 429 on Pay) leave **no local trace**; only Razorpay's Transactions export has them.

**6. What remains unverified?** §12 and §13 list everything; the top items are: the Razorpay dashboard webhook URL(s), secret and events (the documented URL `/api/razorpay/webhook` returns **404 live**; the real handlers are `/api/webhooks/razorpay` and `/api/payments/webhook`, both reachable and fail-closed; the production webhook secret **is** configured, as the second endpoint answers "Invalid webhook signature" rather than "not configured"); dashboard auto-capture setting; whether `Shop.razorpayKeyId/Secret` in the DB equals the environment keys; actual in-app-browser behaviour on a device; 429 counts; failure-reason mix.

**7. What needs to be fixed first to reduce customer payment failures?** (details §10)
1. In-app browser detection → open Razorpay in redirect mode (`redirect: true` + existing `callback_url`) for Instagram/Facebook/WebView user agents; keep modal mode elsewhere.
2. Rate limiting: key on the real client IP **plus** session/customer, exempt the pending-capture poll (per-order token), stop creating a new Razorpay order on every field change.
3. Confirmation truthfulness: `by-razorpay`/`/checkout/success`/confirmation must honour `paymentStatus`; never show "Order Confirmed" for unpaid/unregistered; keep critical messages on screen; clear the cart on the callback path.
4. Webhooks and crons: map `FAILED/payment_failed/cancelled` → `approved/open` on capture; amount check in both webhooks; unique event key; ack before Shopify sync; webhook #2 must return 500 on error (or retire it); cron closes `Order` rows too.
5. Money integrity (revenue, not conversion, but Critical): recompute coupon discount/cashback server-side, reprice at pre-create, make `/complete` idempotent and transactional, re-point `razorpayOrderId` when the paid order differs.

None of these has been applied yet — every one touches live payment behaviour, so per the brief I am asking before changing anything (§10).

---

## 1. Overall payment system health

**Verdict: functional core, fragile edges.** The integration follows Razorpay's documented Standard Checkout correctly on the parts that matter most for safety: server-side order creation, HMAC-SHA256 signature over `order_id|payment_id` with a constant-time compare, a server-side capture confirmation (status `captured`, `captured: true`, `amount_refunded: 0`, `order_id` match) before any "paid" state, a 202 "pending capture" design for authorised-only payments, raw-body webhook signature verification that fails closed, idempotent Shopify order creation, and a 15-minute reconciliation cron. The executed end-to-end suite (9 web scenarios in the existing harness + 10 audit scenarios) completed every happy path and every "must not" (no paid state without capture, no downgrade on late failure, one Shopify order per payment).

The weaknesses cluster in four places:
1. **Trust boundary** — the browser's prices, coupon amounts and cashback are trusted (Critical, revenue).
2. **State truthfulness** — the customer can be told the opposite of what happened in both directions (High, conversion + support load).
3. **Capacity/compat edges** — per-IP limits and no in-app-browser mode (High, "some customers cannot pay").
4. **Operational blind spots** — documented webhook URL is wrong, two divergent webhook handlers, no event-id de-duplication, no alerting on under-capture (Medium).

No evidence was found of a configuration that breaks all payments. The live site serves the checkout shell in ~0.1 s TTFB with the Razorpay SDK preloaded (§8).

---

## 2. Confirmed payment bugs

Severity: **Critical** = money or orders wrong at scale · **High** = customers blocked or misled · **Medium** = subset/edge or operational · **Low** = hygiene.

| # | Sev | Issue | Where (file:line) | Scenario | Evidence |
|---|---|---|---|---|---|
| P1 | Critical | Coupon discount amount and cashback are client-trusted; ₹1 and ₹0 "paid" orders possible | `app/api/checkout/complete/route.ts:47-48, 62-103, 253-274, 1104-1133`; `app/api/checkout/razorpay/route.ts:75-126` | Active code + `couponDiscount = subtotal−1` → pay ₹1 → `paid`, Shopify `paid`. `paymentMethod: 'coupon'` + `couponDiscount = subtotal` → `paid` with **no payment**. `cashbackAmount: 5000` → ₹5,000 store credit minted | CONFIRMED (test) S1a/S1b/S1c |
| P2 | Critical | Pre-create charges client-sent prices; webhook-first completion syncs that snapshot to Shopify as paid | `app/api/checkout/razorpay/route.ts:128-149, 183-190, 365-410`; `app/api/webhooks/razorpay/route.ts:234-250`; `lib/services/shopifyOrderSyncService.ts:531-561` | Items priced ₹1 by the client → Razorpay order for ₹2 → UPI webhook beats `/complete` → local order `paid`, Shopify order `paid` with a ₹2.00 transaction, inventory decremented | CONFIRMED (test) S9 |
| P3 | High | Neither webhook compares the captured amount with the order total | `app/api/webhooks/razorpay/route.ts:103-140`; `app/api/payments/webhook/route.ts:147-167` (`minRupees: 0` for prepaid) | ₹100 captured on a ₹3,797 order → `paid`, Shopify `paid`, no note, no alert | CONFIRMED (test) S4, S4b |
| P4 | High | `/api/checkout/complete` is replayable and non-transactional | `complete/route.ts:501-518` (no short-circuit), `774-787` (items replaced), `1091-1101`, `1104-1133` | Same signed body ×3 → coupon `usedCount` +3, **3 cashback credits**, 3 confirmation emails; re-post with different `items` after payment → local order items rewritten (Shopify untouched) | CONFIRMED (test) S2 |
| P5 | High | Failed attempt + successful retry (webhook-first) → `paymentStatus paid` with `status FAILED`; hidden from the customer | `webhooks/razorpay/route.ts:129` (status map lacks `FAILED/payment_failed/failed`), `:354-361`; `payments/webhook/route.ts:175, 372`; `app/api/orders/route.ts:70-88` hides it; cron skips once WSO is paid | Card declined → retry succeeds → browser never completes (app switch, 500) → shopper paid, Shopify order exists, "My Orders" empty | CONFIRMED (test) S3 |
| P6 | High | Confirmation shown for unpaid / unregistered orders | `app/api/orders/by-razorpay/route.ts:22-51` returns the id for any `paymentStatus`; `app/orders/[id]/confirmation/page.tsx:479-513` marks `registrationStatus = "confirmed"` without reading it; same in `app/checkout/success/page.tsx:116-128` and `app/checkout/page.tsx:2034-2050` | `/complete` fails (400 bad signature / 500) → fallback by-razorpay → green check, "Order Confirmed!", "Paid" badge, GA4 purchase, while the DB row is `pending` | CONFIRMED (test) S7 + code |
| P7 | High | Prefetch/Pay race → paid Razorpay order unlinked; `/complete` never rewrites `razorpayOrderId`; recovery hits unique `razorpayPaymentId` | `app/checkout/page.tsx:1042-1048, 1797-1855`; `complete/route.ts:503-511, 706-751`; `prisma/schema.prisma:300-301`; `lib/services/razorpayRecoveryService.ts:204-235` | Local order still points at order A, customer paid order B → `/complete` 200 but `razorpayOrderId` stays A → webhook for B → Path B recovery → P2002 → **500 + CRITICAL alert**, Razorpay retries for 24 h | CONFIRMED (test) S8 |
| P8 | High | Per-IP rate limit 30/min on pre-create and complete, keyed on raw `x-forwarded-for`; prefetch fires on every payment-method/coupon/address change; pending-capture poll is 15 req/min per shopper | `app/api/checkout/razorpay/route.ts:50`; `complete/route.ts:21`; `lib/rate-limit.ts:163-170`; `app/checkout/page.tsx:1050-1123`; `lib/checkout-complete-client.ts:21-44` | Two or three shoppers behind one carrier IP → 429 "Too many requests" on Pay (shown as the error, then auto-cleared) or the poll loop exits without `paymentState` → fallback → P6 | CONFIRMED (code); frequency UNVERIFIED (`RateLimitLog`, query 13) |
| P9 | High | Cart never cleared on the callback-URL path | `clear()` only in `app/checkout/page.tsx:1741, 1992, 2029, 2044`; `/checkout/success` and the confirmation page never clear it | Redirect-mode completion (needed for in-app browsers, also used when the handler does not fire) → customer sees a paid order **and** a full cart → confusion / duplicate order | CONFIRMED (code) |
| P10 | Medium | Every error auto-dismisses after 4 s, including `CAPTURE_PENDING_MESSAGE` ("do NOT pay again") and "payment successful but… contact support"; Pay looks enabled while the lock stays held | `app/checkout/page.tsx:301-308, 2003-2009` | Customer misses the instruction, taps Pay, nothing happens | CONFIRMED (code) |
| P11 | Medium | Address form resets to the default saved address whenever the session object is replaced (cross-tab broadcast, incl. the page's own "Get App" `target=_blank` links) | `app/checkout/page.tsx:1152-1202` (`useCallback` deps `[status, session]`, effect runs `fetchSavedAddresses(true)`) | Typed/selected address reverts mid-checkout → wrong delivery address or abandonment | CONFIRMED (code) |
| P12 | Medium | Pending-capture flow stalls after 3 minutes with an indefinite spinner; refresh re-posts | `app/orders/[id]/confirmation/page.tsx:330, 423-428`; `lib/checkout-complete-client.ts:21-44` | Razorpay API 5xx/429 during `/complete` → 202 (took 4.6 s with 3 retries) → 3-minute poll → stuck | CONFIRMED (test) S10 + code |
| P13 | Medium | `/api/checkout/cancel` is unauthenticated and accepts any Razorpay/local order id; `/complete` later revives cancelled orders | `app/api/checkout/cancel/route.ts:6-38`; `complete/route.ts:718-719` | Anyone can flip unpaid orders to `cancelled/FAILED` (feeds P5); own-order revival works | CONFIRMED (test) S6 |
| P14 | Medium | Webhook de-duplication is check-then-insert over `payload LIKE %id%` with no unique key; no `x-razorpay-event-id` | `webhooks/razorpay/route.ts:41-62`; `payments/webhook/route.ts:66-87`; `prisma/schema.prisma:554-568` | Two simultaneous deliveries both run Path A → 2 `Payment` rows (Shopify stays single thanks to the sync claim) | CONFIRMED (test) S5 |
| P15 | Medium | Webhook #1 awaits the Shopify order creation (untimed REST with 4 retries) before acknowledging | `webhooks/razorpay/route.ts:234-250`; `lib/shopify-admin.ts:309-344` | Razorpay expects a 2xx within 5 s; slow Shopify → Razorpay treats it as failed → redelivery → P14 | CONFIRMED (code) |
| P16 | Medium | Webhook #2 swallows processing errors and returns 200; event stays `processed=false`, nothing replays it | `app/api/payments/webhook/route.ts:417-420` | DB hiccup during `payment.captured` → order never marked paid by webhook; only the 15-min cron can rescue it | CONFIRMED (code) |
| P17 | Medium | Documented webhook URL does not exist | `README.md:42`, `docs/razorpay-testing.md:56,207`, `app/dashboard/payments/razorpay/page.tsx:145,346` say `/api/razorpay/webhook`; live → **404** on both hosts; real handlers `/api/webhooks/razorpay` (401 unsigned) and `/api/payments/webhook` (400 unsigned) | If the dashboard was configured from the docs, no webhook ever arrives; all handler-miss cases wait for the cron | CONFIRMED (live) for the 404; dashboard state UNVERIFIED |
| P18 | Medium | Key-source asymmetry: pre-create and the key handed to `checkout.js` come from env (`RAZORPAY_KEY_ID` / `NEXT_PUBLIC_RAZORPAY_KEY_ID`), verification prefers DB-stored keys | `app/api/checkout/razorpay/route.ts:23-30, 45-47, 165-180`; `lib/razorpay-credentials.ts:24-62`; `complete/route.ts:294, 321` | If the dashboard-stored key pair differs (rotation, test keys), **every web** payment is captured and then rejected "Invalid payment signature" → P6 masks it; mobile keeps working | CONFIRMED (code) mechanism; live state UNVERIFIED |
| P19 | Medium | Web Razorpay orders omit `payment_capture`; mobile sets it | `app/api/checkout/razorpay/route.ts:183-190` vs `app/api/app/payment/create-order/route.ts:170` | If the dashboard is on manual capture, every web payment goes 202-pending (P12) and auto-refunds | CONFIRMED (code); dashboard setting UNVERIFIED |
| P20 | Medium | `/complete` can return a raw 500 after money was captured; untimed Shopify calls inline (`variants.json`, `createCustomer`) | `complete/route.ts:163-218, 462-495, 1476-1479` | Shopify slowness/outage → Cloudflare 100 s limit or exception → "contact support" message | CONFIRMED (code) |
| P21 | Medium | Mid-payment refresh/back has no resumption; a new checkout session creates a new pending order while the paid one is reconciled only by the webhook | `app/checkout/page.tsx` (`zb_pending_checkout` read only by `/checkout/success`) | UPI app switch → return to a reloaded page → full cart + active Pay → double-payment risk | CONFIRMED (code) |
| P22 | Medium | Abandoned checkouts never close on `Order`; a failed `WebStoreOrder` insert is swallowed, making that checkout invisible to the cron | `app/api/checkout/razorpay/route.ts:449-451`; `lib/services/razorpaySyncService.ts:35-58, 289-292` | `payment_pending` rows accumulate; a captured payment for such a checkout can only be recovered as a placeholder | CONFIRMED (code) |
| P23 | Low | Recovery placeholder emails/WhatsApps the customer an "order confirmed" for an "Unresolved order" with a dummy address | `lib/services/razorpayRecoveryService.ts:204-235, 284-339` | Customer receives a confirmation that does not match what they bought | CONFIRMED (code) |
| P24 | Low | Blank step 1 while `/api/customer/addresses` is pending (no timeout, no spinner); Safari < 16 `AbortSignal.timeout` on pincode lookups | `app/checkout/page.tsx:1159, 2573, 2686` | Slow API → empty checkout; old WebViews → autofill no-op | CONFIRMED (code) |
| P25 | Low | Pay-link flow (`/api/pay/[cartId]`) cannot complete (payment-link signature ≠ order signature, link not bound to the local order); no caller | `app/api/pay/[cartId]/route.ts:174-249` | Dead but reachable; would produce placeholders if used | CONFIRMED (code) |
| P26 | Low | Webhook #1 uses the SDK's non-constant-time signature compare; legacy `/api/razorpay/{create-order,verify-payment}` reachable without auth and writing a different status vocabulary; cron writes prepaid `status: 'open'` vs `'approved'` elsewhere; a new Razorpay order per prefetch | `node_modules/razorpay/dist/utils/razorpay-utils.js:91`; `middleware.ts:194-195`; `lib/services/razorpaySyncService.ts:324, 357` | Hygiene / drift | CONFIRMED (code) |

---

## 3. Potential problems requiring additional evidence

| # | Sev if true | Hypothesis | Why plausible | Evidence needed |
|---|---|---|---|---|
| S1 | **High** | Instagram / Facebook / other in-app browsers cannot pay or lose the success handoff | Code always uses modal mode (`handler` + `callback_url` + `redirect: false`, `app/checkout/page.tsx:2128-2140`) with no user-agent branch (no `Instagram`/`FBAN`/`FBAV`/`wv` detection anywhere). Razorpay docs: in-app browsers "do not support i-frame. Implement a callback URL"; only UPI Intent + Cards appear there; `handler` is not supported in WebView. Ad traffic from Meta/Snap lands in exactly these browsers | Open the live checkout from an Instagram ad on iOS and Android, pay with the test flow (Razorpay test mode) or observe `AnalyticsEvent.browser`/`WebhookEvent` ratios (query 11); Razorpay Transactions filtered by `user_agent` |
| S2 | High | Dashboard webhook misconfigured (wrong URL per docs, wrong secret, missing `order.paid`/`payment.failed`, or disabled after 24 h of failures) | P17; two endpoints with one env secret; Razorpay disables a webhook after 24 h of non-2xx | Razorpay Dashboard → Webhooks; `SELECT "eventType", processed, count(*), max("createdAt") FROM "WebhookEvent" WHERE source='razorpay' GROUP BY 1,2;` — zero recent `payment.captured` rows = no webhooks |
| S3 | High | DB-stored keys ≠ environment keys (P18) | Mechanism confirmed | `SELECT left("razorpayKeyId",14) FROM "Shop";` vs `RAZORPAY_KEY_ID` prefix (never print the secret); `/api/admin/payment-status` → `source`; DO logs for `Signature mismatch for order` |
| S4 | Medium | Manual capture enabled on the dashboard (P19) | Web orders rely on the account default | Dashboard → Settings → Payment capture; DO logs `authorized but not captured`; `SELECT count(*) FROM "Order" WHERE note LIKE '%authorized at checkout%'` |
| S5 | Medium | International orders fail or become `partially_paid` | Razorpay order is created in the display currency (`razorpay/route.ts:182-185`); currencies must be enabled on the account; non-matching country config falls back to INR comparison (`complete/route.ts:136-151`); captured-currency mismatch only logged | Orders with `currency <> 'INR'` and `note LIKE '%UNDERPAID%'`; Shopify 422 on non-INR orders (query 9); pre-create 500s in logs |
| S6 | Medium | 429s actually occurring (P8) | Mechanism confirmed | `SELECT key, count(*) FROM "RateLimitLog" WHERE key LIKE 'checkout-%' GROUP BY 1 ORDER BY 2 DESC;` DO logs `Too many requests` |
| S7 | Medium | Shopify-driven writers overwrite Razorpay-derived payment state | `app/api/shopify/webhooks/route.ts:358` writes raw `financial_status`; `app/api/shopify/sync/route.ts:342` forces `'paid'` for any WSO with `paymentMethod='razorpay'` | Orders whose `paymentStatus` changed without a `WebhookEvent`/`Payment` row |
| S8 | Medium | `priceVerified=false` frequently (Shopify variant fetch failing) → client totals used | `complete/route.ts:191-218` | DO logs `Server-side price verification failed`, `Variant … not found` |
| S9 | Low | `beforeInteractive` `<Script>` in a nested layout | Live HTML has the `<link rel=preload as=script>` but the tag itself is injected on hydration; mitigated by the 12 s wait + inject in `lib/razorpay-checkout-client.ts:18-44` | Field timing of "Payment gateway is still loading" |
| S10 | Low | `MetaConsentGate` banner overlapping Pay in consent regions; prefetch 429 on toggle | UI | Device check |

---

## 4. Historical payment failure analysis

**Not possible from this audit**: no production database, no DigitalOcean logs, no Razorpay Dashboard access, and the code keeps no `PaymentAttempt` table (client-side `payment.failed` reasons are persisted only through `/api/checkout/cancel` → `Order.paymentFailureReason`). Attempts that never reach a webhook (wrong key, in-app browser, 429 on Pay, SDK not loaded) leave **no local trace**; Razorpay's Transactions export (status `failed`, grouped by `error_code`/`error_description`/`method`/`bank`) is the only complete source.

Run these read-only queries (Postgres; `"Order"`, `web_store_orders`, `"WebhookEvent"`, `"Payment"`, `"AnalyticsEvent"`, `"RateLimitLog"`, `"SyncLog"`, `"EmailLog"`):

```sql
-- 1. Checkouts initiated per day (one pre-created order per checkout session)
SELECT date_trunc('day',"createdAt") d, count(*) FROM "Order"
WHERE "orderType"='WEB_STORE' AND "razorpayOrderId" IS NOT NULL AND "createdAt">now()-interval '30 days' GROUP BY 1 ORDER BY 1;
-- 2. Outcome mix
SELECT "paymentStatus", status, count(*) FROM "Order"
WHERE "orderType"='WEB_STORE' AND "createdAt">now()-interval '30 days' GROUP BY 1,2 ORDER BY 3 DESC;
-- 3. Failure reasons (local) 
SELECT "paymentFailureReason", count(*) FROM "Order"
WHERE "paymentStatus" IN ('failed','cancelled') AND "createdAt">now()-interval '30 days' GROUP BY 1 ORDER BY 2 DESC;
-- 3b. Razorpay reasons from webhooks (bank decline vs customer cancel vs gateway)
SELECT payload::jsonb #>> '{payload,payment,entity,error_source}' src, payload::jsonb #>> '{payload,payment,entity,error_step}' step,
       payload::jsonb #>> '{payload,payment,entity,error_reason}' reason, payload::jsonb #>> '{payload,payment,entity,method}' method, count(*)
FROM "WebhookEvent" WHERE source='razorpay' AND "eventType"='payment.failed' AND "createdAt">now()-interval '30 days' GROUP BY 1,2,3,4 ORDER BY 5 DESC;
-- 4. Captured at Razorpay but local order missing/unpaid (charged-without-order)
SELECT w."createdAt", w."eventType", w.payload::jsonb #>> '{payload,payment,entity,order_id}' rzp_order,
       w.payload::jsonb #>> '{payload,payment,entity,id}' pay_id, o.id, o."paymentStatus", o.status
FROM "WebhookEvent" w LEFT JOIN "Order" o ON o."razorpayOrderId" = w.payload::jsonb #>> '{payload,payment,entity,order_id}'
WHERE w.source='razorpay' AND w."eventType" IN ('payment.captured','order.paid')
  AND (o.id IS NULL OR o."paymentStatus" NOT IN ('paid','cod_upfront_paid','partially_paid')) ORDER BY 1 DESC;
-- 5. Recovery placeholders
SELECT id,"internalOrderNumber","razorpayOrderId","razorpayPaymentId","shopifySyncStatus","createdAt" FROM "Order"
WHERE tags LIKE '%RazorpayRecovery%' OR "shopifySyncStatus"='needs_review' ORDER BY "createdAt" DESC;
-- 6. Paid but hidden from the customer (P5)
SELECT id,"internalOrderNumber","paymentStatus",status,"razorpayPaymentId","createdAt" FROM "Order"
WHERE "paymentStatus" IN ('paid','cod_upfront_paid','partially_paid')
  AND (status IN ('FAILED','payment_failed','failed','payment_pending','cancelled') OR "internalOrderNumber" ~ '^ZB(PP|PF)');
-- 7. Pending capture > 1 h (authorised-never-captured or lost webhook)
SELECT id,"internalOrderNumber","razorpayOrderId","razorpayPaymentId","createdAt" FROM "Order"
WHERE "paymentStatus"='payment_pending' AND "razorpayPaymentId" IS NOT NULL AND "createdAt"<now()-interval '1 hour';
-- 8. Order ↔ WebStoreOrder divergence
SELECT o.id,o."internalOrderNumber",o."paymentStatus",w.payment_status,w.order_number FROM "Order" o
JOIN web_store_orders w ON w.razorpay_order_id=o."razorpayOrderId"
WHERE o."paymentStatus"<>w.payment_status OR o."internalOrderNumber"<>w.order_number;
-- 9. Shopify sync failures on paid orders
SELECT id,"internalOrderNumber","paymentStatus","shopifySyncStatus",left("shopifySyncError",120),"createdAt" FROM "Order"
WHERE "paymentStatus" IN ('paid','cod_upfront_paid','partially_paid') AND ("shopifyOrderId" IS NULL OR "shopifyOrderId" !~ '^[0-9]+$') ORDER BY "createdAt" DESC;
-- 10. Underpaid / currency
SELECT id,"internalOrderNumber",currency,"totalPrice",note FROM "Order" WHERE note LIKE '%UNDERPAID%';
-- 11. Webhook health and lost events
SELECT "eventType", processed, count(*), max("createdAt") FROM "WebhookEvent" WHERE source='razorpay' GROUP BY 1,2;
SELECT count(*) FROM "WebhookEvent" WHERE source='razorpay' AND processed=false AND "createdAt"<now()-interval '10 minutes';
-- 12. Cron liveness
SELECT action,status,"createdAt",left(payload,200) FROM "SyncLog" WHERE action LIKE 'CRON_PING%' ORDER BY "createdAt" DESC LIMIT 10;
-- 13. Rate-limit pressure (P8)
SELECT key, count(*) FROM "RateLimitLog" WHERE key LIKE 'checkout-%' GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
-- 14. Device / browser split of "Payment Initiated" vs paid
SELECT a.device_type, a.browser, a.os, count(*) initiated,
       count(o.id) FILTER (WHERE o."paymentStatus" IN ('paid','cod_upfront_paid')) paid
FROM "AnalyticsEvent" a LEFT JOIN "Order" o ON o.id = a.order_id
WHERE a.event_name='Payment Initiated' AND a.created_at>now()-interval '30 days' GROUP BY 1,2,3 ORDER BY 4 DESC;
```

Caveats: `AnalyticsEvent` depends on the first-party tracker (blocked for some visitors); `payment.failed` includes customer cancellations (`error_source = customer`), which are not technical failures; query 1 counts checkout sessions, not Razorpay orders (one is created per prefetch — Razorpay `GET /v1/orders?from&to` is the true count).

---

## 5. Successful versus failed payment metrics

Not available to this audit (see §4). The Razorpay Dashboard → Transactions (last 30 days, filter by status, method, error) is the authoritative gateway-side count; compare it with query 2/4 above. The admin page `/dashboard/transactions` already cross-references Razorpay `payments.all` with local orders (Matched/Orphaned/Mismatched) but shows every COD order as "Mismatched" because it expects `paymentStatus='paid'` and a full-amount match (`app/api/admin/transactions/route.ts:123-139`), so its counts need that filter fixed before they are trusted.

---

## 6. Issues affecting specific devices, browsers, or payment methods

| Segment | Finding | Status |
|---|---|---|
| Instagram / Facebook / Messenger / other in-app browsers (iOS & Android) | Modal (iframe) mode always used; Razorpay requires callback-URL redirect mode there and shows only UPI Intent + Cards; the success `handler` may never fire; the existing `callback_url` + middleware POST→GET + `/checkout/success` path is the only recovery and does not clear the cart (P9) | SUSPECTED (S1) — strongest "some customers cannot pay" candidate |
| Shared-IP mobile networks (CGNAT) | Per-IP 30/min buckets on both checkout APIs (P8) | CONFIRMED mechanism, UNVERIFIED frequency |
| iPhone Safari | No Safari-specific defect found. Razorpay notes a known "address is invalid" error with UPI Intent on Safari (refresh fixes). `AbortSignal.timeout` in pincode lookups silently no-ops on Safari < 16 (P24). `confirm_close` is set, so an accidental swipe/back asks before closing. Middleware converts Razorpay's cross-site POST to a 303 GET so Safari's ITP/cookie rules do not break the return | OK / Low |
| UPI (intent/collect) | UPI collect is deprecated by Razorpay from 2026-02-28 (intent/QR instead; iOS mobile web exempt); no method restriction in the options. UPI retries commonly produce `payment.failed` → `payment.captured` sequences — handled (late failed never downgrades), but the first failed attempt leaves `status FAILED` (P5) | P5 CONFIRMED; collect deprecation = ops note |
| Cards (international) | International cards are off by default on Razorpay accounts (`international_transaction_not_allowed`); non-INR orders are created in the display currency and need those currencies enabled; pre-create errors surface as a generic 500 "Failed to create payment order" with no reason shown to the shopper | SUSPECTED (S5) |
| Netbanking on desktop Firefox | Razorpay notes pop-up blockers can block the bank redirect; nothing in the code mitigates or messages this | Low |
| COD (₹ upfront fee) | Fee always taken from dashboard config, confirmation requires a `pay_` id, upfront amount recorded from config not from the captured amount; COD India-only enforced | OK |
| Coupon-only / ₹0 | Allowed without any gateway call; discount amount client-trusted (P1) | Critical (P1) |

---

## 7. Razorpay integration and webhook audit results (against official documentation)

| Documented requirement | Code | Result |
|---|---|---|
| Create the order server-side; amount in paise; receipt unique (idempotency key) | `razorpay/route.ts:183-190`, `receipt: receipt || rcpt_<ts>` | OK; receipt is client-overridable (harmless) |
| Same key pair/mode for order creation and `checkout.js` | env key id returned (`:45-47`); verification may use DB keys | P18 |
| Checkout options: `key, amount, currency, name, order_id`; `handler` for the on-page flow; `callback_url` + `redirect: true` for WebView / in-app browsers | `page.tsx:2122-2170`: `handler` + `callback_url` + `redirect: false`, no UA branch | S1 (in-app browsers) |
| `callback_url` must accept a cross-origin POST with `razorpay_payment_id/order_id/signature` | `middleware.ts:200-231` converts POST→303 GET; `/checkout/success` reads params; CSRF exempt (`:353-370`) | OK |
| `modal.ondismiss` is "closed", not "failed" (late authorisation possible) | `ondismiss` → `/api/checkout/cancel` marks the local order cancelled; later success revives it | OK (revival works, S6); P13 auth |
| Verify `HMAC_SHA256(order_id\|payment_id, key_secret)` with the **server's** order id, constant-time | `complete/route.ts:299-314` (`timingSafeEqual`) — but `order_id` comes from the request body, then the capture check binds `payment.order_id === expected` (`lib/razorpay-payment.ts:131-133`) | OK (binding happens in the capture check) |
| Fulfil only on `captured` (fetch payment; `authorized` ≠ paid) | `confirmRazorpayCapture` (`lib/razorpay-payment.ts:24-42, 119-141`): status, `captured`, `amount_refunded`, `order_id`; 202 pending otherwise | OK (W4, W7, W8, S10) |
| Capture: auto-capture via `payment_capture` / dashboard; authorised payments auto-refund in 3–5 days | web orders omit `payment_capture` | P19 |
| Late authorisation: subscribe `payment.authorized`, poll, never treat dismiss as failure | `payment.authorized` logged and ignored; cron polls Razorpay every 15 min (WSO only) | OK / P22 |
| Webhook: raw body + `X-Razorpay-Signature` HMAC with the **webhook** secret, fail closed | both endpoints `req.text()` + HMAC (`webhooks/razorpay:13-33`; `payments/webhook:28-50`) | OK (webhook #1 non-constant-time compare, P26) |
| Respond 2xx within 5 s; process async | #1 awaits Shopify sync before responding | P15 |
| At-least-once delivery → de-duplicate on `x-razorpay-event-id` | LIKE scan on payload, check-then-insert, no unique | P14 |
| Ordering not guaranteed (`failed` after `captured`, `authorized` after `captured`) | late `payment.failed` guarded by `paymentStatus notIn confirmed` | OK (W5) |
| Retries for 24 h with backoff, then the webhook is **disabled** | #1 returns 500 on exceptions (good); #2 returns 200 on exceptions (bad) | P16 |
| Separate secret per webhook URL | one env var for two endpoints | config note (S2) |
| `order.paid` fires once per order | handled by #1 only; #2 ignores it | OK |
| Refunds only on captured; `refund.processed` etc. | #1 maps created→`partial_refund`, processed→`refunded`, failed→`paid`; #2 maps created→`refunded` immediately | divergence (P16 family) |
| Test mode: separate keys, test cards/UPI, webhooks need a public URL | `ALLOW_MOCK_PAYMENTS` only outside production | OK |
| Live webhook URL | docs/dashboard page: `/api/razorpay/webhook` → 404 live; handlers at `/api/webhooks/razorpay` (401 unsigned) and `/api/payments/webhook` (400 unsigned → secret configured) | P17 |
| CSP must allow Razorpay | live CSP: `script-src`, `frame-src`, `connect-src`, `img-src` all include `*.razorpay.com` (+ `api/checkout/lumberjack/lux/cdn`) | OK (live) |

Lifecycle map (prepaid web order): `/cart` → `/checkout` (auth gate) → address → step 2 prefetch `POST /api/checkout/razorpay` (Razorpay order + local `payment_pending` Order + WebStoreOrder) → Pay → `waitForRazorpaySdk` → reuse/create order → `sessionStorage.zb_pending_checkout` → modal → (a) `handler` → optimistic confirmation page → `POST /api/checkout/complete` (signature → capture fetch → re-price → order update → Shopify sync deferred → emails/WhatsApp/pixels) or 202 pending → poll; (b) `callback_url` POST → 303 GET `/checkout/success` → same complete; (c) `payment.failed` / dismiss → `/api/checkout/cancel`. In parallel Razorpay → `/api/webhooks/razorpay` and/or `/api/payments/webhook` (`payment.captured`/`order.paid` → mark paid, `Payment` row, Shopify sync, pixels; `payment.failed` → failed). Cron every 15 min reconciles pending `web_store_orders` against Razorpay; cron every 30 min retries failed Shopify syncs. Shiprocket: **not automatic** — AWB assignment is manual from the dashboard (`complete/route.ts:894-900`), so Shiprocket cannot block a payment.

---

## 8. Checkout performance findings

Live measurements (2026-10-29, from this machine, iPhone Safari UA, cold `curl`):

| Resource | HTTP | TTFB | Total | Size |
|---|---|---|---|---|
| `https://zicabella.com/checkout` | 200 | 0.100 s | 0.123 s | 71.8 KB HTML |
| `https://zicabella.com/cart` | 200 | 0.149 s | 0.248 s | 87.7 KB HTML |
| `https://checkout.razorpay.com/v1/checkout.js` | 200 | 0.097 s | 0.124 s | 190 KB |

Build output (from the production build in this repo): `/checkout` route JS 25.5 kB, first-load JS 229 kB. The live HTML carries `<link rel="preload" href="…/checkout.js" as="script">` and `dns-prefetch`, so the SDK download starts with the page; the `<script>` itself is injected by Next on hydration (nested-layout `beforeInteractive`), and `lib/razorpay-checkout-client.ts` waits up to 12 s / injects a fallback before erroring "Payment gateway is still loading".

Lighthouse 13.5 (mobile, simulated 4G throttling, headless Chrome, 2026-10-29):

| Page | Perf score | FCP | LCP | TBT | CLS | Speed Index | Requests | Transfer |
|---|---|---|---|---|---|---|---|---|
| `/checkout` (unauthenticated → client-side redirect to `/login?callbackUrl=/checkout`) | 62 | 1.2 s | 25.8 s | 270 ms | 0 | 7.2 s | 153 | 4.8 MB |
| `/cart` | 90 | 1.2 s | 3.4 s | 110 ms | 0 | 3.0 s | 65 | 1.4 MB |

Reading: the `/checkout` run measures the checkout shell **plus the login page it redirects to**, so its LCP (25.8 s, from a late-rendered element on the login page under throttling) is not the checkout form's LCP; the authenticated steps could not be measured (login wall). The useful number is this: loading `/checkout` triggers **74 Razorpay requests, 777 KB transferred (1.8 MB uncompressed)** — `checkout.js` plus its `checkout-static-next` v2 bundle chunks are fetched on page load, before the customer taps Pay, because of the `beforeInteractive` script. On a slow mobile connection this competes with the checkout's own bundle; on the upside the modal opens fast. `/cart` is healthy (score 90, LCP 3.4 s on simulated 4G).

Performance-related payment risks found in code rather than timing: tracking calls sit in the Pay critical path (`handlePlaceOrder` awaits `AddPaymentInfo`/analytics before opening the modal — exceptions are caught, but slow trackers delay the modal); `/complete` does up to 3 Razorpay fetches (10 s timeout each, 1.5 s/3 s waits — 4.6 s measured in S10 with instant 5xx) plus untimed Shopify REST calls (P20); the pending-capture poll adds 15 requests/min per shopper (P8). The checkout step 1 has no loading state while saved addresses load (P24).

---

## 9. Order and payment consistency findings

**Protected (verified):** `Order.razorpayOrderId`, `Order.razorpayPaymentId`, `Order.internalOrderNumber`, `Order.shopifyOrderId` are unique; order-number promotion uses compare-and-set with concurrent-winner adoption; Shopify order creation has an atomic `syncing` claim with stale reclaim, a name/tag pre-existence lookup and an `Idempotency-Key`; late failure events never downgrade paid orders; `payment.authorized` never marks paid; Meta/Snap/OpenAI sends are ledger-deduplicated; store-credit debit on the app path is idempotent.

**Inconsistent states a customer can land in (all reachable in code, S-tests where noted):**

| State | How | Visible to | Repaired by |
|---|---|---|---|
| Paid at Razorpay, `Order payment_pending` | 202 with no webhook (S2 config) or P16 | nobody (hidden from My Orders) | cron, only if a `web_store_orders` row exists and is pending |
| `paid` + `status FAILED/payment_failed` (S3) | failed attempt then webhook-first success | admin only | nothing (cron skips paid WSO) |
| Authorised, never captured | bank/manual capture | nobody; Razorpay auto-refunds; `refund.processed` then flips the never-paid order to `refunded` | nothing closes the `Order` |
| Paid Razorpay order unlinked (S8) | prefetch/Pay race | customer sees 500 "contact support" or a placeholder | manual |
| Placeholder "Unresolved order" with dummy address | webhook with no local order | customer gets a confirmation email/WhatsApp | manual (`needs_review`) |
| Order "paid" without money (S1b) or for ₹1 (S1a) / ₹2 (S9) | client-trusted amounts | admin sees a normal paid order with a discount | nothing |
| `partially_paid` prepaid (underpaid) | `/complete` amount check | treated everywhere as **COD with balance due** (admin filter, Shopify `partially_paid`, Shiprocket COD) | nothing / no alert |
| Local items ≠ paid items (S2 replay) | re-post with different `items` | dashboard + Shiprocket use the local items | nothing |
| Two `Payment` rows per capture (S5) | concurrent duplicate webhooks | finance reports | nothing |

`/complete` is not wrapped in a transaction (number promotion → order update → item replace → WSO), so a mid-way failure can leave a promoted ZB number on a `payment_pending` row or an order without items. Sequences are consumed outside the writing transaction (`lib/orderNumber.ts:64-88`).

---

## 10. Fixes implemented and files changed

**Status: all five groups applied on `perf-audit` (commits `dc9958e7` Group A, then Groups C+E, then Groups B+D, then tests/docs), typecheck and production build green, every executable suite green. Nothing pushed or deployed.** The table that follows is the plan as approved; the "Applied" column says what landed.

| Group | Fix | Applied (files) |
|---|---|---|
| **A. Conversion blockers** | A1 in-app browser redirect flow · A2 cart cleared only once paid · A3 sticky errors + dismiss · A4 confirmation honours `paymentStatus` (new "unconfirmed" state that polls) · A5 step-1 skeleton + 8 s timeout · A6 address no longer resets on session refetch · Pay waits for an in-flight prefetch | `lib/in-app-browser.ts` (new), `lib/payment-status.ts` (new), `app/checkout/page.tsx`, `app/checkout/success/page.tsx`, `app/orders/[id]/confirmation/page.tsx`, `middleware.ts` (forwards redirect-mode failure fields) |
| **B. Rate limiting** | Real client IP (`cf-connecting-ip` / first `x-forwarded-for`), per-customer/device scope (60/min) + per-IP cap (300/min) on pre-create, per-Razorpay-order key (60/min) on `/complete` so the pending poll never 429s another shopper | `lib/rate-limit.ts`, `app/api/checkout/razorpay/route.ts`, `app/api/checkout/complete/route.ts` |
| **C. Webhooks & reconciliation** | C1 status map (FAILED/payment_failed/cancelled → approved/open) · C2 amount check in both webhooks (short capture → partially_paid + `underpaid` + `needs_review` + ops mail; short COD fee → not confirmed) · C3 unique `WebhookEvent.eventKey` (x-razorpay-event-id) insert-first dedup shared by both endpoints, legacy fallback until migrated · C4 ack before Shopify sync · C5 webhook #2 returns 500 on error, keeps `paymentMethod`, refund.created → partial_refund; webhook #1 constant-time compare · C6 cron pass over `Order` (captures without a mirror row, paid+FAILED repair, 6 h abandoned timeout, approved not open) · C7 `/api/razorpay/webhook` alias + docs/admin page corrected | `lib/razorpay-webhook-events.ts` (new), `app/api/webhooks/razorpay/route.ts`, `app/api/payments/webhook/route.ts`, `prisma/schema.prisma` + `prisma/migrations/20261029120000_webhook_event_key/`, `lib/services/razorpaySyncService.ts`, `app/api/cron/sync-pending-orders/route.ts`, `app/api/razorpay/webhook/route.ts` (new), `middleware.ts`, `README.md`, `docs/razorpay-testing.md`, `app/dashboard/payments/razorpay/page.tsx` |
| **D. Money integrity** | D1 coupon discount + cashback from the coupon row in both routes (`lib/web-coupon.ts`) · D2 pre-create re-prices from Shopify (`lib/variant-prices.ts`, cached; `prices_unverified` tag holds a webhook-first Shopify sync) · D3 `/complete` idempotent replay, transactional order+items, cashback idempotency key, under-capture held for review · D4 `/complete` re-points `razorpayOrderId` to the paid order; pre-create never re-points a row with a payment attempt · D5 `/api/checkout/cancel` bound to the signed-in customer · D6 `payment_capture: 1` on web orders | `lib/web-coupon.ts` (new), `lib/variant-prices.ts` (new), `app/api/checkout/razorpay/route.ts`, `app/api/checkout/complete/route.ts`, `app/api/checkout/cancel/route.ts` |
| **E. Hygiene** | Placeholder orders alert ops instead of emailing the customer · Shopify REST timeouts (12 s GET / 20 s POST-PUT) · Shopify customer creation deferred off the critical path · legacy `/api/razorpay/{create-order,verify-payment}` removed (no callers) · pay-link route retired (redirects to `/cart`) · harness fixtures fixed (non-demo phone, catalog prices, coupon rows) | `lib/services/razorpayRecoveryService.ts`, `lib/shopify-admin.ts`, `app/api/checkout/complete/route.ts`, `app/api/pay/[cartId]/route.ts`, `middleware.ts`, `scripts/payment-e2e/*` |

**Deployment notes (must be read before deploying):**
1. **Database migration** `prisma/migrations/20261029120000_webhook_event_key/migration.sql` adds `WebhookEvent.eventKey` + a unique index. The build runs `prisma generate` only, so apply it with `npx prisma migrate deploy` (or run the two SQL statements) before or right after deploying. Until it is applied the webhooks keep working through a logged legacy fallback, without the concurrency protection.
2. Razorpay Dashboard: webhook URL `https://zicabella.com/api/webhooks/razorpay` (the `/api/razorpay/webhook` alias also works now); events `payment.captured`, `order.paid`, `payment.authorized`, `payment.failed`, `refund.*`; secret = `RAZORPAY_WEBHOOK_SECRET`.
3. Under-captured payments and placeholder orders now sit in `shopifySyncStatus = needs_review` with an ops email; someone must own that queue (admin → unsynced orders).
4. Behaviour changes to be aware of: in-app browsers (Instagram/Facebook) now complete through `/checkout/success`; coupons that are expired / over limit / below minimum are silently dropped server-side even if the browser showed them; the Razorpay amount is the catalog price (a stale cart price is corrected at pay time); abandoned pending orders are closed after 6 h.

## 11. Tests executed and their actual results

All through the **real route handlers** (`app/api/...`) with the in-memory Prisma from `scripts/payment-e2e/memory-prisma.ts`; Razorpay payments API, Shopify Admin API, Meta/Snap/OpenAI/WhatsApp faked at the HTTP layer; signatures computed with the test secret; no network calls to Razorpay or Shopify; nothing written to any real database.

**A. Before the fixes (audit evidence)** — scratch scenarios S1–S10 reproduced every code finding: ₹1 / ₹0 "paid" orders and ₹5,000 minted cashback (S1), ×3 cashback / coupon usage / emails and item rewrite on replay (S2), paid order left `status FAILED` (S3), ₹100 captured on ₹3,797 marked `paid` + Shopify `paid` on both webhooks (S4), two `Payment` rows from concurrent deliveries (S5), anonymous cancel (S6), unpaid order returned by the lookup (S7), unlinked paid order → recovery P2002 → 500 + CRITICAL mail (S8), ₹2 Razorpay order for ₹2,998 of goods synced to Shopify as paid (S9), 202 pending after a Razorpay 5xx (S10). Live probes: `/api/razorpay/webhook` 404; real handlers reachable and fail-closed; secret configured.

**B. After the fixes — regression suite `scripts/payment-e2e/audit-run.ts`: 45 passed, 0 failed.** S1 ₹1 capture → `partially_paid` + `underpaid` + `needs_review`, no Shopify order, ops alerted; "₹0 coupon order" → 400, no order; client cashback ignored; expired coupon dropped. S2 replay ×3 → one coupon use, one server-computed cashback (₹342), one email, item re-post ignored. S3 failed→captured → `paid / approved`. S4/S4b short capture held on both webhooks. S5 concurrent duplicates → one processed, one `Payment` row, one `WebhookEvent`; cross-endpoint and `x-razorpay-event-id` dedup; alias route. S6 cancel: anonymous 401, other customer 0 rows, owner ok, later payment still revives. S7 lookup reports `pending`. S8 local order re-pointed to the paid Razorpay order; webhook finds it. S9 Razorpay order for catalog price (₹2,998), coupon recomputed. S10 202 pending kept. S11 rate-limit scoping (two customers on one IP; per-order key). S12 pre-create reuse guard. S13 cron: capture without mirror row → paid/approved + Shopify; paid+FAILED repaired; abandoned → `payment_timed_out`; fresh and authorized-only untouched. S14 UA detection (Instagram/FB/Snapchat vs Safari/Chrome).

**C. Existing suites after the fixes:** `scripts/payment-e2e/run.ts` **191 passed, 0 failed** (was 185/6 before the fixture fixes; the W7 scenario now uses a coupon that really carries cashback), `scripts/payment-e2e/meta-run.ts` **126 passed, 0 failed**, `scripts/verify-snap-webhook.ts` 25/0, `scripts/verify-snap-app.ts` 62/0, `scripts/verify-meta-purchase.ts` all passed, `scripts/verify-meta-internal-orders.ts` all passed. `scripts/verify-snap-international.ts` has 4 failures (phone-repair script and its international pre-create section) that **also fail on the committed HEAD before these changes** (verified in a clean worktree) — pre-existing, unrelated.

**D. Static checks:** `tsc --noEmit` clean; `next build` (production) completed successfully with all routes compiled.

**E. Live, non-destructive probes (unchanged):** see §7/§8.

## 12. Tests that could not be executed and why

| Test | Why not |
|---|---|
| Real or test-mode payment on localhost/production (success, `failure@razorpay`, timed-out card, cancel, UPI intent) | No Razorpay **test** keys available to me; production keys must not be used for test charges; the brief forbids real charges without authorisation |
| Logged-in checkout on localhost (address step, prefetch, Pay) | Checkout is behind the customer login (OTP/next-auth); no test account; the local `.env.local` lacks several services |
| In-app browser behaviour (Instagram/Facebook/WebView), iPhone Safari UPI intent return, pop-up blockers | Needs physical devices and a payable checkout (test mode) |
| Historical failure analysis, success rate, 429 counts, webhook health, placeholder/paid-hidden counts | No production DB / DO logs / Razorpay Dashboard access — queries supplied (§4) |
| Dashboard configuration (webhook URL/secret/events, auto-capture, enabled methods/currencies, international cards) | Dashboard access needed (§13 checklist) |
| Native-app pending-capture scenario (`scripts/payment-e2e/app-pending-capture.ts`) | React-Native module missing in this checkout |
| Webhook 5-second ack timing under real Shopify latency | Shopify faked; needs production timing (query 11 `processed=false` rows and Razorpay webhook logs) |
| Lighthouse of the **authenticated** checkout steps | Login wall; measured the checkout shell and cart only |

---

## 13. Remaining risks and recommended next steps

**Do today (no code):**
1. Razorpay Dashboard → Webhooks: confirm the URL is `https://zicabella.com/api/webhooks/razorpay` (or `app.zicabella.com`), the secret matches `RAZORPAY_WEBHOOK_SECRET`, events include `payment.captured`, `order.paid`, `payment.failed`, `payment.authorized`, `refund.*`, and the webhook is **not disabled**. Remove any `/api/razorpay/webhook` entry.
2. Dashboard → Settings → Payment capture: auto-capture ON (or approve fix D6).
3. Run queries 2, 4, 6, 7, 11, 13 (§4). They answer "how many customers were charged without a visible order", "how many paid orders are hidden", and whether 429s happen.
4. Compare `Shop.razorpayKeyId` prefix with the environment `RAZORPAY_KEY_ID` prefix (never the secret). If they differ, fix the DB value first (P18).
5. Open the checkout from an Instagram ad on iOS and Android and attempt a test payment — this decides S1, the most probable "some customers cannot pay" cause.

**Then (code, with approval):** groups A → B → C → D → E from §10. Group A + B are low-risk UI/limit changes and remove the known customer-facing blockers; group C makes the webhook path trustworthy; group D closes the money-integrity holes (Critical, but a revenue issue rather than a conversion issue) and must ship with the regression suite.

**Residual risks even after all fixes:** Razorpay-side outages (mitigated by the 202 design but still a 3-minute wait); bank-side late authorisations (handled by `payment.authorized` + cron, but customers are not told); two webhook endpoints with one secret (consolidate); no `PaymentAttempt` log (consider persisting client-side `payment.failed` reasons with device/browser for future analysis).

---

### Appendix — files inspected (read-only)
`app/checkout/{page.tsx,layout.tsx,success/page.tsx}`, `app/cart/*`, `app/orders/[id]/confirmation/page.tsx`, `lib/razorpay-checkout-client.ts`, `lib/checkout-complete-client.ts`, `lib/razorpay.ts`, `lib/razorpay-credentials.ts`, `lib/razorpay-payment.ts`, `lib/rate-limit.ts`, `lib/cod-upfront.ts`, `lib/cod-availability.ts`, `lib/orderNumber.ts`, `lib/storeCreditsHelper.ts`, `lib/services/{razorpaySyncService,razorpayRecoveryService,shopifyOrderSyncService,orderLifecycleService,logistics}.ts`, `lib/shopify-admin.ts`, `app/api/checkout/{razorpay,complete,cancel,cod-fee}/route.ts`, `app/api/orders/by-razorpay/route.ts`, `app/api/orders/route.ts`, `app/api/webhooks/razorpay/route.ts`, `app/api/payments/webhook/route.ts`, `app/api/webhooks/razorpayx/route.ts`, `app/api/razorpay/*`, `app/api/pay/[cartId]/route.ts`, `app/api/app/payment/{create-order,verify}/route.ts`, `app/api/app/orders/create/route.ts`, `app/api/cron/{sync-pending-orders,sync-failed-shopify-orders,health}/route.ts`, `app/api/admin/transactions/*`, `app/api/shopify/{webhooks,sync}/route.ts`, `app/dashboard/{webhooks,payments/razorpay,transactions}/page.tsx`, `middleware.ts`, `prisma/schema.prisma`, `README.md`, `docs/razorpay-testing.md`, `DEPLOY_NOTES.md`, `.env.example` (names only), `scripts/payment-e2e/*`, `scripts/snap-test-support/*`, `node_modules/razorpay/dist/{api,utils/razorpay-utils,resources/orders}.js`.
