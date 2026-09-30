-- Configurable COD upfront fee on Shop + lock paid amount on Order
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "cod_upfront_amount" DECIMAL(10, 2) NOT NULL DEFAULT 99;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cod_upfront_paid" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cod_upfront_payment_id" TEXT;
