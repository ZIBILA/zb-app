# Meta + Snapchat Event-Quality Audit — second pass (2026-11-01)

**Code audited:** `main` at `9a7a8cdd` (after PR #40, #42, #43 and hotfix #44).
**Live checks:** zicabella.com and app.zicabella.com on 2026-11-01 (built-in browser, real pixel ids, real relay payloads captured with a `fetch`/`sendBeacon` shim; nothing was purchased, no real customer data was used).
**Requirements source:** two fresh research passes over Meta's and Snap's official developer and Business Help documentation (Appendix A: 35 Meta pages, Appendix B: 41 Snap pages plus the official pixel script), reconciled with the 2026-10-28 audit (`META_SNAP_EVENT_QUALITY_AUDIT.md`, 92 Meta + 64 Snap sources).
**Nothing was merged, deployed or changed in production for this audit.**

> **Resolution log (2026-11-01, later the same day)**
> - **N1 / N3 (Meta gateway):** the owner disconnected the Signals Gateway partner from the pixel in Events Manager. Verified: the live pixel config no longer contains any `openbridge` endpoint, no `birch` reference, and the CSP console errors are gone. The CSP was **not** changed (PR #46 closed unmerged). The pixel now delivers browser events to `https://www.facebook.com/tr/` by hidden-form POST (that is why they never appear in Resource Timing).
> - **N2 (app.zicabella.com):** fixed and live in PR #45.
> - **N7 (`external_id` unhashed): withdrawn.** Both server senders already SHA-256 it before sending (`lib/metaCapi.ts` hashes every external_id value; `lib/snap-capi.ts` `hashIfNeeded`). Only the browser→relay body carries the raw id, and that never leaves the site.
> - **N9 (Snap `PAGE_VIEW` item_ids):** the code existed (`data-zb-variant-id` + the tracker) but on client-side navigations the product segment streams in after its loading UI, so the id was not in the DOM when PAGE_VIEW fired. Fixed in the event-quality PR (bounded wait).
> - **N8, N10, N11:** fixed in the event-quality PR (Meta Search `content_ids`; Snap ADD_TO_WISHLIST `contents`/`num_items`; Snap consent hold mirroring the Meta one).
> - **New finding (PageView, found while re-checking live):** on every client-side navigation the Meta SDK's own page-change hook (`history.pushState`) sends a `trackCustom('PageView')` — a **custom** event with **no event id** — a few ms before the site's standard PageView, and then drops the standard one as a duplicate. Net effect in Events Manager: "PageView" as a custom event, a browser PageView without `event_id`, and the server PageView (which has the id) looking duplicated. Fix in the event-quality PR: `fbq.disablePushState = true` before the SDK loads (the SDK's own switch for that hook) and the site's PageView sent with `trackSingle`, which is not subject to the SDK's once-per-page guard. Hard page loads were unaffected.
> - **2026-11-01, follow-up PR (Meta and Snap Events Manager read with the owner signed in):** InitiateCheckout `3bc780f0…` did have its server copy — Test Events shows every pair as a parent row plus two child rows, so the server line reads twice and the browser line once. PageView's "Custom event" tag is the Test Events tool's label for PageView (not one of its 17 conversion standard events): the live pixel request carries `ev=PageView` with an event id and no custom flag, the server sends `event_name: PageView`, and Overview scores it as PageView. Meta's per-event advice ("fbc received through the pixel, empty on CAPI"; "server sends IPv4 while the pixel reports IPv6"; Purchase surname 59 %) and Snap's PURCHASE diagnostics (description 0 %, surname 54 %, CAPI OS-version 55 %) led to: the relay rebuilds `fbc` from the page URL's `fbclid` when no `_fbc` cookie reached it; both Purchase builders prefer the name source that carries a surname; the Snap PURCHASE sends `content_name` (item titles) and borrows the Meta row's user agent / IP for webhook-only completions; `/api/geo` returns the caller's address as the server resolved it so the IPv6 question can be answered after deploy; storefront pages on platform default hosts (`*.ondigitalocean.app`, `*.onrender.com`) are 301'd to zicabella.com. The duplicate email / phone diagnostics on ViewContent (since 2026-10-30) match the un-muted test account's logged-in browsing on several devices: configuration (META_INTERNAL lists), not code. `content_category` on the Snap server PURCHASE is not possible — order rows store no product type.

---

## 1. Direct answers

### 1.1 Did PR #40 / #42 / #43 remove any Meta or Snap tracking code? — No.

| Check | Result |
|---|---|
| Files changed by PR #40 (`572d0415^1..572d0415`) among all tracking modules (`lib/metaPixel.ts`, `lib/metaCapi.ts`, `lib/meta/*`, `lib/snapPixel.ts`, `lib/snap-capi.ts`, `lib/snap/*`, `hooks/useMetaEvents.ts`, `hooks/useSnapEvents.ts`, both route trackers, `app/api/meta/*`, `app/api/snap/*`, `lib/buildMetaUserData.ts`, `middleware.ts`, `app/layout.tsx`) | only `lib/geolocation-enrichment.ts` (Google Maps geocoding removed; it still calls `saveUserDataToCookies` and `initPixel`, so the identity flow is intact) |
| Removed lines mentioning `fbq`, `snaptr`, `trackEvent`, `trackSnap*`, `sendToCapiRoute`, `sendToSnapCapiRoute`, `useMetaEvents`, `useSnapEvents` in PR #40 | 0 |
| Same two checks for PR #42, #43, #44 (`572d0415..HEAD`) | no tracking file changed, 0 removed tracking lines |
| Live after the merges: Meta `PageView`, `ViewContent`, `AddToCart`, `AddToWishlist` and Snap `PAGE_VIEW`, `VIEW_CONTENT`, `ADD_CART`, `ADD_TO_WISHLIST` | all fire, with the right parameters and shared dedup ids (Section 2) |

### 1.2 Is any part of the event setup tied to app.zicabella.com? — Partly, and it matters.

The event *code* is not hard-wired to app.zicabella.com: pixel ids, CAPI endpoints, `event_source_url` (always the real page URL), feed `<link>` values (523 items, all `https://zicabella.com/products/…`, verified live) and the identity cookies (set on `.zicabella.com`) are all correct for zicabella.com.

But **app.zicabella.com is a live second copy of the whole storefront** (HTTP 200 for `/`, `/products/*`, `/feed.xml`, no redirect to zicabella.com), and on it **both pixels and both relays fire exactly as on zicabella.com** (verified live: `fbq` present, 2 Meta events counted, Snap beacons sent, POSTs to `/api/meta/event` and `/api/snap/event`). Only GTM is switched off there (`app/layout.tsx:205`). Several customer-facing links send shoppers to that host, so their sessions and events are recorded under app.zicabella.com. Full inventory and fix in Section 5 (finding **N2**).

### 1.3 Shortcomings found (ranked)

| # | Sev | Finding | Status |
|---|---|---|---|
| N1 | **Critical** | Meta browser-pixel events never reach Meta: the pixel is configured (in Events Manager, not in code) with a Conversions API / Signals Gateway at `https://signals.birch.click` (fallback `…ecs.us-east-2.on.aws`), the site's CSP blocks both hosts, and the pixel sends nothing to `facebook.com/tr` at all. Only the first-party relay/CAPI copies arrive. | confirmed live + locally |
| N2 | **High** | app.zicabella.com serves the full storefront with live pixels; WhatsApp templates, abandoned-cart recovery links and the dashboard chat send customers there; the catalogue-feed URL shown in the dashboard is also on that host. | confirmed live + code |
| N3 | **High (decision)** | The gateway host `signals.birch.click` is not Meta's and not yours in this codebase: domain registered 2026-05-26, Cloudflare-fronted, `/` redirects to a login page. Find out who set it up (an agency, a "Birch" pixel/gateway vendor, a previous developer) before deciding between allowing it in CSP or removing it from the pixel. | needs owner |
| N4 | Medium | Because of N1 the first-party relay is now Meta's *only* source: any relay failure (429 per-visitor limit, 5xx, consent hold) loses the event completely, with no browser fallback. | consequence of N1 |
| N5 | Medium | Every page load on the live site produces ~40 CSP-violation console errors in the first 7 s (the gateway plugin retries both hosts per event). Cost: noise in every debugging session and wasted main-thread work. Goes away with the N1 fix. | confirmed live |
| N6 | Low | On app.zicabella.com two `_fbc` cookies coexist (host-only one written by the pixel, `.zicabella.com` one written by the middleware); whichever comes first in `document.cookie` wins, so the click id can be stale. Not seen on zicabella.com. | confirmed live |
| N7 | Low | `external_id` is sent unhashed to both platforms (the DB cuid). Both say "hashing recommended", not required. | code |
| N8 | Low | Meta `Search` carries `search_string` + `content_type` but no `content_ids` (Meta: recommended for catalog ads). Snap `SEARCH` does carry `item_ids`. | code (known from prior audit) |
| N9 | Low | Snap `PAGE_VIEW` on product pages has no `item_ids`; acceptable because `VIEW_CONTENT` carries them (Snap requires one of the two). | code (prior S-C11) |
| N10 | Low | Snap `ADD_TO_WISHLIST` CAPI copy has `content_ids`/`value`/`currency` but no `contents`/`num_items` (optional). | live capture |
| N11 | Low | Snap pixel has no consent hold (Meta has `fbq('consent','revoke'/'grant')`). Irrelevant for India traffic; relevant only if EU visitors must be gated. | code |
| N12 | Info | Meta `ge` (gender) is never collected; `db` only when a birthdate cookie exists. Optional keys. | code |
| N13 | Info (out of scope) | Four GA4 measurement cookies (`_ga_DHCXV3YQNG`, `_ga_VN0WE6J114`, `_ga_WJS7FB7SQQ`, `_ga_Y156EHPVXM`) are set on the site: four GA4 streams receive data. Not a Meta/Snap issue; worth a separate look. | live |
| N14 | Info | GTM container `GTM-WKTQJ5LF` is now populated (the 2026-10-28 audit found it empty). Its JS contains no `fbq`, `snaptr`, `connect.facebook.net`, `sc-static.net` or `tr.snapchat.com` references, so it does **not** duplicate Meta/Snap events. | verified from the container JS |

Everything else in the two platforms' requirement lists is implemented and was verified (Sections 3 and 4). Items the owner must check in Events Manager / Ads Manager because they cannot be read from code are in Section 7.

---

## 2. Live evidence (2026-11-01)

### 2.1 Relay payloads captured on zicabella.com (guest session with bound guest cookies)

| Event | eventId / dedup id | custom_data | user_data keys sent to the server |
|---|---|---|---|
| Meta `PageView` | `pv.<uuid>` | — | client_user_agent, fbp, fbc, external_id, ct, st, zp, country (hashed), piiOwner |
| Meta `ViewContent` | uuid | content_ids `["53040138551577"]`, content_type `product`, contents `[{id, quantity 1, item_price 6649}]`, value 6649, currency INR, content_name, content_category | same |
| Meta `AddToCart` | `85c8688e-…` | content_ids `["53040138617113"]` (size-30 variant), contents, value 6649, INR, name, category | same |
| Meta `AddToWishlist` | `18c5bedf-…` | same shape as AddToCart | same |
| Snap `PAGE_VIEW` | `pv_snap_<uuid>` | — | em, ph, fn, ln, ct, st, zp, country (all SHA-256, from bound guest cookies) |
| Snap `VIEW_CONTENT` | uuid | value 6649, INR, content_ids `["53040138551577"]`, content_category, content_name, contents | same |
| Snap `ADD_CART` | `add_cart_snap_<uuid>` | content_ids `["53040138617113"]`, contents, num_items 1, value 6649, INR | same |
| Snap `ADD_TO_WISHLIST` | `add_to_wishlist_snap_<uuid>` | content_ids, value, currency, name, category (no contents / num_items → N10) | same |

- The Meta relay (`app/api/meta/event/route.ts:303-332`) re-adds `em`/`ph`/`fn`/`ln`/`ct`/`st`/`zp`/`country`/`db` from the `zb_guest_*` cookies when `zb_pii_owner` equals the visitor's `external_id`, so the server-side Meta event carries the same identity as the Snap one; the browser pixel's own Advanced Matching state (`fbq.getState().pixels[0].userData`) held `external_id, em, ph, fn, ln, ct, st, zp, country`.
- Content ids are Shopify **variant** ids and match the live catalogue feed: `53040138551577` and `53040138617113` both appear as `<g:id>` in `https://zicabella.com/feed.xml`.
- `_fbc` was minted from `?fbclid=AUDITCLICK42xyz` as `fb.1.<ms>.AUDITCLICK42xyz` (correct format), `_fbp` present, `ScCid` and `_scid` present; `sc_click_id`/`sc_cookie1` are read by the Snap relay (`app/api/snap/event/route.ts:119-120`).

### 2.2 Meta browser pixel network behaviour (finding N1)

Fresh document load of `/products/the-watcher-t-shirt?zbaudit=fresh1` on zicabella.com, measured 7 s after navigation with Resource Timing (87 resources, buffer not full):

| Observation | Value |
|---|---|
| `connect.facebook.net/en_US/fbevents.js` and `signals/config/2049977412558608` loaded | yes |
| `fbq.getState().pixels[0].eventCount` | 2 (PageView + ViewContent) |
| Requests to `www.facebook.com/tr` (img / beacon / fetch / xhr) | **0** |
| Snap beacons to `tr.snapchat.com/p`, `tr6.snapchat.com/p` | 3 |
| Console errors "Connecting to `https://signals.birch.click/events/8b4c63e7…` violates … connect-src" and the same for `https://ca-e378c80be3e6414fbf602b3d9bdb79e5.ecs.us-east-2.on.aws/events/…` | 40 in 7 s |

Why: the pixel's own configuration file (public, `connect.facebook.net/signals/config/2049977412558608`) contains

```
config.set("2049977412558608", "openbridge", {"endpoints":[{"targetDomain":null,
 "endpoint":"https://signals.birch.click","usePathCookie":true,
 "fallbackDomain":"https://ca-e378c80be3e6414fbf602b3d9bdb79e5.ecs.us-east-2.on.aws",
 "alwaysRetry":false}],
 "eventsFilter":{"filteringMode":"blocklist","eventNames":["SubscribedPageVisibilityOpened", … ,"Microdata","PageOpened","PageClosed","PageInactive"]},
 "additionalUserData":{"sendFBLoginID":true,"useSGWUserData":true},"blockedWebsites":[]});
```

and loads the `openbridge3` plugin. That is the Events Manager "Conversions API Gateway / Signals Gateway" connection. With it active the pixel on this site sends its events only to that gateway (Meta's own CAPI Gateway page describes the gateway as additive, but on this pixel no direct `facebook.com/tr` request is made; third-party documentation of the newer Signals Gateway describes exactly this gateway-only routing). The site's CSP (`next.config.mjs`, `connect-src`) does not allow either host, so the browser half of every Meta event is dropped on every page.

Control experiment (local production build, `lighthouse/pixel-debug.mjs`, Facebook hosts answered locally): with the live pixel id → no `/tr` request at all; with a dummy pixel id (no gateway in its config) → `GET facebook.com/tr?ev=PageView…` and `ev=ViewContent…` with full `cd[…]`, `ud[…]`, `eid` parameters. Same code, only the pixel config differs.

What Meta still receives: the first-party relay (`/api/meta/event` → Graph API) and the server Purchase (`lib/meta/purchase.ts`) — all with `event_id`, `fbp`, `fbc`, hashed PII, IP and user agent. What is lost: the browser copy of every event (so Events Manager shows no "Browser" source and no dedup pairs), Automatic Advanced Matching, automatic/inferred events, Microdata, and any redundancy when the relay fails (N4).

The gateway host itself: `https://signals.birch.click/` answers through Cloudflare with `302 → /auth/login/` (an admin login page), the `/events/<id>` path also redirects to login, and `birch.click` was registered on 2026-05-26. Nothing in this repository, its env examples or its docs references it. A web search for the gateway name surfaces a "Birch" (bir.ch) pixel/gateway vendor; whether Zica Bella signed up for it is for the owner to confirm (N3).

### 2.3 app.zicabella.com (finding N2)

Fresh load of `https://app.zicabella.com/products/the-watcher-t-shirt?zbaudit=apphost`:

| Observation | Value |
|---|---|
| HTTP status of `/`, `/products/viscera-denim`, `/feed.xml` on app.zicabella.com | 200, 200, 200 (no redirect; `www.zicabella.com` correctly 308s to `zicabella.com`) |
| `window.fbq` / `window.snaptr` present | yes / yes |
| Meta events counted, Snap beacons | 2, 3 |
| POSTs to `/api/meta/event`, `/api/snap/event`, `/api/openai-ads/event` | 2 each |
| `window.__zbGtmId` | `""` (GTM is the only thing gated off on this host) |
| `<link rel=canonical>` | `https://zicabella.com/products/the-watcher-t-shirt` (SEO is fine; tracking is not gated) |
| `_fbc` cookies visible to the page | two (N6) |

### 2.4 GTM and feed

- `https://www.googletagmanager.com/gtm.js?id=GTM-WKTQJ5LF` (335 KB) contains no Meta or Snap tag code (N14) — the `page_view` it pushes is GA/Google Ads only.
- `feed.xml`: 523 items, every `<link>` on `https://zicabella.com`, images on `cdn.shopify.com`, `<g:id>` = variant id, `<g:item_group_id>` = product id.

---

## 3. Meta requirements vs implementation

Status: PASS = verified in code and live/locally; GAP = finding above; CHECK = cannot be verified from code (Section 7).

### 3.1 Events

| Event | Meta requirement (Appendix A) | Implementation | Status |
|---|---|---|---|
| PageView | base code on every page; SPA route changes need a manual PageView | `components/MetaPixelRouteTracker.tsx` once per route, `eventId pv.<uuid>`, browser + relay | PASS (browser copy blocked by N1) |
| ViewContent | `contents`/`content_ids` + `content_type` for Advantage+ catalog | `hooks/useMetaEvents.ts` builders: content_ids [variant id], content_type `product`, contents [{id, quantity, item_price}], value, currency, content_name, content_category | PASS |
| Search | `search_string`; `content_ids` recommended for catalog | `search_string`, `content_type`; no `content_ids` | N8 (low) |
| AddToCart | `contents` or `content_ids` (+quantity) | same shape as ViewContent | PASS |
| AddToWishlist | `content_ids`, `contents`, value, currency | same shape | PASS |
| InitiateCheckout | value, currency, `num_items`, contents | `app/checkout/page.tsx:380-410`: display-currency money, num_items, contents, ids; fires once after login (checkout is login-gated), dedup marker per cart (`lib/meta/initiate-checkout.ts`) | PASS |
| AddPaymentInfo | value, currency, contents | `app/checkout/page.tsx:1678-1700` with full address PII | PASS |
| Purchase | **value + currency required**, contents/content_ids + content_type, `num_items`, `order_id`, fire once | Browser: `app/orders/[id]/confirmation/page.tsx:240-266` after server-verified paid, once-guard (localStorage + sessionStorage), `eventID = order.id`. Server: `lib/meta/purchase.ts` from the stored order, `event_id = order.id`, value/currency from `lib/meta/order-value.ts` (same source as the browser), order_id, contents, num_items; retried within the 7-day window (`META_WINDOW_MS`) | PASS |
| CompleteRegistration | optional `status` | `status: 'completed'` (`useMetaEvents.ts:540`) | PASS |
| Lead (newsletter) | — | `trackNewsletterLead` in `components/StorefrontFooterClient.tsx:63` | PASS |
| Contact | — | `trackContact` available | PASS |
| Event names case-sensitive | — | `FbqEventName` union, exact names | PASS |

### 3.2 Identity (`user_data`) and matching

| Key | Required form | Implementation | Status |
|---|---|---|---|
| em, ph, fn, ln, ct, st, zp, country | SHA-256 of normalised value; ph with country code, no `+` | `lib/buildMetaUserData.ts` (normalisePhone with country ISO), hashed before relay; server re-hashes/validates | PASS |
| db, ge | YYYYMMDD / f,m hashed | db from `zb_guest_dob` when present; ge never | N12 (info) |
| external_id | any unique id, hashing recommended | raw DB cuid | N7 (low) |
| client_ip_address | never hashed; set manually on server events | relay: trusted header IP or `zb_client_ip` cookie (`app/api/meta/event/route.ts:222-224`) | PASS |
| client_user_agent | required for website events | `navigator.userAgent` sent by client, validated server-side (`:205`) | PASS |
| fbp / fbc | `fb.1.<ms>.<id>`, never hashed, refresh regularly, fbc updated on new fbclid | minted/refreshed as HTTP cookies in `middleware.ts:298-340` (`planMetaIdentityCookies`, rewrites on change, refresh ≤ 12 h), read by the relay | PASS |
| Advanced Matching (pixel `init`) | manual via `fbq('init', id, {...})`; automatic via toggle | `initPixel()` re-inits on identity change; Automatic Advanced Matching is on in the live config | PASS (browser side dead → N1) |
| EMQ drivers (email, fbc high; phone, external_id, fbp, country medium) | — | all present on relay events when known | PASS |

### 3.3 Conversions API transport

| Requirement | Implementation | Status |
|---|---|---|
| `event_name`, `event_time` (Unix s, ≤ 7 days), `action_source: website`, `event_source_url` (https, verified domain), `event_id` | `lib/metaCapi.ts:321-333`; 7-day guard `:202-205`; purchases never re-dated (`lib/meta/purchase.ts:219-220`) | PASS |
| `event_source_url` host allow-list | `app/api/meta/event/route.ts:53` accepts zicabella.com, www, **app.zicabella.com** | PASS by design, but see N2 |
| Browser↔server dedup on `event_id` + `event_name` within 48 h | same uuid on both sides for every event; `order.id` for Purchase | PASS (pairs cannot form while N1 persists) |
| Token never in URL | POST body (`lib/metaCapi.ts:339-341`) | PASS |
| `test_event_code` only in test | env-gated (`TEST_EVENT_CODE`) | CHECK that it is unset in production |
| LDU / consent | `NEXT_PUBLIC_META_LDU` gated; `fbq('consent','revoke')` before init when held, `grant` on consent (`lib/meta/consent-client.ts`) | PASS |
| Abuse limits | 120/min per visitor (IP + device id), 2000/min per IP | PASS (CGNAT-safe) |
| Catalog: `content_ids` must equal catalog `id`; `content_type: product` | variant ids = feed `<g:id>` | CHECK that the Meta catalog's item ids are these variant ids (Section 7) |

---

## 4. Snap requirements vs implementation

### 4.1 Events

| Event | Snap requirement (Appendix B) | Implementation | Status |
|---|---|---|---|
| PAGE_VIEW | `item_ids` on PAGE_VIEW *or* VIEW_CONTENT for Dynamic Ads | `components/SnapPixelRouteTracker.tsx`, `client_dedup_id = pv_snap_<uuid>`, browser + relay; no item_ids | N9 (low, covered by VIEW_CONTENT) |
| VIEW_CONTENT | `item_ids` mandatory; `item_category`, `price`, `currency` | `hooks/useSnapEvents.ts`: item_ids [variant id], price, currency, item_category, description; relay mirrors as content_ids/value/currency/content_category/content_name/contents | PASS |
| ADD_CART | `item_ids`, `number_items`, `price` mandatory; `currency` | all present (`useSnapEvents.ts:249`), relay num_items as string (Snap types it string) | PASS |
| ADD_TO_WISHLIST | `item_ids` | item_ids, price, currency; relay lacks contents/num_items | N10 (low) |
| START_CHECKOUT | none required; item_ids/number_items/price/currency useful | `app/checkout/page.tsx:437-447` (signed-in, as checkout is login-gated), unique categories ≤ 256 chars | PASS |
| ADD_BILLING | none required | three call sites, once-guarded (`app/checkout/page.tsx:1372, 1910, 2288`) | PASS |
| PURCHASE | `price`, `currency`, `transaction_id` required for ROAS; `item_ids`, `number_items`; fire once | Browser (`confirmation/page.tsx:318-345`): `client_dedup_id = transaction_id = order.id`, price = charged total in charged currency, item_ids, number_items, once-guard. Server (`lib/snap/purchase.ts`): `event_id = order.id`, `order_id = order.id`, value/currency from the order, content_ids, num_items; retried ≤ 7 days (`lib/snap-capi.ts:189-190`) | PASS |
| SIGN_UP | `sign_up_method` mandatory | present (`useSnapEvents.ts:317-319`) | PASS |
| LOGIN, SUBSCRIBE | — | `app/login/page.tsx:466`, footer newsletter | PASS |
| SEARCH | `search_string` mandatory | `search_string` + first result variant ids | PASS |

### 4.2 Identity and CAPI v3

| Requirement | Implementation | Status |
|---|---|---|
| Pixel `init` with `user_hashed_email` / `user_hashed_phone_number` / name / geo; re-`init` when identity changes; Automated Matching toggle | `lib/snapPixel.ts:146-192` builds the identity from session or bound cookies; `SnapPixelRouteTracker.tsx:76-91` re-inits on change | PASS; toggle = CHECK |
| CAPI `user_data`: ≥ 1 of em / ph / ip+UA; `sc_cookie1` (`_scid`), `sc_click_id` (ScCid), `client_user_agent`, hashed lists | `lib/snap-capi.ts`: em/ph arrays hashed, fn/ln/ct/st/zp/country hashed, external_id string (raw → N7), client_ip_address, client_user_agent, sc_click_id, sc_cookie1 | PASS |
| `event_name` exact enum, `event_time` ms, `action_source WEB`, `event_source_url` with protocol on an allowed host | `lib/snap-capi.ts:270-276`; host allow-list `lib/snap/config.ts:82` (includes app.zicabella.com → N2) | PASS |
| Dedup: pixel `client_dedup_id` === CAPI `event_id` (48 h); PURCHASE also `transaction_id` === `order_id` (30 days) | both implemented | PASS |
| PURCHASE `value` + `currency` required; `num_items` string; `value` float | `custom_data.value` number, `num_items` String | PASS |
| Token in query string (Snap documents it) | `snapEventsEndpoint` | PASS (Snap's own convention) |
| Event age ≤ 7 days | guarded, skipped with a log | PASS |
| ScCid captured from the landing URL and persisted; `_scid` sent | middleware mints `ScCid` from `?ScCid`/`?sccid`, pixel/relay read it | PASS |
| `item_ids` = catalog feed `id` (variant), `item_category` = `item_group_id` | `lib/snap/catalog-id.ts`, feed `<g:id>` variant, `<g:item_group_id>` product; `item_category` carries the product *type* (e.g. "BAGGY JEANS"), not the item_group_id | PASS for item_ids; item_category by category name is Snap's documented use for category-level matching only if the feed's item_group_id matched it — it does not, so parent-level matching relies on item_ids (acceptable) |
| Consent | no revoke/grant equivalent for Snap | N11 (low) |

---

## 5. app.zicabella.com inventory (finding N2)

### 5.1 Why it matters for events

- Shoppers who arrive on app.zicabella.com get the same pixels, so Meta/Snap record `event_source_url` on that host. Meta asks that the source URL "match the verified domain"; if only zicabella.com is verified, those events are second-class.
- The pixels' own host-only cookies differ between the two hosts (two `_fbc` cookies seen, N6), so click attribution can split or go stale across hosts.
- Any `?fbclid` / `?ScCid` landing that is later continued on the other host loses its click context at the SDK level (the middleware's `.zicabella.com` cookies mitigate this for the relays, not for the pixel's own state).
- If the catalogue in Commerce Manager / Snap Ads Manager was registered from the dashboard's displayed URL, the feed is fetched from app.zicabella.com; it works today, but it is a dependency on the wrong host.

### 5.2 Customer-facing links that point to app.zicabella.com

| Location | What |
|---|---|
| `app/api/shopify/carts/abandoned/route.js:89` | abandoned-cart recovery URL `https://app.zicabella.com/cart?recover=…` |
| `app/dashboard/whatsapp-events/chat/page.tsx:576, 671, 795, 872` | product links and the default site URL inserted into WhatsApp chat messages |
| `app/api/whatsapp/templates/seed/route.js:49, 76, 103, 166, 197, 228` | WhatsApp template buttons `https://app.zicabella.com/orders/{{1}}` and `/{{1}}` |
| `app/dashboard/marketing/whatsapp/page.tsx:682, 731` | placeholders shown to the operator (suggest the app host) |
| `lib/product-feed.ts:32-38` (`getFeedBaseUrl`) → `:248, :266` → `app/dashboard/marketing/catalogue-feeds/page.tsx:193-194` | the "XML feed / CSV feed" URLs shown to the owner prefer `NEXT_PUBLIC_APP_URL` (= app.zicabella.com in production per `AUDIT.md`), falling back to app.zicabella.com |

Server-internal or admin uses that are fine to keep: `lib/shopify-webhooks.ts:37`, `lib/cors.ts:11`, `app/api/webhooks/openai/route.ts:121`, `app/api/app/orders/cancel/route.ts:171`, `app/api/admin/orders/[id]/*`, support-ticket emails linking the admin dashboard, `middleware.ts:403`, the relay host allow-lists (`app/api/meta/event/route.ts:53`, `lib/snap/config.ts:82`).

### 5.3 Recommended fix (code, not yet made)

1. In `middleware.ts`, 301-redirect every storefront path on `app.zicabella.com` to the same path on `https://zicabella.com` (keep `/dashboard`, `/admin`, `/api`, `/w*` and other admin/app paths on the app host). This alone fixes the pixel, cookie and attribution split.
2. Replace the hard-coded customer links above with `NEXT_PUBLIC_SITE_URL` (`https://zicabella.com`); make `getFeedBaseUrl()` prefer `NEXT_PUBLIC_SITE_URL` so the dashboard shows `https://zicabella.com/feed.xml`.
3. Optional belt-and-braces: skip `initPixel` / `initSnapPixel` when `location.hostname === 'app.zicabella.com'` (mirror the GTM gate in `app/layout.tsx:205`).
4. After the redirect is live, re-register the catalogue feed URL in Commerce Manager / Snap as `https://zicabella.com/feed.xml` if it currently uses the app host.

---

## 6. Recommended remediation, in order (nothing done yet)

| Step | Where | Owner action / code |
|---|---|---|
| 1. Decide on the gateway (N1, N3) | Meta Events Manager → the pixel → Settings → "Conversions API Gateway" / "Signals Gateway" | Identify who created the `signals.birch.click` gateway. **Option A (recommended if nobody claims it):** disconnect/remove the gateway from the pixel; the pixel then sends to Meta directly again (proven by the dummy-id control run) and the existing first-party relay keeps its CAPI copy with dedup. **Option B (if it is yours and wanted):** add `https://signals.birch.click` and `https://ca-e378c80be3e6414fbf602b3d9bdb79e5.ecs.us-east-2.on.aws` to `connect-src` in `next.config.mjs`; then confirm in Events Manager that browser and server events pair up (Event deduplication tab), and that the gateway and the relay are not both treated as "server" copies with different ids (both carry the same `event_id`, so they should dedup). |
| 2. Verify in Events Manager after step 1 | Test Events / Overview | Browser events appear for PageView, ViewContent, AddToCart, InitiateCheckout, Purchase; EMQ per event; "Event deduplication" shows pairs. |
| 3. app.zicabella.com redirect + link clean-up (N2, N6) | code change, one PR | Section 5.3. |
| 4. Low items (N7–N11) | code, one small PR | hash `external_id` (both), add `content_ids` to Meta Search, `contents`/`num_items` to Snap ADD_TO_WISHLIST CAPI, `item_ids` on product PAGE_VIEW, optional Snap consent hold. |
| 5. Separate look (N13) | GA | four GA4 streams on one site. |

I will not make any of these changes, or merge/deploy anything, without your go-ahead.

---

## 7. Owner checklist (cannot be verified from code)

- [ ] Meta Events Manager → pixel 2049977412558608 → Settings → Conversions API Gateway / Signals Gateway: who connected `signals.birch.click`? (N3)
- [ ] Meta Business Settings → Brand Safety → Domains: `zicabella.com` verified (events from app.zicabella.com would not match it).
- [ ] Commerce Manager → catalogue → item ids are the Shopify **variant** ids (the feed's `<g:id>`, e.g. `53040138551577`). If the catalogue was imported through Shopify's Facebook channel instead, its ids look like `shopify_IN_<product>_<variant>` and no `content_ids` will match (catalog match rate → 0). The feed URL registered should be `https://zicabella.com/feed.xml`.
- [ ] Events Manager → Diagnostics: after step 1, no "Multiple events on an action", "Mismatched value/currency", "Redundant purchase events".
- [ ] Production env: `TEST_EVENT_CODE`/Meta test code unset; `META_CAPI_ACCESS_TOKEN` and `SNAP_CAPI_ACCESS_TOKEN` valid (`/api/meta/connection-test`, `/api/snap/connection-test` exist for this).
- [ ] Snap Events Manager → pixel 7d2481be-… → Automated Matching toggle on; Event Quality Score per event (PURCHASE, ADD_CART, VIEW_CONTENT) GOOD; "Event Deduplication" box shows pixel+CAPI pairs; catalogue ids = variant ids, feed URL on zicabella.com.
- [ ] Snap Ads Manager → Conversions API token still valid (last rotation).

---

## Appendix A — Meta requirements matrix (official sources, fetched 2026-11-01)

Sources: Meta Pixel reference, standard-events spec, conversion-tracking, get-started, advanced matching (dev + Business Help ×2), CAPI customer-information parameters, server-event, custom-data, parameters, main body, using-the-API, best practices, deduplication (dev + help), fbp/fbc, data-processing options, GDPR, omni setup guide, Advantage+ catalog ads (pixel + DPA + requirements + catalog matching), EMQ, best-practices help, monitoring, data-freshness (×2), diagnostics, pixel errors, value/currency, pixel best practices, privacy, cookie setup, test events. (35 pages.)

**Events.** `ViewContent`, `AddToCart`, `Purchase` are required for Advantage+ catalog ads and need `contents` or `content_ids` whose ids equal the catalogue `id` (`content_type: product`) or `item_group_id` (`product_group`; never on AddToCart/Purchase). `Purchase` requires `currency` (ISO 4217) and numeric `value`. `num_items` is for InitiateCheckout/Purchase; `order_id` string on CAPI Purchase; `search_string` with Search; `status` on CompleteRegistration. Names are case-sensitive.

**user_data.** SHA-256 lowercase hex of normalised values for em (trim, lowercase), ph (digits only, country code, no leading zeros/`+`), fn/ln (lowercase, no punctuation), ge (`f`/`m`), db (`YYYYMMDD`), ct/st/zp (lowercase, no spaces/punctuation; non-US zip as-is), country (ISO alpha-2 lowercase). Never hash `client_ip_address`, `client_user_agent`, `fbc`, `fbp`, `fb_login_id`, `lead_id`, `subscription_id`; `external_id` hashing recommended. EMQ weights: high = email, fbc; medium = fb_login_id, db, country, ph, external_id, fbp; low = lead, fn, ln, ct, zp.

**CAPI.** `POST graph.facebook.com/{ver}/{pixel}/events`, ≤ 1000 events; per event `event_name`, `event_time` (Unix s, ≤ 7 days old, else whole request fails), `action_source`, `event_source_url` (required for web, verified domain), `user_data.client_user_agent` (required for web), `client_ip_address`, `fbp`/`fbc`, `event_id` (= pixel `eventID`, dedup 48 h, first-received wins; fallback dedup on fbp/external_id only browser-then-server). `test_event_code` must not be in production payloads. Send within 1 h (catalog ads: ≤ 24 h max). Coverage target ≥ 75 % CAPI-to-pixel. Consent: `fbq('consent','revoke')` before init, `grant` later; LDU is US-only and not a consent mechanism.

**Diagnostics Meta names.** invalid/missing currency; missing/invalid value; value/currency mismatch pixel vs CAPI; event-name case mismatch; multiple events on one action (base code twice); redundant purchase events; invalid email; duplicate events; missing/mismatched `event_id`; stale fbp/fbc; wrong `content_ids`/`content_type`; events older than the window.

## Appendix B — Snap requirements matrix (official sources, fetched 2026-11-01)

Sources: developers.snap.com CAPI Parameters, UsingTheAPI, Deduplication, VerifySetUp, Introduction, BestPractices, MigrationGuide, OfflineEvents, custom-conversions, signal-readiness, website-events, v2 reference; Business Help: pixel direct implementation, website install, dynamic best practices, dynamic-ads requirements, catalogue specs, event mapping, Pixel Helper glossary, pixel FAQ ×3, dedup ×3, EQS ×2, click-id ×2, events FAQ, CAPI FAQ/best practices/checklist/testing/activation, privacy FAQ, CCPA; official pixel script `sc-static.net/scevent.min.js`. (41 pages + script.)

**Events.** Pixel needs a Pixel ID and at least one standard event. PURCHASE: `price`, `currency`, `transaction_id` required for ROAS, `item_ids`, `number_items`; fire once per page. VIEW_CONTENT: `item_ids` mandatory (+ `item_category`, `price`, `currency`). ADD_CART: `item_ids`, `number_items`, `price` (+ `currency`, `item_category`). SIGN_UP: `sign_up_method`. SEARCH: `search_string`. Dynamic Ads: `item_ids` on PAGE_VIEW or VIEW_CONTENT (required), ADD_CART and PURCHASE (highly recommended); `item_ids` = catalogue `id`, `item_category` = `item_group_id`. Currency ISO 4217 from Snap's supported list (INR included).

**Identity.** Pixel `init`: `user_email`/`user_hashed_email`, `user_phone_number` (digits with country code, no `+`)/`user_hashed_phone_number`, `firstname`, `lastname`, `geo_*`, `age`, `ip_address` (SDK hashes plaintext); user params only in `init`; enable Automated Matching too. CAPI v3 `user_data`: `em`, `ph`, `fn`, `ln`, `ge`, `ct`, `st`, `zp`, `country` hashed (lowercase hex SHA-256 of normalised values; ph digits with country code, leading zeros removed), `external_id` (hashing recommended), `client_ip_address`, `client_user_agent`, `sc_click_id` (ScCid, UUID), `sc_cookie1` (`_scid`) unhashed. Minimum one of em / ph / ip+UA, else error "Insufficient PII".

**CAPI v3.** `POST tr.snapchat.com/v3/{pixel}/events?access_token=…`; per event `event_name` (exact enum), `event_time` (epoch s or ms, ≤ 7 days), `event_source_url` (with protocol), `action_source: WEB`, `user_data`; PURCHASE needs `custom_data.currency` + `value`; `event_id` must equal pixel `client_dedup_id` (48 h); PURCHASE `transaction_id` ⇄ `custom_data.order_id` (30 days); `num_items` is a string, `value` a float, `content_ids` array of catalogue ids with `content_type`. `/events/validate` endpoint for testing; ≤ 2000 events per request; send in real time (< 1 h). Opt-out only `data_processing_options: ["LMU"]` for ATT opt-outs.

**EQS issues Snap names.** events lacking valid identifiers; incorrectly hashed parameters; identical parameters across events; invalid/missing currency and price on PURCHASE; low click-id return rate; missing transaction ids; same client_dedup_id across events; low transaction-id overlap pixel vs CAPI; mislabelled event types; low item-id ↔ catalogue match; missing funnel events; duplicate PURCHASE on one page; missing `sc_cookie1`/`sc_click_id`; stale timestamps; pixel loaded late / click id stripped by redirects or consent gates.
