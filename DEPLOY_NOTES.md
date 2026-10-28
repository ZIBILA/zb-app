# DEPLOY_NOTES.md — rolling out the `perf-audit` branch

What changed at the infrastructure level: **nothing that requires server/nginx/PM2 changes.** The branch is application code only. These notes list what to run after merging and what to double-check.

## 1. Before merging
- Read `AUDIT.md` §5 (security). Items S1–S4 there are not fixed by this branch and should be scheduled regardless of this merge.
- Confirm the production environment has (unchanged, no new variables needed):
  - `NEXT_PUBLIC_SITE_URL=https://zicabella.com` — `sitemap.xml` and `robots.txt` now use this (they used `NEXT_PUBLIC_APP_URL`, which on the server points at `app.zicabella.com`). If `NEXT_PUBLIC_SITE_URL` is unset the code falls back to `https://zicabella.com`, which is also fine.
  - `SHOPIFY_ADMIN_ACCESS_TOKEN`, `DATABASE_URL`, `NEXTAUTH_SECRET` as today.
- No new runtime dependencies. Dev-only additions: `lighthouse`, `@next/bundle-analyzer`, `pixelmatch` (not installed by `npm ci --omit=dev`; harmless if they are).

## 2. Build and restart on the DigitalOcean host
The app is a long-running `next start` process (keep it that way: in-process caches and fire-and-forget CAPI sends rely on it).

```bash
git pull origin main
npm ci
npm run build          # runs `prisma generate` first (postinstall also does)
# restart however the process is managed today, e.g.:
pm2 restart <app-name> --update-env
# or for the DigitalOcean App Platform: trigger a deploy; build command `npm run build`, run command `npm start`
```

`next build` needs the same env as runtime because `lib/auth/env-check.ts` throws in production mode when `NEXTAUTH_SECRET`, `DATABASE_URL` or `SHOPIFY_ADMIN_ACCESS_TOKEN` are missing.

## 3. Caches to clear / things that will look different right after deploy
- The branch includes a merge of today's `main` (PRs 28–30). Shopify catalogue reads use main's Data Cache tag (`shopify-catalog`); `.next/cache` is rebuilt automatically on deploy and busted by the CMS "Refresh live site" button and the Shopify webhooks (`refreshStorefront()`).
- Fonts moved to `/public/fonts/` (`Rocaston.ttf`, `Heading_Pro_Wide_Trial_Bold.woff2`, two Poppins subsets). They are served with the existing `Cache-Control: immutable` header for `woff2`/`woff`; `.ttf` is not in that header rule and gets Next's default caching for `/public` (fine, but add `ttf` to the `next.config.mjs` static-asset header pattern if you want the year-long cache).
- Cloudflare: HTML is still `Cache-Control: no-store` (home is `force-dynamic`), nothing changes at the edge. If you later make the home page ISR, add a Cloudflare Cache Rule for `/`, `/collections/*`, `/products/*` with a 60 s edge TTL.

## 4. Post-deploy checks (5 minutes)
1. `curl -s https://zicabella.com/sitemap.xml | head` → XML, not the 500 page; URLs on `zicabella.com`.
2. `curl -s https://zicabella.com/robots.txt` → `Sitemap: https://zicabella.com/sitemap.xml`.
3. `curl -s https://zicabella.com/collections | grep -c 'main-content'` → `1` (page body is in the HTML).
4. `curl -s -o /dev/null -w '%{http_code}' https://zicabella.com/collections/does-not-exist` → `404`.
   Same for `https://zicabella.com/products/does-not-exist` → `404` (fed from `/api/products/handles`).
   (Served by the middleware rewrite fed from `/api/collections/handles`; if it is still `200`, check `curl -s https://zicabella.com/api/collections/handles` returns `{"handles":[…]}` — a Cloudflare challenge or a 503 there makes the middleware fail open.)
5. Open the home page on a phone: poster shows immediately, video starts within ~1–2 s, header wordmark uses Rocaston without a late swap.
6. Meta Pixel Helper on a product page: PageView then ViewContent, each once, shortly after load (main loads the vendor scripts with `lazyOnload`; events queue meanwhile). Events Manager → Test Events still shows browser + server pairs deduplicated by `event_id`.
7. Open the product-page lightbox once (the zoom library is now code-split and loads on first open).

## 4b. Post-deploy checks for the tracking changes (10 minutes)
1. CSP: `curl -sI https://zicabella.com/products/x | grep -io 'frame-src[^;]*'` → contains `https://www.facebook.com`.
2. Cookies: `curl -s -D - -o /dev/null -H 'Accept: text/html' 'https://zicabella.com/?ScCid=test123456'` → `Set-Cookie: ScCid=test123456; … Max-Age=7776000; Domain=zicabella.com` next to `_fbp` / `zb_external_id`.
3. Meta Pixel Helper (logged in, or after one checkout): PageView and ViewContent show once each **with** Advanced Matching (em, ph …). In DevTools → Network, filter `facebook.com/tr`: for a logged-in visitor the hits are `POST` (iframe) and there must be no console line "Framing 'https://www.facebook.com/' violates…". The request carries `fbp=fb.1.…` (and `fbc` after an ad click).
4. Events Manager → Test events (browser + server): each event appears twice with the same event id and is marked deduplicated; Diagnostics shows no "missing parameters" for em / ph / external_id / fbp on Purchase and InitiateCheckout.
5. Events Manager → Overview: Event Match Quality for ViewContent / AddToCart / InitiateCheckout / Purchase should rise over the next 48 h (logged-in and returning visitors now contribute browser + server identity).
6. Snap Events Manager → Event quality: sc_click_id / sc_cookie1 present on server events after a Snap ad click; email / phone match on PAGE_VIEW / VIEW_CONTENT for returning shoppers.
7. Staff devices: open `https://zicabella.com/?zb_internal=1` once in each staff browser — that browser never sends pixel or CAPI events again (cookie `zb_internal=1`, one year). Internal / demo accounts get it automatically on their first relayed event after login.
8. Relay health: `curl -s -X POST https://zicabella.com/api/meta/event -H 'content-type: application/json' --data '{}'` → HTTP 400 (no browser provenance), while real page views keep relaying (Network tab: `/api/meta/event` 200 with `{"success":true}`).
9. Origin: confirm the DigitalOcean app only accepts traffic from Cloudflare (firewall / allow-list), since `cf-connecting-ip` is now the trusted client IP.

10. Meta cron alerts: `GET /api/cron/meta-conversions` (Bearer CRON_SECRET) must report `ok:true`; new alert codes `meta_auth_rejected` (token / permission — Purchases wait in the ledger, no attempts burned), `meta_rate_limited`, `meta_permanent_rejection` (payload rejected; fix data, reset the row). The dashboard "Test connection" no longer sends any event.
11. Native app: pages opened by the app's WebView must carry `?zb_app=1` once per session (sets the `zb_app` cookie): then no pixel and no relay event is sent from them.
12. Snap Pixel Test Events: PAGE_VIEW on a product page shows `item_ids`; SIGN_UP shows `sign_up_method`.

## 5. Rollback
`git revert` the branch merge commit (or redeploy the previous build). No data migrations, no env changes, so rollback is a plain redeploy.
