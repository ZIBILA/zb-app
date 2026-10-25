-- Mobile app discount applicability: ALL (prepaid & COD) | PREPAID_ONLY
ALTER TABLE "Discount" ADD COLUMN IF NOT EXISTS "applicability" TEXT NOT NULL DEFAULT 'ALL';

-- Keep today's behaviour: codes the app already treated as prepaid-only (name-based rule) stay prepaid-only.
UPDATE "Discount"
SET "applicability" = 'PREPAID_ONLY'
WHERE "applicability" = 'ALL'
  AND UPPER("code") LIKE '%PREPAID%'
  AND "auto_apply" = false
  AND "code" <> 'PREPAID10';
