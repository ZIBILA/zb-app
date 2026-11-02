/**
 * In-memory stand-in for the Prisma client, used by scripts/verify-snap-webhook.ts,
 * scripts/verify-razorpay-reconcile.ts and the meta-regression scripts (wired via
 * their tsconfig paths). Implements the calls the Razorpay webhook, the Razorpay
 * sync / reconcile services, the Snap ledger and the order-confirmation email
 * make; any other model/method resolves to a harmless no-op so unrelated side
 * paths don't crash.
 *
 * `where` filters are matched generically (equality, in / notIn / not / contains /
 * startsWith / gt / gte / lt / lte, OR / AND / NOT), so guarded updates such as
 * `updateMany({ where: { id, paymentStatus: { in: [...] } } })` behave as in
 * Postgres instead of matching on id alone.
 */
export const store = {
  orders: new Map<string, any>(),
  webStoreOrders: new Map<string, any>(),
  ledger: new Map<string, any>(),
  webhookEvents: [] as any[],
  syncLogs: [] as any[],
  payments: [] as any[],
  emailLogs: [] as any[],
  customerEventDeliveries: [] as any[],
  calls: [] as string[],
};

const tick = () => new Promise(r => setImmediate(r));

// ─── generic where matching ────────────────────────────────────────────────
const num = (x: any) => (x instanceof Date ? x.getTime() : typeof x === 'string' && Number.isNaN(Number(x)) ? new Date(x).getTime() : Number(x));
function cmpVal(v: any, cond: any): boolean {
  if (cond === undefined) return true;
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v !== null && v !== undefined && new Date(v).getTime() === cond.getTime();
  if (typeof cond !== 'object' || Array.isArray(cond)) return v === cond;
  for (const [op, arg] of Object.entries<any>(cond)) {
    if (op === 'mode') continue;
    if (op === 'equals' && v !== arg) return false;
    if (op === 'in' && !arg.includes(v)) return false;
    if (op === 'notIn' && (v === null || v === undefined || arg.includes(v))) return false;
    if (op === 'not' && (arg === null ? v === null || v === undefined : v === arg)) return false;
    if (op === 'contains' && !String(v ?? '').includes(arg)) return false;
    if (op === 'startsWith' && !String(v ?? '').startsWith(arg)) return false;
    if (op === 'gt' && !(num(v) > num(arg))) return false;
    if (op === 'gte' && !(num(v) >= num(arg))) return false;
    if (op === 'lt' && !(num(v) < num(arg))) return false;
    if (op === 'lte' && !(num(v) <= num(arg))) return false;
  }
  return true;
}
export function matchRow(row: any, w: any = {}): boolean {
  for (const [k, cond] of Object.entries<any>(w || {})) {
    if (k === 'OR') { if (!cond.some((o: any) => matchRow(row, o))) return false; continue; }
    if (k === 'AND') { if (!(Array.isArray(cond) ? cond : [cond]).every((o: any) => matchRow(row, o))) return false; continue; }
    if (k === 'NOT') { if ((Array.isArray(cond) ? cond : [cond]).some((o: any) => matchRow(row, o))) return false; continue; }
    if (k === 'eventKey_channel') { if (row.eventKey !== cond.eventKey || row.channel !== cond.channel) return false; continue; }
    if (!cmpVal(row[k], cond)) return false;
  }
  return true;
}
const sortBy = (rows: any[], orderBy: any) => {
  if (!orderBy) return rows;
  const [k, dir] = Object.entries<any>(Array.isArray(orderBy) ? orderBy[0] : orderBy)[0] || [];
  if (!k) return rows;
  return rows.sort((a, b) => (dir === 'desc' ? -1 : 1) * (num(a[k]) - num(b[k])));
};
const project = (row: any, args: any) => {
  if (!row) return null;
  if (!args?.select) return { ...row };
  const out: any = {};
  for (const [k, on] of Object.entries<any>(args.select)) if (on) out[k] = row[k];
  return out;
};
/** findMany / findFirst / updateMany / count over a Map or array of rows. */
function collection(rows: () => any[], name: string) {
  return {
    findMany: async ({ where, take, skip, orderBy, select }: any = {}) => {
      await tick();
      const out = sortBy(rows().filter(r => matchRow(r, where)), orderBy).slice(skip || 0);
      return (take === undefined ? out : out.slice(0, take)).map(r => project(r, { select }));
    },
    findFirst: async ({ where, orderBy, select }: any = {}) => {
      const out = sortBy(rows().filter(r => matchRow(r, where)), orderBy);
      return out[0] ? project(out[0], { select }) : null;
    },
    count: async ({ where }: any = {}) => rows().filter(r => matchRow(r, where)).length,
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows()) {
        if (!matchRow(r, where)) continue;
        for (const [k, v] of Object.entries<any>(data)) r[k] = v && typeof v === 'object' && 'increment' in v ? (r[k] || 0) + v.increment : v;
        count++;
      }
      store.calls.push(`${name}.updateMany:${count}`);
      return { count };
    },
  };
}

function findOrder(where: any) {
  for (const o of store.orders.values()) if (matchRow(o, where)) return o;
  return null;
}

const keyOf = (w: any) => { const k = w.platform_eventName_orderId; return `${k.platform}|${k.eventName}|${k.orderId}`; };
const matchWhere = (row: any, w: any): boolean => {
  if (w.id && row.id !== w.id) return false;
  if (w.platform && row.platform !== w.platform) return false;
  if (w.eventName && row.eventName !== w.eventName) return false;
  if (w.attempts?.lt !== undefined && !(row.attempts < w.attempts.lt)) return false;
  if (w.attempts?.gte !== undefined && !(row.attempts >= w.attempts.gte)) return false;
  if (typeof w.orderId === 'string' && row.orderId !== w.orderId) return false;
  if (w.orderId?.in && !w.orderId.in.includes(row.orderId)) return false;
  if (w.createdAt?.lt && !(new Date(row.createdAt) < new Date(w.createdAt.lt))) return false;
  if (w.createdAt?.gt && !(new Date(row.createdAt) > new Date(w.createdAt.gt))) return false;
  if (w.updatedAt?.lt && !(new Date(row.updatedAt) < new Date(w.updatedAt.lt))) return false;
  if (w.updatedAt?.gt && !(new Date(row.updatedAt) > new Date(w.updatedAt.gt))) return false;
  if (w.eventTime === null && row.eventTime !== null && row.eventTime !== undefined) return false;
  if (w.eventTime?.gt && !(row.eventTime && new Date(row.eventTime) > new Date(w.eventTime.gt))) return false;
  if (w.lastError?.contains !== undefined && !String(row.lastError || '').includes(w.lastError.contains)) return false;
  if (w.status !== undefined) {
    if (typeof w.status === 'string' && row.status !== w.status) return false;
    if (w.status?.in && !w.status.in.includes(row.status)) return false;
  }
  if (w.leaseUntil instanceof Date && !(row.leaseUntil && new Date(row.leaseUntil).getTime() === w.leaseUntil.getTime())) return false;
  if (w.leaseUntil?.lt && !(row.leaseUntil && row.leaseUntil < w.leaseUntil.lt)) return false;
  if (w.OR && !w.OR.some((o: any) => matchWhere(row, o))) return false;
  return true;
};
let seq = 0;

export const created: { orders: any[]; mobileOrders: any[]; customers: any[] } = { orders: [], mobileOrders: [], customers: [] };

const webhookEventRows = () => store.webhookEvents;
const webStoreRows = () => [...store.webStoreOrders.values()];

const models: Record<string, any> = {
  shop: { findFirst: async () => ({ id: 'shop_1' }) },
  customer: {
    findUnique: async ({ where }: any) => (where.id === 'cust_app_1' ? { id: 'cust_app_1', email: 'aarav@example.com', phone: '9876543210', name: 'Aarav Mehta' } : null),
    findFirst: async () => null,
    create: async ({ data }: any) => { const c = { id: `cust${++seq}`, ...data }; created.customers.push(c); return c; },
  },
  mobileOrder: {
    create: async ({ data }: any) => { const m = { id: `mo${++seq}`, ...data, items: data.items?.create || [] }; created.mobileOrders.push(m); return m; },
    updateMany: async () => ({ count: 0 }),
  },
  webhookEvent: {
    ...collection(webhookEventRows, 'webhookEvent'),
    create: async ({ data, select }: any) => {
      // eventKey is @unique in prisma/schema.prisma: a second claim on the same key is P2002.
      if (data.eventKey && store.webhookEvents.some(e => e.eventKey === data.eventKey)) { const e: any = new Error('Unique constraint failed on eventKey'); e.code = 'P2002'; throw e; }
      const r = { id: `wh${++seq}`, processed: false, processedAt: null, orderId: null, createdAt: new Date(), ...data };
      store.webhookEvents.push(r);
      return project(r, { select });
    },
    update: async ({ where, data }: any) => { const r = store.webhookEvents.find(e => e.id === where.id); Object.assign(r || {}, data); return r; },
  },
  order: {
    create: async ({ data }: any) => {
      const o = { id: `ord${++seq}`, createdAt: new Date(), ...data, items: (data.items?.create || []).map((it: any) => ({ ...it })) };
      created.orders.push(o); store.orders.set(o.id, o); return { ...o };
    },
    findUnique: async ({ where, select }: any) => { await tick(); const o = findOrder(where); return o ? project(o, { select }) : null; },
    findFirst: async ({ where, select }: any = {}) => { const o = findOrder(where || {}); return o ? project(o, { select }) : null; },
    update: async ({ where, data }: any) => { const o = findOrder(where); store.calls.push(`order.update:${o?.id}:${data.paymentStatus ?? ''}`); Object.assign(o, data); return { ...o }; },
    updateMany: async ({ where, data }: any) => {
      let count = 0; let last: any = null;
      for (const o of store.orders.values()) { if (!matchRow(o, where)) continue; Object.assign(o, data); count++; last = o; }
      store.calls.push(`order.updateMany:${last?.id}:${data.paymentStatus ?? ''}`);
      return { count };
    },
    // Missed-purchase recovery scan (lib/meta/purchase.ts), reconcile lookups
    // (razorpayOrderId / razorpayPaymentId in …, OR), oldest-first batches (select id).
    findMany: async ({ where = {}, take, orderBy, select }: any = {}) => {
      await tick();
      const dir = orderBy?.createdAt === 'asc' ? 1 : -1;
      return [...store.orders.values()].filter(o => matchRow(o, where))
        .sort((a, b) => dir * (num(a.createdAt) - num(b.createdAt))).slice(0, take ?? Infinity).map(o => project(o, { select }));
    },
  },
  webStoreOrder: {
    ...collection(webStoreRows, 'webStoreOrder'),
    create: async ({ data }: any) => { const w = { id: `ws${++seq}`, createdAt: new Date(), codUpfrontPaid: 0, ...data }; store.webStoreOrders.set(w.id, w); return { ...w }; },
    findUnique: async ({ where, select }: any) => { const w = webStoreRows().find(r => matchRow(r, where)); return w ? project(w, { select }) : null; },
    update: async ({ where, data }: any) => { const w = webStoreRows().find(r => matchRow(r, where)); if (!w) { const e: any = new Error('Record not found'); e.code = 'P2025'; throw e; } Object.assign(w, data); store.calls.push(`webStoreOrder.update:${w.id}:${data.paymentStatus ?? ''}`); return { ...w }; },
  },
  syncLog: {
    ...collection(() => store.syncLogs, 'syncLog'),
    create: async ({ data }: any) => { const r = { id: `sl${++seq}`, createdAt: new Date(), ...data }; store.syncLogs.push(r); return { ...r }; },
  },
  payment: {
    ...collection(() => store.payments, 'payment'),
    create: async ({ data }: any) => { const r = { id: `pay${++seq}`, createdAt: new Date(), ...data }; store.payments.push(r); return { ...r }; },
  },
  emailLog: {
    ...collection(() => store.emailLogs, 'emailLog'),
    create: async ({ data }: any) => { const r = { id: `el${++seq}`, createdAt: new Date(), ...data }; store.emailLogs.push(r); return { ...r }; },
  },
  customerEventDelivery: {
    ...collection(() => store.customerEventDeliveries, 'customerEventDelivery'),
    // (eventKey, channel) is unique: deliverOnce relies on P2002 to send once.
    create: async ({ data }: any) => {
      if (store.customerEventDeliveries.some(r => r.eventKey === data.eventKey && r.channel === data.channel)) { const e: any = new Error('Unique'); e.code = 'P2002'; throw e; }
      const r = { id: `ced${++seq}`, error: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.customerEventDeliveries.push(r); return { ...r };
    },
    findUnique: async ({ where, select }: any) => { const r = store.customerEventDeliveries.find(x => matchRow(x, where)); return r ? project(r, { select }) : null; },
    update: async ({ where, data }: any) => { const r = store.customerEventDeliveries.find(x => matchRow(x, where)); Object.assign(r || {}, data, { updatedAt: new Date() }); return r ? { ...r } : null; },
  },
  adConversionDelivery: {
    findUnique: async ({ where }: any) => { await tick(); const r = store.ledger.get(keyOf(where)); return r ? { ...r } : null; },
    create: async ({ data }: any) => {
      await tick();
      const k = `${data.platform}|${data.eventName}|${data.orderId}`;
      if (store.ledger.has(k)) { const e: any = new Error('Unique'); e.code = 'P2002'; throw e; }
      const row = { id: `led${++seq}`, status: 'pending', attempts: 0, leaseUntil: null, eventTime: null, sentAt: null, lastError: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.ledger.set(k, row); return { ...row };
    },
    update: async ({ where, data }: any) => { await tick(); const r = store.ledger.get(keyOf(where)); Object.assign(r, data); return { ...r }; },
    updateMany: async ({ where, data }: any) => {
      await tick(); let count = 0;
      for (const row of store.ledger.values()) {
        if (!matchWhere(row, where)) continue;
        for (const [k, v] of Object.entries<any>(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v;
        row.updatedAt = new Date(); // Prisma @updatedAt
        count++;
      }
      return { count };
    },
    findMany: async ({ where, take, orderBy }: any) => {
      const rows = [...store.ledger.values()].filter(r => matchWhere(r, where));
      const k = orderBy && Object.keys(orderBy)[0];
      if (k) rows.sort((a, b) => (orderBy[k] === 'desc' ? -1 : 1) * (new Date(a[k]).getTime() - new Date(b[k]).getTime()));
      return rows.slice(0, take);
    },
    findFirst: async ({ where, orderBy }: any) => {
      const rows = [...store.ledger.values()].filter(r => matchWhere(r, where));
      const k = orderBy && Object.keys(orderBy)[0];
      if (k) rows.sort((a, b) => (orderBy[k] === 'desc' ? -1 : 1) * (new Date(a[k]).getTime() - new Date(b[k]).getTime()));
      return rows[0] ? { ...rows[0] } : null;
    },
    count: async ({ where }: any) => [...store.ledger.values()].filter(r => matchWhere(r, where)).length,
  },
};

const noop = new Proxy({}, { get: () => async () => null });
const prisma: any = new Proxy(models, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    if (prop === '$transaction') return async (fn: any) => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn));
    if (prop.startsWith('$')) return async () => null;
    return noop;
  },
});
export default prisma;
