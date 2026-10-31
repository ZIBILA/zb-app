// Fake Shopify Admin API for the catalogue-route regression test (scripts/catalog-cache-test/run.sh).
// HTTPS with a self-signed cert, a 4-product / 2-collection fixture catalogue (one product carries a
// GID metafield, one is a draft), switches: /__control?mode=ok|fail|slow, ?title=<handle>:<title>, ?log=1, ?reset=1.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const dir = process.env.FAKE_CERT_DIR || __dirname;
const key = fs.readFileSync(path.join(dir, 'key.pem'));
const cert = fs.readFileSync(path.join(dir, 'cert.pem'));
const CDN = 'https://cdn.shopify.com/s/files/1/0955/5394/5881/files/';
const img = (name, id) => ({ id, src: CDN + name });

let mode = 'ok';
const log = [];
const now = '2026-10-01T00:00:00+05:30';
const products = [
  { id: 1001, title: 'Alpha Tee', handle: 'alpha-tee', body_html: '<p>Alpha description text</p>', status: 'active', created_at: now, updated_at: now, published_at: now, product_type: 'T-Shirt', vendor: 'Zica Bella', tags: 'tee, alpha',
    image: img('relic-ruinframe-denim-washed-black-male-front.jpg?v=1786639115', 7001),
    images: [img('relic-ruinframe-denim-washed-black-male-front.jpg?v=1786639115', 7001), img('relic-ruinframe-denim-front-patch-detail.jpg?v=1786639745', 7002)],
    variants: [ { id: 5001, title: 'S', price: '1999.00', compare_at_price: '2999.00', sku: 'A-S', barcode: null, inventory_item_id: 9001, inventory_quantity: 5, inventory_management: 'shopify', option1: 'S', option2: null, option3: null },
                { id: 5002, title: 'M', price: '1999.00', compare_at_price: '2999.00', sku: 'A-M', barcode: null, inventory_item_id: 9002, inventory_quantity: 0, inventory_management: 'shopify', option1: 'M', option2: null, option3: null } ],
    options: [{ id: 1, product_id: 1001, name: 'Size', position: 1, values: ['S', 'M'] }] },
  { id: 1002, title: 'Beta Denim', handle: 'beta-denim', body_html: '<p>Beta description text</p>', status: 'active', created_at: now, updated_at: now, published_at: now, product_type: 'Jeans', vendor: 'Zica Bella', tags: 'denim, beta',
    image: img('zica-bella-monolith-portrait-shirt-front.jpg?v=1787678058', 7003),
    images: [img('zica-bella-monolith-portrait-shirt-front.jpg?v=1787678058', 7003)],
    variants: [ { id: 5003, title: '28', price: '4499.00', compare_at_price: null, sku: 'B-28', barcode: null, inventory_item_id: 9003, inventory_quantity: 3, inventory_management: 'shopify', option1: '28', option2: null, option3: null },
                { id: 5004, title: '30', price: '4499.00', compare_at_price: null, sku: 'B-30', barcode: null, inventory_item_id: 9004, inventory_quantity: 2, inventory_management: 'shopify', option1: '30', option2: null, option3: null } ],
    options: [{ id: 2, product_id: 1002, name: 'Size', position: 1, values: ['28', '30'] }] },
  { id: 1003, title: 'Gamma Hoodie', handle: 'gamma-hoodie', body_html: '<p>Gamma description text</p>', status: 'active', created_at: now, updated_at: now, published_at: now, product_type: 'Hoodie', vendor: 'Zica Bella', tags: 'hoodie, gamma',
    image: img('the-watcher-100-cotton-graphic-tshirt-front.jpg?v=1788883436', 7004),
    images: [img('the-watcher-100-cotton-graphic-tshirt-front.jpg?v=1788883436', 7004)],
    variants: [ { id: 5005, title: 'L', price: '3499.00', compare_at_price: null, sku: 'G-L', barcode: null, inventory_item_id: 9005, inventory_quantity: 1, inventory_management: 'shopify', option1: 'L', option2: null, option3: null } ],
    options: [{ id: 3, product_id: 1003, name: 'Size', position: 1, values: ['L'] }] },
  { id: 1004, title: 'Delta Draft', handle: 'delta-draft', body_html: '<p>draft</p>', status: 'draft', created_at: now, updated_at: now, published_at: null, product_type: 'T-Shirt', vendor: 'Zica Bella', tags: '',
    image: null, images: [], variants: [ { id: 5006, title: 'S', price: '999.00', compare_at_price: null, sku: 'D-S', barcode: null, inventory_item_id: 9006, inventory_quantity: 9, inventory_management: 'shopify', option1: 'S', option2: null, option3: null } ], options: [] },
];
const collections = [
  { id: 2001, title: 'New Arrivals', handle: 'new-arrivals', updated_at: now, body_html: 'Fresh drops', image: { src: CDN + 'ZICABELLA_LEATHER_JACKET.jpg?v=1793282523' }, published_at: now },
  { id: 2002, title: 'Denims', handle: 'denims', updated_at: now, body_html: 'All denim', image: { src: CDN + 'heavyweight-vintage-brown-denim-jeans-front.jpg?v=1784125480' }, published_at: now },
];
const collects = { 2001: [1001, 1002], 2002: [1002, 1003] };

function json(res, status, body, extraHeaders) {
  const s = JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) }, extraHeaders || {}));
  res.end(s);
}

function filterProducts(q) {
  let list = products.slice();
  if (q.get('handle')) list = list.filter((p) => p.handle === q.get('handle'));
  if (q.get('ids')) { const ids = q.get('ids').split(',').map(Number); list = list.filter((p) => ids.includes(p.id)); }
  if (q.get('collection_id')) { const ids = collects[q.get('collection_id')] || []; list = list.filter((p) => ids.includes(p.id)); }
  if (q.get('status')) list = list.filter((p) => p.status === q.get('status'));
  if (q.get('published_status') === 'published') list = list.filter((p) => !!p.published_at);
  const limit = Number(q.get('limit') || 50);
  return list.slice(0, limit);
}

const server = https.createServer({ key, cert }, (req, res) => {
  const u = new URL(req.url, 'https://localhost');
  if (u.pathname === '/__control') {
    if (u.searchParams.get('mode')) mode = u.searchParams.get('mode');
    const t = u.searchParams.get('title');
    if (t) { const [h, ...rest] = t.split(':'); const p = products.find((x) => x.handle === h); if (p) p.title = rest.join(':'); }
    if (u.searchParams.get('reset')) log.length = 0;
    const counts = {}; for (const l of log) counts[l] = (counts[l] || 0) + 1;
    return json(res, 200, { mode, requests: log.length, counts });
  }
  const rel = u.pathname.replace(/^\/admin\/api\/[^/]+\//, '');
  log.push(`${req.method} ${rel}${u.search ? u.search : ''}`);
  if (mode === 'fail') return json(res, 500, { errors: 'Internal Server Error (fake)' });
  if (mode === 'slow') { setTimeout(() => json(res, 200, { products: [] }), 15000); return; }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'POST' && rel === 'graphql.json') {
      const query = (() => { try { return JSON.parse(body || '{}').query || ''; } catch { return ''; } })();
      if (/productsCount/.test(query)) return json(res, 200, { data: { nodes: collections.map((c) => ({ id: `gid://shopify/Collection/${c.id}`, handle: c.handle, productsCount: { count: (collects[c.id] || []).length } })) } });
      if (/menus\(/.test(query)) return json(res, 200, { data: { menus: { edges: [] } } });
      if (/node\(id:/.test(query)) return json(res, 200, { data: { node: { id: 'gid://shopify/MediaImage/999001', image: { url: CDN + 'size-chart.png' } } } });
      if (/ZbVariantPrices|nodes\(ids/.test(query)) {
        const ids = (() => { try { return JSON.parse(body).variables.ids || []; } catch { return []; } })();
        const nodes = ids.map((gid) => { const id = Number(String(gid).split('/').pop()); for (const p of products) for (const v of p.variants) if (v.id === id) return { id: gid, price: v.price }; return null; });
        return json(res, 200, { data: { nodes } });
      }
      return json(res, 200, { data: {} });
    }
    if (rel === 'products.json') return json(res, 200, { products: filterProducts(u.searchParams) });
    let m;
    if ((m = rel.match(/^products\/(\d+)\.json$/))) { const p = products.find((x) => x.id === Number(m[1])); return p ? json(res, 200, { product: p }) : json(res, 404, { errors: 'Not Found' }); }
    if ((m = rel.match(/^products\/(\d+)\/metafields\.json$/))) {
      if (Number(m[1]) === 1001) return json(res, 200, { metafields: [{ id: 8001, namespace: 'custom', key: 'size_chart', type: 'file_reference', value: 'gid://shopify/MediaImage/999001' }] });
      return json(res, 200, { metafields: [] });
    }
    if (rel === 'products/count.json') return json(res, 200, { count: products.length });
    if (rel === 'custom_collections.json') return json(res, 200, { custom_collections: collections });
    if (rel === 'smart_collections.json') return json(res, 200, { smart_collections: [] });
    if ((m = rel.match(/^collections\/(\d+)\/products\.json$/))) return json(res, 200, { products: products.filter((p) => (collects[m[1]] || []).includes(p.id)) });
    if (rel === 'policies.json') return json(res, 200, { policies: [] });
    if (rel === 'shop.json') return json(res, 200, { shop: { name: 'Fake Shop', myshopify_domain: '127.0.0.1:8443', currency: 'INR' } });
    return json(res, 200, {});
  });
});
const PORT = Number(process.env.FAKE_PORT || 8443); server.listen(PORT, '127.0.0.1', () => console.log('fake shopify on https://127.0.0.1:' + PORT));
