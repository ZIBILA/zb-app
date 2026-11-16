/**
 * Abandoned-cart WhatsApp scheduler scenarios (no Meta credentials: every send fails, which still records the
 * step-1 attempt, so we can see which carts the scheduler reached).
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/cart-recovery-run.ts
 */
Object.assign(process.env, {
  NODE_ENV: 'test',
  WHATSAPP_PHONE_NUMBER_ID: '',
  WHATSAPP_ACCESS_TOKEN: '',
  WHATSAPP_TOKEN: '',
  WHATSAPP_API_TOKEN: '',
});

import { db } from './memory-prisma';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`);
}

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const ago = (ms: number) => new Date(Date.now() - ms);
let n = 0;

function addCart(opts: { phone: string; idleMs: number; createdMs?: number; stagesSent?: number[] }) {
  const id = `cart_${++n}`;
  (db.cart ||= []).push({
    id, status: 'active', phone: opts.phone, phoneLast10: opts.phone.slice(-10), customerId: null, email: null,
    convertedOrderId: null, subtotal: 1999, createdAt: ago(opts.createdMs ?? opts.idleMs), lastActivityAt: ago(opts.idleMs),
  });
  (db.cartItem ||= []).push({ id: `ci_${id}`, cartId: id, title: 'Shirt', image: '', handle: 'shirt', productId: null });
  for (const stage of opts.stagesSent || []) {
    (db.whatsAppMessage ||= []).push({
      id: `m_${id}_${stage}`, direction: 'outbound', phoneNumber: `91${opts.phone}`, cartId: id, recoveryStage: stage,
      status: 'sent', templateName: `abandoned_cart_a${stage}`, body: `Cart: ${id}`, createdAt: ago(opts.idleMs - stage * MIN),
      sentAt: ago(opts.idleMs - stage * MIN),
    });
  }
  return id;
}
const stageRows = (cartId: string, stage = 1) => (db.whatsAppMessage || []).filter((m) => m.cartId === cartId && m.recoveryStage === stage);

async function main() {
  // These scenarios act on pre-built data, so the go-live marker is set far in the past (go-live-run.ts proves history is skipped).
  (db.customerEventDelivery ||= []).push({ id: 'gl_seed', eventKey: '__fixes_go_live__', channel: 'system', eventType: 'SCANNER_INIT', status: 'sent', createdAt: new Date(0), updatedAt: new Date(0) });
  // Template definition in the DB so nothing is fetched from Meta.
  (db.whatsAppTemplate ||= []).push(
    ...['abandoned_cart_a1', 'abandoned_cart_a2', 'abandoned_cart_a3'].map((name) => ({
      id: name, name, status: 'APPROVED', language: 'en', category: 'MARKETING', updatedAt: new Date(),
      components: [{ type: 'BODY', text: 'Hi {{1}}, your cart is waiting.' }],
    }))
  );

  // 80 older carts already past steps 1 and 2, waiting for the 7-day step: the old query (50 oldest) only saw these.
  for (let i = 0; i < 80; i++) addCart({ phone: `90000${String(i).padStart(5, '0')}`, idleMs: 5 * DAY, stagesSent: [1, 2] });
  const fresh = addCart({ phone: '9876500001', idleMs: 30 * MIN });
  const tooNew = addCart({ phone: '9876500002', idleMs: 5 * MIN });
  // Same person got a step-1 reminder for a cart 20 days ago; this is a new shopping session.
  (db.whatsAppMessage ||= []).push({
    id: 'm_old_session', direction: 'outbound', phoneNumber: '919876500003', cartId: 'gone', recoveryStage: 1,
    status: 'sent', templateName: 'abandoned_cart_a1', body: 'old', createdAt: ago(20 * DAY), sentAt: ago(20 * DAY),
  });
  const returning = addCart({ phone: '9876500003', idleMs: 40 * MIN });
  // Same person got step 1 an hour ago for another cart of this session → no second step-1 reminder.
  (db.whatsAppMessage ||= []).push({
    id: 'm_same_session', direction: 'outbound', phoneNumber: '919876500004', cartId: 'other', recoveryStage: 1,
    status: 'sent', templateName: 'abandoned_cart_a1', body: 'recent', createdAt: ago(60 * MIN), sentAt: ago(60 * MIN),
  });
  const sameSession = addCart({ phone: '9876500004', idleMs: 30 * MIN, createdMs: 2 * 60 * MIN });
  // Idle for 3 days and never reminded (the old bug starved it): a reminder now would be stale.
  const stale = addCart({ phone: '9876500005', idleMs: 3 * DAY });
  // Step 1 sent 2 minutes ago, cart idle 5 h: step 2 must wait for its spacing, not follow back-to-back.
  const justStepped = addCart({ phone: '9876500006', idleMs: 5 * 60 * MIN, stagesSent: [1] });
  db.whatsAppMessage.find((m) => m.cartId === justStepped && m.recoveryStage === 1)!.createdAt = ago(2 * MIN);

  const { runWhatsAppScheduler } = await import('../../lib/whatsapp/scheduler');
  const r1 = await runWhatsAppScheduler();

  check('C1 a cart abandoned 30 min ago is reached even with 80 older carts in the window', stageRows(fresh).length === 1,
    JSON.stringify(r1.results.errors));
  check('C2 its step-1 attempt is recorded (failed here: no Meta credentials)', stageRows(fresh)[0]?.status === 'failed');
  check('C3 a cart idle for only 5 min is not messaged yet', stageRows(tooNew).length === 0);
  check('C4 a reminder from a session 20 days ago does not block a new cart', stageRows(returning).length === 1);
  check('C5 a reminder sent an hour ago for the same session blocks a second step-1', stageRows(sameSession).length === 0);
  check('C6 older carts waiting for the 7-day step get nothing yet',
    (db.whatsAppMessage || []).filter((m) => String(m.cartId).startsWith('cart_') && m.recoveryStage === 3).length === 0);

  // A second run (e.g. GitHub backup trigger right after the server job) must not re-attempt the failed step itself:
  // the retry queue owns failed sends, with backoff.
  await runWhatsAppScheduler();
  const after = stageRows(fresh);
  check('C7 a second run does not create another step-1 row', after.length === 1);
  check('C8 the failed step is left to the retry queue (not re-claimed as processing)', after[0].status === 'failed');

  check('C9 a cart idle for 3 days that was never reminded is NOT messaged now (no stale nudge)', stageRows(stale).length === 0);
  check('C10 step 2 does not follow step 1 within minutes', stageRows(justStepped, 2).length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
