/**
 * Already-handled customer messages are skipped up front (no template build, no insert, no error log), while
 * retryable ones are still retried. lib/notifications/customer-events.ts
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/delivery-handled-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test' });
import { db } from './memory-prisma';
import { isDeliveryHandled, deliverOnce } from '../../lib/notifications/customer-events';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`); };
const row = (key: string, extra: Record<string, any>) => (db.customerEventDelivery ||= []).push({ id: `r_${key}`, eventKey: key, channel: 'email', eventType: 'ORDER_SHIPPED', status: 'sent', error: null, createdAt: new Date(), updatedAt: new Date(), ...extra });

async function main() {
  row('k_sent', { status: 'sent' });
  row('k_fail1', { status: 'failed', error: '[attempt 1] 550 blocked' });
  row('k_fail3', { status: 'failed', error: '[attempt 3] 550 blocked' });
  row('k_sending_fresh', { status: 'sending' });
  row('k_sending_stale', { status: 'sending', updatedAt: new Date(Date.now() - 10 * 60 * 1000) });

  check('H1 no record → not handled (send it)', !(await isDeliveryHandled('k_none', 'email')));
  check('H2 sent → handled', await isDeliveryHandled('k_sent', 'email'));
  check('H3 failed once → still retryable', !(await isDeliveryHandled('k_fail1', 'email')));
  check('H4 failed 3 times → given up, handled (this was the repeated error spam)', await isDeliveryHandled('k_fail3', 'email'));
  check('H5 another worker is sending right now → handled', await isDeliveryHandled('k_sending_fresh', 'email'));
  check('H6 a send interrupted 10 minutes ago → retried', !(await isDeliveryHandled('k_sending_stale', 'email')));

  let calls = 0;
  const send = async () => { calls += 1; };
  const r3 = await deliverOnce({ eventKey: 'k_fail3', eventType: 'ORDER_SHIPPED', channel: 'email', recipient: 'a@b.co', send });
  check('H7 a given-up message is never sent again', r3 === 'duplicate' && calls === 0);
  const r1 = await deliverOnce({ eventKey: 'k_fail1', eventType: 'ORDER_SHIPPED', channel: 'email', recipient: 'a@b.co', send });
  check('H8 a message with attempts left is retried once and recorded sent', r1 === 'sent' && calls === 1 && db.customerEventDelivery.find((x) => x.eventKey === 'k_fail1')!.status === 'sent');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
