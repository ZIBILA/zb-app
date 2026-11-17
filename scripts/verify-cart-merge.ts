/**
 * One cart line / one catalogue id per variant (live 2026-11-02: RELIC RUINFRAME DENIM size 30,
 * variant 52789131870489, sat on two cart lines and went to Meta InitiateCheckout / AddPaymentInfo
 * and Snap START_CHECKOUT / ADD_BILLING as a repeated id with two contents entries):
 *  - metaCartPayload (hooks/useMetaEvents.ts) and snapCartPayload (hooks/useSnapEvents.ts) merge
 *    lines by normalized variant id: one contents entry per id, quantity summed, ids unique in
 *    first-seen order, the first line's unit price kept, lines with no provable variant id left out;
 *  - the cart (lib/cart-merge.ts, lib/cart-restore.ts) collapses duplicate-variant lines within one
 *    cart (sum) and never double counts a line present in two copies of it (max).
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-cart-merge.ts
 *
 * Pure functions only; nothing is sent and no database is touched.
 */
process.env.NEXT_PUBLIC_META_PIXEL_ID = '2049977412558608';

let pass = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok) pass++;
  else { failed++; console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

(async () => {
  const { metaCartPayload } = await import('../hooks/useMetaEvents');
  const { snapCartPayload } = await import('../hooks/useSnapEvents');
  const { META_INR } = await import('../lib/meta/money');
  const { cartLineKey, collapseVariantLines } = await import('../lib/cart-merge');
  const { dedupeLines, mergeCartCopies, decideCartRestore, EMPTY_META } = await import('../lib/cart-restore');

  const DENIM = '52789131870489';
  const TANK = '51747537617177';

  console.log('— 1. metaCartPayload (Meta InitiateCheckout / AddPaymentInfo)');
  const metaDup = metaCartPayload([
    { variantId: DENIM, quantity: 1, price: '1162', title: 'RELIC RUINFRAME DENIM', category: 'Denim' },
    { variantId: DENIM, quantity: 1, price: '1162', title: 'RELIC RUINFRAME DENIM', category: 'Denim' },
  ]);
  eq('same variant on two lines → one id', metaDup.ids, [DENIM]);
  eq('…one contents entry, quantity 2, first line\'s price / title / category', metaDup.contents, [{ id: DENIM, quantity: 2, item_price: 1162, title: 'RELIC RUINFRAME DENIM', category: 'Denim' }]);
  eq('…numItems 2 (units, not lines)', metaDup.numItems, 2);

  const metaMix = metaCartPayload([
    { variantId: TANK, quantity: 1, price: 1046, title: 'DUSTBURN DRIFT TANK' },
    { variantId: `gid://shopify/ProductVariant/${DENIM}`, quantity: 2, price: '1162', title: 'FIRST DENIM LINE', category: 'Denim' },
    { variantId: `variant:${TANK}`, quantity: 1, price: 999, title: 'LATER TANK LINE' },
    { variantId: DENIM, quantity: 1, price: '1200', title: 'SECOND DENIM LINE' },
  ]);
  eq('ids unique, first-seen order, GID / "variant:" spellings merged with the numeric id', metaMix.ids, [TANK, DENIM]);
  eq('quantities summed per id; price / title / category are the FIRST merged line\'s',
    metaMix.contents, [
      { id: TANK, quantity: 2, item_price: 1046, title: 'DUSTBURN DRIFT TANK' },
      { id: DENIM, quantity: 3, item_price: 1162, title: 'FIRST DENIM LINE', category: 'Denim' },
    ]);
  eq('numItems = total units', metaMix.numItems, 5);

  const metaUnknown = metaCartPayload([
    { variantId: DENIM, quantity: 1, price: '1162' },
    { variantId: undefined, quantity: 3, price: '500' },
    { variantId: '10227656982809-not-a-variant', quantity: 4, price: '500' },
    { variantId: '', quantity: 2, price: '500' },
  ]);
  eq('lines without a provable variant id stay excluded (ids, contents and numItems)', [metaUnknown.ids, metaUnknown.contents.length, metaUnknown.numItems], [[DENIM], 1, 1]);
  eq('a single clean line is unchanged', metaCartPayload([{ variantId: TANK, quantity: 1, price: '1046', title: 'T' }]).contents, [{ id: TANK, quantity: 1, item_price: 1046, title: 'T' }]);
  eq('quantity 0 / missing still counts as 1 per line, then sums', metaCartPayload([{ variantId: TANK, quantity: 0 }, { variantId: TANK }]).numItems, 2);
  eq('display-currency conversion applies to the merged line\'s first price only',
    metaCartPayload([{ variantId: TANK, quantity: 1, price: 100 }, { variantId: TANK, quantity: 1, price: 900 }], { ...META_INR, amount: (n: number) => n * 2 }).contents[0].item_price, 200);
  eq('empty cart', metaCartPayload([]), { ids: [], contents: [], numItems: 0 });

  console.log('\n— 2. snapCartPayload (Snap START_CHECKOUT / ADD_BILLING)');
  const snapDup = snapCartPayload([
    { variantId: DENIM, productId: '10227656982809', quantity: 1, price: '1162' },
    { variantId: DENIM, productId: '10227656982809', quantity: 1, price: '1162' },
  ]);
  eq('same variant on two lines → one id', snapDup.ids, [DENIM]);
  eq('…one contents entry, quantity 2, price kept', snapDup.contents, [{ id: DENIM, quantity: 2, item_price: 1162 }]);
  eq('…numItems 2', snapDup.numItems, 2);

  const snapMix = snapCartPayload([
    { variantId: TANK, quantity: 1, price: '1046' },
    { variantId: `gid://shopify/ProductVariant/${DENIM}`, quantity: 2, price: '1162' },
    { variantId: `variant:${TANK}`, quantity: 1, price: '999' },
    { variantId: DENIM, quantity: 1, price: '1200' },
  ]);
  eq('ids unique, first-seen order', snapMix.ids, [TANK, DENIM]);
  eq('quantities summed, first line\'s unit price kept', snapMix.contents, [{ id: TANK, quantity: 2, item_price: 1046 }, { id: DENIM, quantity: 3, item_price: 1162 }]);
  eq('numItems = total units', snapMix.numItems, 5);
  const snapUnknown = snapCartPayload([{ variantId: DENIM, quantity: 1, price: '1162' }, { variantId: undefined, quantity: 3 }, { variantId: 'nope', quantity: 4 }]);
  eq('lines without a provable variant id stay excluded', [snapUnknown.ids, snapUnknown.numItems], [[DENIM], 1]);
  eq('empty cart', snapCartPayload([]), { ids: [], contents: [], numItems: 0 });

  console.log('\n— 3. cart lines: collapseVariantLines (one cart, duplicates are separate adds → sum)');
  type L = { id: string; productId: string; variantId: string; size: string | null; price: string; quantity: number };
  const line = (o: Partial<L>): L => ({ id: `P1_${o.variantId ?? DENIM}_${o.size ?? '30'}`, productId: 'P1', variantId: DENIM, size: '30', price: '1162', quantity: 1, ...o });
  eq('line key: variant id, any spelling', [cartLineKey({ variantId: DENIM }), cartLineKey({ variantId: `gid://shopify/ProductVariant/${DENIM}` }), cartLineKey({ variantId: `variant:${DENIM}` })], Array(3).fill(`variant:${DENIM}`));
  eq('line key: no variant → the line id; neither → null', [cartLineKey({ id: 'P9__one-size', variantId: '' }), cartLineKey({ variantId: '' }), cartLineKey(null)], ['line:P9__one-size', null, null]);

  const twice = [line({}), line({ id: 'P1_52789131870489_one-size', size: null })]; // same variant, size spelled differently
  const healed = collapseVariantLines(twice);
  eq('same variant, different size spelling → one line, quantity 2', healed.map(l => [l.id, l.variantId, l.quantity]), [[twice[0].id, DENIM, 2]]);
  eq('…the first line keeps its id, size and price', [healed[0].id, healed[0].size, healed[0].price], [twice[0].id, '30', '1162']);
  eq('…the input is not mutated', twice.map(l => l.quantity), [1, 1]);

  const three = collapseVariantLines([line({ quantity: 2 }), line({ variantId: TANK, size: 'M', price: '1046' }), line({ quantity: 3, variantId: `gid://shopify/ProductVariant/${DENIM}` })]);
  eq('quantities summed, order kept, other variants untouched', three.map(l => [l.variantId, l.quantity]), [[DENIM, 5], [TANK, 1]]);
  const clean = [line({}), line({ variantId: TANK, size: 'M' })];
  eq('a clean cart comes back as the same array', collapseVariantLines(clean) === clean, true);
  eq('lines with no variant id merge only on an identical line id',
    collapseVariantLines([line({ id: 'X', variantId: '' }), line({ id: 'Y', variantId: '' }), line({ id: 'X', variantId: '', quantity: 2 })]).map(l => [l.id, l.quantity]), [['X', 3], ['Y', 1]]);
  eq('empty / single-line carts', [collapseVariantLines([]), collapseVariantLines([line({})]).length], [[], 1]);

  console.log('\n— 4. cart lines across two copies (this device + account): max, never summed');
  eq('dedupeLines: same variant in both copies → the larger quantity', dedupeLines([line({ quantity: 2 }), line({ quantity: 1, id: 'other-spelling' })]).map(l => l.quantity), [2]);
  const merged = mergeCartCopies([line({}), line({ id: 'dup', size: null })], [line({ quantity: 2 }), line({ variantId: TANK, size: 'M', price: '1046' })]);
  eq('mergeCartCopies: duplicates inside one copy summed (1+1=2), then max with the other copy (2) → 2, not 4', merged.map(l => [l.variantId, l.quantity]), [[DENIM, 2], [TANK, 1]]);

  const local = [line({}), line({ id: 'dup', size: null })];
  const db = [line({ quantity: 1 })];
  const login = decideCartRestore({ meta: { ...EMPTY_META, owner: 'guest' }, localItems: local, dbItems: db, dbUpdatedAt: null, userKey: 'u1', requestStartedAt: 1 });
  eq('login merge heals a duplicated guest cart', login.action === 'replace' ? login.items.map(l => [l.variantId, l.quantity]) : login.action, [[DENIM, 2]]);
  const sameUser = decideCartRestore({ meta: { ...EMPTY_META, owner: 'u1', syncedServerAt: '2026-11-01T00:00:00Z' }, localItems: [], dbItems: [line({ quantity: 1 }), line({ id: 'dup', size: null, quantity: 1 })], dbUpdatedAt: '2026-11-02T00:00:00Z', userKey: 'u1', requestStartedAt: 1 });
  eq('a newer DB copy holding the variant twice is adopted as one line', sameUser.action === 'replace' ? sameUser.items.map(l => [l.variantId, l.quantity]) : sameUser.action, [[DENIM, 2]]);

  console.log(failed ? `\n${failed} FAILED (${pass} passed)` : `\nALL PASSED (${pass})`);
  process.exit(failed ? 1 : 0);
})();
