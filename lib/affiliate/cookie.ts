import { AFFILIATE_CONFIG } from './config';

export interface AffiliateCookiePayload {
  code: string;
  linkSlug?: string | null;
  linkId?: string | null;
  clickId?: string | null;
  ts: number;
}

const textEncoder = new TextEncoder();

/** Edge + Node safe base64url encode */
function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]!);
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(arr).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function hmacSha256Base64Url(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(data));
  return bytesToBase64Url(sig);
}

/**
 * Signs and encodes the attribution cookie value (Edge + Node safe via Web Crypto).
 */
export async function signAffiliateCookie(payload: AffiliateCookiePayload): Promise<string> {
  const secret = AFFILIATE_CONFIG.APP_JWT_SECRET;
  const json = JSON.stringify(payload);
  const dataB64 = bytesToBase64Url(textEncoder.encode(json));
  const signature = await hmacSha256Base64Url(dataB64, secret);
  return `${dataB64}.${signature}`;
}

/**
 * Verifies and parses the attribution cookie value.
 * Returns null if invalid or expired past ATTRIBUTION_WINDOW_DAYS.
 */
export async function verifyAffiliateCookie(
  token: string | null | undefined
): Promise<AffiliateCookiePayload | null> {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [dataB64, signature] = parts;
  if (!dataB64 || !signature) return null;

  const secret = AFFILIATE_CONFIG.APP_JWT_SECRET;
  const expectedSignature = await hmacSha256Base64Url(dataB64, secret);

  try {
    const sigA = base64UrlToBytes(signature);
    const sigB = base64UrlToBytes(expectedSignature);
    if (!timingSafeEqualBytes(sigA, sigB)) {
      return null;
    }

    const jsonBytes = base64UrlToBytes(dataB64);
    const json =
      typeof TextDecoder !== 'undefined'
        ? new TextDecoder().decode(jsonBytes)
        : Buffer.from(jsonBytes).toString('utf8');
    const payload = JSON.parse(json) as AffiliateCookiePayload;

    if (!payload.code || typeof payload.ts !== 'number') {
      return null;
    }

    const maxAgeMs = AFFILIATE_CONFIG.ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - payload.ts > maxAgeMs) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Cookie options for the zb_aff attribution cookie
 */
export function getAffiliateCookieOptions() {
  const maxAge = AFFILIATE_CONFIG.ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60; // seconds
  const isProd = process.env.NODE_ENV === 'production';
  return {
    name: AFFILIATE_CONFIG.COOKIE_NAME,
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}
