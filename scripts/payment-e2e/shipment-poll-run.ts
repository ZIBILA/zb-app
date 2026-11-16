/**
 * A carrier poll must not rewrite an order whose status did not change (it bumped Order.updatedAt every 15 minutes and
 * kept old orders re-entering the customer-message scanners).
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/shipment-poll-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test' });
import prisma, { db } from './memory-prisma';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`); };

async function main() {
  (db.order ||= []).push({ id: 'o1', paymentStatus: 'paid', paymentMethod: 'razorpay', tags: '', deliveryStatus: 'shipped', tracking_status: 'In Transit', deliveredAt: null, internalOrderNumber: 'ZB1', razorpayOrderId: null, shopifyOrderId: null, note: null });
  (db.shipment ||= []).push({ id: 's1', orderId: 'o1', awb: 'AWB1', status: 'in_transit', type: 'outbound', events: '[]' });

  let orderWrites = 0;
  const realUpdate = (prisma as any).order.update.bind((prisma as any).order);
  (prisma as any).order.update = async (args: any) => { orderWrites += 1; return realUpdate(args); };

  const { applyShipmentStatusUpdate } = await import('../../lib/services/shipmentStatusService');
  const same = await applyShipmentStatusUpdate({ shipmentId: 's1', rawStatus: 'In Transit' } as any);
  check('P1 the same status again → reported as unchanged', same.applied === false, JSON.stringify(same));
  check('P2 …and the order was not written at all', orderWrites === 0, String(orderWrites));

  const moved = await applyShipmentStatusUpdate({ shipmentId: 's1', rawStatus: 'Out For Delivery' } as any);
  check('P3 a real change is applied', moved.applied === true && db.order[0].deliveryStatus === 'out_for_delivery' && db.order[0].tracking_status === 'Out For Delivery');
  const before = orderWrites;
  await applyShipmentStatusUpdate({ shipmentId: 's1', rawStatus: 'Out For Delivery' } as any);
  check('P4 and repeating it writes nothing more', orderWrites === before, `${before} → ${orderWrites}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
