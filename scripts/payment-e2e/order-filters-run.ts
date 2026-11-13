/**
 * Dashboard order filters (lib/order-filters.ts as used by /api/admin/orders).
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/order-filters-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test' });
import { db } from './memory-prisma';
import { IS_CANCELLED_WHERE, WAS_PLACED_WHERE, NEVER_PLACED_WHERE, cancellationSource } from '../../lib/order-filters';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`); };

const o = (id: string, extra: Record<string, any>) => (db.order ||= []).push({
  id, status: 'open', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled', deliveryStatus: 'pending', orderType: 'REGULAR',
  internalOrderNumber: id.toUpperCase(), shopifyOrderId: null, cancelledAt: null, cancelledBy: null, codUpfrontPaid: 0,
  refundId: null, refundStatus: 'not_applicable', paymentCapturedAt: null, previousOrderNumbers: null, delhivery_awb: null,
  createdAt: new Date(), ...extra,
});

async function main() {
  const prisma = (await import('./memory-prisma')).default as any;
  o('active_paid', { shopifyOrderId: '111' });
  o('active_cod', { paymentStatus: 'cod_upfront_paid', codUpfrontPaid: 99, paymentMethod: 'cod' });
  o('admin_cancelled', { status: 'cancelled', paymentStatus: 'refunded', cancelledBy: 'admin', cancelledAt: new Date(), internalOrderNumber: 'ZBCC90001', previousOrderNumbers: 'ZB81594', fulfillmentStatus: 'unfulfilled' });
  o('cust_cancelled_cod', { status: 'cancelled', paymentStatus: 'cancelled', codUpfrontPaid: 99, cancelledBy: 'user', cancelledAt: new Date(), fulfillmentStatus: 'cancelled', paymentMethod: 'cod' });
  o('upper_cancelled', { status: 'CANCELLED', paymentStatus: 'paid', shopifyOrderId: '222', fulfillmentStatus: 'unfulfilled' });
  o('checkout_abandoned', { status: 'cancelled', paymentStatus: 'cancelled', cancelledBy: 'customer', cancelledAt: new Date(), internalOrderNumber: 'ZBPP90002' });
  o('payment_failed', { status: 'FAILED', paymentStatus: 'failed', internalOrderNumber: 'ZBPF90003' });
  o('pending_payment', { status: 'payment_pending', paymentStatus: 'payment_pending', internalOrderNumber: 'ZBPP90004' });

  const ids = async (where: any) => (await prisma.order.findMany({ where })).map((r: any) => r.id).sort();
  const gate = [WAS_PLACED_WHERE, { NOT: NEVER_PLACED_WHERE }];

  const all = await ids({ AND: gate });
  check('F1 All = every placed order, cancelled ones included', JSON.stringify(all) === JSON.stringify(['active_cod', 'active_paid', 'admin_cancelled', 'cust_cancelled_cod', 'upper_cancelled']), JSON.stringify(all));
  check('F2 All never shows failed payments or abandoned checkouts', !all.some((i: string) => ['checkout_abandoned', 'payment_failed', 'pending_payment'].includes(i)));

  const cancelled = await ids({ AND: [...gate, IS_CANCELLED_WHERE, WAS_PLACED_WHERE] });
  check('F3 Cancelled shows every order cancelled after placement (any spelling, any refund state)', JSON.stringify(cancelled) === JSON.stringify(['admin_cancelled', 'cust_cancelled_cod', 'upper_cancelled']), JSON.stringify(cancelled));
  check('F4 an abandoned checkout is not a cancelled order', !cancelled.includes('checkout_abandoned'));

  const unfulfilled = await ids({ AND: [...gate, { fulfillmentStatus: 'unfulfilled' }, { NOT: IS_CANCELLED_WHERE }, { shipments: { none: { awb: { not: null } } } }] });
  check('F5 Unfulfilled excludes cancelled orders (incl. "CANCELLED")', JSON.stringify(unfulfilled) === JSON.stringify(['active_cod', 'active_paid']), JSON.stringify(unfulfilled));

  const search = await ids({ AND: [...gate, { OR: [{ internalOrderNumber: { contains: 'ZB81594', mode: 'insensitive' } }, { previousOrderNumbers: { contains: 'ZB81594', mode: 'insensitive' } }] }] });
  check('F6 a renumbered cancelled order is found by its original order ID', JSON.stringify(search) === JSON.stringify(['admin_cancelled']), JSON.stringify(search));

  const src = (id: string) => cancellationSource(db.order.find((x) => x.id === id));
  check('F7 source tags: admin / customer / none', src('admin_cancelled') === 'admin' && src('cust_cancelled_cod') === 'customer' && src('active_paid') === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
