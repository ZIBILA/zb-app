/**
 * True on local + Render/dev deployments where SHOPIFY_ENV is set to "render".
 *
 * Next.js forces NODE_ENV to development|production, so Render/dev must set
 * SHOPIFY_ENV=render (see lib/shopify-client.ts). Production DigitalOcean must
 * leave SHOPIFY_ENV unset (and should not set SHOPIFY_AUTO_REFRESH_TOKEN).
 */
export function isRenderDevEnv(): boolean {
  if (String(process.env.SHOPIFY_USE_STATIC_ADMIN_TOKEN || '').toLowerCase() === 'true') {
    return false;
  }
  if (String(process.env.SHOPIFY_ENV || '').toLowerCase() === 'render') return true;
  if (process.env.SHOPIFY_AUTO_REFRESH_TOKEN === 'true') return true;
  return false;
}
