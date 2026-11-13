-- Rate Card: dashboard-editable checkout rules (e.g. the maximum COD order value).
CREATE TABLE IF NOT EXISTS "checkout_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "checkout_settings_pkey" PRIMARY KEY ("key")
);
