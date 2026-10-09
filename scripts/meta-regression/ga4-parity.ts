/**
 * GA4 parity: the GA4 ecommerce events must be identical to main's (same payloads
 * for the same call-site inputs), and Meta calls made with { ga: false } must emit
 * no GA4 event.
 *
 *   git show de26733:hooks/useMetaEvents.ts > scripts/meta-regression/.main-hook.tmp.ts
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/meta-regression/ga4-parity.ts
 *   rm scripts/meta-regression/.main-hook.tmp.ts
 */
const ga: any[] = [];
(globalThis as any).window = globalThis;
(globalThis as any).gtag = (_e: string, name: string, params: any) => ga.push([name, params]);
(globalThis as any).fbq = () => {};
(globalThis as any).navigator = { userAgent: 'test' };
(globalThis as any).document = { cookie: '', title: 't', location: { href: 'https://zicabella.com/' } };
(globalThis as any).location = { href: 'https://zicabella.com/', hostname: 'zicabella.com', search: '' };
(globalThis as any).fetch = async () => new Response('{}');
(globalThis as any).localStorage = (globalThis as any).sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
let fails = 0;
const cmp = (n: string, a: any, b: any) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  GA4 ${n} identical to main`, ok ? '' : `\n main:   ${JSON.stringify(a)}\n branch: ${JSON.stringify(b)}`); };
const take = (fn: () => void) => { ga.length = 0; fn(); return ga.splice(0).filter(e => !['view_item'].includes(e[0])); };
(async () => {
  const mainHook = process.env.MAIN_HOOK || `${__dirname}/.main-hook.tmp.ts`;
  const M = (await import(mainHook)).useMetaEvents();
  const B = await import('../../hooks/useMetaEvents');
  const b = B.useMetaEvents();
  const items = [{ productId: '10227656982810', price: '1499', quantity: 2, title: 'DENIM', category: 'Denim' }, { productId: '10227656982811', price: '799', quantity: 1, title: 'TEE', category: undefined }];
  const ids = items.map(i => i.productId);
  const ckContents = items.map(i => ({ id: i.productId, quantity: i.quantity, item_price: parseFloat(i.price), title: i.title, category: i.category }));
  const apiContents = items.map(i => ({ id: i.productId, quantity: i.quantity, item_price: parseFloat(i.price) }));
  cmp('begin_checkout', take(() => M.trackInitiateCheckout(3797, items.length, 'INR', 'Denim', ids, undefined, ckContents)),
    take(() => B.ga4BeginCheckout(3797, 'INR', 'Denim', ids, ckContents)));
  cmp('add_payment_info', take(() => M.trackAddPaymentInfo({}, 3797, 'INR', ids, apiContents)),
    take(() => B.ga4AddPaymentInfo(3797, 'INR', ids, apiContents)));
  const pContents = [{ id: '51813148262681', quantity: 2, item_price: 1499, title: 'DENIM' }, { id: '51813148328217', quantity: 1, item_price: 0, title: 'FREE' }];
  cmp('purchase', take(() => M.trackPurchase('ord_1', 3797, 'USD', pContents.map(c => c.id), undefined, 'Denim', pContents)),
    take(() => B.ga4Purchase('ord_1', 3797, 'USD', pContents.map(c => c.id), 'Denim', pContents)));
  cmp('add_to_wishlist', take(() => M.trackAddToWishlist('10227656982810', 'DENIM', 'Denim')),
    take(() => B.ga4AddToWishlist('10227656982810', 'DENIM', 'Denim')));
  cmp('add_to_cart (default path, e.g. product page / quick add)', take(() => M.trackAddToCart('51813148262681', 'DENIM', 1499, 'INR', 'Denim')),
    (await new Promise(r => setTimeout(r, 1100)), take(() => b.trackAddToCart('51813148262681', 'DENIM', 1499, 'INR', 'Denim'))));
  await new Promise(r => setTimeout(r, 1100));
  const off = take(() => {
    b.trackAddToCart('51813148262682', 'X', 1, 'INR', 'D', { ga: false });
    b.trackAddToWishlist('51813148262682', 'X', 'D', 1, 'INR', { ga: false });
    b.trackAddPaymentInfo({}, 1, 'INR', ['1'], undefined, { ga: false });
    b.trackInitiateCheckout(5, 1, 'INR', 'D', ['1'], undefined, undefined, { ga: false });
    b.trackPurchase('ord_2', 5, 'INR', ['1'], undefined, 'D', undefined, { ga: false });
  });
  cmp('Meta calls with { ga: false } emit no GA4 events', [], off);
  console.log(fails ? `${fails} FAILED` : 'GA4 parity: all identical to main');
  process.exit(fails ? 1 : 0);
})();
