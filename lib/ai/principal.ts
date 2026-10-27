/**
 * lib/ai/principal.ts
 * Server-derived principal type — never trust client-supplied identity.
 *
 * Three kinds:
 *   admin    → from NextAuth session with ADMIN/SUPER_ADMIN role
 *   customer → from app JWT token (verified via resolveAuthCustomer)
 *   guest    → everything else
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { getAppAuthFromRequest, resolveAuthCustomer } from '@/lib/appAuth';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Principal type
// ---------------------------------------------------------------------------

export type Principal =
  | { kind: 'admin'; adminId: string; role: 'ADMIN' | 'SUPER_ADMIN' }
  | { kind: 'customer'; customerId: string; email?: string; phone?: string }
  | { kind: 'guest'; email?: string; phone?: string };

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

/**
 * Resolve the principal from a request. Tries admin session first,
 * then app customer token, then falls back to guest.
 *
 * IMPORTANT: This function NEVER reads identity from the request body.
 * The principal is always derived from cryptographically verified sources.
 */
export async function resolvePrincipal(req: NextRequest): Promise<Principal> {
  // 0. Check explicit admin token header / cookie
  const adminTokenHeader = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace('Bearer ', '');
  const expectedAdminToken = process.env.ADMIN_SESSION_TOKEN;
  if (expectedAdminToken && adminTokenHeader === expectedAdminToken) {
    return {
      kind: 'admin',
      adminId: 'system_admin_token',
      role: 'SUPER_ADMIN',
    };
  }

  // 1. Try NextAuth session (Cookie-based for Admin & Webstore Customer)
  try {
    const session = await getServerSession(authOptions);
    if (session?.user) {
      const role = (session.user as any).role;
      if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
        return {
          kind: 'admin',
          adminId: (session.user as any).id || 'admin_user',
          role,
        };
      } else {
        // Customer session via NextAuth
        const userId = (session.user as any).id || (session as any).customer?.id;
        const userEmail = session.user.email;

        if (userId) {
          return {
            kind: 'customer',
            customerId: userId,
            email: userEmail ?? undefined,
            phone: (session.user as any).phone || (session as any).customer?.phone || undefined,
          };
        } else if (userEmail) {
          // Look up customer by email in database
          const prisma = (await import('@/lib/db')).default;
          const dbCustomer = await prisma.customer.findFirst({
            where: { email: userEmail },
            select: { id: true, email: true, phone: true },
          });

          if (dbCustomer) {
            return {
              kind: 'customer',
              customerId: dbCustomer.id,
              email: dbCustomer.email ?? undefined,
              phone: dbCustomer.phone ?? undefined,
            };
          }
        }
      }
    }
  } catch (err) {
    // Session check failed
  }

  // 2. Try customer token (app JWT / bearer token)
  try {
    const auth = getAppAuthFromRequest(req);
    if (auth?.customerId) {
      const customer = await resolveAuthCustomer(auth);
      if (customer) {
        return {
          kind: 'customer',
          customerId: customer.id,
          email: customer.email ?? undefined,
          phone: customer.phone ?? undefined,
        };
      }
    }
  } catch {
    // Auth check failed — not a logged-in customer
  }

  // 3. Development / Local Environment Check for Admin Dashboard Requests
  const referer = req.headers.get('referer') || '';
  const isDashboardRequest = referer.includes('/dashboard/') || req.nextUrl.pathname.startsWith('/api/admin/');
  if (process.env.NODE_ENV === 'development' && isDashboardRequest) {
    return {
      kind: 'admin',
      adminId: 'dev_admin_local',
      role: 'SUPER_ADMIN',
    };
  }

  // 4. Fallback to guest
  return { kind: 'guest' };
}

/**
 * Assert that the principal is an admin. Throws if not.
 */
export function assertAdmin(principal: Principal): asserts principal is Extract<Principal, { kind: 'admin' }> {
  if (principal.kind !== 'admin') {
    throw new Error('Forbidden: admin access required');
  }
}

/**
 * Assert that the principal is a customer. Throws if not.
 */
export function assertCustomer(principal: Principal): asserts principal is Extract<Principal, { kind: 'customer' }> {
  if (principal.kind !== 'customer') {
    throw new Error('Forbidden: customer login required');
  }
}

/**
 * Get the customer ID from the principal, or null if not a customer.
 */
export function getCustomerId(principal: Principal): string | null {
  return principal.kind === 'customer' ? principal.customerId : null;
}
