/**
 * Internal / test orders never become a Meta Purchase (lib/meta/internal-orders.ts):
 * tagged orders, allow-listed customers / emails / phones and the demo accounts are
 * skipped by the server ledger path (row closed, no Graph call, never retried) and
 * by the browser Pixel decision; a real customer order is unchanged.
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-internal-orders.ts
 */
process.env.META_CAPI_ACCESS_TOKEN = 'EAA' + 'B'.repeat(180);
process.env.META_PIXEL_ID = '2049977412558608';
process.env.NEXT_PUBLIC_SITE_URL = 'https://zicabella.com';
process.env.META_INTERNAL_CUSTOMER_IDS = 'cust_staff_1, cust_staff_2';
process.env.META_INTERNAL_EMAILS = 'QA@Zicabella.com';
process.env.META_INTERNAL_PHONES = '+91 98765 00000';

const graphBodies: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes('graph.facebook.com')) {
    graphBodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'T' }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); }
}

async function main() {
  const { internalOrderReason, isInternalOrder } = await import('../lib/meta/internal-orders');
  const base = { tags: 'WebStoreOrder, Web, razorpay', customerId: 'cust_real', customer: { email: 'oliver.smith@example.co.uk', phone: '+447700900123' }, shippingAddress: JSON.stringify({ email: 'oliver.smith@example.co.uk', phone: '07700 900123' }) };

  check('real customer order is not internal', internalOrderReason(base) === null);
  check('tag "test" (any case, whole tag) → internal', internalOrderReason({ ...base, tags: 'WebStoreOrder, TEST' }) === 'tag:test');
  check('tag "meta-exclude" → internal', internalOrderReason({ ...base, tags: 'meta-exclude' }) === 'tag:meta-exclude');
  check('a tag merely containing the word is not a match ("latest")', internalOrderReason({ ...base, tags: 'latest' }) === null);
  check('allow-listed customer id → internal', internalOrderReason({ ...base, customerId: 'cust_staff_2' }) === 'customer id');
  check('allow-listed email (case-insensitive, from the checkout address) → internal', internalOrderReason({ ...base, shippingAddress: JSON.stringify({ email: 'qa@zicabella.com' }) }) === 'email');
  check('allow-listed phone (last 10 digits, any formatting) → internal', internalOrderReason({ ...base, customer: { email: 'x@y.co', phone: '9876500000' } }) === 'phone');
  check('demo account email → internal', isInternalOrder({ ...base, customer: { email: 'demo@zicabella.com', phone: '' } }));
  check('demo account phone → internal', isInternalOrder({ ...base, customer: { email: 'x@y.co', phone: '+919876543210' } }));
  check('missing fields → not internal (no false positives)', internalOrderReason({ id: 'x' } as any) === null);

  // ── server ledger path ──
  const { store } = await import('./snap-test-support/fake-db');
  const { emitMetaPurchase, retryFailedMetaPurchases } = await import('../lib/meta/purchase-server');
  const mkOrder = (id: string, over: Record<string, any> = {}) => {
    const o = {
      id, orderType: 'WEB_STORE', paymentStatus: 'paid', totalPrice: 3797, currency: 'INR', customerId: 'cust_real',
      createdAt: new Date(Date.now() - 60 * 60_000), paymentCapturedAt: new Date(),
      customer: { email: 'oliver.smith@example.co.uk', phone: '+447700900123', name: 'Oliver Smith' },
      shippingAddress: JSON.stringify({ name: 'Oliver Smith', email: 'oliver.smith@example.co.uk', phone: '07700 900123', city: 'London', state: 'Greater London', zip: 'SW1A 1AA', country: 'GB' }),
      items: [{ quantity: 2, price: 1499, variantId: '51813148262681', sku: '51813148262681' }],
      ...over,
    };
    store.orders.set(id, o);
    return o;
  };
  const ctx = { userAgent: 'UA', ipAddress: '81.2.69.142', fbp: 'fb.1.1700000000000.1', externalId: 'zb.x' };

  mkOrder('ord_real');
  const real = await emitMetaPurchase('ord_real', ctx, { paymentConfirmed: true });
  check('real order: sent', real.status === 'sent' && graphBodies.length === 1, real);

  mkOrder('ord_qa', { tags: 'WebStoreOrder, test' });
  const qa = await emitMetaPurchase('ord_qa', ctx, { paymentConfirmed: true });
  check('tagged test order: skipped, no Graph call', qa.status === 'skipped' && /internal order/.test(qa.reason) && graphBodies.length === 1, qa);
  const row = Array.from(store.ledger.values()).find((r: any) => r.orderId === 'ord_qa') as any;
  check('tagged test order: ledger row closed as skipped', row?.status === 'skipped' && /internal order/.test(row?.lastError || ''), row);

  mkOrder('ord_staff', { customerId: 'cust_staff_1' });
  await emitMetaPurchase('ord_staff', ctx, { paymentConfirmed: true });
  mkOrder('ord_demo', { customer: { email: 'demo@zicabella.com', phone: '+919876543210', name: 'Demo User' }, shippingAddress: JSON.stringify({ email: 'demo@zicabella.com', phone: '+919876543210' }) });
  await emitMetaPurchase('ord_demo', ctx, { paymentConfirmed: true });
  check('staff customer and demo account: no Graph call', graphBodies.length === 1);

  // The retry / recovery cron never re-sends them either.
  const cron = await retryFailedMetaPurchases(25);
  check('cron: internal orders are not recovered or retried', graphBodies.length === 1 && cron.healthy, cron);

  // ── browser decision ──
  const { decideMetaBrowserPurchase, pickOrderServerFacts } = await import('../lib/meta/browser-purchase');
  const facts = pickOrderServerFacts({ id: 'ord_qa', paymentStatus: 'paid', orderType: 'WEB_STORE', totalPrice: 3797, currency: 'INR', internal: true }, 'ord_qa');
  check('browser: server facts carry internal=true', facts?.internal === true, facts);
  const d = decideMetaBrowserPurchase({ id: 'ord_qa', paymentStatus: 'paid', orderType: 'WEB_STORE', totalPrice: 3797, createdAt: new Date().toISOString(), internal: true }, { alreadySent: false });
  check('browser: internal order → done, no Pixel Purchase', d.action === 'done' && d.reason === 'internal order', d);
  const d2 = decideMetaBrowserPurchase({ id: 'ord_real', paymentStatus: 'paid', orderType: 'WEB_STORE', totalPrice: 3797, createdAt: new Date().toISOString() }, { alreadySent: false });
  check('browser: real order still fires', d2.action === 'fire', d2);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
