/**
 * Admin passkeys (WebAuthn) — shared server helpers (Developer Brief #21).
 *
 * Flow
 *  - Register (signed-in admin): /api/admin/passkeys/register/options → browser → /register/verify
 *  - Sign in (dashboard login):  /api/auth/passkey/options → browser → signIn("admin-passkey")
 *
 * The WebAuthn challenge travels in a short-lived, signed, httpOnly cookie, so no challenge table is
 * needed and a challenge can't be replayed after it expires or be reused for the other purpose.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export const PASSKEY_CHALLENGE_COOKIE = 'zb_pk_challenge';
const CHALLENGE_TTL_SECONDS = 5 * 60;
export const PASSKEY_RP_NAME = 'Zica Bella Admin';

type ChallengePurpose = 'register' | 'authenticate';

interface ChallengePayload {
  challenge: string;
  purpose: ChallengePurpose;
  userId?: string;
  /** Unique per issued challenge; lets the server accept each one only once. */
  jti?: string;
}

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.INTERNAL_API_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is not configured');
  return s;
}

export function signChallenge(payload: ChallengePayload): string {
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, secret(), { expiresIn: CHALLENGE_TTL_SECONDS });
}

/**
 * Claim a challenge so it can be used exactly once. The cookie alone stays valid for its whole TTL, so
 * without this a captured sign-in could be replayed inside that window. Returns false when the challenge
 * was already used (or has no id). Claims live in WebhookEvent, whose eventKey is unique.
 */
export async function consumeChallenge(challenge: ChallengePayload): Promise<boolean> {
  if (!challenge.jti) return false;
  const { default: prisma } = await import('@/lib/db');
  try {
    await prisma.webhookEvent.create({
      data: {
        source: 'passkey',
        eventType: 'challenge_consumed',
        eventKey: `passkey-challenge:${challenge.jti}`,
        payload: '{}',
        processed: true,
        processedAt: new Date(),
      },
    });
    return true;
  } catch (err: any) {
    if (err?.code === 'P2002') return false;
    throw err;
  }
}

export function readChallenge(token: string | undefined | null, purpose: ChallengePurpose): ChallengePayload | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, secret()) as ChallengePayload;
    return decoded?.purpose === purpose && typeof decoded.challenge === 'string' ? decoded : null;
  } catch {
    return null;
  }
}

export function challengeCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: CHALLENGE_TTL_SECONDS,
  };
}

/** Pull one cookie out of a raw Cookie header (NextAuth's authorize() only gives us headers). */
export function cookieFromHeader(cookieHeader: string | undefined | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * Relying party for this request. A passkey is bound to the RP ID (domain), so it must be the same on
 * every request: ADMIN_PASSKEY_RP_ID pins it (e.g. "zicabella.com" to cover www/app subdomains);
 * otherwise the request host is used.
 */
export function relyingParty(headers: { get(name: string): string | null } | Record<string, any>) {
  const get = (name: string): string | null =>
    typeof (headers as any).get === 'function'
      ? (headers as any).get(name)
      : ((headers as any)[name] ?? (headers as any)[name.toLowerCase()] ?? null);

  const host = String(get('x-forwarded-host') || get('host') || 'localhost').split(',')[0].trim();
  const hostname = host.split(':')[0];
  const proto = String(get('x-forwarded-proto') || (hostname === 'localhost' ? 'http' : 'https')).split(',')[0].trim();

  const rpID = process.env.ADMIN_PASSKEY_RP_ID || hostname;
  const configuredOrigins = (process.env.ADMIN_PASSKEY_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const expectedOrigin = configuredOrigins.length > 0 ? configuredOrigins : [`${proto}://${host}`];
  return { rpID, expectedOrigin };
}

export const toBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
export const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const buf = Buffer.from(value, 'base64url');
  const out = new Uint8Array(new ArrayBuffer(buf.length));
  out.set(buf);
  return out;
};
