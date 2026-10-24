-- Hot-path FK / filter indexes (safe, concurrent-friendly CREATE IF NOT EXISTS not available in plain SQL for indexes in all PG versions — use IF NOT EXISTS where supported)
CREATE INDEX IF NOT EXISTS "Return_orderId_idx" ON "Return"("orderId");
CREATE INDEX IF NOT EXISTS "Return_customerId_idx" ON "Return"("customerId");
CREATE INDEX IF NOT EXISTS "Exchange_orderId_idx" ON "Exchange"("orderId");
CREATE INDEX IF NOT EXISTS "Payment_orderId_idx" ON "Payment"("orderId");
CREATE INDEX IF NOT EXISTS "Payment_customerId_idx" ON "Payment"("customerId");
CREATE INDEX IF NOT EXISTS "SupportMessage_ticketId_idx" ON "SupportMessage"("ticketId");
CREATE INDEX IF NOT EXISTS "whatsapp_webhook_events_eventType_processed_idx" ON "whatsapp_webhook_events"("eventType", "processed");
