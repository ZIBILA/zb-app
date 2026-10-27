/**
 * Tests the mobile-app discount Applicability Filter (Prepaid Only / Prepaid & COD)
 * and that Web Store coupon rules keep working independently.
 *
 * Run: NODE_ENV=development npx tsx scripts/test-app-discount-applicability.ts
 * Creates ZZT* codes and removes them when finished.
 */

import prisma from '../lib/db';
import { validateAppDiscount, pickBestAutoApplyDiscount, getAppDiscountApplicabilityError } from '../lib/appDiscounts';

const green = (m: string) => `\x1b[32m✔ ${m}\x1b[0m`;
const red = (m: string) => `\x1b[31m✖ ${m}\x1b[0m`;
const cyan = (m: string) => `\x1b[36mℹ ${m}\x1b[0m`;

let passed = 0;
let failed = 0;
function check(cond: boolean, label: string, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(green(label));
  } else {
    failed++;
    console.log(red(`${label}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ''}`));
  }
}

const PREFIX = 'ZZT';
const ORDER_AMOUNT = 2000;

async function cleanup() {
  await prisma.webStoreCoupon.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.discount.deleteMany({ where: { code: { startsWith: PREFIX } } });
}

async function main() {
  // Route handlers are called directly, so stub the NextAuth session as a super admin.
  const adminSession = {
    user: { id: 'test_admin_id', name: 'Super Admin', email: 'test_admin@zicabella.com', role: 'SUPER_ADMIN' },
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('next-auth/next').getServerSession = async () => adminSession;

  await cleanup();

  const { POST: saveCampaign, GET: listCampaigns } = await import('../app/api/discounts/route');
  const { POST: appValidate } = await import('../app/api/app/discounts/validate/route');
  const { POST: webValidate } = await import('../app/api/storefront/coupons/validate/route');
  const { POST: appOrderCreate } = await import('../app/api/app/orders/create/route');
  const { POST: appPaymentCreate } = await import('../app/api/app/payment/create-order/route');

  const post = (url: string, body: any) =>
    new Request(`http://localhost${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const save = async (code: string, targets: string[], extra: any) => {
    const res = await saveCampaign(
      post('/api/discounts', {
        code,
        targets,
        validFrom: new Date(Date.now() - 86400000).toISOString(),
        validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        isActive: true,
        ...extra,
      })
    );
    const j: any = await res.json();
    if (!j.success) throw new Error(`save ${code} failed: ${JSON.stringify(j)}`);
  };

  // ── Create campaigns through the real admin API (same path as the dashboard form) ──
  console.log(cyan('Setup: creating test campaigns via /api/discounts'));
  await save('ZZTAPPPREPAID', ['app'], { appSettings: { type: 'percentage', value: 10, minOrderAmount: 0, applicability: 'PREPAID_ONLY' } });
  await save('ZZTAPPBOTH', ['app'], { appSettings: { type: 'percentage', value: 10, minOrderAmount: 0, applicability: 'ALL' } });
  await save('ZZTAPPFIXED', ['app'], { appSettings: { type: 'fixed', value: 150, minOrderAmount: 0, applicability: 'PREPAID_ONLY' } });
  await save('ZZTAPPDEFAULT', ['app'], { appSettings: { type: 'percentage', value: 10, minOrderAmount: 0 } }); // no applicability sent
  await save('ZZTAUTOPP', ['app'], { autoApply: true, appSettings: { type: 'percentage', value: 60, minOrderAmount: 0, applicability: 'PREPAID_ONLY' } });
  await save('ZZTAUTOALL', ['app'], { autoApply: true, appSettings: { type: 'percentage', value: 30, minOrderAmount: 0, applicability: 'ALL' } });
  // One campaign on both channels with DIFFERENT rules: web = everyone, app = prepaid only
  await save('ZZTSPLIT', ['webstore', 'app'], {
    webstoreSettings: { discountType: 'percentage', discountValue: 10, minOrderValue: 0, applicability: 'ALL' },
    appSettings: { type: 'percentage', value: 10, minOrderAmount: 0, applicability: 'PREPAID_ONLY' },
  });
  // Pure web coupons
  await save('ZZTWEBPREPAID', ['webstore'], {
    webstoreSettings: { discountType: 'percentage', discountValue: 10, minOrderValue: 0, applicability: 'PREPAID_ONLY' },
  });
  await save('ZZTWEBALL', ['webstore'], {
    webstoreSettings: { discountType: 'percentage', discountValue: 10, minOrderValue: 0, applicability: 'ALL' },
  });

  // ── 1. Saved correctly / returned to the dashboard ──
  console.log(cyan('\n1. Saving & listing'));
  const rows = await prisma.discount.findMany({ where: { code: { startsWith: PREFIX } } });
  const rule = (c: string) => rows.find((r: any) => r.code === c)?.applicability;
  check(rule('ZZTAPPPREPAID') === 'PREPAID_ONLY', 'Prepaid Only is stored as PREPAID_ONLY', rule('ZZTAPPPREPAID'));
  check(rule('ZZTAPPBOTH') === 'ALL', 'Prepaid & COD is stored as ALL', rule('ZZTAPPBOTH'));
  check(rule('ZZTAPPDEFAULT') === 'ALL', 'Missing applicability defaults to ALL (old behaviour)', rule('ZZTAPPDEFAULT'));
  const listed: any = await (await listCampaigns(new Request('http://localhost/api/discounts'))).json();
  const listedPrepaid = listed.discounts.find((d: any) => d.code === 'ZZTAPPPREPAID');
  check(listedPrepaid?.appSettings?.applicability === 'PREPAID_ONLY', 'Dashboard list returns the saved rule', listedPrepaid?.appSettings);

  // ── 2. Preview endpoint (what the app calls before checkout) ──
  console.log(cyan('\n2. App validate endpoint — before checkout'));
  const validate = async (code: string, paymentMethod: string, orderAmount = ORDER_AMOUNT) => {
    const res = await appValidate(post('/api/app/discounts/validate', { code, orderAmount, paymentMethod }));
    return { status: res.status, body: (await res.json()) as any };
  };

  let r = await validate('ZZTAPPPREPAID', 'PREPAID');
  check(r.status === 200 && r.body.discount.discountAmount === 200, 'Prepaid Only + PREPAID order → ₹200 off (10% of ₹2000)', r.body);
  r = await validate('ZZTAPPPREPAID', 'COD');
  check(r.status === 400 && /prepaid/i.test(r.body.error), 'Prepaid Only + COD order → rejected', r.body);
  r = await validate('ZZTAPPPREPAID', 'cod');
  check(r.status === 400, 'Prepaid Only + "cod" (lowercase) → rejected', r.body);
  r = await validate('ZZTAPPPREPAID', 'COD_UPFRONT');
  check(r.status === 400, 'Prepaid Only + COD with upfront payment → rejected (still a COD order)', r.body);

  r = await validate('ZZTAPPBOTH', 'PREPAID');
  check(r.status === 200 && r.body.discount.discountAmount === 200, 'Prepaid & COD + PREPAID → ₹200 off', r.body);
  r = await validate('ZZTAPPBOTH', 'COD');
  check(r.status === 200 && r.body.discount.discountAmount === 200, 'Prepaid & COD + COD → ₹200 off (same amount)', r.body);

  r = await validate('ZZTAPPFIXED', 'PREPAID');
  check(r.status === 200 && r.body.discount.discountAmount === 150, 'Fixed ₹150 Prepaid Only + PREPAID → ₹150 off', r.body);
  r = await validate('ZZTAPPFIXED', 'COD');
  check(r.status === 400, 'Fixed ₹150 Prepaid Only + COD → rejected', r.body);

  r = await validate('ZZTAPPDEFAULT', 'COD');
  check(r.status === 200, 'Code saved without a rule still applies to COD (unchanged behaviour)', r.body);

  r = await validate('ZZTAPPBOTH', 'PREPAID', 1000);
  check(r.body.discount?.discountAmount === 100, 'Amount scales with cart: ₹1000 → ₹100 off', r.body);

  // ── 3. Auto-apply ──
  console.log(cyan('\n3. Auto-apply (cart discount shown before the customer enters a code)'));
  const bestPrepaid = await pickBestAutoApplyDiscount({ orderAmount: ORDER_AMOUNT, paymentMethod: 'PREPAID' });
  check(bestPrepaid?.code === 'ZZTAUTOPP' && bestPrepaid.discountAmount === 1200, 'PREPAID cart auto-applies the Prepaid Only 60% code', bestPrepaid);
  const bestCod = await pickBestAutoApplyDiscount({ orderAmount: ORDER_AMOUNT, paymentMethod: 'COD' });
  check(bestCod?.code === 'ZZTAUTOALL' && bestCod.discountAmount === 600, 'COD cart skips Prepaid Only and auto-applies the Prepaid & COD 30% code', bestCod);

  // ── 4. Backend enforcement ──
  console.log(cyan('\n4. Backend enforcement (bypassing the app UI)'));
  const ruleErr = (code: string, pm: string) => getAppDiscountApplicabilityError({ code, paymentMethod: pm });
  check((await ruleErr('ZZTAPPPREPAID', 'COD')) !== null, 'Guard: Prepaid Only + COD → error');
  check((await ruleErr('ZZTAPPPREPAID', 'PREPAID')) === null, 'Guard: Prepaid Only + PREPAID → allowed');
  check((await ruleErr('ZZTAPPBOTH', 'COD')) === null, 'Guard: Prepaid & COD + COD → allowed');
  check((await ruleErr('NOT_A_KNOWN_CODE', 'COD')) === null, 'Guard: unknown codes are left to existing behaviour');
  check((await ruleErr(null, 'COD')) === null, 'Guard: no code → nothing to enforce');

  // Real handlers: a tampered client sends a COD order with a Prepaid Only code and a discount amount
  const orderBody = (code: string, paymentMethod: string) => ({
    paymentMethod,
    discountCode: code,
    discountAmount: 200,
    subtotal: ORDER_AMOUNT,
    total: ORDER_AMOUNT - 200,
    lineItems: [{ variantId: '1', price: ORDER_AMOUNT, quantity: 1, title: 'ZZT test item' }],
    shippingAddress: { country: 'India', countryCode: 'IN' },
    customerEmail: 'zzt_discount_test@example.com',
  });
  let res = await appOrderCreate(post('/api/app/orders/create', orderBody('ZZTAPPPREPAID', 'COD')));
  let j: any = await res.json().catch(() => ({}));
  check(res.status === 400 && /prepaid/i.test(String(j.error || j.message)), 'orders/create refuses COD + Prepaid Only code', { status: res.status, j });

  res = await appPaymentCreate(post('/api/app/payment/create-order', { amount: 99, orderData: orderBody('ZZTAPPPREPAID', 'COD') }));
  j = await res.json().catch(() => ({}));
  check(res.status === 400 && /prepaid/i.test(String(j.error)), 'payment/create-order refuses COD + Prepaid Only code', { status: res.status, j });

  // ── 5. Web Store stays independent ──
  console.log(cyan('\n5. Web Store rules unchanged and independent'));
  const web = async (code: string, paymentMethod: string) => {
    const resp = await webValidate(post('/api/storefront/coupons/validate', { code, subtotal: ORDER_AMOUNT, paymentMethod }));
    return { status: resp.status, body: (await resp.json()) as any };
  };
  let w = await web('ZZTWEBPREPAID', 'PREPAID');
  check(w.body.valid === true, 'Web Prepaid Only + PREPAID → valid', w.body);
  w = await web('ZZTWEBPREPAID', 'COD');
  check(w.body.valid === false, 'Web Prepaid Only + COD → rejected', w.body);
  w = await web('ZZTWEBALL', 'COD');
  check(w.body.valid === true, 'Web Prepaid & COD + COD → valid', w.body);

  // Same code on both channels with different rules
  w = await web('ZZTSPLIT', 'COD');
  check(w.body.valid === true, 'Split code: Web Store (rule ALL) accepts COD', w.body);
  r = await validate('ZZTSPLIT', 'COD');
  check(r.status === 400, 'Split code: Mobile App (Prepaid Only) rejects COD — the two are independent', r.body);
  const webRow = await prisma.webStoreCoupon.findFirst({ where: { code: 'ZZTSPLIT' } });
  check(webRow?.applicability === 'ALL', 'Split code: web row keeps its own rule', webRow?.applicability);
  // App-only code must not leak into the web store
  w = await web('ZZTAPPBOTH', 'PREPAID');
  check(w.body.valid === false, 'App-only code is not valid on the Web Store', w.body);

  // ── 6. Existing codes untouched ──
  console.log(cyan('\n6. Existing campaigns'));
  const existing = await prisma.discount.findMany({ where: { NOT: { code: { startsWith: PREFIX } } }, select: { code: true, applicability: true } });
  check(existing.every((d: any) => ['ALL', 'PREPAID_ONLY'].includes(d.applicability)), 'All pre-existing codes have a valid rule', existing);
}

main()
  .catch((e) => {
    failed++;
    console.error(red(`Unexpected error: ${e?.stack || e}`));
  })
  .finally(async () => {
    await cleanup().catch(() => {});
    console.log(`\n${passed} passed, ${failed} failed`);
    await prisma.$disconnect();
    process.exit(failed ? 1 : 0);
  });
