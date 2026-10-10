/**
 * Identity quality + Snap fixes (2026-10-09):
 *  - No placeholder / dummy identity (guest@zicabella.com, guest_<ts>@…,
 *    'Customer', 'Valued Customer', 'Guest', 9999999999 …) reaches Meta or Snap,
 *    raw or already hashed, browser or server; the real value is used instead.
 *  - Snap web/app never report a webhook-recovered order with unknown items.
 *  - Snap retry closes rows that can never be sent (no queue starvation).
 *  - Snap browser PURCHASE survives a pending visit (fires once after paid).
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-identity-quality.ts
 */
import crypto from 'crypto';

process.env.META_CAPI_ACCESS_TOKEN = 'EAA' + 'B'.repeat(180);
process.env.META_PIXEL_ID = '2049977412558608';
process.env.NEXT_PUBLIC_SNAP_PIXEL_ID = process.env.NEXT_PUBLIC_SNAP_PIXEL_ID || 'snap-pixel-test';

const graph: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes('graph.facebook.com')) { graph.push(JSON.parse(init.body)); return new Response(JSON.stringify({ events_received: 1 }), { status: 200 }); }
  return new Response('{}', { status: 200 });
};
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); }
};

(async () => {
  const P = await import('../lib/tracking/placeholder-identity');
  const { normalizeIdentity } = await import('../lib/tracking/identity-normalize');
  const { sendCapiEvent } = await import('../lib/metaCapi');
  const { buildMetaPurchaseFromOrder } = await import('../lib/meta/purchase');
  const { buildPurchaseFromOrder: buildSnapPurchase, createSnapPurchaseDelivery } = await import('../lib/snap/purchase');
  const { buildAppPurchaseInput } = await import('../lib/snap/app-purchase');
  const bp = await import('../lib/meta/browser-purchase');
  const { isDemoValue } = await import('../lib/metaPixel');
  const { buildClientUserData } = await import('../lib/buildMetaUserData');

  // ── detection ──
  check('placeholder names detected (Customer / Valued Customer / Guest User / UNKNOWN)',
    ['Customer', 'Valued Customer', 'Guest User', 'UNKNOWN', 'zica bella customer'].every(P.isPlaceholderName));
  check('real names kept: Rahul Sharma, Userina, Vikas Guest, Christopher Guest, Na Yeon Kim, Na, Guest, Test',
    !['Rahul Sharma', 'Userina', 'Vikas Guest', 'Christopher Guest', 'Na Yeon Kim', 'Na', 'Guest', 'Test'].some(P.isPlaceholderName));
  const nk = normalizeIdentity({ fn: 'Na', ln: 'Guest', country: 'KR' });
  check('real name parts "Na" / "Guest" still sent', nk.fn === 'na' && nk.ln === 'guest', nk);
  check('demo login email treated as placeholder', P.isPlaceholderEmail('demo@zicabella.com') && P.isPlaceholderEmailHash(sha('demo@zicabella.com')));
  check('dummy phone hash from an old cookie detected (91 + 9999999999)', P.isPlaceholderPhoneHash(sha('919999999999')) && !P.isPlaceholderPhoneHash(sha('919811122233')));
  const nph = normalizeIdentity({ ph: sha('911234567890') });
  check('Snap drops hashed dummy phone cookie', !nph.ph, nph);
  check('Namibia country hash not in the name list', !P.isPlaceholderNameHash(sha('na')));
  check('dummy phones detected', ['9999999999', '+91 00000 00000', '1234567890', '12345'].every(P.isPlaceholderPhone));
  check('real phones kept (IN / UK / SG / US)', !['+91 98111 22233', '07700 900123', '8123 4567', '(415) 555-2671'].some(P.isPlaceholderPhone));

  // ── Snap: central normalizeIdentity (browser pixel + web CAPI + app CAPI) ──
  const n = normalizeIdentity({ em: 'guest_1700000000000@zicabella.com', ph: '9999999999', fn: 'Valued', ln: 'Customer', country: 'IN' });
  check('Snap normalizeIdentity drops placeholder em/ph/fn/ln', !n.em && !n.ph && !n.fn && !n.ln, n);
  const nh = normalizeIdentity({ em: sha('guest@zicabella.com'), fn: sha('customer') });
  check('Snap normalizeIdentity drops already-hashed placeholders', !nh.em && !nh.fn, nh);
  const nr = normalizeIdentity({ em: 'Riya@Example.com', ph: '98111 22233', fn: 'Riya', country: 'IN' });
  check('Snap normalizeIdentity keeps real values', nr.em === 'riya@example.com' && nr.ph === '919811122233' && nr.fn === 'riya', nr);

  // ── Meta server: every CAPI event ──
  graph.length = 0;
  await sendCapiEvent({ eventName: 'ViewContent', eventId: 'e1', eventTime: Math.floor(Date.now() / 1000), eventSourceUrl: 'https://zicabella.com/x', userAgent: 'UA', actionSource: 'website',
    userData: { em: 'guest@zicabella.com', ph: '9999999999', fn: 'Valued', ln: 'Customer', country: 'IN' } } as any);
  const ud = graph[0]?.data?.[0]?.user_data || {};
  check('Meta CAPI drops placeholder em/ph/fn/ln (raw)', !ud.em && !ud.ph && !ud.fn && !ud.ln && !!ud.country, ud);
  graph.length = 0;
  await sendCapiEvent({ eventName: 'ViewContent', eventId: 'e2', eventTime: Math.floor(Date.now() / 1000), eventSourceUrl: 'https://zicabella.com/x', userAgent: 'UA', actionSource: 'website',
    userData: { em: sha('guest@zicabella.com'), fn: sha('customer'), ln: sha('unknown'), ph: sha('910000000000') } } as any);
  const ud2 = graph[0]?.data?.[0]?.user_data || {};
  check('Meta CAPI drops placeholder em/fn/ln/ph (hashed cookies)', !ud2.em && !ud2.fn && !ud2.ln && !ud2.ph, ud2);

  // ── Meta browser ──
  check('Meta browser isDemoValue blocks placeholder name / dummy phone', isDemoValue('name', 'Valued Customer') && isDemoValue('phone', '0000000000') && !isDemoValue('name', 'Riya Kapoor'));
  const cu = buildClientUserData({ fn: sha('customer'), ln: sha('kapoor'), em: sha('riya@example.com'), ph: sha('919999999999') } as any);
  check('Meta browser user data drops hashed placeholder name/phone, keeps real values', !cu.fn && cu.ln === sha('kapoor') && cu.em === sha('riya@example.com') && !cu.ph, cu);

  // ── Purchase builders pick the REAL value when a placeholder comes first ──
  const order: any = {
    id: 'ord_Q', orderType: 'WEB_STORE', paymentStatus: 'paid', totalPrice: 2499, currency: 'INR', customerId: 'c1', createdAt: new Date(),
    customer: { email: 'guest_1700000000000@zicabella.com', phone: '9999999999', name: 'Valued Customer' },
    shippingAddress: JSON.stringify({ name: 'Customer', email: 'riya@example.com', phone: '98111 22233', city: 'Delhi', state: 'Delhi', zip: '110001', countryCode: 'IN' }),
    items: [{ quantity: 1, price: 2499, variantId: '51813148262681' }],
  };
  const metaEv = buildMetaPurchaseFromOrder(order, {}, Date.now());
  check('Meta Purchase: real email + phone, placeholder names omitted',
    metaEv.userData?.em === 'riya@example.com' && metaEv.userData?.ph === '98111 22233' && !metaEv.userData?.fn && !metaEv.userData?.ln, metaEv.userData);
  const order2 = { ...order, customer: { ...order.customer, name: 'Riya Kapoor' } };
  const metaEv2 = buildMetaPurchaseFromOrder(order2, {}, Date.now());
  check('Meta Purchase: placeholder address name skipped for the real customer name', metaEv2.userData?.fn === 'Riya' && metaEv2.userData?.ln === 'Kapoor', metaEv2.userData);
  const snapEv = buildSnapPurchase(order2, {} as any, Date.now());
  check('Snap web Purchase: placeholder email/phone skipped for the real ones, real name',
    snapEv.userData.em === 'riya@example.com' && snapEv.userData.ph === '98111 22233' && snapEv.userData.fn === 'Riya', snapEv.userData);
  const appEv = buildAppPurchaseInput({ ...order2, orderType: 'MOBILE_APP', customer: { email: 'guest@zicabella.com', phone: '', name: 'Guest User' } } as any,
    { platform: 'ios' } as any, {} as any, 'app', Date.now());
  check('Snap app Purchase: guest@zicabella.com and "Guest User" never sent; real address email used, no fake name',
    appEv.userData?.em === 'riya@example.com' && !appEv.userData?.fn && !appEv.userData?.ln, appEv.userData);
  const args = bp.buildMetaBrowserPurchaseArgs(order)!;
  check('Meta browser Purchase args: real email/phone, no placeholder name',
    args.userData?.em === 'riya@example.com' && args.userData?.ph === '98111 22233' && !args.userData?.fn, args.userData);

  // ── Snap: recovered placeholder order never sent; retry closes dead rows ──
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
  const snapSent: any[] = [];
  let snapFail = 0;
  const snap = createSnapPurchaseDelivery({ db, send: async (p: any) => { if (snapFail > 0) { snapFail--; return { success: false, error: 'temporary' }; } snapSent.push(p); return { success: true }; } } as any);
  orders.set('ord_REC', { ...order2, id: 'ord_REC', tags: 'WebStoreOrder, webhook-recovered', totalPrice: 99, items: [{ quantity: 1, price: 99, variantId: null, sku: 'WEBHOOK-RECOVERED-PLACEHOLDER' }] });
  const rec = await snap.emitSnapPurchase('ord_REC', undefined, { paymentConfirmed: true });
  check('Snap web: webhook-recovered order with unknown items → not sent', rec.status === 'skipped' && snapSent.length === 0, rec);
  orders.set('ord_REF', { ...order2, id: 'ord_REF' });
  snapFail = 1;
  const f1 = await snap.emitSnapPurchase('ord_REF', undefined, { paymentConfirmed: true });
  orders.get('ord_REF').paymentStatus = 'refunded';
  const t = await snap.retryPendingSnapPurchases(25);
  check('Snap retry: failed row of a refunded order closed (no starvation)', f1.status === 'failed' && rows.get('snap|PURCHASE|ord_REF')?.status === 'skipped' && t.retry_closed === 1, { f1, t, row: rows.get('snap|PURCHASE|ord_REF') });
  orders.set('ord_OK', { ...order2, id: 'ord_OK' });
  snapFail = 1;
  await snap.emitSnapPurchase('ord_OK', undefined, { paymentConfirmed: true });
  await snap.retryPendingSnapPurchases(25);
  check('Snap retry: a genuine failure is still resent once', snapSent.filter(p => p.eventId === 'ord_OK').length === 1);

  // ── Snap browser PURCHASE: pending → paid fires once ──
  const mem = new Map<string, string>();
  const store = { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => { mem.set(k, v); } };
  const pend = { ...order2, paymentStatus: 'payment_pending' };
  check('Snap browser: pending → "wait", nothing marked', bp.decideSnapBrowserPurchase(pend, { alreadySent: bp.hasSnapBrowserPurchaseBeenSent('ord_Q', store) }).action === 'wait' && mem.size === 0);
  const paidO = { ...order2, paymentStatus: 'paid' };
  check('Snap browser: paid → "fire"', bp.decideSnapBrowserPurchase(paidO, { alreadySent: bp.hasSnapBrowserPurchaseBeenSent('ord_Q', store) }).action === 'fire');
  let calls = 0;
  let chain: Promise<any> = Promise.resolve();
  const serial = (_n: string, fn: any) => (chain = chain.then(fn)); // what navigator.locks does across tabs
  await Promise.all([1, 2].map(() => bp.dispatchSnapBrowserPurchaseOnce('ord_Q', () => { calls++; return true; }, { store, lock: serial })));
  check('Snap browser: fires once across tabs; separate marker from Meta', calls === 1 && mem.has(bp.snapBrowserPurchaseKey('ord_Q')) && !mem.has(bp.metaBrowserPurchaseKey('ord_Q')));
  check('Snap browser: native app order never fires as website pixel', bp.decideSnapBrowserPurchase({ ...paidO, id: 'x', orderType: 'MOBILE_APP' }, { alreadySent: false }).action === 'done');
  check('Snap browser: REGULAR/EXCHANGE still eligible (unchanged Snap rule)', bp.decideSnapBrowserPurchase({ ...paidO, id: 'y', orderType: 'EXCHANGE' }, { alreadySent: false }).action === 'fire');

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
