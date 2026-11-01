-- Admin passkeys (WebAuthn) for dashboard sign-in
CREATE TABLE IF NOT EXISTS "admin_passkeys" (
  "id"            TEXT NOT NULL,
  "user_id"       TEXT NOT NULL,
  "credential_id" TEXT NOT NULL,
  "public_key"    TEXT NOT NULL,
  "counter"       INTEGER NOT NULL DEFAULT 0,
  "transports"    TEXT,
  "device_type"   TEXT,
  "backed_up"     BOOLEAN NOT NULL DEFAULT false,
  "name"          TEXT NOT NULL DEFAULT 'Passkey',
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at"  TIMESTAMP(3),
  CONSTRAINT "admin_passkeys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "admin_passkeys_credential_id_key" ON "admin_passkeys"("credential_id");
CREATE INDEX IF NOT EXISTS "admin_passkeys_user_id_idx" ON "admin_passkeys"("user_id");
