/**
 * Store credit used at checkout was taken from the customer's wallet but then put back on the order total by the
 * Shopify order webhook / sync (the credit was never sent to Shopify as a discount). This finds those orders and,
 * with --apply, puts the amount the customer actually paid back on the order.
 *
 *   npx tsx scripts/repair-store-credit-totals.ts            # report only, changes nothing
 *   npx tsx scripts/repair-store-credit-totals.ts --apply    # fixes Order.totalPrice (and the mobile mirror)
 *
 * An order is affected when it used store credit and its total still equals items - coupon (credit not subtracted)
 * while the wallet debit for it exists. Shopify's own copy of the order is NOT changed (Shopify cannot edit a
 * paid order's discounts); the report lists those orders so the shop can note them.
 */
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const envLocalPath = path.resolve(process.cwd(), '.env.local');
dotenv.config(fs.existsSync(envLocalPath) ? { path: envLocalPath } : undefined);

const APPLY = process.argv.includes('--apply');
const dbUrl = process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL;

async function main() {
  if (!dbUrl) { console.error('No database URL in the environment'); process.exit(1); }
  const pool = new Pool({ connectionString: dbUrl.replace('sslmode=require', 'sslmode=no-verify') });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) } as any);
  try {
    const orders: any[] = await (prisma as any).order.findMany({
      where: { storeCreditAmount: { gt: 0 } },
      select: {
        id: true, internalOrderNumber: true, shopifyOrderName: true, totalPrice: true, subtotalPrice: true,
        discountAmount: true, storeCreditAmount: true, paymentStatus: true, paymentMethod: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const fixes: Array<{ id: string; num: string; shopify: string; was: number; now: number; credit: number }> = [];
    for (const o of orders) {
      const subtotal = Number(o.subtotalPrice) || 0;
      const coupon = Number(o.discountAmount) || 0;
      const credit = Number(o.storeCreditAmount) || 0;
      const total = Number(o.totalPrice) || 0;
      const expected = Math.max(0, Math.round((subtotal - coupon - credit) * 100) / 100);
      const creditMissing = Math.abs(total - Math.max(0, subtotal - coupon)) < 0.51 && Math.abs(total - expected) > 0.5;
      if (!creditMissing) continue;
      // the wallet really was debited for this order
      const debit = await (prisma as any).storeCredit.findFirst({ where: { orderId: o.id, type: 'DEBIT' } });
      if (!debit) continue;
      fixes.push({ id: o.id, num: o.internalOrderNumber || '', shopify: o.shopifyOrderName || '', was: total, now: expected, credit });
    }
    console.log(`${orders.length} orders used store credit; ${fixes.length} show a total without it.`);
    for (const f of fixes) console.log(`  ${f.num || f.id}  ${f.shopify}  total ₹${f.was} -> ₹${f.now}  (credit ₹${f.credit})`);
    if (!APPLY) { console.log('\nReport only. Run again with --apply to correct these totals.'); return; }
    for (const f of fixes) {
      await (prisma as any).order.update({ where: { id: f.id }, data: { totalPrice: f.now } });
      if (f.num) await (prisma as any).mobileOrder.updateMany({ where: { orderNumber: f.num }, data: { totalPrice: f.now } }).catch(() => {});
    }
    console.log(`\nCorrected ${fixes.length} orders.`);
  } finally {
    await (prisma as any).$disconnect();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
