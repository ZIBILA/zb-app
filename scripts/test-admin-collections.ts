import {
  collectionDateRange,
  collectionProductCount,
  isSuccessfulCollectionPayment,
  normalizeShopifyId,
} from "../lib/adminCollectionMetrics";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

eq("count from products_count", collectionProductCount({ products_count: 12, products: [] }), 12);
eq("count from productsCount", collectionProductCount({ productsCount: 4 }), 4);
eq("count 0 is real", collectionProductCount({ products_count: 0, products: [{ id: 1 }] }), 0);
eq("gid product", normalizeShopifyId("gid://shopify/Product/123"), "123");
eq("gid variant", normalizeShopifyId("gid://shopify/ProductVariant/99"), "99");

eq("paid ok", isSuccessfulCollectionPayment("paid"), true);
eq("cod upfront ok", isSuccessfulCollectionPayment("cod_upfront_paid"), true);
eq("pending excluded", isSuccessfulCollectionPayment("pending"), false);
eq("failed excluded", isSuccessfulCollectionPayment("failed"), false);
eq("payment_pending excluded", isSuccessfulCollectionPayment("payment_pending"), false);

const now = new Date("2026-10-25T12:00:00+05:30");
const today = collectionDateRange("today", null, null, now);
eq("today starts IST midnight", today.from?.toISOString(), new Date("2026-10-25T00:00:00+05:30").toISOString());
const y = collectionDateRange("yesterday", null, null, now);
eq("yesterday from", y.from?.toISOString(), new Date("2026-10-24T00:00:00+05:30").toISOString());
eq(
  "yesterday ends before today",
  Boolean(y.to && y.to < new Date("2026-10-25T00:00:00+05:30") && y.to >= new Date("2026-10-24T00:00:00+05:30")),
  true
);
const week = collectionDateRange("last7", null, null, now);
eq("last7 is 7 IST days", week.from?.toISOString(), new Date("2026-10-19T00:00:00+05:30").toISOString());
const month = collectionDateRange("month", null, null, now);
eq("this month starts Oct 1 IST", month.from?.toISOString(), new Date("2026-10-01T00:00:00+05:30").toISOString());
const custom = collectionDateRange("custom", "2026-10-01", "2026-10-10", now);
eq("custom inclusive end of day", custom.to?.toISOString(), new Date("2026-10-10T23:59:59.999+05:30").toISOString());

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll collection metric checks passed");
