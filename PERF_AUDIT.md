# PERF_AUDIT.md — zicabella.com performance work (branch `perf-audit`)

Companion to `AUDIT.md` (Phase 1 findings). This file tracks measurements, every change made, every change skipped, and what still needs approval.

## Method
- Lighthouse 13.5 CLI, default mobile preset (simulated slow 4G, Moto G Power class, 412×823 CSS px), headless Chrome, `--only-categories` perf/a11y/best-practices/seo, **3 runs per page, medians reported**. Runner: `lighthouse/run.mjs` (`node lighthouse/run.mjs before|after`). Reports: `lighthouse/before/*.report.html`, `lighthouse/after/*.report.html` (JSON twins and the per-group intermediate reports are git-ignored; each group's medians are in `lighthouse/g*/summary.md`).
- Target: local production build (`next build && next start -p 3001`), never the live server.
- Bundle sizes: `@next/bundle-analyzer` (`ANALYZE=true npm run build`), report regenerated with `ANALYZE=true npm run build` (`.next/analyze/client.html`; not committed, 1.5 MB).
- INP is not reported by lab Lighthouse (field-only); TBT is the lab proxy.

### Environment caveat (important for reading the numbers)
The local run uses `ALLOW_DB_MOCK=true` (no CMS content: default hero video, no banners) and a **placeholder Shopify token**, so pages render the hardcoded fallback catalogue whose images are the 0.7–2.7 MB `/load-image-*.jpg` files in `public/`. That inflates transfer size and product LCP far beyond live, where images come resized from the Shopify CDN. The collection page could not be rendered locally at all (the catalogue fetch throws without a token). **Both baseline and after tables will be re-run with the real Shopify token when it is provided; until then compare before/after deltas, not absolute numbers against live.**

## Phase 2 — Baseline (local, mock data, 2026-10-15)

| Page | Perf | A11y | BP | SEO | LCP | FCP | TBT | CLS | INP | Transfer | Requests |
|---|---|---|---|---|---|---|---|---|---|---|---|
| home `/` | 75 | 96 | 96 | 100 | 7.5 s | 1.2 s | 15 ms | 0.001 | n/a (lab) | 4784 KB | 66 |
| collection `/collections/jeans` | – | – | – | – | – | – | – | – | – | – | needs Shopify token |
| product `/products/heavyweight-graphic-tee-acid-wash` (fallback item) | 69 | 91 | 100 | 100 | 16.1 s | 1.2 s | 80 ms | 0.008 | n/a (lab) | 4738 KB | 64 |
| cart `/cart` | 84 | 96 | 100 | 58 | 4.6 s | 1.1 s | 11 ms | 0.001 | n/a (lab) | 1100 KB | 59 |

Notes: cart SEO 58 is the empty-body client-side bailout (no `<h1>`, no content for the crawler audit). Home/product transfer is dominated by the fallback JPGs (see caveat) and the 3.3 MB hero WEBM.

### Bundle analyzer — 15 largest client chunks (gzip)

| # | Chunk | Raw KB | Gzip KB | What is in it | Loaded on storefront? |
|---|---|---|---|---|---|
| 1 | `b055d1fb.*.js` | 626 | 173 | three.webgpu.js | no (dashboard analytics globe) |
| 2 | `164f4fb6-*.js` | 323 | 103 | jspdf | no (dashboard) |
| 3 | `aaea2bcf-*.js` | 317 | 98 | recharts `index.js` | **prefetched on home via `/profile` link** (profile page imports it) |
| 4 | `9189-*.js` | 334 | 96 | recharts internals, immer, redux-toolkit, decimal.js | profile only |
| 5 | `633.*.js` | 303 | 88 | polished, tinycolor, three-slippy-map-globe | no (dashboard) |
| 6 | `bd904a5c.*.js` | 318 | 84 | three.core.js | no |
| 7 | `b536a0f1.*.js` | 340 | 81 | three.module.js | no |
| 8 | `8ffc485e.*.js` | 199 | 61 | h3-js (globe) | no |
| 9 | `5443-*.js` | 210 | 61 | pusher-js + tweetnacl | profile (AffiliateCreatorTab → lib/pusher), prefetched from home |
| 10 | `fd9d1056-*.js` | 169 | 52 | react-dom | every page |
| 11 | `ad2866b8.*.js` | 194 | 45 | html2canvas (jspdf) | no |
| 12 | `framework-*.js` | 137 | 44 | react, react-dom, scheduler | every page |
| 13 | `5e094596.*.js` | 129 | 43 | three-globe | no |
| 14 | `9653-*.js` | 118 | 38 | **framer-motion** | **every page** (header drawers, footer, NavigationProgress, PageLoader) |
| 15 | `main-*.js` | 134 | 36 | Next router, web-vitals | every page |

Storefront shell (scripts in the HTML of every storefront page, before route chunks): **26 chunks, 763 KB raw / 231 KB gzip**. Besides React/Next (≈ 135 KB gzip) the avoidable part is: framer-motion 38 KB (`9653`), **libphonenumber-js metadata 28 KB (`7555`, pulled in by `MetaPixelRouteTracker` → `lib/tracking/phone.ts` on every page)**, identity/tracking helpers + full COUNTRIES table 12 KB (`5551`), next-auth client 9 KB (`605`), sonner 9 KB (`4438`), route chunks: home 12 KB, product 24 KB, cart 9 KB, checkout 25 KB, profile **181 KB**.

CSS: `90aa3e…css` 230 KB raw (storefront, includes dashboard Tailwind utilities + 51 KB globals.css) + 2 KB; served with gzip ≈ 32 KB.

## Merge with `main` (2026-10-27)
`main` advanced by 29 commits (PRs 28–30) after this branch was cut, and a parallel pass on `dev` had fixed several of the same things. The branch now contains a merge of `origin/main`; conflicts in twelve files were resolved by taking main's version and re-applying only what main did not have. **Superseded by main (dropped from this branch):** AppBridgeWrapper removal, hero mobile/desktop sources (main uses `<source media>`), the GTM/Meta/Snap/OpenAI vendor-file lazy loading (main loads them via `lazyOnload`), the Shopify ISR cache-mode fix (main picks `force-cache` + the `shopify-catalog` Data Cache tag inside ISR renders) and therefore my `unstable_cache` wrappers, the PDP desktop hero priority. **Kept from this branch:** fonts (Geist removal, Inter/Poppins `preload:false`, self-hosted Rocaston/HeadingPro + Rocaston preload), header collections from the root layout, theme-toggle placeholder, cart `isLoaded` gate, home card priority + unused `fetchPolicies()` removal + early poster preload, PDP zoom-library split + lightbox priority, settings `cache()`, real 404 for a missing collection, sitemap/robots host + dead entries, titles/canonical/noindex, product-card second-image prefetch, `sizes` on thumbnails, model-viewer after `load`, lint gate and tooling. The before/after numbers below were re-measured on the merged branch against a fresh build of the new `main`.

## Results — before vs. after (local, mock data, 3-run medians)

Two baselines exist. The original one (`lighthouse/before/`, built from the `main` this branch was cut from on 2026-10-15) and the **current** one (`lighthouse/before-main/`, built from today's `main` after PRs 28–30). The "after" column is the merged branch (`lighthouse/after/`).

| Page | Perf: old main → new main → this branch | LCP (same order) | TBT | CLS |
|---|---|---|---|---|
| home `/` | 75 → 85 → **84** | 7.5 → 4.4 → 4.4 s | 15 → 1 → 0 ms | 0.001 → 0.001 → 0.000 |
| product (fallback item) | 69 → 75 → **74** | 16.1 → 16.5 → 9.4 s | 80 → 44 → 29 ms | 0.008 → 0.008 → 0.000 |
| cart `/cart` | 84 → 82 → **76**† | 4.6 → 4.8 → 6.3 s | 11 → 5 → 5 ms | 0.001 → 0.001 → 0.000 |
| collection | not measurable without the Shopify token | | | |

**Read this honestly.** Most of the headline gain between "old main" and "now" came from the parallel pass that landed on `main` via `dev` (hero media now CMS-only so no 3 MB local video, vendor scripts lazy, the App Bridge bailout removed). Measured on top of today's `main`, this branch's performance delta is **inside run-to-run noise** on this machine (±5 points, ±1 s LCP between identical runs; the cart has scored anywhere from 54 to 85 on the same build). The product LCP median (16.5 s → 9.4 s) is the one metric that still moves, from the removed hero preloads and the dropped per-card second-image prefetch. The value this branch still adds is correctness and SEO rather than Lighthouse points: real HTML for the static routes is now also on main, but the sitemap host, the five dead sitemap URLs, real 404s for missing collections, the doubled titles, canonical/noindex, the eight unused font preloads and the Google Fonts request, the header-nav and theme-toggle layout shifts (CLS 0.000 on every page now), the model-viewer gating, the committed hero `.mp4` reference and the lint gate are only here.

† Cart: `noindex` (intended) makes the SEO score 58 vs 66; the perf drop is the noise described above (CLS went to 0).

**Targets.** Product ≥ 80 / collection ≥ 80 / home ≥ 75: home meets it on both main and this branch (84–85). Product does not reach 80 locally on either, and the local number is dominated by the 1–3 MB fallback JPGs that only exist in the mock catalogue; with real Shopify CDN images it should be well above that, but that is a prediction until the Admin token is available. Collection is unmeasured for the same reason. On the live site the home LCP is bounded by the CMS hero MP4 (Chrome counts the video's first frame as LCP): a ≤ 1 MB 9:16 mobile cut in `heroVideoMobile` is the remaining lever, and it is an asset, not code.

## Phase 3 — Changes (running log)

Each group: `npm run build` ✓, `tsc --noEmit` ✓, scoped `npm run lint` ✓, every storefront route re-opened at 390 px, Lighthouse re-run (3× medians, same local setup as the baseline). Commits on `perf-audit`.

### Group 1 — real SSR for static routes, cached Shopify reads, SEO fixes (commit d1cde06f)
| Change | File(s) | Visual change |
|---|---|---|
| Removed the Shopify App Bridge wrapper whose `useSearchParams()` made every static route render an empty body (client-side bailout) | `app/providers.tsx` | none (content now in the HTML) |
| `useSearchParams()` consumers wrapped in their own `<Suspense>` with a viewport-height fallback (so the SSR'd header/footer don't jump) | `app/cart/page.tsx`, `app/login/page.tsx`, `app/orders/page.tsx` | none |
| Storefront Shopify read entry points wrapped in `unstable_cache` (60 s, tag `shopify-catalog`); `refreshStorefront()` and `clearShopifyCache()` bust the tag | `lib/shopify-admin.ts`, `lib/storefrontRefresh.ts` | none (data ≤ 60 s old, same as the existing in-memory caches) |
| `sitemap.xml` / `robots.txt` use `NEXT_PUBLIC_SITE_URL`; 5 dead collection URLs and `/chat`, `/search` removed from the sitemap | `app/sitemap.ts`, `app/robots.ts` | none |
| Missing collection handle → real 404 (resolved in `generateMetadata`, before streaming) | `app/collections/[handle]/page.tsx` | none |
| Page titles that already carry the brand use `{ absolute }` (fixes the doubled "… \| Zica Bella® \| Zica Bella® \| Luxury Indian Streetwear") | collections, faq, gallery, reviews, policies, products-not-found, app, search | tab title no longer doubled |
| `/collections` canonical to itself; `/cart` and `/search` `noindex` | `app/collections/page.tsx`, `app/cart/layout.tsx`, `app/search/page.tsx` | none |
| Hero default source → the `.webm` that exists (the `.mp4` 404'd on every home view when no CMS video is set) | `app/page.tsx` | none |

### Group 2 — fonts, hero video, images
| Change | File(s) | Visual change |
|---|---|---|
| Geist VF (66 KB `.woff`, used only by a dead component) removed; Inter and Poppins `preload: false` (still load on the cart/orders/policies/search routes that use them) | `app/layout.tsx` | none (swap timing only on those routes) |
| Rocaston (header wordmark) and HeadingPro self-hosted from `/public/fonts` (byte-identical to the CDN files, md5-checked); Rocaston preloaded; the digit faces use the already-bundled Poppins files instead of a `fonts.gstatic.com` fetch | `app/globals.css`, `app/layout.tsx`, `public/fonts/` | none; wordmark swaps earlier |
| Hero `<video>` renders poster-only on the server and attaches its source after hydration (mobile picks the mobile file — before, mobile downloaded the desktop file and then the mobile one); poster preloaded with `fetchPriority=high`; `preload="none"` until mounted | `components/HeroVideo.tsx`, `app/page.tsx` | video starts ~1 s later on slow 4G, poster shown meanwhile (requested behaviour) |
| `priority` kept only on genuinely above-the-fold images: removed from the 4 home product cards, the collection carousel slides (desktop + mobile trees), the footer logo and the PDP lightbox; PDP desktop hero is `loading="eager"` without a preload so mobile no longer preloads two heroes | `app/page.tsx`, `components/CollectionCarousel.tsx`, `components/ThreeDLogo.tsx`, `app/products/[id]/ProductDetailsClient.tsx` | none |
| `sizes` on fixed-size images (20 px header logo, 220 px footer logo, 64 px cart thumb, 80 px bookmark thumb) | header, ThreeDLogo, cart, BookmarkDrawer | none |
| Product cards no longer fetch image #2 of every card the moment image #1 lands (it still preloads one ahead on swipe/hover) | `components/ProductCardImage.tsx` | none (second slide may show its blur for a moment on the very first swipe) |

### Group 3 — third-party scripts and JS bundle
| Change | File(s) | Visual change |
|---|---|---|
| `__zbDeferThirdParty` gate: `gtm.js`, `fbevents.js`, `scevent.min.js`, `oaiq.min.js` are downloaded on first interaction or when idle (≤ 3 s after load), immediately on `/checkout` and order confirmation. The `dataLayer`/`fbq`/`snaptr`/`oaiq` stubs, consent revoke, Advanced Matching and `init` run exactly as before, synchronously, so every event is queued and replayed — the 3–5 s "wait for the global" helpers in `lib/metaPixel.ts` etc. still find the stub immediately | `app/layout.tsx` | none |
| ~~Menu, cart and bookmark drawers `next/dynamic`~~ — tried, reverted in group 5 (see there) | `components/StorefrontHeader.tsx` | none |
| `react-zoom-pan-pinch` loaded only when the PDP lightbox opens | `app/products/[id]/ProductDetailsClient.tsx` | none |
| Dead `PageLoader` removed (never showed anything; cost a framer-motion mount and a CSR boundary per page) | `components/StorefrontLayout.tsx`, `components/PageLoader.tsx` | none |
| `prefetch={false}` on the header account link (`/profile` route = 181 KB + recharts/pusher chunks were prefetched on every landing) | `components/StorefrontHeader.tsx` | none (first navigation to /profile fetches on click) |

### Group 4 — CLS and client fetches
| Change | File(s) | Visual change |
|---|---|---|
| Desktop header nav collections resolved in the root layout (cached) and passed down; the client fetch runs only if the server list is empty | `app/layout.tsx`, `components/LayoutWrapper.tsx`, `components/StorefrontLayout.tsx` | none (links no longer pop in) |
| Same-size placeholder for the theme toggle before hydration | `components/StorefrontHeader.tsx` | none |
| Cart page waits for the stored bag (`isLoaded`) before showing the empty state | `app/cart/page.tsx` | none (no empty-cart flash) |
| Homepage no longer calls `fetchPolicies()` (result was unused); `getShopSettings`/`getStoreSettings` wrapped in React `cache()` so metadata + page + layout share one query | `app/page.tsx`, `lib/db.ts` | none |
| Lint gate scoped to the storefront (`.eslintignore`) and the four noise rules (`no-explicit-any`, `no-unused-vars`, `no-unescaped-entities`, `no-img-element`, `exhaustive-deps`, `prefer-const`) downgraded to warnings so `npm run lint` can gate real errors; unused imports removed in touched files | `.eslintignore`, `.eslintrc.json` | none |

### Group 5 — load-gated deferrals (from the group 4 trace)
| Change | File(s) | Visual change |
|---|---|---|
| The vendor-script idle timer now starts after the window `load` event (in a no-interaction run the idle callback fired ~100 ms in, before LCP) | `app/layout.tsx` | none |
| Hero video source attaches after the `load` event instead of right after hydration — the 3 MB file no longer competes with the poster, fonts and JS | `components/HeroVideo.tsx` | poster visible ~1 s longer on slow 4G (requested behaviour) |
| Footer 3D logo mounts model-viewer (240 KB module from ajax.googleapis.com + a `.glb`) only after `load` and when the footer is near the viewport — before, it was requested at ~100 ms on every page | `components/ThreeDLogo.tsx` | none (static logo image until then, as before) |
| Committed fallback settings pointed the hero at the missing `.mp4` | `data/store-settings.json` | none |
| Hero poster `preload()` moved before the catalogue fetches so the hint is in the streamed `<head>` (it was being emitted in the body after the data) | `app/page.tsx` | none |
| Drawer code-splitting from group 3 **reverted**: the drawers are rendered (closed) on every page, so `next/dynamic` fetched their chunks at hydration anyway and only added a request; back to the original static imports | `components/StorefrontHeader.tsx` | none |



## Phase 4 — Verification checklist
1. `npm run build` ✓ (every group), `npx tsc --noEmit` ✓, `npm run lint` ✓ (storefront scope, 0 errors / warnings only).
2. Every storefront route opened at 390 px (fresh tab, dark theme) on the final **merged** build: **no JavaScript exceptions** (11 routes, only the two 502s from the placeholder Shopify token). Remaining console entries are resource errors that exist with the placeholder Shopify token (`/api/shopify/products` 502) and the pre-existing gallery 403 (A6). Pixel comparison against the baseline build at 390/1440 × light/dark: table above.
3. Guest checkout walk to the Razorpay screen: **not run** — needs the Shopify Admin token, Storefront token and Razorpay test keys (`.env.local` placeholders are in place; the walk is scripted in AUDIT.md §6 from code).
4. Pixel check: see "Pixel firing" below (dummy pixel ids, local only).
5. Final Lighthouse: table at the top of this file (`lighthouse/after/`).

## Pixel firing (local, dummy ids)
Built once with `NEXT_PUBLIC_META_PIXEL_ID` / `META_PIXEL_ID` set to a dummy 15-digit id and `NEXT_PUBLIC_SNAP_PIXEL_ID` to a dummy UUID (nothing reached the real datasets; `lighthouse/pixel-check.mjs` also intercepts `facebook.com/tr` and `tr.snapchat.com` and answers them locally). One tap after load to trigger the interaction gate, then 9 s.

| Page | `fbq` loaded | Meta browser events (each once) | CAPI relay with the same `event_id` | Snap |
|---|---|---|---|---|
| `/` | yes | PageView | PageView ✓ | `snaptr` loaded, PAGE_VIEW relayed + 2 pixel posts |
| `/products/…` | yes | PageView, ViewContent | PageView ✓, ViewContent ✓ | PAGE_VIEW + VIEW_CONTENT relayed + 2 pixel posts |
| `/collections` | yes | PageView | PageView ✓ | PAGE_VIEW relayed + 2 pixel posts |

Re-run on the merged build (main's `lazyOnload` vendor loading): same result on `/` and the product page — PageView and ViewContent once each, each with a CAPI relay carrying the identical `event_id`; Snap PAGE_VIEW / VIEW_CONTENT relayed. The deferred vendor download drops nothing: the queued `fbq`/`snaptr` calls replay with their original ids once the files load. **Not verified here:** AddToCart, InitiateCheckout and Purchase (need the real catalogue, a login and Razorpay test keys), and the Facebook Pixel Helper view on the live site. `dataLayer` received 4–5 pushes per page as before (the GTM container is still empty, see AUDIT.md).

## Tracking fixes — Meta Pixel / CAPI and Snap Pixel / CAPI (2026-10-27, approved)

A second read-only review of the full tracking chain (loader, hooks, relays, CAPI senders, purchase ledger, webhooks) found no Critical issue and a careful implementation overall: shared `event_id`s on both halves of every event, Purchase server-authoritative via the ledger, correct hashing and normalisation, no secrets in the client. The High and Medium findings were approved for fixing and landed as one commit each. **No event payload, event name or firing rule changed except where stated; nothing was pushed.**

| # | Severity | Commit | What was wrong | Fix |
|---|---|---|---|---|
| 1 | High | `ba4406c7` | The live site is behind Cloudflare, but every IP read checked `do-connecting-ip` first (the Cloudflare edge), so CAPI `client_ip_address`, IP-geo country fallbacks and the per-IP relay rate limits (120/min shared by everyone behind one POP) used the wrong address. | `lib/client-ip.ts`: `cf-connecting-ip` → `do-connecting-ip` → `x-forwarded-for` → `x-real-ip`; used by `getClientIP`, the middleware cookie, and the Meta/Snap purchase + app request contexts. Keep the origin reachable only via Cloudflare (DigitalOcean firewall). |
| 2 | High | `f2d1a717` | `lib/metaPixel.ts` / `lib/snapPixel.ts` resolved the pixel id at **build** time; `app/layout.tsx` at **request** time. A build env ≠ runtime env silently lost every browser event and relay while server Purchases still went out. | Layout writes `window.__zbMetaPixelId` / `__zbSnapPixelId`; `metaPixelId()` / `snapPixelId()` read those first. |
| 3 | High | `1030be0e` | `/api/meta/event` and `/api/snap/event` accepted any POST naming a storefront URL in the body: forged funnel events with arbitrary value and other people's hashed PII. | Both require browser provenance (`Sec-Fetch-Site` not cross-site, `Origin`/`Referer` on a storefront host) — a bar, not auth. Meta per-event value cap 10 M → 1 M (Snap already 1 M). |
| 4 | Medium | `2be2612f` | `META_TEST_EVENT_CODE` had no production guard: left set, every CAPI event is a test event and the ledger still marks Purchases "sent" (unrecoverable). | Ignored on a production build of a live host, with a startup alert; `.env.example` documents it. |
| 5 | Medium | `96f90ae2` | With consent regions configured (not today), a visitor whose country could not be resolved was held "pending" forever, silently. | Failed lookup fails open for that page load (browser + server backstop), logged; recorded choices unchanged. |
| 6 | Medium | `0bd24b74` | Meta ViewContent always sent the first variant's id/price; AddToCart sends the selected one. | ViewContent uses the variant selected at fire time, else the first. |
| 7 | High (Snap) | `e7c8d76c` | Snap server PURCHASE did not skip internal/test/demo orders (pixel and Meta do), so test orders became Snap conversions. | Web + app deliveries apply `internalOrderReason` and close the ledger row as skipped. |
| 8 | Medium (Snap) | `c7f25f4e` | `user_data.external_id` sent as a one-element array; Snap's reference types it as a string. | Plain hashed string (web + app senders). |
| 9 | Medium (Snap) | `d3870bdd` | Relay forwarded the browser clock and the sender dropped anything > 5 min ahead / 7 days old → a wrong device clock lost every server event. | Out-of-window client time is replaced by the server receive time (as the Meta relay does). |
| 10 | Medium (Snap) | `eccebf67` | Razorpay webhook awaited two sequential Snap sends (5 s timeout each) before answering; Meta's send is fire-and-forget. | Snap sends detached the same way; the ledger keeps interrupted sends safe. |
| 11 | Medium | `178e5540` | Ledger wrote the final outcome by order key unconditionally; a process that lost its lease could overwrite another process's `sent` with `failed` → duplicate Purchase. | Success/failure writes conditioned on our own lease (`status: 'sending', leaseUntil`), like the blocked path. Shared by Meta and Snap. |

**Verified after the fixes (local build, dummy pixel ids, placeholder tokens):** `npm run build`, `tsc`, `npm run lint` (0 errors) pass. The rendered HTML carries the request-time ids script. `curl` to both relays: no `Origin` → 400, cross-site `Origin` → 400, own origin → accepted. `lighthouse/pixel-check.mjs` on `/` and the product page: PageView and ViewContent fire once each in the browser and are relayed with the identical `event_id`; Snap PAGE_VIEW / VIEW_CONTENT relayed; zero relay rejections in the server log. Not verifiable here: real CAPI acceptance (tokens), the Snap `external_id` change against `/events/validate`, and the webhook/ledger paths (need Razorpay + Postgres).

**Low findings left as-is (listed for a later pass):** access token in the query string for Snap CAPI and the Meta admin diagnostics (prefer the `Authorization` header / POST body); `ad_conversion_deliveries` grows without bound (3 permanent rows per abandoned checkout, no retention); Snap VIEW_CONTENT falls back to the product id when a product has no variants; PageView fires per pathname only (query changes such as `/search?q=` do not count); Meta `external_id` is lower-cased on the server but not in the Pixel init (mixed-case ids hash differently); `app.zicabella.com` is a Meta production host but excluded from GTM; an unset `NEXT_PUBLIC_SITE_URL` on any production build means the live pixel; Automatic Advanced Matching is off (`autoConfig:false`); COD without upfront capture and `partially_paid` orders never produce a Purchase (design choice, undocumented at the call sites); the remaining hand-rolled IP reads in `app/r/[slug]`, the OpenAI order events and `app/api/admin/login` still check `do-connecting-ip` first.

## Tracking round 2 — event quality / match strength (2026-10-28, approved)

Second, deeper pass asked by the owner: "what is making the events weak, so that Meta's and Snap's pixels learn properly". Method: two fresh reviewers (Meta chain, Snap chain) traced every event × visitor type (first-visit guest, returning guest with bound cookies, logged-in customer) on both halves (browser pixel, Conversions API), cross-checked the eleven round-1 fixes, and I drove the funnel on the local build (`lighthouse/funnel-check.mjs`: product → size → Add to Bag → cart → checkout at 390 px; `lighthouse/pixel-debug.mjs`: Pixel SDK transport) for a fresh guest and for a returning visitor with bound identity cookies, recording every pixel hit and relay body.

### What was weakening the events (and the fix), by impact

| # | Finding (verified) | Effect before | Fix (commit) |
|---|---|---|---|
| 1 | **CSP blocked the Meta Pixel for every visitor with Advanced Matching.** With hashed email/phone in AM (every returning guest, every logged-in customer, the confirmation page), fbevents.js sends the event as a POST through a hidden iframe to `www.facebook.com/tr`; the storefront CSP `frame-src` did not list it. Reproduced: zero `/tr` requests + "Framing 'https://www.facebook.com/' violates … frame-src"; the live site sends the same header. | Browser half of PageView/ViewContent/AddToCart/IC/Purchase silently lost for the most valuable visitors; Events Manager showed server-only events for them. | `frame-src` += `https://www.facebook.com` (`821bce1d`). After: `POST document` hits carrying `ud[em]`, `ud[ph]`. |
| 2 | **InitiateCheckout fired for the pre-login redirect.** Checkout is login-gated; the IC effect fired on the render that redirects to `/login` (no identity, guest external_id), and the 30-min cart marker suppressed the real IC after login. Snap START_CHECKOUT fired twice. Reproduced in the funnel log (IC on /checkout, then `/login?callbackUrl=/checkout`). | The IC Meta learned from had no em/ph/name/address and could not be joined to the Purchase. | Both fire only for the authenticated shopper with the saved address loaded (`d75bf84d`). GA4/OpenAI/first-party unchanged. |
| 3 | **Session expiry treated as logout.** The 10-day JWT expiry (and the invalid-session cleaner) cleared the bound identity cookies and minted a fresh device id. | A past buyer coming back from a retargeting ad became a brand-new person with no email/phone — exactly the audience Meta learns from. | Only the profile page's Sign Out (new `zb_logout` marker) clears and rotates; expiry keeps the customer's own bound identity (`360494f3`). |
| 4 | **Snap click id and `_scid` were script cookies only** (Safari: 7 days, 24 h on a decorated landing). | `sc_click_id` / `sc_cookie1` missing on every Snap CAPI event and server PURCHASE after day 1, inside Snap's 28-day window. | Middleware mints `ScCid` from `?ScCid` (90 d) and re-sets `_scid` (13 months) as HTTP cookies, like `_fbp`/`_fbc`; client never downgrades them (`6559e32e`, tests in `scripts/verify-meta-identity-cookies.ts`). |
| 5 | **Snap CAPI stripped em/ph/fn/ln for returning guests** while the Snap pixel sent the same hashes on every event. | Server copy (the one Snap usually gets first) matched on IP/UA only. | Bound cookie identity on every event, both halves (`0be2e03a`). Funnel log after: `userData: em, ph, fn, ct, country` on PAGE_VIEW/VIEW_CONTENT/ADD_CART. |
| 6 | Snap logged-in pixel init had hashed email/phone only; CAPI had name + address too. | Pixel half matched on fewer keys. | Init with the session's raw email/phone/name (pixel hashes them) (`d16fbcfb`). |
| 7 | Snap ADD_BILLING never fired on the saved-address path. | Missing funnel step for returning customers. | Fired at the Razorpay handoff when nothing fired it (`5f30dc6f`). |
| 8 | Per-IP relay rate limit (120/min) with the real client IP now in use. | Indian CGNAT (Jio/Airtel) shares one IPv4 across thousands of shoppers → 429 in bursts → server half dropped. | Per-visitor key (IP + device id) + loose per-IP backstop; provenance checked before counting (`f72741a1`). |
| 9 | Staff, demo and non-human traffic fed the funnel (only Purchase was excluded). | Noise trains delivery. | Internal accounts get `zb_internal=1` (also `?zb_internal=1` for staff devices): stubs never create fbq/snaptr, relays refuse; crawler / headless UAs dropped on the live site; WebDriver browsers excluded (`f72741a1`). |
| 10 | IP-geolocated **region** bound as `st`; Snap relay hashed IP city/zip. | Wrong hashed address keys (carrier egress ≠ shopper). | Country only from IP, both vendors (`1df513da`, `f4a47934`). |
| 11 | Only one email / phone / id sent when several were known. | Fewer match keys; pre-login funnel (device id) could not be joined to the Purchase (customer id). | CAPI accepts lists; relay and server Purchase send every validated email/phone + customer id + device id (`fc90a8b8`). |
| 12 | Hygiene: newsletter email not persisted; UA from body; bound DOB dropped on one half; diagnostics keyed on the raw test-code env; value cap wrong for low-unit currencies; browser id ≠ `META_PIXEL_ID`; native-app WebView pages tracked as website; Snap clock tolerance 7 days; SEARCH without item ids. | Small, each. | `6e1c52d0`, `cb1d5049`, `60494e78`, `fedadcde`, `19d41d3f`. |

### Verified on the final build (local, dummy pixel ids, placeholder tokens)

`npm run build`, `tsc`, `npm run lint` (0 errors), `scripts/verify-meta-identity-cookies.ts` (all pass). Funnel, fresh guest: PageView/ViewContent/AddToCart relayed with matching ids; **no** IC/START_CHECKOUT on the unauthenticated redirect. Funnel, returning visitor (bound cookies, `ScCid`, `_fbc`, `zb_device_id`): Meta relay carries fbp, fbc, external_id, ct, country (server adds the bound em/ph); Snap relay carries em, ph, fn, ct, country + scClickId + scCookie1 on every event; Meta Pixel hits now arrive as `POST document` with `ud[em]`/`ud[ph]`. `curl`: a `?ScCid=` landing sets `ScCid` (Max-Age 7776000) and `_scid` is re-set; `zb_internal=1` is refused by both relays and a `?zb_internal=1` page creates neither `fbq` nor `snaptr`; no-origin POST still 400.

**Cannot be verified here:** real CAPI acceptance and the EMQ score (tokens), the Pixel's `fbp` parameter on the live domain (the SDK omits it on localhost / a dummy pixel config — check with the Meta Pixel Helper after deploy), Snap's `/events/validate` on the new payloads, and the login / Purchase paths (need Postgres + Razorpay). Checked post-deploy: Events Manager → Diagnostics (no "missing parameters"), EMQ per event rising over 48 h, Test Events showing browser + server copies deduplicated.

### Left as-is (decisions for the owner)

- **Automatic Advanced Matching is off** (`autoConfig:false`): manual AM covers checkout/OTP/newsletter; turning it on adds form scraping and automatic events. Owner's call.
- **AddToCart on cart-page quantity increments** is not fired (optional for Meta; would inflate ATC counts).
- **Native app WebView pages**: the stub now skips when the URL carries `?zb_app=1`; the app must append it (ZicaBella/src/screens/PolicyScreen.tsx) — app change, not done here.
- **Relay allow-list** still accepts Contact / FindLocation / Schedule / StartTrial (hooks exist, no call sites).
- **Consent fail-open** (round 1) means an EEA visitor with a geo outage is tracked without consent once regions are configured — a compliance choice to confirm before enabling regions.
- Snap: event identity after `resetGuestIdentity()` on the confirmation page persists in the SDK until reload (init params merge); token in the query string; `_sccid` fallback reads a cookie Snap never writes (dead code).
- Infrastructure: keep the origin reachable only through Cloudflare (DigitalOcean firewall) so `cf-connecting-ip` cannot be spoofed; register the per-country feeds in Commerce Manager if non-INR events should reference the right catalog prices.

### Follow-up (2026-10-28, after deploy): missing collections were still a soft 404 on live
The round-1 fix (notFound() in generateMetadata) does not work on this app: `app/loading.tsx` at the root streams a 200 shell for every page before any page / metadata / segment-layout code runs, so notFound() anywhere below it only renders the not-found UI with status 200 (reproduced locally with a stubbed null lookup from the page, from generateMetadata and from a `[handle]/layout.tsx`). Only an unmatched route gets a real 404. Fix: middleware rewrites `/collections/<unknown>` to an unmatched path; the known handles come from the new `/api/collections/handles` (ISR 120 s, webhook-revalidated) and are cached per instance for 5 minutes; any failure (503, Cloudflare challenge, timeout) fails open to today's behaviour. Verified locally with a stubbed handle list: unknown → 404 with the branded not-found page, known / `all` / index → 200; with the API failing → 200 (fail open). Product pages had the same soft-404 shape and get the same treatment: `/api/products/handles` (handles + numeric ids of the storefront catalogue) feeds a `/products/<unknown>` rewrite, with the same loopback-first fetch, 5-minute per-instance cache, fail-open and `x-zb-handles` header. Live verification of the collection fix: unknown → 404 on every instance, known → 200 + `x-zb-handles: ok`.

## Tracking Phase 2 — fixes from META_SNAP_EVENT_QUALITY_AUDIT.md (2026-10-28, approved)

| Commit | Issue | Change |
|---|---|---|
| `c88547e7` | tests | Meta relay suites send `Origin` (the relay requires storefront provenance) |
| `ed6b958b` | M-C2 (High) | `sendCapiEvent` classifies Graph errors (190/102/200/10 → blocked:auth, 803 → blocked:config, 4/17/32/613/80004 → blocked:rate, 100 → permanent, else transient); the ledger refunds attempts on blocked results; retry stops the run on the first blocked send and alerts `meta_auth_rejected` / `meta_rate_limited`; code 100 closes the row with `meta_permanent_rejection`; transient retries back off 0 / 0 / 30 min / 2 h / 6 h, oldest first; injectable backoff for tests |
| `77ee2d87` | M-C9 | Admin "Test connection" posts an empty batch (Meta answers 100 when the token and pixel are accepted) instead of a counted PageView; diagnostics tokens in `Authorization` headers |
| `f5246a5a` | M-C10 | WhatsApp dataset forwarder: token in body, shared Graph version |
| `97d4c3d4` | M/S-C1 | `?zb_app=1` → session cookie `zb_app=1`; flags set in the always-rendered ids script; stubs, `isExcludedBrowser()` and both relays honour it |
| `d18015fc` | M-C3 | `/api/payments/webhook` emits the Meta Purchase (ledger-idempotent) |
| `e488030b` | S-C2 | First logged-in PAGE_VIEW: server half falls back to the session's raw identity |
| `62f8a2b0` | S-C4 | Snap hook clamps ids / contents / quantity / num_items / value / strings / URL to the relay limits; logs non-2xx |
| `7acddf9b` | tests | Snap suites follow the shipped behaviour (Origin, `external_id` string, bound identity on browsing events, detached webhook sends, tracking view `internal`) |
| `1806095b` | build | `lib/db.ts` React `cache()` tolerant of npm React (offline scripts crashed since the ISR dedupe) |
| `8e52ec0a` | S-C11 | Product-page PAGE_VIEW carries `item_ids` / `content_ids` (variant id) |
| `7ba83bd3` | S-C10 | SIGN_UP carries `sign_up_method: phone_otp` on both halves |
| `7f8cfc8a` | M-H4 | Purchase without a recorded user agent borrows the Snap row's UA / IP before sending; logs when none exists |

Verified: `npm run build`, `tsc`, `npm run lint` (0 errors); all Meta and Snap offline suites pass (run the Snap e2e suites with placeholder `DATABASE_URL` / `ALLOW_DB_MOCK=true`); local production build: product PAGE_VIEW `e_iids` on the pixel and `content_ids` on the relay, `?zb_app=1` page → no `fbq` / `snaptr` and no relay POST, relays answer `skipped` to `zb_app=1`, returning-visitor em/ph on every Snap relay, fresh-guest funnel unchanged. Open (P2/P3, Section 8 of the audit): Snap Bearer header, AddPaymentInfo reload guard, Meta `<noscript>`, dashboard toggles (AAM / Automated Matching / cookie settings), funnel value basis, Purchase-half parity, Snap pixel `external_id`, owner re-binding, Dataset Quality / Signal Readiness polling, ledger retention, dead code.

## Phase 4 — Visual check (baseline commit vs. this branch, same mock data)

Method: the untouched `main` (45bb4e6b) was built in a separate worktree and served on :3002, this branch on :3001; `lighthouse/visual-check.mjs` captured every storefront route from both at 390 px and 1440 px, light and dark (`prefers-color-scheme` + the site's `theme` localStorage key), with CSS animations disabled, and compared them with pixelmatch (threshold 0.1). Full table: `lighthouse/visual/summary.md`. The captures and diff PNGs (44 MB) are git-ignored; regenerate with `node lighthouse/visual-check.mjs <baselineUrl> <branchUrl>` (see the script header for the setup).

| Route | 390 dark | 390 light | 1440 dark | 1440 light | Verdict |
|---|---|---|---|---|---|
| `/` | 8.40 % | 0.04 % | 0.04 %* | 0.04 %* | identical layout; the 390-dark run caught the hero video frame vs poster (video source now attaches after hydration). *Page height differed by 424 px at 1440 (see note) |
| `/collections` | 0.15 % | 0.11 % | 0.03 % | 0.02 % | identical (anti-aliasing noise) |
| `/products/…` | 20.4 % | 36.5 % | 22.8 % | 21.8 % | **baseline capture had no product images loaded at all** (black gallery, empty thumbnails, empty "curated pairs"); this branch shows them — compared crops (regenerable, see above). Layout boxes identical |
| `/cart` | 1.93 % | 1.80 % | 0.60 % | 0.65 % | baseline caught mid entrance animation (dimmed button, block 10 px lower); settled state identical |
| `/faq`, `/support`, `/blogs`, `/reviews`, `/wishlist`, `/app`, 404 | ≤ 0.16 % | ≤ 0.12 % | ≤ 0.03 % | ≤ 0.02 % | identical |
| `/story`, `/collaborations` | 2.0–2.5 % | 2.1–2.5 % | 1.2–2.0 % | 1.2–2.1 % | framer-motion entrance animations (JS-driven, not disabled by the CSS override) at different frames; same layout |
| `/gallery` | 0.77 % | 0.74 % | 0.40 % | 0.39 % | same empty-state card; sub-pixel text differences |
| `/login` | 2.45 % | 7.85 % | 1.88 % | 3.28 % | background `motion.img` swap timing (default 1.6 MB JPG → CMS image); form identical |
| `/search?q=tee` | 20.4 % | 0.89 % | 8.6 % | 7.7 % | fallback product images loaded in one capture and not the other (same as PDP); light/390 at 0.89 % confirms the layout matches |

Note on `/` at 1440: the overlapping 4 792 px match at 99.96 %; this branch's capture was 424 px taller at the bottom. Re-measured with a DOM probe (no scroll pass): both builds are exactly 4 792 px tall with nothing below the footer; the extra height only appears after the comparison script's scroll-through expands a lazy-loaded section, and the baseline itself varied between 4 792 and 4 947 px between runs. Lazy-content timing, not layout.

Conclusion: no layout, colour, spacing or copy difference attributable to the code changes; every diff above noise is lazy-loaded content or an animation frame at a different moment, exactly the class of difference the brief allows.

## Skipped / not done and why
- **Image optimizer for local / CMS images**: Next returns 404 from `/_next/image` whenever `images.loader` is not `default` (verified in `next-server.js`), and `sharp` is not installed. Routing `/public` and Supabase images through the optimizer therefore needs either a second loader strategy per component or an image-resizing route (new runtime dependency). Listed under approval.
- **libphonenumber-js (28 KB gzip on every page)**: it enters through `lib/tracking/phone.ts`, which is imported by the Meta/Snap pixel, CAPI and checkout code. Making it lazy means an async phone-normalisation API across Meta/Snap/checkout files (off-limits). Listed under approval with the approach.
- **framer-motion on every page (38 KB gzip)**: still required by the footer, NavigationProgress and most pages; only removable with a design change (footer animations) — skipped.
- **Country config as a server prop**: `CountryProvider` skips the detection/cookie logic entirely when `initialConfig` is passed, which would break country detection for international visitors; skipped.
- **Home sections (Ring carousel, Spotlight, Featured users) as server data**: below the fold, and the components own their config parsing + skeletons; converting is a refactor, not a hygiene fix. Skipped.
- **CSS split (login/support rules out of `globals.css`)** and **Tailwind content scope**: the storefront CSS is ~32 KB gzip; the login/support rules are ~5 KB of it; a true split needs a separate Tailwind entry for the dashboard. Skipped as low value / medium risk.
- **Deleting unused `public/` assets** (`section-image1.PNG` 2.4 MB, two large SVG logos, `load-image-3/4.jpg`): they are not referenced by the storefront code, but emails, the native apps or ads may hot-link them. Left in place; listed as an asset task.
- **Product "not found" real 404**: needs `notFound()` instead of the custom 200 page, which changes what that page looks like. Listed under approval.
- **Request-time `fetchProducts` fallback catalogue** (fake products on Shopify errors): behaviour change, listed under approval.

## Needs my approval
Items 0–13 of `AUDIT.md` §9 were approved on 2026-10-15 and are done, except where listed under "Skipped" above. Still open, with the exact change proposed:

| # | Proposal | Why it is not in this branch | Exact change |
|---|---|---|---|
| A1 | **Resize local / CMS images** (`/public`, Supabase, `db.zicabella.com`) | `/_next/image` is disabled by `images.loader: 'custom'` and `sharp` is not installed (new runtime dependency) | `npm i sharp`; in `next.config.mjs` set `images.loader` back to `default` and keep the Shopify CDN resizing by passing `loader={shopifyImageLoader}` only on `<Image>`s whose `src` is a Shopify URL (≈ 30 call sites), or add `app/api/img/route.ts` (sharp resize + cache) and point the custom loader's local/Supabase branch at it |
| A2 | **Lazy-load libphonenumber-js** (28 KB gzip on every page) | Enters via `lib/tracking/phone.ts`, imported by Meta/Snap pixel + CAPI + checkout code (off-limits) | Make `parsePhoneForCountry` async (`await import('libphonenumber-js/min')`) and `normalizePhone` in `lib/tracking/identity-normalize.ts` async; update the ~12 callers to `await` it |
| A3 | **Product not-found → real 404** | `app/products/[id]/page.tsx:151-162` renders a custom 200 "Product Not Found" page; a real 404 means the standard not-found page instead (different look on that one page) | `notFound()` in `generateMetadata` when `fetchProductByHandle` returns null (and no Shopify error) |
| A4 | **Stop serving the fake fallback catalogue in production** | Behaviour change: on a Shopify error `fetchProducts()` returns 16 placeholder products (`lib/shopify-admin.ts:1497`) and `fetchProductByHandle` returns a placeholder for 16 handles | Return `[]` / `null` unless `NODE_ENV !== 'production'`; the PDP "curated pairs" section already hides when empty |
| A5 | **Login / policies background image** (`/load-image-2.jpg`, 1.6 MB, loaded by every forced-login visitor before the CMS image replaces it) | `app/login/page.tsx` is auth UI (off-limits) | Replace the default with a ≤ 150 KB WebP at 1080 px, or pass the CMS image from the server so the default never loads |
| A6 | **Gallery 403** | Not perf; `app/gallery/GalleryClient.tsx` calls admin-gated `/api/web-store/gallery` | Add `pathname === "/api/web-store/gallery" && req.method === "GET"` to the public exemptions in `middleware.ts` (next to `banners`), or fetch the gallery in `app/gallery/page.tsx` server-side |
| A7 | **Lint policy** | `.eslintrc.json` now has the six noise rules as `warn` (3,800 pre-existing errors); decide whether to keep that or restore `error` and clean up | — |
| A8 | **Tracking fixes** (`AUDIT.md` §9 item 11: OpenAI identity ownership check, duplicate `order_created`, purchase events before capture, Meta Purchase in `app/api/payments/webhook`) | Meta/OpenAI tracking code was declared off-limits; approved in principle but kept out of a perf branch so they can be reviewed on their own | separate branch on request |
| A9 | **GA4** (`AUDIT.md` §9 item 12) | Needs a decision in GTM (publish a GA4 config tag) or in code (direct `gtag/js`); the container is empty today | — |
| A10 | **Security S1–S4 and the open API routes** (`AUDIT.md` §5) | Not perf; must be fixed before scaling spend | separate branch on request |
| A11 | **Cloudflare edge caching** for `/`, `/collections/*`, `/products/*` once home is ISR | Hosting setting | Cache Rule: edge TTL 60 s, serve stale while revalidating; keep `/api/*`, `/cart`, `/checkout` bypassed |
| A12 | **Home page ISR** instead of `force-dynamic` | Home reads `getStoreSettings`/`getShopSettings`/banners from the DB per request; with the catalogue now cached, `export const revalidate = 60` would make the HTML cacheable. Not applied because the CMS "Refresh live site" path and the webhooks would need to `revalidatePath('/')` (they already do) and I could not test with real CMS data | one line in `app/page.tsx` + verify the CMS refresh button |

## Levers outside the code
- Cloudflare: HTML is `cf-cache-status: BYPASS` with `Cache-Control: private, no-store` because the home page is `force-dynamic`; once home becomes ISR, allow Cloudflare to respect `s-maxage` (or add a Cache Rule for `/`, `/collections/*`, `/products/*` with 60 s edge TTL + stale-while-revalidate).
- Hero video: the Shopify-hosted MP4 is served by Shopify's CDN; a 9:16 mobile cut ≤ 1 MB (H.264 + a WEBM) uploaded in the CMS `heroVideoMobile` field would be the single biggest LCP win on mobile. Not re-encoded here (asset work).
- `public/` images: `load-image-*.jpg` (0.7–2.7 MB), `section-image1.PNG` (2.4 MB), `ZB-logo-silver.svg` (368 KB) should be compressed/replaced (asset work; the code side is handled by the image loader fix).
- Server: DigitalOcean app runs `next start`; keep it (the in-process caches and fire-and-forget CAPI sends rely on a long-lived process).
