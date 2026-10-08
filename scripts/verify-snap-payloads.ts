/**
 * Offline check of Snap identity normalization + CAPI v3 payload shape.
 * Run: npx tsx scripts/verify-snap-payloads.ts
 * Exits non-zero on any failure. No network calls.
 */
import crypto from 'crypto';
import {
  normalizePhone, normalizeCountry, normalizeState, normalizeZip, normalizeName, normalizeCity,
} from '../lib/tracking/identity-normalize';
import { buildSnapCapiEvent } from '../lib/snap-capi';

let failed = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`}`);
}
const h = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

console.log('— Phone (Snap spec: digits incl. country code, no +, no 00, no trunk 0)');
eq('IN 10-digit, country India', normalizePhone('98765 43210', 'India'), '919876543210');
eq('IN with +91', normalizePhone('+91-98765-43210', 'IN'), '919876543210');
eq('IN 12-digit bare 91…', normalizePhone('919876543210', 'IN'), '919876543210');
eq('IN trunk 0', normalizePhone('09876543210', 'IN'), '919876543210');
eq('UK national 07…', normalizePhone('07700 900123', 'United Kingdom'), '447700900123');
eq('UK +44 (0)', normalizePhone('+44 (0)7700 900123', 'GB'), '447700900123');
eq('Snap doc example', normalizePhone('+44 844 412 4653', 'GB'), '448444124653');
eq('US national', normalizePhone('(415) 555-2671', 'US'), '14155552671');
eq('UAE 00971', normalizePhone('00971 50 123 4567', 'AE'), '971501234567');
eq('UAE national 05…', normalizePhone('050 123 4567', 'United Arab Emirates'), '971501234567');
eq('Australia national', normalizePhone('0412 345 678', 'Australia'), '61412345678');
eq('+ number ignores wrong country', normalizePhone('+14155552671', 'IN'), '14155552671');
eq('no country → India default', normalizePhone('9876543210'), '919876543210');
eq('garbage', normalizePhone('12', 'US'), '');

console.log('— Country (ISO alpha-2 lowercase)');
eq('United Kingdom', normalizeCountry('United Kingdom'), 'gb');
eq('UK', normalizeCountry('UK'), 'gb');
eq('UAE', normalizeCountry('UAE'), 'ae');
eq('United Arab Emirates', normalizeCountry('United Arab Emirates'), 'ae');
eq('Germany', normalizeCountry('Germany'), 'de');
eq('USA', normalizeCountry('U.S.A.'), 'us');
eq('IN', normalizeCountry('IN'), 'in');
eq('unknown', normalizeCountry('Narnia'), '');

console.log('— State / city / zip / names');
eq('US California → ca', normalizeState('California', 'US'), 'ca');
eq('US "NY" → ny', normalizeState('NY', 'United States'), 'ny');
eq('IN Uttar Pradesh', normalizeState('Uttar Pradesh', 'IN'), 'uttarpradesh');
eq('city New York', normalizeCity('New York'), 'newyork');
eq('US ZIP+4', normalizeZip('94105-1234', 'US'), '94105');
eq('UK postcode → sector', normalizeZip('SW1A 1AA', 'GB'), 'sw1a1');
eq('UK postcode M1 1AE', normalizeZip('M1 1AE', 'United Kingdom'), 'm11');
eq('IN pincode', normalizeZip('110 001', 'IN'), '110001');
eq('Canada postal', normalizeZip('K1A 0B1', 'CA'), 'k1a0b1');
eq('accented name kept', normalizeName("Raphaël"), 'raphaël');
eq('punctuation removed', normalizeName("O'Brien-Smith"), 'obriensmith');

console.log('— CAPI v3 PURCHASE payload (UK customer, raw PII)');
const ev = buildSnapCapiEvent({
  eventName: 'PURCHASE',
  eventId: 'ord_123',
  eventTime: 1760000000,
  eventSourceUrl: 'https://zicabella.com/orders/ord_123/confirmation',
  userAgent: 'Mozilla/5.0',
  ipAddress: '81.2.69.142',
  scClickId: 'abc-click',
  scCookie1: 'scid-cookie',
  externalId: 'zb.1234',
  userData: {
    em: ' Jane.Doe@Example.COM ', ph: '07700 900123', fn: 'Jane', ln: 'Doe',
    ct: 'London', st: 'Greater London', zp: 'SW1A 1AA', country: 'United Kingdom',
  },
  customData: {
    value: '89.99', currency: 'gbp', content_ids: ['4123', '4123', '5555'],
    contents: [{ id: '4123', quantity: 2, item_price: 30 }, { id: '5555', quantity: 1, item_price: 29.99 }],
    num_items: 3, order_id: 'ord_123',
  },
});
eq('event_id at root', ev.event_id, 'ord_123');
eq('action_source', ev.action_source, 'WEB');
eq('event_time ms', ev.event_time, Date.now() - 1760000000000 > 7 * 864e5 ? ev.event_time : 1760000000000);
eq('em hashed', ev.user_data.em, [h('jane.doe@example.com')]);
eq('ph hashed (44…)', ev.user_data.ph, [h('447700900123')]);
eq('country hashed gb', ev.user_data.country, [h('gb')]);
eq('zp hashed sector', ev.user_data.zp, [h('sw1a1')]);
eq('st hashed', ev.user_data.st, [h('greaterlondon')]);
eq('external_id hashed', ev.user_data.external_id, [h('zb.1234')]);
eq('sc_click_id raw', ev.user_data.sc_click_id, 'abc-click');
eq('sc_cookie1 raw', ev.user_data.sc_cookie1, 'scid-cookie');
eq('ip raw', ev.user_data.client_ip_address, '81.2.69.142');
eq('no uuid_c1', 'uuid_c1' in ev.user_data, false);
eq('value is float', ev.custom_data.value, 89.99);
eq('currency upper', ev.custom_data.currency, 'GBP');
eq('content_ids deduped', ev.custom_data.content_ids, ['4123', '5555']);
eq('content_type', ev.custom_data.content_type, 'product');
eq('num_items string', ev.custom_data.num_items, '3');
eq('order_id', ev.custom_data.order_id, 'ord_123');
eq('no legacy keys', ['price', 'item_ids', 'transaction_id', 'number_items', 'item_category']
  .filter(k => k in ev.custom_data), []);
eq('no legacy top-level keys', ['event_type', 'timestamp', 'page_url', 'event_conversion_type', 'pixel_id']
  .filter(k => k in ev), []);

console.log('— Already-hashed cookie values pass through unchanged');
const pre = h('919876543210');
const ev2 = buildSnapCapiEvent({
  eventName: 'VIEW_CONTENT', eventId: 'vc_1', eventSourceUrl: 'https://zicabella.com/p',
  userAgent: 'UA', userData: { ph: pre, country: h('in') },
});
eq('hashed ph untouched', ev2.user_data.ph, [pre]);
eq('hashed country untouched', ev2.user_data.country, [h('in')]);

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
