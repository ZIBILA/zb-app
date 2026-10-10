/**
 * Validate every web Snap CAPI event shape against Snap's VALIDATION endpoint.
 *
 *   SNAP_CAPI_ACCESS_TOKEN=... NEXT_PUBLIC_SNAP_PIXEL_ID=... \
 *     npx tsx scripts/snap-validate-staging.ts
 *
 * - Posts ONLY to https://tr.snapchat.com/v3/{pixel}/events/validate, which checks
 *   the payload and does NOT record a conversion. Safe to run from anywhere.
 * - Payloads are produced by the same builder production uses
 *   (lib/snap-capi.ts → buildSnapCapiEvent; PURCHASE via lib/snap/purchase.ts).
 * - Exit code 1 if any event is not reported VALID.
 *
 * For an end-to-end staging check of the live routes, deploy the branch to
 * staging with SNAP_CAPI_VALIDATE=1 (ignored automatically on zicabella.com),
 * click through the storefront and read the "[Snap CAPI VALIDATE]" log lines.
 */
import { buildSnapCapiEvent, type SnapCapiEventPayload } from '../lib/snap-capi';
import { buildPurchaseFromOrder } from '../lib/snap/purchase';
import { buildSnapAppEvent, snapAppConfig, parseSnapDeviceContext } from '../lib/snap/app-capi';
import { buildAppPurchaseInput } from '../lib/snap/app-purchase';

const token = process.env.SNAP_CAPI_ACCESS_TOKEN;
const pixel = process.env.NEXT_PUBLIC_SNAP_PIXEL_ID || '7d2481be-4ccf-42b2-b9ea-958c6c7bbdcd';
if (!token) {
  console.error('SNAP_CAPI_ACCESS_TOKEN is required');
  process.exit(2);
}

const now = Date.now();
const site = 'https://staging.zicabella.com';
const variant = ['51813148262681', '51813148328217'];
const base = (eventName: string): SnapCapiEventPayload => ({
  eventName,
  eventId: `validate_${eventName.toLowerCase()}_${now}`,
  eventTime: now,
  eventSourceUrl: `${site}/products/aerolayer-half-denim`,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
  ipAddress: '81.2.69.142',
  scCookie1: 'validate-scid',
  externalId: 'zb.validate',
  userData: { em: 'validate@example.com', ph: '+44 7700 900123', fn: 'Val', ln: 'Idate', ct: 'London', zp: 'SW1A 1AA', country: 'GB' },
});

const events: SnapCapiEventPayload[] = [
  base('PAGE_VIEW'),
  { ...base('VIEW_CONTENT'), customData: { value: 1499, currency: 'INR', content_ids: [variant[0]], content_name: 'AEROLAYER HALF DENIM', contents: [{ id: variant[0], quantity: 1, item_price: 1499 }] } },
  { ...base('ADD_CART'), customData: { value: 2998, currency: 'INR', content_ids: [variant[0]], num_items: 2, contents: [{ id: variant[0], quantity: 2, item_price: 1499 }] } },
  { ...base('ADD_TO_WISHLIST'), customData: { value: 1499, currency: 'INR', content_ids: [variant[0]] } },
  { ...base('SEARCH'), customData: { search_string: 'denim jorts' } },
  { ...base('START_CHECKOUT'), customData: { value: 3797, currency: 'INR', content_ids: variant, num_items: 3 } },
  { ...base('ADD_BILLING'), customData: { value: 3797, currency: 'INR', content_ids: variant, num_items: 3 } },
  base('SIGN_UP'),
  base('LOGIN'),
  base('SUBSCRIBE'),
];

// PURCHASE exactly as the server ledger builds it from a stored order.
const order = {
  id: `validate_order_${now}`, customerId: 'cust_validate', totalPrice: 3797, currency: 'INR',
  customer: { email: 'validate@example.com', phone: '+44 7700 900123', name: 'Val Idate' },
  shippingAddress: JSON.stringify({ city: 'London', zip: 'SW1A 1AA', countryCode: 'GB' }),
  items: [{ variantId: variant[0], quantity: 2, price: 1499 }, { variantId: variant[1], quantity: 1, price: 799 }],
};
events.push({
  ...buildPurchaseFromOrder(order, { scCookie1: 'validate-scid', ipAddress: '81.2.69.142', userAgent: 'Mozilla/5.0' }, now),
  eventSourceUrl: `${site}/orders/${order.id}/confirmation`,
});

async function main() {
  let bad = 0;
  for (const e of events) {
    const event = buildSnapCapiEvent(e);
    const res = await fetch(`https://tr.snapchat.com/v3/${pixel}/events/validate?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event] }),
    });
    const body: any = await res.json().catch(() => ({}));
    const ok = res.ok && body?.status === 'VALID';
    if (!ok) bad++;
    console.log(`${ok ? 'VALID  ' : 'INVALID'}  ${event.event_name.padEnd(16)} HTTP ${res.status}  ${JSON.stringify(body).slice(0, 400)}`);
  }
  // Native app PURCHASE (MOBILE_APP) — validated against each Snap App ID that is configured.
  const devices = {
    ios: { platform: 'ios', appVersion: '1.0.2', buildNumber: '9', osVersion: '17.5.1', deviceModel: 'iPhone15,2', locale: 'en_IN', timezoneAbbr: 'GMT+5:30', timezone: 'Asia/Kolkata', attStatus: 'denied', idfv: '3F2504E0-4F89-11D3-9A0C-0305E82C3301' },
    android: { platform: 'android', appVersion: '1.0.4', buildNumber: '5', osVersion: '14', deviceModel: 'SM-S918B', locale: 'en_IN', timezoneAbbr: 'GMT+5:30', timezone: 'Asia/Kolkata' },
  } as const;
  for (const platform of ['ios', 'android'] as const) {
    const cfg = snapAppConfig(platform);
    if (!cfg) { console.log(`SKIPPED  MOBILE_APP ${platform}: SNAP_APP_ID_${platform.toUpperCase()}${platform === 'ios' ? ' / SNAP_IOS_APP_STORE_ID' : ''} not set`); continue; }
    const device = parseSnapDeviceContext(devices[platform])!;
    const event = buildSnapAppEvent(buildAppPurchaseInput({ ...order, id: `validate_app_${platform}_${now}` }, device,
      { ipAddress: '49.36.10.20', userAgent: 'ZicaBella', externalId: 'cust_validate' }, cfg.appId, now));
    const res = await fetch(`https://tr.snapchat.com/v3/${cfg.snapAppId}/events/validate?access_token=${cfg.token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [event] }),
    });
    const body: any = await res.json().catch(() => ({}));
    const ok = res.ok && body?.status === 'VALID';
    if (!ok) bad++;
    console.log(`${ok ? 'VALID  ' : 'INVALID'}  MOBILE_APP ${platform.padEnd(7)} HTTP ${res.status}  ${JSON.stringify(body).slice(0, 400)}`);
  }
  console.log(bad ? `\n${bad} event(s) not VALID` : '\nAll events VALID');
  process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e?.message || e); process.exit(1); });
