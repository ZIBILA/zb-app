/**
 * The app's product list: cached (instant when warm, one rebuild for many shoppers, last good copy on errors) and
 * trimmed to what product cards need (the product page fetches its own full data).
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/app-list-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test', SHOPIFY_STORE_DOMAIN: 'x.myshopify.com', SHOPIFY_ADMIN_ACCESS_TOKEN: 't' });

let failed = 0, passed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { cachedAppList, clearAppListCache } = await import('../../lib/app-list-cache');
  const { trimProduct, parseFields, parseListParams, listCacheKey } = await import('../../lib/app-products-list');

  console.log('\n— 1. cache');
  let builds = 0;
  const slowBuild = async () => { builds++; await sleep(40); return { products: [{ id: '1' }], n: builds }; };
  const first = await Promise.all(Array.from({ length: 25 }, () => cachedAppList('k1', slowBuild)));
  eq('1a: 25 shoppers at the same moment cause ONE rebuild', builds, 1);
  eq('1b: and all get the same answer', new Set(first.map((r) => r.json)).size, 1);
  const again = await cachedAppList('k1', slowBuild);
  eq('1c: the next request is served from memory (no rebuild)', [again.state, builds], ['hit', 1]);
  const t0 = Date.now(); await cachedAppList('k1', slowBuild);
  check('1d: a cached answer returns immediately', Date.now() - t0 < 15, Date.now() - t0);

  const realNow = Date.now;
  let offset = 0; Date.now = () => realNow() + offset;
  try {
    offset = 2 * 60_000; // 2 minutes later: past "fresh", inside "stale"
    const stale = await cachedAppList('k1', slowBuild);
    eq('1e: a stale copy is served at once while it is rebuilt in the background', stale.state, 'stale');
    await sleep(120);
    eq('1f: …and the background rebuild ran once', builds, 2);
    const fresh = await cachedAppList('k1', slowBuild);
    eq('1g: the rebuilt copy is used afterwards', [fresh.state, JSON.parse(fresh.json).n], ['hit', 2]);

    offset = 30 * 60_000; // far too old
    const failing = async () => { builds++; throw new Error('Shopify 503'); };
    const kept = await cachedAppList('k1', failing);
    eq('1h: Shopify failing → the last good copy is still served (not an empty home screen)', [kept.state, JSON.parse(kept.json).n], ['stale', 2]);
    let threw = false; try { await cachedAppList('never-built', failing); } catch { threw = true; }
    check('1i: nothing cached and Shopify failing → the error is reported (and not cached)', threw);
    const ok = await cachedAppList('never-built', async () => ({ products: [], n: 99 }));
    eq('1j: the failure was not remembered', JSON.parse(ok.json).n, 99);
  } finally { Date.now = realNow; offset = 0; }

  clearAppListCache();
  const before = builds;
  await cachedAppList('k1', slowBuild);
  eq('1k: a catalogue change (cache clear) forces a fresh build', builds, before + 1);

  console.log('\n— 2. what a product card needs stays, the page-only weight goes');
  const heavy = 'x'.repeat(8000);
  const product: any = {
    id: 'gid://shopify/Product/1', title: 'RELIC', handle: 'relic', productType: 'Denim', availableForSale: true,
    featuredImage: 'https://cdn/a.jpg', images: Array.from({ length: 12 }, (_, i) => `https://cdn/${i}.jpg`),
    price: '2449', compareAtPrice: '3499', isSoldOut: false, isOnSale: true,
    variants: [{ id: 'v1', title: 'M', availableForSale: true, quantityAvailable: 3, price: '2449', compareAtPrice: '3499', size: 'M', color: null }],
    description: heavy, descriptionHtml: `<p>${heavy}</p>`, details: heavy, care: heavy, sizeChart: heavy,
    allMedia: Array.from({ length: 12 }, (_, i) => ({ type: 'IMAGE', url: `https://cdn/${i}.jpg`, alt: heavy.slice(0, 200) })),
    productVideo: 'https://cdn/v.mp4', modelInfo: heavy.slice(0, 100),
  };
  const LIST = parseFields('id,title,handle,priceRange,featuredImage');
  const slim: any = trimProduct(product, LIST);
  eq('2a: card fields kept (title, handle, images, price, sale, variants for quick-add)', ['id', 'title', 'handle', 'featuredImage', 'images', 'price', 'compareAtPrice', 'isSoldOut', 'isOnSale', 'variants', 'availableForSale'].every((k) => k in slim), true);
  eq('2b: page-only fields dropped', ['description', 'descriptionHtml', 'details', 'care', 'sizeChart', 'allMedia', 'productVideo', 'modelInfo'].some((k) => k in slim), false);
  eq('2c: the images and variants are untouched', [slim.images.length, slim.variants.length], [12, 1]);
  const ratio = JSON.stringify(slim).length / JSON.stringify(product).length;
  check(`2d: the list is much smaller (${Math.round((1 - ratio) * 100)}% fewer bytes)`, ratio < 0.5, ratio);
  eq('2e: a request that names those fields still gets them (the product page)', Object.keys(trimProduct(product, parseFields('id,description,details,media'))).filter((k) => ['description', 'details', 'allMedia', 'care'].includes(k)).sort(), ['allMedia', 'description', 'details']);
  eq('2f: no `fields` at all → the full product, as before (other clients)', trimProduct(product, null) === product, true);

  console.log('\n— 3. cache keys');
  const keyOf = (qs: string) => listCacheKey(parseListParams(new URL(`https://x/api/app/products?${qs}`)));
  eq('3a: limit 50 and limit 100 are the same request (both return the whole catalogue)', keyOf('limit=50&fields=a,b') === keyOf('limit=100&fields=a,b'), true);
  eq('3b: field order does not matter', keyOf('limit=50&fields=a,b') === keyOf('limit=50&fields=b,a'), true);
  eq('3c: a different field list is a different entry', keyOf('limit=50&fields=a') === keyOf('limit=50&fields=a,b'), false);
  eq('3d: collections with different handles or limits do not share an entry', new Set([keyOf('collection=x&limit=24'), keyOf('collection=y&limit=24'), keyOf('collection=x&limit=48')]).size, 3);
  eq('3e: the homepage list (no collection, small limit) is separate from the whole catalogue', keyOf('limit=24') === keyOf('limit=50'), false);

  console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
