# Meta Pixel + CAPI regression — main (e21989e) vs branch

## IN_guest — PASS

Events (branch): PageView fbq 2 / CAPI 1, ATC fbq 1 / CAPI 1, Purchase fbq 2 / CAPI 1 — identical to main

No differences at all.

## IN_logged_in — PASS

Events (branch): PageView fbq 2 / CAPI 1, ATC fbq 1 / CAPI 1, Purchase fbq 2 / CAPI 1 — identical to main

No differences at all.

## UK_guest — PASS

Events (branch): PageView fbq 2 / CAPI 1, ATC fbq 1 / CAPI 1, Purchase fbq 2 / CAPI 1 — identical to main

Changed match keys: **country, ph, zp** (7 values across cookies, pixel and CAPI)

## UK_logged_in — PASS

Events (branch): PageView fbq 2 / CAPI 1, ATC fbq 1 / CAPI 1, Purchase fbq 2 / CAPI 1 — identical to main

Changed match keys: **country, ph, zp** (18 values across cookies, pixel and CAPI)

## US_guest — PASS

Events (branch): PageView fbq 2 / CAPI 1, ATC fbq 1 / CAPI 1, Purchase fbq 2 / CAPI 1 — identical to main

Changed match keys: **ph, st, zp** (7 values across cookies, pixel and CAPI)

## US_logged_in — PASS

Events (branch): PageView fbq 2 / CAPI 1, ATC fbq 1 / CAPI 1, Purchase fbq 2 / CAPI 1 — identical to main

Changed match keys: **ph, st, zp** (18 values across cookies, pixel and CAPI)

## AE_guest — PASS

Events (branch): PageView fbq 2 / CAPI 1, ATC fbq 1 / CAPI 1, Purchase fbq 2 / CAPI 1 — identical to main

Changed match keys: **country, ph** (4 values across cookies, pixel and CAPI)

## AE_logged_in — PASS

Events (branch): PageView fbq 2 / CAPI 1, ATC fbq 1 / CAPI 1, Purchase fbq 2 / CAPI 1 — identical to main

Changed match keys: **country, ph** (12 values across cookies, pixel and CAPI)

## How this was produced
- `scripts/meta-regression/run-all.sh <tree> <out.json>` runs the real Meta code of a
  checkout (`lib/metaPixel`, `components/MetaPixelRouteTracker`, `hooks/useMetaEvents`,
  `app/api/meta/event` → `lib/metaCapi`) in jsdom with frozen time/ids, one process per
  scenario. Executed once on `main` (e21989e, git worktree) and once on this branch.
- `scripts/meta-regression/compare.ts main.json branch.json` applies the rules: India must be
  byte-identical; other countries may differ only in `ph` / `country` / `st` / `zp`, each equal
  to SHA-256 of the correctly normalized value.
- `scripts/meta-regression/send-test-events.ts docs/meta-regression-branch-capture.json`
  replays the captured branch payloads to Meta **Test Events** (needs token + test code).

## Pre-existing Meta issue (unchanged by this branch)
`/api/meta/event` and `lib/metaCapi.ts` still normalize a RAW phone by forcing `91`
(e.g. UK `07700 900123` → `917700900123`). The browser cookie path is fixed here, but the
Purchase CAPI built from raw checkout data still carries the India-prefixed hash for
international customers. Left untouched on purpose (Meta server code is out of scope for
this Snap branch) — recommended as a separate Meta fix.
