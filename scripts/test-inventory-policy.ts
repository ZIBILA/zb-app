import {
  canRestockReturnedUnit,
  hasInventoryTag,
  hasNumericShopifyOrderId,
  INV_DEDUCTED_TAG,
  INV_RESTORED_TAG,
  shouldDeductInventoryOnOrder,
  shopifyAlreadyDeductedForOrder,
  withInventoryTag,
} from "../lib/inventoryPolicy";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

eq("paid deducts", shouldDeductInventoryOnOrder({ paymentStatus: "paid", orderStatus: "approved" }), true);
eq("COD upfront deducts", shouldDeductInventoryOnOrder({ paymentStatus: "cod_upfront_paid", orderStatus: "active" }), true);
eq("pending does not deduct", shouldDeductInventoryOnOrder({ paymentStatus: "pending", orderStatus: "open" }), false);
eq("payment_pending does not deduct", shouldDeductInventoryOnOrder({ paymentStatus: "payment_pending" }), false);
eq("failed does not deduct", shouldDeductInventoryOnOrder({ paymentStatus: "failed" }), false);
eq("unpaid does not deduct", shouldDeductInventoryOnOrder({ paymentStatus: "unpaid" }), false);
eq("cancelled order does not deduct", shouldDeductInventoryOnOrder({ paymentStatus: "paid", orderStatus: "cancelled" }), false);

eq("numeric shopify id", hasNumericShopifyOrderId("123456"), true);
eq("local shopify id ignored", hasNumericShopifyOrderId("local_abc"), false);

const deductedOrder = {
  shopifyOrderId: "998877",
  paymentStatus: "paid",
  status: "approved",
  tags: withInventoryTag("", INV_DEDUCTED_TAG),
};
eq("tag applied", hasInventoryTag(deductedOrder.tags, INV_DEDUCTED_TAG), true);
eq("already deducted on Shopify", shopifyAlreadyDeductedForOrder(deductedOrder), true);
eq(
  "restored no longer deducted",
  shopifyAlreadyDeductedForOrder({
    ...deductedOrder,
    tags: withInventoryTag(deductedOrder.tags, INV_RESTORED_TAG),
  }),
  false
);
eq(
  "unpaid with no shopify id not deducted",
  shopifyAlreadyDeductedForOrder({ paymentStatus: "pending", shopifyOrderId: null }),
  false
);

eq("restock requires received+QC", canRestockReturnedUnit({ received: true, qcPassed: true }), true);
eq("received only is not enough", canRestockReturnedUnit({ received: true, qcPassed: false }), false);
eq("QC only is not enough", canRestockReturnedUnit({ received: false, qcPassed: true }), false);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll inventory policy checks passed");
