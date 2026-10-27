-- PDP trust boxes + tax label + default model info (theme-editable)
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "pdpTrustBoxes" TEXT DEFAULT '[{"id":"cod","icon":"cash-outline","title":"COD available","subtitle":"₹99 now, rest on delivery","variant":"default"},{"id":"prepaid","icon":"pricetag-outline","title":"10% off on prepaid","subtitle":"+ 10% cashback as store credit","variant":"highlight"},{"id":"delivery","icon":"bicycle-outline","title":"Delivery in 3–7 days","subtitle":"Dispatched in 24–48 hrs","variant":"default"},{"id":"returns","icon":"refresh-outline","title":"15-day easy return/exchange","subtitle":"No questions asked","variant":"default"}]';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "pdpInclTaxesText" TEXT DEFAULT 'Incl. taxes';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "pdpShowInclTaxes" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "pdpModelInfoDefault" TEXT DEFAULT 'Model is 6''0", wearing size 32 · Oversized fit, true to waist';
