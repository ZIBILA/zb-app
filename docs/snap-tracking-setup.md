# Snapchat tracking: setup, health checks and international orders

How the Snap Pixel and the Snap Conversions API (CAPI) are configured on zicabella.com, how to check they work, and what the alerts mean.

## 1. Configuration

| Variable | Where | Required | What it is |
| --- | --- | --- | --- |
| `SNAP_CAPI_ACCESS_TOKEN` | DigitalOcean → App-Level Environment Variables (encrypted) | Yes | Conversions API token of the Snap Pixel. Without it no server event reaches Snapchat, Purchase included. |
| `NEXT_PUBLIC_SNAP_PIXEL_ID` | Same place, available at build time | No | The Pixel ID. When unset, a production build of the live site uses the store's pixel (`lib/snap/config.ts`) — "live site" meaning `NEXT_PUBLIC_SITE_URL` is unset or points at `zicabella.com`, `www.zicabella.com` or `app.zicabella.com`. Development and test builds, and a build whose `NEXT_PUBLIC_SITE_URL` is another host (staging), send nothing. Set it to `off` to switch Snap tracking off for a deployment. |
| `SNAP_CAPI_VALIDATE=1` | Staging only | No | Sends every event to Snapchat's `/events/validate` endpoint, which checks the payload and records nothing. Honoured only when `NEXT_PUBLIC_SITE_URL` names a host other than `zicabella.com`, `www.zicabella.com` or `app.zicabella.com`; when that variable is unset, unreadable or one of those hosts, validation mode is ignored and events are sent normally (a live store can never be silenced by it). |
| `SNAP_APP_ID_IOS`, `SNAP_APP_ID_ANDROID`, `SNAP_IOS_APP_STORE_ID`, `SNAP_ANDROID_PACKAGE`, `SNAP_APP_CAPI_ACCESS_TOKEN` | DigitalOcean | No | Native app Purchases. See `docs/snap-native-app-setup.md`. |

The retry job is called by the GitHub workflow `.github/workflows/snap-conversions.yml` with the repository secret `CRON_SECRET`. The Snap token is not needed in GitHub.

### Creating or replacing the token

1. Snapchat Ads Manager → Business Details → Conversions API Tokens (needs an Organization Admin).
2. Generate a token, copy it once.
3. DigitalOcean → the app → Settings → App-Level Environment Variables → `SNAP_CAPI_ACCESS_TOKEN`. Paste it as one line, no quotes, mark it encrypted, save. DigitalOcean redeploys the app.
4. Delete the old token in Snapchat.

Never put a token in the repository, a commit message, a pull request or a chat. A token that was once committed to this repository is recognised by its fingerprint: if it is configured again, the checks below report `snap_token_exposed`.

## 2. Checking that it works

**In the browser (admins):** sign in to the dashboard, then open `/api/snap/connection-test` on the same address, for example `https://app.zicabella.com/api/snap/connection-test`. It answers with a list of checks, each `pass`, `warn` or `fail`:

- which Pixel ID is in use
- whether the token is set, when Snapchat issued it, and that it is not the exposed one (the token itself is never shown)
- a live test of Pixel ID and token against Snapchat's validate endpoint (nothing is recorded)
- what happened to the server Purchases of the last 7 days: delivered, waiting for a retry, not paid yet, closed
- the currencies recent orders were charged in, and whether Snapchat accepts them
- whether native app events are configured

**From GitHub:** Actions → Snap Conversions Retry → Run workflow. A manual run also performs the live test and prints its result on the run page, whether the run passes or fails.

**Every 15 minutes, automatically:** the same workflow calls `/api/cron/snap-conversions`. The run fails, and GitHub notifies, when the endpoint reports an alert:

| Alert | Meaning | What to do |
| --- | --- | --- |
| `snap_config_missing` | The token (or Pixel ID) is not set on the server. | Set `SNAP_CAPI_ACCESS_TOKEN` in DigitalOcean. Purchases made meanwhile are kept and sent once it is set. |
| `snap_auth_rejected` | Snapchat refused the token (HTTP 401 or 403). | Generate a new token for this pixel and replace the variable. Unsent Purchases are kept. |
| `snap_token_exposed` | The configured token is the one that was published in the Git history. | Delete it in Snapchat and set a new one. |
| `snap_app_token_exposed` | The separate native-app token (`SNAP_APP_CAPI_ACCESS_TOKEN`) is that published token. | Delete it in Snapchat and set a new one. |
| `attempts_exhausted` | Snapchat refused some Purchases 5 times (or the server died on their last attempt), so they were closed. Reported once. Purchases that were never sent because the token was missing and are now older than 7 days are closed quietly instead (`expired_unsent` in the run result) — Snapchat never refused them. | The reason is in `ad_conversion_deliveries.lastError` and the server log. To resend one: `status='failed', attempts=0`. |
| `ledger_table_missing`, `ledger_error` | The delivery ledger cannot be read or written. | Apply migration `20261009010000_snap_delivery_and_newsletter`; check the database. |

## 3. How a Purchase reaches Snapchat

A Purchase is reported twice with one shared id, and Snapchat keeps one:

- **Browser pixel**, on the order confirmation page, once the server confirms the order is paid.
- **Conversions API**, built from the stored order (`lib/snap/purchase.ts`). It is sent by whichever of these runs first: checkout completion, either Razorpay webhook endpoint, or the retry job. A ledger row per order (`ad_conversion_deliveries`) guarantees one delivery.

`event_id` = `order_id` = `client_dedup_id` = `transaction_id` = the order id.

The retry job (`/api/cron/snap-conversions`):

1. retries failed deliveries: the next run, then after 30 minutes, 2 hours and 6 hours, with the original event time
2. keeps Purchases untouched while the token is missing or refused, so a setup problem never uses up their attempts (only HTTP 401 / 403 count as "refused"; a rejected event is an ordinary failure). For native-app events a refusal is kept to the Snap App ID it concerns, so the other app's Purchases still go out
3. re-queues Purchases that ran out of attempts while the token was missing, if they are less than 7 days old
4. finds paid orders that no path delivered, however many abandoned checkouts exist, and sends them after checking the capture with Razorpay
5. never changes an event's time; Snapchat refuses events older than 7 days, so those are closed — reported when Snapchat had refused them, quietly when they were simply never sent
6. stops starting new sends after about 36 seconds (website and app jobs together), well inside the workflow's 60-second limit; whatever is left is picked up by the next run

## 4. International orders

- **Currency and value.** A Purchase carries `Order.totalPrice` in `Order.currency`, the amount and currency Razorpay charged (USD, GBP, AED, EUR, INR and so on). Nothing is converted and no market is assumed. Browser and server use the same function (`lib/snap/currency.ts`).
- **Stored currency.** `/api/checkout/razorpay` writes the currency of the Razorpay order on every request, including when a pending order is reused after the shopper's country changed.
- **Browsing events** (view content, add to cart, start checkout, add billing) report the INR catalogue price with `INR`, the same price the product feed publishes.
- **Customer matching data** is normalized to Snapchat's rules before hashing (`lib/tracking/identity-normalize.ts`): e-mail trimmed and lower-cased; phone as digits with the country calling code; names and city lower-case without punctuation; US states as 2-letter codes; US ZIP as 5 digits; UK postcodes as area, district and sector; country as ISO 3166-1 alpha-2. Every ISO country code is accepted, not only the countries offered in the address form.
- **Phone numbers** are read with the country they were written for: a customer's number that really carries its country code, otherwise the number typed with the order's address (`lib/snap/identity.ts`, `lib/tracking/phone.ts`). The checkout and profile pages now store every number in E.164 with the selected country's code (`lib/countries.ts`): "415 555 2671" with United States is saved as `+14155552671`. Before this fix, numbers of customers outside India were saved as `+` followed by the typed digits (`+4155552671`), which is nobody's number. Such stored numbers are still matched correctly when the stored value is not a valid number as written (the digits are then read as a number of the address's country); a stored value that happens to be a valid number of another country (`+6045550199` is a real Malaysian number) is kept as written, because a number typed with its own code must never be rewritten. `scripts/fix-international-phones.ts` repairs the saved addresses and customer records — dry run by default, `--apply` to write; the valid-as-written cases are listed for review instead of being changed.
- **event_source_url** is the confirmation page on the storefront host the shopper used. Only the store's own hosts are accepted.
- **Identity cookies** (hashed e-mail, phone, name, address) are sent only for the visitor they were written for.

## 5. Tests

All suites run offline against an in-memory database and fake Snapchat, Razorpay and Shopify endpoints.

```bash
npx tsx scripts/verify-snap-tracking.ts
npx tsx --tsconfig scripts/snap-test-support/tsconfig.json scripts/verify-snap-webhook.ts
npx tsx scripts/verify-snap-app.ts

export ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PORT=1
export NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs"
npx tsx --tsconfig scripts/snap-e2e/tsconfig.json scripts/verify-snap-delivery.ts        # token, retries, recovery, alerts
npx tsx --tsconfig scripts/snap-e2e/tsconfig.json scripts/verify-snap-international.ts   # currency, normalization, URLs
npx tsx --tsconfig scripts/snap-e2e/tsconfig.json scripts/verify-snap-confirmation.tsx   # confirmation page in jsdom
```

Repairing phone numbers stored before the fix (section 4), against the real database:

```bash
npx tsx scripts/fix-international-phones.ts            # dry run: lists what would change
npx tsx scripts/fix-international-phones.ts --apply    # writes the unambiguous repairs
```
