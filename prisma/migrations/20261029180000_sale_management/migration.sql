-- Sale Management (Dashboard → Marketing → Sale Management)
CREATE TABLE IF NOT EXISTS "sales" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "percent"    DOUBLE PRECISION NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'active',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at"   TIMESTAMP(3),
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "sales_status_idx" ON "sales"("status");

CREATE TABLE IF NOT EXISTS "sale_items" (
  "id"                        TEXT NOT NULL,
  "sale_id"                   TEXT NOT NULL,
  "shopify_product_id"        TEXT NOT NULL,
  "shopify_variant_id"        TEXT NOT NULL,
  "product_title"             TEXT,
  "variant_title"             TEXT,
  "original_price"            TEXT NOT NULL,
  "original_compare_at_price" TEXT,
  "sale_price"                TEXT NOT NULL,
  "status"                    TEXT NOT NULL DEFAULT 'applied',
  "error"                     TEXT,
  CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "sale_items_sale_id_idx" ON "sale_items"("sale_id");
CREATE INDEX IF NOT EXISTS "sale_items_shopify_product_id_idx" ON "sale_items"("shopify_product_id");
