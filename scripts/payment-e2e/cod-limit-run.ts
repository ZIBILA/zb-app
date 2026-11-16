/**
 * Rate Card COD limit (lib/cod-limit.ts).
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/cod-limit-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test' });
import './memory-prisma';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`); };

async function main() {
  const lim = await import('../../lib/cod-limit');
  check('C1 default limit is ₹19,999', (await lim.getCodMaxOrderValue()) === 19999);
  check('C2 ₹19,999 may be COD', lim.isCodAllowedForAmount(19999, 19999));
  check('C3 ₹20,000 is prepaid only', !lim.isCodAllowedForAmount(20000, 19999));
  check('C4 the ₹31,000 order is refused', !lim.isCodAllowedForAmount(31000, 19999));
  await lim.setCodMaxOrderValue(15000, 'admin');
  check('C5 a dashboard change applies immediately', (await lim.getCodMaxOrderValue()) === 15000);
  let threw = false;
  try { await lim.setCodMaxOrderValue(0, 'admin'); } catch { threw = true; }
  check('C6 zero / negative limits are refused', threw && (await lim.getCodMaxOrderValue()) === 15000);
  check('C7 the message names the limit and the total', /₹15,000.*₹24,835/.test(lim.codLimitError(15000, 24835)));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
