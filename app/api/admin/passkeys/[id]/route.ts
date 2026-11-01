import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** DELETE /api/admin/passkeys/:id — remove one of the signed-in admin's own passkeys. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireAdmin();
    const { count } = await prisma.adminPasskey.deleteMany({
      where: { id: params.id, userId: (session.user as any).id },
    });
    if (count === 0) return NextResponse.json({ error: 'Passkey not found' }, { status: 404 });
    await logAudit({ action: 'ADMIN_PASSKEY_REMOVED', module: 'SETTINGS', targetId: params.id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
