const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const purchase = { eventName: 'Purchase', eventId: 'order-canonical-42', eventSourceUrl: 'https://example.test/confirmation',
  userAgent: 'test-browser', customData: { value: 4000, currency: 'INR' }, userData: { external_id: 'a'.repeat(64) } };

function configured(env, fetch) {
  const h = loader({}, { fetch });
  for (const key of ['META_PIXEL_ID', 'NEXT_PUBLIC_META_PIXEL_ID', 'NEXT_PUBLIC_FACEBOOK_PIXEL_ID']) delete h.context.process.env[key];
  Object.assign(h.context.process.env, env);
  return h;
}

test('legacy public Facebook Pixel setting selects the same browser and server destination', async () => {
  const pixelId = '123456789012345';
  let sentUrl;
  const h = configured({ NEXT_PUBLIC_FACEBOOK_PIXEL_ID: pixelId }, async url => { sentUrl = url; return Response.json({ events_received: 1 }); });
  const result = await h.load('lib/metaCapi.ts').sendCapiEvent(purchase);
  assert.equal(result.success, true);
  assert.equal(h.load('lib/metaPixel.ts').META_PIXEL_ID, pixelId);
  assert.ok(new URL(sentUrl).pathname.endsWith(`/${pixelId}/events`));
});

test('conflicting browser/server Pixel IDs are rejected before sending advertising data', async () => {
  const h = configured({ META_PIXEL_ID: '123456789012345', NEXT_PUBLIC_META_PIXEL_ID: '999999999999999' }, () => assert.fail('wrong dataset must not receive event'));
  const result = await h.load('lib/metaCapi.ts').sendCapiEvent(purchase);
  assert.equal(result.success, false); assert.match(result.error, /Pixel IDs do not match/);
});

test('browser Purchase cannot be queued without a usable event ID', async () => {
  const h = loader({}, { window: { fbq: () => assert.fail('missing-ID Purchase must not be queued') }, document: { cookie: '' } });
  const { trackEvent } = h.load('lib/metaPixel.ts');
  for (const id of [undefined, null, '', '   ', 42]) assert.equal(await trackEvent('Purchase', { value: 4000, currency: 'INR' }, id), false);
});

test('server Purchase cannot be submitted without a usable event ID', async () => {
  const h = configured({}, () => assert.fail('missing-ID event must not be sent'));
  const { sendCapiEvent } = h.load('lib/metaCapi.ts');
  for (const id of [undefined, null, '', '   ', 42]) {
    const result = await sendCapiEvent({ ...purchase, eventId: id });
    assert.equal(result.success, false); assert.match(result.error, /Missing event ID/);
  }
});
