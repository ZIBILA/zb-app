-- Linked Return / Exchange ids (R_ZB…, E_ZB…, G_E_ZB…) and receipt tracking.
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "displayId" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "logisticsPartner" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "refundType" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "refundReleasedAt" TIMESTAMP(3);

ALTER TABLE "ExchangeRequest" ADD COLUMN IF NOT EXISTS "displayId" TEXT;
ALTER TABLE "ExchangeRequest" ADD COLUMN IF NOT EXISTS "replacementDisplayId" TEXT;
ALTER TABLE "ExchangeRequest" ADD COLUMN IF NOT EXISTS "replacementOrderId" TEXT;
ALTER TABLE "ExchangeRequest" ADD COLUMN IF NOT EXISTS "logisticsPartner" TEXT;
ALTER TABLE "ExchangeRequest" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "ReturnRequest_displayId_key" ON "ReturnRequest"("displayId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExchangeRequest_displayId_key" ON "ExchangeRequest"("displayId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExchangeRequest_replacementDisplayId_key" ON "ExchangeRequest"("replacementDisplayId");

-- ── Backfill existing rows ────────────────────────────────────────────────
-- Order base number = first non-empty of internal number / shopify name / shopify id
-- (never an "app_" placeholder), else ZB + last 6 chars of the order id.

WITH base AS (
  SELECT rr."id" AS rid,
         COALESCE(
           NULLIF(CASE WHEN ltrim(COALESCE(o."internal_order_number", ''), '#') LIKE 'app\_%' THEN '' ELSE ltrim(COALESCE(o."internal_order_number", ''), '#') END, ''),
           NULLIF(CASE WHEN ltrim(COALESCE(o."shopify_order_name", ''), '#') LIKE 'app\_%' THEN '' ELSE ltrim(COALESCE(o."shopify_order_name", ''), '#') END, ''),
           NULLIF(CASE WHEN ltrim(COALESCE(o."shopifyOrderId", ''), '#') LIKE 'app\_%' THEN '' ELSE ltrim(COALESCE(o."shopifyOrderId", ''), '#') END, ''),
           'ZB' || upper(right(o."id", 6))
         ) AS base_no,
         row_number() OVER (PARTITION BY rr."orderId" ORDER BY rr."createdAt", rr."id") AS n
  FROM "ReturnRequest" rr
  JOIN "Order" o ON o."id" = rr."orderId"
  WHERE rr."displayId" IS NULL
    AND COALESCE(rr."reason", '') NOT LIKE '%EXCHANGE_RETURN%'
)
UPDATE "ReturnRequest" r
SET "displayId" = 'R_' || b.base_no || CASE WHEN b.n > 1 THEN '_' || b.n::text ELSE '' END
FROM base b
WHERE r."id" = b.rid
  AND NOT EXISTS (
    SELECT 1 FROM "ReturnRequest" x
    WHERE x."displayId" = 'R_' || b.base_no || CASE WHEN b.n > 1 THEN '_' || b.n::text ELSE '' END
  );

WITH base AS (
  SELECT er."id" AS eid,
         COALESCE(
           NULLIF(CASE WHEN ltrim(COALESCE(o."internal_order_number", ''), '#') LIKE 'app\_%' THEN '' ELSE ltrim(COALESCE(o."internal_order_number", ''), '#') END, ''),
           NULLIF(CASE WHEN ltrim(COALESCE(o."shopify_order_name", ''), '#') LIKE 'app\_%' THEN '' ELSE ltrim(COALESCE(o."shopify_order_name", ''), '#') END, ''),
           NULLIF(CASE WHEN ltrim(COALESCE(o."shopifyOrderId", ''), '#') LIKE 'app\_%' THEN '' ELSE ltrim(COALESCE(o."shopifyOrderId", ''), '#') END, ''),
           'ZB' || upper(right(o."id", 6))
         ) AS base_no,
         row_number() OVER (PARTITION BY er."orderId" ORDER BY er."createdAt", er."id") AS n
  FROM "ExchangeRequest" er
  JOIN "Order" o ON o."id" = er."orderId"
  WHERE er."displayId" IS NULL
)
UPDATE "ExchangeRequest" e
SET "displayId" = 'E_' || b.base_no || CASE WHEN b.n > 1 THEN '_' || b.n::text ELSE '' END
FROM base b
WHERE e."id" = b.eid
  AND NOT EXISTS (
    SELECT 1 FROM "ExchangeRequest" x
    WHERE x."displayId" = 'E_' || b.base_no || CASE WHEN b.n > 1 THEN '_' || b.n::text ELSE '' END
  );

-- Replacement ids for exchanges whose replacement order already exists
UPDATE "ExchangeRequest" e
SET "replacementDisplayId" = 'G_' || e."displayId",
    "replacementOrderId"   = ro."id"
FROM "Order" ro
WHERE e."newShopifyOrderId" IS NOT NULL
  AND e."displayId" IS NOT NULL
  AND e."replacementDisplayId" IS NULL
  AND ro."shopifyOrderId" = e."newShopifyOrderId";

UPDATE "Order" o
SET "internal_order_number" = e."replacementDisplayId"
FROM "ExchangeRequest" e
WHERE e."replacementOrderId" = o."id"
  AND o."internal_order_number" IS NULL
  AND e."replacementDisplayId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Order" x WHERE x."internal_order_number" = e."replacementDisplayId");

-- Anything already past "received" counts as received (gates refund release)
UPDATE "ReturnRequest"
SET "receivedAt" = "updatedAt"
WHERE "receivedAt" IS NULL AND lower("status") IN ('received', 'qc_passed', 'refunded');

UPDATE "ExchangeRequest"
SET "receivedAt" = "updatedAt"
WHERE "receivedAt" IS NULL AND lower("status") IN ('received', 'qc_passed', 'creating_order', 'new_order_created', 'shipped', 'completed');
