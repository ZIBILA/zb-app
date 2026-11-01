-- Product reviews: customer photos + approval before going live (Developer Brief #15).
-- Existing reviews keep their current status; only new submissions start as PENDING.
ALTER TABLE "ProductReview" ADD COLUMN IF NOT EXISTS "photos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ProductReview" ALTER COLUMN "status" SET DEFAULT 'PENDING';
