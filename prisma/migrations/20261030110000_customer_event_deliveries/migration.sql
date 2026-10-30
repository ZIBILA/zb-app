-- Customer lifecycle notifications: one row per (event, channel) so nothing is sent twice.
CREATE TABLE IF NOT EXISTS "customer_event_deliveries" (
  "id"         TEXT NOT NULL,
  "event_key"  TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "channel"    TEXT NOT NULL,
  "recipient"  TEXT,
  "status"     TEXT NOT NULL DEFAULT 'sending',
  "error"      TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_event_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_event_deliveries_event_key_channel_key"
  ON "customer_event_deliveries"("event_key", "channel");
CREATE INDEX IF NOT EXISTS "customer_event_deliveries_event_type_created_at_idx"
  ON "customer_event_deliveries"("event_type", "created_at");
