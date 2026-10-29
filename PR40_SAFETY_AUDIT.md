# PR #40 pre-merge safety audit

Date: 2026-10-29 · PR: https://github.com/ZIBILA/zb-app/pull/40 · head `perf-audit` @ `424e886e` → base `main` @ `e54a44da` (merge-base `4e3133e6`, so the PR diff is exactly the one commit listed below).

Classification used throughout: **VERIFIED PASS** (executed and observed), **VERIFIED FAILURE** (executed, failed), **POTENTIAL RISK** (reasoned from code, not reproduced, or pre-existing), **NOT TESTED**.

Nothing was committed, pushed, merged or deployed during this audit. No production configuration was touched. The only working-tree change is a two-line cleanup in `components/HeroVideo.tsx` (see §2.4); the pre-existing untracked `PR_DESCRIPTION.md` (28 Oct, not mine) was left alone. A temporary edit to `data/store-settings.json` used to render a hero video locally was reverted with `git checkout` and is not in the diff.

## 1. Every modified file and its purpose

| File | Change | Why |
|---|---|---|
| `app/collections/[handle]/page.tsx` | `generateStaticParams(){return []}` + `dynamicParams=true`; a failed Shopify lookup throws, a missing handle calls `notFound()`; card-sized products/collections passed to the client components | the route rendered on every request (`Cache-Control: private, no-store`); `revalidate = 120` had no effect |
| `app/products/[id]/page.tsx` | same ISR exports; product lookup with `throwOnError`; a lookup error throws; card-sized "curated" products | same, `revalidate = 60` had no effect |
| `lib/shopify-admin.ts` | `fetchProductByHandle(handle, { throwOnError })` — opt-in rethrow after the existing retries; the other caller (`app/api/app/products/[handle]`) keeps the old null/placeholder behaviour | lets the ISR page distinguish "Shopify said no" from "Shopify failed" |
| `app/page.tsx` | server-side react-dom `preload()` of the hero poster removed; card-sized products/collections to the grids and carousel | the Flight hint was replayed on every other page via the logo link's prefetch (138 KB poster on cart/collection/product); smaller HTML |
| `components/HeroVideo.tsx` | poster is a priority `<Image sizes="100vw">`; `<video preload="none">` without a `poster` attribute; `<source>` tags attached after `window.load` + idle (4 s cap) | the 4.3 MB MP4 no longer competes with the first paint; the poster becomes the LCP candidate |
| `components/ProductCardImage.tsx` | blur preview `<img>` lazy for non-priority cards; next/image `placeholder="blur"` only on the eagerly loaded cards; no blur background on the hidden hover image | two placeholder requests per card → one, and none for off-screen cards |
| `lib/storefront-card-product.ts` (new) | `toCardProduct(s)` / `toCardCollection(s)`: same TypeScript shape, `body_html`/`options`/`metafields`/full image records emptied, `tags` kept | 893 KB collection HTML and 462 KB home HTML carried fields the cards never read |
| `lib/geolocation-enrichment.ts` | the client-side Google Maps reverse-geocode step removed; server `/api/geo/reverse` used directly | the Maps key is referrer-restricted to checkout, so this always failed with `RefererNotAllowedMapError` after downloading the SDK |
| `public/zb-logo-220px.png` | lossless re-encode 34,236 → 15,282 bytes (pixel-identical, verified) | requested on every page |
| `PERFORMANCE_AUDIT_REPORT.md`, `lighthouse/live-before/*`, `lighthouse/local-*/summary.md` | reports and evidence | documentation only |

Not touched (verified by `git diff --name-only`): `.env*`, `next.config.mjs`, `middleware.ts`, `package.json`, `prisma/`, CI/deploy files, every file under `app/api/checkout`, `app/api/webhooks`, `app/api/payments`, `app/api/razorpay`, `app/checkout`, `lib/services`. No module changed by the PR is imported by any payment, webhook, cart-API or checkout code (grep over those trees: no matches).

## 2. Change-by-change review (what it did, what it does, what could be affected, evidence)

### 2.1 ISR for `/collections/[handle]` and `/products/[id]`
- **Before:** both routes exported `revalidate` but had no `generateStaticParams`, which Next.js 14 treats as "render on every request". Live headers: `Cache-Control: private, no-cache, no-store`; Shopify calls on every visit.
- **After:** on-demand ISR. First visit to a path renders and caches it (`x-nextjs-cache: MISS`), later visits are served from the cache (`HIT`, ~4 ms) and refreshed in the background after 120 s / 60 s (`STALE` then regenerate). The build now lists both routes as ● (ISR).
- **Affected behaviours:** freshness of catalogue pages (bounded by the existing `revalidate` values plus the pre-existing 300 s Shopify data cache); behaviour during a Shopify outage; what happens for unknown handles.
- **Evidence:** §3 and §4 below (fake Shopify Admin backend with a fixture catalogue, failure and slow switches, request log).

### 2.2 Failure handling on the ISR pages (the HTTP 500 question)
- **Before (dynamic rendering):** a Shopify failure was swallowed; the product page rendered "Product Not Found" (or a placeholder product from the local fallback catalogue) with HTTP 200; the collection page returned 404. Nothing was cached, so the next request retried.
- **First attempt in this PR:** `unstable_noStore()` on the not-found path. VERIFIED FAILURE on the local build: Next 14 refuses a static→dynamic switch at runtime ("Page changed from static to dynamic at runtime … unstable_noStore()") → HTTP 500 for every unknown handle. Replaced before the PR was opened.
- **Current implementation:** the product lookup is fetched with `throwOnError`; if it rejects, the page throws (`Product lookup failed`); the collection page throws when `fetchCollectionByHandle` failed. Next.js does not cache a render that threw, so the next request retries. A handle Shopify genuinely does not know renders the not-found page and is cached, which is correct.
- **What a shopper sees during an outage:** Next's generic "500 | Internal Server Error" page (the route's `error.tsx` boundary is not used for a static/ISR render). VERIFIED on the fake backend: uncached handle during a simulated outage → 500 after the existing three retries (7.6 s), `Cache-Control: no-store`; cached handles kept serving (HIT); after recovery the same handle → MISS → 200 → HIT. POTENTIAL RISK (UX only): an unbranded 500 page instead of today's misleading "Product Not Found"/placeholder page. Both are failure states; the new one is honest and never cached.
- **Unknown handles never reach the page in production:** `middleware.ts` rewrites unknown product/collection handles to a real 404 using `/api/products/handles` and `/api/collections/handles` (unchanged). VERIFIED locally for `/products/nope-zzz`, `/collections/nope-zzz`, `/products/foo.json`, `/products/%ZZ`, `/products/delta-draft` (draft product), `/products/9999999`: all 404 with `no-store`. Live today: the same URLs return 404 (and `%ZZ` 400 at the edge).

### 2.3 `fetchProductByHandle({ throwOnError })`
- Default behaviour (null / fallback catalogue) unchanged for the mobile API route. With the flag, after the existing retries the error is rethrown unless the handle exists in the local fallback catalogue (dev resilience preserved). VERIFIED: numeric-id handles (`/products/1001`) still resolve through `fetchProductById`; type-check passes.

### 2.4 HeroVideo
- **Before:** `<video autoplay preload="metadata" poster=…>` with inline `<source>` tags → the browser fetched the whole 4.3 MB MP4 during page load; the poster was not an LCP candidate.
- **After:** a responsive poster `<Image priority sizes="100vw">` under the video; the video has `preload="none"` and gets its `<source>` tags after `window.load` + idle (4 s cap), then `load()` and plays when in view; mute toggle and in-view pause/resume unchanged.
- **Evidence:** (a) DOM test with jsdom (20 checks): SSR markup, no sources before load, sources attached in the right order (mobile `media` first), `load()` then `play()` when visible, pause when scrolled out, resume, mute toggle, 4 s cap path, `showControlOnly` and no-poster variants — all pass. The test found one redundancy (play() called twice); fixed by removing the duplicate call in the working tree (the two-line uncommitted diff). (b) In a real page (local build with the live hero media): desktop poster served at 1920 px (106 KB), mobile at 750 px; video gets its source after `load` (MP4 requests start ~170 ms after the load event), `readyState 4`, playing (`currentTime` advancing), `paused: false`, CLS 0, hero text card and mute button render; no console errors from the hero.
- VERIFIED PASS. NOT TESTED: iOS Safari autoplay after a late `load()` (emulation only); to be watched on the live home page after deploy.

### 2.5 ProductCardImage
- Only loading hints changed (`loading="lazy"`/`decoding="async"` on the blur `<img>`, blur background only for priority cards, none on the hidden hover image). Rendering, hover, swipe and sold-out styling untouched. The other consumer (`SearchProductCardEditorial`) passes `priority` and is unaffected. VERIFIED PASS visually on home, collection and search pages (live) and on the fake-backed local build.

### 2.6 Card-sized product payloads
- Fields read by the consumers (grep of `ProductCard`, `ProductCardImage`, `QuickAddModal`, `CollectionProductGrid`, `CollectionBrowseClient`/`CollectionFilters`, `CollectionCarousel`, `CollectionHeaderClient`, `MenuDrawer`, `StorefrontHeader`, and the PDP "curated pairs" rail): `id, handle, title, product_type, tags, image.src, images[].src/id, variants[].id/title/price/compare_at_price/inventory_quantity/option1, created_at` — all preserved. The product page itself still receives the full product. VERIFIED PASS: collection pages render the right members with prices and sizes; quick-add and add-to-bag use the right variant ids and prices (cart totals correct); the HTML no longer contains product descriptions for cards.

### 2.7 Geolocation enrichment
- Only the Google Maps step was removed; the server geocoder, cookie pipeline and pixel init are unchanged. Checkout's own Maps loader (`app/checkout/page.tsx`) untouched. VERIFIED PASS: no Maps script and no `RefererNotAllowedMapError` on the local product pages; `parseGeoAddressComponents` is still exported for other callers.

### 2.8 Home page
- `preload()` removal and card-sized products. VERIFIED PASS: the local home HTML has no hero preload leak on other pages (the live cart/product/collection pages fetched the 138 KB home poster before), 16 product cards still render (6 links from the 3-product fixture), carousel renders.

## 3. Product and collection caching — test results (fake Shopify Admin backend, final build)

Method: a local HTTPS fake of the Admin REST/GraphQL API with 3 active products + 1 draft and 2 collections, switchable to `fail` (HTTP 500) and `slow` (15 s), with a per-endpoint request log; `next start` pointed at it via `SHOPIFY_STORE_DOMAIN`. Scripts in the session scratchpad (`fake-shopify/matrix.sh`, `webhook-test.sh`).

| Check | Result |
|---|---|
| Correct data per route: Alpha Tee page has its title/price/description/sizes and not Beta's description; Beta's page has its own; Alpha again after Beta still Alpha; numeric-id route resolves | VERIFIED PASS |
| No cross-contamination between products/collections (collection membership exact: new-arrivals = alpha+beta, denims = beta+gamma, all = three; draft product never listed) | VERIFIED PASS |
| Cache lifecycle: MISS → HIT; HIT responses make no Shopify requests (request log flat); STALE after `revalidate` with background regeneration | VERIFIED PASS |
| Transient Shopify 500 is never cached: cached pages keep serving (HIT), uncached page → 500 `no-store`, recovery → MISS 200 → HIT | VERIFIED PASS |
| Error responses never stored as product data (regen after an error fetches fresh data) | VERIFIED PASS |
| Unknown / malformed handles → 404 via middleware, `no-store`, never 500 | VERIFIED PASS |
| Cache invalidation on catalogue change (production path): signed `products/update` webhook → `refreshStorefront()` → product page MISS with the new title, collection page MISS with the new title, numeric-id route too; request log shows fresh Shopify fetches; bad signature → 401 | VERIFIED PASS |
| Time-based freshness without a webhook: page stale-while-revalidate after 60 s but the regenerated page still carries the old title because the Shopify data cache (`next.revalidate: 300`, pre-existing) and the in-memory 3-minute cache served it; i.e. without webhooks a change can take up to ~5 min + 60/120 s to appear | VERIFIED (pre-existing policy; the PR adds at most the 60/120 s page layer) |
| Customer-specific data in cached HTML: the pages read no cookies/headers/session (a `dynamic = "error"` run in dev found no dynamic API usage); cart, wishlist, session are fetched client-side after load | VERIFIED PASS |
| Auth/cart/checkout/payment responses not cached: `/api/auth/session` `private, no-cache, no-store`; `/api/cart/me` 401 without session; `/cart` and `/checkout` are static client-rendered shells with no customer data (unchanged) | VERIFIED PASS |
| Shopify timeout (hang) | NOT TESTED realistically: the single-GET path in `lib/shopify-client.ts` has no abort timeout (pre-existing; only paginated list fetches have a 12 s abort). The fake's "slow" mode returned an empty body after 15 s, which the client correctly treated as "no such product" (cached 60 s) — an artificial combination. A real hang would block the first render until Node's socket timeout, exactly as today. |

## 4. HTTP 500 regression — resolution

Root cause: `unstable_noStore()` inside an ISR render. Replaced by explicit failure propagation (§2.2). Re-tested on the final build: valid handles 200 MISS/HIT; unknown handles 404 (middleware); Shopify failure → 500 `no-store` for the single uncached request, never cached, self-healing on the next request; cached pages unaffected during the outage. No broad try/catch was added; the only `catch` introduced records the lookup error and rethrows after the page decides.

## 5. Cart and checkout regression

| Journey | Result |
|---|---|
| Live (your signed-in Chrome, desktop): collection → product → size → Add to Bag → drawer +/− (totals ₹1,19,230 ↔ ₹1,25,879) → cart page → Proceed to Checkout → address step in 399 ms, 11 API calls, no duplicates, no long tasks | VERIFIED PASS (earlier today, unchanged code paths) |
| Local build + fake catalogue, desktop: collection → Beta Denim → size 28 → Add to Bag → drawer qty 2 (₹8,998) → Checkout → `/checkout` (test session) → name/email/mobile/address → PIN 201305 auto-fills city "Gautam Buddha Nagar" and state "Uttar Pradesh" → order summary Beta Denim ×2 ₹8,998, shipping FREE, total ₹8,998, "Continue to Payment" enabled | VERIFIED PASS |
| Local build + fake catalogue, 375 px mobile: Denims collection → Gamma Hoodie → size L → Add to Bag → drawer shows Beta Denim ×2 + Gamma Hoodie, total ₹12,497 | VERIFIED PASS |
| Local build, mobile: test-account OTP login (demo mode, local only) → `/checkout` → address form + PIN lookup | VERIFIED PASS (earlier today) |
| Payment initiation ("Continue to Payment" → Razorpay order pre-create → Razorpay checkout) | NOT TESTED in a browser: it would create an order on the live Razorpay account (no sandbox keys available). Covered by the offline harnesses in §6. |
| Checkout transition timing (reported slow earlier) | unchanged by this PR; measured today at 399 ms to the address step on live |

Local-only console noise (not regressions): `/api/cart/me` and `/api/customers/me/default-address` return 500 under the mock database, `/api/snap/event` 400 without a Snap id. On live these return 200.

## 6. Razorpay and Shopify order integration

- Static: no file under the payment, webhook, order-sync or checkout trees changed; none imports a changed module (grep). Amount calculation, order reference, server-side signature verification, webhook HMAC + idempotency, capture confirmation, status transitions and Shopify order creation/sync are untouched.
- Dynamic: offline harnesses that run the real route handlers (`/api/checkout/razorpay`, `/api/checkout/complete`, `/api/checkout/cancel`, both Razorpay webhook routes, Shopify order sync, GraphQL pricing) against an in-memory database and fake providers, re-run on the final code: `scripts/payment-e2e/audit-run.ts` **56 passed / 0 failed**, `run.ts` **191 / 0**, `meta-run.ts` **126 / 0**. These cover amount re-pricing, signature verification, replay/duplicate callbacks, underpaid holds, failure paths and the sync fast path.
- Shopify catalogue webhook route: signed `products/update` accepted and acted on, bad signature rejected with 401 (VERIFIED on the local build).
- VERIFIED PASS for everything above; live payment initiation NOT TESTED (see §5).

## 7. Build, lint, type-check, automated tests

| Check | Result |
|---|---|
| `npx tsc --noEmit` (final code incl. the working-tree cleanup) | VERIFIED PASS |
| `npm run lint` | VERIFIED PASS — 0 errors, pre-existing warnings only |
| `npm run build` (three times during the audit; last with the cleanup) | VERIFIED PASS — `/collections/[handle]` and `/products/[id]` now ● ISR |
| Payment / sync / tracking harnesses | 56 + 191 + 126 passed, 0 failed |
| HeroVideo DOM test (jsdom, 20 checks) | VERIFIED PASS |
| Caching matrix + webhook invalidation (fake backend) | VERIFIED PASS (§3) |
| Snap international verify scripts | NOT RE-RUN — 4 failures pre-exist on `main` (confirmed earlier in a clean worktree), unrelated to this PR |

No test was weakened, skipped or edited; the temporary DOM test and the fake backend live outside the repository.

## 8. Chrome / browser testing results

Browsers: your signed-in Chrome (desktop) for the live site; the desktop app's built-in browser (desktop and 375 px Pixel emulation) for the live site as a guest and for the local build. Results in §2.4, §2.5, §2.8 and §5. Console: no first-party errors on live pages other than the pre-existing OpenAI-pixel CSP messages and (before this PR) the Google Maps error on product pages; no failed first-party requests on live.

## 9. Tests that could not be completed

- Live "after" Lighthouse and the live hero/video behaviour: need the deploy.
- Payment initiation in a browser (live Razorpay order creation) — no sandbox.
- A realistic Shopify hang (no abort timeout on single GETs, pre-existing).
- Admin "Refresh live site" button end-to-end on the local build: the middleware reads the production `__Secure-` session cookie name, which plain-http local servers cannot set; the same `refreshStorefront()` function was exercised through the webhook route instead.
- iOS Safari autoplay after the deferred `load()` (emulation only).

## 10. Remaining risks and recommended actions

1. POTENTIAL RISK (new, UX): a Shopify outage on an *uncached* product/collection page shows Next's generic 500 page instead of a branded page; nothing is cached and it self-heals. Cached pages keep serving during the outage, which is better than today.
2. POTENTIAL RISK (new, freshness): catalogue pages can be up to 60 s (product) / 120 s (collection) staler than today when a webhook does not fire; webhooks make changes immediate (verified). The pre-existing 5-minute Shopify data cache dominates either way.
3. POTENTIAL RISK (pre-existing, found during the audit, not changed): `fetchProducts(12)` on the product page returns the 12 newest products regardless of status, so **draft/unpublished products appear in the "Curated pairs" rail** (4 draft products are in today's live product-page payload; the local fake showed "DELTA DRAFT ₹999" in the rail), and the rail includes the product itself because the self-exclusion compares the numeric id with the URL handle. One-line fix each (`isStorefrontEligible` filter; compare `p.handle`), but outside this PR's scope — say the word and I will add them.
4. POTENTIAL RISK (pre-existing): single Admin GETs have no abort timeout.
5. After deploy: watch the first requests to product/collection pages (first visit per path per instance renders), confirm `x-nextjs-cache: HIT` on repeat visits, confirm the home hero plays on an iPhone, and re-run the Lighthouse baseline command.

## 11. Is the branch safe to consider for merging?

Yes, with the two-line HeroVideo cleanup committed first (or dropped — it only removes a redundant `play()` call; the component works either way). Rationale: the diff is confined to storefront rendering and caching; payment, order, webhook, auth and checkout code is untouched and its harnesses pass; data correctness, cache isolation, failure handling and invalidation were exercised against a controlled backend; the one regression found during development (HTTP 500 for unknown handles) was fixed and re-tested; the customer journeys pass on live and on the local build. The two new behaviours to accept are the generic 500 page during a Shopify outage on uncached pages and ≤60/120 s of additional staleness without webhooks.

Final state: branch `perf-audit`, HEAD `424e886e` (PR #40), working tree: `components/HeroVideo.tsx` modified (uncommitted cleanup), `PR40_SAFETY_AUDIT.md` (this file, uncommitted), `PR_DESCRIPTION.md` (pre-existing, untracked). Nothing pushed, merged or deployed.
