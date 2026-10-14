/**
 * One Meta InitiateCheckout per checkout attempt (lib/meta/initiate-checkout.ts +
 * hooks/useMetaEvents.ts): the guest→login remount of /checkout must not fire a
 * second IC for the same cart; a changed cart, a new tab, or 30 minutes later is
 * a new attempt. GA4 begin_checkout keeps firing exactly as on main.
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-initiate-checkout.ts
 */
process.env.NEXT_PUBLIC_META_PIXEL_ID = '2049977412558608';

const fbqCalls: any[] = [];
const ga: any[] = [];
const relay: any[] = [];
const storeData = new Map<string, string>();
const fakeSession = { getItem: (k: string) => storeData.get(k) ?? null, setItem: (k: string, v: string) => { storeData.set(k, v); }, removeItem: (k: string) => { storeData.delete(k); } };
(globalThis as any).window = globalThis;
(globalThis as any).gtag = (_e: string, name: string, params: any) => ga.push([name, params]);
(globalThis as any).fbq = (...a: any[]) => fbqCalls.push(a);
(globalThis as any).navigator = { userAgent: 'test' };
(globalThis as any).document = { cookie: 'zb_external_id=zb.test', title: 't', location: { href: 'https://zicabella.com/checkout' } };
(globalThis as any).location = { href: 'https://zicabella.com/checkout', hostname: 'zicabella.com', search: '' };
(globalThis as any).fetch = async (_url: string, init: any) => { relay.push(JSON.parse(init.body)); return new Response('{"success":true}'); };
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
(globalThis as any).sessionStorage = fakeSession;

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const icCalls = () => fbqCalls.filter(c => c[0] === 'track' && c[1] === 'InitiateCheckout');

async function main() {
  const { claimInitiateCheckout, initiateCheckoutCartKey, META_IC_MARKER_TTL_MS } = await import('../lib/meta/initiate-checkout');

  // ── pure claim logic ──
  const store = new Map<string, string>();
  const mem = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const key = initiateCheckoutCartKey([{ id: 'b', quantity: 1 }, { id: 'a', quantity: 2 }]);
  check('cart key is order-independent and unit-aware', key === 'a:2|b:1' && key === initiateCheckoutCartKey([{ id: 'a', quantity: 2 }, { id: 'b' }]), key);
  const t0 = 1_760_000_000_000;
  const first = claimInitiateCheckout(key, 'ev-1', { nowMs: t0, store: mem });
  check('first attempt fires', first.fire && first.eventId === 'ev-1');
  const again = claimInitiateCheckout(key, 'ev-2', { nowMs: t0 + 60_000, store: mem });
  check('remount (same cart, 1 min later) does not fire; returns the stored event id', !again.fire && again.eventId === 'ev-1');
  const other = claimInitiateCheckout(initiateCheckoutCartKey([{ id: 'a', quantity: 3 }]), 'ev-3', { nowMs: t0 + 60_000, store: mem });
  check('changed cart fires again', other.fire && other.eventId === 'ev-3');
  const late = claimInitiateCheckout(initiateCheckoutCartKey([{ id: 'a', quantity: 3 }]), 'ev-4', { nowMs: t0 + 60_000 + META_IC_MARKER_TTL_MS + 1, store: mem });
  check('after 30 minutes the same cart is a new attempt', late.fire && late.eventId === 'ev-4');
  const corrupt = { getItem: () => '{not json', setItem: () => {} };
  check('corrupt marker → fires', claimInitiateCheckout(key, 'ev-5', { nowMs: t0, store: corrupt }).fire);
  check('no storage (SSR / blocked) → fires', claimInitiateCheckout(key, 'ev-6', { nowMs: t0, store: null }).fire);

  // ── through the hook (what the checkout page calls) ──
  const { useMetaEvents } = await import('../hooks/useMetaEvents');
  const contents = [{ id: '51813148262681', quantity: 2, item_price: 1499, title: 'DENIM', category: 'Denim' }, { id: '51813148328217', quantity: 1, item_price: 799, title: 'TEE' }];
  const ids = contents.map(c => c.id);

  // guest render
  useMetaEvents().trackInitiateCheckout(3797, 3, 'INR', 'Denim', ids, undefined, contents);
  await sleep(1100); // past the in-memory 1 s dedup → only the marker can stop the second fire
  // remount after login: a NEW hook instance (fresh React state), same cart
  useMetaEvents().trackInitiateCheckout(3797, 3, 'INR', 'Denim', ids, { em: 'a@b.co' }, contents);
  check('hook: guest render + post-login remount → one Pixel InitiateCheckout', icCalls().length === 1, icCalls().length);
  check('hook: one CAPI relay for InitiateCheckout', relay.filter(r => r.eventName === 'InitiateCheckout').length === 1);
  check('hook: GA4 begin_checkout still fires on both renders (unchanged from main)', ga.filter(e => e[0] === 'begin_checkout').length === 2, ga.length);
  check('hook: Pixel contents carry only id / quantity / item_price', icCalls()[0][2].contents.every((c: any) => Object.keys(c).sort().join() === 'id,item_price,quantity'), icCalls()[0][2].contents);

  // cart changed → fires again
  await sleep(1100);
  useMetaEvents().trackInitiateCheckout(1499, 1, 'INR', 'Denim', ['51813148262681'], undefined, [{ id: '51813148262681', quantity: 1, item_price: 1499 }]);
  check('hook: a different cart fires a new InitiateCheckout', icCalls().length === 2);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
