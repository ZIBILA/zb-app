/**
 * Order lifecycle → Shopify (lib/services/shopifyLifecycleSync.ts) against a fake Shopify (fetch stubbed).
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/shopify-lifecycle-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test', SHOPIFY_STORE_DOMAIN: 'test-shop.myshopify.com', SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test' });

import { db } from './memory-prisma';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`);
}

// ── fake Shopify ──
const shop: Record<string, any> = {};
const calls: Array<{ method: string; path: string; body?: any }> = [];
let fid = 900;
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const method = String(init.method || 'GET').toUpperCase();
  const path = new URL(url).pathname.replace(/^\/admin\/api\/[^/]+\//, '');
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path, body });
  let m;
  if (path === 'graphql.json') {
    const id = String(body.variables.input.id).split('/').pop()!;
    shop[id].financial_status = 'paid';
    return json({ data: { orderMarkAsPaid: { order: { id, displayFinancialStatus: 'PAID' }, userErrors: [] } } });
  }
  if ((m = path.match(/^orders\/(\d+)\.json$/))) return json({ order: shop[m[1]] });
  if ((m = path.match(/^orders\/(\d+)\/fulfillment_orders\.json$/))) {
    const o = shop[m[1]];
    return json({ fulfillment_orders: o.fulfillments.length ? [{ id: 1, status: 'closed' }] : [{ id: Number(m[1]) * 10, status: 'open', supported_actions: ['create_fulfillment'] }] });
  }
  if (path === 'fulfillments.json') {
    const foId = body.fulfillment.line_items_by_fulfillment_order[0].fulfillment_order_id;
    const o = shop[String(foId / 10)];
    const f = { id: ++fid, status: 'success', tracking_number: body.fulfillment.tracking_info.number, tracking_company: body.fulfillment.tracking_info.company, shipment_status: null };
    o.fulfillments.push(f);
    o.fulfillment_status = 'fulfilled';
    return json({ fulfillment: f }, 201);
  }
  if ((m = path.match(/^fulfillments\/(\d+)\/update_tracking\.json$/))) {
    for (const o of Object.values(shop)) for (const f of o.fulfillments) if (String(f.id) === m[1]) f.tracking_number = body.fulfillment.tracking_info.number;
    return json({ fulfillment: {} });
  }
  if ((m = path.match(/^orders\/(\d+)\/fulfillments\/(\d+)\/events\.json$/))) {
    const f = shop[m[1]].fulfillments.find((x: any) => String(x.id) === m[2]);
    f.shipment_status = body.event.status;
    return json({ fulfillment_event: { status: body.event.status } }, 201);
  }
  if ((m = path.match(/^orders\/(\d+)\/cancel\.json$/))) {
    shop[m[1]].cancelled_at = new Date().toISOString();
    return json({ order: shop[m[1]] });
  }
  return json({ errors: `unhandled ${method} ${path}` }, 404);
};

function addOrder(id: string, shopifyId: string, extra: Record<string, any>, shipment?: Record<string, any>) {
  (db.order ||= []).push({ id, shopifyOrderId: shopifyId, status: 'open', paymentStatus: 'paid', paymentMethod: 'razorpay', deliveryStatus: 'pending', tags: '', updatedAt: new Date(), createdAt: new Date(), ...extra });
  if (shipment) (db.shipment ||= []).push({ id: `s_${id}`, orderId: id, type: 'outbound', createdAt: new Date(), updatedAt: new Date(), courier: 'Delhivery', trackingUrl: `https://track/${shipment.awb}`, ...shipment });
  shop[shopifyId] = { id: Number(shopifyId), cancelled_at: null, financial_status: extra.paymentMethod === 'cod' ? 'partially_paid' : 'paid', fulfillment_status: null, fulfillments: [] };
}
const did = (method: string, re: RegExp) => calls.filter((c) => c.method === method && re.test(c.path));

async function main() {
  const { syncOrderLifecycleToShopify } = await import('../../lib/services/shopifyLifecycleSync');

  // L1 — AWB assigned → fulfilled in Shopify with courier + tracking.
  addOrder('o1', '1001', { deliveryStatus: 'confirmed' }, { awb: 'AWB1', status: 'confirmed' });
  const r1 = await syncOrderLifecycleToShopify('o1');
  const created = did('POST', /^fulfillments\.json$/)[0]?.body?.fulfillment;
  check('L1 an order with an AWB is fulfilled in Shopify', r1.actions.includes('fulfilled') && shop['1001'].fulfillment_status === 'fulfilled', JSON.stringify(r1));
  check('L2 with the courier, tracking number and tracking URL, without emailing the customer',
    created?.tracking_info?.number === 'AWB1' && created?.tracking_info?.company === 'Delhivery' && created?.tracking_info?.url === 'https://track/AWB1' && created?.notify_customer === false);
  const again = await syncOrderLifecycleToShopify('o1');
  check('L3 running again changes nothing', again.actions.length === 0, JSON.stringify(again));

  // L4 — AWB re-assigned → tracking updated.
  db.shipment.find((s) => s.id === 's_o1').awb = 'AWB1B';
  const r4 = await syncOrderLifecycleToShopify('o1');
  check('L4 a new AWB updates the Shopify tracking number', r4.actions.includes('tracking_updated') && shop['1001'].fulfillments[0].tracking_number === 'AWB1B');

  // L5 — out for delivery, then delivered.
  db.shipment.find((s) => s.id === 's_o1').status = 'out_for_delivery';
  db.order.find((o) => o.id === 'o1').deliveryStatus = 'out_for_delivery';
  await syncOrderLifecycleToShopify('o1');
  check('L5 out for delivery is shown in Shopify', shop['1001'].fulfillments[0].shipment_status === 'out_for_delivery');
  db.shipment.find((s) => s.id === 's_o1').status = 'delivered';
  db.order.find((o) => o.id === 'o1').deliveryStatus = 'delivered';
  const r6 = await syncOrderLifecycleToShopify('o1');
  check('L6 delivered orders show as Delivered in Shopify', shop['1001'].fulfillments[0].shipment_status === 'delivered' && r6.actions.includes('event_delivered'));
  check('L7 a prepaid order is not touched financially', !r6.actions.includes('marked_paid'));

  // L8 — COD delivered: Shopify partially paid → paid.
  addOrder('o8', '1008', { paymentMethod: 'cod', paymentStatus: 'cod_upfront_paid', deliveryStatus: 'delivered' }, { awb: 'AWB8', status: 'delivered' });
  const r8 = await syncOrderLifecycleToShopify('o8');
  check('L8 a delivered COD order is fulfilled, delivered and marked paid in one pass',
    r8.actions.includes('fulfilled') && r8.actions.includes('event_delivered') && r8.actions.includes('marked_paid') && shop['1008'].financial_status === 'paid', JSON.stringify(r8));
  const r8b = await syncOrderLifecycleToShopify('o8');
  check('L9 …and never marked paid twice', !r8b.actions.includes('marked_paid'));

  // L10 — undelivered COD stays partially paid.
  addOrder('o10', '1010', { paymentMethod: 'cod', paymentStatus: 'cod_upfront_paid', deliveryStatus: 'in_transit' }, { awb: 'AWB10', status: 'in_transit' });
  const r10 = await syncOrderLifecycleToShopify('o10');
  check('L10 a COD order in transit is fulfilled + in transit, still partially paid', r10.actions.includes('event_in_transit') && shop['1010'].financial_status === 'partially_paid');

  // L11 — cancelled here, Shopify cancel had failed earlier → cancelled now, without restocking again.
  addOrder('o11', '1011', { status: 'cancelled' });
  const r11 = await syncOrderLifecycleToShopify('o11');
  const cancelCall = did('POST', /^orders\/1011\/cancel\.json$/)[0];
  check('L11 a cancelled order is cancelled in Shopify', r11.actions.includes('cancelled') && !!shop['1011'].cancelled_at);
  check('L12 …without a second restock', cancelCall?.body?.restock === false);

  // L13 — no AWB yet → nothing pushed.
  addOrder('o13', '1013', {});
  const r13 = await syncOrderLifecycleToShopify('o13');
  check('L13 an order without an AWB is left unfulfilled', r13.actions.length === 0 && !shop['1013'].fulfillment_status);

  // L14 — not in Shopify (app_pending) → skipped, no calls.
  (db.order ||= []).push({ id: 'o14', shopifyOrderId: 'app_pending_1', status: 'open', paymentStatus: 'paid', shipments: [] });
  const before = calls.length;
  const r14 = await syncOrderLifecycleToShopify('o14');
  check('L14 orders that are not in Shopify are skipped', r14.skipped === 'not_in_shopify' && calls.length === before);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
