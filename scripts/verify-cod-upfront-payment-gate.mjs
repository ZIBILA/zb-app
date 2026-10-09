/**
 * Unit + DB audit for COD ₹99 upfront payment gating.
 * Run: node scripts/verify-cod-upfront-payment-gate.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// Load compiled-style TS via dynamic import through tsx if available; else inline copies of pure helpers.
async function loadHelpers() {
  try {
    const { register } = await import('node:module');
    // Prefer direct import when running under npx tsx
  } catch {
    /* ignore */
  }
  const codUrl = pathToFileURL(path.join(root, 'lib/cod-upfront.ts')).href;
  const rzpUrl = pathToFileURL(path.join(root, 'lib/razorpay-payment.ts')).href;
  const cod = await import(codUrl);
  const rzp = await import(rzpUrl);
  return { cod, rzp };
}

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function runUnitTests() {
  console.log('\n== Unit: resolveStoredCodUpfrontPaid / capture binding ==');
  const { cod, rzp } = await loadHelpers();
  const { resolveStoredCodUpfrontPaid, hasRazorpayPaymentProof } = cod;
  const { isCapturedPaymentEntity } = rzp;

  ok(
    'no pay_ id → 0 even with stored 99',
    resolveStoredCodUpfrontPaid({
      storedPaid: 99,
      paymentStatus: 'cod_upfront_paid',
      paymentMethod: 'cod',
      paymentId: null,
    }) === 0
  );

  ok('hasRazorpayPaymentProof rejects pay_mock_', !hasRazorpayPaymentProof('pay_mock_123'));
  ok(
    'mock payment id → 0',
    resolveStoredCodUpfrontPaid({
      storedPaid: 99,
      paymentStatus: 'cod_upfront_paid',
      paymentMethod: 'cod',
      paymentId: 'pay_mock_123',
    }) === 0
  );

  ok(
    'invalid payment id string → 0',
    resolveStoredCodUpfrontPaid({
      storedPaid: 99,
      paymentStatus: 'cod_upfront_paid',
      paymentMethod: 'cod',
      paymentId: 'not_a_payment',
    }) === 0
  );

  ok(
    'valid pay_ + stored → stored amount',
    resolveStoredCodUpfrontPaid({
      storedPaid: 99,
      paymentStatus: 'cod_upfront_paid',
      paymentMethod: 'cod',
      paymentId: 'pay_AbCdEf123456',
    }) === 99
  );

  ok(
    'valid pay_ + status paid-like + no stored → fallback 99',
    resolveStoredCodUpfrontPaid({
      storedPaid: 0,
      paymentStatus: 'cod_upfront_paid',
      paymentMethod: 'cod',
      paymentId: 'pay_AbCdEf123456',
      configuredFallback: 99,
    }) === 99
  );

  const captured = {
    id: 'pay_AbCdEf123456',
    status: 'captured',
    captured: true,
    amount: 9900,
    amount_refunded: 0,
    order_id: 'order_ABC',
  };
  ok(
    'capture bound to matching order_id',
    isCapturedPaymentEntity(captured, { minRupees: 99, orderId: 'order_ABC' })
  );
  ok(
    'capture rejects mismatched order_id',
    !isCapturedPaymentEntity(captured, { minRupees: 99, orderId: 'order_OTHER' })
  );
  ok(
    'capture rejects missing order_id when required',
    !isCapturedPaymentEntity(
      { ...captured, order_id: null },
      { minRupees: 99, orderId: 'order_ABC' }
    )
  );
  ok(
    'authorized-only payment rejected',
    !isCapturedPaymentEntity(
      { ...captured, status: 'authorized', captured: false },
      { minRupees: 99, orderId: 'order_ABC' }
    )
  );
}

async function runDbAudit() {
  console.log('\n== DB audit: confirmed COD without pay_ proof ==');
  const prismaMod = await import(pathToFileURL(path.join(root, 'lib/db.ts')).href);
  const prisma = prismaMod.default;

  try {
    const zb81297 = await prisma.order.findFirst({
      where: {
        OR: [
          { internalOrderNumber: 'ZB81297' },
          { previousOrderNumbers: { contains: '81297' } },
          { shopifyOrderName: { contains: '81297' } },
        ],
      },
      select: {
        internalOrderNumber: true,
        status: true,
        paymentStatus: true,
        codUpfrontPaid: true,
        codUpfrontPaymentId: true,
        razorpayPaymentId: true,
        createdAt: true,
      },
    });
    console.log(
      zb81297
        ? `  ZB81297 found: ${JSON.stringify(zb81297)}`
        : '  ZB81297 not in this database (highest local ZB8* may differ from client env)'
    );

    const confirmedUnpaid = await prisma.order.findMany({
      where: {
        paymentMethod: { equals: 'cod', mode: 'insensitive' },
        status: {
          in: ['open', 'approved', 'CONFIRMED', 'ACTIVE', 'active', 'processing', 'packed', 'shipped'],
        },
        OR: [
          { paymentStatus: { in: ['cod_upfront_paid', 'partially_paid', 'paid'] } },
          { codUpfrontPaid: { gt: 0 } },
        ],
        AND: [
          {
            OR: [
              { razorpayPaymentId: null },
              { NOT: { razorpayPaymentId: { startsWith: 'pay_' } } },
            ],
          },
          {
            OR: [
              { codUpfrontPaymentId: null },
              { NOT: { codUpfrontPaymentId: { startsWith: 'pay_' } } },
            ],
          },
        ],
      },
      select: {
        internalOrderNumber: true,
        status: true,
        paymentStatus: true,
        codUpfrontPaid: true,
        createdAt: true,
      },
      take: 50,
    });
    ok(
      `no confirmed COD orders without pay_ proof (found ${confirmedUnpaid.length})`,
      confirmedUnpaid.length === 0
    );

    // Clear stale pre-create ₹99 on unpaid pending rows (display poison)
    const stale = await prisma.order.updateMany({
      where: {
        paymentMethod: { equals: 'cod', mode: 'insensitive' },
        codUpfrontPaid: { gt: 0 },
        status: { in: ['payment_pending', 'FAILED', 'failed', 'cancelled'] },
        AND: [
          {
            OR: [
              { razorpayPaymentId: null },
              { NOT: { razorpayPaymentId: { startsWith: 'pay_' } } },
            ],
          },
          {
            OR: [
              { codUpfrontPaymentId: null },
              { NOT: { codUpfrontPaymentId: { startsWith: 'pay_' } } },
            ],
          },
        ],
      },
      data: { codUpfrontPaid: 0 },
    });
    console.log(`  Cleared stale codUpfrontPaid on ${stale.count} unpaid pending/failed COD rows`);

    await prisma.webStoreOrder.updateMany({
      where: {
        paymentMethod: { equals: 'cod', mode: 'insensitive' },
        codUpfrontPaid: { gt: 0 },
        paymentStatus: { in: ['pending', 'payment_pending', 'failed', 'cancelled'] },
        AND: [
          {
            OR: [
              { razorpayPaymentId: null },
              { NOT: { razorpayPaymentId: { startsWith: 'pay_' } } },
            ],
          },
          {
            OR: [
              { codUpfrontPaymentId: null },
              { NOT: { codUpfrontPaymentId: { startsWith: 'pay_' } } },
            ],
          },
        ],
      },
      data: { codUpfrontPaid: 0 },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  console.log('COD upfront payment gate verification');
  await runUnitTests();
  await runDbAudit();
  console.log(`\nAll checks passed (${passed} assertions).\n`);
}

main().catch((err) => {
  console.error('\nFAILED:', err?.message || err);
  process.exit(1);
});
