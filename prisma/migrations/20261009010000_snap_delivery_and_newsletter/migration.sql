-- Durable idempotency ledger for server-side ad conversions (Snap CAPI PURCHASE).
-- Additive only: new table, no changes to existing tables.
CREATE TABLE IF NOT EXISTS "ad_conversion_deliveries" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "eventTime" TIMESTAMP(3),
    "context" JSONB,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ad_conversion_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ad_conversion_deliveries_platform_eventName_orderId_key"
    ON "ad_conversion_deliveries"("platform", "eventName", "orderId");

CREATE INDEX IF NOT EXISTS "ad_conversion_deliveries_status_updatedAt_idx"
    ON "ad_conversion_deliveries"("status", "updatedAt");

-- Storefront newsletter sign-ups (additive).
CREATE TABLE IF NOT EXISTS "newsletter_subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'subscribed',
    "source" TEXT NOT NULL DEFAULT 'storefront_footer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscribers_email_key"
    ON "newsletter_subscribers"("email");
