# Zica Bella — end-to-end regression audit after PR #40 / PR #42

Date: 2026-10-29 (all times UTC) · Branch for this report: `regression-audit` (from `main` @ `a75fa401`) · Nothing in this audit was merged or deployed; the only production changes today were PR #40 (16:48) and PR #42 (17:10), both authorised by the owner.

Verdict classes: **PASS** = executed and observed · **FAIL** = executed and failed · **NOT VERIFIED** = not executed (reason given) · **RISK** = reasoned from code or pre-existing.

---

## 1. Executive summary

- The live site is healthy on the restored build: all 16 real product pages tested return 200 with correct titles, prices and sizes; unknown handles are 404; collections are cached; home, cart, checkout, search, filters, account pages, bookmarks and the guest cart work in Chrome; no first-party console errors or failed requests.
- The product-page outage (16:58–~17:22) was caused by PR #40 turning `/products/[id]` into a cached (ISR) route while its metafield lookup still used a `no-store` Shopify GraphQL call. PR #42 restored the previous product-page implementation; the rest of PR #40 stays and works.
- No orders were placed during the outage window (newest order 16:26); all 40 most recent orders are synced to Shopify and carry consistent payment statuses.
- Payment, webhook, order-creation and Shopify-sync code was not changed by any of the three PRs; its offline harnesses (373 checks) pass on the current code. A real Razorpay payment was **not** performed (no sandbox keys) — that remains code-level + harness verification only.
- Performance (live Lighthouse, same mobile preset, 3 runs): collection 63→75, product 63→71, home 84→79, cart 79→64. Home and cart moved within their run-to-run noise (home runs 69–86 before, 78–82 after; cart had two runs with 500–800 ms hydration long tasks that no code change explains). Targets (≥80 / BP ≥90) are **not** met; Best Practices stays 77 because of third-party cookies from the Snap and OpenAI ad pixels.
- One new regression test was added (`scripts/catalog-cache-test/run.sh`): it reproduces the outage class against a fake Shopify backend and passes 18/18 on the current code. It is on this branch, unmerged.
- Safe to continue performance work? Yes, but only route by route and only after the new test and a real-data check pass; details in §16–17.

## 2. Current production deployment status

| Check | Method | Result |
|---|---|---|
| PR #42 merged | `gh pr view 42` | PASS — merged 17:10:39, commit `a75fa401` |
| Rollout completed | polled the two logged URLs every 20 s | PASS — both 200 from 17:19 (first instance) and consistently from 17:22; 36/36 requests to three product URLs at 17:25 served the new build (`Cache-Control: private, no-cache` = request-time render) |
| Running code is the restored version | product pages: dynamic headers, full "curated pairs" payload; collections: `x-nextjs-cache: HIT`, `s-maxage=120` | PASS |
| `/products/terra-mode-streetwear-denim` | GET | PASS — 200, "TERRA MODE DENIM", ₹1,609, 6 size tokens |
| `/products/the-watcher-t-shirt` | GET | PASS — 200, "THE WATCHER T-SHIRT", ₹2,799, 6 size tokens |
| 14 more real products (sitemap sample) | GET | PASS — all 200 with title/price/sizes (§7) |
| Server logs | DigitalOcean logs are not accessible from here | NOT VERIFIED on production. On the identical build run locally through the full matrix: 0 "static to dynamic", 0 "Dynamic server usage", 0 unhandled errors. Please re-check the DO runtime log for anything after 17:22. |
| Rollback introduced other regressions | §5–§10 | none found |

## 3. Root cause of the product-page failure

`app/products/[id]/page.tsx` (PR #40, commit `424e886e`) exported `generateStaticParams`/`dynamicParams`, making the route static/ISR. The page resolves metafield GIDs through `resolveShopifyGid()` → `shopifyGraphqlFetch()` which, in its default "live" mode, sends `cache: 'no-store'`. Next.js 14 refuses a runtime static→dynamic switch: `Page changed from static to dynamic at runtime /products/<handle>, reason: no-store fetch …/admin/api/2025-01/graphql.json` (the lines in your log screenshot). Every product with a GID metafield — in practice all of them — failed with the generic 500 page even though the lookup is wrapped in try/catch. Reproduced locally with a fake Shopify product carrying `gid://shopify/MediaImage/…`; products without such a metafield rendered, which is why the local fallback catalogue (no metafields) never surfaced it before the merge. That gap is mine.

## 4. Relevant changes across PR #40, #41, #42

| PR | Status | What it changed | Effect now |
|---|---|---|---|
| #40 `424e886e`, `4d9345f2` | merged 16:48 | collection ISR; product ISR (**the regression**); hero poster as priority image + deferred video; one blur preview per card; trimmed home/collection payloads; geolocation without Google Maps; logo PNG 34→15 KB; reports | everything except the product-page ISR is live and verified below |
| #41 | closed, never merged | full revert of #40 | superseded by #42 |
| #42 `2f8467de` | merged 17:10 | `app/products/[id]/page.tsx` and `lib/shopify-admin.ts` restored byte-for-byte to `4e3133e6` (the version live before #40) | product pages render per request as before; `git diff 4e3133e6 main` for these two files is empty |

Net change on `main` vs the last pre-#40 commit: `app/collections/[handle]/page.tsx`, `app/page.tsx`, `components/HeroVideo.tsx`, `components/ProductCardImage.tsx`, `lib/geolocation-enrichment.ts`, `lib/storefront-card-product.ts` (new), `public/zb-logo-220px.png`, reports and Lighthouse evidence. No change to payment, webhook, order, cart-API, checkout, auth, middleware, Prisma or configuration files (verified with `git diff --name-only`). Did the rollback remove anything needed? Only the trimmed "curated pairs" payload on the product page (a size optimisation, not a feature) and the unused `throwOnError` option.

Code-level review of the remaining changes (App Router rendering, caching, shared components): the collection route is the only new ISR route; every Shopify call on its path uses the cached "catalog" mode (verified by grep; a `dynamic = "error"` dev run found no dynamic API usage), and the fake-backend test exercises it with real-shaped data. `HeroVideo`, `ProductCardImage`, the card-payload helper and the geolocation change are client/loading-order changes with no data or business-logic effect; their consumers were enumerated and the fields they read are preserved (see `PR40_SAFETY_AUDIT.md` §2).

## 5. Pages and journeys tested

Live site: home, mobile menu, header navigation, search, collections (new-arrivals, jeans, all; sort and size filter), 16 product pages, product → back → forward → reload, guest cart drawer (add, +, −, remove), guest `/cart` and checkout gate, owner cart page → checkout (saved addresses), orders and profile pages, bookmarks drawer, footer and policy links (all 200). Local production build with a fake catalogue: product → size → add → drawer → checkout → address form with PIN lookup (desktop and 375 px mobile), test-account OTP login.

## 6. Chrome testing results

| Test | How | Expected | Actual | Verdict |
|---|---|---|---|---|
| Homepage load | built-in browser (guest) and owner's Chrome | renders, no errors, hero visible | hero poster loaded, video attached after load (readyState 4), 35 product links, 0 failed requests; console: only the pre-existing OpenAI-pixel CSP messages | PASS |
| Header / menu | mobile menu opened; desktop header links | all links resolve | 8 collections, 6 search shortcuts, info links, profile/orders/returns; all 200 | PASS |
| Search | `/search?q=denim` | results | 52 product links, 0 failed requests | PASS |
| Collection pages | `/collections/new-arrivals`, `/collections/jeans`, `/collections/all` | grid with images/titles/prices | 16–40 cards, images and prices present, 0 failed requests | PASS |
| Sort / filter | `?sort=price-asc`, `?size=30` | ordered / filtered | prices ascending (1609…3266); size select reflects "30" | PASS |
| Product from collection | click card → PDP | product page | VISCERA DENIM / THE WATCHER T-SHIRT opened with sizes and images | PASS |
| Back / forward / reload | Chrome history | no errors | collection → product → back (35 cards) → forward (product) → reload (200, not a 500) | PASS |
| Console on product pages | owner's Chrome, guest built-in | no first-party errors | none; the `RefererNotAllowedMapError` seen this morning is gone (0 Maps requests) | PASS |
| Account pages | owner's Chrome `/orders`, `/profile` | render | order history and profile tabs render, 0 failed requests | PASS |
| Footer / policy links | HTTP | 200 | 19/19 return 200 | PASS |
| Bookmarks | guest bookmark on PDP → drawer | item listed | drawer lists it (localStorage `zb_bookmarks_v1`) | PASS |

## 7. Product-page results (live, 17:27)

| Route | Status / time | Title | First price | Sizes |
|---|---|---|---|---|
| /products/the-watcher-t-shirt | 200 / 0.87 s | THE WATCHER T-SHIRT | ₹2,799 (compare ₹3,999) | 6 |
| /products/terra-mode-streetwear-denim | 200 / 0.58 s | TERRA MODE DENIM | ₹1,609 | 6 |
| /products/aerolayer-half-denim | 200 / 1.55 s | AEROLAYER HALF DENIM | ₹2,029 | 6 |
| /products/arcpocket-oversized-acid-wash-denim-jorts | 200 / 1.63 s | ARCPOCKET DENIM JORTS | ₹2,729 | 6 |
| /products/ashborne-haze | 200 / 2.47 s | ASHBORNE HAZE | ₹2,566 | 6 |
| /products/black-mosaic-wide-leg-jeans | 200 / 0.95 s | BLACK MOSAIC WIDE LEG JEANS | ₹3,359 | 6 |
| /products/blade-collar | 200 / 2.03 s | BLADE COLLAR | ₹2,566 | 5 |
| /products/blue-dominion-leather | 200 / 2.05 s | BLUE DOMINION LEATHER | ₹6,299 | 6 |
| /products/chainster | 200 / 2.06 s | CHAINSTER ZIP SHIRT | ₹1,633 | 6 |
| /products/desperados-veil-denim-jeans | 200 / 1.36 s | DESPERADOS VEIL - DENIM | ₹9,029 | 6 |
| /products/deviant-rerouted-denim | 200 / 0.98 s | DEVIANT REROUTED DENIM | ₹5,249 | 6 |
| /products/dryxen-oversized-acid-wash-black-t-shirt | 200 / 1.65 s | DRYXEN TEE | ₹2,379 | 6 |
| /products/dustburn-drift-tank-top | 200 / 2.05 s | DUSTBURN DRIFT TANK | ₹1,162 | 6 |
| /products/gothic-sleeveless-hoodie-vest | 200 / 1.90 s | DEADSTAIN HOOD | ₹2,309 | 6 |
| /products/oversized-graphic-jersey | 200 / 0.61 s | BLOODZIC JERSEY 01 | ₹2,519 | 6 |
| /products/oversized-laser-printed-denim-jort | 200 / 1.49 s | DEADLOCK JORTS | ₹1,889 | 6 |
| /products/does-not-exist-zzz | 404 | — | — | — |
| /collections/does-not-exist-zzz | 404 | — | — | — |

Repeated visits (12 each to three URLs): 36/36 → 200. Inventory handling: sold-out sizes render disabled on the local fixture (size M of the fixture product with quantity 0); live inventory states were not individually checked — NOT VERIFIED beyond "sizes render".

## 8. Cart and checkout results

| Test | How | Expected | Actual | Verdict |
|---|---|---|---|---|
| Add to cart (guest, live) | PDP size M → Add to Bag → drawer | item with correct size/price | "THE WATCHER T-SHIRT SIZE: M ₹2,799 × 1" | PASS |
| Quantity + / − (guest, live) | drawer buttons | totals update | ₹68,688 → ₹71,487 (×2, ₹5,598) → ₹68,688 | PASS |
| Remove (guest, live) | − at quantity 1 | item gone | total ₹65,889, item no longer in `zb_cart_v1` | PASS |
| Cart survives navigation / refresh | localStorage + `/api/cart/sync` 200 on every change | persists | guest cart persisted across pages and reloads in the same browser profile | PASS |
| Guest `/cart` page | navigate | login prompt (existing design) | "LOGIN TO VIEW YOUR CART" | PASS (as designed) |
| Guest checkout gate | drawer → Checkout | login with callback | `/login?callbackUrl=/checkout` | PASS |
| Owner cart page (live) | Chrome | items and totals | order summary, total ₹73,388; the earlier test item was removed by the owner | PASS |
| Checkout transition (owner, live) | instrumented click on Proceed to Checkout | fast, no duplicate calls | first render 11 ms after the click, 11 API calls, no duplicates, one 96 ms long task, saved addresses shown, 0 Google Maps requests; one background `/api/cart/sync` of 3.3 s does not block | PASS |
| Address form, validation, PIN lookup | local build (desktop and mobile) | city/state auto-fill, Continue enabled | PIN 201305 → "Gautam Buddha Nagar", "Uttar Pradesh"; order summary Beta Denim × 2 ₹8,998, shipping FREE, total matches cart; Continue to Payment enabled | PASS (local) |
| Phone validation | local | required | empty mobile blocks; test number accepted | PASS (local) |
| Shipping charges | local summary | computed | "FREE" above the free-shipping threshold; `/api/checkout/cod-fee` 200 | PASS (local); paid-shipping tiers NOT VERIFIED |
| Discount code | local form shows the code field + Apply; live owner checkout shows the "PREPAID10" offer | works | not exercised with a real code | NOT VERIFIED |
| Checkout stuck on loading / refresh / back | observed skeleton clears; back/forward tested on product pages | no stuck state | no stuck state seen; checkout-page refresh/back NOT VERIFIED explicitly |

Why checkout felt slow earlier today: it fired two identical 2.2–2.4 s cart-sync requests plus Google Maps and the Razorpay SDK on mount; that was fixed in PR #38 this morning and is confirmed above (one sync, off the critical path).

## 9. Razorpay integration audit

Code paths (unchanged by #40/#41/#42; verified by `git diff --name-only` and import grep): `app/api/checkout/razorpay` (server re-pricing from Shopify, amount in paise, currency from the store, `payment_capture: 1`, pending-order reuse only when no payment id), `app/api/checkout/complete` (HMAC signature verified server-side, replay short-circuit returns the existing order, DB transaction for status + items, underpaid → `needs_review`), `app/api/checkout/cancel` (session + customer bound), both webhook routes (raw-body HMAC, per-event claim key with unique index, captured-amount check, refund mapping), success page (clears the cart only when paid; pending shows the confirmation page with polling, never a false success).

| Check | How | Verdict |
|---|---|---|
| Amount/currency and cart association | harness `audit-run.ts` S1–S14 (real route handlers, fake Razorpay) | PASS — 56/56 |
| Signature verification, failed/cancelled/pending/success states | harness + success-page code | PASS (harness) |
| Duplicate callbacks / webhook replays | harness (replay → same order, no duplicate) | PASS (harness) |
| Refresh of the payment page does not duplicate orders | pending-order reuse + replay short-circuit (code); harness | PASS (harness) |
| Unauthenticated calls rejected on live | POST without session to `/api/checkout/razorpay` → 400 "Invalid amount", `/complete` → 400 "Payment details missing", `/cancel` → 401; unsigned webhooks → 401/400 | PASS |
| Credentials / production settings unchanged | no env or config file in any diff | PASS |
| A real end-to-end payment | — | NOT VERIFIED — no Razorpay test keys available; a live payment would charge a real card. Everything above is code-level and harness evidence. |

## 10. Shopify order synchronisation

| Check | How | Verdict |
|---|---|---|
| Recent orders synced | owner-session read of `/api/admin/orders?limit=40` | PASS — 40/40 `synced`; payment statuses `paid` 23, `cod_upfront_paid` 15, `partially_paid` 2; newest order 16:26 (before the outage) has a Shopify order id |
| Orders during the outage | same read | none created between 16:58 and 17:22 |
| Exactly-once creation, identity handling, status repair, retry safety | harness `audit-run.ts` S15–S20 (customer identity, 422 conflict fallback, status repair, cancelled-order exclusion) | PASS (harness) |
| Catalogue webhooks → cache invalidation | signed `products/update` webhook to the local build → product and collection pages regenerated with the new data; bad signature → 401 | PASS (local) |
| Failed syncs visible and recoverable | dashboard SYNC FAILED badge with the recorded error (added this morning); retry cron excludes cancelled orders | PASS (code + this morning's live recovery of #ZB81380) |
| This morning's sync issue (#ZB81380) | resolved earlier today (PR #38/#39); no regression: all recent orders synced | PASS |

## 11. Build, type-check, lint and automated tests

| Check | Result |
|---|---|
| `npm run build` (current `main` content) | PASS — `/products/[id]` ƒ dynamic, `/collections/[handle]` ● ISR |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS (0 errors, pre-existing warnings) |
| `scripts/payment-e2e/audit-run.ts` | 56 passed / 0 failed |
| `scripts/payment-e2e/run.ts` | 191 passed / 0 failed |
| `scripts/payment-e2e/meta-run.ts` | 126 passed / 0 failed |
| `scripts/catalog-cache-test/run.sh` (new) | 18/18, run four times |
| HeroVideo DOM test (jsdom, kept outside the repo) | 20/20 |
| Snap international verify scripts | NOT RUN — 4 pre-existing failures on `main`, unrelated |

No assertion was weakened; the new test's one adjustment was to assert the page `<title>` instead of a substring that legitimately appears in the "curated pairs" payload.

## 12. Lighthouse before and after (live, Lighthouse 13.5 mobile preset, 3 runs, medians)

| Page | Perf before → after (runs) | A11y | BP | SEO | LCP | FCP | TBT | CLS | Speed Index | Bytes | Requests |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Home | 84 (69/86/84) → **79** (78/79/82) | 92 → 92 | 77 → 77 | 100 → 100 | 3.5 → 4.2 s | 1.8 → 1.7 s | 35 → 23 ms | 0 → 0 | 7.2 → 5.8 s | 6.3 → 6.3 MB | 137 → 127 |
| Collection | 63 (75/61/63) → **75** (75/65/75) | 93 → 93 | 77 → 77 | 100 → 100 | 12.4 → 10.2 s | 3.6 → 1.6 s | 30 → 76 ms | 0 → 0 | 6.3 → 2.9 s | 2.4 → 2.1 MB | 178 → 136 |
| Product | 63 (61/64/63) → **71** (73/63/71) | 91 → 91 | 77 → 77 | 100 → 100 | 11.3 → 10.6 s | 3.2 → 2.5 s | 42 → 51 ms | 0 → 0 | 6.5 → 3.5 s | 1.5 → 1.3 MB | 79 → 77 |
| Cart | 79 (80/79/74) → **64** (44/64/77) | 96 → 96 | 77 → 77 | 58 → 58 | 5.5 → 7.0 s | 1.2 → 1.2 s | 42 → 487 ms | 0 → 0 | 2.8 → 2.1 s | 1.5 → 1.3 MB | 65 → 64 |

Reading these honestly: collection and product improved (FCP, Speed Index, bytes, requests); home's median is within its before-noise and its LCP is the "SHOP ALL" text (Chrome ignores full-viewport images as LCP candidates, so the hero change cannot move that metric), while the 4.3 MB hero video is still downloaded inside Lighthouse's observation window because it starts right after `load`; cart's two bad runs come from 500–800 ms hydration long tasks in the React runtime chunk that no code change on that page explains (its only change is the 15 KB logo) — see §12a for the quiet re-run. Best Practices is 77 everywhere for the same reason as this morning: third-party cookies set by the Snap pixel (`sc_at`, tapad id-sync) and the OpenAI Ads SDK (Cloudflare `__cf_bm`/`_cfuvid`). Accessibility and SEO are unchanged. The ≥80 / ≥90 targets are not met.

Reports: `lighthouse/live-before/` and `lighthouse/live-after/` (HTML, 3 runs per page) with `summary.md` in each.

### 12a. Quiet re-run of cart and home (17:40, nothing else running on the audit machine)

| Page | Perf (runs) | LCP | FCP | TBT | Speed Index |
|---|---|---|---|---|---|
| Cart | **74** (74/74/73) | 7.9 s | 1.2 s | 69 ms (39–143) | 3.6 s |
| Home | **80** (62/82/80) | 4.2 s | 1.7 s | 25 ms | 5.8 s |

The cart's 487–789 ms long tasks from the first run did not recur (TBT 39–143 ms), confirming they were contention on the measuring machine, not a page change; cart 79 → 74 and home 84 → 80 are inside the noise band each page showed before any change (cart 74–80, home 69–86). Home run 1 scored 62 with an 11.7 s LCP on the "SHOP ALL" text — the same text-paint variance the baseline showed (69 on one run this morning).

## 13. Confirmed regressions discovered

1. **Product pages HTTP 500 after PR #40** — FAIL at 16:58, fixed by PR #42, verified live 17:25 (§2, §7). No other regression was found in §5–§11.

## 14. Fixes implemented and files changed (today)

- PR #42 (merged): `app/products/[id]/page.tsx`, `lib/shopify-admin.ts` restored to `4e3133e6`.
- This branch (`regression-audit`, unmerged): `scripts/catalog-cache-test/{run.sh,fake-shopify.cjs,README.md}` (new regression test), `lighthouse/live-after/` evidence, this report.
- Earlier today (merged, unchanged by this audit): PR #36–#39 payment and sync fixes, PR #40 remaining performance changes.

## 15. Tests that failed or could not be completed

- Real Razorpay payment, order creation from a browser, Shopify order creation for a new order: NOT VERIFIED end to end (no sandbox keys; would charge/create real records). Harness coverage only.
- DigitalOcean server logs after the restore: NOT VERIFIED (no access); local log of the identical build is clean.
- Logout on the live site: NOT VERIFIED (would sign the owner out of their session).
- Discount-code application, paid-shipping tiers, checkout refresh/back: NOT VERIFIED.
- iOS Safari hero autoplay after the deferred load: emulation only.
- Snap verify scripts: pre-existing failures, not run.

## 16. Remaining risks and recommended actions

1. RISK (pre-existing, found today): the product page's "curated pairs" rail is built from the 12 newest products regardless of status, so draft/unpublished products (4 in today's live payload) can appear, and the self-exclusion compares the numeric id with the URL handle so the product can recommend itself. One-line fixes each; not applied (outside the authorised scope).
2. RISK (pre-existing): single Shopify Admin GETs have no abort timeout; a hung Shopify request blocks a product render until the socket times out.
3. RISK (new, accepted): collection pages can be up to 120 s staler than before when a webhook does not fire; catalogue webhooks make changes immediate (verified locally).
4. Home-page Lighthouse LCP is the "SHOP ALL" text; the hero video still downloads during the lab run. If the score matters, the next lever is a phone-sized hero video in the CMS (`heroVideoMobile`) and starting it on first interaction instead of after `load`.
5. Best Practices ≥ 90 needs a decision on the Snap/OpenAI pixel cookies (options in `PERFORMANCE_AUDIT_REPORT.md` §12).
6. OpenAI pixel events to `signals.birch.click` are blocked by the CSP (console errors on every page); confirm the official endpoints before allow-listing.
7. Add `scripts/catalog-cache-test/run.sh` to the pre-merge routine for any change to catalogue routes or caching (it would have caught today's outage).

## 17. Is it safe to proceed with further performance optimisation?

Yes, with two conditions: (a) any change that makes a route cached/static must first pass `scripts/catalog-cache-test/run.sh` and a check with real-shaped data (metafields, media), and every Shopify call on that route's path must be in the cached "catalog" mode; (b) merges stay one route at a time with a rollout watch on the affected URLs. The current production state is functionally sound; the remaining performance work is optional and should not be rushed.
