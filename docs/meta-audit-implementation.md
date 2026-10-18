# Meta Pixel + Conversions API — audit implementation (October 2026)

Implements the fix plan of the Meta tracking audit (main `71df5e9`, 14 Oct 2026).
Every change is a separate commit so any one can be reverted alone; none touches
COD / prepaid state logic, Shopify sync, Razorpay, Shiprocket or the GA4 payloads.

| # | Change | Files | Default behaviour |
| --- | --- | --- | --- |
| 4 | One Pixel-id resolver; non-production builds send nothing unless an id is set | `lib/meta/config.ts`, `app/layout.tsx`, `lib/metaPixel.ts`, `lib/metaCapi.ts`, admin diagnostics | Production build of the live site: unchanged (store pixel). Dev / test / preview: Meta off |
| 6 | `keepalive` on the browser→CAPI relay | `hooks/useMetaEvents.ts`, `components/MetaPixelRouteTracker.tsx` | Events survive hard redirects (CompleteRegistration) |
| 11 | Hygiene: fbq options, FB SDK opt-in, token in POST body, `_fbc` index | `lib/metaPixel.ts`, `components/FacebookSDKInit.tsx`, `lib/metaCapi.ts`, `components/MetaPixelRouteTracker.tsx` | FB JS SDK no longer loads unless `NEXT_PUBLIC_META_FB_LOGIN=1` |
| 9 | `contents` = `id` / `quantity` / `item_price` (+ `delivery_category: home_delivery` on Purchase) | `hooks/useMetaEvents.ts`, `lib/meta/purchase.ts` | Only payload change visible in the regression capture |
| 10, 12 | No IP-derived `st`; `ip-api.com` (plain HTTP) opt-in only | `app/api/meta/event/route.ts`, `lib/ip-geo.ts`, browser geo fallback | Country from IP kept |
| 1 | `_fbp`, `_fbc` (from `?fbclid`), `zb_external_id` minted / refreshed as HTTP cookies (Safari ITP) | `middleware.ts`, `lib/meta/identity-cookies.ts` | Refresh at most every 12 h (`zb_idc` marker); new values always written |
| 2 | Funnel events report the displayed currency (global store) | `lib/meta/money.ts`, PDP, QuickAdd, search card, wishlist, bookmark drawer, checkout | India: byte-identical (identity conversion) |
| 5 | One InitiateCheckout per checkout attempt (guest→login remount) | `lib/meta/initiate-checkout.ts`, `hooks/useMetaEvents.ts` | GA4 `begin_checkout` unchanged |
| 7 | Internal / test orders never a Purchase | `lib/meta/internal-orders.ts`, `lib/meta/purchase.ts`, `lib/meta/browser-purchase.ts`, confirmation API | Tags `test` / `internal` / `meta-exclude` and demo accounts excluded; env allow-lists optional |
| 13 | Cart-recovery pay link records click context + variant ids | `app/api/pay/[cartId]/route.ts` | Link-preview crawlers ignored |
| 3 | Region-aware consent + Limited Data Use | `lib/meta/consent.ts`, `lib/meta/consent-client.ts`, `components/MetaConsentGate.tsx`, `app/layout.tsx`, `app/api/meta/event/route.ts`, `lib/meta/purchase.ts` | **Off** until `NEXT_PUBLIC_META_CONSENT_REGIONS` / `NEXT_PUBLIC_META_LDU` are set |
| 8 | `/feed.xml?country=XX` priced in that country's display currency | `app/feed.xml/route.ts` | Plain `/feed.xml` unchanged (INR) |

## Tests (all pass on the branch)

```
npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-match-quality.ts      # 24
npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-purchase.ts           # 58
npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-identity-quality.ts        # 29
npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-identity-cookies.ts   # 26 (new)
npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-funnel-money.ts       # 13 (new)
npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-initiate-checkout.ts  # 12 (new)
npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-internal-orders.ts    # 18 (new)
npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-consent.ts            # 25 (new)
scripts/payment-e2e/meta-run.ts (real route handlers, in-memory DB)                               # 112
scripts/payment-e2e/run.ts                                                                         # 191
scripts/meta-regression/run.tsx main vs branch: 8 scenarios, the only diff is the intended
  `contents` change on the Purchase Pixel call (price/title removed, delivery_category added)
scripts/meta-regression/ga4-parity.ts: GA4 identical to main
tsc --noEmit: 0 errors · next build: 201 pages
```

Pre-existing, unrelated failures on `main` too: `scripts/verify-snap-international.ts` (repair-script case) and
`scripts/verify-snap-confirmation.tsx` (module resolution in the harness).

## Deployment

- No new variable is required for production. Keep `NEXT_PUBLIC_SITE_URL=https://zicabella.com`
  (or set `NEXT_PUBLIC_META_PIXEL_ID` and `META_PIXEL_ID` explicitly) — with the site URL pointing
  at another host the resolver treats the build as non-production and sends nothing to Meta.
- Optional switches (see `.env.example`): `NEXT_PUBLIC_META_CONSENT_REGIONS`, `NEXT_PUBLIC_META_LDU`,
  `NEXT_PUBLIC_META_FB_LOGIN`, `META_INTERNAL_CUSTOMER_IDS` / `_EMAILS` / `_PHONES`, `IP_GEO_PROVIDER=ip-api`.
- `NEXT_PUBLIC_*` values are inlined at build time: changing them needs a rebuild.
- Register `/feed.xml?country=GB` (etc.) in Commerce Manager as country feed overrides when the
  global store is live for those countries.

## Verify after deploy (Events Manager)

1. Test Events: ViewContent / AddToCart / InitiateCheckout arrive twice (Browser + Server) with the same
   event id and are marked deduplicated; `contents` carries only id / quantity / item_price.
2. A test order placed by an allow-listed or `test`-tagged account produces **no** Purchase.
3. Safari / iPhone: Application → Cookies shows `_fbp`, `_fbc`, `zb_external_id` as HTTP cookies with a
   90-day (365-day) expiry after an `?fbclid=` landing; `zb_idc` is HttpOnly.
4. Logs: no `[Meta CAPI][ALERT] pixel configuration` line at boot (browser / server id agree).
5. With consent regions enabled: a GB visitor sees the bar and nothing reaches Meta until Accept.

## Rollback

`git revert <commit>` for any single item (commits are independent; revert 1 and the review follow-up
together if rolling back the cookie change). Nothing writes to the database schema; the
`ad_conversion_deliveries` rows that internal orders create are plain `skipped` rows.
