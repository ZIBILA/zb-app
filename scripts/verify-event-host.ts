/**
 * Events come from zicabella.com only — lib/tracking/host.ts.
 *
 *   npx tsx scripts/verify-event-host.ts
 *
 * Checks the one rule every pixel wrapper, relay and the middleware redirect use:
 * which hosts may send Meta / Snap events, and which app.zicabella.com paths are
 * sent to zicabella.com. Pure functions, no network, no database.
 */
import { EVENT_HOSTS, NON_EVENT_HOSTS, eventHosts, isEventHost, isAppHostPathToRedirect, normalizeHost } from '../lib/tracking/host';
import { snapStorefrontHosts, snapStorefrontOrigin } from '../lib/snap/config';
import { STOREFRONT_ORIGIN, STOREFRONT_HOST, storefrontUrl } from '../lib/storefront-url';

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { failed++; console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

console.log('— 1. The rule');
eq('event hosts are zicabella.com and www only', [...EVENT_HOSTS], ['zicabella.com', 'www.zicabella.com']);
eq('app.zicabella.com is named as a host that never sends', [...NON_EVENT_HOSTS], ['app.zicabella.com']);
eq('production: zicabella.com, www (site URL = zicabella.com adds nothing)', [...eventHosts('https://zicabella.com', 'production')].sort(), ['www.zicabella.com', 'zicabella.com']);
eq('production: NEXT_PUBLIC_SITE_URL=app.zicabella.com does NOT make the app host send', [...eventHosts('https://app.zicabella.com', 'production')].sort(), ['www.zicabella.com', 'zicabella.com']);
eq('production: a staging site URL tracks its own host too', [...eventHosts('https://staging.example.com', 'production')].sort(), ['staging.example.com', 'www.zicabella.com', 'zicabella.com']);
eq('production: quoted / unset / junk site URL → the two live hosts', [
  [...eventHosts('"https://zicabella.com/"', 'production')].length, [...eventHosts(undefined, 'production')].length, [...eventHosts('not a url', 'production')].length,
], [2, 2, 2]);
eq('development adds localhost / 127.0.0.1 / [::1] only', [...eventHosts('https://zicabella.com', 'development')].sort(), ['127.0.0.1', '[::1]', 'localhost', 'www.zicabella.com', 'zicabella.com']);

console.log('\n— 2. isEventHost');
eq('zicabella.com / www / case / port / trailing dot', [
  isEventHost('zicabella.com', undefined, 'production'), isEventHost('www.zicabella.com', undefined, 'production'),
  isEventHost('ZicaBella.com', undefined, 'production'), isEventHost('zicabella.com:443', undefined, 'production'), isEventHost('zicabella.com.', undefined, 'production'),
], [true, true, true, true, true]);
eq('app.zicabella.com never — not even when it is the site URL or outside production', [
  isEventHost('app.zicabella.com', undefined, 'production'), isEventHost('app.zicabella.com', 'https://app.zicabella.com', 'production'),
  isEventHost('app.zicabella.com', undefined, 'development'), isEventHost('APP.zicabella.com:3000', undefined, 'development'),
], [false, false, false, false]);
eq('other hosts never (look-alikes, subdomains, empty)', [
  isEventHost('zicabella.com.evil.io', undefined, 'production'), isEventHost('evil.zicabella.com', undefined, 'production'),
  isEventHost('staging.zicabella.com', undefined, 'production'), isEventHost('', undefined, 'production'), isEventHost(undefined, undefined, 'production'),
], [false, false, false, false, false]);
eq('localhost only outside production', [isEventHost('localhost', undefined, 'development'), isEventHost('127.0.0.1', undefined, 'test'), isEventHost('localhost', undefined, 'production')], [true, true, false]);
eq('normalizeHost', [normalizeHost(' Zicabella.COM:8443 '), normalizeHost('[::1]:3000'), normalizeHost('a.b.')], ['zicabella.com', '[::1]', 'a.b']);

console.log('\n— 3. Snap relay / purchase use the same rule');
eq('snapStorefrontHosts (production) = the rule', [...snapStorefrontHosts('https://zicabella.com', 'production')].sort(), ['www.zicabella.com', 'zicabella.com']);
eq('snapStorefrontOrigin: app host is not a storefront origin', [
  snapStorefrontOrigin('https://zicabella.com/checkout', snapStorefrontHosts('https://zicabella.com', 'production')),
  snapStorefrontOrigin('https://app.zicabella.com/x?y=1', snapStorefrontHosts('https://zicabella.com', 'production')),
], ['https://zicabella.com', null]);

console.log('\n— 4. app.zicabella.com → zicabella.com (middleware)');
eq('storefront pages are redirected', ['/', '/products/viscera-denim', '/collections/all', '/collections/new-arrivals', '/search?q=denim', '/blogs/x', '/story', '/faq', '/policies/returns', '/gallery', '/community', '/collaborations', '/reviews', '/support', '/wishlist', '/chat'].map(isAppHostPathToRedirect),
  [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true]);
eq('admin, API and Next internals stay', ['/dashboard', '/dashboard/login', '/admin/x', '/web-store', '/api/app/payment/verify', '/api/meta/event', '/api/webhooks/razorpay', '/_next/data/x', '/unauthorized', '/uploads/x.pdf'].map(isAppHostPathToRedirect),
  [false, false, false, false, false, false, false, false, false, false]);
eq('pages a shopper may be mid-flow on stay', ['/cart', '/cart?recover=abc', '/checkout', '/checkout/success', '/orders/ord_1/confirmation', '/orders', '/login', '/profile', '/portal/requests/new', '/returns', '/r/abc'].map(isAppHostPathToRedirect),
  [false, false, false, false, false, false, false, false, false, false, false]);
eq('machine-read files and static assets stay', ['/feed.xml', '/feed.csv', '/sitemap.xml', '/sitemap-0.xml', '/robots.txt', '/manifest.webmanifest', '/favicon.ico', '/bimi/logo.svg', '/.well-known/x', '/fonts/a.woff2', '/videos/hero.mp4', '/logo.png'].map(isAppHostPathToRedirect),
  [false, false, false, false, false, false, false, false, false, false, false, false]);
eq('look-alike prefixes are still redirected', ['/cartography', '/checkouts', '/loginx', '/products/cart'].map(isAppHostPathToRedirect), [true, true, true, true]);

console.log('\n— 5. Customer links');
eq('storefront origin / host / url', [STOREFRONT_ORIGIN, STOREFRONT_HOST, storefrontUrl('/cart?recover=1'), storefrontUrl('orders/x')],
  ['https://zicabella.com', 'zicabella.com', 'https://zicabella.com/cart?recover=1', 'https://zicabella.com/orders/x']);

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
