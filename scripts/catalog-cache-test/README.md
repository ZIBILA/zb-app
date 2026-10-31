# Catalogue-route regression test

Runs the **production build** against a fake Shopify Admin API (HTTPS, self-signed) with a fixture
catalogue and checks the product / collection routes end to end, including the case that broke the
live site on 2026-10-29 (a product whose metafield holds a Shopify GID, rendered by an ISR route).

```bash
npm run build
scripts/catalog-cache-test/run.sh        # exit code 0 = all checks passed
```

What it covers: product pages with and without GID metafields, several/single variants, numeric
ids, unknown / draft / malformed handles (404, never 500), collection membership and ISR caching,
a simulated Shopify outage (nothing wrong is cached, recovery works) and a scan of the server log
for `static to dynamic` / `Dynamic server usage` / unhandled errors.

It needs no real Shopify token and touches no database (the app runs with its mock Prisma client).
Ports: `CATALOG_TEST_PORT` (default 3021) and `CATALOG_TEST_FAKE_PORT` (default 8451).
