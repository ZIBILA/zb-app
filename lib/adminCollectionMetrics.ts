/** Paid in full or COD with the upfront fee captured. Nothing pending/failed/unpaid. */
export const COLLECTION_SUCCESS_PAYMENT_STATUSES = [
  "paid",
  "PAID",
  "success",
  "SUCCESS",
  "captured",
  "CAPTURED",
  "cod_upfront_paid",
  "COD_UPFRONT_PAID",
] as const;

export const COLLECTION_EXCLUDED_ORDER_STATUSES = [
  "cancelled",
  "CANCELLED",
  "payment_failed",
  "failed",
  "FAILED",
  "draft",
  "abandoned",
  "pending",
  "payment_pending",
] as const;

export type CollectionDatePreset = "today" | "yesterday" | "last7" | "month" | "custom";

function istYmd(date: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: num("year"), m: num("month"), d: num("day") };
}

function istMidnight(y: number, m: number, d: number): Date {
  return new Date(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00+05:30`);
}

export function collectionDateRange(
  preset: CollectionDatePreset,
  customFrom?: string | null,
  customTo?: string | null,
  now = new Date()
): { from: Date | null; to: Date | null } {
  const { y, m, d } = istYmd(now);
  const todayStart = istMidnight(y, m, d);
  const tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const endOfToday = new Date(tomorrow.getTime() - 1);

  if (preset === "today") return { from: todayStart, to: endOfToday };
  if (preset === "yesterday") {
    return {
      from: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000),
      to: new Date(todayStart.getTime() - 1),
    };
  }
  if (preset === "last7") {
    return { from: new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000), to: endOfToday };
  }
  if (preset === "month") {
    return { from: istMidnight(y, m, 1), to: endOfToday };
  }
  if (preset === "custom") {
    const from = customFrom ? new Date(`${customFrom}T00:00:00+05:30`) : null;
    const to = customTo ? new Date(`${customTo}T23:59:59.999+05:30`) : null;
    return {
      from: from && !Number.isNaN(from.getTime()) ? from : null,
      to: to && !Number.isNaN(to.getTime()) ? to : null,
    };
  }
  return { from: null, to: null };
}

export function collectionProductCount(collection: {
  products_count?: number;
  productsCount?: number;
  products?: unknown[];
}): number {
  const fromShopify = Number(collection.products_count ?? collection.productsCount);
  if (Number.isFinite(fromShopify) && fromShopify >= 0) return fromShopify;
  if (Array.isArray(collection.products)) return collection.products.length;
  return 0;
}

export function normalizeShopifyId(id: string | number | null | undefined): string {
  if (id === null || id === undefined) return "";
  return String(id).split("/").pop()?.trim() || "";
}

export function isSuccessfulCollectionPayment(status?: string | null): boolean {
  const s = String(status || "").trim();
  return (COLLECTION_SUCCESS_PAYMENT_STATUSES as readonly string[]).includes(s);
}
