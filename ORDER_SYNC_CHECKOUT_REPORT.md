# Order sync failure (#ZB81380) and checkout slowdown — investigation and fixes

**Date:** 2026-10-29 · **Evidence sources:** source code at `136e7e10`+ (main), the admin orders API read from the owner's logged-in dashboard session (read-only), Shopify community/API documentation, in-browser timing of the real cart → checkout journey in the owner's Chrome, and the in-memory regression harness run against the real route handlers. **No access:** DigitalOcean logs, the production database shell, the Shopify admin UI. Nothing was changed in production while investigating; no order was modified, retried or created.

---

## 1. Root cause of #ZB81380

Shopify rejected the order creation with **HTTP 422 `customer.email_address: has already been taken`** and every retry gets the same answer, so the status stays `failed`.

Why Shopify says that: the sync payload sent **two different identities** for the customer:
- `customer: { id: <Shopify customer id> }` — the local customer record carries a numeric Shopify id that was created at login with a **placeholder email** (`guest_…@zicabella.in` style);
- top-level `email: <the real email the shopper typed at checkout>`.

Shopify treats a top-level `email` on an order with `customer.id` as "set this customer's email". That email already belongs to **another** Shopify customer, so the request is invalid. The same shopper's phone matches on both sides, which is why they were linked to the placeholder record in the first place.

Code path: `lib/services/shopifyOrderSyncService.ts` built `email` from the shipping address (`emailToUse = shippingAddress.email || customer.email …`) and `customer` from `customer.shopifyId`, without checking that they agree.

## 2. Evidence

- Admin API record for the order: `shopifySyncStatus: "failed"`, `shopifySyncError: "Shopify API 422: {\"errors\":{\"customer.email_address\":[\"has already been taken\"]}}"`, `shopifyOrderId: null`, created 2026-10-29 07:55:39 UTC, last attempt (cron retry) 08:03:39 UTC.
- Same record: local customer's `shopifyId` is numeric; the customer's stored email is a placeholder; the shipping-address email is a real, different address; the phone matches on both.
- The two synced neighbours (#ZB81379, #ZB81376) have no email in their shipping address, so their payload carried only the customer's own identity — no conflict.
- Shopify documentation/community confirms the rule: an order with both a customer id and a different email fails; dropping the email and using the customer id succeeds ([community thread 1](https://community.shopify.com/t/shopify-create-order-admin-api-not-taking-email-all-of-a-sudden/130479), [thread 2](https://community.shopify.com/t/new-customer-error-email-has-already-been-taken-search-json-sends-empty-customers/78154)).
- Reproduced in the regression harness with a fake Shopify that applies that rule: the old payload fails, the new one succeeds (scenario S15, §10).

## 3. Does the order already exist in Shopify?

**No.** A 422 means the request was rejected before anything was created, `shopifyOrderId` is null, and the sync service's post-error self-heal lookup (`findShopifyOrderByInternalNumber`, by order name and `zb-order-ZB81380` tag) found nothing. Retrying cannot duplicate it: the pre-create lookup runs again, and the create carries `Idempotency-Key: ZB81380`.

## 4. Are other orders affected?

Scan of the 500 most recent manifest orders (admin API, pages of 100):
- **Genuinely unsynced: 1 visible** — #ZB81380. The retry batch after deploy surfaced one more, hidden from the default manifest list because it is cancelled: **#ZB81170** (2026-09-14, 100 % store-credit, ₹0 total, status `cancelled`). Shopify rejects it with `422 transactions: Amount must be greater than zero for sale transactions`; it was retried on every cron run for six weeks. A cancelled order must not be created in Shopify at all, so the retry now excludes cancelled orders (commit after this report). No other ₹0 or cancelled order is unsynced in the last 500.
- **55 orders since 2026-09-27 were in Shopify (numeric `shopifyOrderId`) but carried `shopifySyncStatus: "pending"`**, so the manifest showed them as PENDING SYNC although nothing was wrong. Cause: when the Razorpay webhook syncs the order before the browser's `/api/checkout/complete` runs, `/complete` overwrote the status with `pending`; the sync fast path then returned success without correcting it, and the retry cron ignored them (it only looks at rows without a Shopify id). **Repaired on the first retry run after deploy** (all 100 most recent orders read `synced` at 09:13 UTC).
- Orders older than 2026-09-27: all `synced`.

**Why the existing retry did not resolve #ZB81380:** (1) it re-sent the identical payload, and a 422 validation error is deterministic; (2) the "every 30 minutes" retry and the "every 15 minutes" pending-order sync are GitHub Actions schedules, and GitHub ran them every **4–6 hours** in practice (runs at 13:25, 19:01, 23:26, 02:44 UTC for the retry; 05:31, 11:36, 17:21, 21:45, 01:19, 07:16 for the pending sync — scheduled workflows on this repository are heavily delayed). Any reconciliation that assumes a 15/30-minute cadence is optimistic; see §11.

## 5. The synchronization fix

`lib/services/shopifyCustomerIdentity.ts` (new) + `lib/services/shopifyOrderSyncService.ts`:
1. **Customer identity resolution before the order is built.** A known Shopify customer id is kept as the order's customer; the checkout email and phone are sent top-level **only when they match that customer's own values**, otherwise they travel as `note_attributes` (`checkout_email`, `checkout_phone`) so nothing is lost. Without a usable id, the customer is found by email, then by phone (verified matches only), then created; a creation conflict ("has already been taken") re-runs the searches; as a last resort the order goes out by email only. The resolved id is written back to the local customer.
2. **Targeted retry on a contact conflict Shopify still reports:** after confirming nothing was created, the order is re-sent once without `customer`/`email`/`phone` (shipping address keeps the delivery contact) with a distinct idempotency key.
3. **Classified error recording:** `shopifySyncError` now starts with `[validation, needs attention]`, `[timeout, retrying]`, `[rate_limit, retrying]`, `[server, retrying]`, `[auth, needs attention]` … so a failed row says whether waiting helps.
4. **Status repair:** the sync fast path marks an order `synced` when it already has a Shopify id; `/api/checkout/complete` keeps `synced` for webhook-first orders; the 30-minute retry cron starts with `repairSyncedOrderStatuses()` (bounded), which fixes the 55 rows on its first run after deploy.
5. **Dashboard:** the manifest's SYNC FAILED badge shows the recorded error on hover; the order page already shows it in full and already has the "Sync with Shopify" retry button, which calls the same service — no new dashboard.

Related finding fixed on the way: the server-side price lookup used by checkout (`lib/variant-prices.ts`) and by the mobile order routes (`lib/shopify-variant-prices.ts`) called `GET /admin/api/…/variants.json?ids=…`, which **is not a Shopify endpoint** (variants can only be listed per product or fetched one at a time in REST). Every lookup failed silently, so "server-verified prices" never happened in production (#ZB81380 is tagged `prices_unverified`). Both now use one Admin GraphQL `nodes` query; an admin-only read-only check exists at `/api/admin/diagnostics/variant-prices?ids=…`.

## 6. How duplicate Shopify orders are prevented

Unchanged mechanisms, verified: atomic claim on `shopifySyncStatus = syncing` (stale after 5 min), pre-create lookup by order name/tag, `Idempotency-Key` + `source_identifier` on the create call, post-error self-heal lookup, and the fast path for any numeric `shopifyOrderId`. New: the conflict retry only runs after a fresh "does it exist" lookup, and the status repair never creates anything.

## 7. Root cause of the checkout slowdown

Measured on the real journey (owner's Chrome, warm cache, 16-item cart, ~70 saved addresses):

| What | Measured |
|---|---|
| Click → address step rendered | **149 ms** |
| Long tasks during the transition | 1 × 51 ms |
| Requests fired by the click | 16 API calls within 2.4 s |
| `/api/cart/sync` | **2,242 ms**, then an identical second call **2,355 ms** (1.2 s later) |
| `/api/customer/addresses` | 1,187 ms (1,330 / 483 / 241 ms on repeats) |
| `/api/user/store-credits` | 380 ms (648 / 169 / 148 ms) |
| tracking calls (meta, snap, openai, analytics, whatsapp) | 95–664 ms each |
| Google Maps on mount | 9 requests, 328 KB (not needed when a saved address is used) |
| Razorpay SDK on mount (cold load, from the earlier Lighthouse run) | 74 requests, 777 KB transfer / 1.8 MB |

So the page itself renders fast; what makes the site feel slow after the click is the **burst of server work and downloads the click triggers**:
1. `/api/cart/sync` ran **twice** with the same payload (session prefill, then saved-address selection re-triggered the effect) and each call did a rate-limit write, an **external IP-geolocation chain** (up to three providers, 2.5 s each, because the checkout never sent the address location), several customer/cart lookups and a delete + re-insert of all cart items.
2. All of this hits one Prisma pool of 8 connections per instance through the Supabase pooler; 16 near-simultaneous requests queue behind each other, which inflates every call (including other visitors' requests on that instance).
3. On a cold mobile load, the Razorpay SDK (0.8 MB, 74 requests, loaded `beforeInteractive`) and Google Maps (0.3 MB) compete with the checkout bundle and the address API.

## 8. Checkout changes and measured effect

Changes (`app/checkout/page.tsx`, `app/checkout/layout.tsx`, `app/api/checkout/razorpay/route.ts`, `lib/rate-limit.ts`):
- `/api/cart/sync` runs **once per distinct payload** (2.5 s debounce, dedup key) and now sends city/state/zip/country, so the server skips the IP-geolocation chain.
- Google Maps loads only when the address form is on screen (new address / no saved address), not on every mount.
- Razorpay's SDK loads after the page is interactive (`lazyOnload`); the Pay button already waits for or injects it.
- The pre-create route's per-IP abuse cap no longer costs three database round trips (in-memory).

Before/after numbers: §10 (measured in the owner's Chrome before and after the deploy of PR #38, same cart, same account, three after-deploy samples).

## 9. Files changed

| File | Why |
|---|---|
| `lib/services/shopifyCustomerIdentity.ts` (new) | Customer identity resolution, error classification, contact-conflict detection |
| `lib/services/shopifyOrderSyncService.ts` | Uses the resolver; conflict retry; classified `shopifySyncError`; fast-path status repair |
| `lib/services/orderLifecycleService.ts` | `repairSyncedOrderStatuses()` run by the retry cron |
| `lib/shopify-admin.ts` | `fetchCustomerById()` |
| `lib/variant-prices.ts`, `lib/shopify-variant-prices.ts` | GraphQL `nodes` price lookup replacing the non-existent REST call |
| `app/api/admin/diagnostics/variant-prices/route.ts` (new) | Admin-only read-only price lookup check |
| `app/api/checkout/complete/route.ts` | Keep `synced` for webhook-first orders |
| `app/dashboard/orders/page.tsx` | SYNC FAILED badge shows the error on hover |
| `app/checkout/page.tsx` | Deduplicated cart sync with location; Google Maps on demand |
| `app/checkout/layout.tsx` | Razorpay SDK `lazyOnload` |
| `app/api/checkout/razorpay/route.ts`, `lib/rate-limit.ts` | Memory-only per-IP cap |
| `scripts/payment-e2e/{audit-run,run,meta-run}.ts` | Fakes for Shopify customers/GraphQL; scenarios S15–S20 |

## 10. Tests and results

Real route handlers + in-memory Prisma, Shopify faked at the HTTP layer with its customer/email/phone rules:
- `scripts/payment-e2e/audit-run.ts` — **56 passed, 0 failed**, including: S15 the #ZB81380 pattern (known customer + different checkout email) syncs on the first attempt, keeps the customer, omits the conflicting email and records it as a note attribute; S16 customer found by email and linked; S17 creation conflict → re-search → existing customer; S18 new customer created; S19 status repair (pending/failed rows with a real Shopify id → synced; `local_` placeholders untouched; fast path repairs without re-creating; `/complete` keeps `synced`); S20 GraphQL prices + error classification.
- `scripts/payment-e2e/run.ts` 191/0, `meta-run.ts` 126/0, `verify-snap-webhook` 25/0, `verify-snap-app` 62/0, `verify-meta-purchase` all pass. `tsc --noEmit` clean; `next build` green.
- Live, read-only: admin API reads of the affected and neighbouring orders; three timing passes of each checkout GET endpoint; two instrumented cart → checkout transitions.

Checkout before/after (same procedure, owner's Chrome, 16-item cart, saved address; after = three samples at 09:02–09:08 UTC on 2026-10-29):

| Metric | Before | After deploy (3 samples) |
|---|---|---|
| Click → address step rendered | 149 ms | 461 / 123 / 115 ms (first sample fetched the new build's chunks) |
| Long tasks during the transition | 1 × 51 ms | 1 × 62 ms / 0 / 0 |
| `/api/cart/sync` calls per checkout | **2** (2,242 + 2,355 ms) | **1** (6,184 / 2,502 / 641 ms — server-side variance; 641 ms is the floor once the IP-geolocation chain is skipped) |
| Google Maps requests on mount (saved address) | 9 / 328 KB | **0** |
| API calls fired by the click | 16 | 14–15 |
| Cold mobile Lighthouse (unauthenticated shell): total blocking time | 270 ms | 140 ms |
| Cold mobile Lighthouse: Razorpay SDK requests / transfer | 74 / 777 KB | 70 / 776 KB (same bytes, now fetched after `load` instead of before the page is interactive) |

Server-side latency remains the dominant variable: `/api/customer/addresses` measured 1,967 / 1,835 / 835 ms across the three after-deploy samples (1,187 ms before) for an account with ~70 saved addresses — it did not change in this PR and tracks database/pooler load at the time of the sample.

## 11. Remaining risks and unavailable evidence

- No DigitalOcean logs: the exact Shopify latency and the IP-geolocation provider timings in production are inferred from client-side durations, not server logs.
- Server-side slowness is partly structural (Supabase pooler round trips, pool of 8 per instance). `PG_POOL_MAX` is an environment setting; raising it to 16 is worth a try after this deploy, but it was not changed here.
- The owner's account is a pathological case (70 saved addresses, 16-item cart); real customers see smaller numbers for the address call.
- The scheduled GitHub Actions crons run every 4–6 hours in practice, not every 15/30 minutes. Reconciliation that must be timely (pending-order sync, Shopify retry) should move to a scheduler that honours the interval (DigitalOcean scheduled job, an external cron hitting the same endpoints, or an in-process timer on the long-running server) — not changed here; worth deciding.
- Shopify rejected a ₹0 manual sale transaction on the one cancelled store-credit order; if a live 100 % store-credit order ever fails the same way, the zero-amount `transactions` entry should be dropped in favour of `financial_status: paid` alone.
- `verify-snap-international.ts` has 4 pre-existing failures (also on the committed main) unrelated to these changes.

## 12. Recovery actions — status

1. **Deployed:** PR #38 merged 2026-10-29 08:31 UTC, live on all instances by ~08:45 (verified: Razorpay preload gone from the checkout HTML; `/api/admin/diagnostics/variant-prices` returns real Shopify prices in 447 ms).
2. **#ZB81380 recovered:** the retry workflow was dispatched manually at 09:13 UTC (the scheduled run would have waited hours, see §4); result `{"processed":2,"ok":1,"failed":1}` — #ZB81380 synced as Shopify order `18981124833561` (store name `#ZB72203`) at 09:13:20 UTC, attached to the shopper's existing Shopify customer with the typed email kept as a note attribute. No duplicate: nothing existed before, the create carried the idempotency key, and exactly one Shopify order id is linked.
3. **55 PENDING SYNC rows repaired** in the same run.
4. **Still failing, by design now excluded:** #ZB81170 (cancelled ₹0 order, §4). If you want it in Shopify after all, un-cancel it first; otherwise nothing to do.
5. No order was cancelled, refunded or edited by this work.
