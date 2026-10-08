# Snap MOBILE_APP Purchase — iOS & Android setup

Branch: `feat/snap-native-app-capi` (stacked on `fix/snap-tracking-hardening`).

App purchases are sent **server-side** as `action_source: MOBILE_APP` to
`https://tr.snapchat.com/v3/{SNAP_APP_ID}/events`. They never go through the
website pixel. Until everything below is in place the server simply sends
nothing for app orders (no fallback, no misreporting).

## Flow

| Step | Where | What happens |
|---|---|---|
| 1 | App → `POST /api/app/payment/create-order` | App sends `snapDevice` (platform, app/OS version, model, locale, timezone, screen, ATT status, IDFV, IDFA/AAID when permitted). Server stores it in the delivery ledger (`snap_app`) with the order's pending id. Pending `OrderItem.variantId` is saved here too. |
| 2 | App → `POST /api/app/payment/verify` | If Razorpay reports the payment **captured**, the server sends the MOBILE_APP Purchase once. `authorized` / HEADLESS verifications do not send. |
| 3 | Razorpay `payment.captured` / `order.paid` webhook | Sends it if step 2 didn't (app crashed / closed). `payment.authorized` never sends. |
| – | Ledger | One row per order: concurrent verify + webhook calls produce exactly one Snap event; retries reuse the same `event_id` and `event_time`. |

## Server configuration (env)

| Variable | Value | Where to find it |
|---|---|---|
| `SNAP_APP_ID_IOS` | Snap App ID of the iOS app | Snap Ads Manager → Events Manager → your iOS app |
| `SNAP_APP_ID_ANDROID` | Snap App ID of the Android app | Snap Ads Manager → Events Manager → your Android app (use the same value if Snap shows one ID for both) |
| `SNAP_IOS_APP_STORE_ID` | numeric Apple id, e.g. `6740012345` | App Store Connect → App Information → Apple ID (or the `id…` in the App Store URL) |
| `SNAP_ANDROID_PACKAGE` | `com.zicabella.app` (default) | Play Console / `ZicaBella-android/app.json` |
| `SNAP_APP_CAPI_ACCESS_TOKEN` | optional | Only if Snap issues a separate token for the app; otherwise `SNAP_CAPI_ACCESS_TOKEN` is used |

Check them with `npx tsx scripts/snap-validate-staging.ts` — it validates the
iOS and Android app payloads against each configured Snap App ID.

## App changes (both `ZicaBella` and `ZicaBella-android`)

- `src/services/snapDeviceContext.ts` — collects the device context. IDFA only
  when ATT is authorized; AAID only when the OS returns one (user hasn't limited
  ad tracking); the all-zero IDFA is never sent; nothing is invented.
- `src/hooks/useRazorpay.ts`, `src/screens/checkout/OrderReviewScreen.tsx` — attach
  `snapDevice` to create-order / verify.
- `App.tsx` — after the existing in-app consent screen completes, iOS shows the
  App Tracking Transparency prompt once (`requestTrackingConsentOnce`).
- `app.json` — `expo-tracking-transparency` plugin: adds
  `NSUserTrackingUsageDescription` (iOS) and the `AD_ID` permission (Android).
  **Review the prompt text** before release.
- `package.json` / lockfile — `expo-application ~55.0.10`, `expo-tracking-transparency ~55.0.18`
  (SDK 55 versions; lockfile updated).

These are native modules → a **new EAS build and store release** is required for
both apps. Old app builds keep working; they just don't send `snapDevice`, so
their purchases are not reported to Snap (by design).

## Store compliance before release

- **App Store Connect → App Privacy:** declare *Identifiers → Device ID* (IDFA) used
  for *Third-Party Advertising* and linked tracking, plus *Purchases*.
- **Google Play Console → App content → Advertising ID:** declare that the app uses
  the Advertising ID (advertising / analytics). Update the **Data safety** form
  (Device or other IDs; Purchase history).

## Rollout order

1. Apply the DB migration (docs/snap-db-migration-runbook.md).
2. Set the env vars on **staging**, run `scripts/snap-validate-staging.ts`.
3. Merge server changes; set env vars in production.
4. Ship the app builds. Purchases from the new builds start appearing in Snap as app events.
