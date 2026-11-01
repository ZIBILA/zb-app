import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';
import {
  PASSKEY_CHALLENGE_COOKIE,
  PASSKEY_RP_NAME,
  challengeCookieOptions,
  relyingParty,
  signChallenge,
} from '@/lib/auth/passkeys';

export const dynamic = 'force-dynamic';

/** POST /api/admin/passkeys/register/options — start adding a passkey to the signed-in admin's account. */
export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    const user = session.user as any;
    if (!user?.id || user.id === 'super_admin_env_id') {
      return NextResponse.json(
        { error: 'Passkeys need a database admin account. Sign in with your own admin user first.' },
        { status: 400 }
      );
    }

    const existing = await prisma.adminPasskey.findMany({ where: { userId: user.id } });
    const { rpID } = relyingParty(req.headers);
    const options = await generateRegistrationOptions({
      rpName: PASSKEY_RP_NAME,
      rpID,
      userName: user.email,
      userDisplayName: user.name || user.email,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((p: { credentialId: string; transports: string | null }) => ({
        id: p.credentialId,
        transports: p.transports ? (p.transports.split(',') as any) : undefined,
      })),
      // Discoverable credential so the login page can sign in without typing an email first.
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });

    const res = NextResponse.json(options);
    res.cookies.set(
      PASSKEY_CHALLENGE_COOKIE,
      signChallenge({ challenge: options.challenge, purpose: 'register', userId: user.id }),
      challengeCookieOptions()
    );
    return res;
  } catch (error) {
    return handleAuthError(error);
  }
}
