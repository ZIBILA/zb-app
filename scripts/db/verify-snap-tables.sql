-- Read-only verification after applying
-- prisma/migrations/20261009010000_snap_delivery_and_newsletter/migration.sql
-- Usage: psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/db/verify-snap-tables.sql
\echo '1) tables present (expect 2 rows)'
SELECT table_name FROM information_schema.tables
 WHERE table_schema = current_schema()
   AND table_name IN ('ad_conversion_deliveries', 'newsletter_subscribers')
 ORDER BY 1;

\echo '2) column count (expect ad_conversion_deliveries=14, newsletter_subscribers=6)'
SELECT table_name, count(*) AS columns FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND table_name IN ('ad_conversion_deliveries', 'newsletter_subscribers')
 GROUP BY 1 ORDER BY 1;

\echo '3) unique + status indexes (expect 3 rows + 2 pkeys)'
SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname = current_schema()
   AND tablename IN ('ad_conversion_deliveries', 'newsletter_subscribers')
 ORDER BY 1;

\echo '4) both tables empty right after migration (expect 0, 0)'
SELECT (SELECT count(*) FROM ad_conversion_deliveries) AS deliveries,
       (SELECT count(*) FROM newsletter_subscribers) AS subscribers;
