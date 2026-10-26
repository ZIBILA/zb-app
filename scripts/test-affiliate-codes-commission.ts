/**
 * Tests sequential affiliate codes (ZB + 5 digits) and per-affiliate commission rates:
 * apply → approve with a manual rate → /r/ tracking link → order attribution → commission.
 *
 * Run: NODE_ENV=development npx tsx scripts/test-affiliate-codes-commission.ts
 * Creates ZZAFF* customers/orders and removes them when finished.
 */

import prisma from '../lib/db';
import { attributeOrder } from '../lib/affiliate/attribution';

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

const PREFIX = 'ZZAFF';
const RUN = Date.now();

// Route handlers are called directly: swap the NextAuth session between creator and admin.
let currentSession: any = null;
const adminSession = {
  user: { id: 'test_admin_id', name: 'Super Admin', email: 'test_admin@zicabella.com', role: 'SUPER_ADMIN' },
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('next-auth').getServerSession = async () => currentSession;
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('next-auth/next').getServerSession = async () => currentSession;

async function cleanup() {
  const customers = await prisma.customer.findMany({ where: { id: { startsWith: PREFIX } }, select: { id: true } });
  const ids = customers.map((c: any) => c.id);
  if (ids.length) {
    await prisma.affiliate.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.order.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
  }
  // Give the dev sequence back if no real affiliate holds a sequential code.
  const realSequential = await prisma.affiliate.count({ where: { code: { startsWith: 'ZB' } } });
  if (realSequential === 0) {
    await prisma.$executeRawUnsafe(`ALTER SEQUENCE zb_affiliate_code_seq RESTART WITH 10001`);
  }
}

async function main() {
  await cleanup();

  const shop = (await prisma.shop.findFirst())!;
  const { POST: apply } = await import('../app/api/affiliate/apply/route');
  const { POST: approve } = await import('../app/api/admin/affiliates/[id]/approve/route');
  const { PATCH: updateAffiliate } = await import('../app/api/admin/affiliates/[id]/route');
  const { GET: redirect } = await import('../app/r/[slug]/route');

  const json = (url: string, method: string, body: any) =>
    new Request(`http://localhost${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as any;

  const makeCustomer = (n: number, name: string) =>
    prisma.customer.create({
      data: {
        id: `${PREFIX}_${RUN}_${n}`,
        shopifyId: `${PREFIX}_${RUN}_${n}`,
        shopId: shop.id,
        email: `zzaff_${RUN}_${n}@example.com`,
        name,
        phone: `+9100000${String(RUN).slice(-3)}${n}`,
      },
    });

  const applyAs = async (customer: any) => {
    currentSession = { user: { id: customer.id, email: customer.email, name: customer.name } };
    const res = await apply(json('/api/affiliate/apply', 'POST', { displayName: customer.name, email: customer.email }));
    return { status: res.status, body: (await res.json()) as any };
  };

  // ── 1. Codes ──
  console.log(cyan('1. Sequential affiliate codes on registration'));
  const names = ['Sneha Kapoor', 'Rahul', 'Aisha Khan', 'Vikram Singh', 'Meera'];
  const creators = [];
  for (let i = 0; i < names.length; i++) creators.push(await makeCustomer(i + 1, names[i]));

  const first = await applyAs(creators[0]);
  const second = await applyAs(creators[1]);
  check(first.status === 200 && /^ZB\d{5}$/.test(first.body.affiliate?.code), `Format is ZB + 5 digits (${first.body.affiliate?.code})`, first.body);
  check(!/SNEHA|KAPOOR/i.test(first.body.affiliate?.code || ''), 'Creator name is not in the code');
  const n1 = Number(String(first.body.affiliate?.code).slice(2));
  const n2 = Number(String(second.body.affiliate?.code).slice(2));
  check(n2 === n1 + 1, `Next registration gets the next number (${first.body.affiliate?.code} → ${second.body.affiliate?.code})`);

  // Concurrent registrations must still get distinct codes
  const concurrent = await Promise.all(creators.slice(2).map((c) => applyAs(c)));
  const allCodes = [first, second, ...concurrent].map((r) => r.body.affiliate?.code);
  check(concurrent.every((r) => r.status === 200), '3 simultaneous registrations all succeed', concurrent.map((r) => r.status));
  check(new Set(allCodes).size === allCodes.length, `All codes unique: ${allCodes.join(', ')}`);
  const nums = allCodes.map((c) => Number(String(c).slice(2))).sort((a, b) => a - b);
  check(nums.every((v, i) => i === 0 || v === nums[i - 1] + 1), 'Codes form one unbroken sequence');

  const dup = await applyAs(creators[0]);
  check(dup.status === 409, 'Applying twice is refused (no second code)', dup.status);

  const aff1 = (await prisma.affiliate.findFirst({ where: { customerId: creators[0].id }, include: { links: true } }))!;
  const aff2 = (await prisma.affiliate.findFirst({ where: { customerId: creators[1].id }, include: { links: true } }))!;
  check(aff1.links[0]?.slug === aff1.code.toLowerCase(), `Main tracking link uses the code (/r/${aff1.links[0]?.slug})`);

  // ── 2. Approval with a manual commission rate ──
  console.log(cyan('\n2. Approval with a manual commission rate'));
  currentSession = adminSession;
  const approveReq = (id: string, body: any) => approve(json(`/api/admin/affiliates/${id}/approve`, 'POST', body), { params: { id } });

  let res = await approveReq(aff1.id, {});
  check(res.status === 400, 'Approve without a rate → refused', res.status);
  res = await approveReq(aff1.id, { commissionRate: 0 });
  check(res.status === 400, 'Approve with 0% → refused', res.status);
  res = await approveReq(aff1.id, { commissionRate: 1.5 });
  check(res.status === 400, 'Approve with 150% → refused', res.status);
  check((await prisma.affiliate.findUnique({ where: { id: aff1.id } }))!.status === 'PENDING', 'Refused approvals leave the affiliate PENDING');

  res = await approveReq(aff1.id, { commissionRate: 0.125 });
  let a1 = (await prisma.affiliate.findUnique({ where: { id: aff1.id } }))!;
  check(res.status === 200 && a1.status === 'APPROVED' && a1.commissionRate === 0.125, 'Approve at 12.5% → APPROVED with rate 0.125', a1);
  check(a1.code === aff1.code, 'Approval keeps the registration code', a1.code);

  res = await approveReq(aff2.id, { commissionRate: 0.2 });
  const a2 = (await prisma.affiliate.findUnique({ where: { id: aff2.id } }))!;
  check(res.status === 200 && a2.commissionRate === 0.2, 'Second affiliate approved at 20% (different rate)', a2.commissionRate);

  // ── 3. Tracking ──
  console.log(cyan('\n3. Referral tracking through the code'));
  const visit = async (slug: string) => {
    const r = await redirect(new Request(`http://localhost/r/${slug}`, { headers: { 'x-forwarded-for': `10.9.${RUN % 200}.1` } }) as any, { params: { slug } });
    const setCookie = r.headers.get('set-cookie') || '';
    const m = setCookie.match(/zb_aff=([^;]+)/);
    return { status: r.status, cookie: m ? decodeURIComponent(m[1]) : null };
  };
  const v1 = await visit(aff1.code.toLowerCase());
  check(v1.status === 302 && !!v1.cookie, `/r/${aff1.code.toLowerCase()} redirects and sets the attribution cookie`, v1);
  const v1Upper = await visit(aff1.code);
  check(v1Upper.status === 302 && !!v1Upper.cookie, `/r/${aff1.code} (uppercase code) also works`, v1Upper);
  const v2 = await visit(aff2.code.toLowerCase());
  a1 = (await prisma.affiliate.findUnique({ where: { id: aff1.id } }))!;
  check(a1.totalClicks >= 1, `Clicks recorded for ${aff1.code} (${a1.totalClicks})`, a1.totalClicks);

  // ── 4. Commission calculation ──
  console.log(cyan('\n4. Attributed revenue and commission'));
  const buyer = await makeCustomer(9, 'Buyer Person');
  const makeOrder = (subtotal: number, discount: number) =>
    prisma.order.create({
      data: {
        shopId: shop.id,
        customerId: buyer.id,
        totalPrice: subtotal - discount,
        subtotalPrice: subtotal,
        discountAmount: discount,
        paymentStatus: 'paid',
        status: 'active',
        fulfillmentStatus: 'fulfilled',
        deliveryStatus: 'delivered',
        paymentMethod: 'Prepaid',
        internalOrderNumber: `${PREFIX}_${RUN}_${Math.random().toString(36).slice(2, 8)}`,
      },
    });

  // ₹2000 subtotal, ₹200 discount → eligible ₹1800
  const o1 = await makeOrder(2000, 200);
  const r1 = await attributeOrder({ orderId: o1.id, cookieVal: v1.cookie });
  const ref1 = await prisma.affiliateReferral.findUnique({ where: { orderId: o1.id } });
  check(r1.attributed && ref1?.affiliateId === aff1.id, `Order attributed to ${aff1.code}`, r1);
  check(ref1?.eligibleAmount === 1800 && ref1?.commissionRate === 0.125 && ref1?.commissionAmount === 225,
    '12.5% of ₹1800 eligible = ₹225 commission', ref1 && { eligible: ref1.eligibleAmount, rate: ref1.commissionRate, amount: ref1.commissionAmount });

  const o2 = await makeOrder(2000, 200);
  await attributeOrder({ orderId: o2.id, cookieVal: v2.cookie });
  const ref2 = await prisma.affiliateReferral.findUnique({ where: { orderId: o2.id } });
  check(ref2?.affiliateId === aff2.id && ref2?.commissionAmount === 360, '20% of ₹1800 = ₹360 for the second affiliate', ref2?.commissionAmount);

  // Odd amounts round to paise
  const o3 = await makeOrder(1333.33, 0);
  await attributeOrder({ orderId: o3.id, cookieVal: v1.cookie });
  const ref3 = await prisma.affiliateReferral.findUnique({ where: { orderId: o3.id } });
  check(ref3?.commissionAmount === 166.67, '12.5% of ₹1333.33 = ₹166.67 (rounded to paise)', ref3?.commissionAmount);

  const again = await attributeOrder({ orderId: o1.id, cookieVal: v1.cookie });
  check(!again.attributed, 'Same order cannot be attributed twice', again);

  a1 = (await prisma.affiliate.findUnique({ where: { id: aff1.id } }))!;
  check(a1.totalConversions === 2 && a1.totalRevenue === 3133.33 && a1.pendingEarnings === 391.67,
    `${aff1.code} totals: 2 conversions, ₹3133.33 revenue, ₹391.67 pending`, { conv: a1.totalConversions, rev: a1.totalRevenue, pending: a1.pendingEarnings });

  // Self-referral
  currentSession = adminSession;
  const selfOrder = await prisma.order.create({
    data: {
      shopId: shop.id, customerId: creators[0].id, totalPrice: 1000, subtotalPrice: 1000, discountAmount: 0,
      paymentStatus: 'paid', status: 'active', fulfillmentStatus: 'fulfilled', deliveryStatus: 'delivered', paymentMethod: 'Prepaid', internalOrderNumber: `${PREFIX}_${RUN}_self`,
    },
  });
  const self = await attributeOrder({ orderId: selfOrder.id, cookieVal: v1.cookie });
  check(!self.attributed, 'Affiliate buying through their own code earns nothing', self);

  // Rate change applies to future orders only
  await updateAffiliate(json(`/api/admin/affiliates/${aff1.id}`, 'PATCH', { commissionRate: 0.15 }), { params: { id: aff1.id } });
  const o4 = await makeOrder(1000, 0);
  await attributeOrder({ orderId: o4.id, cookieVal: v1.cookie });
  const ref4 = await prisma.affiliateReferral.findUnique({ where: { orderId: o4.id } });
  const ref1After = await prisma.affiliateReferral.findUnique({ where: { orderId: o1.id } });
  check(ref4?.commissionAmount === 150 && ref1After?.commissionAmount === 225,
    'After changing the rate to 15%: new order earns ₹150, earlier order keeps ₹225', { new: ref4?.commissionAmount, old: ref1After?.commissionAmount });

  // Pending (unapproved) affiliate earns nothing
  const pendingAff = (await prisma.affiliate.findFirst({ where: { customerId: creators[2].id } }))!;
  const { signAffiliateCookie } = await import('../lib/affiliate/cookie');
  const pendingCookie = await signAffiliateCookie({ code: pendingAff.code, ts: Date.now() } as any);
  const o5 = await makeOrder(1000, 0);
  const p = await attributeOrder({ orderId: o5.id, cookieVal: pendingCookie });
  check(!p.attributed, 'A not-yet-approved affiliate code earns nothing', p);
}

main()
  .catch((e) => {
    failed++;
    console.error(red(`Unexpected error: ${e?.stack || e}`));
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error('cleanup failed:', e?.message));
    console.log(`\n${passed} passed, ${failed} failed`);
    await prisma.$disconnect();
    process.exit(failed ? 1 : 0);
  });
