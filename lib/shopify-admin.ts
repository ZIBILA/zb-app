/**
 * Shopify Admin API Client
 * Centralized client for all Shopify Admin REST API calls.
 * Fetches the Admin access token dynamically from the local database.
 */

import prisma from './db';
import { parseShopifyRichText } from './utils';
import { toE164 } from './shopify-phone';

export { parseShopifyRichText };

import { 
  getShopConfig, 
  shopifyFetch, 
  adminUrl, 
  headers,
  API_VERSION,
  clearShopConfigCache
} from './shopify-client';

export { getShopConfig, shopifyFetch, adminUrl, headers, clearShopConfigCache, shopifyPatch };

const pageCache = new Map<string, { data: any, nextPageUrl?: string, timestamp: number }>();
const PAGE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function clearShopifyCache() {
  pageCache.clear();
  clearShopConfigCache();
}

async function shopifyFetchPage<T>(urlStr: string): Promise<{ data: T; nextPageUrl?: string }> {
  const now = Date.now();
  const cached = pageCache.get(urlStr);

  if (cached && (now - cached.timestamp < PAGE_CACHE_TTL)) {
    return { data: cached.data as T, nextPageUrl: cached.nextPageUrl };
  }

  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const isBuild = process.env.NEXT_PHASE === 'phase-production-build';
    const res = await fetch(urlStr, {
      method: 'GET',
      headers: await headers(),
      cache: isBuild ? 'force-cache' : 'no-store',
    });

    if (res.status === 429) {
      // Rate limited — serve stale cache if available
      if (cached) {
        console.warn(`[Shopify Admin] Rate limited on page fetch. Serving stale cache.`);
        return { data: cached.data as T, nextPageUrl: cached.nextPageUrl };
      }
      // No cache — wait with exponential backoff and retry
      const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
      const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * Math.pow(2, attempt), 4000);
      console.warn(`[Shopify Admin] Rate limited on page fetch, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      console.error(`Shopify Admin API error [${res.status}]: ${text}`);
      throw new Error(`Shopify API ${res.status}: ${text}`);
    }

    const data = await res.json();
    if (!data) {
      console.error(`[Shopify Admin] API returned empty/null data`);
      return { data: {} as T, nextPageUrl: undefined };
    }

    const linkHeader = res.headers.get('Link');
    let nextPageUrl: string | undefined;

    if (linkHeader) {
      const links = linkHeader.split(',');
      for (const link of links) {
        if (link.includes('rel="next"')) {
          const match = link.match(/<([^>]+)>/);
          if (match) {
            nextPageUrl = match[1];
          }
        }
      }
    }

    pageCache.set(urlStr, { data, nextPageUrl, timestamp: Date.now() });
    return { data, nextPageUrl };
  }

  throw new Error(`Shopify Admin API: Max retries exceeded for page fetch`);
}

/**
 * Execute a Shopify GraphQL API request.
 */
export async function shopifyGraphqlFetch<T>(query: string, variables?: any): Promise<T> {
  const { domain } = await getShopConfig();
  const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;
  
  const isBuild = process.env.NEXT_PHASE === 'phase-production-build';
  const res = await fetch(url, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({ query, variables }),
    cache: isBuild ? 'force-cache' : 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify GraphQL Error [${res.status}]: ${text}`);
  }

  const result = await res.json();
  if (result.errors) {
    throw new Error(`Shopify GraphQL Error: ${JSON.stringify(result.errors)}`);
  }
  return result.data as T;
}

async function shopifyFetchAll<T>(endpoint: string, params?: Record<string, string>, dataKey?: string): Promise<T[]> {
  const url = new URL(await adminUrl(endpoint));
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  
  let currentUrl: string | undefined = url.toString();
  let allResults: any[] = [];

  while (currentUrl) {
    console.log(`[Shopify Sync] Fetching page: ${currentUrl}`);
    const pageData: { data: any; nextPageUrl?: string } = await shopifyFetchPage<any>(currentUrl);
    
    if (!pageData.data) {
      console.warn(`[Shopify Sync] No data returned for URL: ${currentUrl}`);
      break;
    }

    // Shopify returns data wrapped in a key like { orders: [...] }
    const items = dataKey && pageData.data[dataKey] 
      ? pageData.data[dataKey] 
      : (typeof pageData.data === 'object' ? Object.values(pageData.data)[0] : null);

    if (Array.isArray(items)) {
      allResults = allResults.concat(items);
    } else {
      console.warn(`[Shopify Sync] Items at ${dataKey || 'first key'} is not an array:`, items);
    }
    
    currentUrl = pageData.nextPageUrl;
  }
  
  return allResults;
}

async function shopifyPost<T>(endpoint: string, body: unknown, customHeaders?: Record<string, string>): Promise<T> {
  const url = await adminUrl(endpoint);
  const baseHeaders = await headers();
  const requestHeaders = { ...baseHeaders, ...(customHeaders || {}) };
  const MAX = 4;
  for (let attempt = 0; attempt < MAX; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return res.json();
    }

    if ((res.status === 429 || res.status >= 500) && attempt < MAX - 1) {
      const ra = parseInt(res.headers.get('Retry-After') || '0', 10);
      const delay = ra > 0 ? ra * 1000 : Math.min(1000 * Math.pow(2, attempt), 4000);
      console.warn(`[Shopify Admin] POST ${endpoint} returned ${res.status}. Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX})...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    const text = await res.text();
    console.error(`Shopify Admin API POST error [${res.status}]: ${text}`);
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }
  throw new Error('Shopify API: exhausted retries for POST');
}

async function shopifyPatch<T>(endpoint: string, body: unknown): Promise<T> {
  const url = await adminUrl(endpoint);
  const MAX = 4;
  for (let attempt = 0; attempt < MAX; attempt++) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: await headers(),
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return res.json();
    }

    if ((res.status === 429 || res.status >= 500) && attempt < MAX - 1) {
      const ra = parseInt(res.headers.get('Retry-After') || '0', 10);
      const delay = ra > 0 ? ra * 1000 : Math.min(1000 * Math.pow(2, attempt), 4000);
      console.warn(`[Shopify Admin] PUT ${endpoint} returned ${res.status}. Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX})...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    const text = await res.text();
    console.error(`Shopify Admin API PUT error [${res.status}]: ${text}`);
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }
  throw new Error('Shopify API: exhausted retries for PUT');
}

// ─── Orders ──────────────────────────────────────────────────────────

export interface ShopifyOrder {
  id: number;
  name: string; // e.g., "#1001"
  order_number: number;
  email: string;
  created_at: string;
  updated_at: string;
  total_price: string;
  subtotal_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    orders_count?: number;
    total_spent?: string;
    default_address?: any;
  } | null;
  line_items: {
    id: number;
    title: string;
    quantity: number;
    price: string;
    sku: string | null;
    product_id: number | null;
    variant_id: number | null;
    variant_title: string | null;
    name: string;
  }[];
  shipping_address?: {
    first_name: string;
    last_name: string;
    address1: string;
    city: string;
    province: string;
    zip: string;
    country: string;
  };
  billing_address?: any;
  note: string | null;
  tags: string;
  total_tax?: string;
  total_line_items_price?: string;
  fulfillments?: any[];
  status?: string;
  cancelled_at?: string | null;
  gateway?: string;
  payment_gateway_names?: string[];
}

export async function fetchOrders(limit = 250, status = 'any'): Promise<ShopifyOrder[]> {
  const data = await shopifyFetch<{ orders: ShopifyOrder[] }>('orders.json', {
    limit: String(limit),
    status,
    order: 'created_at desc',
  });
  return data.orders;
}

export async function fetchAllOrders(limit = 250, status = 'any'): Promise<ShopifyOrder[]> {
  const orders = await shopifyFetchAll<ShopifyOrder>('orders.json', {
    limit: String(limit),
    status,
    order: 'created_at desc',
  }, 'orders');
  return orders;
}

export async function fetchOrdersByCustomerId(customerId: string): Promise<ShopifyOrder[]> {
  try {
    const data = await shopifyFetch<{ orders: ShopifyOrder[] }>(`customers/${customerId}/orders.json`, {
      status: 'any',
    });
    return data.orders || [];
  } catch (e) {
    console.error(`[Shopify Admin] Error fetching orders for customer ${customerId}:`, e);
    return [];
  }
}

export async function fetchOrder(orderId: string): Promise<ShopifyOrder> {
  const data = await shopifyFetch<{ order: ShopifyOrder }>(`orders/${orderId}.json`);
  return data.order;
}

export async function createOrder(order: any, options?: { idempotencyKey?: string }): Promise<ShopifyOrder> {
  const normalized = { ...order };
  if (normalized.email === '' || (normalized.email && !String(normalized.email).includes('@'))) {
    delete normalized.email;
  }
  if (normalized.customer && (normalized.customer.email === '' || (normalized.customer.email && !String(normalized.customer.email).includes('@')))) {
    delete normalized.customer.email;
  }
  if (normalized.phone) {
    const e164 = toE164(normalized.phone);
    if (e164) normalized.phone = e164;
  }
  if (normalized.customer && normalized.customer.phone) {
    const e164 = toE164(normalized.customer.phone);
    if (e164) normalized.customer.phone = e164;
  }
  if (normalized.shipping_address && normalized.shipping_address.phone) {
    const e164 = toE164(normalized.shipping_address.phone);
    if (e164) normalized.shipping_address.phone = e164;
  }
  if (normalized.billing_address && normalized.billing_address.phone) {
    const e164 = toE164(normalized.billing_address.phone);
    if (e164) normalized.billing_address.phone = e164;
  }

  // Idempotency support: source_identifier and Idempotency-Key header
  const customHeaders: Record<string, string> = {};
  if (options?.idempotencyKey) {
    customHeaders['Idempotency-Key'] = options.idempotencyKey;
    if (!normalized.source_identifier) {
      normalized.source_identifier = options.idempotencyKey;
    }
  }

  const data = await shopifyPost<{ order: ShopifyOrder }>('orders.json', { order: normalized }, customHeaders);
  return data.order;
}

/**
 * Searches Shopify for an existing order by internal order number (e.g. ZB72044).
 * Used as a pre-creation idempotency check to avoid double creation.
 */
export async function findShopifyOrderByInternalNumber(internalOrderNumber: string): Promise<ShopifyOrder | null> {
  if (!internalOrderNumber) return null;
  const cleanNumber = internalOrderNumber.trim();

  // Try 1: REST API query by order name (with and without leading '#')
  try {
    const nameCandidates = [cleanNumber, `#${cleanNumber.replace(/^#/, '')}`];
    for (const nameCandidate of nameCandidates) {
      const data = await shopifyFetch<{ orders: ShopifyOrder[] }>('orders.json', {
        name: nameCandidate,
        status: 'any',
        limit: '5',
      });
      if (data?.orders && data.orders.length > 0) {
        const matched = data.orders.find((o) => {
          const oName = (o.name || '').replace(/^#/, '').toUpperCase();
          const target = cleanNumber.replace(/^#/, '').toUpperCase();
          return (
            oName === target ||
            (o.tags || '').includes(`zb-order-${target}`) ||
            (o.tags || '').includes(`zb_uid:${target}`)
          );
        });
        if (matched) return matched;
      }
    }
  } catch (restErr: any) {
    console.warn(`[Shopify Admin] REST search for order ${cleanNumber} failed:`, restErr.message);
  }

  // Try 2: GraphQL query by name, tag, or source_identifier
  try {
    const target = cleanNumber.replace(/^#/, '');
    const gqlQuery = `
      query searchOrder($query: String!) {
        orders(first: 5, query: $query) {
          edges {
            node {
              id
              name
              legacyResourceId
              tags
            }
          }
        }
      }
    `;
    const gqlRes = await shopifyGraphqlFetch<{
      orders: {
        edges: Array<{
          node: {
            id: string;
            name: string;
            legacyResourceId?: string;
            tags: string[];
          };
        }>;
      };
    }>(gqlQuery, { query: `name:${target} OR tag:zb-order-${target} OR tag:zb_uid:${target}` });

    const edges = gqlRes?.orders?.edges || [];
    if (edges.length > 0) {
      const node = edges[0].node;
      const numericId = node.legacyResourceId || node.id.split('/').pop() || '';
      return {
        id: parseInt(numericId, 10),
        name: node.name,
      } as unknown as ShopifyOrder;
    }
  } catch (gqlErr: any) {
    console.warn(`[Shopify Admin] GraphQL search for order ${cleanNumber} failed:`, gqlErr.message);
  }

  return null;
}

export async function cancelOrder(orderId: string, reason = 'customer'): Promise<any> {
  try {
    const data = await shopifyPost<any>(`orders/${orderId}/cancel.json`, { reason });
    return data;
  } catch (e) {
    console.error(`[Shopify Admin] Error cancelling order ${orderId}:`, e);
    throw e;
  }
}

/**
 * Update an order's tags and/or note_attributes in Shopify.
 * Used to sync cancelled order renumbering (ZBCC) to Shopify.
 */
export async function updateOrderTags(orderId: string, tags: string, noteAttributes?: any[]): Promise<any> {
  const body: any = { order: { id: parseInt(orderId, 10), tags } };
  if (noteAttributes) body.order.note_attributes = noteAttributes;
  const data = await shopifyPatch<{ order: ShopifyOrder }>(`orders/${orderId}.json`, body);
  return data.order;
}

// ─── Customers ───────────────────────────────────────────────────────

export interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  orders_count: number;
  total_spent: string;
  created_at: string;
  updated_at: string;
  verified_email: boolean;
  tags: string;
  addresses: {
    id: number;
    address1: string;
    city: string;
    province: string;
    zip: string;
    country: string;
    default: boolean;
  }[];
  default_address?: {
    id: number;
    address1: string;
    city: string;
    province: string;
    zip: string;
    country: string;
  };
}

export async function fetchCustomers(limit = 250): Promise<ShopifyCustomer[]> {
  const data = await shopifyFetch<{ customers: ShopifyCustomer[] }>('customers.json', {
    limit: String(limit),
    order: 'created_at desc',
  });
  return data.customers;
}

export async function fetchAllCustomers(limit = 250): Promise<ShopifyCustomer[]> {
  const customers = await shopifyFetchAll<ShopifyCustomer>('customers.json', {
    limit: String(limit),
    order: 'created_at desc',
  }, 'customers');
  return customers;
}

export async function createCustomer(customer: any): Promise<ShopifyCustomer> {
  const normalized = { ...customer };
  if (normalized.phone) {
    const e164 = toE164(normalized.phone);
    if (e164) normalized.phone = e164;
  }
  if (Array.isArray(normalized.addresses)) {
    normalized.addresses = normalized.addresses.map((addr: any) => {
      if (addr?.phone) {
        const e164 = toE164(addr.phone);
        return e164 ? { ...addr, phone: e164 } : addr;
      }
      return addr;
    });
  }
  const data = await shopifyPost<{ customer: ShopifyCustomer }>('customers.json', { customer: normalized });
  return data.customer;
}

export async function updateCustomer(customerId: string, updates: any): Promise<ShopifyCustomer> {
  const data = await shopifyPatch<{ customer: ShopifyCustomer }>(`customers/${customerId}.json`, {
    customer: { id: parseInt(customerId, 10), ...updates }
  });
  return data.customer;
}

export async function searchCustomerByPhone(phone: string): Promise<ShopifyCustomer | null> {
  try {
    // Try explicit phone search first
    let data = await shopifyFetch<{ customers: ShopifyCustomer[] }>('customers/search.json', {
      query: `phone:${phone}`,
    });
    if (data.customers?.[0]) return data.customers[0];

    // If that fails, try a general query as some phones might be in notes/tags
    data = await shopifyFetch<{ customers: ShopifyCustomer[] }>('customers/search.json', {
      query: `${phone}`,
    });
    return data.customers?.[0] || null;
  } catch (e) {
    console.error(`[Shopify Admin] Error searching customer by phone ${phone}:`, e);
    return null;
  }
}

export async function searchCustomerByEmail(email: string): Promise<ShopifyCustomer | null> {
  try {
    const data = await shopifyFetch<{ customers: ShopifyCustomer[] }>('customers/search.json', {
      query: `email:${email}`,
    });
    return data.customers?.[0] || null;
  } catch (e) {
    console.error(`[Shopify Admin] Error searching customer by email ${email}:`, e);
    return null;
  }
}

// ─── Collections ─────────────────────────────────────────────────────

export interface ShopifyCollection {
  id: number;
  title: string;
  handle: string;
  updated_at: string;
  body_html: string | null;
  image: { src: string } | null;
}

export async function fetchCollections(limit = 250): Promise<ShopifyCollection[]> {
  try {
    const [data, data2] = await Promise.all([
      shopifyFetch<{ custom_collections: ShopifyCollection[] }>('custom_collections.json', { limit: String(limit) }).catch(() => ({ custom_collections: [] })),
      shopifyFetch<{ smart_collections: ShopifyCollection[] }>('smart_collections.json', { limit: String(limit) }).catch(() => ({ smart_collections: [] })),
    ]);
    
    const all = [...(data?.custom_collections || []), ...(data2?.smart_collections || [])];
    
    // Deduplicate by handle
    const seen = new Set();
    return all.filter(c => {
      if (!c || !c.handle) return false;
      if (seen.has(c.handle)) return false;
      seen.add(c.handle);
      return true;
    });
  } catch (e) {
    console.error("[Shopify Admin] Critical error in fetchCollections:", e);
    return [];
  }
}

export async function fetchProductsByCollectionId(collectionId: string | number, limit = 250): Promise<ShopifyProduct[]> {
  const data = await shopifyFetch<{ products: ShopifyProduct[] }>(`collections/${collectionId}/products.json`, {
    limit: String(limit),
  });
  return data.products;
}

/**
 * Fetches only the collections that are enabled in the admin dashboard for a specific location.
 */
export async function fetchEnabledCollections(location: 'header' | 'page' | 'menu' = 'page', shopDomain?: string): Promise<ShopifyCollection[]> {
  const allCollections = await fetchCollections();
  
  try {
    const shop = (shopDomain ? await prisma.shop.findUnique({
      where: { domain: shopDomain },
      select: {
        enabledCollectionsHeader: true,
        enabledCollectionsPage: true,
        enabledCollectionsMenu: true
      }
    }) : null)
      ?? await prisma.shop.findUnique({
        where: { domain: '8tiahf-bk.myshopify.com' },
        select: {
          enabledCollectionsHeader: true,
          enabledCollectionsPage: true,
          enabledCollectionsMenu: true
        }
      })
      ?? await prisma.shop.findFirst({
        select: {
          enabledCollectionsHeader: true,
          enabledCollectionsPage: true,
          enabledCollectionsMenu: true
        }
      });

    if (!shop) {
      console.log(`[Shopify Admin] No shop config found for ${shopDomain || 'default'}, returning all ${allCollections.length} collections`);
      return allCollections;
    }

    const fieldMap = {
      header: 'enabledCollectionsHeader',
      page: 'enabledCollectionsPage',
      menu: 'enabledCollectionsMenu'
    };

    const fieldName = fieldMap[location] as keyof typeof shop;
    const jsonValue = shop[fieldName] as string | null | undefined;

    console.log(`[Shopify Admin] Fetching for location: ${location}, field: ${String(fieldName)}`);

    if (jsonValue === null || jsonValue === undefined) {
      console.log(`[Shopify Admin] No config for ${location}, showing all ${allCollections.length}`);
      return allCollections;
    }

    const enabledHandles: string[] = JSON.parse(jsonValue).map((h: string) => h.trim().toLowerCase());
    
    if (enabledHandles.length === 0) {
      console.log(`[Shopify Admin] Config for ${location} is explicitly empty, returning empty list`);
      return [];
    }
    
    const filtered = allCollections.filter((c: any) => {
      const handle = c.handle?.trim().toLowerCase();
      return enabledHandles.includes(handle);
    });

    console.log(`[Shopify Admin] Filtered results for ${location}: ${filtered.length} of ${allCollections.length} enabled`);
    return filtered;
  } catch (e) {
    // Database connection failed, return all collections as fallback
    return allCollections;
  }
}

// ─── Products ────────────────────────────────────────────────────────

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  description?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  product_type: string;
  vendor: string;
  tags: string;
  image: { src: string } | null;
  images: { id: number; src: string }[];
  variants: {
    id: number;
    title: string;
    price: string;
    compare_at_price: string | null;
    sku: string | null;
    barcode: string | null;
    inventory_item_id: number;
    inventory_quantity: number;
    inventory_management: string | null;
    option1: string | null;
    option2: string | null;
    option3: string | null;
  }[];
  options?: {
    id: number;
    product_id: number;
    name: string;
    position: number;
    values: string[];
  }[];
  metafields?: ShopifyMetafield[];
  video?: string | null;
}

export interface ShopifyMetafield {
  id: number;
  namespace: string;
  key: string;
  value: string;
  value_type: string;
  description: string | null;
  owner_id: number;
  owner_resource: string;
}


export const FALLBACK_PRODUCTS: ShopifyProduct[] = [
  {
    id: 990001,
    title: "Heavyweight Graphic Tee - Acid Wash",
    handle: "heavyweight-graphic-tee-acid-wash",
    body_html: "<p>Crafted from 280 GSM combed cotton with hand-finished vintage acid wash treatment. Oversized silhouette with dropped shoulders and reinforced collar.</p>",
    description: "Crafted from 280 GSM combed cotton with hand-finished vintage acid wash treatment.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "T-Shirt",
    vendor: "Zica Bella",
    tags: "Heavyweight, Acid Wash, Graphic, Oversized",
    image: { src: "/load-image-1.jpg" },
    images: [
      { id: 9900011, src: "/load-image-1.jpg" },
      { id: 9900012, src: "/load-image-2.jpg" }
    ],
    variants: [
      {
        id: 99000101,
        title: "S",
        price: "2999.00",
        compare_at_price: "3999.00",
        sku: "ZB-TEE-01-S",
        barcode: null,
        inventory_item_id: 990001010,
        inventory_quantity: 15,
        inventory_management: "shopify",
        option1: "S",
        option2: null,
        option3: null
      },
      {
        id: 99000102,
        title: "M",
        price: "2999.00",
        compare_at_price: "3999.00",
        sku: "ZB-TEE-01-M",
        barcode: null,
        inventory_item_id: 990001020,
        inventory_quantity: 20,
        inventory_management: "shopify",
        option1: "M",
        option2: null,
        option3: null
      },
      {
        id: 99000103,
        title: "L",
        price: "2999.00",
        compare_at_price: "3999.00",
        sku: "ZB-TEE-01-L",
        barcode: null,
        inventory_item_id: 990001030,
        inventory_quantity: 18,
        inventory_management: "shopify",
        option1: "L",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900019, product_id: 990001, name: "Size", position: 1, values: ["S", "M", "L"] }
    ]
  },
  {
    id: 990002,
    title: "Oversized Cyberpunk Fleece Hoodie",
    handle: "oversized-cyberpunk-fleece-hoodie",
    body_html: "<p>Ultra-heavy 450 GSM French Terry loopback fleece hoodie featuring double-layer hood, distressed ribbing, and tactile rubberized chest logo.</p>",
    description: "Ultra-heavy 450 GSM French Terry loopback fleece hoodie.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "Hoodie",
    vendor: "Zica Bella",
    tags: "Hoodie, Fleece, Oversized, Cyberpunk",
    image: { src: "/load-image-2.jpg" },
    images: [
      { id: 9900021, src: "/load-image-2.jpg" },
      { id: 9900022, src: "/load-image-3.jpg" }
    ],
    variants: [
      {
        id: 99000201,
        title: "M",
        price: "4499.00",
        compare_at_price: "5499.00",
        sku: "ZB-HOOD-02-M",
        barcode: null,
        inventory_item_id: 990002010,
        inventory_quantity: 10,
        inventory_management: "shopify",
        option1: "M",
        option2: null,
        option3: null
      },
      {
        id: 99000202,
        title: "L",
        price: "4499.00",
        compare_at_price: "5499.00",
        sku: "ZB-HOOD-02-L",
        barcode: null,
        inventory_item_id: 990002020,
        inventory_quantity: 14,
        inventory_management: "shopify",
        option1: "L",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900029, product_id: 990002, name: "Size", position: 1, values: ["M", "L"] }
    ]
  },
  {
    id: 990003,
    title: "Vintage Raw Edge Carpenter Denim",
    handle: "vintage-raw-edge-carpenter-denim",
    body_html: "<p>14 oz heavyweight rigid selvedge denim. Relaxed wide leg cut with raw edge fray hems and custom metallic hardware.</p>",
    description: "14 oz heavyweight rigid selvedge denim.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "Denim",
    vendor: "Zica Bella",
    tags: "Denim, Jeans, Carpenter, Raw Edge",
    image: { src: "/load-image-3.jpg" },
    images: [
      { id: 9900031, src: "/load-image-3.jpg" },
      { id: 9900032, src: "/load-image-4.jpg" }
    ],
    variants: [
      {
        id: 99000301,
        title: "30",
        price: "3999.00",
        compare_at_price: "4999.00",
        sku: "ZB-DNM-03-30",
        barcode: null,
        inventory_item_id: 990003010,
        inventory_quantity: 8,
        inventory_management: "shopify",
        option1: "30",
        option2: null,
        option3: null
      },
      {
        id: 99000302,
        title: "32",
        price: "3999.00",
        compare_at_price: "4999.00",
        sku: "ZB-DNM-03-32",
        barcode: null,
        inventory_item_id: 990003020,
        inventory_quantity: 12,
        inventory_management: "shopify",
        option1: "32",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900039, product_id: 990003, name: "Size", position: 1, values: ["30", "32"] }
    ]
  },
  {
    id: 990004,
    title: "Tactical Utility Cargo Pants",
    handle: "tactical-utility-cargo-pants",
    body_html: "<p>Durable cotton twill cargos with 8 functional utility pockets, adjustable ankle drawstrings, and ergonomic knee articulation panels.</p>",
    description: "Durable cotton twill cargos with 8 functional utility pockets.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "Cargo",
    vendor: "Zica Bella",
    tags: "Cargo, Tactical, Pants, Utility",
    image: { src: "/load-image-4.jpg" },
    images: [
      { id: 9900041, src: "/load-image-4.jpg" },
      { id: 9900042, src: "/section-image1.webp" }
    ],
    variants: [
      {
        id: 99000401,
        title: "30",
        price: "3499.00",
        compare_at_price: "4499.00",
        sku: "ZB-CRG-04-30",
        barcode: null,
        inventory_item_id: 990004010,
        inventory_quantity: 9,
        inventory_management: "shopify",
        option1: "30",
        option2: null,
        option3: null
      },
      {
        id: 99000402,
        title: "32",
        price: "3499.00",
        compare_at_price: "4499.00",
        sku: "ZB-CRG-04-32",
        barcode: null,
        inventory_item_id: 990004020,
        inventory_quantity: 11,
        inventory_management: "shopify",
        option1: "32",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900049, product_id: 990004, name: "Size", position: 1, values: ["30", "32"] }
    ]
  },
  {
    id: 990005,
    title: "Archival Signature Heavyweight Tee",
    handle: "archival-signature-heavyweight-tee",
    body_html: "<p>Premium 260 GSM organic cotton featuring high-density screenprinted brand insignia across the back.</p>",
    description: "Premium 260 GSM organic cotton with high-density insignia.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "T-Shirt",
    vendor: "Zica Bella",
    tags: "T-Shirt, Heavyweight, Graphic",
    image: { src: "/section-image1.webp" },
    images: [
      { id: 9900051, src: "/section-image1.webp" },
      { id: 9900052, src: "/load-image-1.jpg" }
    ],
    variants: [
      {
        id: 99000501,
        title: "M",
        price: "2799.00",
        compare_at_price: "3499.00",
        sku: "ZB-TEE-05-M",
        barcode: null,
        inventory_item_id: 990005010,
        inventory_quantity: 16,
        inventory_management: "shopify",
        option1: "M",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900059, product_id: 990005, name: "Size", position: 1, values: ["M"] }
    ]
  },
  {
    id: 990006,
    title: "Monochrome Distressed Hoodie",
    handle: "monochrome-distressed-oversized-hoodie",
    body_html: "<p>Hand-distressed heavyweight pullover hoodie with dropped shoulders and subtle tonal branding.</p>",
    description: "Hand-distressed heavyweight pullover hoodie.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "Hoodie",
    vendor: "Zica Bella",
    tags: "Hoodie, Distressed, Oversized",
    image: { src: "/load-image-1.jpg" },
    images: [
      { id: 9900061, src: "/load-image-1.jpg" },
      { id: 9900062, src: "/load-image-2.jpg" }
    ],
    variants: [
      {
        id: 99000601,
        title: "L",
        price: "4299.00",
        compare_at_price: "5299.00",
        sku: "ZB-HOOD-06-L",
        barcode: null,
        inventory_item_id: 990006010,
        inventory_quantity: 12,
        inventory_management: "shopify",
        option1: "L",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900069, product_id: 990006, name: "Size", position: 1, values: ["L"] }
    ]
  },
  {
    id: 990007,
    title: "Shadow Edition Graphic Street Tee",
    handle: "shadow-edition-graphic-street-tee",
    body_html: "<p>Pure black 280 GSM cotton jersey tee featuring atmospheric shadow graphics.</p>",
    description: "Pure black 280 GSM cotton jersey tee featuring atmospheric shadow graphics.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "T-Shirt",
    vendor: "Zica Bella",
    tags: "T-Shirt, Shadow, Graphic",
    image: { src: "/load-image-2.jpg" },
    images: [
      { id: 9900071, src: "/load-image-2.jpg" },
      { id: 9900072, src: "/load-image-3.jpg" }
    ],
    variants: [
      {
        id: 99000701,
        title: "M",
        price: "2899.00",
        compare_at_price: "3599.00",
        sku: "ZB-TEE-07-M",
        barcode: null,
        inventory_item_id: 990007010,
        inventory_quantity: 15,
        inventory_management: "shopify",
        option1: "M",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900079, product_id: 990007, name: "Size", position: 1, values: ["M"] }
    ]
  },
  {
    id: 990008,
    title: "Cyber Wash Relaxed Denim Jacket",
    handle: "cyber-wash-relaxed-denim-jacket",
    body_html: "<p>Custom enzyme-washed denim jacket with subtle silver hardware and boxy crop fit.</p>",
    description: "Custom enzyme-washed denim jacket.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "Outerwear",
    vendor: "Zica Bella",
    tags: "Jacket, Denim, Cyber Wash",
    image: { src: "/load-image-3.jpg" },
    images: [
      { id: 9900081, src: "/load-image-3.jpg" },
      { id: 9900082, src: "/load-image-4.jpg" }
    ],
    variants: [
      {
        id: 99000801,
        title: "L",
        price: "4999.00",
        compare_at_price: "5999.00",
        sku: "ZB-JKT-08-L",
        barcode: null,
        inventory_item_id: 990008010,
        inventory_quantity: 7,
        inventory_management: "shopify",
        option1: "L",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900089, product_id: 990008, name: "Size", position: 1, values: ["L"] }
    ]
  },
  {
    id: 990009,
    title: "Minimalist Heavy Knit Sweatshirt",
    handle: "minimalist-heavy-knit-sweatshirt",
    body_html: "<p>Clean 380 GSM minimalist crewneck sweatshirt with subtle embroidered wrist detail.</p>",
    description: "Clean 380 GSM minimalist crewneck sweatshirt.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "Sweatshirt",
    vendor: "Zica Bella",
    tags: "Sweatshirt, Minimalist, Heavyweight",
    image: { src: "/load-image-4.jpg" },
    images: [
      { id: 9900091, src: "/load-image-4.jpg" },
      { id: 9900092, src: "/section-image1.webp" }
    ],
    variants: [
      {
        id: 99000901,
        title: "M",
        price: "3699.00",
        compare_at_price: "4499.00",
        sku: "ZB-SWT-09-M",
        barcode: null,
        inventory_item_id: 990009010,
        inventory_quantity: 11,
        inventory_management: "shopify",
        option1: "M",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900099, product_id: 990009, name: "Size", position: 1, values: ["M"] }
    ]
  },
  {
    id: 990010,
    title: "Raw Edge Boxy Fit Graphic Tee",
    handle: "raw-edge-boxy-fit-graphic-tee",
    body_html: "<p>Unfinished raw hem graphic tee crafted from 250 GSM organic jersey cotton.</p>",
    description: "Unfinished raw hem graphic tee.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "T-Shirt",
    vendor: "Zica Bella",
    tags: "T-Shirt, Raw Edge, Graphic",
    image: { src: "/section-image1.webp" },
    images: [
      { id: 9900101, src: "/section-image1.webp" },
      { id: 9900102, src: "/load-image-1.jpg" }
    ],
    variants: [
      {
        id: 99001001,
        title: "L",
        price: "2699.00",
        compare_at_price: "3299.00",
        sku: "ZB-TEE-10-L",
        barcode: null,
        inventory_item_id: 990010010,
        inventory_quantity: 14,
        inventory_management: "shopify",
        option1: "L",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900109, product_id: 990010, name: "Size", position: 1, values: ["L"] }
    ]
  },
  {
    id: 990011,
    title: "Dusk Edition Fleece Zip Hoodie",
    handle: "dusk-edition-fleece-zip-hoodie",
    body_html: "<p>Full zip heavyweight hoodie with custom metallic zipper puller and deep side pockets.</p>",
    description: "Full zip heavyweight hoodie with custom metallic zipper puller.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "Hoodie",
    vendor: "Zica Bella",
    tags: "Hoodie, Zip, Fleece",
    image: { src: "/load-image-1.jpg" },
    images: [
      { id: 9900111, src: "/load-image-1.jpg" },
      { id: 9900112, src: "/load-image-2.jpg" }
    ],
    variants: [
      {
        id: 99001101,
        title: "M",
        price: "4599.00",
        compare_at_price: "5599.00",
        sku: "ZB-ZIP-11-M",
        barcode: null,
        inventory_item_id: 990011010,
        inventory_quantity: 8,
        inventory_management: "shopify",
        option1: "M",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900119, product_id: 990011, name: "Size", position: 1, values: ["M"] }
    ]
  },
  {
    id: 990012,
    title: "Tactical Multi-Pocket Cargo Shorts",
    handle: "tactical-multi-pocket-cargo-shorts",
    body_html: "<p>Heavy cotton canvas shorts with 6 tactical cargo pockets and adjustable side waist tabs.</p>",
    description: "Heavy cotton canvas shorts with 6 tactical cargo pockets.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "Shorts",
    vendor: "Zica Bella",
    tags: "Shorts, Cargo, Tactical",
    image: { src: "/load-image-2.jpg" },
    images: [
      { id: 9900121, src: "/load-image-2.jpg" },
      { id: 9900122, src: "/load-image-3.jpg" }
    ],
    variants: [
      {
        id: 99001201,
        title: "30",
        price: "2999.00",
        compare_at_price: "3799.00",
        sku: "ZB-SRT-12-30",
        barcode: null,
        inventory_item_id: 990012010,
        inventory_quantity: 13,
        inventory_management: "shopify",
        option1: "30",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900129, product_id: 990012, name: "Size", position: 1, values: ["30"] }
    ]
  },
  {
    id: 990013,
    title: "Matrix Wash Oversized Vintage Tee",
    handle: "matrix-wash-oversized-vintage-tee",
    body_html: "<p>Specialty enzyme vintage washed oversized tee with cyber-inspired typographic graphics.</p>",
    description: "Specialty enzyme vintage washed oversized tee.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "T-Shirt",
    vendor: "Zica Bella",
    tags: "T-Shirt, Vintage, Graphic",
    image: { src: "/load-image-3.jpg" },
    images: [
      { id: 9900131, src: "/load-image-3.jpg" },
      { id: 9900132, src: "/load-image-4.jpg" }
    ],
    variants: [
      {
        id: 99001301,
        title: "L",
        price: "2899.00",
        compare_at_price: "3499.00",
        sku: "ZB-TEE-13-L",
        barcode: null,
        inventory_item_id: 990013010,
        inventory_quantity: 10,
        inventory_management: "shopify",
        option1: "L",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900139, product_id: 990013, name: "Size", position: 1, values: ["L"] }
    ]
  },
  {
    id: 990014,
    title: "Heritage Heavyweight Pullover Hoodie",
    handle: "heritage-heavyweight-pullover-hoodie",
    body_html: "<p>Heavyweight 400 GSM loopback cotton hoodie with double needle stitching and fleece lining.</p>",
    description: "Heavyweight 400 GSM loopback cotton hoodie.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "Hoodie",
    vendor: "Zica Bella",
    tags: "Hoodie, Heritage, Heavyweight",
    image: { src: "/load-image-4.jpg" },
    images: [
      { id: 9900141, src: "/load-image-4.jpg" },
      { id: 9900142, src: "/section-image1.webp" }
    ],
    variants: [
      {
        id: 99001401,
        title: "M",
        price: "4199.00",
        compare_at_price: "5199.00",
        sku: "ZB-HOOD-14-M",
        barcode: null,
        inventory_item_id: 990014010,
        inventory_quantity: 16,
        inventory_management: "shopify",
        option1: "M",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900149, product_id: 990014, name: "Size", position: 1, values: ["M"] }
    ]
  },
  {
    id: 990015,
    title: "Urban Utility Streetwear Pants",
    handle: "urban-utility-streetwear-pants",
    body_html: "<p>Tapered relaxed streetwear trousers with elastic waistband and industrial strap details.</p>",
    description: "Tapered relaxed streetwear trousers.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "Pants",
    vendor: "Zica Bella",
    tags: "Pants, Urban, Utility",
    image: { src: "/section-image1.webp" },
    images: [
      { id: 9900151, src: "/section-image1.webp" },
      { id: 9900152, src: "/load-image-1.jpg" }
    ],
    variants: [
      {
        id: 99001501,
        title: "32",
        price: "3799.00",
        compare_at_price: "4699.00",
        sku: "ZB-PNT-15-32",
        barcode: null,
        inventory_item_id: 990015010,
        inventory_quantity: 9,
        inventory_management: "shopify",
        option1: "32",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900159, product_id: 990015, name: "Size", position: 1, values: ["32"] }
    ]
  },
  {
    id: 990016,
    title: "Core Manifesto Graphic Tee",
    handle: "core-manifesto-graphic-tee",
    body_html: "<p>Boxy heavy jersey tee featuring the core manifesto print across the chest.</p>",
    description: "Boxy heavy jersey tee featuring the core manifesto print.",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_type: "T-Shirt",
    vendor: "Zica Bella",
    tags: "T-Shirt, Manifesto, Graphic",
    image: { src: "/load-image-1.jpg" },
    images: [
      { id: 9900161, src: "/load-image-1.jpg" },
      { id: 9900162, src: "/load-image-2.jpg" }
    ],
    variants: [
      {
        id: 99001601,
        title: "L",
        price: "2599.00",
        compare_at_price: "3199.00",
        sku: "ZB-TEE-16-L",
        barcode: null,
        inventory_item_id: 990016010,
        inventory_quantity: 18,
        inventory_management: "shopify",
        option1: "L",
        option2: null,
        option3: null
      }
    ],
    options: [
      { id: 9900169, product_id: 990016, name: "Size", position: 1, values: ["L"] }
    ]
  }
];

export async function fetchProducts(limit = 250): Promise<ShopifyProduct[]> {
  try {
    const data = await shopifyFetch<{ products: ShopifyProduct[] }>('products.json', {
      limit: String(limit),
    });
    if (data && Array.isArray(data.products) && data.products.length > 0) {
      return data.products;
    }
    console.warn('[Shopify Admin] fetchProducts returned empty array, returning fallback products.');
    return FALLBACK_PRODUCTS;
  } catch (err: any) {
    console.error('[Shopify Admin] fetchProducts error:', err.message);
    return FALLBACK_PRODUCTS;
  }
}

export async function fetchAllProducts(
  limit = 250,
  opts?: { allowFallback?: boolean },
): Promise<ShopifyProduct[]> {
  const allowFallback = opts?.allowFallback ?? true;
  try {
    const products = await shopifyFetchAll<ShopifyProduct>('products.json', {
      limit: String(limit),
    }, 'products');
    if (products && Array.isArray(products) && products.length > 0) {
      return products;
    }
    console.warn('[Shopify Admin] fetchAllProducts returned 0 products');
    return allowFallback ? FALLBACK_PRODUCTS : [];
  } catch (err: any) {
    console.error('[Shopify Admin] fetchAllProducts error:', err.message);
    return allowFallback ? FALLBACK_PRODUCTS : [];
  }
}

// ─── Inventory ───────────────────────────────────────────────────────

export interface ShopifyInventoryLevel {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

export async function fetchInventoryLevels(locationIds: string[]): Promise<ShopifyInventoryLevel[]> {
  const data = await shopifyFetch<{ inventory_levels: ShopifyInventoryLevel[] }>('inventory_levels.json', {
    location_ids: locationIds.join(','),
    limit: '250',
  });
  return data.inventory_levels;
}

export interface ShopifyLocation {
  id: number;
  name: string;
  active: boolean;
}

export async function fetchLocations(): Promise<ShopifyLocation[]> {
  const data = await shopifyFetch<{ locations: ShopifyLocation[] }>('locations.json');
  return data.locations;
}

// ─── Count helpers ───────────────────────────────────────────────────

export async function fetchOrdersCount(): Promise<number> {
  const data = await shopifyFetch<{ count: number }>('orders/count.json', { status: 'any' });
  return data.count;
}

export async function fetchProductsCount(): Promise<number> {
  const data = await shopifyFetch<{ count: number }>('products/count.json');
  return data.count;
}

export async function fetchCustomersCount(): Promise<number> {
  const data = await shopifyFetch<{ count: number }>('customers/count.json');
  return data.count;
}

// ─── Write Operations ─────────────────────────────────────────────────

/**
 * Adjust inventory level for an inventory item at a location.
 * delta: positive = increase, negative = decrease.
 */
export async function adjustInventoryLevel(
  inventoryItemId: string,
  locationId: string,
  delta: number
): Promise<ShopifyInventoryLevel> {
  const data = await shopifyPost<{ inventory_level: ShopifyInventoryLevel }>(
    'inventory_levels/adjust.json',
    {
      inventory_item_id: parseInt(inventoryItemId, 10),
      location_id: parseInt(locationId, 10),
      available_adjustment: delta,
    }
  );
  return data.inventory_level;
}

/**
 * Set (not adjust) absolute inventory quantity for an item at a location.
 */
export async function setInventoryLevel(
  inventoryItemId: string,
  locationId: string,
  quantity: number
): Promise<ShopifyInventoryLevel> {
  const data = await shopifyPost<{ inventory_level: ShopifyInventoryLevel }>(
    'inventory_levels/set.json',
    {
      inventory_item_id: parseInt(inventoryItemId, 10),
      location_id: parseInt(locationId, 10),
      available: quantity,
    }
  );
  return data.inventory_level;
}

/**
 * Create a fulfillment for an order.
 */
export async function createFulfillment(
  orderId: string,
  locationId: string,
  lineItems?: { id: number; quantity: number }[],
  tracking?: { number?: string; url?: string; company?: string }
): Promise<any> {
  const body: any = {
    fulfillment: {
      location_id: parseInt(locationId, 10),
      notify_customer: true,
    },
  };
  if (lineItems?.length) {
    body.fulfillment.line_items = lineItems;
  }
  if (tracking) {
    if (tracking.number) body.fulfillment.tracking_number = tracking.number;
    if (tracking.url) body.fulfillment.tracking_url = tracking.url;
    if (tracking.company) body.fulfillment.tracking_company = tracking.company;
  }
  const data = await shopifyPost<{ fulfillment: any }>(
    `orders/${orderId}/fulfillments.json`,
    body
  );
  return data.fulfillment;
}

/**
 * Update a Shopify product (e.g., change status to active/draft).
 */
export async function updateProduct(
  productId: string,
  updates: {
    status?: string;
    title?: string;
    tags?: string;
    body_html?: string | null;
    product_type?: string;
    vendor?: string;
  }
): Promise<ShopifyProduct> {
  const data = await shopifyPatch<{ product: ShopifyProduct }>(
    `products/${productId}.json`,
    { product: { id: parseInt(productId, 10), ...updates } }
  );
  return data.product;
}

/**
 * Update a Shopify Variant (e.g., SKU, price, barcode).
 */
export async function updateVariant(
  variantId: string,
  updates: { sku?: string; barcode?: string; price?: string; compare_at_price?: string | null }
): Promise<any> {
  const data = await shopifyPatch<{ variant: any }>(
    `variants/${variantId}.json`,
    { variant: { id: parseInt(variantId, 10), ...updates } }
  );
  return data.variant;
}

/**
 * Fetch a single product by Shopify product ID.
 */
export async function fetchProductById(productId: string, includeMetafields = false): Promise<ShopifyProduct> {
  const data = await shopifyFetch<{ product: ShopifyProduct }>(`products/${productId}.json`);
  if (!includeMetafields) return data.product;
  const metafields = await fetchProductMetafields(productId).catch(() => []);
  return { ...data.product, metafields };
}

export async function fetchProductByHandle(handle: string): Promise<ShopifyProduct | null> {
  // If the handle looks like a numeric ID, try fetching by ID first
  if (/^\d+$/.test(handle)) {
    try {
      const product = await fetchProductById(handle);
      if (product) return product;
    } catch (e) {
      // Fall through to handle search
    }
  }

  const data = await shopifyFetch<{ products: ShopifyProduct[] }>(`products.json?handle=${handle}`);
  if (!data.products || data.products.length === 0) return null;
  const product = data.products[0];
  const metafields = await fetchProductMetafields(product.id.toString());
  return { ...product, metafields };
}

/**
 * Fetch metafields for a single product.
 */
export async function fetchProductMetafields(productId: string): Promise<ShopifyMetafield[]> {
  const data = await shopifyFetch<{ metafields: ShopifyMetafield[] }>(`products/${productId}/metafields.json`);
  return data.metafields;
}

/**
 * Create or update a product metafield.
 */
export async function updateProductMetafield(
  productId: string,
  metafield: { namespace: string; key: string; value: string; type: string }
): Promise<ShopifyMetafield> {
  const data = await shopifyPost<{ metafield: ShopifyMetafield }>(
    `products/${productId}/metafields.json`,
    { metafield }
  );
  return data.metafield;
}

const gidCache = new Map<string, { url: string; timestamp: number }>();
const GID_CACHE_TTL = 1 * 60 * 60 * 1000; // 1 hour TTL

/**
 * Resolve a Shopify GID (Video, MediaImage, etc.) to a public URL using GraphQL.
 */
export async function resolveShopifyGid(gid: string): Promise<string | null> {
  if (!gid || !gid.startsWith('gid://shopify/')) return null;

  const now = Date.now();
  const cached = gidCache.get(gid);
  if (cached && (now - cached.timestamp < GID_CACHE_TTL)) {
    return cached.url;
  }

  try {
    const query = `
      query resolveMedia($id: ID!) {
        node(id: $id) {
          ... on MediaImage {
            image {
              url
            }
          }
          ... on Video {
            sources {
              url
              mimeType
            }
          }
          ... on GenericFile {
            url
          }
        }
      }
    `;

    const data = await shopifyGraphqlFetch<any>(query, { id: gid });
    const node = data?.node;

    let resolvedUrl: string | null = null;
    if (node?.image?.url) resolvedUrl = node.image.url;
    else if (node?.sources?.[0]?.url) resolvedUrl = node.sources[0].url;
    else if (node?.url) resolvedUrl = node.url;

    if (resolvedUrl) {
      gidCache.set(gid, { url: resolvedUrl, timestamp: now });
      return resolvedUrl;
    }

    return null;
  } catch (e) {
    console.error(`Error resolving GID ${gid}:`, e);
    return null;
  }
}

/**
 * Create a refund for an order.
 */
export interface RefundLineItem {
  line_item_id: number;
  quantity: number;
  restock_type: 'return' | 'cancel' | 'no_restock';
  location_id?: number;
}

export async function createRefund(
  orderId: string,
  refundLineItems: RefundLineItem[],
  note?: string
): Promise<any> {
  const data = await shopifyPost<{ refund: any }>(
    `orders/${orderId}/refunds.json`,
    {
      refund: {
        note: note || 'Refund approved by admin',
        notify: true,
        refund_line_items: refundLineItems,
      },
    }
  );
  return data.refund;
}

/**
 * Get order refunds.
 */
export async function fetchOrderRefunds(orderId: string): Promise<any[]> {
  const data = await shopifyFetch<{ refunds: any[] }>(`orders/${orderId}/refunds.json`);
  return data.refunds;
}

// ─── New API Functions ───────────────────────────────────────────────

/**
 * Fetch shop policies (privacy, refund, terms, shipping, legal).
 * Uses explicit caching to prevent Next.js Dynamic Server Usage 500 errors on static routes.
 */
export async function fetchPolicies(): Promise<{ title: string; body: string; url: string; handle: string }[]> {
  try {
    const url = await adminUrl('policies.json');
    const res = await fetch(url, {
      method: 'GET',
      headers: await headers(),
      // Allow caching for policies to avoid 500 errors on statically generated layouts
      next: { revalidate: 3600 } 
    });

    if (!res.ok) {
      throw new Error(`Shopify API ${res.status}`);
    }

    const data = await res.json();
    return (data.policies || []).map((p: any) => ({
      title: p.title,
      body: p.body,
      url: p.url,
      handle: p.handle,
    }));
  } catch (e) {
    console.error('fetchPolicies error:', e);
    return [];
  }
}

/**
 * Score a product's relevancy to a search query.
 * Higher score = more relevant. 0 = no match at all.
 */
/**
 * Minimum relevancy score required for a product to be considered a search match.
 * High enough to require a real title/type/tag match, filtering out incidental description matches.
 */
export const MIN_RELEVANCY_SCORE = 25;

const IRREGULAR_PLURALS: Record<string, string[]> = {
  hoodies: ['hoodie', 'hoodies'],
  hoodie: ['hoodie', 'hoodies'],
  tees: ['tee', 'tees'],
  tee: ['tee', 'tees'],
  pants: ['pant', 'pants'],
  pant: ['pant', 'pants'],
  dresses: ['dress', 'dresses'],
  dress: ['dress', 'dresses'],
  glasses: ['glass', 'glasses'],
  glass: ['glass', 'glasses'],
  tshirts: ['tshirt', 'tshirts', 't shirt', 't shirts'],
  tshirt: ['tshirt', 'tshirts', 't shirt', 't shirts'],
  't shirt': ['t shirt', 't shirts', 'tshirt', 'tshirts'],
  't shirts': ['t shirts', 't shirt', 'tshirt', 'tshirts'],
};

const PLURAL_EXCEPTIONS = new Set([
  'jeans', 'boss', 'class', 'fitness', 'express', 'series'
]);

/**
 * Normalize search text by lowercasing, stripping hyphens/underscores/special characters,
 * and collapsing spaces.
 */
export function normalizeSearchText(text?: string | null): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Expand a single word term to include singular/plural variants.
 */
export function expandSearchTerm(term: string): string[] {
  const t = term.toLowerCase().trim();
  if (!t) return [];
  if (IRREGULAR_PLURALS[t]) {
    return IRREGULAR_PLURALS[t];
  }
  if (PLURAL_EXCEPTIONS.has(t)) {
    return [t];
  }
  if (t.endsWith('s') && t.length > 3) {
    const singular = t.slice(0, -1);
    return Array.from(new Set([t, singular]));
  }
  if (!t.endsWith('s') && t.length > 2) {
    const plural = t + 's';
    return Array.from(new Set([t, plural]));
  }
  return [t];
}

/**
 * Check if a normalized field contains a term or variant, using word boundary checks for short terms.
 */
function fieldContainsTerm(field?: string | null, term?: string | null): boolean {
  if (!field || !term) return false;
  if (term.length <= 2) {
    const regex = new RegExp(`(?:^|\\s|[^a-z0-9])${term.replace(/[^a-z0-9]/g, '')}(?:$|\\s|[^a-z0-9])`, 'i');
    return regex.test(field);
  }
  return field.includes(term);
}

/**
 * Score a product's relevancy to a search query.
 * Higher score = more relevant. Below MIN_RELEVANCY_SCORE = no match / irrelevant.
 */
export function productRelevancyScore(p: ShopifyProduct, rawQuery: string): number {
  let score = 0;
  const normTitle = normalizeSearchText(p.title);
  const normType = normalizeSearchText(p.product_type);
  const normTags = normalizeSearchText(p.tags);
  const normVendor = normalizeSearchText(p.vendor);
  const normHandle = normalizeSearchText(p.handle);
  const normDesc = normalizeSearchText(p.body_html);

  const queryNorm = normalizeSearchText(rawQuery);
  if (!queryNorm) return 0;

  // Build full query variants (including hyphenless concatenated forms like "tshirts")
  const concatenatedQuery = queryNorm.replace(/\s+/g, '');
  const queryPhrases = Array.from(new Set([queryNorm, concatenatedQuery].filter(Boolean)));

  // Extract individual word tokens
  const rawTokens = queryNorm.split(' ').filter(Boolean);

  // Expand tokens into singular/plural variants
  const expandedTokenGroups = rawTokens.map(token => expandSearchTerm(token));

  // Generate expanded query phrases (e.g. "t shirt", "t shirts", "tshirt", "tshirts")
  const phraseVariants: string[] = [];
  queryPhrases.forEach(qp => {
    phraseVariants.push(qp);
    if (IRREGULAR_PLURALS[qp]) {
      phraseVariants.push(...IRREGULAR_PLURALS[qp]);
    }
    const tokens = qp.split(' ').filter(Boolean);
    if (tokens.length > 1) {
      const last = tokens[tokens.length - 1];
      const expandedLast = expandSearchTerm(last);
      expandedLast.forEach(v => {
        phraseVariants.push([...tokens.slice(0, -1), v].join(' '));
      });
    }
  });
  const uniquePhrases = Array.from(new Set(phraseVariants));

  // Title matches (highest priority)
  for (const phrase of uniquePhrases) {
    if (normTitle === phrase) { score += 100; break; }
    else if (normTitle.startsWith(phrase)) { score += 80; break; }
    else if (fieldContainsTerm(normTitle, phrase)) { score += 60; break; }
  }

  // Handle matches
  for (const phrase of uniquePhrases) {
    if (fieldContainsTerm(normHandle, phrase)) { score += 30; break; }
  }

  // Product type matches
  for (const phrase of uniquePhrases) {
    if (normType === phrase) { score += 40; break; }
    else if (fieldContainsTerm(normType, phrase)) { score += 25; break; }
  }

  // Tag matches
  for (const phrase of uniquePhrases) {
    if (fieldContainsTerm(normTags, phrase)) { score += 20; break; }
  }

  // Vendor matches
  for (const phrase of uniquePhrases) {
    if (fieldContainsTerm(normVendor, phrase)) { score += 10; break; }
  }

  // Description matches (lower priority to avoid incidental false positives)
  for (const phrase of uniquePhrases) {
    if (fieldContainsTerm(normDesc, phrase)) { score += 10; break; }
  }

  // Token-level matching for multi-token or single-token queries
  expandedTokenGroups.forEach(tokenVariants => {
    const matchedTitle = tokenVariants.some(v => fieldContainsTerm(normTitle, v));
    const matchedTags = tokenVariants.some(v => fieldContainsTerm(normTags, v));
    const matchedType = tokenVariants.some(v => fieldContainsTerm(normType, v));
    const matchedHandle = tokenVariants.some(v => fieldContainsTerm(normHandle, v));
    const matchedVendor = tokenVariants.some(v => fieldContainsTerm(normVendor, v));
    const matchedDesc = tokenVariants.some(v => fieldContainsTerm(normDesc, v));

    if (matchedTitle) score += 20;
    if (matchedTags) score += 10;
    if (matchedType) score += 8;
    if (matchedHandle) score += 6;
    if (matchedVendor) score += 3;
    if (matchedDesc) score += 3;
  });

  return score;
}

/**
 * Build a scoped query string for Shopify Admin GraphQL API `products(query:)`.
 */
export function buildShopifySearchQuery(rawQuery: string): string {
  const norm = normalizeSearchText(rawQuery);
  if (!norm) return rawQuery.trim();

  const tokens = norm.split(' ').filter(Boolean);
  const termsToSearch = new Set<string>();

  tokens.forEach(t => {
    const cleanToken = t.replace(/[^a-z0-9]/g, '');
    if (cleanToken) {
      expandSearchTerm(cleanToken).forEach(v => termsToSearch.add(v));
    }
  });

  const concatenated = norm.replace(/\s+/g, '');
  if (concatenated && concatenated !== norm) {
    termsToSearch.add(concatenated);
  }

  const clauses: string[] = [];
  Array.from(termsToSearch).forEach(term => {
    clauses.push(`title:*${term}* OR product_type:*${term}* OR tag:*${term}*`);
  });

  return clauses.length > 0 ? clauses.join(' OR ') : rawQuery.trim();
}

/**
 * Search products by keyword — uses GraphQL for full-text search,
 * then filters and sorts results by relevancy. Falls back to REST for redundancy.
 */
export async function searchProducts(query: string, limit = 48): Promise<ShopifyProduct[]> {
  if (!query?.trim()) return [];
  const q = query.trim();

  // Map a GraphQL product node to ShopifyProduct shape
  function mapGraphQLNode(node: any): ShopifyProduct {
    const extractId = (gid: string) => parseInt(gid.split('/').pop() || '0', 10);
    return {
      id: extractId(node.id),
      title: node.title,
      handle: node.handle,
      body_html: node.bodyHtml || null,
      status: node.status,
      created_at: node.createdAt,
      updated_at: node.updatedAt,
      product_type: node.productType || '',
      vendor: node.vendor || '',
      tags: (node.tags || []).join(', '),
      image: node.featuredImage ? { src: node.featuredImage.url } : null,
      images: (node.images?.edges || []).map((edge: any) => ({
        id: extractId(edge.node.id),
        src: edge.node.url,
      })),
      variants: (node.variants?.edges || []).map((edge: any) => {
        const v = edge.node;
        return {
          id: extractId(v.id),
          title: v.title,
          price: v.price,
          compare_at_price: v.compareAtPrice || null,
          sku: null,
          barcode: null,
          inventory_item_id: 0,
          inventory_quantity: v.inventoryQuantity || 0,
          inventory_management: null,
          option1: v.selectedOptions?.[0]?.value || null,
          option2: v.selectedOptions?.[1]?.value || null,
          option3: v.selectedOptions?.[2]?.value || null,
        };
      }),
    };
  }

  const graphqlQuery = `
    query searchProducts($query: String!, $limit: Int!) {
      products(first: $limit, query: $query) {
        edges {
          node {
            id
            title
            handle
            bodyHtml
            status
            createdAt
            updatedAt
            productType
            vendor
            tags
            featuredImage { url }
            images(first: 5) { edges { node { id, url } } }
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  price
                  compareAtPrice
                  inventoryQuantity
                  selectedOptions { name, value }
                }
              }
            }
            productVideo: metafield(namespace: "custom", key: "product_video") {
              value
            }
            productVideo2: metafield(namespace: "custom", key: "product-video") {
              value
            }
            productVideo3: metafield(namespace: "custom", key: "Product-video") {
              value
            }
          }
        }
      }
    }
  `;

  try {
    const scopedQuery = buildShopifySearchQuery(q);
    const data = await shopifyGraphqlFetch<any>(graphqlQuery, { query: scopedQuery, limit });

    if (data?.products?.edges?.length > 0) {
      const products = await Promise.all(
        data.products.edges.map(async ({ node }: any) => {
          const p = mapGraphQLNode(node);
          const rawVideo = node.productVideo?.value || node.productVideo2?.value || node.productVideo3?.value || null;
          if (rawVideo) {
            if (rawVideo.startsWith('gid://shopify/')) {
              p.video = await resolveShopifyGid(rawVideo).catch(() => null);
            } else {
              p.video = rawVideo;
            }
          } else {
            p.video = null;
          }
          return p;
        })
      );

      // Filter to only products that meet the minimum relevancy threshold
      const matching = products.filter((p: ShopifyProduct) => productRelevancyScore(p, q) >= MIN_RELEVANCY_SCORE);

      // Sort by relevancy score (highest first)
      const sorted = matching
        .sort((a: ShopifyProduct, b: ShopifyProduct) => productRelevancyScore(b, q) - productRelevancyScore(a, q));

      console.log(`[Search] GraphQL returned ${products.length} products, ${matching.length} met threshold for query "${q}"`);
      return sorted.slice(0, limit);
    }

    return [];
  } catch (e) {
    console.warn('[Search] GraphQL search failed, using REST fallback:', (e as Error).message);

    try {
      // Fetch all products and filter/sort locally — REST title param is exact match only
      const allData = await shopifyFetch<{ products: ShopifyProduct[] }>('products.json', { limit: '250' });
      const allProducts = allData.products || [];

      // Score, filter by MIN_RELEVANCY_SCORE, and sort
      const scored = allProducts
        .map(p => ({ product: p, score: productRelevancyScore(p, q) }))
        .filter(item => item.score >= MIN_RELEVANCY_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const resolved = await Promise.all(
        scored.map(async ({ product: p }) => {
          try {
            const metafields = await fetchProductMetafields(p.id.toString()).catch(() => []);
            const videoMeta = metafields.find(m => m.namespace === 'custom' && (m.key === 'product_video' || m.key === 'product-video' || m.key === 'Product-video'));
            if (videoMeta?.value) {
              if (videoMeta.value.startsWith('gid://shopify/')) {
                p.video = await resolveShopifyGid(videoMeta.value).catch(() => null);
              } else {
                p.video = videoMeta.value;
              }
            } else {
              p.video = null;
            }
          } catch (e) {
            p.video = null;
          }
          return p;
        })
      );

      console.log(`[Search] REST fallback: ${resolved.length} matches out of ${allProducts.length} products for "${q}"`);
      return resolved;
    } catch (restError) {
      console.error('[Search] REST fallback also failed:', restError);
      return [];
    }
  }
}


/**
 * Fetch a collection and its products by handle.
 */
export async function fetchCollectionByHandle(handle: string, limit = 24): Promise<{
  collection: { id: number; title: string; handle: string; body_html: string; image?: { src: string } } | null;
  products: ShopifyProduct[];
}> {
  try {
    let collection: any = null;
    let products: ShopifyProduct[] = [];

    if (handle?.toLowerCase() === 'all') {
      const productsData = await shopifyFetch<{ products: ShopifyProduct[] }>('products.json', {
        limit: String(limit),
      });
      collection = {
        id: 0,
        title: "All Products",
        handle: "all",
        body_html: "All products in the store",
        image: undefined
      };
      products = productsData.products || [];
    } else {
      const allCollections = await fetchCollections();
      collection = allCollections.find(c => c.handle?.toLowerCase() === handle?.toLowerCase()) as any;
      
      if (!collection) return { collection: null, products: [] };

      const productsData = await shopifyFetch<{ products: ShopifyProduct[] }>('products.json', {
        collection_id: String(collection.id),
        limit: String(limit),
      });

      products = productsData.products || [];
    }

    // Sort according to custom product order if available
    try {
      const shop = await prisma.shop.findFirst({
        select: { collectionProductOrders: true }
      });
      if (shop?.collectionProductOrders) {
        const ordersMap = JSON.parse(shop.collectionProductOrders);
        const orderedProductIds = ordersMap[String(collection.id)] || ordersMap[collection.handle] || [];
        if (Array.isArray(orderedProductIds) && orderedProductIds.length > 0) {
          const idOrderMap = new Map<string, number>();
          orderedProductIds.forEach((id, index) => {
            idOrderMap.set(String(id), index);
          });
          
          products.sort((a, b) => {
            const aIndex = idOrderMap.has(String(a.id)) ? idOrderMap.get(String(a.id))! : 999999;
            const bIndex = idOrderMap.has(String(b.id)) ? idOrderMap.get(String(b.id))! : 999999;
            return aIndex - bIndex;
          });
        }
      }
    } catch (err) {
      console.error("[Shopify Admin] Error sorting products by custom order:", err);
    }

    if (!products || products.length === 0) {
      products = FALLBACK_PRODUCTS;
    }

    if (!collection) {
      collection = {
        id: 0,
        title: handle ? handle.replace(/-/g, ' ').toUpperCase() : "COLLECTION",
        handle: handle || "all",
        body_html: "Zica Bella Luxury Streetwear Collection",
        image: undefined
      };
    }

    return { collection, products };
  } catch (e) {
    console.error('fetchCollectionByHandle error:', e);
    return {
      collection: {
        id: 0,
        title: handle ? handle.replace(/-/g, ' ').toUpperCase() : "COLLECTION",
        handle: handle || "all",
        body_html: "Zica Bella Luxury Streetwear Collection",
        image: undefined
      },
      products: FALLBACK_PRODUCTS
    };
  }
}

/**
 * Fetch all navigation menus with their nested items from Shopify using GraphQL.
 * This is efficient as it fetches everything in one round-trip.
 */
export async function fetchMenus(): Promise<any[]> {
  try {
    const query = `
      {
        menus(first: 50) {
          edges {
            node {
              id
              title
              handle
              items {
                title
                url
                items {
                  title
                  url
                  items {
                    title
                    url
                  }
                }
              }
            }
          }
        }
      }
    `;
    const data = await shopifyGraphqlFetch<any>(query);
    const menus = data.menus?.edges.map((e: any) => e.node) || [];
    console.log(`[Shopify Menus] Successfully fetched ${menus.length} menus`);
    return menus;
  } catch (e) {
    console.error('[Shopify Menus] fetchMenus error:', e);
    return [];
  }
}

/**
 * Fetch a specific menu by handle. 
 * Reuses fetchMenus() to find the matching handle in memory.
 */
export async function fetchMenu(handle: string): Promise<any | null> {
  if (!handle) return null;
  
  try {
    const allMenus = await fetchMenus();
    const menu = allMenus.find(m => m.handle === handle);
    
    if (menu) {
      console.log(`[Shopify Menu] Found menu "${handle}": ${menu.title} (${menu.items?.length || 0} items)`);
    } else {
      console.warn(`[Shopify Menu] No menu found with handle: "${handle}"`);
    }
    
    return menu;
  } catch (e) {
    console.error(`[Shopify Menu] Error looking up menu "${handle}":`, e);
    return null;
  }
}

// ─── Product Normalization ──────────────────────────────────────────

function normalizeMetaKey(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '');
}

function getMetafieldRaw(p: ShopifyProduct, keys: string[]): string | undefined {
  if (!p.metafields?.length) return undefined;
  const keySet = new Set(keys.map(normalizeMetaKey));
  const metafield = p.metafields.find(
    (m) => m.namespace === 'custom' && keySet.has(normalizeMetaKey(m.key))
  );
  return metafield?.value || undefined;
}

async function resolveMetafieldValue(value?: string): Promise<string | undefined> {
  if (!value) return undefined;
  if (!value.startsWith('gid://shopify/')) return value;
  return (await resolveShopifyGid(value)) || undefined;
}

function getMetafieldText(p: ShopifyProduct, key: string): string | undefined {
  const mf = p.metafields?.find(m => m.namespace === 'custom' && m.key === key);
  if (!mf?.value) return undefined;
  try {
    const data = JSON.parse(mf.value);
    let text = '';
    const extract = (node: any) => {
      if (node.type === 'text') text += node.value;
      if (node.children) node.children.forEach(extract);
      if (node.type === 'list-item') text += '\n• ';
      if (node.type === 'paragraph' || node.type === 'list') text += '\n';
    };
    extract(data);
    return text.trim();
  } catch {
    return mf.value;
  }
}

export async function flattenProduct(p: ShopifyProduct) {
  // Ensure metafields are present (REST list endpoints don't include them)
  const metafields = p.metafields || await fetchProductMetafields(p.id.toString()).catch(() => []);
  const pWithMeta = { ...p, metafields };

  const sizeOptionIndex = p.options?.findIndex(o => o.name.toLowerCase() === 'size') ?? -1;
  const colorOptionIndex = p.options?.findIndex(o => o.name.toLowerCase() === 'color' || o.name.toLowerCase() === 'colour') ?? -1;

  const variants = (p.variants || []).map(v => {
    let size = null;
    let color = null;

    if (sizeOptionIndex === 0) size = v.option1;
    else if (sizeOptionIndex === 1) size = v.option2;
    else if (sizeOptionIndex === 2) size = v.option3;

    if (colorOptionIndex === 0) color = v.option1;
    else if (colorOptionIndex === 1) color = v.option2;
    else if (colorOptionIndex === 2) color = v.option3;

    // Fallbacks if not detected by indexes
    if (!size) size = v.option1 || null;
    if (!color) color = v.option2 || null;

    return {
      id: `gid://shopify/ProductVariant/${v.id}`,
      title: v.title,
      availableForSale: (v.inventory_quantity ?? 0) > 0,
      quantityAvailable: v.inventory_quantity ?? 0,
      price: v.price,
      compareAtPrice: v.compare_at_price || null,
      size,
      color,
    };
  });

  const price = variants[0]?.price || '0';
  const compareAtPrice = variants[0]?.compareAtPrice || null;
  const isOnSale = compareAtPrice ? parseFloat(compareAtPrice) > parseFloat(price) : false;
  const isSoldOut = !variants.some(v => v.availableForSale);

  const allMedia: any[] = (p.images || []).map((img) => ({
    mediaContentType: 'IMAGE' as const,
    image: { url: img.src, altText: null },
    alt: null,
  }));

  const [productVideo, sizeChart] = await Promise.all([
    resolveMetafieldValue(getMetafieldRaw(pWithMeta, ['product_video', 'product-video', 'Product-video', 'product video'])),
    resolveMetafieldValue(getMetafieldRaw(pWithMeta, ['size_chart', 'size-chart', 'size chart', 'size_chart_image', 'size-chart-image', 'size chart image'])),
  ]);

  if (productVideo) {
    allMedia.push({
      mediaContentType: 'VIDEO',
      alt: null,
      sources: [{ url: productVideo, mimeType: 'video/mp4' }],
    });
  }

  return {
    id: `gid://shopify/Product/${p.id}`,
    title: p.title,
    handle: p.handle,
    productType: p.product_type || '',
    description: p.body_html ? p.body_html.replace(/<[^>]*>/g, '') : '',
    descriptionHtml: p.body_html || '',
    availableForSale: !isSoldOut,
    featuredImage: p.image?.src || p.images?.[0]?.src || '',
    images: (p.images || []).map(img => img.src),
    price,
    compareAtPrice,
    variants,
    isSoldOut,
    isOnSale,
    video: undefined,
    allMedia,
    details: getMetafieldText(pWithMeta, 'details'),
    care: getMetafieldText(pWithMeta, 'care'),
    sizeChart,
    productVideo,
  };
}

/**
 * Fetch product video URL (native video or video metafield) from Shopify
 */
export async function fetchProductVideoUrl(productId: string): Promise<string | null> {
  if (!productId) return null;
  const gid = productId.startsWith('gid://shopify/Product/') 
    ? productId 
    : `gid://shopify/Product/${productId}`;
    
  try {
    const query = `
      query getProductVideo($id: ID!) {
        product(id: $id) {
          media(first: 10) {
            nodes {
              mediaContentType
              ... on Video {
                sources {
                  url
                  mimeType
                }
              }
            }
          }
          productVideo: metafield(namespace: "custom", key: "product_video") {
            value
          }
          productVideo2: metafield(namespace: "custom", key: "product-video") {
            value
          }
          productVideo3: metafield(namespace: "custom", key: "Product-video") {
            value
          }
        }
      }
    `;
    const res = await shopifyGraphqlFetch<any>(query, { id: gid });
    
    // 1. Try native media video
    const mediaNodes = res?.product?.media?.nodes || [];
    const videoNode = mediaNodes.find((m: any) => m.mediaContentType === 'VIDEO');
    if (videoNode && videoNode.sources && videoNode.sources.length > 0) {
      const mp4Source = videoNode.sources.find((s: any) => s.mimeType === 'video/mp4' || s.url.includes('.mp4'));
      return mp4Source ? mp4Source.url : videoNode.sources[0].url;
    }

    // 2. Try metafield video GID or direct URL
    const rawVideo = res?.product?.productVideo?.value || res?.product?.productVideo2?.value || res?.product?.productVideo3?.value;
    if (rawVideo) {
      if (rawVideo.startsWith('gid://shopify/')) {
        return await resolveShopifyGid(rawVideo);
      }
      return rawVideo;
    }
  } catch (err: any) {
    console.error(`[fetchProductVideoUrl] Failed to fetch video for ${productId}:`, err.message);
  }
  return null;
}
