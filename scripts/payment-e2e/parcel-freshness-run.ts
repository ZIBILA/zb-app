/**
 * Parcel messages only for a recent carrier scan (lib/notifications/customer-events.ts: isFreshParcelEvent).
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/parcel-freshness-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test' });
import './memory-prisma';
import { isFreshParcelEvent } from '../../lib/notifications/customer-events';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const H = 3600 * 1000;
const ev = (hoursAgo: number) => JSON.stringify([{ status: 'Delivered', timestamp: new Date(Date.now() - hoursAgo * H).toISOString() }]);
const order = (daysOld: number) => ({ createdAt: new Date(Date.now() - daysOld * 24 * H) });

check('P1 delivered 2 hours ago → tell the customer', isFreshParcelEvent(order(5), { events: ev(2) }));
check('P2 delivered 10 days ago, found by a late poll → do not message', !isFreshParcelEvent(order(14), { events: ev(240) }));
check('P3 …even though our own record was updated just now', !isFreshParcelEvent(order(14), { events: ev(240), updatedAt: new Date() }));
check('P4 no scan history, order placed 3 days ago → allowed', isFreshParcelEvent(order(3), { events: '[]' }));
check('P5 no scan history, order placed 30 days ago → not allowed', !isFreshParcelEvent(order(30), null));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
