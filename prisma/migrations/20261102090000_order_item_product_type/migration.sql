-- Product type (Shopify product_type) of each order line, sent as content_category on the
-- server Meta / Snap Purchase. Existing rows keep NULL until scripts/backfill-order-item-product-type.ts runs.
-- OrderItem columns are camelCase (no @map), so this one is too.
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "productType" TEXT;
