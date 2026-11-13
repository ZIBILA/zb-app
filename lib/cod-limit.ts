/**
 * Rate Card: the maximum order value that may be paid Cash on Delivery.
 *
 * Above it the order is prepaid only (a ₹31,000 COD order was shipped and lost). Set from the dashboard
 * (Settings → Rate Card), read by the website and app checkouts for the warning, and enforced on the server by every
 * COD entry point, so it cannot be bypassed. Default ₹19,999: ₹20,000 and above is prepaid only.
 */
import prisma from '@/lib/db';

export const COD_MAX_ORDER_VALUE_KEY = 'cod_max_order_value';
export const DEFAULT_COD_MAX_ORDER_VALUE = 19999;
const CACHE_MS = 30_000;

let cached: { value: number; at: number } | null = null;

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "checkout_settings" (
  "key" TEXT NOT NULL, "value" TEXT NOT NULL, "updated_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checkout_settings_pkey" PRIMARY KEY ("key"))`;

export function normalizeCodMaxOrderValue(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/** Current limit in INR (cached 30 s). Falls back to ₹19,999 if it was never set or cannot be read. */
export async function getCodMaxOrderValue(): Promise<number> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let value = DEFAULT_COD_MAX_ORDER_VALUE;
  try {
    const row = await prisma.checkoutSetting.findUnique({ where: { key: COD_MAX_ORDER_VALUE_KEY } });
    value = normalizeCodMaxOrderValue(row?.value) ?? DEFAULT_COD_MAX_ORDER_VALUE;
  } catch (err: any) {
    console.warn('[COD limit] could not read the limit, using the default:', err?.message || err);
  }
  cached = { value, at: Date.now() };
  return value;
}

export async function setCodMaxOrderValue(value: number, updatedBy?: string | null): Promise<number> {
  const v = normalizeCodMaxOrderValue(value);
  if (v === null) throw new Error('The maximum COD order value must be a positive amount.');
  const write = () =>
    prisma.checkoutSetting.upsert({
      where: { key: COD_MAX_ORDER_VALUE_KEY },
      create: { key: COD_MAX_ORDER_VALUE_KEY, value: String(v), updatedBy: updatedBy || null },
      update: { value: String(v), updatedBy: updatedBy || null },
    });
  try {
    await write();
  } catch (err: any) {
    // Table not created yet (migration not applied): create it and save again.
    if (!/checkout_settings|does not exist|P2021/i.test(String(err?.message || err?.code))) throw err;
    await prisma.$executeRawUnsafe(CREATE_TABLE_SQL);
    await write();
  }
  cached = { value: v, at: Date.now() };
  return v;
}

/** True when an order of `orderTotal` (INR) may be paid Cash on Delivery. */
export function isCodAllowedForAmount(orderTotal: unknown, maxOrderValue: number): boolean {
  const total = Number(orderTotal) || 0;
  return total <= maxOrderValue;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export function codLimitError(maxOrderValue: number, orderTotal: number): string {
  return `Cash on Delivery is available only for orders up to ${inr(maxOrderValue)}. Your order total is ${inr(orderTotal)}. Please pay online (Prepaid) to place this order.`;
}
