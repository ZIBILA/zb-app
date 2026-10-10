# Meta Pixel & CAPI — response to the final review (commit 1bac0c38)

Branch: `fix/meta-tracking-audit` only. Nothing is merged to `main` or deployed, and no credentials or environment variables were changed.

## P0 fixes

| # | Issue (verified in 1bac0c38) | Fix |
|---|---|---|
| 1 | `meta_purchase_fired_<id>` was written before the paid check. A pending visit therefore suppressed the later paid Purchase. | The Meta browser Purchase now has its own decision and marker (`lib/meta/browser-purchase.ts`). The marker `zb_meta_pixel_purchase_sent_<id>` is written only after `fbq('track','Purchase')` has been dispatched, so a pending visit writes nothing. While the order is `payment_pending`/`pending`/`authorized`, the confirmation page re-reads the order every 10 s for up to about 6 minutes, and fires once it becomes paid. Multiple tabs are serialised with a Web Lock (`navigator.locks`), and the marker is re-checked inside the lock. eventID is still the order id, so Pixel and CAPI still dedup. For guests, the identity reset is postponed until after the Pixel Purchase, so it keeps the shopper's own external_id. The shared legacy flag still gates Snap, OpenAI and ZB analytics, which are unchanged. The Razorpay flow is not touched. |
| 2 | A missing or malformed CAPI config returned `skipped:true`, and the ledger then marked the Purchase as permanently skipped. | `metaCapiConfigError()` is checked before the ledger claim. When it reports a problem, the row is stored as **failed** (retryable). No attempt is consumed, the event time is pinned to `paymentCapturedAt`/`createdAt` (never "now"), and a `[Meta Purchase][ALERT] meta_config_missing` is logged. Any `skipped` returned by the sender is converted to `failed`. Retries stay capped at 5 attempts (`MAX_ATTEMPTS`); a row that runs out of attempts raises `attempts_exhausted`. If a row passes Meta's 7-day window while still unsent, it is marked skipped and raises `expired_unsent`; it is never re-dated. The cron answers **200 with `ok:false`** when there is an alert. The workflow then fails the run through `jq`, and GitHub notifies maintainers. |
| 3 | Direct send without the ledger when the table is missing. | The direct send is removed, so every Purchase now goes through the ledger claim. If the table is missing, nothing is sent: the call fails closed and raises `ledger_table_missing` (cron → `ok:false`). To avoid losing conversions, a new missed-purchase scan in the cron re-sends missed purchases. It covers paid WEB_STORE orders that are less than 7 days old and more than 20 minutes old, and that either have no ledger row or only a `pending` one. It sends each through the ledger with the original timestamp. Migration `20261009010000_snap_delivery_and_newsletter` (already on main via PR #15) was verified on real Postgres; results are below. |
| 4 | `/api/meta/event` Purchase could start delivery for any paid order id. | The Purchase branch is now a no-op. It does no database access and no Graph call, and it keeps the response shape for old bundles. The browser no longer sends a Purchase relay at all. CAPI Purchase is sent only from trusted paths: checkout/complete (signature + capture), the Razorpay webhook (HMAC), and the cron (CRON_SECRET). All of them read value, items, identity and payment status from the stored order. Click context comes from the shopper's own checkout requests. Guest checkout, webhook recovery and dedup are unchanged. |

## P1

| # | Item | Status |
|---|---|---|
| 5 | Event quality | Purchase browser and server payloads are shown identical by test (value, currency, variant ids, event id). The other events were already fixed in d695d91. The browser capture across 8 scenarios shows no change except the removed Purchase relay. |
| 6 | Worldwide | The IN/AE/SG/UK/US payment e2e passes (MI cases), and the phone/country matrix passes for 161 countries. **Consent: not implemented. This is a blocker that needs a decision; see below.** |
| 7 | Store credit | value = `Order.totalPrice` (products − coupon − store credit; COD upfront not deducted). Partial and 100% store credit are covered in meta-run (MA cases). Web checkout does not accept store credit. |
| 8 | Diagnostics | Subscribe is retired (3172dc2). The newsletter sends `Lead` with no value. Manual advanced matching is sent on the first `init`. No Subscribe sender remains. |
| 9 | Reliability | PageView now fires exactly once per route change; session hydration or session changes never re-fire it, whatever the delay (the old 2.5 s window could double-count). `RemoveFromCart` is removed from the hook and the allow-list (it was unused). AddPaymentInfo fires only right before Razorpay opens. Rejected CAPI responses are logged as `[Meta CAPI Rejected] {event, event_id, code, subcode, message, fbtrace_id}` with no PII. A missing config is logged once per process in production as `[Meta CAPI][ALERT]`. |

## P2 — native apps

The audit is in `docs/meta-native-app-events.md`. Neither app has a Meta SDK, so Meta receives no app signal. The checked-in iOS `Info.plist` has no `NSUserTrackingUsageDescription`, and the Android manifest has no `AD_ID` permission. Nothing in either app was changed.

## Independent second review (fixed in the follow-up commit)

An independent reviewer (who had not written the code) found these in f122b85. All are fixed and re-verified:

| Severity | Finding | Fix |
|---|---|---|
| P1 | Right after deploy, the recovery scan would re-send Purchases that the pre-ledger code on `main` had already sent (Meta dedups for only 48 h, so this double-counts). | Recovery only covers orders placed after the first Meta ledger row ever written. To backfill a ledger outage, use the manual `?recoverSince=<ISO>` option (CRON_SECRET). **Do not use it for time before the deploy, or those Purchases will be double-counted.** |
| P1 | One exhausted row made every cron run return 503. `curl --retry-all-errors` then re-ran the job 4×, burning other rows' retries. | Exhausted rows are closed as `skipped` (lastError kept) and alerted once. A completed run always returns 200 with `ok:false` on alerts. The workflow no longer retries completed runs and fails the job through `jq`. |
| P2 | Failed rows for refunded or deleted orders could block the retry queue. | Such rows are closed on retry; this also covers crashed `sending` rows. |
| P2 | Recovery scanned only the newest 200 orders. | It now does an id-only scan of the whole window, in chunks. |
| P2 | A guest who left while payment was pending kept the identity cookies. | The reset now also runs on `pagehide` and unmount. |
| P2 | The Pixel marker could be set even if the Pixel never loaded. | The page waits up to 3 s for `fbq`; if it never loads, no marker is set. |

To resend a closed row manually: `UPDATE ad_conversion_deliveries SET status='failed', attempts=0 WHERE platform='meta' AND "eventName"='Purchase' AND "orderId"='<id>';`

## Third review: fresh full-branch reviewer (fixed)

| Severity | Finding | Fix |
|---|---|---|
| P1 | GA4 `purchase` had become tied to Meta. It was skipped if the Pixel was blocked, delayed for pending orders, and missing for app orders. | GA4 is decoupled. `ga4Purchase` fires from the same place, at the same moment and with the same inputs as on main. Meta's `trackPurchase` is called with `{ ga: false }`. |
| P2 | GA4 drift: `add_payment_info` moved to the payment step, `begin_checkout` used variant ids and units, new `add_to_cart` from wishlist / bookmark / collection, and `add_to_wishlist` used the variant id. | Each GA4 event fires at main's moment with main's inputs. The new Meta-only call sites pass `{ ga: false }`. A parity test against main's hook shows the GA4 payloads are identical. |
| P2 | The webhook now waited for the Meta Graph call. | Not awaited again, as on main. The ledger and the cron cover an interrupted send. |
| P2 | Browser `content_ids` were not de-duplicated, unlike the server's. | They are now de-duplicated. |

## Remaining blockers (need the business, not code)

1. **Consent.** There is no consent mechanism for the Pixel. UK/EEA visitors need opt-in before non-essential tracking (UK GDPR/PECR). US state privacy laws (e.g. California) expect GPC opt-outs to be honoured. Which regions and which UI is a legal and product decision, so I did not change live tracking unilaterally.
2. **Meta Test Events replay** needs your token, run locally:
   `META_CAPI_ACCESS_TOKEN=… META_TEST_EVENT_CODE=… npx tsx scripts/meta-regression/send-test-events.ts docs/meta-purchase-test-events.json`
3. **Production database:** confirm the migration is applied (`scripts/db/verify-snap-tables.sql`).
4. **Do not point a preview or staging deploy of this branch at the production DB.** Its first ledger row would move the recovery cutover earlier.
5. The **cron workflow** activates only after merge (scheduled workflows run from the default branch). `CRON_SECRET` must exist.
6. **International:** check whether the global store is enabled and for which countries. Approve the international checkout pricing change (c1d8459). The international COD fee is charged in local units.
7. **Native Meta App Events:** needs an App ID, client token, SDK and store releases (separate project).
