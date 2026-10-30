import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/** GET /api/admin/passkeys — the signed-in admin's passkeys. */
export async function GET() {
  try {
    const session = await requireAdmin();
    const passkeys = await prisma.adminPasskey.findMany({
      where: { userId: (session.user as any).id },
      select: { id: true, name: true, deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ passkeys });
  } catch (error) {
    return handleAuthError(error);
  }
}
