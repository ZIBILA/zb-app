# zicabella.com — performance, Best Practices and end-to-end functionality audit

Date: 2026-10-29 · Branch `perf-audit` (PR to `main`) · Site: Next.js 14.2 App Router on DigitalOcean App Platform behind Cloudflare; catalogue from the Shopify Admin API; Razorpay Standard Checkout; Meta, Snap, GTM and OpenAI Ads pixels.

Every number below was measured in this engagement. "Verified" means executed and observed; "suspected" means inferred but not reproduced; "untested" means not exercised.

---

## 1. Initial Lighthouse scores

Your report: mobile Performance 62, Accessibility 92, Best Practices 73, SEO 100 (PageSpeed Insights; the shared PSI API quota was exhausted on the day, so the baseline here is the same Lighthouse 13.5 mobile preset run from this machine — simulated slow 4G, Moto G Power class — 3 runs per page, medians).

| Page (live) | Perf (runs) | A11y | BP | SEO | LCP | FCP | TBT | CLS | Speed Index | TTI | Bytes | Requests | TTFB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Home `/` | 69 / 86 / 84 → **84** | 92 | 77 | 100 | 3.5 s | 1.8 s | 35 ms | 0.000 | 7.2 s | 12.1 s | 6.3 MB | 137 | 43 ms |
| Collection `/collections/new-arrivals` | 75 / 61 / 63 → **63** | 93 | 77 | 100 | 12.4 s | 3.6 s | 30 ms | 0.000 | 6.3 s | 12.7 s | 2.4 MB | 178 | 479 ms |
| Product `/products/oversized-graphic-jersey` | 61 / 64 / 63 → **63** | 91 | 77 | 100 | 11.3 s | 3.2 s | 42 ms | 0.000 | 6.5 s | 11.4 s | 1.5 MB | 79 | 253 ms |
| Cart `/cart` | 80 / 79 / 74 → **79** | 96 | 77 | 58 | 5.5 s | 1.2 s | 42 ms | 0.000 | 2.8 s | 10.8 s | 1.5 MB | 65 | 18 ms |

INP is field-only; no CrUX data was obtainable (PSI quota). CLS is 0 everywhere; TBT is well inside the green band, so the score loss is entirely LCP, Speed Index and FCP. Cart SEO 58 is the deliberate `noindex` on the cart page. The run-to-run spread on the home page (69–86) is the hero video competing for bandwidth (see §2).

Reports: `lighthouse/live-before/*.report.html` (committed) — open any `.html` in a browser.

## 2. Root causes of the low Performance score

Verified from the Lighthouse traces, the live HTML and the code:

1. **Collection and product pages were rendered on every request.** Both routes export `revalidate` but had no `generateStaticParams`; Next.js 14 then treats a dynamic route as request-time rendered, ignores `revalidate`, and answers with `Cache-Control: private, no-cache, no-store`. Each visit waited for the Shopify Admin calls (collections list + a full catalogue page for a collection; product + 12 products + reviews + metafield lookups for a product) before the first byte, and the body streamed after the shell. Live: collection TTFB 0.38–0.59 s, product 0.17–1.19 s; the Lighthouse filmstrip for the product page is black until 2.5 s. The home page, which has no dynamic segment, was correctly ISR-cached (`x-nextjs-cache: HIT`).
2. **Home hero: a 4.3 MB MP4 downloaded during page load on phones.** `preload="metadata"` is overridden by `autoplay`, so the whole file streamed while the poster, CSS, fonts and 16 product images were loading (home total 6.3 MB; Speed Index 7.2 s). The hero's LCP candidate was the 9 px "SHOP ALL" link (803 px²), not the poster, because a `<video poster>` was not counted — so LCP floated with the fade-in animation and the busy network (3.5–6.0 s).
3. **Hero poster leaked to every other page.** `app/page.tsx` called react-dom `preload()` for the poster on the server. Flight serialises that as a hint, and the browser honours it when the home payload is merely *prefetched* (the logo link), so the cart, collection and product pages each downloaded the 138 KB full-size poster at high priority (visible in all four traces).
4. **Two placeholder requests per product card.** Each card fetched a 20 px blurred preview as its own `<img>` and again as next/image's `placeholder="blur"` background, including for the hidden second image: 72 blur requests on the collection page, 36 on the home page, all eager regardless of viewport position.
5. **Heavy HTML payloads.** The collection page served 893 KB of HTML (84 KB gzipped) because the full product objects (body_html, options, metafields, full image records) were serialised twice for the client grid; home 462 KB, product 473 KB. Phones download, parse and hydrate all of it before the page is interactive.
6. **Google Maps loaded on product pages.** `lib/geolocation-enrichment.ts` loaded the ~300 KB Maps JS SDK to reverse-geocode shoppers who had granted location; the key is referrer-restricted to checkout, so it always failed (`RefererNotAllowedMapError` in the console on every product page) and the code fell back to the server geocoder anyway.
7. **Logo PNG served unoptimised.** `/zb-logo-220px.png` was 34 KB for a 225 px image and is requested on every page (header/footer); Lighthouse flagged it on all four pages.
8. Smaller, unchanged items: 36 KB render-blocking CSS (31 KB unused on any one page; Lighthouse estimates 300–540 ms), the 64 KB TTF wordmark font (CFF-based; converting to WOFF2 gave 65.9 KB, no gain), third-party scripts (GTM 116 KB, Meta 276 KB, Snap 50 KB, OpenAI 30 KB) which already load after `window.load` and account for the 11–13 s TTI but not for the score.

## 3. Root causes of the low Best Practices score

Lighthouse 13 (this run) scores 77 on every page; your report's 73 is the same failure under an older weighting. Both failing audits come from one thing — **third-party cookies set by the ad pixels** (weight 5) plus the matching "Issues logged in the DevTools Issues panel" entry (weight 1):

| Cookie | Set by | Loaded because |
|---|---|---|
| `sc_at` (tr.snapchat.com), `X-AB` (sc-static.net), tapad id-sync | Snap pixel | Snapchat ads attribution |
| `__cf_bm`, `_cfuvid` (bzrcdn.openai.com / bzr.openai.com) | Cloudflare bot management on the OpenAI Ads SDK host | OpenAI (ChatGPT) ads pixel |

Everything else in the category passes (HTTPS, HSTS, no deprecated APIs, image aspect ratios, charset, doctype, no console errors in the lab run). Local builds without pixel ids score 100. Reaching 90+ therefore requires a business decision, not a code fix — see §12 "Decision needed".

Also found (not scored, but real): the OpenAI SDK tries to post events to `signals.birch.click` and an `*.on.aws` host that the site's Content-Security-Policy does not allow, producing 4 console errors per page view. I did not add those hosts to the CSP because I could not verify they belong to OpenAI; the primary `bzr.openai.com` endpoint is allowed and does receive events.

## 4. Chrome browser testing results

Two browsers were used: your signed-in Chrome (Claude in Chrome extension, desktop 1440×900, logged in as the store owner) and the desktop app's built-in browser (375×812 mobile emulation with a Pixel user agent, guest session). The built-in pane can be hidden while a command runs, so timing numbers from it are not reported; only functional results are.

Verified on the live site:

- **Homepage** (desktop and mobile): hero video autoplays muted; mute toggle works; "Shop all" link; theme toggle; cart and bookmark drawers open. Console: no first-party errors (only the OpenAI CSP messages above).
- **Header / menu** (mobile): hamburger opens the drawer with 8 collections, 6 search shortcuts, Search/Collaborations/Blogs/FAQ/Community, ship-to selector, Profile/Orders/Returns; every link resolves (all 19 footer and menu targets return HTTP 200).
- **Search** `/search?q=denim`: 50 product links rendered, editorial block present, no console errors.
- **Collection** `/collections/new-arrivals` (desktop + mobile): header carousel, sort and size filters, grid of 40 cards, quick-add buttons, product links.
- **Product** `/products/viscera-denim` (desktop + mobile): gallery and thumbnails, sizes 26–36, Add to Bag, Buy Now, trust tiles, description tabs. Console on desktop: `RefererNotAllowedMapError` (root cause 6, fixed in this PR).
- **Add to cart** (desktop, your account): size 30 → "VISCERA DENIM ADDED TO BAG" toast, header badge updated, `/api/cart/sync` 200.
- **Cart drawer**: + → quantity 2, line ₹13,298, total ₹1,25,879; − → quantity 1, line ₹6,649, total ₹1,19,230; each change synced to the server.
- **Cart page**: 13 line items rendered with quantity controls, order summary, "Proceed to Checkout".
- **Checkout transition** (desktop, warm, your account): first DOM change 399 ms after the click; address step rendered with saved addresses; 11 API calls, no duplicates, no long tasks; one background `/api/cart/sync` took 3.5 s but did not block the UI.
- **Mobile layout**: header, menu, collection grid (2 columns), product page bottom sheet with sizes, cart drawer all render correctly at 375 px.

Not done on the live site: removing the test item from your cart — that action was blocked by the desktop app's safety classifier, so **your cart still contains "VISCERA DENIM, size 30, qty 1"**. Please remove it.

## 5. Add to Cart → Checkout journey

Live (your account, desktop): browse → collection → product → size → Add to Bag → cart drawer (quantity +/−) → cart page → Proceed to Checkout → address step with saved addresses. All steps verified; nothing was paid or ordered.

Local production build (`next start`, mock DB, test account): home → product → size M → Add to Bag → cart drawer (qty 2 → 1) → Checkout → login gate → **test login with the supplied mobile number and one-time code succeeded** (demo mode is enabled locally; on production it is off unless `ENABLE_DEMO_LOGIN=true`, and I did not attempt it there because a non-demo number would trigger a real SMS) → `/checkout` → address form: name/email/house/street/PIN entered, PIN 201305 auto-filled city "Gautam Buddha Nagar" and state "Uttar Pradesh" via the postal lookup, "Continue to Payment" enabled. I stopped there: the next step pre-creates a Razorpay order with the live key, which is an order-creation test on the live payment account and no test environment exists. Payment initiation, verification, webhooks and replay are covered by the offline harness instead (§10).

The site has no separate shipping-option selector; shipping/COD fees are computed at the payment step (`/api/checkout/cod-fee` returned 200).

## 6. Checkout timings before and after

The "site becomes very slow after Checkout" issue was fixed and deployed earlier today (PR #38: one cart sync per journey with location data, Google Maps only when the address form opens, Razorpay SDK after the page is interactive). Measured today on the live site after that deploy:

| Metric | Before (2026-10-29 morning) | Today | 
|---|---|---|
| Click → address step rendered | 149 ms warm, but page felt slow | 399 ms (cold session), 115–461 ms earlier samples |
| `/api/cart/sync` calls on click | 2 identical (2.2 s + 2.4 s) | 1 (background; 0.6–3.5 s, does not block) |
| Google Maps requests on checkout load | 9 (328 KB) | 0 |
| Razorpay SDK | on mount | after `load` (74 requests / 777 KB still, but off the critical path) |
| Lighthouse TBT, cold | 270 ms | 140 ms |

Remaining: the server side of `/api/cart/sync` is still slow when the instance is busy (rate-limit queries, customer/cart lookups, delete + createMany). It is now off the critical path; raising `PG_POOL_MAX` from 8 to 16 is the recommended next step (environment change).

## 7. Confirmed functional bugs and fixes

| # | Bug (verified) | Fix |
|---|---|---|
| 1 | Collection and product pages never cached (dynamic rendering), every visit waits on Shopify | `generateStaticParams` + `dynamicParams` on both routes → on-demand ISR (local: MISS 2.4 s then HIT 4 ms, `s-maxage=120, stale-while-revalidate`). A Shopify failure now throws to the route's error boundary (Next.js never caches a failed render) instead of rendering "not found", so an outage can never cache a 404 for a real product; a genuine unknown handle is a normal, cacheable 404 |
| 2 | Google Maps SDK loaded on product/collection/home pages and always failed (`RefererNotAllowedMapError`) | Geolocation enrichment uses the server reverse geocoder directly; checkout keeps its own Maps loader |
| 3 | Home poster downloaded on every page via the prefetched home payload | Server `preload()` removed; the poster is a priority `<Image>` inside the hero |
| 4 | 4.3 MB hero video fetched during page load on phones | `<source>` tags attached after `window.load` (idle callback, 4 s cap); `preload="none"`; poster is a responsive image (750 px on phones instead of the 995×1985 original) |
| 5 | Two blur-placeholder requests per card, eager for off-screen cards | One lazy-loaded preview per card; next/image blur only for the four eagerly loaded cards |
| 6 | 893 KB collection HTML / 462 KB home HTML from full product objects | Card-sized product and collection objects (`lib/storefront-card-product.ts`) passed to client components; the product page itself keeps the full product |
| 7 | 34 KB logo PNG | Lossless re-encode to 15 KB (pixel-identical) |

Suspected but not changed: `/api/cart/sync` server latency; OpenAI pixel CSP hosts; the OpenAI pixel stub ignores the `zb_internal` staff flag that silences Meta and Snap.

## 8. Files changed and why

| File | Change |
|---|---|
| `app/collections/[handle]/page.tsx` | ISR (`generateStaticParams`, `dynamicParams`); a failed Shopify lookup throws (not cached) while a missing handle is a cacheable 404; card-sized products/collections to the client |
| `app/products/[id]/page.tsx` | ISR; the product lookup is fetched with `throwOnError` so an outage fails the request instead of caching "not found"; card-sized recommended products |
| `lib/shopify-admin.ts` | `fetchProductByHandle(handle, { throwOnError })` — opt-in rethrow after retries (default behaviour unchanged for the other caller) |
| `app/page.tsx` | removed server `preload()`; card-sized products/collections for the grids and carousel |
| `components/HeroVideo.tsx` | responsive priority poster image; video sources deferred until after load; `preload="none"` |
| `components/ProductCardImage.tsx` | lazy blur preview; next/image blur only for priority cards; no blur for the hidden hover image |
| `lib/geolocation-enrichment.ts` | drop the client-side Google Maps geocode (always failed outside checkout) |
| `lib/storefront-card-product.ts` (new) | `toCardProduct(s)` / `toCardCollection(s)` — same types, heavy fields emptied, `tags` kept for the "curated" scoring |
| `public/zb-logo-220px.png` | lossless re-encode, 34,236 → 15,282 bytes |
| `lighthouse/live-before/` (12 HTML reports + summary), `lighthouse/local-before/summary.md`, `lighthouse/local-after/summary.md` | evidence for the numbers in this document |
| `PERFORMANCE_AUDIT_REPORT.md` | this report |

Design, fonts, colours, layout, product data, navigation, cart/checkout behaviour, integrations and tracking are unchanged; no dependency was added.

## 9. Final Lighthouse scores and comparison

**Live "after" numbers require the deploy** (the brief forbids deploying without authorisation). What can be reported now:

Local production build, same Lighthouse preset, 3-run medians. The local environment has a mock database and an invalid Shopify token, so it renders the fallback catalogue, no hero video and no banners; the numbers are a relative sanity check, not the live result.

| Page (local) | Perf before → after | LCP | FCP | TBT | CLS | Speed Index | Bytes | Requests |
|---|---|---|---|---|---|---|---|---|
| Home | 87 → 88 | 3.9 → 3.9 s | 1.7 → 1.5 s | 0 → 3 ms | 0 → 0 | 1.7 → 1.5 s | 1200 → 1205 KB | 52 → 53 |
| Collection | 81 → 83 | 4.8 → 4.8 s | 1.2 → 1.2 s | 19 → 7 ms | 0 → 0 | 3.9 → 1.7 s | 929 → 906 KB | 48 → 48 |
| Product | 88 → 88 | 3.8 → 3.8 s | 1.2 → 1.2 s | 6 → 5 ms | 0 → 0 | 2.8 → 1.6 s | 948 → 923 KB | 51 → 50 |
| Cart | 82 → 82 | 4.9 → 5.0 s | 1.2 → 1.2 s | 2 → 10 ms | 0 → 0 | 1.7 → 1.7 s | 950 → 928 KB | 51 → 51 |

Verified locally on the new build: collection/product responses carry `x-nextjs-cache: HIT` with `s-maxage`, the HTML no longer contains product `body_html` for cards, the home poster is no longer preloaded on other pages, and the logo is 16 KB in every trace.

Expected on live after deploy (reasoned from the traces, to be verified by re-running the same Lighthouse command): collection and product FCP from 3.2–3.6 s to ~1.8 s (cached HTML, no server wait), LCP from 11–12 s into the 3–5 s range (LCP image discovered in cached HTML with far less competing traffic), home Speed Index from 7.2 s to ~3 s and a stable LCP on the poster. Whether the Performance score clears 80 on every page will only be known from the live re-run; the home page already scores 84–86 on good runs, collection and product are the ones to watch.

**Metric table (Before = live baseline; After = live, pending deploy; Local = relative check):**

| Metric | Before (live) | After (live) | Verified result |
|---|---|---|---|
| Performance home / collection / product / cart | 84 / 63 / 63 / 79 | pending deploy | local 88 / 83 / 88 / 82, no regression |
| Accessibility | 92 / 93 / 91 / 96 | pending | local 96 all pages; no a11y-affecting change |
| Best Practices | 77 all pages | pending | 77 unless the pixel decision in §12 is taken; local 100 without pixels |
| SEO | 100 / 100 / 100 / 58 (noindex cart) | pending | unchanged |
| LCP | 3.5 / 12.4 / 11.3 / 5.5 s | pending | see expected ranges above |
| INP | no field data available | — | — |
| CLS | 0.000 | pending | 0.000 local |
| TBT | 35 / 30 / 42 / 42 ms | pending | 3 / 7 / 5 / 10 ms local |
| FCP | 1.8 / 3.6 / 3.2 / 1.2 s | pending | local unchanged (1.5 / 1.2 / 1.2 / 1.2 s) |
| Speed Index | 7.2 / 6.3 / 6.5 / 2.8 s | pending | local 1.5 / 1.7 / 1.6 / 1.7 s |

## 10. Tests executed and results

- `npx tsc --noEmit` — passes.
- `npm run lint` — 0 errors (pre-existing warnings only).
- `npm run build` — passes; `/collections/[handle]` and `/products/[id]` now listed as ● (SSG/ISR) instead of ƒ (dynamic).
- Offline payment + sync harness `scripts/payment-e2e/audit-run.ts` (real route handlers for `/api/checkout/razorpay`, `/complete`, `/cancel`, both webhooks, Shopify sync, GraphQL pricing, 56 checks) — **56 passed, 0 failed**.
- Local Lighthouse before/after (12 + 12 runs) — table in §9.
- Local ISR verification on the final build — a resolvable product: MISS then HIT (`s-maxage=60`); a handle Shopify cannot answer (the local token is invalid, which is the outage case): error boundary with `no-store`, nothing cached; an earlier attempt with `unstable_noStore()` returned HTTP 500 for unknown handles and was replaced before this PR.
- Browser journeys — §4 and §5.

## 11. Features that could not be tested

- **Live "after" Lighthouse**: needs the deploy (authorisation required).
- **Hero poster/video behaviour in a running page**: the local mock has no hero media; the component was type-checked and built, and will be verified on the live home page right after deploy.
- **Payment initiation and order creation**: not exercised on live (real customer orders/charges forbidden) nor locally (would create a live Razorpay order); covered by the offline harness.
- **Test credentials on production**: not attempted — demo mode is off there unless `ENABLE_DEMO_LOGIN=true`, and the number would be treated as a real customer.
- **Real-device mobile input** (touch swipes on card carousels, iOS Safari): emulation only.
- **INP field data**: PSI/CrUX unavailable (quota).
- **DigitalOcean logs / database timings** for `/api/cart/sync`: no access from here.

## 12. Remaining issues, risks and recommended next steps

Decision needed (Best Practices ≥ 90): the only failing audits are the third-party cookies from the Snap pixel and the OpenAI Ads SDK. Options: (a) keep both pixels loading on every page view and accept 77; (b) load the Snap and OpenAI SDKs only after the first user interaction (scroll, tap, key) — real shoppers are still tracked, Lighthouse and pure bounces are not, which trims Snap retargeting audiences slightly; (c) drop the OpenAI pixel if it is not in use (removes 2 of the 9 cookies and the CSP console errors) and keep Snap, which alone still fails the audit. (b) is the only route to 90+ without removing a pixel; it is a one-file change in `app/layout.tsx` once you choose.

Risks of this PR: ISR means a collection/product page can be up to 120/60 s stale after a Shopify change unless the product/collection webhooks fire (they call `revalidatePath` for both routes, as before); the first visit to a page after each deploy is as slow as today (one render per instance). Both are the intended trade-off of the existing `revalidate` settings.

Recommended next steps, in order: (1) merge and deploy, then re-run `npx lighthouse https://zicabella.com/… --form-factor=mobile` three times per page to fill in the "After (live)" column; (2) take the pixel decision above; (3) upload a phone-sized hero video in the CMS (`heroVideoMobile`, ≤1 MB) — the deferral stops it from blocking the page, but it is still 4.3 MB per visitor; (4) `PG_POOL_MAX=16` and re-measure `/api/cart/sync`; (5) confirm the OpenAI pixel's event hosts with OpenAI support before allow-listing them in the CSP; (6) later, trim the 51 KB global stylesheet (dashboard/support rules ship to the storefront) or adopt critical-CSS inlining to recover the 300–500 ms render-blocking CSS cost.
