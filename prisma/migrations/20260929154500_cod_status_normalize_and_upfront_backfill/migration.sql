-- Normalize legacy COD payment vocabulary + backfill locked upfront amounts.
-- Safe/idempotent: only touches COD-ish rows still on partially_paid or missing upfront.

-- 1) Status rename for COD orders still labeled partially_paid
UPDATE "Order"
SET "paymentStatus" = 'cod_upfront_paid'
WHERE "paymentStatus" IN ('partially_paid', 'PARTIALLY_PAID')
  AND (
    LOWER(COALESCE("paymentMethod", '')) = 'cod'
    OR LOWER(COALESCE("tags", '')) LIKE '%cod%'
    OR LOWER(COALESCE("note", '')) LIKE '%cod order%'
    OR LOWER(COALESCE("note", '')) LIKE '%upfront fee paid%'
  );

UPDATE "web_store_orders"
SET "payment_status" = 'cod_upfront_paid'
WHERE "payment_status" IN ('partially_paid', 'PARTIALLY_PAID')
  AND (
    LOWER(COALESCE("payment_method", '')) = 'cod'
    OR LOWER(COALESCE("notes", '')) LIKE '%cod%'
  );

UPDATE "MobileOrder"
SET "paymentStatus" = 'cod_upfront_paid'
WHERE "paymentStatus" IN ('partially_paid', 'PARTIALLY_PAID')
  AND (
    LOWER(COALESCE("paymentMethod", '')) = 'cod'
    OR LOWER(COALESCE("tags", '')) LIKE '%cod%'
  );

-- 2) Backfill Order.cod_upfront_paid from Payment.amount when missing
UPDATE "Order" o
SET "cod_upfront_paid" = p.amount
FROM "Payment" p
WHERE p."orderId" = o.id
  AND (o."cod_upfront_paid" IS NULL OR o."cod_upfront_paid" = 0)
  AND p.amount > 0
  AND p.amount < o."totalPrice"
  AND (
    LOWER(COALESCE(o."paymentMethod", '')) = 'cod'
    OR LOWER(COALESCE(o."tags", '')) LIKE '%cod%'
    OR o."paymentStatus" IN ('cod_upfront_paid', 'partially_paid', 'PARTIALLY_PAID')
  );

-- 3) Fallback: historical COD fee was ₹99 when amount was never stored
UPDATE "Order"
SET "cod_upfront_paid" = 99
WHERE ("cod_upfront_paid" IS NULL OR "cod_upfront_paid" = 0)
  AND "paymentStatus" IN ('cod_upfront_paid', 'partially_paid', 'PARTIALLY_PAID', 'paid', 'PAID')
  AND (
    LOWER(COALESCE("paymentMethod", '')) = 'cod'
    OR LOWER(COALESCE("tags", '')) LIKE '%cod%'
    OR LOWER(COALESCE("note", '')) LIKE '%upfront fee paid%'
  )
  AND "totalPrice" > 99;
