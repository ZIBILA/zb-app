# Razorpay Integration — Testing & Debugging Guide

> Zica Bella Monorepo · Last updated: 2026-05-10

---

## 1. Test Credentials

| Item | Value |
|------|-------|
| **Test Key ID** | `rzp_test_xxxxxxxxxxxx` (from Razorpay Dashboard → Settings → API Keys) |
| **Test Key Secret** | Displayed once on creation — store securely |
| **Test UPI (Success)** | `success@razorpay` |
| **Test UPI (Failure)** | `failure@razorpay` |
| **Test Card (Visa Success)** | `4111 1111 1111 1111`, Expiry: any future date, CVV: any 3 digits |
| **Test Card (Decline)** | `4000 0000 0000 0002` |
| **Test Netbanking** | Any bank in test mode — always succeeds |
| **Test Wallet** | All wallets succeed in test mode |

> **Important**: Never use `rzp_live_` keys for testing. Always use `rzp_test_` keys in development.

---

## 2. Common Errors & Fixes

### 2.1 "Order creation failed"
- **Cause**: Missing or incorrect `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`
- **Fix**: Check `.env.local` and Dashboard → Settings. Ensure keys start with `rzp_test_` or `rzp_live_`

### 2.2 "Signature verification failed"
- **Cause**: Wrong body format (`order_id|payment_id`) or using the wrong secret key
- **Fix**: Ensure the `key_secret` used for HMAC matches the one that created the order. The body must be exactly `razorpay_order_id + "|" + razorpay_payment_id`

### 2.3 "Payment method not allowed"
- **Cause**: Razorpay account not activated for that payment method
- **Fix**: Go to Razorpay Dashboard → Settings → Payment Methods and enable the required method

### 2.4 "CORS error in React Native"
- **Cause**: Native apps don't typically send an `Origin` header. Backend must not block requests without one
- **Fix**: `Access-Control-Allow-Origin: *` is set on `/api/razorpay/*` and `/api/app/payment/*` routes in `next.config.mjs`

### 2.5 "RazorpayCheckout is not a function"
- **Cause**: `react-native-razorpay` not properly linked
- **Fix**:
  - **iOS**: `cd ios && pod install && cd ..`
  - **Android**: Clean build: `cd android && ./gradlew clean && cd ..`
  - Rebuild: `npx expo run:ios` / `npx expo run:android`

### 2.6 "Invalid UPI"
- **Cause**: UPI regex validation too strict or too loose
- **Fix**: Current regex: `/^[\w.-]+@[\w.-]+$/`. This accepts `name@upi`, `name@ybl`, `9876543210@paytm`

### 2.7 "Webhook not received"
- **Cause**: Webhook URL must be HTTPS. Check Razorpay Dashboard → Webhooks for active status
- **Fix**:
  1. URL must be `https://zicabella.com/api/webhooks/razorpay` (alias: `/api/razorpay/webhook`)
  2. Status must be "Active"
  3. Events must be checked: `payment.captured`, `order.paid`, `payment.authorized`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`

### 2.8 "Payment captured but order not marked paid"
- **Cause**: Webhook handler DB write failing silently
- **Fix**: Check server logs for `[Payment:webhook]` entries. Ensure `WebhookEvent` table exists. Run `npx prisma db push` if needed

---

## 3. Step-by-Step Test Scenarios

### 3.1 Happy Path: UPI Success
1. Add item to cart → Checkout → Delivery Address → Review & Pay
2. Select "Pay Now" (Razorpay) → tap "Place Order"
3. On payment screen, select UPI tab
4. Enter `success@razorpay` as UPI ID
5. Tap "PAY ₹X,XXX"
6. Razorpay SDK opens → approve the mock payment
7. **Expected**: Redirect to "Payment Successful" → "View Order" CTA works

### 3.2 Happy Path: Card Success
1. Same flow as above, select Card tab
2. Enter: `4111 1111 1111 1111`, Expiry: `12/29`, CVV: `123`, Name: `Test User`
3. **Expected**: OTP screen in Razorpay → enter any OTP → success

### 3.3 Failure Path: Card Decline → Retry
1. Select Card tab, enter `4000 0000 0000 0002`
2. **Expected**: Failure screen with error message
3. Tap "Retry Payment" → returns to payment form
4. Re-enter valid card → success

### 3.4 Partial Failure: Order Created but Payment Abandoned
1. Start payment flow, create order on backend
2. Close the Razorpay SDK (tap back / cancel)
3. **Expected**: Returns to payment form (status === 'idle'), no crash
4. The Razorpay order remains in `created` state on Dashboard — this is normal

### 3.5 Webhook Delivery Test
1. Go to Razorpay Dashboard → Webhooks
2. Click "Test Webhook" on your webhook URL
3. Select `payment.captured` event
4. **Expected**: Server logs show `[Payment:webhook] Received: payment.captured`
5. Check `WebhookEvent` table for the logged event

---

## 4. Android-Specific Fixes

### 4.1 Internet Permission
Ensure `AndroidManifest.xml` has:
```xml
<uses-permission android:name="android.permission.INTERNET" />
```

### 4.2 ProGuard Rules
Add to `android/app/proguard-rules.pro`:
```
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-dontwarn com.razorpay.**
-keep class com.razorpay.** {*;}
-optimizations !method/inlining/*
-keepclasseswithmembers class * {
  public void onPayment*(...);
}
```

### 4.3 Minimum SDK Version
Razorpay requires `minSdkVersion >= 19`. Check `android/app/build.gradle`:
```gradle
defaultConfig {
    minSdkVersion 21 // or higher
}
```

---

## 5. iOS-Specific Fixes

### 5.1 App Transport Security (Test Mode)
For test mode with HTTP URLs, add to `Info.plist`:
```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
</dict>
```
> **Remove this for production builds** — use HTTPS only.

### 5.2 Face ID / Touch ID
Razorpay may trigger biometric prompts. Add to `Info.plist`:
```xml
<key>NSFaceIDUsageDescription</key>
<string>For secure payment authentication</string>
```

### 5.3 CocoaPods Compatibility
If pod install fails:
```bash
cd ios
pod deintegrate
pod install --repo-update
cd ..
```

Minimum iOS deployment target: **13.0**

### 5.4 Rebuild After Changes
```bash
npx expo run:ios --device
# or
npx expo prebuild --clean && npx expo run:ios
```

---

## 6. Environment Variable Checklist

| Variable | Where | Required |
|----------|-------|----------|
| `RAZORPAY_KEY_ID` | Backend `.env.local` | ✅ |
| `RAZORPAY_KEY_SECRET` | Backend `.env.local` | ✅ |
| `RAZORPAY_WEBHOOK_SECRET` | Backend `.env.local` | ✅ (for webhooks) |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Backend `.env.local` | Optional (admin UI) |
| `EXPO_PUBLIC_RAZORPAY_KEY_ID` | Mobile `.env` | ✅ |
| `EXPO_PUBLIC_APP_URL` | Mobile `.env` | ✅ |

---

## 7. Architecture Quick Reference

```
Mobile App                    Next.js Backend              Razorpay
─────────                     ───────────────              ────────
OrderReview
  └→ POST /api/app/payment/create-order ──→ razorpay.orders.create()
      ←── { order_id, key_id }

RazorpayPaymentScreen
  └→ RazorpayCheckout.open(options) ─────────────────────→ Payment UI
      ←── { razorpay_order_id, razorpay_payment_id, razorpay_signature }

  └→ POST /api/app/payment/verify
      └→ HMAC SHA256 verification
      └→ DB: Order → PAID

                              POST /api/webhooks/razorpay ←── Webhook events (alias /api/razorpay/webhook)
                                └→ Idempotency check
                                └→ DB update
                                └→ 200 OK
```
