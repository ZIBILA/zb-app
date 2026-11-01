import { NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { PASSKEY_CHALLENGE_COOKIE, challengeCookieOptions, relyingParty, signChallenge } from '@/lib/auth/passkeys';

export const dynamic = 'force-dynamic';

/** POST /api/auth/passkey/options — WebAuthn challenge for the dashboard "Sign in with passkey" button. */
export async function POST(req: Request) {
  const limited = await checkRateLimit(req, 'admin-passkey-options', { maxRequests: 20, windowMs: 60_000 });
  if (!limited.allowed && limited.response) return limited.response;

  const { rpID } = relyingParty(req.headers);
  // No allowCredentials: the authenticator offers the admin's discoverable passkeys for this site.
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });

  const res = NextResponse.json(options);
  res.cookies.set(
    PASSKEY_CHALLENGE_COOKIE,
    signChallenge({ challenge: options.challenge, purpose: 'authenticate' }),
    challengeCookieOptions()
  );
  return res;
}
