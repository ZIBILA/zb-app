import prisma from '@/lib/db';

export const ALL_ADMIN_MODULES = [
  'DASHBOARD_HOME', 'SUPPORT', 'ORDERS', 'MOBILE_ORDERS', 'CUSTOMERS',
  'PRODUCTS', 'INVENTORY', 'LOGISTICS', 'RETURNS_EXCHANGES', 'STOREFRONT',
  'COMMUNITY', 'MARKETING', 'MANUFACTURING', 'FINANCIAL', 'INTEGRATIONS',
  'SETTINGS', 'ADMIN_USERS', 'AUDIT_LOG',
];

export const fullAdminPermissions = () =>
  ALL_ADMIN_MODULES.map((m) => ({ module: m, canView: true, canEdit: true, canDelete: true, pages: null }));

/**
 * The NextAuth user object for an admin/staff account, with its module permissions — shared by the
 * password and passkey sign-ins so both produce identical sessions.
 */
export async function buildAdminSessionUser(user: { id: string; name?: string | null; email: string; role: string }) {
  let permissions: any[] = [];
  try {
    permissions = await prisma.permission.findMany({ where: { userId: user.id } });
  } catch (pErr: any) {
    console.error('[AUTH] Permission query error:', pErr.message);
  }

  if ((user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') && permissions.length === 0) {
    permissions = fullAdminPermissions();
  }

  return {
    id: user.id,
    name: user.name || 'Admin',
    email: user.email,
    role: user.role,
    permissions: permissions.map((p: any) => ({
      module: p.module,
      canView: p.canView,
      canEdit: p.canEdit,
      canDelete: p.canDelete,
      pages: p.pages,
    })),
  };
}
