/**
 * Server-Side IP Geolocation Service
 * Features:
 * - Extracts client IP from x-forwarded-for, x-real-ip, cf-connecting-ip, x-client-ip, etc.
 * - Extracts native edge geolocation headers (Vercel & Cloudflare) for 0ms latency lookups
 * - In-memory LRU cache with 24-hour TTL (max 10,000 IPs)
 * - Multi-provider fallback chain (ipwho.is -> ip-api.com -> ipapi.co)
 * - Local development fallback for private/loopback IPs
 * - Fail-open design: returns null without throwing on timeout or API failure
 */

export interface IpGeoResult {
  countryCode: string; // ISO-2 uppercase e.g. "IN", "US"
  country: string;     // Full name e.g. "India"
  region: string | null;
  city: string | null;
  zip: string | null;  // Postal/ZIP code from IP geolocation
  lat: number | null;
  lng: number | null;
  isDevFallback?: boolean;
}

interface CacheEntry {
  data: IpGeoResult | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 10_000;
const ipGeoCache = new Map<string, CacheEntry>();

/**
 * Extract client IP address from HTTP request headers.
 */
export function getClientIP(request: Request): string {
  const headers = request.headers;

  const doIp = headers.get('do-connecting-ip');
  if (doIp && doIp.trim()) return doIp.trim();

  const forwarded = headers.get('x-forwarded-for') || headers.get('x-vercel-forwarded-for');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  }

  const real = headers.get('x-real-ip') || headers.get('x-client-ip') || headers.get('x-cluster-client-ip') || headers.get('fastly-client-ip');
  if (real) return real.trim();

  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  return '127.0.0.1';
}

/**
 * Extract geolocation directly from Vercel / Cloudflare HTTP headers if available.
 */
export function extractEdgeGeo(request: Request): IpGeoResult | null {
  try {
    const headers = request.headers;
    const vercelCountry = headers.get('x-vercel-ip-country');
    const vercelCity = headers.get('x-vercel-ip-city');
    const vercelRegion = headers.get('x-vercel-ip-country-region');
    const vercelLat = headers.get('x-vercel-ip-latitude');
    const vercelLng = headers.get('x-vercel-ip-longitude');
    const cfCountry = headers.get('cf-ipcountry');

    const countryCode = vercelCountry || cfCountry;
    if (countryCode && countryCode !== 'XX' && countryCode !== 'T1') {
      const parsedLat = vercelLat ? parseFloat(vercelLat) : null;
      const parsedLng = vercelLng ? parseFloat(vercelLng) : null;
      return {
        countryCode: countryCode.toUpperCase(),
        country: countryCode.toUpperCase() === 'IN' ? 'India' : (countryCode.toUpperCase() === 'US' ? 'United States' : countryCode.toUpperCase()),
        region: vercelRegion ? decodeURIComponent(vercelRegion) : null,
        city: vercelCity ? decodeURIComponent(vercelCity) : null,
        zip: headers.get('x-vercel-ip-postal-code') || null,
        lat: !isNaN(parsedLat as number) ? parsedLat : null,
        lng: !isNaN(parsedLng as number) ? parsedLng : null,
      };
    }
  } catch {
    // Ignore header decode issues
  }
  return null;
}

/**
 * Check if an IP address is a private, loopback, or local IP.
 */
export function isPrivateIP(ip: string): boolean {
  if (!ip || ip === 'unknown') return true;

  const cleanIp = ip.replace(/^::ffff:/i, '');

  if (
    cleanIp === '127.0.0.1' ||
    cleanIp === '::1' ||
    cleanIp === 'localhost' ||
    cleanIp.startsWith('10.') ||
    cleanIp.startsWith('192.168.') ||
    cleanIp.startsWith('169.254.')
  ) {
    return true;
  }

  // Check 172.16.0.0 - 172.31.255.255
  if (cleanIp.startsWith('172.')) {
    const parts = cleanIp.split('.');
    if (parts.length >= 2) {
      const secondOctet = parseInt(parts[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) return true;
    }
  }

  return false;
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** Default development / testing geolocation fallback when on localhost / private IP (never used in production). */
const DEV_FALLBACK_GEO: IpGeoResult = {
  countryCode: 'IN',
  country: 'India',
  region: 'Maharashtra',
  city: 'Mumbai',
  zip: '400001',
  lat: 19.0760,
  lng: 72.8777,
  isDevFallback: true,
};

async function fetchFromGeoJs(ip?: string, signal?: AbortSignal): Promise<IpGeoResult | null> {
  try {
    const url = ip && !isPrivateIP(ip)
      ? `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`
      : `https://get.geojs.io/v1/ip/geo.json`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const json = await res.json();
      if (json && (json.country_code || json.country)) {
        const lat = parseFloat(json.latitude);
        const lng = parseFloat(json.longitude);
        const rawZip = json.postal_code || null;
        const cleanZip = rawZip && rawZip !== '0' && rawZip !== 'null' ? String(rawZip).trim() : null;
        return {
          countryCode: String(json.country_code || 'IN').toUpperCase().slice(0, 2),
          country: json.country || 'India',
          region: json.region || null,
          city: json.city || null,
          zip: cleanZip,
          lat: !isNaN(lat) ? lat : null,
          lng: !isNaN(lng) ? lng : null,
        };
      }
    }
  } catch {
    // Fail quietly to next provider
  }
  return null;
}

async function fetchFromIpWhoIs(ip: string, signal: AbortSignal): Promise<IpGeoResult | null> {
  const url = `https://ipwho.is/${encodeURIComponent(ip)}`;
  const res = await fetch(url, { signal });
  if (res.ok) {
    const json = await res.json();
    if (json.success && json.country_code) {
      return {
        countryCode: String(json.country_code).toUpperCase(),
        country: json.country || json.country_code,
        region: json.region || null,
        city: json.city || null,
        zip: json.postal || null,
        lat: typeof json.latitude === 'number' ? json.latitude : null,
        lng: typeof json.longitude === 'number' ? json.longitude : null,
      };
    }
  }
  return null;
}

async function fetchFromIpApi(ip: string, signal: AbortSignal): Promise<IpGeoResult | null> {
  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,zip,lat,lon`;
  const res = await fetch(url, { signal });
  if (res.ok) {
    const json = await res.json();
    if (json.status === 'success' && json.countryCode) {
      return {
        countryCode: json.countryCode.toUpperCase(),
        country: json.country || json.countryCode,
        region: json.regionName || null,
        city: json.city || null,
        zip: json.zip || null,
        lat: typeof json.lat === 'number' ? json.lat : null,
        lng: typeof json.lon === 'number' ? json.lon : null,
      };
    }
  }
  return null;
}

async function fetchFromIpApiCo(ip: string, apiKey: string, signal: AbortSignal): Promise<IpGeoResult | null> {
  const url = apiKey
    ? `https://api.ipapi.com/${encodeURIComponent(ip)}?access_key=${apiKey}`
    : `https://ipapi.co/${encodeURIComponent(ip)}/json/`;
  const res = await fetch(url, { signal });
  if (res.ok) {
    const json = await res.json();
    const code = json.country_code || json.country;
    if (code) {
      return {
        countryCode: String(code).toUpperCase().slice(0, 2),
        country: json.country_name || json.country || code,
        region: json.region || json.region_name || null,
        city: json.city || null,
        zip: json.postal || json.zip || null,
        lat: typeof json.latitude === 'number' ? json.latitude : typeof json.lat === 'number' ? json.lat : null,
        lng: typeof json.longitude === 'number' ? json.longitude : typeof json.lng === 'number' ? json.lng : null,
      };
    }
  }
  return null;
}

/**
 * Perform server-side IP to Geolocation lookup with 24h caching and multi-provider fallback.
 */
export async function lookupIpGeo(ip: string, req?: Request): Promise<IpGeoResult | null> {
  // 1. Edge Header Extraction first (0ms latency if running on Vercel / Cloudflare)
  if (req) {
    const edgeGeo = extractEdgeGeo(req);
    if (edgeGeo) return edgeGeo;
  }

  // 2. Handle private / local IPs: attempt real public IP lookup first for accurate local testing
  if (isPrivateIP(ip)) {
    // Production: a private / missing client IP means we do not know where the
    // visitor is. Never invent a location (the Mumbai dev fallback used to be
    // hashed into Meta events as the customer's city / state / zip).
    if (IS_PRODUCTION) return null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const publicGeo = await fetchFromGeoJs(undefined, controller.signal);
      clearTimeout(timeoutId);
      if (publicGeo) return { ...publicGeo, isDevFallback: true };
    } catch {}
    return DEV_FALLBACK_GEO;
  }

  // 3. Check cache
  const cached = ipGeoCache.get(ip);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.data;
    }
    ipGeoCache.delete(ip);
  }

  // Evict oldest entries if cache exceeds max size
  if (ipGeoCache.size >= MAX_CACHE_SIZE) {
    const firstKey = ipGeoCache.keys().next().value;
    if (firstKey) ipGeoCache.delete(firstKey);
  }

  const apiKey = process.env.IP_GEO_API_KEY || '';
  let result: IpGeoResult | null = null;

  // 4. Multi-provider fallback chain: GeoJS -> ipwho.is -> ip-api.com -> ipapi.co
  const providers = [
    (signal: AbortSignal) => fetchFromGeoJs(ip, signal),
    (signal: AbortSignal) => fetchFromIpWhoIs(ip, signal),
    (signal: AbortSignal) => fetchFromIpApi(ip, signal),
    (signal: AbortSignal) => fetchFromIpApiCo(ip, apiKey, signal),
  ];

  for (const fetchGeoProvider of providers) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5s per provider
      result = await fetchGeoProvider(controller.signal);
      clearTimeout(timeoutId);
      if (result && result.countryCode) {
        break; // Success!
      }
    } catch {
      // Continue to next provider in fallback chain
    }
  }

  // All providers failed: in production the answer is "unknown" (null, cached
  // briefly so the APIs are not hammered); the dev fallback is for local work only.
  if (!result && !IS_PRODUCTION) {
    result = DEV_FALLBACK_GEO;
  }

  // Cache result (even if null, to avoid hammering APIs on invalid IPs for 10 min)
  ipGeoCache.set(ip, {
    data: result,
    expiresAt: result ? Date.now() + CACHE_TTL_MS : Date.now() + 10 * 60 * 1000,
  });

  return result;
}

