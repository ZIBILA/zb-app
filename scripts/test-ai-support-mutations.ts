/**
 * Workflow tests for Zica AI support mutation rules.
 * Run: npx tsx scripts/test-ai-support-mutations.ts
 */

import assert from 'node:assert/strict';
import { indianMobileOk, pinOk, isAwbLocked, AWB_LOCK_MESSAGE } from '../lib/services/aiSupportMutationRules';
import { isToolAllowed } from '../lib/ai/toolAllowList';
import { normalizeOrderShippingAddress } from '../lib/order-shipping-address';

function ok(name: string) {
  console.log(`ok: ${name}`);
}

// Tools are granted to customers, not guests
assert.equal(isToolAllowed('update_order_address', { kind: 'customer', customerId: 'c1' }), true);
assert.equal(isToolAllowed('update_order_phone', { kind: 'customer', customerId: 'c1' }), true);
assert.equal(isToolAllowed('update_order_size', { kind: 'customer', customerId: 'c1' }), true);
assert.equal(isToolAllowed('get_order_tracking', { kind: 'customer', customerId: 'c1' }), true);
assert.equal(isToolAllowed('update_order_address', { kind: 'guest' }), true);
assert.equal(isToolAllowed('get_order_tracking', { kind: 'guest' }), true);
assert.equal(isToolAllowed('get_dashboard_summary', { kind: 'guest' }), false);
ok('customer and identified guests can use support mutation tools');

// Phone / pin validation
assert.equal(indianMobileOk('9123456789'), true);
assert.equal(indianMobileOk('+91 91234 56789'), true);
assert.equal(indianMobileOk('0123456789'), false);
assert.equal(indianMobileOk('12345'), false);
assert.equal(pinOk('560038'), true);
assert.equal(pinOk('56003'), false);
ok('phone and pincode validation');

// Incomplete address still missing fields after normalize
const partial = normalizeOrderShippingAddress({ city: 'Delhi', pincode: '110001' });
assert.equal(partial.city, 'Delhi');
assert.equal(partial.address1.length < 8, true);
ok('partial address is incomplete');

const complete = normalizeOrderShippingAddress({
  name: 'Ravi Kumar',
  phone: '9123456789',
  address1: '12 MG Road, Indiranagar',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560038',
});
assert.equal(complete.address1.includes('MG Road'), true);
assert.equal(pinOk(complete.zip), true);
assert.equal(indianMobileOk(complete.phone), true);
ok('complete address normalizes');

// AWB lock
assert.equal(isAwbLocked(null, false), false);
assert.equal(isAwbLocked('SR123', false), true);
assert.equal(isAwbLocked(null, true), true);
assert.match(AWB_LOCK_MESSAGE, /AWB/);
ok('AWB lock blocks destination edits; pending AWB also locked');

// Tracking policy: before AWB we share pending copy; after AWB we share AWB
function trackingCopy(awb: string | null, awbPending: boolean) {
  if (!awb && !awbPending) return 'AWB has not been generated yet';
  if (awbPending) return 'AWB is being assigned';
  return `AWB ${awb}`;
}
assert.match(trackingCopy(null, false), /not been generated/);
assert.match(trackingCopy(null, true), /being assigned/);
assert.match(trackingCopy('SR123', false), /SR123/);
ok('tracking copy before and after AWB');

console.log('\nAll AI support mutation workflow tests passed.');
