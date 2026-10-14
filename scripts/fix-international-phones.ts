/**
 * One-off repair of phone numbers the checkout stored WITHOUT their country code.
 *
 * Until lib/countries.ts validatePhoneNumber was fixed, a customer outside India
 * who typed a national number ("415 555 2671", "07700 900123") had it saved as
 * "+" + digits ("+4155552671", "+07700900123"): a number of nobody, so calls,
 * WhatsApp messages and ad matching (Snap / Meta) could not use it. New orders
 * are stored correctly; this script repairs the saved addresses (and the
 * customer record that carries the same value) using the address's country.
 *
 *   DRY RUN (default, changes nothing):  npx tsx scripts/fix-international-phones.ts
 *   Apply the unambiguous repairs:       npx tsx scripts/fix-international-phones.ts --apply
 *   Also apply the ambiguous ones:       npx tsx scripts/fix-international-phones.ts --apply --include-ambiguous
 *
 * "Unambiguous" = the stored value is not a VALID phone number as written (of any
 * country), and the digits make a number of the address's country. "Ambiguous" =
 * the stored value is a valid number of another country as written AND a valid
 * number of the address's country (e.g. "+6045550199" is a real Malaysian number
 * and the Vancouver number 604-555-0199); those are listed for review and left
 * alone unless --include-ambiguous is given — check them one by one first, since
 * a customer may really have typed a foreign number with its country code.
 * Reads .env.production / .env.local for DATABASE_URL (scripts/load-env.ts), like the other maintenance scripts.
 */
import './load-env';
import prisma from '@/lib/db';
import { repairStoredPhone } from '@/lib/tracking/phone';
import { toCountryIso } from '@/lib/tracking/identity-normalize';

const APPLY = process.argv.includes('--apply');
const INCLUDE_AMBIGUOUS = process.argv.includes('--include-ambiguous');
const BATCH = 500;

type Row = { id: string; customerId: string; phone: string | null; country: string };
type Plan = { address: Row; iso: string; next: string; ambiguous: boolean };

function planRepair(address: Row): Plan | null {
  const iso = toCountryIso(address.country);
  if (!iso || iso === 'IN') return null; // Indian numbers were always stored correctly
  const repair = repairStoredPhone(address.phone, iso);
  return repair ? { address, iso, ...repair } : null;
}

async function main() {
  console.log(`[fix-international-phones] ${APPLY ? 'APPLY' : 'DRY RUN'}${APPLY && INCLUDE_AMBIGUOUS ? ' (including ambiguous rows)' : ''}`);

  const plans: Plan[] = [];
  let cursor: string | undefined;
  for (;;) {
    const rows: Row[] = await prisma.address.findMany({
      where: { country: { not: 'India' }, phone: { not: null } },
      select: { id: true, customerId: true, phone: true, country: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const r of rows) {
      const plan = planRepair(r);
      if (plan) plans.push(plan);
    }
    if (rows.length < BATCH) break;
    cursor = rows[rows.length - 1].id;
  }

  const unambiguous = plans.filter(p => !p.ambiguous);
  const ambiguous = plans.filter(p => p.ambiguous);
  console.log(`addresses to repair: ${unambiguous.length} unambiguous, ${ambiguous.length} ambiguous`);
  for (const p of plans) {
    console.log(`  ${p.ambiguous ? 'REVIEW ' : 'fix    '} address ${p.address.id} (${p.iso}): ${p.address.phone} → ${p.next}`);
  }
  if (!APPLY) {
    console.log('dry run — nothing written. Re-run with --apply to write the unambiguous repairs.');
    return;
  }

  const todo = INCLUDE_AMBIGUOUS ? plans : unambiguous;
  let addresses = 0, customers = 0;
  for (const p of todo) {
    const last10 = p.next.replace(/\D/g, '').slice(-10);
    await prisma.address.update({ where: { id: p.address.id }, data: { phone: p.next, phoneLast10: last10 } });
    addresses++;
    // The customer record carries the same wrong value when this address was saved last.
    const changed = await prisma.customer.updateMany({
      where: { id: p.address.customerId, phone: p.address.phone },
      data: { phone: p.next, phoneLast10: last10 },
    });
    customers += changed.count;
  }
  console.log(`done: ${addresses} address(es) and ${customers} customer record(s) repaired.`);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('[fix-international-phones] failed:', err?.message || err); process.exit(1); });
