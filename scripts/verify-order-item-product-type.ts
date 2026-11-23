/**
 * OrderItem.productType → the server Purchase's content_category (Snap Events Manager showed
 * Item category on only 35 % of PURCHASE events: order rows stored no product type).
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-order-item-product-type.ts
 *
 * Pure functions, the two Purchase builders, the browser order facts, the carry-over helper
 * (against a fake db) and source checks that every web order writer persists the column.
 * Nothing is sent; no database or network is used.
 */
import fs from 'fs';
import path from 'path';

process.env.META_CAPI_ACCESS_TOKEN = 'EAA' + 'B'.repeat(180);
process.env.META_PIXEL_ID = '2049977412558608';
process.env.NEXT_PUBLIC_SITE_URL = 'https://zicabella.com';
process.env.NEXT_PUBLIC_SNAP_PIXEL_ID = process.env.NEXT_PUBLIC_SNAP_PIXEL_ID || 'snap-pixel-test';
delete process.env.META_INTERNAL_PHONES; delete process.env.META_INTERNAL_EMAILS; delete process.env.META_INTERNAL_CUSTOMER_IDS;

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { failed++; console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) { eq(name, cond, true); }

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

(async () => {
  const pt = await import('../lib/tracking/product-type');
  const meta = await import('../lib/meta/purchase');
  const snap = await import('../lib/snap/purchase');
  const snapCapi = await import('../lib/snap-capi');
  const bp = await import('../lib/meta/browser-purchase');
  const svc = await import('../lib/services/orderItemProductType');

  const order = (items: any[]) => ({
    id: 'ord_PT', orderType: 'WEB_STORE', paymentStatus: 'paid', totalPrice: 5400, currency: 'INR', customerId: 'cust_1', createdAt: new Date(), paymentCapturedAt: new Date(),
    customer: { email: 'priya@example.com', phone: '98111 22233', name: 'Priya Sharma' },
    shippingAddress: JSON.stringify({ name: 'Priya Sharma', email: 'priya@example.com', phone: '98111 22233', city: 'Noida', state: 'Uttar Pradesh', zip: '201301', countryCode: 'IN' }),
    items,
  });
  const typed = [
    { title: 'RELIC JACKET', quantity: 1, price: 2400, variantId: '51747537617177', sku: 'ZB-JKT-M', productType: 'Jackets' },
    { title: 'RUINFRAME DENIM', quantity: 1, price: 1500, variantId: '52789131804953', sku: 'ZB-DENIM-32', productType: 'BAGGY JEANS' },
    { title: 'RELIC JACKET', quantity: 1, price: 1500, variantId: '51747537617178', sku: 'ZB-JKT-L', productType: 'Jackets' },
  ];
  const untyped = typed.map(({ productType, ...rest }) => rest);

  console.log('— 1. content_category from the items');
  eq('distinct types, in order, ", "-joined', pt.orderContentCategory(typed), 'Jackets, BAGGY JEANS');
  eq('values are trimmed; blank / null / non-string are ignored', pt.orderContentCategory([{ productType: '  Oversized T-Shirt ' }, { productType: '' }, { productType: '   ' }, { productType: null }, {}, { productType: 42 }]), 'Oversized T-Shirt');
  eq('no item has one → undefined (never a placeholder)', [pt.orderContentCategory(untyped), pt.orderContentCategory([]), pt.orderContentCategory(undefined), pt.orderContentCategory(null as any)], [undefined, undefined, undefined, undefined]);
  eq('capped at 256 characters', pt.orderContentCategory(Array.from({ length: 40 }, (_, i) => ({ productType: `Type number ${i}` })))!.length, 256);
  eq('a stored type is capped at 255 characters', pt.normalizeProductType('x'.repeat(400))!.length, 255);

  console.log('\n— 2. Snap server PURCHASE');
  const s1 = snap.buildPurchaseFromOrder(order(typed), { userAgent: 'UA' }, Date.now());
  eq('content_category "Jackets, BAGGY JEANS"', s1.customData.content_category, 'Jackets, BAGGY JEANS');
  const ev = snapCapi.buildSnapCapiEvent(s1 as any);
  eq('…reaches custom_data.content_category on the wire; value / currency / ids / name unchanged',
    [ev.custom_data.content_category, ev.custom_data.value, ev.custom_data.currency, ev.custom_data.content_ids, ev.custom_data.content_name],
    ['Jackets, BAGGY JEANS', 5400, 'INR', ['51747537617177', '52789131804953', '51747537617178'], 'RELIC JACKET | RUINFRAME DENIM']);
  const s2 = snap.buildPurchaseFromOrder(order(untyped), { userAgent: 'UA' }, Date.now());
  eq('no item carries a type → no content_category', s2.customData.content_category, undefined);
  eq('…and none on the wire', 'content_category' in snapCapi.buildSnapCapiEvent(s2 as any).custom_data, false);
  const s3 = snap.buildPurchaseFromOrder(order([untyped[0], typed[1]]), { userAgent: 'UA' }, Date.now());
  eq('only some items typed → just those types', s3.customData.content_category, 'BAGGY JEANS');

  console.log('\n— 3. Meta server Purchase');
  const m1 = meta.buildMetaPurchaseFromOrder(order(typed), {}, Date.now());
  eq('content_category "Jackets, BAGGY JEANS"', m1.customData?.content_category, 'Jackets, BAGGY JEANS');
  eq('the rest of custom_data is unchanged', [m1.customData?.value, m1.customData?.currency, m1.customData?.content_type, m1.customData?.content_ids, m1.customData?.num_items],
    [5400, 'INR', 'product', ['51747537617177', '52789131804953', '51747537617178'], 3]);
  const m2 = meta.buildMetaPurchaseFromOrder(order(untyped), {}, Date.now());
  eq('no item carries a type → no content_category', m2.customData?.content_category, undefined);
  const m3 = meta.buildMetaPurchaseFromOrder(order([untyped[0], typed[1]]), {}, Date.now());
  eq('only some items typed → just those types', m3.customData?.content_category, 'BAGGY JEANS');

  console.log('\n— 4. Browser Purchase prefers the stored types');
  const facts = bp.pickOrderServerFacts({ id: 'ord_PT', paymentStatus: 'paid', totalPrice: 5400, currency: 'INR', items: typed.map(i => ({ ...i })) }, 'ord_PT');
  eq('order facts carry productType per item', facts?.items?.map(i => i.productType), ['Jackets', 'BAGGY JEANS', 'Jackets']);
  const noType = bp.pickOrderServerFacts({ id: 'ord_PT', paymentStatus: 'paid', items: [{ variantId: '1', quantity: 1, price: 1 }, { variantId: '2', quantity: 1, price: 1, productType: '  ' }] }, 'ord_PT');
  eq('a missing / blank type becomes null', noType?.items?.map(i => i.productType), [null, null]);
  eq('stored types win over the sessionStorage copy', bp.browserPurchaseCategory({ items: facts?.items as any }, 'Old, Cart Copy'), 'Jackets, BAGGY JEANS');
  eq('no stored types → the checkout\'s sessionStorage copy', bp.browserPurchaseCategory({ items: noType?.items as any }, 'Old, Cart Copy'), 'Old, Cart Copy');
  eq('nothing at all → undefined', [bp.browserPurchaseCategory(noType as any, undefined), bp.browserPurchaseCategory(null, null), bp.browserPurchaseCategory(undefined, '')], [undefined, undefined, undefined]);
  const displayed = { id: 'ord_PT', items: [{ title: 'x' }], serverFacts: facts };
  eq('through orderForTracking (server facts over the displayed copy)', bp.browserPurchaseCategory(bp.orderForTracking(displayed) as any, 'Old'), 'Jackets, BAGGY JEANS');

  console.log('\n— 5. Cart item → stored type');
  eq('numeric Shopify product ids only', ['123', 'gid://shopify/Product/456', 'cmabc123xyz', '', undefined].map(svc.productNumericId), ['123', '456', '', '', '']);
  const cart = [
    { productId: '111', category: 'Jackets', title: 'a' },
    { productId: '222', category: '  BAGGY JEANS  ', title: 'b' },
    { productId: 'cmabc123xyz', title: 'c' }, // no category, not a Shopify id → nothing to look up
  ];
  eq('the cart item\'s own category is used (trimmed), no Shopify call needed', await svc.resolveCartProductTypes(cart), ['Jackets', 'BAGGY JEANS', null]);
  eq('no items → empty', await svc.resolveCartProductTypes([]), []);

  console.log('\n— 6. Rows replaced from a Shopify payload keep the stored type');
  const stored = [
    { variantId: '51747537617177', productId: 'prod_jkt', productType: 'Jackets' },
    { variantId: '52789131804953', productId: 'prod_den', productType: 'BAGGY JEANS' },
  ];
  const fakeDb: any = { orderItem: { findMany: async ({ where }: any) => { eq('reads only this order\'s typed rows', [where.orderId, where.productType], ['ord_PT', { not: null }]); return stored; } } };
  const carry = await svc.loadProductTypeCarry(fakeDb, 'ord_PT');
  eq('by variant id', carry({ variantId: '52789131804953', productId: null }), 'BAGGY JEANS');
  eq('by local product id when the variant is unknown', carry({ variantId: null, productId: 'prod_jkt' }), 'Jackets');
  eq('unknown item → null', carry({ variantId: '999', productId: 'prod_x' }), null);
  const brokenDb: any = { orderItem: { findMany: async () => { throw new Error('db down'); } } };
  const carry2 = await svc.loadProductTypeCarry(brokenDb, 'ord_PT');
  eq('a read failure never throws; nothing carried', carry2({ variantId: '52789131804953' }), null);

  console.log('\n— 7. Every web order writer persists the column');
  ok('schema: OrderItem.productType String?', /model OrderItem \{[\s\S]*?\n  productType\s+String\?[\s\S]*?\n\}/.test(read('prisma/schema.prisma')));
  const migDir = fs.readdirSync(path.join(ROOT, 'prisma/migrations')).filter(d => d.endsWith('_order_item_product_type'));
  eq('one migration folder …_order_item_product_type', migDir.length, 1);
  const mig = migDir[0] ? read(`prisma/migrations/${migDir[0]}/migration.sql`) : '';
  ok('migration adds the nullable "OrderItem"."productType" TEXT column', /ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "productType" TEXT;/.test(mig) && !/NOT NULL/.test(mig));
  const complete = read('app/api/checkout/complete/route.ts');
  eq('checkout/complete: resolved items carry productType; 3 writers (update tx, awaiting-capture refresh, create) persist it',
    [/productType: cartProductTypes\[index\] \?\? null/.test(complete), (complete.match(/productType: item\.productType \?\? null/g) || []).length], [true, 3]);
  const rzp = read('app/api/checkout/razorpay/route.ts');
  eq('checkout/razorpay: resolved items carry productType; 2 writers (refresh, create) persist it',
    [/productType: cartProductTypes\[index\] \?\? null/.test(rzp), (rzp.match(/productType: item\.productType \?\? null/g) || []).length], [true, 2]);
  const conf = read('app/api/orders/[id]/confirmation/route.ts');
  eq('confirmation route: slim select and ?view=tracking return productType', [/image: true,\s*productType: true,/.test(conf), /productType: item\.productType \?\? null/.test(conf)], [true, true]);
  for (const f of ['app/api/shopify/webhooks/route.ts', 'app/api/shopify/sync/route.ts', 'app/api/admin/orders/[id]/sync-shopify/route.ts', 'app/api/auth/[...nextauth]/options.ts']) {
    const src = read(f);
    ok(`${f}: carries the stored type onto rows rebuilt from Shopify`, /loadProductTypeCarry\(prisma, /.test(src) && /productType: productTypeCarry\(/.test(src));
  }
  const page = read('app/orders/[id]/confirmation/page.tsx');
  eq('confirmation page: Meta, Snap and GA4 Purchases take browserPurchaseCategory(trackingOrder, …)', (page.match(/browserPurchaseCategory\(trackingOrder, storedCategory\)/g) || []).length, 3);

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
