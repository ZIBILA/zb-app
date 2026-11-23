-- The retention job (app/api/cron/db-retention) deletes whatsapp_events by created_at in batches;
-- without this index every batch scans the table (558K rows / 194 MB on 23 Nov 2026).
-- On production prefer: CREATE INDEX CONCURRENTLY IF NOT EXISTS "whatsapp_events_created_at_idx" ON "whatsapp_events"("created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_events_created_at_idx" ON "whatsapp_events"("created_at");
