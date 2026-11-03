/**
 * Checkout stock check (lib/stock-availability.ts): a size with no stock cannot be paid for.
 * Real routes + real stock module, Shopify faked at the HTTP layer with per-variant stock.
 *
 *   ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PORT=1 \
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/stock-run.ts
 */
Object.assign(process.env, {
  NODE_ENV: 'test',
  RAZORPAY_WEBHOOK_SECRET: 'whsec_test', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'secret',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test', SHOPIFY_STORE_DOMAIN: 'test-shop.myshopify.com',
  NEXT_PUBLIC_SITE_URL: 'https://zicabella.com',
});
const V = { XS: '1001', S: '1002', M: '1003', L: '1004', UNTRACKED: '1005', MISSING: '9999' };
const PRICE: Record<string, number> = { [V.XS]: 1633, [V.S]: 1633, [V.M]: 1633, [V.L]: 1633, [V.UNTRACKED]: 999 };
const stock: Record<string, number | null> = { [V.XS]: 1, [V.S]: 1, [V.M]: 0, [V.L]: 5, [V.UNTRACKED]: null };
const SIZE: Record<string, string> = { [V.XS]: 'XS', [V.S]: 'S', [V.M]: 'M', [V.L]: 'L', [V.UNTRACKED]: 'Default Title' };
const calls = { stock: 0, razorpayOrders: 0 };
let shopifyDown = false;

(globalThis as any).fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
  if (u.includes('/admin/api/') && u.endsWith('/graphql.json')) {
    const q = JSON.parse(opt.body || '{}');
    const ids = (q.variables?.ids || []).map((g: string) => String(g).split('/').pop() || '');
    if (String(q.query).includes('ZbVariantStock')) {
      calls.stock++;
      if (shopifyDown) await new Promise(() => {}); // never answers
      return json(200, { data: { nodes: ids.map((i: string) => (i in stock
        ? { id: `gid://shopify/ProductVariant/${i}`, title: SIZE[i], inventoryQuantity: stock[i] ?? 0, inventoryItem: { tracked: stock[i] !== null }, product: { title: 'CHAINSTER ZIP SHIRT' } }
        : null)) } });
    }
    if (String(q.query).includes('ZbVariantPrices')) {
      return json(200, { data: { nodes: ids.map((i: string) => (PRICE[i] !== undefined ? { id: `gid://shopify/ProductVariant/${i}`, price: PRICE[i].toFixed(2) } : null)) } });
    }
    return json(200, { data: {} });
  }
  if (u.startsWith('https://api.razorpay.com/')) return json(200, { id: 'order_x', status: 'created' });
  return json(200, {});
};

let failed = 0, passed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });

async function main() {
  const { default: prisma } = await import('./memory-prisma');
  const { checkCartStock, stockShortageMessage, clearStockCache } = await import('../../lib/stock-availability');
  await prisma.shop.create({ data: { id: 'shop_1', name: 'Zica Bella', domain: 'test-shop.myshopify.com' } });
  const line = (v: string, quantity = 1) => ({ variantId: `gid://shopify/ProductVariant/${v}`, quantity });
  const fresh = () => { clearStockCache(); calls.stock = 0; };

  console.log('\n— 1. every size');
  for (const [name, v, want] of [['XS (1 left)', V.XS, 0], ['S (1 left)', V.S, 0], ['M (0 left)', V.M, 1], ['L (5 left)', V.L, 0]] as const) {
    fresh();
    const r = await checkCartStock([line(v)]);
    eq(`${name}: ${want ? 'refused' : 'allowed'} for 1 unit`, r.shortages.length, want);
  }
  fresh(); eq('XS with quantity 2 (only 1 left) is refused', (await checkCartStock([line(V.XS, 2)])).shortages.map(s => [s.available, s.requested]), [[1, 2]]);
  fresh(); eq('L with quantity 5 (exactly what is left) is allowed', (await checkCartStock([line(V.L, 5)])).shortages.length, 0);
  fresh(); eq('L with quantity 6 is refused', (await checkCartStock([line(V.L, 6)])).shortages.length, 1);
  fresh(); eq('the same size on two lines is summed (S 1 + S 1 > 1 left)', (await checkCartStock([line(V.S), line(V.S)])).shortages.length, 1);
  fresh(); eq('a variant Shopify does not track is never refused', (await checkCartStock([line(V.UNTRACKED, 50)])).shortages.length, 0);
  fresh(); { const r = await checkCartStock([line(V.L), line(V.M)]); eq('mixed cart: only the sold-out line is named', r.shortages.map(s => s.label), ['CHAINSTER ZIP SHIRT (M)']); }
  fresh(); eq('message for sold out', stockShortageMessage((await checkCartStock([line(V.M)])).shortages), 'Chainster zip shirt (M) is sold out. Please update your bag and try again.'.replace('Chainster zip shirt', 'CHAINSTER ZIP SHIRT'));
  fresh(); eq('message for partial stock', stockShortageMessage((await checkCartStock([line(V.XS, 3)])).shortages).startsWith('Only 1 of CHAINSTER ZIP SHIRT (XS) left'), true);

  console.log('\n— 2. load on Shopify');
  fresh(); await checkCartStock([line(V.L), line(V.M), line(V.XS)]);
  eq('a cart of 3 variants costs ONE Shopify call', calls.stock, 1);
  await checkCartStock([line(V.L), line(V.M), line(V.XS)]);
  eq('the same cart again within 10s costs none (cached)', calls.stock, 1);
  fresh(); await Promise.all(Array.from({ length: 25 }, () => checkCartStock([line(V.L), line(V.XS)])));
  eq('25 simultaneous checkouts of the same cart share ONE call', calls.stock, 1);
  fresh(); eq('an unknown variant id is not reported as short (but is "unverified")', await checkCartStock([line(V.MISSING)]), { verified: false, shortages: [] });

  console.log('\n— 3. Shopify slow or down');
  fresh(); shopifyDown = true;
  const t0 = Date.now(); const down = await checkCartStock([line(V.M)], { timeoutMs: 300 });
  check('gives up at the timeout and lets the sale through (unverified, no shortage)', down.verified === false && down.shortages.length === 0 && Date.now() - t0 < 1500, { down, ms: Date.now() - t0 });
  shopifyDown = false;

  console.log('\n— 4. mobile payment route (/api/app/payment/create-order)');
  const createOrder = await import('../../app/api/app/payment/create-order/route');
  const post = (route: any, url: string, body: any) => route.POST(new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: 'Bearer t', 'x-forwarded-for': '49.36.10.20', 'user-agent': 'ZicaBella/9' } }));
  const addr = { name: 'Aarav', line1: '1 Sector 90', city: 'Noida', state: 'Uttar Pradesh', pincode: '201304', country: 'India', phone: '+919811122244', email: 'a@example.com' };
  const orderFor = (lines: any[]) => ({ amount: 1633 * lines.length, currency: 'INR', orderData: { customerEmail: 'a@example.com', customerPhone: '+919811122244', lineItems: lines.map(l => ({ ...l, price: 1633, name: 'CHAINSTER ZIP SHIRT' })), shippingAddress: addr, paymentMethod: 'PREPAID', total: 1633 * lines.length, subtotal: 1633 * lines.length } });
  fresh(); { const r = await post(createOrder, 'https://zicabella.com/api/app/payment/create-order', orderFor([line(V.M)])); const j: any = await r.json();
    check('sold-out size: 409 OUT_OF_STOCK, no payment order created', r.status === 409 && j.code === 'OUT_OF_STOCK' && !j.orderId && !j.razorpayOrderId, { status: r.status, j }); }
  fresh(); { const r = await post(createOrder, 'https://zicabella.com/api/app/payment/create-order', orderFor([line(V.L)])); 
    check('size in stock is not blocked by the stock check', r.status !== 409, r.status); }

  console.log('\n— 5. web payment route (/api/checkout/razorpay)');
  const webPay = await import('../../app/api/checkout/razorpay/route');
  const webBody = (v: string) => ({ amount: 1633, currency: 'INR', items: [{ variantId: `gid://shopify/ProductVariant/${v}`, quantity: 1, price: '1633', title: 'CHAINSTER ZIP SHIRT' }], subtotal: 1633, total: 1633, paymentMethod: 'razorpay', address: addr, notes: { contact: '+919811122244', email: 'a@example.com', name: 'Aarav' }, checkoutSessionId: 'cs_1' });
  fresh(); { const r = await post(webPay, 'https://zicabella.com/api/checkout/razorpay', webBody(V.M)); const j: any = await r.json();
    check('sold-out size: 409 OUT_OF_STOCK with a readable message', r.status === 409 && j.code === 'OUT_OF_STOCK' && /sold out/.test(j.error), { status: r.status, j }); }
  fresh(); { const r = await post(webPay, 'https://zicabella.com/api/checkout/razorpay', { ...webBody(V.M), paymentMethod: 'COD' }); const j: any = await r.json();
    check('sold-out size is refused for COD too', r.status === 409 && j.code === 'OUT_OF_STOCK', { status: r.status, j }); }
  fresh(); { const r = await post(webPay, 'https://zicabella.com/api/checkout/razorpay', webBody(V.L));
    check('size in stock is not blocked by the stock check', r.status !== 409, r.status); }
  fresh(); { const r = await post(webPay, 'https://zicabella.com/api/checkout/razorpay', { amount: 500, currency: 'INR', notes: {} });
    check('exchange price-difference payment (no items) skips the stock check', r.status !== 409 && calls.stock === 0, { status: r.status, calls: calls.stock }); }

  console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
