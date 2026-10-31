-- Razorpay webhook de-duplication: one row per provider event id.
-- Existing rows keep eventKey NULL (NULLs never collide on a unique index).
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "eventKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_eventKey_key" ON "WebhookEvent"("eventKey");
