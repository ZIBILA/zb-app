/**
 * Address check (lib/services/addressQuality.ts). India Post is stubbed; Shiprocket is not configured in the
 * in-memory DB, so that check is skipped (never invented).
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/address-quality-run.ts
 */
Object.assign(process.env, { NODE_ENV: 'test' });
import './memory-prisma';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`); };

const POST: Record<string, any> = {
  '700016': [{ Status: 'Success', PostOffice: [{ Name: 'Taltala', District: 'Kolkata', State: 'West Bengal' }] }],
  '201304': [{ Status: 'Success', PostOffice: [{ Name: 'Sector 37', District: 'Gautam Buddha Nagar', State: 'Uttar Pradesh' }] }],
  '999999': [{ Status: 'Error', PostOffice: null }],
};
(globalThis as any).fetch = async (url: string) => {
  const pin = String(url).split('/').pop()!;
  return new Response(JSON.stringify(POST[pin] || [{ Status: 'Error' }]), { status: 200 });
};

async function main() {
  const { checkOrderAddress } = await import('../../lib/services/addressQuality');
  const addr = (o: any) => JSON.stringify(o);
  const good = await checkOrderAddress({
    shippingAddress: addr({ name: 'Rahul Sharma', phone: '+919876543210', address1: '5B Taltala Lane, Near Lakhi Bibi Masjid', city: 'Kolkata', state: 'West Bengal', zip: '700016', country: 'India' }),
  });
  check('Q1 a complete address with a matching pincode is Excellent', good.rating === 'excellent', JSON.stringify(good.checks.filter((c) => c.level !== 'pass')));
  check('Q2 no percentage is shown unless Shiprocket returns one', good.shiprocketScore === null);

  const noHouse = await checkOrderAddress({
    shippingAddress: addr({ name: 'Rahul Sharma', phone: '9876543210', address1: 'near lakhi bibi masjid, Taltala', city: 'Kolkata', state: 'West Bengal', zip: '700016' }),
  });
  check('Q3 an address without a house / flat number is only Good and says why', noHouse.rating === 'good' && noHouse.checks.some((c) => c.id === 'house' && c.level === 'warn'));

  const wrongState = await checkOrderAddress({
    shippingAddress: addr({ name: 'A B', phone: '9876543210', address1: 'Tower 2101, Sector 137', city: 'Noida', state: 'Maharashtra', zip: '201304' }),
  });
  check('Q4 a pincode from another state is Poor, naming the real state', wrongState.rating === 'poor' && wrongState.checks.some((c) => c.id === 'pin_state' && /Uttar Pradesh/.test(c.detail || '')));

  const bad = await checkOrderAddress({ shippingAddress: addr({ name: 'Customer', phone: '12345', address1: 'Taltala', city: '', zip: '999999' }) });
  check('Q5 invalid pincode, short street, bad mobile → Poor with each problem listed',
    bad.rating === 'poor' && ['phone', 'street', 'city', 'pincode'].every((id) => bad.checks.some((c) => c.id === id && c.level === 'fail')), JSON.stringify(bad.checks));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
