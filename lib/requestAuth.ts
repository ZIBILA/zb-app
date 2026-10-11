/**
 * Resolve the authenticated customer for storefront / mobile-app API routes.
 *
 * Accepts either:
 *   1. A verified mobile-app JWT (`Authorization: Bearer <access token>`), or
 *   2. A NextAuth web session.
 *
 * The caller's identity ALWAYS comes from the verified token / session — never from the
 * request body or query string.
 */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/db';
import { getAppAuthFromRequest, resolveAuthCustomer } from '@/lib/appAuth';

export async function resolveRequestCustomer(req: Request) {
  const auth = getAppAuthFromRequest(req);
  if (auth) {
    // Refresh tokens must not be usable as access tokens.
    if (auth.type === 'refresh') return null;
    const customer = await resolveAuthCustomer(auth);
    if (!customer) return null;
    // Honour server-side token revocation.
    const customerVersion = (customer as any).tokenVersion;
    if (
      typeof auth.tokenVersion === 'number' &&
      typeof customerVersion === 'number' &&
      auth.tokenVersion < customerVersion
    ) {
      return null;
    }
    return customer;
  }

  // A Bearer header that failed verification must not fall through to a body-supplied identity.
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  const or: any[] = [];
  if (session.user.email) or.push({ email: session.user.email });
  const sessionUserId = (session.user as any).id;
  if (sessionUserId) or.push({ id: sessionUserId });
  if (or.length === 0) return null;

  return prisma.customer.findFirst({ where: { OR: or } });
}

/**
 * Customer ids that belong to the same person as `customer` (guest + synced duplicates that
 * share the authenticated customer's own email / phone). Derived from the DB record only.
 */
export async function resolveCustomerIdentityIds(customer: {
  id: string;
  email?: string | null;
  phone?: string | null;
}): Promise<string[]> {
  const or: any[] = [{ id: customer.id }];
  if (customer.email) or.push({ email: customer.email });
  if (customer.phone) or.push({ phone: customer.phone });
  const rows = await prisma.customer.findMany({ where: { OR: or }, select: { id: true } });
  const ids = new Set<string>(rows.map((r: { id: string }) => r.id));
  ids.add(customer.id);
  return Array.from(ids);
}
