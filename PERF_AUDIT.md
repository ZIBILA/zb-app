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

## Phase 3 — Changes (running log)

_(filled in per group below; each group ends with `npm run build`, `npm run lint` (scoped), visual check and a Lighthouse re-run)_

## Skipped / not done and why
_(running list)_

## Needs my approval
See `AUDIT.md` §9. Items 0–13 were approved on 2026-10-15; security items 14–23 and conversion item 24 remain open.

## Levers outside the code
- Cloudflare: HTML is `cf-cache-status: BYPASS` with `Cache-Control: private, no-store` because the home page is `force-dynamic`; once home becomes ISR, allow Cloudflare to respect `s-maxage` (or add a Cache Rule for `/`, `/collections/*`, `/products/*` with 60 s edge TTL + stale-while-revalidate).
- Hero video: the Shopify-hosted MP4 is served by Shopify's CDN; a 9:16 mobile cut ≤ 1 MB (H.264 + a WEBM) uploaded in the CMS `heroVideoMobile` field would be the single biggest LCP win on mobile. Not re-encoded here (asset work).
- `public/` images: `load-image-*.jpg` (0.7–2.7 MB), `section-image1.PNG` (2.4 MB), `ZB-logo-silver.svg` (368 KB) should be compressed/replaced (asset work; the code side is handled by the image loader fix).
- Server: DigitalOcean app runs `next start`; keep it (the in-process caches and fire-and-forget CAPI sends rely on a long-lived process).
