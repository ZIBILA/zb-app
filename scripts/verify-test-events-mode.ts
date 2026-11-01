/**
 * Tester mode (lib/tracking/test-events.ts): the zb_test_events cookie turns a visitor's Meta
 * server events into Test Events and lifts the staff exclusion for that browser.
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-test-events-mode.ts
 *
 * Graph API calls are captured instead of sent; no database is touched for the sender.
 */
process.env.META_CAPI_ACCESS_TOKEN = 'EAA' + 'B'.repeat(180);
process.env.META_PIXEL_ID = '2049977412558608';
process.env.NEXT_PUBLIC_SITE_URL = 'https://zicabella.com';
delete process.env.META_TEST_EVENT_CODE; // no deployment-wide code (off the live site it would be honoured; on the live site it is ignored)

const graphBodies: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes('graph.facebook.com')) {
    graphBodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'T' }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { failed++; console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

(async () => {
  const { parseTestEventCode, TEST_EVENTS_COOKIE } = await import('../lib/tracking/test-events');
  const capi = await import('../lib/metaCapi');
  const purchase = await import('../lib/meta/purchase');

  console.log('— 1. The code');
  eq('well-formed codes pass (case-insensitive, trimmed)', [parseTestEventCode('TEST91711'), parseTestEventCode(' test91711 '), parseTestEventCode('TESTAB12')], ['TEST91711', 'TEST91711', 'TESTAB12']);
  eq('anything else is ignored', [parseTestEventCode('off'), parseTestEventCode('TEST'), parseTestEventCode('91711'), parseTestEventCode('<script>'), parseTestEventCode(''), parseTestEventCode(undefined)], [undefined, undefined, undefined, undefined, undefined, undefined]);
  eq('cookie name', TEST_EVENTS_COOKIE, 'zb_test_events');

  console.log('\n— 2. The sender');
  const base = { eventName: 'AddToCart', eventId: 'evt_1', eventSourceUrl: 'https://zicabella.com/products/x', userAgent: 'UA', eventTime: Math.floor(Date.now() / 1000),
    userData: { client_user_agent: 'UA', client_ip_address: '49.36.1.1', fbp: 'fb.1.1700000000000.123' }, customData: { value: 10, currency: 'INR', content_ids: ['1'], content_type: 'product' } };
  graphBodies.length = 0;
  await capi.sendCapiEvent({ ...base, testEventCode: 'TEST91711' });
  eq('a visitor test code is sent as test_event_code', graphBodies[0]?.test_event_code, 'TEST91711');
  eq('…and the event itself is unchanged', [graphBodies[0]?.data?.[0]?.event_name, graphBodies[0]?.data?.[0]?.event_id], ['AddToCart', 'evt_1']);
  graphBodies.length = 0;
  await capi.sendCapiEvent({ ...base, eventId: 'evt_2' });
  eq('no visitor code → no test_event_code', graphBodies[0]?.test_event_code, undefined);
  graphBodies.length = 0;
  await capi.sendCapiEvent({ ...base, eventId: 'evt_3', testEventCode: 'garbage' });
  eq('a malformed visitor code is dropped, not sent', graphBodies[0]?.test_event_code, undefined);

  console.log('\n— 3. The Purchase context');
  const withCookie = purchase.metaContextFromRequest(new Request('https://zicabella.com/api/checkout/razorpay', { method: 'POST',
    headers: { cookie: 'zb_test_events=TEST91711; _fbp=fb.1.1700000000000.123; zb_external_id=zb.ext-1', 'user-agent': 'UA' } }));
  eq('the code is read from the cookie into the click context', [withCookie.testEventCode, withCookie.fbp, withCookie.externalId], ['TEST91711', 'fb.1.1700000000000.123', 'zb.ext-1']);
  const without = purchase.metaContextFromRequest(new Request('https://zicabella.com/api/checkout/razorpay', { method: 'POST', headers: { cookie: '_fbp=fb.1.1700000000000.123' } }));
  eq('no cookie → no code in the context', 'testEventCode' in without, false);
  const order = { id: 'ord_t1', currency: 'INR', totalPrice: '10', paymentStatus: 'paid', items: [{ variantId: '53040138551577', price: '10', quantity: 1, title: 'x' }],
    shippingAddress: { name: 'Test Shopper', email: 'shopper@example.com', phone: '9876543210', city: 'Mumbai', state: 'MH', zip: '400001', country: 'India', countryCode: 'IN' }, customer: null };
  const p1 = purchase.buildMetaPurchaseFromOrder(order, withCookie, Date.now());
  const p2 = purchase.buildMetaPurchaseFromOrder(order, without, Date.now());
  eq('the Purchase payload carries the code only when the context has it', [p1.testEventCode, 'testEventCode' in p2, p1.eventName, p1.eventId], ['TEST91711', false, 'Purchase', 'ord_t1']);

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
