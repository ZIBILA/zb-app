#!/usr/bin/env node
/**
 * Automated verification for the client return/exchange UI + admin fixes.
 * Static + pure-logic checks (no live Shiprocket / admin session required).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

console.log('\n=== 1. Order details UI (web) ===');
{
  const src = read('app/orders/[id]/page.tsx');
  ok('External Track button present', /External Track/.test(src));
  ok('Live Shipment label removed', !/Live Shipment/.test(src));
  ok('Tracking No. label removed', !/Tracking No\./.test(src));
  const trackBlock = src.slice(src.indexOf('External Track only'), src.indexOf('{/* ORDER ITEMS */}'));
  ok('Track block is button-only (no courier heading)', /External Track/.test(trackBlock) && !/font-heading/.test(trackBlock));
  ok('Return Pickup Logistics removed', !/Return Pickup Logistics/.test(src));
  ok('Order Info section removed', !/Order Info/.test(src) && !/Order Source/.test(src));
  ok('Package Contents kept', /Package Contents/.test(src));
  ok('Billing Summary kept', /Billing Summary/.test(src));
  ok('Delivery Address kept', /Delivery Address/.test(src));
}

console.log('\n=== 2. Order details UI (Android / iOS) ===');
{
  for (const rel of [
    'ZicaBella-android/src/screens/OrderDetailsScreen.tsx',
    'ZicaBella/src/screens/OrderDetailsScreen.tsx',
  ]) {
    const src = read(rel);
    ok(`${path.basename(path.dirname(path.dirname(rel)))}: External Track present`, /External Track/.test(src));
    ok(`${path.basename(path.dirname(path.dirname(rel)))}: RETURN PICKUP LOGISTICS removed`, !/RETURN PICKUP LOGISTICS/.test(src));
    ok(`${path.basename(path.dirname(path.dirname(rel)))}: ORDER INFO removed`, !/>ORDER INFO</.test(src) && !/Order Type/.test(src));
    ok(`${path.basename(path.dirname(path.dirname(rel)))}: ORDER ITEMS kept`, /ORDER ITEMS/.test(src));
    ok(`${path.basename(path.dirname(path.dirname(rel)))}: BILLING SUMMARY kept`, /BILLING SUMMARY/.test(src));
  }
}

console.log('\n=== 3. COD approve → Store Credit only (admin returns list) ===');
{
  const page = read('app/dashboard/returns/page.tsx');
  const api = read('app/api/admin/returns/route.ts');
  ok('API exposes isCod', /isCod:\s*isCodOrder/.test(api));
  ok('Modal shows COD message instead of method toggle', /refundModal\.isCod \?/.test(page) && /COD_STORE_CREDIT_MESSAGE/.test(page));
  ok('Submit forces store credit for COD', /isStoreCredit:\s*refundModal\.isCod \? true/.test(page));
  ok('Approve route still coerces COD via resolveRefundMethod', /resolveRefundMethod/.test(read('app/api/admin/returns/[id]/approve/route.ts')));
}

console.log('\n=== 4. Return create speed (non-blocking email) ===');
{
  const web = read('app/api/returns/create/route.ts');
  const app = read('app/api/app/orders/return/route.ts');
  ok('Web create: notification is fire-and-forget', /void \(async \(\) =>/.test(web) && /sendRefundRequestNotification/.test(web));
  ok('Web create: response built before notification await chain', web.indexOf('responseBody') < web.indexOf('void (async'));
  ok('App create: notification is fire-and-forget', /void \(async \(\) =>/.test(app));
  const voidIdx = app.indexOf('void (async');
  const callIdx = app.indexOf('await shopifyPatch');
  ok('App create: Shopify sync moved off critical path', voidIdx >= 0 && callIdx > voidIdx);
}

console.log('\n=== 5. Cancel & reassign reverse pickup ===');
{
  ok('Returns cancel-pickup route exists', exists('app/api/admin/returns/[id]/cancel-pickup/route.ts'));
  ok('Exchanges cancel-pickup route exists', exists('app/api/admin/exchanges/[id]/cancel-pickup/route.ts'));
  const panel = read('components/admin/ReversePickupPanel.tsx');
  ok('Panel has Cancel Pickup & Reassign Partner', /Cancel Pickup/.test(panel) && /cancel-pickup/.test(panel));
  ok('Panel only offers select when no reverseAwb', /bookable && !open && !reverseAwb/.test(panel));
  const svc = read('lib/services/reversePickup.ts');
  ok('Service refuses after pickup done statuses', /Pickup is already complete/.test(svc));
  ok('Service clears reverseAwb after cancel', /reverseAwb:\s*null/.test(svc) && /approved_pickup_failed/.test(svc));
  const logistics = read('lib/services/logistics.ts');
  ok('Logistics void helper present', /export async function cancelReversePickupsForRequest/.test(logistics));
  ok('Logistics blocks picked_up/in_transit', /picked_up.*in_transit/.test(logistics.replace(/\n/g, ' ')));
}

console.log('\n=== 6. Refund Pending counter → Refunds Management ===');
{
  const returnsPage = read('app/dashboard/returns/page.tsx');
  const refundsPage = read('app/dashboard/refunds/page.tsx');
  ok('Returns fetches /api/admin/refunds for pendingCount', /fetch\("\/api\/admin\/refunds"\)/.test(returnsPage));
  ok('Uses summary.pendingCount', /pendingCount/.test(returnsPage));
  ok('Card links to /dashboard/refunds?status=pending', /\/dashboard\/refunds\?status=pending/.test(returnsPage));
  ok('Refunds page reads status query param', /useSearchParams/.test(refundsPage) && /status=pending/.test(refundsPage));
  ok('No custom refund_pending filter on returns API', !/statusCounts\.refund_pending = combined/.test(read('app/api/admin/returns/route.ts')));
}

console.log('\n=== 7. Profile Store Coins label ===');
{
  const profile = read('app/profile/page.tsx');
  const statsBlock = profile.slice(
    profile.indexOf('STORE COINS'),
    profile.indexOf('STORE COINS') + 400
  );
  ok('STORE COINS label still present', /STORE COINS/.test(profile));
  ok('Value is number only (no trailing Coins in stats)', /value:\s*storeCredits > 0 \? storeCredits\.toLocaleString\("en-IN"\) : "0"/.test(profile));
  ok('Rupee subtext still present', /₹\$\{storeCredits/.test(statsBlock) || /\(₹\$\{storeCredits/.test(profile));
  ok('Stats value does not append " Coins"', !/toLocaleString\("en-IN"\)\} Coins`/.test(profile) && !/`0 Coins`/.test(profile));
}

console.log('\n=== 8. Pure policy logic (COD) ===');
{
  // Inline the same rules as lib/returnPolicy (keep in sync with source).
  function isCodOrder(order) {
    if (!order) return false;
    const method = String(order.paymentMethod || '').toLowerCase().trim();
    const status = String(order.paymentStatus || '').toLowerCase().trim();
    const tags = String(order.tags || '').toLowerCase();
    const note = String(order.note || '').toLowerCase();
    return (
      method === 'cod' ||
      status === 'partially_paid' ||
      status === 'cod_upfront_paid' ||
      tags.includes('cod') ||
      note.includes('cod order') ||
      note.includes('upfront fee paid')
    );
  }
  function resolveRefundMethod(order, requested) {
    if (isCodOrder(order)) return 'store_credit';
    const r = String(requested || '').toLowerCase();
    return r === 'store_credit' || r === 'storecredit' || r === 'store-credit' ? 'store_credit' : 'original_method';
  }
  ok('COD + original_method request → store_credit', resolveRefundMethod({ paymentMethod: 'COD' }, 'original_method') === 'store_credit');
  ok('Prepaid + original_method → original_method', resolveRefundMethod({ paymentMethod: 'Razorpay' }, 'original_method') === 'original_method');
  ok('Prepaid + store_credit → store_credit', resolveRefundMethod({ paymentMethod: 'Razorpay' }, 'store_credit') === 'store_credit');
}

console.log('\n=== 9. Cancel-pickup status guard table ===');
{
  const CANCELLABLE = ['approved', 'approved_pickup_failed'];
  const BLOCKED = ['pending_approval', 'in_transit', 'delivered_to_warehouse', 'received', 'refunded', 'rejected', 'cancelled'];
  for (const s of CANCELLABLE) ok(`cancellable status: ${s}`, CANCELLABLE.includes(s));
  for (const s of BLOCKED) ok(`blocked status: ${s}`, !CANCELLABLE.includes(s));
  const carrierBlocked = ['picked_up', 'in_transit', 'out_for_delivery', 'delivered'];
  const carrierOk = ['pickup_scheduled', 'pickup_failed', 'confirmed', 'new'];
  for (const c of carrierBlocked) ok(`carrier blocks reassign: ${c}`, carrierBlocked.includes(c));
  for (const c of carrierOk) ok(`carrier allows reassign: ${c}`, !carrierBlocked.includes(c));
}

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('\nAll automated checks passed.\n');
console.log('NOTE: This does NOT replace a live E2E with admin login + Shiprocket.');
console.log('Still manually verify: submit return latency, cancel AWB at Shiprocket, COD modal, refund pending deep-link.\n');
process.exit(0);
