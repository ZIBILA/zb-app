# Production DB migration — Snap delivery ledger + newsletter

Branch: `fix/snap-tracking-hardening`
Migration: `prisma/migrations/20261009010000_snap_delivery_and_newsletter/migration.sql`

What it does: **adds two new, empty tables** (`ad_conversion_deliveries`,
`newsletter_subscribers`) and three indexes. It does not alter, lock or touch any
existing table or row. Every statement is `IF NOT EXISTS`, so re-running is safe.

`npm run build` (= `prisma generate && next build`) does **not** change the
database. The migration must be applied separately, **before** this code is
deployed — otherwise the Snap Purchase ledger cannot be written and Snap
Purchases are logged as failed instead of being sent.

Use the **direct** (non-pooled, port 5432) connection string for every step
below — `DIRECT_URL`, not the pgbouncer/Supavisor pooler URL.

## Do NOT use
- `prisma db push` — syncs the *whole* schema; any other drift between
  `schema.prisma` and production would also be applied (possibly with data-loss prompts).
- `prisma migrate dev` — can reset the database.
- `prisma migrate deploy` — unless `_prisma_migrations` is already in sync with
  all 23 earlier folders; otherwise it tries to re-run old migrations.

## Steps

**1. Backup / restore point.** Confirm a fresh Supabase backup or note the PITR
timestamp. (The change is additive, but this is the standard gate.)

**2. Drift check (read-only).** Shows exactly what production is missing versus the branch schema:

```bash
DATABASE_URL="$DIRECT_URL" npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script \
  -o /tmp/snap-drift.sql
cat /tmp/snap-drift.sql
```

Expected: only `CREATE TABLE "ad_conversion_deliveries"`, `CREATE TABLE "newsletter_subscribers"`
and their 3 indexes. **If anything else appears, stop** — production has drifted
from `schema.prisma` and that must be reviewed separately before applying anything.

**3. Apply exactly the reviewed file, in one transaction:**

```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f prisma/migrations/20261009010000_snap_delivery_and_newsletter/migration.sql
```

Any error rolls the whole file back; nothing is half-applied.

**4. Verify:**

```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/db/verify-snap-tables.sql
DATABASE_URL="$DIRECT_URL" npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script
```

Expected: 2 tables, 14 + 6 columns, unique indexes present, 0 rows each; the
second command prints an empty migration.

**5. Migration history (only if Prisma Migrate history is used in production):**

```bash
psql "$DIRECT_URL" -c "SELECT to_regclass('_prisma_migrations');"
# if it returns _prisma_migrations:
DATABASE_URL="$DIRECT_URL" npx prisma migrate resolve --applied 20261009010000_snap_delivery_and_newsletter
```

If it returns NULL (schema managed with `db push`), skip this step.

**6. Only then** deploy the branch (after merge approval).

## Rollback (only while the new code is NOT deployed)

```sql
DROP TABLE IF EXISTS "ad_conversion_deliveries";
DROP TABLE IF EXISTS "newsletter_subscribers";
```

No foreign keys reference these tables, so dropping them affects nothing else.

## Retry worker scheduling (after the migration and merge)

- Endpoint: `GET https://app.zicabella.com/api/cron/snap-conversions`
- Auth: `Authorization: Bearer <CRON_SECRET>` only (no `?secret=`); returns 401 when
  `CRON_SECRET` is unset, missing or wrong.
- Scheduler: `.github/workflows/snap-conversions.yml` — same mechanism as the existing
  `order-sync.yml` / `whatsapp-scheduler.yml` (GitHub Actions pings with the repo secret
  `CRON_SECRET`). Runs every 15 min at :07/:22/:37/:52 with `concurrency` so runs never
  overlap. GitHub only runs scheduled workflows from the default branch, so it activates
  when merged to `main`; `workflow_dispatch` allows a manual first run.
- What one run does: expires pending rows older than 7 days; resends failed / lease-expired
  rows; recovers pending rows older than 15 min **only** when the DB order is `paid` /
  `cod_upfront_paid` **and** Razorpay confirms the payment captured (and not refunded).
- Check after the first run: the JSON response tally, e.g. `{"ok":true,"result":{"recovered_sent":1}}`.
