/**
 * Event-quality follow-up (Meta + Snap Events Manager read, 2026-11-01):
 *  - both Purchase builders take first + last name from the name source that carries a surname;
 *  - the Snap server PURCHASE carries content_name (item titles) and, for a webhook-only
 *    completion, borrows the Meta row's user agent / IP;
 *  - the Meta relay rebuilds fbc from the page URL's fbclid when no _fbc cookie reached it;
 *  - platform default hosts (*.ondigitalocean.app, *.onrender.com) are storefront hosts to redirect.
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-event-quality-followup.ts
 *
 * Pure functions plus the Snap delivery against an in-memory fake DB; nothing is sent.
 */
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

(async () => {
  const P = await import('../lib/tracking/placeholder-identity');
  const meta = await import('../lib/meta/purchase');
  const snap = await import('../lib/snap/purchase');
  const snapCapi = await import('../lib/snap-capi');
  const idc = await import('../lib/meta/identity-cookies');
  const host = await import('../lib/tracking/host');

  console.log('— 1. Name source with a surname');
  eq('customer "Priya", address "Priya Sharma" → the full name', P.pickRealFullName('Priya', 'Priya Sharma'), 'Priya Sharma');
  eq('address "Rahul Verma", customer "Rahul" → the full name (order of candidates kept otherwise)', P.pickRealFullName('Rahul Verma', 'Rahul'), 'Rahul Verma');
  eq('placeholder first, real full name second', P.pickRealFullName('Customer', 'Riya Kapoor'), 'Riya Kapoor');
  eq('two single names → the first real one', P.pickRealFullName('Aman', 'Dev'), 'Aman');
  eq('only placeholders → nothing', P.pickRealFullName('Valued Customer', 'Guest User', '', undefined), undefined);

  const order = (customerName: string, addrName: string, items: any[]) => ({
    id: 'ord_F', orderType: 'WEB_STORE', paymentStatus: 'paid', totalPrice: 2208, currency: 'INR', customerId: 'cust_1', createdAt: new Date(), paymentCapturedAt: new Date(),
    customer: { email: 'priya@example.com', phone: '98111 22233', name: customerName },
    shippingAddress: JSON.stringify({ name: addrName, email: 'priya@example.com', phone: '98111 22233', city: 'Noida', state: 'Uttar Pradesh', zip: '201301', countryCode: 'IN' }),
    items,
  });
  const items = [
    { title: 'DUSTBURN DRIFT TANK', quantity: 1, price: 1046, variantId: '51747537617177', sku: 'ZB-TANK-M' },
    { title: 'RELIC RUINFRAME DENIM', quantity: 1, price: 1162, variantId: '52789131804953', sku: 'ZB-DENIM-32' },
    { title: 'DUSTBURN DRIFT TANK', quantity: 1, price: 1046, variantId: '51747537617177', sku: 'ZB-TANK-M' },
  ];
  const m1 = meta.buildMetaPurchaseFromOrder(order('Priya', 'Priya Sharma', items), {}, Date.now());
  eq('Meta Purchase: surname from the address when only it has one', [m1.userData?.fn, m1.userData?.ln], ['Priya', 'Sharma']);
  const m2 = meta.buildMetaPurchaseFromOrder(order('Priya Sharma', 'Priya', items), {}, Date.now());
  eq('Meta Purchase: surname from the customer row when only it has one', [m2.userData?.fn, m2.userData?.ln], ['Priya', 'Sharma']);
  const s1 = snap.buildPurchaseFromOrder(order('Priya', 'Priya Sharma', items), { userAgent: 'UA' }, Date.now());
  eq('Snap PURCHASE: surname from the address when only it has one', [s1.userData.fn, s1.userData.ln], ['Priya', 'Sharma']);
  const s2 = snap.buildPurchaseFromOrder(order('Priya Sharma', 'Priya', items), { userAgent: 'UA' }, Date.now());
  eq('Snap PURCHASE: surname from the customer row when only it has one', [s2.userData.fn, s2.userData.ln], ['Priya', 'Sharma']);

  console.log('\n— 2. Snap PURCHASE content_name');
  eq('distinct item titles, in order', s1.customData.content_name, 'DUSTBURN DRIFT TANK | RELIC RUINFRAME DENIM');
  const ev = snapCapi.buildSnapCapiEvent(s1 as any);
  eq('…reaches custom_data.content_name on the wire, value/currency/ids unchanged', [ev.custom_data.content_name, ev.custom_data.value, ev.custom_data.currency, ev.custom_data.num_items, ev.custom_data.content_ids],
    ['DUSTBURN DRIFT TANK | RELIC RUINFRAME DENIM', 2208, 'INR', '3', ['51747537617177', '52789131804953']]);
  const s3 = snap.buildPurchaseFromOrder(order('Priya Sharma', 'Priya', [{ quantity: 1, price: 99, variantId: '51747537617177' }]), { userAgent: 'UA' }, Date.now());
  eq('no titles → no content_name', s3.customData.content_name, undefined);
  const long = snap.buildPurchaseFromOrder(order('Priya Sharma', 'Priya', Array.from({ length: 30 }, (_, i) => ({ title: `ITEM NUMBER ${i} WITH A LONG NAME`, quantity: 1, price: 10, variantId: '51747537617177' }))), { userAgent: 'UA' }, Date.now());
  eq('content_name capped at 200 characters', (long.customData.content_name || '').length, 200);

  console.log('\n— 3. Snap PURCHASE borrows the Meta row\'s user agent for a webhook-only completion');
  const rows = new Map<string, any>();
  const orders = new Map<string, any>();
  const key = (w: any) => { const k = w.platform_eventName_orderId; return `${k.platform}|${k.eventName}|${k.orderId}`; };
  const match = (r: any, w: any): boolean => (!w.id || r.id === w.id) && (!w.platform || r.platform === w.platform) && (!w.eventName || r.eventName === w.eventName)
    && (!w.orderId || typeof w.orderId !== 'string' || r.orderId === w.orderId) && (w.attempts?.lt === undefined || r.attempts < w.attempts.lt)
    && (w.status === undefined || (typeof w.status === 'string' ? r.status === w.status : !w.status.in || w.status.in.includes(r.status)))
    && (!w.leaseUntil?.lt || (r.leaseUntil && r.leaseUntil < w.leaseUntil.lt)) && (!w.OR || w.OR.some((o: any) => match(r, o)));
  let seq = 0;
  const db: any = {
    order: { findUnique: async ({ where }: any) => (orders.has(where.id) ? { ...orders.get(where.id) } : null) },
    adConversionDelivery: {
      findUnique: async ({ where }: any) => (rows.get(key(where)) ? { ...rows.get(key(where)) } : null),
      create: async ({ data }: any) => { const k = `${data.platform}|${data.eventName}|${data.orderId}`; if (rows.has(k)) { const e: any = new Error('dup'); e.code = 'P2002'; throw e; }
        const r = { id: `r${++seq}`, status: 'pending', attempts: 0, leaseUntil: null, eventTime: null, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.set(k, r); return { ...r }; },
      update: async ({ where, data }: any) => { const r = rows.get(key(where)); Object.assign(r, data, { updatedAt: new Date() }); return { ...r }; },
      updateMany: async ({ where, data }: any) => { let c = 0; for (const r of rows.values()) if (match(r, where)) { for (const [k, v] of Object.entries<any>(data)) r[k] = v && typeof v === 'object' && 'increment' in v ? r[k] + v.increment : v; r.updatedAt = new Date(); c++; } return { count: c }; },
      findMany: async ({ where, take }: any) => [...rows.values()].filter(r => match(r, where)).slice(0, take),
    },
  };
  const sent: any[] = [];
  const delivery = snap.createSnapPurchaseDelivery({ db, send: async (p: any) => { sent.push(p); return { success: true }; } } as any);
  orders.set('ord_WH', { ...order('Priya Sharma', 'Priya', items), id: 'ord_WH' });
  rows.set('meta|Purchase|ord_WH', { id: 'rmeta', platform: 'meta', eventName: 'Purchase', orderId: 'ord_WH', status: 'sent', attempts: 1, leaseUntil: null, eventTime: null, createdAt: new Date(), updatedAt: new Date(),
    context: { userAgent: 'Mozilla/5.0 (iPhone) Safari', ipAddress: '2401:4900:1c1a::1', fbp: 'fb.1.1700000000000.1' } });
  const r1 = await delivery.emitSnapPurchase('ord_WH', undefined, { paymentConfirmed: true });
  eq('webhook-only completion sent with the Meta row\'s user agent and IP', [r1.status, sent[0]?.userAgent, sent[0]?.ipAddress], ['sent', 'Mozilla/5.0 (iPhone) Safari', '2401:4900:1c1a::1']);
  orders.set('ord_OWN', { ...order('Priya Sharma', 'Priya', items), id: 'ord_OWN' });
  const r2 = await delivery.emitSnapPurchase('ord_OWN', { userAgent: 'UA-own', ipAddress: '49.36.1.1' }, { paymentConfirmed: true });
  eq('a request with its own user agent keeps it', [r2.status, sent[1]?.userAgent, sent[1]?.ipAddress], ['sent', 'UA-own', '49.36.1.1']);
  orders.set('ord_NONE', { ...order('Priya Sharma', 'Priya', items), id: 'ord_NONE' });
  const r3 = await delivery.emitSnapPurchase('ord_NONE', undefined, { paymentConfirmed: true });
  eq('no Meta row either → still sent, without a user agent (as before)', [r3.status, sent[2]?.userAgent || ''], ['sent', '']);

  console.log('\n— 4. fbc rebuilt from the page URL');
  eq('fbclid in the page URL → fb.1.<now>.<fbclid>', idc.fbcFromEventSourceUrl('https://zicabella.com/products/x?utm_source=fb&fbclid=IwAR0abc_-XYZ', 1700000000000), 'fb.1.1700000000000.IwAR0abc_-XYZ');
  eq('no fbclid → nothing', idc.fbcFromEventSourceUrl('https://zicabella.com/products/x?utm_source=fb', 1700000000000), undefined);
  eq('malformed fbclid → nothing', idc.fbcFromEventSourceUrl('https://zicabella.com/?fbclid=' + encodeURIComponent('IwAR0 abc<>'), 1700000000000), undefined);
  eq('not a URL → nothing', [idc.fbcFromEventSourceUrl('nope', 1), idc.fbcFromEventSourceUrl(undefined, 1), idc.fbcFromEventSourceUrl('', 1)], [undefined, undefined, undefined]);

  console.log('\n— 5. Platform default hosts');
  eq('DigitalOcean / Render default hosts (any case, with port)', ['zb-app-main-3m3lx.ondigitalocean.app', 'zb-app.onrender.com', 'ZB-APP.ONRENDER.COM:443', 'x.ondigitalocean.app.'].map(host.isNonCanonicalStorefrontHost), [true, true, true, true]);
  eq('the shop\'s own hosts and anything else are not', ['zicabella.com', 'www.zicabella.com', 'app.zicabella.com', 'localhost', '', undefined, 'evil-ondigitalocean.app', 'onrender.com'].map(host.isNonCanonicalStorefrontHost), [false, false, false, false, false, false, false, false]);
  eq('…and only storefront paths move (the keep-list is the app host\'s)', ['/', '/products/x', '/collections/new', '/checkout', '/api/cron/x', '/_next/static/a.js', '/feed.xml', '/dashboard/login'].map(host.isAppHostPathToRedirect), [true, true, true, true, false, false, false, false]);

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
