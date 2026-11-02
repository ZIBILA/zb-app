/**
 * The dashboard lives on app.zicabella.com only — lib/tracking/host.ts, lib/storefront-url.ts,
 * lib/auth/session-cookies.ts, middleware.ts.
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-dashboard-host.ts
 *
 * Checks the pure helpers behind the storefront → dashboard 301 (which paths, which hosts,
 * the target keeps path + query), the host rule for admin sign-in, the host-only NextAuth
 * cookies and the dashboard link helper. No network, no database.
 */
import fs from 'fs';
import path from 'path';
import {
  DASHBOARD_HOST, STOREFRONT_HOSTS, isDashboardPath, isDashboardHost, dashboardRedirectTarget, requestHost,
  isAppHostPathToRedirect, isNonCanonicalStorefrontHost,
} from '../lib/tracking/host';
import { DASHBOARD_ORIGIN, STOREFRONT_ORIGIN, dashboardUrl, storefrontUrl } from '../lib/storefront-url';
import { authCookies } from '../lib/auth/session-cookies';

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { failed++; console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

console.log('— 1. The rule');
eq('dashboard host', DASHBOARD_HOST, 'app.zicabella.com');
eq('storefront hosts are zicabella.com and www', [...STOREFRONT_HOSTS], ['zicabella.com', 'www.zicabella.com']);

console.log('\n— 2. isDashboardPath');
const dashboardPaths = [
  '/dashboard', '/dashboard/', '/dashboard/login', '/dashboard/orders/ord_1', '/dashboard?x=1',
  '/web-store', '/web-store/orders',
  '/api/admin', '/api/admin/orders', '/api/admin/orders/ord_1/approve', '/api/admin/users', '/api/admin/settings',
  '/api/web-store/orders', '/api/web-store/stats', '/api/web-store/coupons/1', '/api/webstore-settings', '/api/webstore-settings/upload-social-image',
];
eq('dashboard pages, the admin login page and dashboard-only APIs', dashboardPaths.map(isDashboardPath), dashboardPaths.map(() => true));
const storefrontPaths = [
  '/', '/products/viscera-denim', '/collections/all', '/cart', '/checkout', '/checkout/success', '/login', '/orders/ord_1', '/profile', '/community', '/gallery',
  '/api/meta/event', '/api/snap/event', '/api/auth/callback/admin-login', '/api/auth/session', '/api/app/payment/verify', '/api/checkout/complete', '/api/webhooks/razorpay',
  '/api/collections/handles', '/api/discounts', '/api/email/low-stock', '/_next/data/x', '/sitemap.xml',
];
eq('storefront pages and every other API are not', storefrontPaths.map(isDashboardPath), storefrontPaths.map(() => false));
eq('look-alike prefixes are not', ['/dashboardx', '/dashboard-old', '/api/adminx', '/api/administrator', '/web-storefront', '/xdashboard'].map(isDashboardPath), [false, false, false, false, false, false]);
eq('the storefront host keeps the middleware permission lookup and the public banner / gallery reads',
  ['/api/admin/users/check-permissions', '/api/admin/users/check-permissions?userId=u', '/api/web-store/banners', '/api/web-store/gallery', '/api/web-store/gallery/1', '/api/web-store/banners/reorder'].map(isDashboardPath),
  [false, false, false, false, false, false]);
eq('…but the rest of /api/admin/users stays dashboard-only', ['/api/admin/users', '/api/admin/users/u1', '/api/admin/users/check-permissionsx'].map(isDashboardPath), [true, true, true]);
eq('junk', [isDashboardPath(''), isDashboardPath('dashboard'), isDashboardPath(undefined as any)], [false, false, false]);

console.log('\n— 3. dashboardRedirectTarget (middleware, storefront hosts)');
eq('zicabella.com /dashboard?x=1 → app host, query kept', dashboardRedirectTarget('zicabella.com', '/dashboard', '?x=1'), 'https://app.zicabella.com/dashboard?x=1');
eq('/dashboard/login with a callbackUrl → app host login, query kept', dashboardRedirectTarget('zicabella.com', '/dashboard/login', '?callbackUrl=%2Fdashboard%2Forders'), 'https://app.zicabella.com/dashboard/login?callbackUrl=%2Fdashboard%2Forders');
eq('/api/admin/orders → app host', dashboardRedirectTarget('zicabella.com', '/api/admin/orders', ''), 'https://app.zicabella.com/api/admin/orders');
eq('/api/web-store/orders and /api/webstore-settings → app host', [dashboardRedirectTarget('zicabella.com', '/api/web-store/orders'), dashboardRedirectTarget('zicabella.com', '/api/webstore-settings')], ['https://app.zicabella.com/api/web-store/orders', 'https://app.zicabella.com/api/webstore-settings']);
eq('www host handled the same', [dashboardRedirectTarget('www.zicabella.com', '/dashboard/orders', '?page=2'), dashboardRedirectTarget('WWW.ZicaBella.com:443', '/dashboard/login')], ['https://app.zicabella.com/dashboard/orders?page=2', 'https://app.zicabella.com/dashboard/login']);
eq('host case / port / trailing dot normalised', [dashboardRedirectTarget('ZICABELLA.COM:443', '/dashboard'), dashboardRedirectTarget('zicabella.com.', '/dashboard')], ['https://app.zicabella.com/dashboard', 'https://app.zicabella.com/dashboard']);
eq('a search without "?" and an empty / undefined search', [dashboardRedirectTarget('zicabella.com', '/dashboard', 'x=1'), dashboardRedirectTarget('zicabella.com', '/dashboard', ''), dashboardRedirectTarget('zicabella.com', '/dashboard', undefined as any)], ['https://app.zicabella.com/dashboard?x=1', 'https://app.zicabella.com/dashboard', 'https://app.zicabella.com/dashboard']);
eq('storefront pages and APIs on the storefront host are untouched', ['/products/x', '/api/meta/event', '/', '/cart', '/login', '/api/auth/callback/admin-login', '/api/web-store/gallery', '/api/admin/users/check-permissions'].map(p => dashboardRedirectTarget('zicabella.com', p, '?a=1')), [null, null, null, null, null, null, null, null]);
eq('app.zicabella.com/dashboard is untouched (so are its APIs)', ['/dashboard', '/dashboard/login', '/api/admin/orders', '/api/web-store/stats'].map(p => dashboardRedirectTarget('app.zicabella.com', p)), [null, null, null, null]);
eq('other hosts are untouched (dev, platform default, staging, look-alikes, none)', ['localhost:3000', '127.0.0.1', 'zb-app-xyz.ondigitalocean.app', 'staging.example.com', 'zicabella.com.evil.io', 'evil-zicabella.com', '', undefined].map(h => dashboardRedirectTarget(h, '/dashboard')), [null, null, null, null, null, null, null, null]);
eq('platform default hosts still go through the existing storefront rule only', [isNonCanonicalStorefrontHost('zb-app-xyz.ondigitalocean.app'), isAppHostPathToRedirect('/dashboard')], [true, false]);
eq('every dashboard path is on the app-host keep-list (never 301\'d back to the storefront)', dashboardPaths.map(p => isAppHostPathToRedirect(p)), dashboardPaths.map(() => false));

console.log('\n— 4. isDashboardHost (admin sign-in)');
eq('app.zicabella.com — any case, port, trailing dot', ['app.zicabella.com', 'APP.ZicaBella.com:443', 'app.zicabella.com.'].map(h => isDashboardHost(h, '')), [true, true, true]);
eq('local dev hosts', ['localhost', 'localhost:3000', '127.0.0.1:3001', '[::1]:3000'].map(h => isDashboardHost(h, '')), [true, true, true, true]);
eq('the storefront hosts never', ['zicabella.com', 'www.zicabella.com', 'zicabella.com:443'].map(h => isDashboardHost(h, '')), [false, false, false]);
eq('platform default, staging, look-alikes, none — not without ADMIN_LOGIN_HOSTS', ['zb-app-xyz.ondigitalocean.app', 'staging.example.com', 'app.zicabella.com.evil.io', 'evil.app.zicabella.com', '', undefined, null].map(h => isDashboardHost(h, '')), [false, false, false, false, false, false, false]);
eq('ADMIN_LOGIN_HOSTS adds the listed hosts only (comma list, spaces, case, port), never a storefront host', [
  isDashboardHost('staging.example.com', 'staging.example.com, Other.Host:8443'), isDashboardHost('other.host', 'staging.example.com, Other.Host:8443'),
  isDashboardHost('zicabella.com', 'zicabella.com'), isDashboardHost('www.zicabella.com', 'www.zicabella.com'), isDashboardHost('third.host', 'staging.example.com'),
], [true, true, false, false, false]);

console.log('\n— 5. requestHost (NextAuth authorize() headers)');
const H = (o: Record<string, string>) => new Headers(o);
eq('Headers: x-forwarded-host wins over host, port stripped', requestHost(H({ host: '10.0.0.5:8080', 'x-forwarded-host': 'app.zicabella.com' })), 'app.zicabella.com');
eq('Headers: host alone', requestHost(H({ host: 'zicabella.com:443' })), 'zicabella.com');
eq('plain record (lowercase keys, as NextAuth passes them)', [requestHost({ host: 'zicabella.com', 'x-forwarded-host': 'app.zicabella.com' }), requestHost({ host: 'Localhost:3000' })], ['app.zicabella.com', 'localhost']);
eq('plain record with capitalised keys', requestHost({ Host: 'app.zicabella.com' }), 'app.zicabella.com');
eq('comma list → first value', requestHost({ 'x-forwarded-host': 'app.zicabella.com, 10.0.0.1' }), 'app.zicabella.com');
eq('nothing → ""', [requestHost(undefined), requestHost(null), requestHost({}), requestHost(H({}))], ['', '', '', '']);
eq('end to end: a storefront-host sign-in is refused, an app-host one allowed', [
  isDashboardHost(requestHost({ host: '0.0.0.0:8080', 'x-forwarded-host': 'zicabella.com' }), ''),
  isDashboardHost(requestHost({ host: '0.0.0.0:8080', 'x-forwarded-host': 'app.zicabella.com' }), ''),
], [false, true]);

console.log('\n— 6. NextAuth cookies are host-only');
const prod = authCookies('production');
eq('production names are NextAuth\'s own secure defaults', [prod.sessionToken.name, prod.callbackUrl.name, prod.csrfToken.name], ['__Secure-next-auth.session-token', '__Secure-next-auth.callback-url', '__Host-next-auth.csrf-token']);
eq('production: no `domain` on any of them', Object.values(prod).map(c => 'domain' in c.options), [false, false, false]);
eq('production: httpOnly, lax, path /, secure', Object.values(prod).map(c => [c.options.httpOnly, c.options.sameSite, c.options.path, c.options.secure]), [[true, 'lax', '/', true], [true, 'lax', '/', true], [true, 'lax', '/', true]]);
const dev = authCookies('development');
eq('development: unprefixed, not secure, still no domain', [dev.sessionToken.name, dev.csrfToken.name, dev.sessionToken.options.secure, Object.values(dev).some(c => 'domain' in c.options)], ['next-auth.session-token', 'next-auth.csrf-token', false, false]);

console.log('\n— 7. Dashboard links');
eq('DASHBOARD_ORIGIN / dashboardUrl', [DASHBOARD_ORIGIN, dashboardUrl('/dashboard/refunds'), dashboardUrl('dashboard/support/t1')], ['https://app.zicabella.com', 'https://app.zicabella.com/dashboard/refunds', 'https://app.zicabella.com/dashboard/support/t1']);
eq('customer links still on the storefront', [STOREFRONT_ORIGIN, storefrontUrl('/cart?recover=1')], ['https://zicabella.com', 'https://zicabella.com/cart?recover=1']);

console.log('\n— 8. Wiring (source checks)');
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const mw = read('middleware.ts');
eq('middleware: redirects and bypasses withAuth for storefront-host dashboard paths', [mw.includes('const dashboardTarget = dashboardRedirectTarget(host, pathname, req.nextUrl.search)'), mw.includes('if (dashboardRedirectTarget(host, pathname)) return true;'), mw.includes('NextResponse.redirect(dashboardTarget, 301)')], [true, true, true]);
const opts = read('app/api/auth/[...nextauth]/options.ts');
eq('options: host-only cookies, admin-login and admin-passkey host-checked, otp untouched', [
  opts.includes('cookies: authCookies(),'), /domain:/.test(opts.slice(opts.indexOf('cookies: authCookies('))),
  opts.includes('adminSignInRefusedOnHost("admin-login", req)'), opts.includes('adminSignInRefusedOnHost("admin-passkey", req)'),
  (opts.match(/adminSignInRefusedOnHost\(/g) || []).length,
], [true, false, true, true, 3]);
const links = [
  ['lib/services/refundNotificationService.ts', "dashboardUrl('/dashboard/refunds')"],
  ['lib/services/zohoMailService.ts', '${DASHBOARD_ORIGIN}/dashboard'],
  ['app/api/support/tickets/route.ts', 'dashboardUrl(`/dashboard/support/${ticket.id}`)'],
  ['app/api/support/messages/route.ts', 'dashboardUrl(`/dashboard/support/${ticket.id}`)'],
  ['app/api/razorpay/config/route.ts', "dashboardUrl('/dashboard/payments/razorpay')"],
  ['lib/email-templates/index.ts', '${DASHBOARD_ORIGIN}/dashboard/inventory'],
];
eq('every absolute dashboard link goes through the helper', links.map(([f, needle]) => read(f).includes(needle)), links.map(() => true));
eq('no hardcoded zicabella.com/dashboard link is left in those files', links.map(([f]) => /https:\/\/(?:app\.|www\.)?zicabella\.com\/dashboard/.test(read(f))), links.map(() => false));

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
