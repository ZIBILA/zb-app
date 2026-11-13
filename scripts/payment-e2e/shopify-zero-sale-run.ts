/**
 * A ₹0 order (100% store credit / coupon) must reach Shopify without a ₹0 sale transaction, which Shopify rejects
 * with 422 "Amount must be greater than zero for sale transactions" (#ZB81594). fetch is stubbed: nothing leaves.
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/shopify-zero-sale-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test', SHOPIFY_STORE_DOMAIN: 'test-shop.myshopify.com', SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test' });

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`);
}

const sent: any[] = [];
(globalThis as any).fetch = async (_url: string, init: any) => {
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ order: { id: 1 } }), { status: 201, headers: { 'content-type': 'application/json' } });
};

async function main() {
  const { createOrder } = await import('../../lib/shopify-admin');
  const base = { line_items: [{ variant_id: 1, quantity: 1, price: '4999.00' }], financial_status: 'paid', discount_codes: [{ code: 'STORE_CREDIT', amount: '4999.00', type: 'fixed_amount' }] };

  await createOrder({ ...base, transactions: [{ kind: 'sale', status: 'success', amount: '0.00', gateway: 'manual' }] });
  check('Z1 a ₹0 sale transaction is not sent', sent[0]?.order && !('transactions' in sent[0].order), JSON.stringify(sent[0]));
  check('Z2 the order is still sent as paid', sent[0]?.order?.financial_status === 'paid');

  await createOrder({ ...base, transactions: [{ kind: 'sale', status: 'success', amount: '2589.00', gateway: 'razorpay' }] });
  check('Z3 a real payment transaction is kept', sent[1]?.order?.transactions?.[0]?.amount === '2589.00');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
