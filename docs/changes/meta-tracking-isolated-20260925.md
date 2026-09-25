# Meta tracking with existing checkout behavior preserved

Base: `bbbbdcd1fc94430dd38e5914c5da773055f950a5`. This revision supersedes the unpublished purchase-integrity draft. The user authorized deployment, while requiring the existing checkout and other business behavior to be preserved. No production deployment or database migration has occurred.

## Scope

Checkout initiation and completion keep their existing credentials, prefetch/reuse, payment checks, pricing, shipping, COD, wallet debit, order creation and fulfillment decisions. The checkout page and shared IP-geolocation module are byte-identical to the base. The original statements in both checkout routes, both Razorpay webhooks and middleware match the base after removing the explicitly added Meta observers and the new worker route exemption.

The observers only save advertising context or signature-verified capture evidence. They catch storage errors and limit the added wait to one second. A storage operation can finish later, but it only writes the advertising table. No Meta HTTP request or new gateway verification runs in the checkout/webhook request. Their existing responses and financial state transitions are preserved.

Other analytics retain their original confirmation-session marker, currency argument, GA4 payload mapping/duplicate guard and first-party page-view call. Meta browser Purchase delivery has its own queue marker.

## Tracking changes

- Save a best-effort checkout snapshot and hashed matching data in a new `MetaPurchase` table, with a token-bound browser endpoint. An unverified pending checkout attempt may be replaced when the existing payment flow reuses it; once capture proof exists, the snapshot and event evidence are immutable. A failed or missing snapshot is excluded from advertising; payment continues as before.
- Accept capture evidence only from an existing signature-verified webhook or a worker's read-only Razorpay payment lookup. Reject authorization-only, wrong amount/currency, refunds and mismatched orders for Meta purposes.
- Preserve captured proof in the outbox. The authenticated worker confirms full-wallet debits, repairs missed gateway observations, obtains delivery leases and retries rejected Meta requests. It never captures a payment or changes an order.
- Use the same event ID, currency, products and full order value for browser and server Purchase. Store credit is tender. COD reports the accepted order value, not its deposit; it is not delivered cash revenue.
- Match the browser's complete Pixel-ID fallback chain, including `NEXT_PUBLIC_FACEBOOK_PIXEL_ID`. Reject CAPI submission when the effective browser and server Pixel IDs differ. Reject missing/blank Purchase IDs before browser queueing or server submission. A test passes a verified purchase through the actual browser endpoint, pixel helper, outbox and CAPI transport and compares the outgoing IDs, event names, values and destination.
- Do not advertise cancelled, failed, refunded, manual-review or placeholder orders. A captured snapshot must still match the current order and gateway ID. Existing checkout reuse and pricing behavior are deliberately preserved; a new unpaid retry refreshes only its pending advertising attempt, while captured or ambiguous attempts remain suppressed.
- Reject arbitrary browser-supplied Purchase events at the public Meta endpoint. Legacy orders without a new snapshot are not replayed. Existing in-flight checkouts may therefore have no new Purchase event after rollout; a later unpaid retry can create a fresh snapshot for its new gateway attempt.
- Remove stale-cart value/ratio fallbacks for Meta, avoid repeated pixel initialization and session-only duplicate Meta page views, require positive CAPI acceptance, and stop the website event bridge from republishing website conversions as WhatsApp events.
- Use current request headers for Meta visitor IP and omit unknown/private IPs. The Meta API no longer runs a server-IP/location fallback; shared site geolocation behavior is unchanged.

Retries and browser duplicates stop 47 hours after verified capture. A historical Purchase is not automatically subtracted after a later refund/cancellation. Cookie/ad blocking and lost best-effort context can reduce coverage; these cases must not fabricate conversions or block checkout.

## Local validation

- `npm run test:meta`: **53 passed, 0 failed**, including the deduplication and reused-unpaid-checkout regression tests. Tests execute actual TypeScript modules with isolated DB, gateway, HTTP and browser boundaries. They cover observer failures/timeouts, unchanged checkout reuse and responses, signed/unsigned webhooks, captured versus authorized payments, stale bindings, lost-browser delivery, worker recovery/concurrency, retries, value/currency, private IPs, Pixel-ID configuration and the full browser/server deduplication path.
- TypeScript passed again after the deduplication review. Prisma generation and schema validation passed for the unchanged schema. The full application build at prior revision `78d08f6` completed compilation and type checking, then stopped at page-data collection because `NEXTAUTH_SECRET`, `DATABASE_URL` and `SHOPIFY_ADMIN_ACCESS_TOKEN` are unavailable here. Existing affiliate Edge-crypto and CSS warnings remain. No fake production credentials are supplied.
- A one-off TypeScript AST comparison confirmed that the original business statements are unchanged in the four payment routes and middleware after removing the isolated additions. This is not a substitute for staging payment tests.
- No production gateway transaction, Meta event, schema change, campaign change or deployment is used for testing.

## Deployment gates

1. Confirm the actual DigitalOcean App Platform app, deployment branch, configuration and rollback target. The connected DigitalOcean integration exposes droplet operations only, and its App Platform dashboard currently returns `Site Unavailable` in this session. The repository's last Vercel commit status is failed; it does not establish the live DigitalOcean target.
2. Apply only the additive `20260925180000_meta_purchase_outbox` migration through the established, baselined migration process; generate Prisma Client. Do not blindly apply historical migrations. Keep the outbox table through any rollback.
3. Schedule an authenticated POST to `/api/cron/meta-purchases` every minute with `Authorization: Bearer $CRON_SECRET`. Each run checks up to eight awaiting snapshots and dispatches twelve queued events with four bounded requests at a time. Check backlog before increasing traffic. No scheduler was created in production.
4. In staging, use Razorpay test keys and a separate Meta test dataset/test-event code. Supply matching server/browser pixel IDs and the CAPI token through the existing secret manager. Confirm the actual trusted proxy header before setting `TRUSTED_CLIENT_IP_HEADER`.
5. Exercise prepaid, COD, mixed/full wallet and reused checkout attempts. Include a failed/slow advertising-table write, close the browser after payment, replay a signed webhook and fail Meta once. Existing checkout outcomes must remain the same; only matching verified attempts may reach Meta. Confirm browser/server event IDs and amounts in Meta Test Events.
6. Complete the repository's mandatory approving PR review, then deploy schema/code/worker together through the existing host and verify live health and the first real verified orders. User deployment authorization already exists; the GitHub review rule still applies. Do not change campaigns/budgets as part of this release.

Safe aggregate monitoring (no customer identifiers):

```sql
SELECT "status", count(*) AS events,
       min("capturedAt") AS oldest_capture,
       max("attempts") AS max_attempts
FROM "MetaPurchase"
GROUP BY "status";
```

Investigate missing snapshots, `delivery_failed`, `order_not_ready`, stale awaiting attempts and `ineligible_or_expired`. Never create a new event ID/time merely to retry an expired conversion. Apply the business's existing retention policy to advertising identifiers and do not log them.
