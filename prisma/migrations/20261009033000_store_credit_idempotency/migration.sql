-- Store-credit redemption idempotency (additive).
-- Nullable column: existing rows stay NULL (Postgres allows many NULLs in a unique index).
ALTER TABLE "StoreCredit" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "StoreCredit_idempotencyKey_key"
    ON "StoreCredit"("idempotencyKey");
