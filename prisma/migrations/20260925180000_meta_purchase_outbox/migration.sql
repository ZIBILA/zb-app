CREATE TABLE "MetaPurchase" (
  "orderId" TEXT NOT NULL,
  "razorpayOrderId" TEXT,
  "expectedAmountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "live" BOOLEAN NOT NULL,
  "snapshot" JSONB NOT NULL,
  "userData" JSONB NOT NULL,
  "eventSourceUrl" TEXT NOT NULL,
  "browserTokenHash" TEXT NOT NULL,
  "verifiedPaymentId" TEXT,
  "capturedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'awaiting_payment',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetaPurchase_pkey" PRIMARY KEY ("orderId"),
  CONSTRAINT "MetaPurchase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MetaPurchase_status_check" CHECK ("status" IN ('awaiting_payment', 'pending', 'sending', 'sent', 'blocked'))
);
CREATE UNIQUE INDEX "MetaPurchase_razorpayOrderId_key" ON "MetaPurchase"("razorpayOrderId");
CREATE UNIQUE INDEX "MetaPurchase_verifiedPaymentId_key" ON "MetaPurchase"("verifiedPaymentId");
CREATE INDEX "MetaPurchase_status_availableAt_idx" ON "MetaPurchase"("status", "availableAt");
