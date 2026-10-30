import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';
import { logAudit } from '@/lib/audit';
import { PASSKEY_CHALLENGE_COOKIE, readChallenge, relyingParty, toBase64Url } from '@/lib/auth/passkeys';

export const dynamic = 'force-dynamic';

/** POST /api/admin/passkeys/register/verify { response, name } — save the new passkey. */
export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    const userId = (session.user as any)?.id as string;
    const challenge = readChallenge(cookies().get(PASSKEY_CHALLENGE_COOKIE)?.value, 'register');
    if (!challenge || challenge.userId !== userId) {
      return NextResponse.json({ error: 'Passkey setup expired. Please try again.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { rpID, expectedOrigin } = relyingParty(req.headers);
    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'Passkey could not be verified.' }, { status: 400 });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const name = String(body.name || '').trim().slice(0, 60) || 'Passkey';
    const passkey = await prisma.adminPasskey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: toBase64Url(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports?.join(',') || null,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name,
      },
    });

    await logAudit({ action: 'ADMIN_PASSKEY_ADDED', module: 'SETTINGS', targetId: passkey.id, metadata: { name } });
    const res = NextResponse.json({ id: passkey.id, name: passkey.name, createdAt: passkey.createdAt }, { status: 201 });
    res.cookies.delete(PASSKEY_CHALLENGE_COOKIE);
    return res;
  } catch (error: any) {
    if (error?.message && !['401', '403'].includes(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleAuthError(error);
  }
}
