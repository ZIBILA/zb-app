/**
 * Verify COD upfront → Shiprocket fields (no Razorpay).
 * Example: order ₹1999, upfront ₹99 → sub_total 1999, total_discount 99 → collectable 1900
 *
 *   npx tsx scripts/test-cod-shiprocket-deduction.ts
 *   npx tsx scripts/test-cod-shiprocket-deduction.ts 1999 99
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import {
  buildShiprocketPaymentFields,
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

  const fields = buildShiprocketPaymentFields({
    orderTotal,
    upfrontPaid,
    isCod: true,
  });

  // Exact fields shipOrder sends
  const shiprocketPayload = {
    payment_method: fields.payment_method,
    sub_total: fields.sub_total,
    ...(fields.total_discount != null ? { total_discount: fields.total_discount } : {}),
  };

  console.log('\n=== COD → Shiprocket deduction test (no Razorpay) ===\n');
  console.log(`Dashboard configured fee : ₹${configured}`);
  console.log(`Order total              : ₹${orderTotal}`);
  console.log(`Upfront paid (Razorpay)  : ₹${upfrontPaid}`);
  console.log(`Balance due at delivery  : ₹${fields.codBalanceDue}`);
  console.log('\nShiprocket payload would be:');
  console.log(JSON.stringify(shiprocketPayload, null, 2));

  const expected = Math.max(0, Math.round(orderTotal - upfrontPaid));
  const shiprocketTotal = shiprocketPayload.sub_total - (shiprocketPayload.total_discount ?? 0);
  console.log(`Shiprocket will show total: ₹${shiprocketTotal} (sub_total − total_discount)`);

  if (
    fields.payment_method === 'COD' &&
    shiprocketTotal === expected &&
    shiprocketPayload.total_discount === Math.round(upfrontPaid)
  ) {
    console.log(`\n✅ PASS — Shiprocket collects ₹${expected} (sub_total − total_discount), not full ₹${orderTotal}`);
    process.exit(0);
  }

  if (fields.payment_method === 'Prepaid' && fields.codBalanceDue === 0) {
    console.log('\n✅ PASS — fully prepaid / zero COD balance → Shiprocket Prepaid');
    process.exit(0);
  }

  console.error(`\n❌ FAIL — expected sub_total ₹${expected}, got`, shiprocketPayload);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
