# Meta App Events — native apps (iOS / Android) readiness audit

Status: **audit only. Nothing in `ZicaBella/` or `ZicaBella-android/` was changed.**
Branch audited: `fix/meta-tracking-audit` (2026-10-09). This work is **separate from
the website Meta release**; the website Pixel/CAPI pipeline stays website-only.

Apps: `ZicaBella/` (iOS, `com.zicabella.ios`, App Store id `6769545889` per `ZicaBella/eas.json:27`)
and `ZicaBella-android/` (`com.zicabella.app`). Both are Expo SDK 55 / RN 0.83 with
**identical `src/`** except `src/hooks/useRazorpay.ts` and
`src/screens/checkout/RazorpayPaymentScreen.tsx` (Android also reads the DB order id from `/verify`).
Line numbers below are for `ZicaBella/` unless stated; the Android copy matches.

---

## 1. Current state (evidence)

| Area | Finding | Evidence |
|---|---|---|
| Meta / Facebook SDK | **Not installed** in either app. No `react-native-fbsdk-next`, no Expo FB plugin. | `ZicaBella/package.json` deps (lines 11-64), `ZicaBella-android/package.json` (same set minus `expo-apple-authentication`) |
| FacebookAppID / ClientToken | **Absent** from `app.json`, `app.config.js`, `ios/ZICABELLA/Info.plist`, `android/.../AndroidManifest.xml`, `res/values/strings.xml`. The only `com.facebook.*` hits are React Native / Fresco build plumbing. | `ZicaBella-android/android/app/build.gradle:3,189,202-215`; `strings.xml` has only `app_name` |
| Backend `META_APP_ID` | Exists as a server env name (used by `/api/meta/connection-test`). Whether it is the app that would be registered for the mobile apps is **unverified**. | `.env.example:136-138`, `app/api/meta/connection-test/route.ts:27` |
| WebView | `react-native-webview@13.16.0` is a dependency, but **no source file imports `WebView`**. External links use `Linking.openURL` (system browser). Payment is the native Razorpay Custom UI SDK (`react-native-customui`). ⇒ the website Pixel **cannot** fire inside the app. | `package.json:61`; `grep WebView src App.tsx` → 0 hits; `src/components/StorefrontFooter.tsx:40`, `src/hooks/useRazorpay.ts:14-20` |
| Any client analytics | No event-logging calls (`logEvent`, `fbq`, `AppEventsLogger`, `/api/meta`) in app `src/`. | grep → 0 hits |
| Snap native tracking | Present: device context collector + server MOBILE_APP CAPI with its own ledger key `snap_app`. | `src/services/snapDeviceContext.ts`, `lib/snap/app-purchase.ts:23-24`, `lib/snap/app-capi.ts` |
| Website Meta Purchase | Excludes app orders: `isWebsiteOrder` accepts only `WEB_STORE` / empty; `emitMetaPurchase` skips others. ⇒ **Meta receives no Purchase for app orders today.** | `lib/meta/order-value.ts:24-29`, `lib/meta/purchase.ts:299-300` |

### Where the funnel moments happen in the app

| Moment | Location |
|---|---|
| App open / activation | `App.tsx:31-117` (`App`); AppState listener `App.tsx:89-97`; consent + ATT `App.tsx:112` |
| Product view (ViewContent) | `src/screens/ProductDetailScreen.tsx:154-163` (`useProductByHandle(handle)`) |
| Add to cart | PDP `handleAddToCart` `ProductDetailScreen.tsx:340-373` (calls `addItem` at :360); Quick add `src/components/QuickAddModal.tsx:162`; store `src/store/cartStore.ts:114` |
| Begin checkout | Cart drawer `src/navigation/RootNavigator.tsx:223-227`; Cart screen `src/screens/CartScreen.tsx:47-56`; Buy Now `ProductDetailScreen.tsx:375-407` → `CheckoutFlow` (`DeliveryAddress` → `OrderReview` → `RazorpayPayment`, `src/navigation/CheckoutNavigator.tsx:15-17`) |
| Order value computed | `src/screens/checkout/OrderReviewScreen.tsx:51-67` (`orderTotal`, `creditToApply`, `netOrderTotal`, `codFee`, `grandTotal`); payload `buildOrderData` :141-185 (`total: netOrderTotal` :174) |
| Prepaid (Razorpay) start | `OrderReviewScreen.tsx:332-376` → `POST /api/app/payment/create-order` (with `snapDevice` :348) |
| COD (upfront fee via Razorpay) start | `OrderReviewScreen.tsx:275-330` → same endpoint, `amount = codFee` (:289) |
| Payment captured (client) | `src/hooks/useRazorpay.ts:513-583` (`/api/app/payment/verify`, waits for `paymentState === 'captured'`, then `status='success'`) |
| Purchase success (prepaid / COD) | `src/screens/checkout/RazorpayPaymentScreen.tsx:117-125` → `recordOrderOnBackend` :139-196 → `POST /api/app/orders/create`; DB order id from response :182 (Android also from verify: `ZicaBella-android/src/screens/checkout/RazorpayPaymentScreen.tsx:194-202`) |
| Purchase success (100% store credit) | `OrderReviewScreen.tsx:225-273` → `POST /api/app/orders/create` with `paymentMethod:'Store Credit'`, `paymentStatus:'paid'`, idempotent `checkoutId` (:241); DB order id `json.orderId` (:259) |
| Partial store credit | Same prepaid/COD paths; `appliedStoreCredits` in payload (:155), deducted in `netOrderTotal` (:57-58) |

### What the backend stores (app orders)

| Route | Stored | Evidence |
|---|---|---|
| `app/api/app/payment/create-order/route.ts` | Pending `Order` with `orderType:'MOBILE_APP'`, `currency:'INR'`, `paymentStatus:'pending'`, `totalPrice = orderTotalRupees` (prepaid: charged amount = net total; COD: `orderData.total` = net total, COD fee in `codUpfrontPaid`), plus `MobileOrder`. Stores `snapDevice` in the ledger. | :82-89, :161-177, :212-221, :250-252 |
| `app/api/app/payment/verify/route.ts` | Marks order paid / `cod_upfront_paid` on capture; emits Snap app Purchase; returns `orderId`, `orderNumber`. | :279-283, :351-352 |
| `app/api/app/orders/create/route.ts` | Updates the pre-created order (found by `razorpayOrderId`, :133-140) or creates one with `orderType:'MOBILE_APP'`, `totalPrice: total` (client `netOrderTotal`), `currency:'INR'`. Server-side payment status wins; client "paid" only accepted after Razorpay capture check (:182-215). COD → `cod_upfront_paid` (:70-76). 100% store credit → Snap emit (:826-835). | :63-80, :588-599 |
| `app/api/webhooks/razorpay/route.ts` | Safety net on `payment.captured` / `order.paid`: calls web `emitMetaPurchase` (skips app orders) and `emitSnapAppPurchase`. | :258-279 |

Value semantics already used by Snap app (and Meta web): `value = Order.totalPrice` = products − coupon − store credit; COD upfront not deducted; 100% credit → 0. `lib/meta/order-value.ts:6-16`, `lib/snap/purchase.ts:86-96`. Allowed paid statuses: `paid`, `cod_upfront_paid` (`lib/snap/purchase.ts:31`); app order types `MOBILE`, `MOBILE_APP`, `APP` (:33).

### Privacy / consent

| Item | Finding | Evidence |
|---|---|---|
| iOS ATT module | `expo-tracking-transparency ~55.0.18` installed; config plugin with `userTrackingPermission` text in both `app.json`. | `ZicaBella/package.json:46`, `ZicaBella/app.json:58-63`, `ZicaBella-android/app.json:40-45` |
| ATT prompt | Shown once after the in-app consent modal (`requestTrackingConsentOnce`). | `App.tsx:112`, `src/services/snapDeviceContext.ts:114-125` |
| `NSUserTrackingUsageDescription` in committed `ios/` | **Missing** from `ZicaBella/ios/ZICABELLA/Info.plist` (only Camera/FaceID/Mic/Motion/Photos keys, :75-86). The plist also shows version 1.0.0 / build 7.5 vs `app.json` 1.0.1 / 8. | Info.plist lines 23-24, 41-42, 75-86 |
| `AD_ID` permission in committed `android/` | **Missing** from `AndroidManifest.xml:2-12`. | — |
| Why it matters | `ios/` and `android/` are committed (not gitignored, `.gitignore:54-55` commented out). If EAS builds from these folders without `expo prebuild`, config plugins (ATT text, AD_ID) are **not applied**. Calling the ATT request without `NSUserTrackingUsageDescription` crashes on iOS. **Unverified** which way the release builds are produced — confirm before any Meta work (also affects Snap). `docs/snap-native-app-setup.md:41-42` assumes the plugin adds both. | — |
| iOS privacy manifest | `PrivacyInfo.xcprivacy` declares `NSPrivacyTracking = false`, no tracking domains, all data types `Tracking=false`. Must be updated if IDFA / Meta tracking is used. | `ZicaBella/ios/ZICABELLA/PrivacyInfo.xcprivacy:54-97` |
| In-app consent UI | Notice-only modal ("basic usage analytics and crash reports"), single "I UNDERSTAND" button, no opt-out, no mention of advertising/Meta. Stored as `@zicabella_consent`. | `src/components/ConsentModal.tsx:21-40, 53-61` |

### How Snap passes device context (pattern to reuse)

1. App: `getSnapDeviceContext()` (`snapDeviceContext.ts:66-108`) — platform, app id/version/build, OS, model, locale, timezone, screen, `attStatus`, `idfv`; `madid` = IDFA only if ATT authorized (:90-95), AAID if OS returns it (:96-100); zero UUID never sent.
2. Sent in the body as `snapDevice` to `create-order` (`useRazorpay.ts:338`, `OrderReviewScreen.tsx:293,348`), `verify` (`useRazorpay.ts:528`) and, for 100% credit, `orders/create` (`OrderReviewScreen.tsx:244`). **Not** sent by `RazorpayPaymentScreen.recordOrderOnBackend` (:150-159) — fine because create-order already stored it.
3. Server: validated by `parseSnapDeviceContext` (`lib/snap/app-capi.ts:63-84`), stored with IP/UA (from request headers, `lib/snap/app-purchase-server.ts:18-27`) in `AdConversionDelivery.context` under `platform='snap_app'` (`lib/snap/app-purchase.ts:105-109`).
4. Sent once after capture from verify / webhook / orders/create (100% credit), `eventId = order.id` (`app-purchase.ts:72`), value from DB. Snap maps `attStatus` → `advertiser_tracking_enabled` and builds `extinfo` (`app-capi.ts:103-163`).

A Meta app CAPI can reuse the same payload and the same ledger row pattern with its own platform key.

---

## 2. Gap per event

| Event | Today | Gap |
|---|---|---|
| Activation (`fb_mobile_activate_app`) | Nothing sent | Needs Meta SDK (auto-logs app activation / install) — cannot be done server-side reliably. |
| ViewContent | Nothing | SDK event in `ProductDetailScreen` once `product` loads (content_ids = Shopify variant/product id matching the Meta catalog — **catalog id format for Meta unverified**; web Purchase uses `snapCatalogIdFromOrderItem`, `lib/meta/purchase.ts:25,162`). |
| AddToCart | Nothing | SDK event at `ProductDetailScreen.tsx:360` and `QuickAddModal.tsx:162` (or centrally in `cartStore.addItem`, after `acceptAdd` dedup :116). |
| InitiateCheckout | Nothing | SDK event on `CheckoutFlow` entry (3 call sites above) or on `OrderReview` mount. |
| Purchase | **Nothing** (web pipeline excludes app orders by design) | Server app-CAPI Purchase from the DB order (authoritative, covers app crash via webhook), optional SDK Purchase for dedup. |

---

## 3. Purchase value rules (app)

Use the stored order, never client numbers: `value = Order.totalPrice`, `currency = Order.currency` (`INR`), i.e. reuse `metaPurchaseValue` / `metaPurchaseCurrency` (`lib/meta/order-value.ts:13-21`).

| Case | value | Send when |
|---|---|---|
| Prepaid (Razorpay) | net total = products − coupon − store credit | payment **captured** (`paid`) |
| COD | full net order total; the COD upfront fee is **not** deducted (it is part of the same sale) | upfront captured (`cod_upfront_paid`) |
| Partial store credit | net total after credit | captured |
| 100% store credit | **0** (still a real Purchase) | `orders/create` committed with `paymentStatus='paid'` |
| Authorized-not-captured, failed, cancelled | not sent | — |

Do not use the app's display currency (`src/store/currencyStore.ts` converts for display only; orders are stored in INR).

---

## 4. Recommended implementation

**Client (both apps, new store builds):**
- Add `react-native-fbsdk-next` with its Expo config plugin (`appID`, `clientToken`, `displayName`, `isAutoInitEnabled`, `autoLogAppEventsEnabled`, `advertiserIDCollectionEnabled`) — or set the equivalent native keys if builds use the committed `ios/`/`android/` folders.
- Initialise only after the consent modal; on iOS call `Settings.setAdvertiserTrackingEnabled(attStatus === 'authorized')` after the ATT prompt (`requestTrackingConsentOnce`).
- Log `fb_mobile_content_view`, `fb_mobile_add_to_cart`, `fb_mobile_initiated_checkout` at the locations in §1.
- Extend the existing device context (or add a sibling `metaDevice`) with the SDK's `anon_id` (`AppEventsLogger.getAnonymousID()`), sent on the same requests as `snapDevice`.

**Server (authoritative Purchase):**
- New module e.g. `lib/meta/app-purchase.ts`, mirroring `lib/snap/app-purchase.ts`: same ledger, **separate key** `platform: 'meta_app'` (or `eventName: 'AppPurchase'` under `meta`) so it can never collide with or be counted as the website `meta`/`Purchase` row.
- Payload: `action_source: 'app'`, `event_name: 'Purchase'`, `event_id = Order.id`, `app_data: { advertiser_tracking_enabled, application_tracking_enabled, extinfo }`, `user_data: { madid, anon_id, client_ip_address, client_user_agent, hashed em/ph/fn/ln/ct/st/zp/country, external_id }`, `custom_data: { value, currency, content_ids, contents, order_id }`. Exact field requirements and the endpoint/dataset for app events must be **checked against current Meta docs** (not verified in this audit).
- Hook calls next to every `emitSnapAppPurchase` call: `verify/route.ts:279`, `webhooks/razorpay/route.ts:276`, `orders/create/route.ts:829-835`; add to the retry cron like `retryPendingSnapAppPurchases`.
- Gate on `NATIVE_APP_ORDER_TYPES` + paid statuses. Never route app orders through `emitMetaPurchase` / `isWebsiteOrder`, never through the website Pixel.
- Dedup: if the SDK also logs Purchase, use the DB order id as its event id (iOS gets it from `orders/create` response `RazorpayPaymentScreen.tsx:182` / `OrderReviewScreen.tsx:259`; Android also from verify). Whether the RN SDK can set an event id that Meta dedups against server app events is **unverified** — if not, send Purchase **server-only** and do not log it in the SDK.

---

## 5. Privacy / consent requirements

- **iOS ATT:** `NSUserTrackingUsageDescription` must be in the shipped Info.plist (currently missing from committed `ios/`). Send IDFA only when authorized; `advertiser_tracking_enabled = 1` only when authorized.
- **Android:** `com.google.android.gms.permission.AD_ID` must be in the shipped manifest (currently missing from committed `android/`); send AAID only when the OS returns it.
- **Privacy manifest:** update `PrivacyInfo.xcprivacy` (`NSPrivacyTracking`, tracking domains, collected data types) and the Meta SDK's own privacy manifest requirements.
- **Store forms:** App Store App Privacy (Device ID / Purchases, third-party advertising, tracking) and Play Data safety + Advertising ID declaration (see `docs/snap-native-app-setup.md:51-57`).
- **Consent text:** `ConsentModal` should mention advertising measurement with Meta; consider a real opt-out that disables SDK logging and server app events for that user.
- **Meta:** accept Meta's app data use / business terms; configure Limited Data Use if required for the target markets (not assessed).

---

## 6. Needed from the business

1. Meta App ID for the mobile apps (or confirmation that the existing `META_APP_ID` app should be used) and its **Client Token**.
2. iOS and Android platforms added to that Meta app (bundle id `com.zicabella.ios`, App Store id `6769545889`; package `com.zicabella.app`, key hashes), and the app connected to the ad account / dataset in Events Manager.
3. A CAPI access token with permission to send app events for that app/dataset.
4. Decision on SDK-side Purchase vs server-only Purchase.
5. Updated consent copy approval, store privacy declarations, and Meta terms acceptance.
6. New EAS builds and App Store / Play releases (native module + plist/manifest changes); old builds will send nothing.
7. Test plan: Events Manager **Test Events** / App Events Helper on a device, prepaid + COD + partial credit + 100% credit.

---

## 7. Scope statement

- This is **separate from the website Meta release**. The website pipeline (`lib/meta/purchase.ts`, `isWebsiteOrder`) correctly keeps excluding app orders and must stay that way.
- **No files in either app or the backend were changed** by this audit; only this document was added.
- Items marked *unverified* (build method for native folders, Meta catalog id format, SDK event-id dedup, exact app-CAPI field requirements, existing `META_APP_ID` ownership) must be confirmed before implementation.
