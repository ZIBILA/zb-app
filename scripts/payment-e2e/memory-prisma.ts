/**
 * Generic in-memory Prisma stand-in for end-to-end route tests (test-only).
 * Any model name works. Supports the query shapes the checkout / app / webhook /
 * Snap / store-credit code uses: where (equality, in/notIn/not/contains/startsWith/
 * gt/gte/lt/lte, OR/AND/NOT, compound unique keys), include/select of the known
 * relations, nested `create`, increment/decrement, unique constraints (P2002),
 * $transaction, and nextval() for order-number sequences.
 */
type Row = Record<string, any>;
export const db: Record<string, Row[]> = {};
const seqs: Record<string, number> = { zb_universal_order_seq: 81000, zb_failed_order_seq: 90000, zb_refund_seq: 1000 };
let idN = 0;
const newId = () => `c${(++idN).toString(36).padStart(8, '0')}`;

const RELATIONS: Record<string, Record<string, { model: string; fk: string; one?: boolean; local?: string }>> = {
  order: {
    items: { model: 'orderItem', fk: 'orderId' },
    customer: { model: 'customer', fk: 'id', one: true, local: 'customerId' },
    payments: { model: 'payment', fk: 'orderId' },
  },
  mobileOrder: { items: { model: 'mobileOrderItem', fk: 'mobileOrderId' }, customer: { model: 'customer', fk: 'id', one: true, local: 'customerId' } },
  customer: { addresses: { model: 'address', fk: 'customerId' }, orders: { model: 'order', fk: 'customerId' } },
  orderItem: { order: { model: 'order', fk: 'id', one: true, local: 'orderId' }, product: { model: 'product', fk: 'id', one: true, local: 'productId' } },
};
const UNIQUE: Record<string, string[][]> = {
  order: [['razorpayOrderId'], ['razorpayPaymentId'], ['internalOrderNumber']],
  storeCredit: [['idempotencyKey']],
  adConversionDelivery: [['platform', 'eventName', 'orderId']],
  orderItem: [['shopifyLineItemId']],
  newsletterSubscriber: [['email']],
};
const DEFAULTS: Record<string, Row> = {
  order: { currency: 'INR', paymentStatus: 'pending', status: 'pending', orderType: 'REGULAR', shopifySyncStatus: 'synced', refundStatus: 'not_applicable', discountAmount: 0, storeCreditAmount: 0, codUpfrontPaid: 0 },
  customer: { storeCredits: 0 },
  storeCredit: { remainingAmount: 0 },
  adConversionDelivery: { status: 'pending', attempts: 0, leaseUntil: null, eventTime: null, sentAt: null, lastError: null, context: null },
};
const table = (m: string) => (db[m] ||= []);

function cmp(v: any, cond: any, key = ''): boolean {
  if (cond === undefined) return true;
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  if (typeof cond !== 'object' || Array.isArray(cond)) return v === cond;
  const ci = cond.mode === 'insensitive';
  const norm = (x: any) => (ci && typeof x === 'string' ? x.toLowerCase() : x);
  for (const [op, arg] of Object.entries<any>(cond)) {
    if (op === 'mode') continue;
    const a = norm(arg), x = norm(v);
    if (op === 'equals' && x !== a) return false;
    if (op === 'in' && !arg.map(norm).includes(x)) return false;
    if (op === 'notIn' && (x === null || x === undefined || arg.map(norm).includes(x))) return false;
    if (op === 'not' && (typeof arg === 'object' && arg !== null ? cmp(v, arg) : x === a)) return false;
    if (op === 'contains' && !(typeof x === 'string' && x.includes(a))) return false;
    if (op === 'startsWith' && !(typeof x === 'string' && x.startsWith(a))) return false;
    if (op === 'endsWith' && !(typeof x === 'string' && x.endsWith(a))) return false;
    if (op === 'gt' && !(v > arg)) return false;
    if (op === 'gte' && !(v >= arg)) return false;
    if (op === 'lt' && !(v < arg)) return false;
    if (op === 'lte' && !(v <= arg)) return false;
    if (['some', 'every', 'none', 'is', 'isNot'].includes(op)) return true; // relation filters: not modelled
  }
  return true;
}
function match(model: string, row: Row, where: any): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries<any>(where)) {
    if (k === 'OR') { if (!cond.some((c: any) => match(model, row, c))) return false; continue; }
    if (k === 'AND') { if (!(Array.isArray(cond) ? cond : [cond]).every((c: any) => match(model, row, c))) return false; continue; }
    if (k === 'NOT') { if ((Array.isArray(cond) ? cond : [cond]).some((c: any) => match(model, row, c))) return false; continue; }
    if (RELATIONS[model]?.[k]) continue;
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && k.includes('_') && !(k in row) && Object.keys(cond).every(f => !['equals','in','notIn','not','contains','startsWith','endsWith','gt','gte','lt','lte','mode'].includes(f))) {
      if (!match(model, row, cond)) return false; // compound unique key
      continue;
    }
    if (!cmp(row[k], cond, k)) return false;
  }
  return true;
}
function project(model: string, row: Row | undefined, args: any = {}): any {
  if (!row) return null;
  const out: Row = { ...row };
  const inc = { ...(args.include || {}), ...Object.fromEntries(Object.entries(args.select || {}).filter(([k, v]) => RELATIONS[model]?.[k] && v)) };
  for (const [rel, spec] of Object.entries<any>(inc)) {
    const r = RELATIONS[model]?.[rel];
    if (!r || !spec) continue;
    const sub = typeof spec === 'object' ? spec : {};
    if (r.one) out[rel] = project(r.model, table(r.model).find(x => x[r.fk] === row[r.local!]), sub);
    else out[rel] = table(r.model).filter(x => x[r.fk] === row.id && match(r.model, x, sub.where)).map(x => project(r.model, x, sub)).slice(0, sub.take ?? Infinity);
  }
  if (args.select) {
    const picked: Row = {};
    for (const [k, v] of Object.entries<any>(args.select)) if (v) picked[k] = out[k];
    return picked;
  }
  return out;
}
function checkUnique(model: string, row: Row, selfId?: string) {
  for (const cols of UNIQUE[model] || []) {
    if (cols.some(c => row[c] === null || row[c] === undefined)) continue;
    if (table(model).some(o => o.id !== selfId && cols.every(c => o[c] === row[c]))) {
      const e: any = new Error(`Unique constraint failed on ${model}(${cols.join(',')})`); e.code = 'P2002'; throw e;
    }
  }
}
function applyData(model: string, row: Row, data: Row) {
  const nested: Array<[string, any]> = [];
  for (const [k, v] of Object.entries<any>(data)) {
    if (RELATIONS[model]?.[k] && v && typeof v === 'object') { nested.push([k, v]); continue; }
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && ('increment' in v || 'decrement' in v || 'set' in v)) {
      if ('increment' in v) row[k] = (row[k] || 0) + v.increment;
      if ('decrement' in v) row[k] = (row[k] || 0) - v.decrement;
      if ('set' in v) row[k] = v.set;
      continue;
    }
    if (v && typeof v === 'object' && 'connect' in v) continue;
    row[k] = v;
  }
  return nested;
}
function runNested(model: string, parent: Row, nested: Array<[string, any]>) {
  for (const [rel, spec] of nested) {
    const r = RELATIONS[model][rel];
    const creates = spec.create ? (Array.isArray(spec.create) ? spec.create : [spec.create]) : spec.createMany?.data || [];
    for (const c of creates) createRow(r.model, { ...c, [r.fk]: parent.id });
  }
}
function createRow(model: string, data: Row): Row {
  const row: Row = { id: data.id || newId(), createdAt: new Date(), updatedAt: new Date(), ...(DEFAULTS[model] || {}) };
  const nested = applyData(model, row, data);
  checkUnique(model, row);
  table(model).push(row);
  runNested(model, row, nested);
  return row;
}
const tick = () => new Promise(r => setImmediate(r));

function modelApi(model: string) {
  return {
    findUnique: async (a: any) => { await tick(); return project(model, table(model).find(r => match(model, r, a.where)), a); },
    findUniqueOrThrow: async (a: any) => { await tick(); const r = table(model).find(x => match(model, x, a.where)); if (!r) throw new Error('not found'); return project(model, r, a); },
    findFirst: async (a: any = {}) => { await tick(); const rows = sort(table(model).filter(r => match(model, r, a.where)), a.orderBy); return project(model, rows[0], a); },
    findMany: async (a: any = {}) => { await tick(); const rows = sort(table(model).filter(r => match(model, r, a.where)), a.orderBy).slice(a.skip || 0, (a.skip || 0) + (a.take ?? Infinity)); return rows.map(r => project(model, r, a)); },
    count: async (a: any = {}) => { await tick(); return table(model).filter(r => match(model, r, a.where)).length; },
    create: async (a: any) => { await tick(); return project(model, createRow(model, a.data), a); },
    createMany: async (a: any) => { await tick(); for (const d of a.data) createRow(model, d); return { count: a.data.length }; },
    update: async (a: any) => {
      await tick();
      const row = table(model).find(r => match(model, r, a.where));
      if (!row) { const e: any = new Error(`${model} not found`); e.code = 'P2025'; throw e; }
      const copy = { ...row }; const nested = applyData(model, copy, a.data); checkUnique(model, copy, row.id);
      Object.assign(row, copy, { updatedAt: new Date() }); runNested(model, row, nested);
      return project(model, row, a);
    },
    updateMany: async (a: any) => {
      await tick(); let count = 0;
      for (const row of table(model).filter(r => match(model, r, a.where))) { applyData(model, row, a.data); row.updatedAt = new Date(); count++; }
      return { count };
    },
    upsert: async (a: any) => {
      await tick();
      const row = table(model).find(r => match(model, r, a.where));
      if (row) { applyData(model, row, a.update); return project(model, row, a); }
      return project(model, createRow(model, { ...a.create }), a);
    },
    delete: async (a: any) => { await tick(); const i = table(model).findIndex(r => match(model, r, a.where)); const [r] = table(model).splice(i, 1); return r; },
    deleteMany: async (a: any = {}) => { await tick(); const before = table(model).length; db[model] = table(model).filter(r => !match(model, r, a.where)); return { count: before - db[model].length }; },
    aggregate: async (a: any) => { await tick(); const rows = table(model).filter(r => match(model, r, a.where)); const out: any = {}; if (a._sum) { out._sum = {}; for (const k of Object.keys(a._sum)) out._sum[k] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0); } if (a._count) out._count = rows.length; return out; },
    groupBy: async () => [],
  };
}
function sort(rows: Row[], orderBy: any) {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const s of specs) { const [k, dir] = Object.entries<any>(s)[0]; if (a[k] === b[k]) continue; const r = a[k] > b[k] ? 1 : -1; return dir === 'desc' ? -r : r; }
    return 0;
  });
}
const apis: Record<string, any> = {};
const prisma: any = new Proxy({}, {
  get(_, prop: string) {
    if (prop === '_isMock') return true; // rate-limit uses its in-memory fallback
    if (prop === '$transaction') return async (fn: any) => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn));
    if (prop === '$queryRawUnsafe' || prop === '$queryRaw') return async (q: any) => {
      const m = String(Array.isArray(q) ? q.join('') : q).match(/nextval\('(\w+)'\)/);
      if (m) return [{ seq_val: ++seqs[m[1]] }];
      return [];
    };
    if (prop.startsWith('$')) return async () => 0;
    if (prop === 'then') return undefined;
    return (apis[prop] ||= modelApi(prop));
  },
});
export default prisma;
