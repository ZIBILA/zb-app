-- AlterTable
ALTER TABLE "DeviceToken" ADD COLUMN IF NOT EXISTS "expoPushToken" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeviceToken_expoPushToken_idx" ON "DeviceToken"("expoPushToken");
