/**
 * iOS + Android: /api/app/payment/verify answering paymentState "pending_capture"
 * must NOT produce the success state (no success UI, no order sync, no cart clear).
 * Drives the real useRazorpay hooks with fake React / RN / Razorpay bridge and a
 * scripted verify endpoint; also checks the payment screens statically.
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-app.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/app-pending-capture.ts
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
let passed = 0, failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });

// Accelerated clock for the capture poll (4 s steps) — other timers stay real.
const realSetTimeout = global.setTimeout;
let clockOffset = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + clockOffset;
(global as any).setTimeout = (fn: (...a: any[]) => void, ms?: number, ...args: any[]) => {
  if (ms === 4000) { clockOffset += ms; return setImmediate(() => fn(...args)) as any; }
  return realSetTimeout(fn, ms, ...args);
};

type Script = Array<'pending' | 'captured'>;
let verifyCalls = 0, failedEmailCalls = 0;
let script: Script = [];
(global as any).fetch = async (url: string) => {
  if (url.endsWith('/api/app/payment/verify')) {
    const state = script[Math.min(verifyCalls, script.length - 1)];
    verifyCalls++;
    const body = { success: true, orderId: 'local_1', orderNumber: 'ZB81001', paymentState: state === 'captured' ? 'captured' : 'pending_capture' };
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  }
  if (url.endsWith('/api/app/checkout/payment-failed')) { failedEmailCalls++; return { ok: true, status: 200, json: async () => ({}) }; }
  return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
};

async function run(app: 'ZicaBella' | 'ZicaBella-android', label: string, s: Script) {
  const react: any = await import('./app-fakes/react');
  const hookMod: any = await import(path.join(ROOT, app, 'src/hooks/useRazorpay.ts'));
  react.resetHookState();
  verifyCalls = 0; failedEmailCalls = 0; clockOffset = 0; script = s;
  const h = hookMod.useRazorpay();
  await h.startPayment('card', {
    amount: 3797, orderId: 'order_HOOK1', razorpayKeyId: 'rzp_test_1',
    cardNumber: '4111111111111111', cardExpiry: '12/30', cardCvv: '123', prefill: { email: 'a@b.co', contact: '9876543210' },
  }).catch(() => {});
  return { calls: react.calls, verifyCalls, failedEmailCalls, hookMod };
}

async function main() {
  for (const app of ['ZicaBella', 'ZicaBella-android'] as const) {
    const tag = app === 'ZicaBella' ? 'iOS' : 'Android';
    console.log(`\n— ${tag} useRazorpay`);

    // 1. Authorized, never captured within the wait window
    let r = await run(app, 'pending', ['pending']);
    check(`${tag}: pending_capture → status never 'success'`, !r.calls.status.includes('success'), r.calls.status);
    eq(`${tag}: pending_capture → ends in 'waiting_capture'`, r.calls.status[r.calls.status.length - 1], 'waiting_capture');
    check(`${tag}: pending_capture → no successData (screen never records the order / clears the cart)`, r.calls.successData.every((d: any) => d === null), r.calls.successData);
    check(`${tag}: pending_capture → shopper told not to pay again`, r.calls.error.some((e: any) => e === r.hookMod.CAPTURE_PENDING_MESSAGE));
    check(`${tag}: pending_capture → kept polling verify (${r.verifyCalls} calls)`, r.verifyCalls > 10, r.verifyCalls);
    eq(`${tag}: pending_capture → NOT reported as a failed payment (no failure email)`, r.failedEmailCalls, 0);

    // 2. Authorized first, captured on the 3rd verify → success only then
    r = await run(app, 'late', ['pending', 'pending', 'captured']);
    eq(`${tag}: late capture → waiting_capture before success`, r.calls.status.slice(-2), ['waiting_capture', 'success']);
    eq(`${tag}: late capture → success after the 3rd verify`, r.verifyCalls, 3);
    eq(`${tag}: late capture → successData set once`, r.calls.successData.filter((d: any) => d).length, 1);

    // 3. Captured immediately → success (unchanged behaviour)
    r = await run(app, 'captured', ['captured']);
    eq(`${tag}: captured → success, no waiting`, [r.calls.status.includes('waiting_capture'), r.calls.status[r.calls.status.length - 1], r.verifyCalls], [false, 'success', 1]);

    // Screen: waiting_capture disables Pay and shows a "confirming" view; the cart is
    // only cleared by recordOrderOnBackend, which only runs on status 'success'.
    const screen = fs.readFileSync(path.join(ROOT, app, 'src/screens/checkout/RazorpayPaymentScreen.tsx'), 'utf8');
    check(`${tag} screen: Pay disabled while waiting_capture`, /isProcessing = [^\n]*status === 'waiting_capture'/.test(screen));
    check(`${tag} screen: dedicated CONFIRMING PAYMENT view for waiting_capture`, /if \(status === 'waiting_capture'\) \{[\s\S]{0,1200}CONFIRMING PAYMENT/.test(screen));
    const recordCalls = [...screen.matchAll(/recordOrderOnBackend\(successData\.paymentId/g)].length;
    check(`${tag} screen: order sync / cart clear only from the success state`, /if \(status === 'success' && successData\) \{[\s\S]{0,700}recordOrderOnBackend\(successData\.paymentId/.test(screen) && recordCalls <= 2, recordCalls);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
