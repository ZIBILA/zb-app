# Production Deployment Guide

Follow these steps to deploy the Zica Bella application to a production environment.

## 1. Prerequisites
- A PostgreSQL database (e.g., Supabase, Vercel Postgres, or Neon).
- A Vercel account (or similar hosting provider).
- Shopify Storefront Access Token and Shop Domain.

## 2. Environment Variables
Set the following environment variables in your production host:

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Your PostgreSQL connection string. |
| `DIRECT_URL` | (Required for Supabase/Neon) Direct connection string for migrations. |
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` | `8tiahf-bk.myshopify.com` |
| `NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN` | Your Shopify Storefront API token. |
| `RAZORPAY_KEY_ID` | (Optional) For payments. |
| `RAZORPAY_KEY_SECRET` | (Optional) For payments. |
| `SNAP_CAPI_ACCESS_TOKEN` | Snapchat Conversions API token (server only, encrypted). Required for server-side Snapchat events, Purchase included. See `docs/snap-tracking-setup.md`. |
| `NEXT_PUBLIC_SNAP_PIXEL_ID` | (Optional) Snap Pixel ID. A production build uses the store's pixel when unset; `off` disables Snapchat tracking for a deployment. |

> [!TIP]
> **Connection Pooling**: If using Supabase or Neon, use the pooled connection string (port 6543 or 5432 with `?pgbouncer=true`) for `DATABASE_URL` to prevent "Too many connections" errors during high traffic.

## 3. Database Initialization
Once the `DATABASE_URL` is set, run these commands to prepare the database:

```bash
# Push the schema to PostgreSQL
npx prisma db push

# Re-run the data sync from CSVs in production
npx tsx scripts/import-customers.ts
npx tsx scripts/import-orders.ts
```

## 4. Deployment Command
Deploy to Vercel using the standard Next.js deployment flow:
- Connect your GitHub repository to Vercel.
- The build command should be `next build`.
- Prisma will automatically generate the client during the build process.

## 5. Post-Deployment Verification
- Navigate to `/login` on your live domain.
- Attempt to log in with a phone number from the `customers_export.csv`.
- Verify that the portal dashboard displays your recent orders correctly.
