/**
 * Meta Pixel + CAPI regression capture. Runs the REAL Meta code of the tree it
 * lives in (lib/metaPixel, components/MetaPixelRouteTracker, hooks/useMetaEvents,
 * app/api/meta/event → lib/metaCapi) in jsdom with deterministic ids/time, and
 * prints every fbq call, every browser→/api/meta/event body and every Graph API
 * payload as JSON. compare.ts diffs the output of `main` vs the branch.
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/meta-regression/run.tsx out.json
 */
import { JSDOM } from 'jsdom';

// ── determinism ──
let seed = 42;
Math.random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const FIXED_NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
let clock = FIXED_NOW;
Date.now = () => clock; // frozen within a phase; advanced explicitly between phases

process.env.META_CAPI_ACCESS_TOKEN = 'EAA' + 'B'.repeat(180);
process.env.META_PIXEL_ID = '2049977412558608';
process.env.NEXT_PUBLIC_META_PIXEL_ID = '2049977412558608';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://zicabella.com/' });
const g: any = globalThis;
g.window = dom.window; g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' }, configurable: true });
Object.defineProperty(dom.window, 'crypto', { value: globalThis.crypto, configurable: true });
g.sessionStorage = dom.window.sessionStorage; g.localStorage = dom.window.localStorage;
g.IS_REACT_ACT_ENVIRONMENT = true;

const out: Record<string, any> = {};
let fbqCalls: any[] = [], relay: any[] = [], graph: any[] = [];
g.window.fbq = (...a: any[]) => fbqCalls.push(a);
g.fbq = g.window.fbq;
let uuidN = 0;
(globalThis.crypto as any).randomUUID = () => `00000000-0000-4000-8000-${String(++uuidN).padStart(12, '0')}`;
g.fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  const body = opt.body && typeof opt.body === 'string' ? (() => { try { return JSON.parse(opt.body); } catch { return opt.body; } })() : opt.body;
  if (u === '/api/meta/event') {
    // End-to-end: the browser request goes through the REAL route handler of this tree.
    relay.push(body);
    const res = await (g.__metaRoute as any).POST(new (g.__NextRequest as any)('https://zicabella.com/api/meta/event', {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', cookie: document.cookie, 'x-forwarded-for': '81.2.69.142', 'user-agent': 'UA-test' },
    }));
    const json = await res.json();
    return { ok: res.status < 400, status: res.status, json: async () => json };
  }
  if (u.includes('graph.facebook.com')) { graph.push(body); return { ok: true, status: 200, json: async () => ({ events_received: 1 }), text: async () => '{"events_received":1}', headers: new Map() }; }
  if (u === '/api/customers/me/default-address') {
    const p = (g.__person || {}) as any;
    return { ok: true, status: 200, json: async () => ({ city: p.city, state: p.state, zip: p.zip, country: p.country }) };
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
};

const clearCookies = () => { for (const c of document.cookie.split(';')) { const n = c.split('=')[0].trim(); if (n) document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`; } };
const cookies = () => Object.fromEntries(document.cookie.split(';').map(c => c.trim()).filter(Boolean).map(c => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]).sort());
const settle = async () => { for (let i = 0; i < 300; i++) await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, 50)); for (let i = 0; i < 300; i++) await new Promise(r => setImmediate(r)); };

// sessionPhone = how OTP login stores the number (country dial code + national number).
const PEOPLE = {
  IN: { sessionPhone: '+919876543210', email: 'Aarav.Mehta@Example.com', phone: '98765 43210', name: 'Aarav Mehta', city: 'Noida', state: 'Uttar Pradesh', zip: '201304', country: 'India', countryCode: 'IN' },
  UK: { sessionPhone: '+447700900123', email: 'jane.doe@example.co.uk', phone: '07700 900123', name: 'Jane Doe', city: 'London', state: 'Greater London', zip: 'SW1A 1AA', country: 'United Kingdom', countryCode: 'GB' },
  US: { sessionPhone: '+14155552671', email: 'john@example.com', phone: '(415) 555-2671', name: 'John Smith', city: 'San Francisco', state: 'California', zip: '94105-1234', country: 'United States', countryCode: 'US' },
  AE: { sessionPhone: '+971501234567', email: 'aisha@example.ae', phone: '050 123 4567', name: 'Aisha Khan', city: 'Dubai', state: 'Dubai', zip: '00000', country: 'United Arab Emirates', countryCode: 'AE' },
} as const;

async function main() {
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { state } = await import('./mocks');
  const metaPixel: any = await import('../../lib/metaPixel');
  const { useMetaEvents } = await import('../../hooks/useMetaEvents');
  const { default: Tracker } = await import('../../components/MetaPixelRouteTracker') as any;
  const MetaRoute = await import('../../app/api/meta/event/route');
  const { NextRequest } = await import('next/server');
  g.__metaRoute = MetaRoute; g.__NextRequest = NextRequest;

  // One scenario per process (module-level caches in the tracker must not leak between people).
  const only = process.env.SCENARIO;
  for (const [cc, p] of Object.entries(PEOPLE)) {
    for (const loggedIn of [false, true]) {
      const key = `${cc}_${loggedIn ? 'logged_in' : 'guest'}`;
      if (only && only !== key) continue;
      g.__person = p;
      clearCookies(); fbqCalls = []; relay = []; graph = []; seed = 42; uuidN = 0;
      clock += 3_600_000; // monotonic: dedup windows from the previous scenario have expired
      dom.window.sessionStorage.clear(); dom.window.localStorage.clear();
      document.cookie = 'zb_external_id=zb.fixed-external-id; path=/';
      document.cookie = '_fbp=fb.1.1700000000000.123456789; path=/';

      // 1) Checkout address entered → identity cookies (Meta advanced matching)
      await metaPixel.saveUserDataToCookies({ email: p.email, phone: p.phone, name: p.name, city: p.city, state: p.state, zip: p.zip, country: p.country });
      const cookiesAfterAddress = cookies();

      clock += 60_000;
      // 2) PageView via the real route tracker component
      state.pathname = '/'; state.status = loggedIn ? 'authenticated' : 'unauthenticated';
      state.session = loggedIn ? { user: { id: 'cust_1', email: p.email, name: p.name, phone: p.sessionPhone } } : null;
      const root = createRoot(document.getElementById('root')!);
      await act(async () => { root.render(React.createElement(Tracker)); });
      await settle();
      const pageView = { fbq: fbqCalls.slice(), relay: relay.slice(), graph: graph.map(x => x?.data?.[0] ?? x) };

      clock += 60_000;
      // 3) AddToCart + 4) Purchase through the real hooks
      fbqCalls = []; graph = []; const relayBefore = relay.length;
      const meta = useMetaEvents();
      meta.trackAddToCart('51813148262681', 'AEROLAYER HALF DENIM', 1499, 'INR', 'Denim');
      await settle();
      const atc = { fbq: fbqCalls.slice(), relay: relay.slice(relayBefore), graph: graph.map(x => x?.data?.[0] ?? x) };
      fbqCalls = []; graph = []; const relayBefore2 = relay.length;
      clock += 60_000;
      const userData = { country: p.country, st: p.state, ct: p.city, zp: p.zip, fn: p.name.split(' ')[0], ln: p.name.split(' ')[1], em: p.email, ph: p.phone };
      meta.trackPurchase(`ord_${key}`, 3797, 'INR', ['51813148262681', '51813148328217'], userData, 'Denim',
        [{ id: '51813148262681', quantity: 2, item_price: 1499, title: 'A' }, { id: '51813148328217', quantity: 1, item_price: 799, title: 'B' }]);
      await settle();
      const purchase = { fbq: fbqCalls.slice(), relay: relay.slice(relayBefore2), graph: graph.map(x => x?.data?.[0] ?? x) };
      await act(async () => { root.unmount(); });

      out[key] = { cookiesAfterAddress, pageView, atc, purchase };
    }
  }
  (await import('fs')).writeFileSync(process.argv[2] || 'meta-regression-out.json', JSON.stringify(out, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
