import prisma from './db';
import { decryptSecret } from './crypto/secret-box';

const API_VERSION = '2025-01';
export { API_VERSION };

// Declare global for caching config to avoid 'any'
declare global {
  // eslint-disable-next-line no-var
  var _cachedShopConfig: { domain: string; accessToken: string } | undefined;
}

export async function getShopConfig() {
  try {
    if (global._cachedShopConfig) return global._cachedShopConfig;
    
    // Primary: use environment variables directly for production stability
    const envToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
    let finalToken = envToken;

    // If no env token, fall back to DB (token may be encrypted)
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

    const finalDomain = process.env.SHOPIFY_STORE_DOMAIN || process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || '8tiahf-bk.myshopify.com';
    
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

    if (res.status === 429) {
      // Rate limited — serve stale cache if available
      if (cached) {
        console.warn(`[Shopify Client] Rate limited. Serving stale cache for ${endpoint}`);
        return cached.data as T;
      }
      // No cache — wait with exponential backoff and retry
      const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
      const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * Math.pow(2, attempt), 4000);
      console.warn(`[Shopify Client] Rate limited on ${endpoint}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      lastError = new Error(`Shopify API 429: Rate limited on ${endpoint}`);
      continue;
    }

    // Non-429 error — throw immediately
    const text = await res.text();
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }

  throw lastError || new Error(`Shopify API: Max retries exceeded for ${endpoint}`);
}

export function clearShopConfigCache() {
  global._cachedShopConfig = undefined;
  requestCache.clear();
}

