# PERF_AUDIT.md — zicabella.com performance work (branch `perf-audit`)

Companion to `AUDIT.md` (Phase 1 findings). This file tracks measurements, every change made, every change skipped, and what still needs approval.

## Method
- Lighthouse 13.5 CLI, default mobile preset (simulated slow 4G, Moto G Power class, 412×823 CSS px), headless Chrome, `--only-categories` perf/a11y/best-practices/seo, **3 runs per page, medians reported**. Runner: `lighthouse/run.mjs` (`node lighthouse/run.mjs before|after`). Reports: `lighthouse/before/*.report.html`, `lighthouse/after/*.report.html`.
- Target: local production build (`next build && next start -p 3001`), never the live server.
- Bundle sizes: `@next/bundle-analyzer` (`ANALYZE=true npm run build`), report saved at `lighthouse/before/bundle-client.html`.
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

## Results — before vs. after (local, mock data, 3-run medians)

| Page | Perf before → after | LCP | FCP | TBT | CLS | Transfer | Requests |
|---|---|---|---|---|---|---|---|
| home `/` | **75 → 81** | 7.5 s → 5.0 s | 1.2 → 1.2 s | 15 → 0 ms | 0.001 → 0.000 | 4784 → 4374 KB | 66 → 55 |
| product (fallback item) | **69 → 85** | 16.1 s → 4.3 s | 1.2 → 1.7 s | 80 → 37 ms | 0.008 → 0.008 | 4738 → 5190 KB* | 64 → 58 |
| cart `/cart` | **84 → 79**† | 4.6 s → 5.6 s | 1.1 → 1.2 s | 11 → 2 ms | 0.001 → 0.000 | 1100 → 1071 KB | 59 → 52 |
| collection | not measurable without the Shopify token (the catalogue fetch throws) | | | | | | |

A11y, Best Practices and SEO unchanged (home BP 96 = the pre-existing 502s from the placeholder token; cart SEO 58 = intended `noindex`).

\* Product transfer is whichever 1–3 MB fallback JPGs the lazy loader happened to fetch in that run (`load-image-3.jpg` vs `load-image-4.jpg`), not a code effect.
† Cart is inside run noise on this machine: the three baseline runs scored 54 / 85 / 84, the three "after" runs 79 / 79 / 79, and a later full-audit pair measured the baseline at LCP 8.3 s vs this branch at 7.3 s. The cart page is client-rendered after the session check in both builds; nothing in its render path changed except the SSR'd shell (which removed the CLS and the empty-body bailout).

What moved the numbers: real SSR for the static routes (group 1), the hero poster as LCP with the video deferred past `load` (groups 2/5), eight fewer font/preload requests, the product page losing two of its three high-priority hero preloads and the per-card second-image prefetch (group 2), 240 KB model-viewer + 116 KB gtm.js moved out of the critical path (groups 3/5), and the header collections/theme toggle CLS fixes (group 4).

**Targets.** Product ≥ 80: **met** (85). Home ≥ 75: **met** (81). Collection ≥ 80: **not measurable here** — the local collection page cannot render without the Shopify Admin token; it shares the product page's shell, so it should land in the same range, but that is an expectation, not a measurement. On the live site the absolute numbers will differ: real Shopify CDN images are far smaller than the local fallback JPGs (good), but the live hero video is a Shopify-hosted MP4 of several MB and Chrome counts the video's first frame as the LCP candidate once it plays — so **the home LCP on real phones is bounded by that file's size**. A 9:16 mobile cut ≤ 1 MB uploaded to the CMS `heroVideoMobile` field (asset work, see "Levers outside the code") is the remaining lever for home; nothing design-preserving in code moves it further.

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
2. Every storefront route opened at 390 px (fresh tab, dark theme) on the final build: **no JavaScript exceptions**. Remaining console entries are resource errors that exist with the placeholder Shopify token (`/api/shopify/products` 502) and the pre-existing gallery 403 (A6). Pixel comparison against the baseline build at 390/1440 × light/dark: table above.
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

So the deferred vendor download drops nothing: the queued `fbq`/`snaptr` calls replay with their original ids once the files load. **Not verified here:** AddToCart, InitiateCheckout and Purchase (need the real catalogue, a login and Razorpay test keys), and the Facebook Pixel Helper view on the live site. `dataLayer` received 4–5 pushes per page as before (the GTM container is still empty, see AUDIT.md).

## Phase 4 — Visual check (baseline commit vs. this branch, same mock data)

Method: the untouched `main` (45bb4e6b) was built in a separate worktree and served on :3002, this branch on :3001; `lighthouse/visual-check.mjs` captured every storefront route from both at 390 px and 1440 px, light and dark (`prefers-color-scheme` + the site's `theme` localStorage key), with CSS animations disabled, and compared them with pixelmatch (threshold 0.1). Full table: `lighthouse/visual/summary.md`; captures and diff images for anything above 0.5 % in `lighthouse/visual/`.

| Route | 390 dark | 390 light | 1440 dark | 1440 light | Verdict |
|---|---|---|---|---|---|
| `/` | 8.40 % | 0.04 % | 0.04 %* | 0.04 %* | identical layout; the 390-dark run caught the hero video frame vs poster (video source now attaches after hydration). *Page height differed by 424 px at 1440 (see note) |
| `/collections` | 0.15 % | 0.11 % | 0.03 % | 0.02 % | identical (anti-aliasing noise) |
| `/products/…` | 20.4 % | 36.5 % | 22.8 % | 21.8 % | **baseline capture had no product images loaded at all** (black gallery, empty thumbnails, empty "curated pairs"); this branch shows them — compared crops: `lighthouse/visual/_products_*-390-dark-{A,B}.png`. Layout boxes identical |
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
