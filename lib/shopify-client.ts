import prisma from './db';
import { decryptSecret } from './crypto/secret-box';

const API_VERSION = '2025-01';
export { API_VERSION };

/**
 * Auto-mint Shopify Admin tokens via client_credentials for the Render/dev shop only.
 *
 * IMPORTANT — production (DigitalOcean / live) safety:
 * - Prod must NOT set SHOPIFY_ENV=render or SHOPIFY_AUTO_REFRESH_TOKEN=true.
 * - Prod keeps using the legacy static SHOPIFY_ADMIN_ACCESS_TOKEN only.
 * - Optional hard kill-switch: SHOPIFY_USE_STATIC_ADMIN_TOKEN=true forces static forever.
 * - Next.js forces NODE_ENV=production on `next start` even on Render, so we key off
 *   SHOPIFY_ENV / SHOPIFY_AUTO_REFRESH_TOKEN — never off NODE_ENV===production.
 */
export function shouldAutoRefreshShopifyAdminToken(): boolean {
  // Never mint during `next build` static generation.
  if (process.env.NEXT_PHASE === 'phase-production-build') return false;

  // Hard kill-switch — use on production if you want belt-and-suspenders.
  if (String(process.env.SHOPIFY_USE_STATIC_ADMIN_TOKEN || '').toLowerCase() === 'true') {
    return false;
  }

  // Explicit opt-in only (Render/dev). Production leaves these unset → static token path.
  if (process.env.SHOPIFY_AUTO_REFRESH_TOKEN === 'true') return true;
  if (String(process.env.SHOPIFY_ENV || '').toLowerCase() === 'render') return true;

  // NODE_ENV is never literally "render" under Next.js; do not treat production as render.
  return false;
}

/**
 * POST form body via Node https — NOT global/Next fetch.
 * Next patches fetch and throws DYNAMIC_SERVER_USAGE for cache:'no-store' on ISR pages
 * (e.g. homepage revalidate=60). Native https bypasses that; production never calls this.
 *
 * Lazy require('https') — top-level `import … from 'node:https'` breaks Next 14 webpack
 * (TypeError: Cannot read properties of undefined (reading 'call')).
 */
function httpsPostForm(
  urlStr: string,
  body: string
): Promise<{ status: number; text: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const https = require('https') as typeof import('https');
  const url = new URL(urlStr);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.setTimeout(20_000, () => {
      req.destroy(new Error('[Shopify Client] client_credentials request timed out'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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
      '[Shopify Client] Render auto-refresh needs SHOPIFY_API_KEY and SHOPIFY_API_SECRET'
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  // Native https — must not use Next fetch (DYNAMIC_SERVER_USAGE on ISR).
  const { status, text } = await httpsPostForm(
    `https://${domain}/admin/oauth/access_token`,
    body
  );

  if (status < 200 || status >= 300) {
    throw new Error(`[Shopify Client] client_credentials failed [${status}]: ${text}`);
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
    `[Shopify Client] Minted Admin token for ${domain} (expires in ~${Math.round(expiresInSec / 3600)}h, SHOPIFY_ENV=render)`
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
    throw new Error(
      '[Shopify Client] client_credentials refresh is only enabled when SHOPIFY_ENV=render (or SHOPIFY_AUTO_REFRESH_TOKEN=true)'
    );
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

    // Render/dev ONLY (explicit SHOPIFY_ENV=render). Production never enters this branch.
    if (shouldAutoRefreshShopifyAdminToken()) {
      try {
        const accessToken = await getShopifyClientCredentialsToken(finalDomain);
        const config = { domain: finalDomain, accessToken };
        global._cachedShopConfig = config;
        return config;
      } catch (mintErr) {
        // Real mint failure only (network/creds). Do not swallow — static env token on
        // Render is usually expired and causes cascading 401s.
        console.warn(
          '[Shopify Client] Auto-refresh mint failed, falling back to static token:',
          mintErr
        );
        // fall through to static env/DB token (last resort on Render)
      }
    }

    if (global._cachedShopConfig) return global._cachedShopConfig;

    // Production / non-render: static env token (or DB) — unchanged path
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
const inflightGets = new Map<string, Promise<any>>();
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes cache

/** Tag used with Next.js Data Cache + revalidateTag('shopify-catalog') on product webhooks. */
export const SHOPIFY_CATALOG_CACHE_TAG = 'shopify-catalog';

/**
 * live    — no-store (checkout, inventory, customers, single-product ops). Default.
 * catalog — ISR-friendly revalidate (sitemap, collections, product lists). Still
 *           invalidated immediately via refreshStorefront / revalidateTag.
 */
export type ShopifyGetCacheMode = 'live' | 'catalog';

export interface ShopifyFetchOptions {
  cacheMode?: ShopifyGetCacheMode;
  /** Override in-memory TTL (ms). */
  ttlMs?: number;
}

const CATALOG_REVALIDATE_SECONDS = 300;

/** Cap concurrent Admin GETs so metafield/list stampedes cannot exhaust the Shopify bucket. */
const MAX_ADMIN_GET_CONCURRENCY = Math.max(
  1,
  Math.min(8, parseInt(process.env.SHOPIFY_ADMIN_GET_CONCURRENCY || '4', 10) || 4)
);
let adminGetActive = 0;
const adminGetWaiters: Array<() => void> = [];

async function withAdminGetSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (adminGetActive >= MAX_ADMIN_GET_CONCURRENCY) {
    await new Promise<void>((resolve) => adminGetWaiters.push(resolve));
  }
  adminGetActive++;
  try {
    return await fn();
  } finally {
    adminGetActive--;
    const next = adminGetWaiters.shift();
    if (next) next();
  }
}

/** Build fetch init for Admin GETs without forcing Dynamic Server Usage on catalog routes. */
export function shopifyGetFetchInit(cacheMode: ShopifyGetCacheMode = 'live'): RequestInit {
  const isBuild = process.env.NEXT_PHASE === 'phase-production-build';
  if (isBuild) {
    return { cache: 'force-cache' };
  }
  if (cacheMode === 'catalog') {
    return {
      next: {
        revalidate: CATALOG_REVALIDATE_SECONDS,
        tags: [SHOPIFY_CATALOG_CACHE_TAG],
      },
    } as RequestInit;
  }
  return { cache: 'no-store' };
}

async function shopifyFetchOnce<T>(
  cacheKey: string,
  endpoint: string,
  opts: ShopifyFetchOptions,
  cached: { data: any; timestamp: number } | undefined
): Promise<T> {
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;
  let didForceTokenRefresh = false;
  const cacheMode = opts.cacheMode || 'live';
  const ttlMs = opts.ttlMs ?? CACHE_TTL;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await withAdminGetSlot(async () =>
      fetch(cacheKey, {
        method: 'GET',
        headers: await headers(),
        ...shopifyGetFetchInit(cacheMode),
      })
    );

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
      const delay = (retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * Math.pow(2, attempt), 4000)) + Math.floor(Math.random() * 500);
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

  // Prefer stale over hard failure after exhausting retries (same as previous 429 stale path).
  if (cached && Date.now() - cached.timestamp < Math.max(ttlMs * 10, 30 * 60 * 1000)) {
    const { shouldLogThrottled } = await import('@/lib/log-throttle');
    if (shouldLogThrottled(`shopify:stale-after-retries:${endpoint}`, 60_000)) {
      console.warn(`[Shopify Client] Exhausted retries; serving stale cache for ${endpoint}`);
    }
    return cached.data as T;
  }

  throw lastError || new Error(`Shopify API: Max retries exceeded for ${endpoint}`);
}

export async function shopifyFetch<T>(
  endpoint: string,
  params?: Record<string, string>,
  opts: ShopifyFetchOptions = {}
): Promise<T> {
  const url = new URL(await adminUrl(endpoint));
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const cacheKey = url.toString();
  const now = Date.now();
  const ttlMs = opts.ttlMs ?? CACHE_TTL;
  const cached = requestCache.get(cacheKey);

  if (cached && now - cached.timestamp < ttlMs) {
    return cached.data as T;
  }

  // Coalesce identical in-flight GETs (layout + sitemap + list stampede).
  const existing = inflightGets.get(cacheKey);
  if (existing) return existing as Promise<T>;

  const promise = shopifyFetchOnce<T>(cacheKey, endpoint, opts, cached).finally(() => {
    inflightGets.delete(cacheKey);
  });
  inflightGets.set(cacheKey, promise);
  return promise;
}

export function clearShopConfigCache() {
  global._cachedShopConfig = undefined;
  global._shopifyClientCredToken = undefined;
  global._shopifyClientCredInflight = undefined;
  requestCache.clear();
  inflightGets.clear();
}
