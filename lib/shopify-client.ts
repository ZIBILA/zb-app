import prisma from './db';
import { decryptSecret } from './crypto/secret-box';

const API_VERSION = '2025-01';
export { API_VERSION };

/**
 * Auto-mint Shopify Admin tokens via client_credentials for the Render/dev shop only.
 *
 * IMPORTANT: Next.js forces NODE_ENV=development|production during `next dev` / `next start`,
 * so we also honor SHOPIFY_ENV=render (and SHOPIFY_AUTO_REFRESH_TOKEN=true).
 * Production DigitalOcean must leave those unset and keep using the legacy static token.
 */
export function shouldAutoRefreshShopifyAdminToken(): boolean {
  // Never mint rotating tokens during `next build` static generation —
  // cache: 'no-store' fetch throws DYNAMIC_SERVER_USAGE and floods build logs.
  if (process.env.NEXT_PHASE === 'phase-production-build') return false;
  if (process.env.SHOPIFY_AUTO_REFRESH_TOKEN === 'true') return true;
  if (String(process.env.SHOPIFY_ENV || '').toLowerCase() === 'render') return true;
  return String(process.env.NODE_ENV) === 'render';
}

declare global {
  // eslint-disable-next-line no-var
  var _cachedShopConfig: { domain: string; accessToken: string } | undefined;
  // eslint-disable-next-line no-var
  var _shopifyClientCredToken:
    | { token: string; expiresAt: number; domain: string }
    | undefined;
  // eslint-disable-next-line no-var
  var _shopifyClientCredInflight: Promise<string> | undefined;
}

/** Refresh 5 minutes before Shopify expiry. */
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

async function mintShopifyClientCredentialsToken(domain: string): Promise<string> {
  const clientId = process.env.SHOPIFY_API_KEY || '';
  const clientSecret = process.env.SHOPIFY_API_SECRET || '';

  if (!clientId || !clientSecret) {
    throw new Error(
      '[Shopify Client] NODE_ENV=render auto-refresh needs SHOPIFY_API_KEY and SHOPIFY_API_SECRET'
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[Shopify Client] client_credentials failed [${res.status}]: ${text}`);
  }

  let data: { access_token?: string; expires_in?: number; error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`[Shopify Client] client_credentials returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!data.access_token) {
    throw new Error(`[Shopify Client] client_credentials missing access_token: ${text.slice(0, 200)}`);
  }

  const expiresInSec = Number(data.expires_in) || 24 * 60 * 60;
  global._shopifyClientCredToken = {
    token: data.access_token,
    expiresAt: Date.now() + expiresInSec * 1000,
    domain,
  };
  // Drop static config cache so headers() picks up the new token
  global._cachedShopConfig = undefined;

  console.log(
    `[Shopify Client] Minted Admin token for ${domain} (expires in ~${Math.round(expiresInSec / 3600)}h, NODE_ENV=render)`
  );

  return data.access_token;
}

/**
 * Cached client_credentials token. Concurrent callers share one in-flight mint.
 * force=true clears cache (e.g. after HTTP 401).
 */
export async function getShopifyClientCredentialsToken(
  domain: string,
  opts?: { force?: boolean }
): Promise<string> {
  if (!shouldAutoRefreshShopifyAdminToken()) {
    throw new Error('[Shopify Client] client_credentials refresh is only enabled when NODE_ENV=render');
  }

  const cached = global._shopifyClientCredToken;
  if (
    !opts?.force &&
    cached?.token &&
    cached.domain === domain &&
    Date.now() < cached.expiresAt - TOKEN_REFRESH_SKEW_MS
  ) {
    return cached.token;
  }

  if (opts?.force) {
    global._shopifyClientCredToken = undefined;
    global._shopifyClientCredInflight = undefined;
  }

  if (!global._shopifyClientCredInflight) {
    global._shopifyClientCredInflight = mintShopifyClientCredentialsToken(domain).finally(() => {
      global._shopifyClientCredInflight = undefined;
    });
  }

  return global._shopifyClientCredInflight;
}

export async function getShopConfig() {
  try {
    const finalDomain =
      process.env.SHOPIFY_STORE_DOMAIN ||
      process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
      '8tiahf-bk.myshopify.com';

    // Render/dev only: mint + cache rotating Admin token from Client ID/Secret
    if (shouldAutoRefreshShopifyAdminToken()) {
      try {
        const accessToken = await getShopifyClientCredentialsToken(finalDomain);
        const config = { domain: finalDomain, accessToken };
        global._cachedShopConfig = config;
        return config;
      } catch (mintErr) {
        console.warn('[Shopify Client] Auto-refresh mint failed, falling back to static token:', mintErr);
        // fall through to static env/DB token
      }
    }

    if (global._cachedShopConfig) return global._cachedShopConfig;

    // Production / non-render: static env token (or DB)
    const envToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
    let finalToken = envToken;

    if (!finalToken) {
      try {
        const shop = await prisma.shop.findFirst({ select: { accessToken: true } });
        if (shop?.accessToken) {
          finalToken = decryptSecret(shop.accessToken);
        }
      } catch (dbErr) {
        console.warn('[Shopify Client] DB token lookup failed:', dbErr);
      }
    }

    const config = {
      domain: finalDomain,
      accessToken: finalToken,
    };

    if (finalToken) {
      global._cachedShopConfig = config;
    }

    return config;
  } catch (error) {
    console.warn('[Shopify Admin] Config fetch failed:', error);
    return {
      domain: process.env.SHOPIFY_STORE_DOMAIN || '8tiahf-bk.myshopify.com',
      accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
    };
  }
}

export async function adminUrl(endpoint: string): Promise<string> {
  const { domain } = await getShopConfig();
  return `https://${domain}/admin/api/${API_VERSION}/${endpoint}`;
}

export async function headers(): Promise<HeadersInit> {
  const { accessToken } = await getShopConfig();
  if (!accessToken) {
    console.error('[Shopify Client] No access token found for headers');
  }
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken || '',
  };
}

// In-memory cache for GET requests to prevent rate limiting (429)
// especially during dashboard polling.
const requestCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes cache

export async function shopifyFetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(await adminUrl(endpoint));
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const cacheKey = url.toString();
  const now = Date.now();
  const cached = requestCache.get(cacheKey);

  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    return cached.data as T;
  }

  const MAX_RETRIES = 3;
  let lastError: Error | null = null;
  let didForceTokenRefresh = false;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const isBuild = process.env.NEXT_PHASE === 'phase-production-build';
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: await headers(),
      cache: isBuild ? 'force-cache' : 'no-store',
    });

    if (res.ok) {
      const data = await res.json();
      requestCache.set(cacheKey, { data, timestamp: Date.now() });
      return data as T;
    }

    // Expired client_credentials token (render only) — remint once and retry
    if (
      res.status === 401 &&
      shouldAutoRefreshShopifyAdminToken() &&
      !didForceTokenRefresh
    ) {
      didForceTokenRefresh = true;
      try {
        const { domain } = await getShopConfig();
        await getShopifyClientCredentialsToken(domain, { force: true });
        console.warn('[Shopify Client] 401 — reminted Admin token, retrying');
        continue;
      } catch (refreshErr) {
        console.error('[Shopify Client] 401 remint failed:', refreshErr);
      }
    }

    if (res.status === 429 || res.status >= 500) {
      const { shouldLogThrottled } = await import('@/lib/log-throttle');
      if (res.status === 429 && cached) {
        if (shouldLogThrottled(`shopify:429:stale:${endpoint}`, 60_000)) {
          console.warn(`[Shopify Client] Rate limited. Serving stale cache for ${endpoint}`);
        }
        return cached.data as T;
      }
      const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
      const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * Math.pow(2, attempt), 4000);
      if (shouldLogThrottled(`shopify:${res.status}:${endpoint}`, 30_000)) {
        console.warn(
          `[Shopify Client] ${endpoint} returned ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      lastError = new Error(`Shopify API ${res.status}: transient failure on ${endpoint}`);
      continue;
    }

    const text = await res.text();
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }

  throw lastError || new Error(`Shopify API: Max retries exceeded for ${endpoint}`);
}

export function clearShopConfigCache() {
  global._cachedShopConfig = undefined;
  global._shopifyClientCredToken = undefined;
  global._shopifyClientCredInflight = undefined;
  requestCache.clear();
}
