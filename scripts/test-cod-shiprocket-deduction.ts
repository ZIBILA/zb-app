/**
 * Verify COD upfront deduction for Shiprocket — no Razorpay required.
 *
 * Example from the requirement:
 *   order ₹1,999 − upfront ₹99 → Shiprocket cod_amount ₹1,900
 *
 * Usage:
 *   npx tsx scripts/test-cod-shiprocket-deduction.ts
 *   npx tsx scripts/test-cod-shiprocket-deduction.ts 1999 99
 *   npx tsx scripts/test-cod-shiprocket-deduction.ts 1999 199
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import {
  getCodBalanceDue,
  getConfiguredCodUpfrontAmount,
  normalizeCodUpfrontAmount,
  DEFAULT_COD_UPFRONT_AMOUNT,
} from '../lib/cod-upfront';

async function main() {
  const orderTotal = Number(process.argv[2] || 1999);
  const upfrontArg = process.argv[3];

  const configured = await getConfiguredCodUpfrontAmount();
  const upfrontPaid = upfrontArg !== undefined
    ? normalizeCodUpfrontAmount(upfrontArg, DEFAULT_COD_UPFRONT_AMOUNT)
    : configured;

  const balanceDue = getCodBalanceDue(orderTotal, upfrontPaid);
  const paymentMethod = balanceDue > 0 ? 'COD' : 'Prepaid';

  // Exact fields our Shiprocket booking path sends (see lib/services/logistics.ts)
  const shiprocketPayload = {
    payment_method: paymentMethod,
    ...(paymentMethod === 'COD' ? { cod_amount: Math.round(balanceDue) } : {}),
    sub_total: orderTotal,
  };

  console.log('\n=== COD → Shiprocket deduction test (no Razorpay) ===\n');
  console.log(`Dashboard configured fee : ₹${configured}`);
  console.log(`Order total              : ₹${orderTotal}`);
  console.log(`Upfront paid (Razorpay)  : ₹${upfrontPaid}`);
  console.log(`Balance due at delivery  : ₹${balanceDue}`);
  console.log('\nShiprocket payload would be:');
  console.log(JSON.stringify(shiprocketPayload, null, 2));

  const expected = Math.max(0, Math.round(orderTotal - upfrontPaid));
  if (shiprocketPayload.cod_amount === expected && paymentMethod === 'COD') {
    console.log(`\n✅ PASS — Shiprocket collects ₹${expected}, not full ₹${orderTotal}`);
    process.exit(0);
  }

  if (paymentMethod === 'Prepaid' && balanceDue === 0) {
    console.log('\n✅ PASS — fully prepaid / zero COD balance → Shiprocket Prepaid');
    process.exit(0);
  }

  console.error(`\n❌ FAIL — expected cod_amount ₹${expected}, got`, shiprocketPayload);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
