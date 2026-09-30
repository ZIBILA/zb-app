import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

export function getPhoneLast10(phone?: string | null): string | null {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function attachPhoneLast10(data: any) {
  if (!data || typeof data !== 'object') return;
  if (data.phone !== undefined) {
    data.phoneLast10 = getPhoneLast10(data.phone);
  }
  if (data.customerPhone !== undefined) {
    data.phoneLast10 = getPhoneLast10(data.customerPhone);
  }
}

// Mock Prisma client for when database is unavailable
const createMockPrismaClient = (reason: string) => {
  console.warn(`[DB] Using mock Prisma client. Reason: ${reason}`);
  const handler: any = {
    get: function(target: any, prop: any) {
      if (prop === '_isMock') return true;
      if (prop === '_mockReason') return reason;
      if (prop === 'then') return undefined;
      if (typeof prop === 'string' && prop.startsWith('$')) {
        return () => Promise.resolve([]);
      }
      const mockReturn = (targetProp: string) => {
        if (targetProp === 'count') return 0;
        if (targetProp === 'findMany') return [];
        return { 
          id: 'mock_id', 
          shopifyId: 'mock_shopify_id', 
          handle: 'mock_handle', 
          domain: 'mock.myshopify.com',
          title: 'Mock Item',
          orders: []
        };
      };
      return new Proxy(
        function(...args: any[]) {
          return Promise.resolve(mockReturn(String(prop)));
        },
        handler
      );
    }
  };
  return new Proxy({}, handler) as unknown as PrismaClient;
};

const prismaClientSingleton = () => {
  // URL resolution priority:
  // 1. SUPABASE_DATABASE_URL (explicitly set for Supabase pooler)
  // 2. POSTGRES_PRISMA_URL (Vercel-style, typically transaction pooler)
  // 3. POSTGRES_URL (Vercel-style)
  // 4. DATABASE_URL (fallback)
  
  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (supabaseUrl) {
    process.env.DATABASE_URL = supabaseUrl;
    // Clear other cloud platform overrides to force connecting to Supabase
    delete process.env.POSTGRES_PRISMA_URL;
    delete process.env.POSTGRES_URL;
  }
  const dbUrl = process.env.DATABASE_URL || '';
  const isSqlite = dbUrl.startsWith('file:');

  let pgUrl =
    supabaseUrl ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    (dbUrl && !isSqlite ? dbUrl : '');

  const isValidPgUrl = pgUrl && !pgUrl.includes('(not available)') && !pgUrl.includes('placeholder') && pgUrl !== '';

  if (isValidPgUrl && !isSqlite) {
    // Sanitize connection string SSL mode for Supabase / PostgreSQL pooled connection.
    // node-postgres pg-connection-string converts sslmode=require into rejectUnauthorized: true,
    // overriding Pool ssl option and causing TLS self-signed cert chain error.
    if (pgUrl.includes('sslmode=require') || pgUrl.includes('sslmode=verify-ca') || pgUrl.includes('sslmode=verify-full')) {
      pgUrl = pgUrl.replace(/sslmode=(require|verify-ca|verify-full)/g, 'sslmode=no-verify');
    } else if (!pgUrl.includes('sslmode=')) {
      pgUrl += (pgUrl.includes('?') ? '&' : '?') + 'sslmode=no-verify';
    }
    process.env.DATABASE_URL = pgUrl;
    if (process.env.SUPABASE_DATABASE_URL) {
      process.env.SUPABASE_DATABASE_URL = pgUrl;
    }
  }

  const isBuild = process.env.NEXT_PHASE === 'phase-production-build';
  if (isBuild) {
    return createMockPrismaClient('build');
  }

  if (!pgUrl || pgUrl.includes('placeholder') || pgUrl === '' || pgUrl.includes('(not available)')) {
    console.error('[DB] No database URL found. Set DATABASE_URL.');
    if (process.env.ALLOW_DB_MOCK === 'true') {
      return createMockPrismaClient('no_db_url');
    }
    throw new Error('[DB] Critical database configuration error: SUPABASE_DATABASE_URL / DATABASE_URL is missing or invalid!');
  }

  // Log which URL we're connecting to (redact password)
  const safeUrl = pgUrl.replace(/:([^@:]+)@/, ':****@');
  console.log(`[DB] Connecting via: ${safeUrl}`);

  try {
    // Connection Pool Configuration:
    // Configured for Supabase pooler (port 6543 / Supavisor transaction pooler).
    // Uses max: 10 connections to allow parallel analytics queries without client queue starvation.
    // statement_timeout = 12s gives aggregations enough headroom while protecting against deadlocks.
    const poolMax = process.env.PG_POOL_MAX ? parseInt(process.env.PG_POOL_MAX) : 12;
    const pool = new Pool({
      connectionString: pgUrl,
      ssl: { 
        rejectUnauthorized: false 
      },
      max: poolMax,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
    });

    // Set statement_timeout on every new connection (12s cap)
    pool.on('connect', (client) => {
      client.query('SET statement_timeout = 12000').catch(() => {});
    });

    pool.on('error', (err) => {
      const msg = String(err?.message || '');
      if (msg.includes('ECIRCUITBREAKER')) {
        console.error('[DB] Pool: ECIRCUITBREAKER — Supabase has temporarily blocked connections. Will auto-recover when breaker resets.');
      } else {
        console.error('[DB] Unexpected error on idle client:', msg);
      }
    });

    const adapter = new PrismaPg(pool as any);

    const client = new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });

    const extendedClient = client.$extends({
      query: {
        $allModels: {
          async create({ model, args, query }) {
            if (['Customer', 'WebStoreCustomer', 'WebStoreOrder', 'Address', 'Cart'].includes(model)) {
              attachPhoneLast10(args.data);
            }
            return query(args);
          },
          async update({ model, args, query }) {
            if (['Customer', 'WebStoreCustomer', 'WebStoreOrder', 'Address', 'Cart'].includes(model)) {
              attachPhoneLast10(args.data);
            }
            return query(args);
          },
          async upsert({ model, args, query }) {
            if (['Customer', 'WebStoreCustomer', 'WebStoreOrder', 'Address', 'Cart'].includes(model)) {
              if (args.create) attachPhoneLast10(args.create);
              if (args.update) attachPhoneLast10(args.update);
            }
            return query(args);
          },
          async createMany({ model, args, query }) {
            if (['Customer', 'WebStoreCustomer', 'WebStoreOrder', 'Address', 'Cart'].includes(model)) {
              if (Array.isArray(args.data)) {
                args.data.forEach(attachPhoneLast10);
              } else {
                attachPhoneLast10(args.data);
              }
            }
            return query(args);
          },
          async updateMany({ model, args, query }) {
            if (['Customer', 'WebStoreCustomer', 'WebStoreOrder', 'Address', 'Cart'].includes(model)) {
              attachPhoneLast10(args.data);
            }
            return query(args);
          }
        },
        customer: {
          async create({ args, query }) {
            const customer = await query(args);
            try {
              if (customer) {
                import('./services/eventTracker').then(({ eventTracker }) => {
                  eventTracker.track({
                    eventName: 'Lead Created',
                    customerId: customer.id,
                    customerPhone: customer.phone,
                    eventSource: 'web',
                    metadata: { source: 'db_hook_signup' }
                  });
                  eventTracker.track({
                    eventName: 'User Registered',
                    customerId: customer.id,
                    customerPhone: customer.phone,
                    eventSource: 'web',
                    metadata: { source: 'db_hook_signup' }
                  });
                }).catch(() => {});
              }
            } catch (err) {
              console.error('[DB Middleware Error]:', err);
            }
            return customer;
          }
        },
        appLogin: {
          async create({ args, query }) {
            const appLogin = await query(args);
            try {
              if (appLogin && (appLogin.status === 'SUCCESS' || appLogin.status === 'ACCOUNT_CREATED')) {
                import('./services/eventTracker').then(async ({ eventTracker }) => {
                  const cleanPhone = appLogin.phone ? appLogin.phone.replace(/\D/g, "") : "";
                  const last10 = cleanPhone.slice(-10);
                  let customerId = null;
                  if (last10.length === 10) {
                    const customer = await client.customer.findFirst({
                      where: { phoneLast10: last10 }
                    });
                    customerId = customer?.id || null;
                  }
                  eventTracker.track({
                    eventName: 'User Login',
                    customerId,
                    customerPhone: appLogin.phone,
                    eventSource: 'web',
                    metadata: { userAgent: appLogin.userAgent, status: appLogin.status }
                  });
                }).catch(() => {});
              }
            } catch (err) {
              console.error('[DB Middleware Error]:', err);
            }
            return appLogin;
          }
        }
      }
    });

    // IMPORTANT: The analytics page must never exceed pool capacity.
    // This is guaranteed by: (1) client-side wave loading (max 2 routes at a time),
    // (2) per-route pLimit(4) concurrency limiter, and (3) 30s in-process caching.
    // Do NOT raise poolMax above Supavisor's connection limit.
    console.log(`[DB] Prisma Client initialized with PgAdapter (Pooler max:${poolMax}, statement_timeout:12s)`);
    return extendedClient as any;
  } catch (error: any) {
    console.error('[DB] Critical Prisma initialization error:', error.message);
    if (process.env.ALLOW_DB_MOCK === 'true') {
      return createMockPrismaClient(`init_error: ${error.message}`);
    }
    throw new Error(`[DB] Critical Prisma initialization error: ${error.message}`);
  }
};

declare const globalThis: {
  __prisma_fresh_v3: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const prisma = globalThis.__prisma_fresh_v3 ?? prismaClientSingleton();

// Cache the Prisma client instance globally in all environments to prevent connection leaks
globalThis.__prisma_fresh_v3 = prisma;

export default prisma;

export const DEFAULT_SHOP_SETTINGS = {
  id: 'env-fallback',
  domain: process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || '8tiahf-bk.myshopify.com',
  accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  heroTitle: "Redefine The Standard",
  heroSubtitle: "Atmospheric luxury streetwear",
  heroButtonText: "Discover",
  latestCurationTitle: "Latest curation",
  latestCurationSubtitle: "Season Drop",
  archiveTitle: "The Archive",
  archiveSubtitle: "Organic Evolution",
  blueprintTitle: "The blueprint of Zica Bella",
  blueprintSubtitle: "Technique & Motion",
  showHeroText: true,
  showLatestCuration: true,
  showArchive: true,
  showBlueprint: true,
  showCommunity: true,
  communityTitle: "Featured Looks",
  communitySubtitle: "Community",
  spotlightTitle: "AUTHENTIC STREETWEAR",
  spotlightSubtitle: "Luxury Indian streetwear for modern men. Redefining bold everyday style.",
  spotlightCollection: "tshirts",
  shopAllLink: "/collections/all",
  footerLogo3dUrl: "https://cdn.shopify.com/3d/models/e024b09e83a75c03/Zicabella-silver-logo.glb",
  showProductVideo: true,
  showSizeChart: true,
  showBrand: true,
  showShippingReturn: true,
  showCare: true,
  showSizeFit: true,
  showDetails: true,
  showTreeText: true,
  communityMinOrders: 1,
  communityAgeRestricted: true,
  communityWhatsAppEnabled: true,
  showRingCarousel: true,
  ringCarouselTitle: "RING COLLECTION",
  flipbookTitle: "Archival Vision",
  flipbookTag: "Core Manifest",
  flipbookDesc: "Engineered for those who move without compromise.",
};

import * as fs from 'fs';
import * as path from 'path';

const SETTINGS_FILE_PATH = path.resolve(process.cwd(), 'data/store-settings.json');

export function getPersistentSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE_PATH)) {
      const fileData = fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(fileData);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        return { ...DEFAULT_SHOP_SETTINGS, ...parsed };
      }
    }
  } catch (e: any) {
    console.warn('[DB] Failed to read store-settings.json:', e.message);
  }
  return DEFAULT_SHOP_SETTINGS;
}

export function savePersistentSettings(updatedData: Record<string, any>) {
  try {
    const current = getPersistentSettings();
    const merged = { ...current, ...updatedData };
    delete merged.accessToken;
    const dataDir = path.dirname(SETTINGS_FILE_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(merged, null, 2), 'utf-8');
    console.log('[DB] Successfully persisted shop settings to store-settings.json');
    return merged;
  } catch (e: any) {
    console.error('[DB] Failed to save store-settings.json:', e.message);
    return updatedData;
  }
}

export async function getShopSettings() {
  try {
    const isMock = (prisma as any)._isMock;
    if (isMock) {
      return getPersistentSettings();
    }
    const shop = await prisma.shop.findUnique({ where: { domain: '8tiahf-bk.myshopify.com' } })
      ?? await prisma.shop.findFirst();
    if (shop) {
      const persistent = getPersistentSettings();
      const cleanShop: Record<string, any> = {};
      for (const [k, v] of Object.entries(shop)) {
        if (v !== null && v !== undefined) {
          cleanShop[k] = v;
        }
      }
      return { ...DEFAULT_SHOP_SETTINGS, ...persistent, ...cleanShop };
    }
    return getPersistentSettings();
  } catch (error: any) {
    console.error('[DB] getShopSettings query failed, using persistent fallback:', error.message);
    return getPersistentSettings();
  }
}

export async function updateShopSettings(updates: Record<string, any>) {
  // Always update persistent JSON file to prevent desync during DB timeouts/redeployments
  const updatedPersistent = savePersistentSettings(updates);

  try {
    const isMock = (prisma as any)._isMock;
    if (isMock) {
      console.warn('[DB] Prisma is in mock mode; saved updates to persistent store-settings.json.');
      return updatedPersistent;
    }

    let shop = await prisma.shop.findUnique({ where: { domain: '8tiahf-bk.myshopify.com' } })
      ?? await prisma.shop.findFirst();

    if (!shop) {
      shop = await prisma.shop.create({
        data: {
          domain: '8tiahf-bk.myshopify.com',
          accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || 'shpat_required',
          ...updates
        }
      });
    } else {
      shop = await prisma.shop.update({
        where: { id: shop.id },
        data: updates
      });
    }

    // Sync other shop records if multiple exist
    try {
      const syncData = { ...updates };
      delete syncData.domain;
      delete syncData.accessToken;
      await prisma.shop.updateMany({
        where: { id: { not: shop.id } },
        data: syncData
      });
    } catch {}

    const cleanShop: Record<string, any> = {};
    for (const [k, v] of Object.entries(shop)) {
      if (v !== null && v !== undefined) {
        cleanShop[k] = v;
      }
    }

    return { ...DEFAULT_SHOP_SETTINGS, ...updatedPersistent, ...cleanShop };
  } catch (error: any) {
    console.error('[DB] updateShopSettings DB update failed, falling back to persistent file:', error.message);
    return updatedPersistent;
  }
}

export async function getStoreSettings(pageKey: string) {
  try {
    return await prisma.storeSettings.findUnique({ where: { pageKey } });
  } catch (error: any) {
    console.error(`[DB] getStoreSettings direct query failed for ${pageKey}:`, error.message);
    return null;
  }
}





