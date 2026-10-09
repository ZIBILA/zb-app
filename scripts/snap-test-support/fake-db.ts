/**
 * In-memory stand-in for the Prisma client, used ONLY by
 * scripts/verify-snap-webhook.ts (wired via this folder's tsconfig paths).
 * Implements just the calls the Razorpay webhook + Snap ledger make; any other
 * model/method resolves to a harmless no-op so unrelated side paths don't crash.
 */
export const store = {
  orders: new Map<string, any>(),
  ledger: new Map<string, any>(),
  webhookEvents: [] as any[],
  calls: [] as string[],
};

const tick = () => new Promise(r => setImmediate(r));

function findOrder(where: any) {
  for (const o of store.orders.values()) {
    if (where.id && o.id === where.id) return o;
    if (where.razorpayOrderId && o.razorpayOrderId === where.razorpayOrderId) return o;
  }
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
  if (w.status !== undefined) {
    if (typeof w.status === 'string' && row.status !== w.status) return false;
    if (w.status?.in && !w.status.in.includes(row.status)) return false;
  }
  if (w.leaseUntil?.lt && !(row.leaseUntil && row.leaseUntil < w.leaseUntil.lt)) return false;
  if (w.OR && !w.OR.some((o: any) => matchWhere(row, o))) return false;
  return true;
};
let seq = 0;

export const created: { orders: any[]; mobileOrders: any[]; customers: any[] } = { orders: [], mobileOrders: [], customers: [] };

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
    findFirst: async () => null,
    create: async ({ data }: any) => { const r = { id: `wh${++seq}`, ...data }; store.webhookEvents.push(r); return r; },
    update: async ({ where, data }: any) => { const r = store.webhookEvents.find(e => e.id === where.id); Object.assign(r || {}, data); return r; },
  },
  order: {
    create: async ({ data }: any) => {
      const o = { id: `ord${++seq}`, ...data, items: (data.items?.create || []).map((it: any) => ({ ...it })) };
      created.orders.push(o); store.orders.set(o.id, o); return { ...o };
    },
    findUnique: async ({ where }: any) => { await tick(); const o = findOrder(where); return o ? { ...o } : null; },
    findFirst: async ({ where }: any) => findOrder(where || {}),
    update: async ({ where, data }: any) => { const o = findOrder(where); store.calls.push(`order.update:${o?.id}:${data.paymentStatus ?? ''}`); Object.assign(o, data); return { ...o }; },
    updateMany: async ({ where, data }: any) => { const o = findOrder(where); if (o) Object.assign(o, data); store.calls.push(`order.updateMany:${o?.id}:${data.paymentStatus ?? ''}`); return { count: o ? 1 : 0 }; },
    // Missed-purchase recovery scan (lib/meta/purchase.ts): orderType / paymentStatus.in / createdAt range.
    findMany: async ({ where = {}, take, orderBy }: any) => {
      await tick();
      const t = (d: any) => new Date(d).getTime();
      const dir = orderBy?.createdAt === 'asc' ? 1 : -1;
      return [...store.orders.values()].filter(o =>
        (!where.id?.in || where.id.in.includes(o.id)) &&
        (where.orderType === undefined || o.orderType === where.orderType) &&
        (!where.paymentStatus?.in || where.paymentStatus.in.includes(o.paymentStatus)) &&
        (!where.createdAt?.gt || t(o.createdAt) > t(where.createdAt.gt)) &&
        (!where.createdAt?.lt || t(o.createdAt) < t(where.createdAt.lt)),
      ).sort((a, b) => dir * (t(a.createdAt) - t(b.createdAt))).slice(0, take ?? Infinity).map(o => ({ ...o }));
    },
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
