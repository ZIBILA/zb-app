/**
 * True on local + Render/dev deployments where NODE_ENV (or SHOPIFY_ENV) is set to "render".
 *
 * Next.js normally forces NODE_ENV to development|production, so this project also uses
 * SHOPIFY_ENV=render for the same environments (see lib/shopify-client.ts). Production
 * DigitalOcean must leave both unset / not equal to "render".
 */
export function isRenderDevEnv(): boolean {
  if (String(process.env.NODE_ENV) === 'render') return true;
  if (String(process.env.SHOPIFY_ENV || '').toLowerCase() === 'render') return true;
  return false;
}
