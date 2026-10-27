/**
 * Inventory policy: Shopify variant quantity is the catalog source of truth.
 *
 * - Deduct only for successful paid / COD-upfront orders (never pending/failed/unpaid).
 * - Shopify order create is the single deduction for that order.
 * - SKU scans (ORDER_OUT, admin assign) only move unit tags if Shopify already deducted.
 * - Restock returned/exchanged units only after received + QC passed.
 */

export const INVENTORY_DEDUCT_PAYMENTS = [
  "paid",
  "PAID",
  "success",
  "SUCCESS",
  "captured",
  "CAPTURED",
  "cod_upfront_paid",
  "COD_UPFRONT_PAID",
  "partially_paid",
  "PARTIALLY_PAID",
] as const;

export const INVENTORY_BLOCKED_PAYMENTS = [
  "pending",
  "payment_pending",
  "unpaid",
  "failed",
  "FAILED",
  "payment_failed",
  "voided",
  "expired",
  "authorized",
  "refunded",
] as const;

export const INVENTORY_BLOCKED_ORDER_STATUSES = [
  "cancelled",
  "CANCELLED",
  "canceled",
  "payment_failed",
  "failed",
  "FAILED",
  "draft",
  "abandoned",
] as const;

export const INV_DEDUCTED_TAG = "zb-inv-decremented";
export const INV_RESTORED_TAG = "zb-inv-restored";

export function normalizeStatus(value?: string | null): string {
  return String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
}

export function shouldDeductInventoryOnOrder(params: {
  paymentStatus?: string | null;
  orderStatus?: string | null;
}): boolean {
  const payment = normalizeStatus(params.paymentStatus);
  const order = normalizeStatus(params.orderStatus);
  if (!payment) return false;
  if ((INVENTORY_BLOCKED_ORDER_STATUSES as readonly string[]).some((s) => normalizeStatus(s) === order)) {
    return false;
  }
  if ((INVENTORY_BLOCKED_PAYMENTS as readonly string[]).includes(params.paymentStatus as any)) {
    return false;
  }
  if (
    payment === "pending" ||
    payment === "payment_pending" ||
    payment === "unpaid" ||
    payment === "failed" ||
    payment === "payment_failed" ||
    payment === "voided" ||
    payment === "expired" ||
    payment === "authorized"
  ) {
    return false;
  }
  return (INVENTORY_DEDUCT_PAYMENTS as readonly string[]).some((s) => normalizeStatus(s) === payment);
}

export function hasInventoryTag(tags?: string | null, tag?: string): boolean {
  if (!tags || !tag) return false;
  return tags
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .includes(tag.toLowerCase());
}

export function withInventoryTag(tags: string | null | undefined, tag: string): string {
  const parts = String(tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!parts.some((t) => t.toLowerCase() === tag.toLowerCase())) parts.push(tag);
  return parts.join(", ");
}

export function hasNumericShopifyOrderId(id?: string | null): boolean {
  return /^\d+$/.test(String(id || "").replace(/^#/, ""));
}

/** True when this local order already moved Shopify stock via paid order create. */
export function shopifyAlreadyDeductedForOrder(order: {
  shopifyOrderId?: string | null;
  paymentStatus?: string | null;
  status?: string | null;
  tags?: string | null;
}): boolean {
  if (hasInventoryTag(order.tags, INV_RESTORED_TAG)) return false;
  if (hasInventoryTag(order.tags, INV_DEDUCTED_TAG) && hasNumericShopifyOrderId(order.shopifyOrderId)) {
    return true;
  }
  return (
    hasNumericShopifyOrderId(order.shopifyOrderId) &&
    shouldDeductInventoryOnOrder({
      paymentStatus: order.paymentStatus,
      orderStatus: order.status,
    })
  );
}

export function canRestockReturnedUnit(params: {
  received: boolean;
  qcPassed: boolean;
}): boolean {
  return Boolean(params.received && params.qcPassed);
}
